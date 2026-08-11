import { createStarterProjectFiles } from "../../shared/project/starter-project.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DesignDocument } from "@opendesign/design-contracts";
import { ProjectHost } from "../project/project-host.js";
import { WorkspaceStore } from "../project/workspace-store.js";
import { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import type {
  DesignApplyToolInput,
  DesignPlanTarget,
  DesignPlanToolInput,
  DesignPlanToolInputV3,
} from "../../shared/design-agent-tools.js";

const modelSelection = {
  providerId: "provider_1",
  modelId: "design-model",
  reasoningEffort: "medium" as const,
};

const designPlan: DesignPlanToolInput = {
  version: 2,
  pageId: "page_welcome",
  deliverable: "ui",
  objective: "Design a polished product workspace",
  outputMode: "editable-composition",
  artboard: {
    mode: "create",
    frameId: "workspace_artboard",
    x: 120,
    y: 80,
    width: 1440,
    height: 1024,
  },
  composition: {
    direction: "Dense desktop workspace with a dominant primary work area",
    hierarchy: ["Navigation", "Primary work area", "Contextual inspector"],
    regions: [
      {
        nodeId: "workspace_navigation",
        name: "Navigation",
        role: "structure",
        x: 32,
        y: 32,
        width: 1376,
        height: 72,
      },
      {
        nodeId: "workspace_primary",
        name: "Primary work area",
        role: "content",
        x: 32,
        y: 128,
        width: 960,
        height: 864,
      },
      {
        nodeId: "workspace_inspector",
        name: "Contextual inspector",
        role: "interaction",
        x: 1016,
        y: 128,
        width: 392,
        height: 864,
      },
    ],
    assetIntegration:
      "Integrate one hero image below editable navigation and data",
    spacingRhythm: "4/8/12/20/32 px rhythm",
  },
  visualSystem: {
    avoidances: [
      "Do not wrap every region in the same rounded card",
      "Do not use borders as the only hierarchy signal",
    ],
    formLanguage: "Compact controls with precise edges and restrained radii",
    palette: ["#0F172A ink", "#F8FAFC canvas", "#2563EB action"],
    surfaceAndDepth: "Use tonal contrast and one deliberate elevation tier",
    typography: ["Inter 12/16 body", "Inter 24/30 semibold heading"],
    effects: ["Subtle separators", "Focused selection halo"],
  },
  rasterAssetRoles: ["hero", "background"],
  editableLayers: ["Navigation", "Workspace", "Inspector"],
  implementationSteps: ["Create artboard", "Build hierarchy", "Add states"],
  validationChecks: ["Check hierarchy", "Check density", "Check focus"],
};

const visualReview = {
  composition: "The primary work area needs more width",
  hierarchy: "The inspector competes with the page title",
  typography: "Secondary labels need lower contrast",
  assetIntegration: "Native icons align with the control grid",
  formAndSurface: "Secondary groups use too many borders",
  effects: "Selection treatment is clear and restrained",
  refinements: ["Reduce inspector contrast", "Remove secondary borders"],
};

function multiTargetPlan(pageId: string): DesignPlanToolInputV3 {
  const target = (
    targetId: string,
    label: string,
    frameId: string,
    x: number,
  ): DesignPlanTarget => ({
    targetId,
    label,
    pageId,
    objective: `Design the ${label} screen`,
    artboard: {
      mode: "create",
      frameId,
      x,
      y: 80,
      width: 390,
      height: 844,
    },
    composition: {
      direction: "Mobile product screen with clear navigation and content",
      hierarchy: ["Primary navigation", "Main content"],
      regions: [
        {
          nodeId: `${frameId}_content`,
          name: "Main content",
          role: "content",
          x: 24,
          y: 96,
          width: 342,
          height: 700,
        },
      ],
      assetIntegration: "Use editable native shapes and typography",
      spacingRhythm: "8/12/16/24 px rhythm",
    },
    editableLayers: ["Navigation", "Main content"],
    implementationSteps: ["Create the screen", "Build its content"],
    validationChecks: ["Check hierarchy", "Check mobile spacing"],
  });
  return {
    version: 3,
    deliverable: "ui",
    objective: "Design the requested Home and Profile screens",
    outputMode: "editable-composition",
    targets: [
      target("target_home", "Home", "frame_home", 120),
      target("target_profile", "Profile", "frame_profile", 558),
    ],
    visualSystem: {
      avoidances: ["No generic card stack", "No placeholder-only content"],
      formLanguage: "Precise mobile controls with restrained radii",
      palette: ["#101828", "#FFFFFF", "#2563EB"],
      surfaceAndDepth: "Use hierarchy and one subtle elevation tier",
      typography: ["Inter 28/34 heading", "Inter 14/20 body"],
      effects: ["Subtle navigation shadow"],
    },
    rasterAssetRoles: [],
  };
}

function draftTargets(
  pageId: string,
  targets: readonly DesignPlanTarget[],
): DesignApplyToolInput {
  return {
    label: "Build requested screens",
    commands: targets.flatMap((target, index) => [
      {
        commandId: `insert_${target.artboard.frameId}`,
        type: "insert_element" as const,
        pageId,
        parentId: null,
        index,
        node: {
          id: target.artboard.frameId,
          kind: "frame" as const,
          name: target.label,
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, target.artboard.x, target.artboard.y] as [
            number,
            number,
            number,
            number,
            number,
            number,
          ],
          size: {
            width: target.artboard.width,
            height: target.artboard.height,
          },
          opacity: 1,
          properties: {
            fills: [{ type: "solid" as const, color: "#ffffff", opacity: 1 }],
            strokes: [],
            strokeWidth: 0,
            cornerRadius: 0,
            clipsContent: true,
          },
          extensions: {},
        },
      },
      {
        commandId: `insert_${target.artboard.frameId}_content`,
        type: "insert_element" as const,
        pageId,
        parentId: target.artboard.frameId,
        index: 0,
        node: {
          id: `${target.artboard.frameId}_content`,
          kind: "group" as const,
          name: "Main content",
          parentId: target.artboard.frameId,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 24, 96] as [
            number,
            number,
            number,
            number,
            number,
            number,
          ],
          size: { width: 342, height: 700 },
          opacity: 1,
          properties: {},
          extensions: {},
        },
      },
      {
        commandId: `insert_${target.artboard.frameId}_material`,
        type: "insert_element" as const,
        pageId,
        parentId: `${target.artboard.frameId}_content`,
        index: 0,
        node: {
          id: `${target.artboard.frameId}_material`,
          kind: "rectangle" as const,
          name: "Material content",
          parentId: `${target.artboard.frameId}_content`,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0] as [
            number,
            number,
            number,
            number,
            number,
            number,
          ],
          size: { width: 280, height: 160 },
          opacity: 1,
          properties: {
            fills: [{ type: "solid" as const, color: "#f1f5f9", opacity: 1 }],
            strokes: [],
            strokeWidth: 0,
            cornerRadius: 16,
          },
          extensions: {},
        },
      },
    ]),
  };
}

function withDraftedTargets(
  source: DesignDocument,
  pageId: string,
  targets: readonly DesignPlanTarget[],
  revision: number,
): DesignDocument {
  const document = structuredClone(source);
  document.revision = revision;
  document.pagesById[pageId].rootNodeIds = targets.map(
    (target) => target.artboard.frameId,
  );
  document.nodesById = {};
  for (const target of targets) {
    const region = target.composition.regions[0];
    if (!region) throw new Error("Target region is missing");
    document.nodesById[target.artboard.frameId] = {
      id: target.artboard.frameId,
      kind: "frame",
      name: target.label,
      parentId: null,
      childIds: [region.nodeId],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, target.artboard.x, target.artboard.y],
      size: { width: target.artboard.width, height: target.artboard.height },
      opacity: 1,
      properties: {
        fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
      },
      extensions: {},
    };
    document.nodesById[region.nodeId] = {
      id: region.nodeId,
      kind: "group",
      name: region.name,
      parentId: target.artboard.frameId,
      childIds: [`${region.nodeId}_material`],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, region.x, region.y],
      size: { width: region.width, height: region.height },
      opacity: 1,
      properties: {},
      extensions: {},
    };
    document.nodesById[`${region.nodeId}_material`] = {
      id: `${region.nodeId}_material`,
      kind: "rectangle",
      name: "Material content",
      parentId: region.nodeId,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: {
        width: Math.max(1, region.width),
        height: Math.max(1, region.height),
      },
      opacity: 1,
      properties: {
        fills: [{ type: "solid", color: "#f1f5f9", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 16,
      },
      extensions: {},
    };
  }
  return document;
}

async function setup() {
  const store = new WorkspaceStore(":memory:");
  const host = new ProjectHost(store);
  const root = await mkdtemp(join(tmpdir(), "opendesign-task-coordinator-"));
  const manifest = await host.createProject(
    join(root, "Acme Design"),
    { projectId: "project_acme", name: "Acme Design" },
    createStarterProjectFiles("project_acme"),
  );
  const file = manifest.designFiles[0];
  if (!file) throw new Error("Starter design file is missing");
  const opened = await host.readDesignFile(
    manifest.projectId,
    file.designFileId,
  );
  const pageId = opened.document.pageOrder[0];
  if (!pageId) throw new Error("Starter page is missing");
  store.createConversation({
    conversationId: "conversation_mobile",
    homeProjectId: manifest.projectId,
    title: "Refine the mobile experience",
    createdAt: "2026-08-07T12:00:00.000Z",
    updatedAt: "2026-08-07T12:00:00.000Z",
    lifecycle: "active",
  });
  return { store, host, file, opened, pageId };
}

function inspectionResult(
  document: DesignDocument,
  pageId: string,
  revision = document.revision,
  includeAllPages = false,
) {
  const page = document.pagesById[pageId];
  if (!page) throw new Error("Inspection Page is missing");
  const inspectedPageIds = includeAllPages ? document.pageOrder : [pageId];
  return {
    observedRevision: revision,
    content: {
      document: {
        documentId: document.documentId,
        revision,
        pageOrder: [...inspectedPageIds],
        pagesById: Object.fromEntries(
          inspectedPageIds.map((inspectedPageId) => {
            const inspectedPage = document.pagesById[inspectedPageId];
            if (!inspectedPage) throw new Error("Inspection Page is missing");
            return [
              inspectedPageId,
              {
                id: inspectedPage.id,
                name: inspectedPage.name,
                rootNodeIds: [...inspectedPage.rootNodeIds],
              },
            ];
          }),
        ),
        nodesById: structuredClone(document.nodesById),
      },
    },
  };
}

function insertExistingChild(
  pageId: string,
  parentId: string | null,
  nodeId: string,
): DesignApplyToolInput {
  return {
    label: `Insert ${nodeId}`,
    commands: [
      {
        commandId: `insert_${nodeId}`,
        type: "insert_element",
        pageId,
        parentId,
        index: 0,
        node: {
          id: nodeId,
          kind: "rectangle",
          name: nodeId,
          parentId,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 24, 24],
          size: { width: 120, height: 80 },
          opacity: 1,
          properties: {
            fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
            strokes: [],
            strokeWidth: 0,
            cornerRadius: 0,
          },
          extensions: {},
        },
      },
    ],
  };
}

function withExistingArtboard(
  source: DesignDocument,
  pageId: string,
): DesignDocument {
  const document = structuredClone(source);
  document.pagesById[pageId].rootNodeIds = ["existing_artboard"];
  document.nodesById = {
    existing_artboard: {
      id: "existing_artboard",
      kind: "frame",
      name: "Existing artboard",
      parentId: null,
      childIds: ["existing_group"],
      visible: true,
      locked: true,
      transform: [1, 0, 0, 1, 80, 64],
      size: { width: 1120, height: 720 },
      opacity: 1,
      properties: {
        fills: [{ type: "solid", color: "#f8fafc", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
      },
      extensions: {},
    },
    existing_group: {
      id: "existing_group",
      kind: "group",
      name: "Existing Group",
      parentId: "existing_artboard",
      childIds: ["existing_nested_frame"],
      visible: true,
      locked: true,
      transform: [1, 0, 0, 1, 24, 24],
      size: { width: 480, height: 320 },
      opacity: 1,
      properties: {},
      extensions: {},
    },
    existing_nested_frame: {
      id: "existing_nested_frame",
      kind: "frame",
      name: "Existing nested Frame",
      parentId: "existing_group",
      childIds: [],
      visible: true,
      locked: true,
      transform: [1, 0, 0, 1, 24, 24],
      size: { width: 240, height: 160 },
      opacity: 1,
      properties: {
        fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: false,
      },
      extensions: {},
    },
  };
  return document;
}

describe("GlobalTaskCoordinator", () => {
  it("enforces a planned artboard and a rendered review before refinement", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_planned_design",
      sessionId: "conversation_mobile",
      prompt: "Refine the mobile experience",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_planned_design",
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: opened.document.revision,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };

    expect(() =>
      coordinator.assertDesignPlanForRaster(context, "hero"),
    ).toThrow("structured design plan");
    expect(() =>
      coordinator.registerDesignPlan(context, { ...designPlan, pageId }),
    ).toThrow("Inspect the bound design document");
    expect(() => coordinator.assertDocumentInspected(context)).toThrow(
      "Inspect the bound design document",
    );
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(opened.document, pageId),
    );
    expect(() => coordinator.assertDocumentInspected(context)).not.toThrow();
    expect(coordinator.recordCanvasCapture(context)).toEqual({
      capturedRevision: 0,
      nextAction: "define-plan-write-capture",
      reviewEligible: false,
    });
    expect(coordinator.resolveCanvasCaptureTarget(context)).toEqual({
      kind: "page",
      pageId,
    });
    coordinator.registerDesignPlan(context, { ...designPlan, pageId });
    expect(coordinator.recordCanvasCapture(context)).toEqual({
      capturedRevision: 0,
      nextAction: "write-capture",
      reviewEligible: false,
    });
    expect(coordinator.resolveCanvasCaptureTarget(context)).toEqual({
      kind: "page",
      pageId,
    });
    expect(() =>
      coordinator.registerVisualReview(context, visualReview),
    ).toThrow("design_workflow.material_write_required");
    expect(() =>
      coordinator.assertDesignPlanForRaster(context, "hero"),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDesignPlanForRaster(context, "background"),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDesignPlanForRaster(context, "final-single-image"),
    ).toThrow("not declared");
    coordinator.recordGeneratedRaster(context, "image_generated", "hero");
    expect(() =>
      coordinator.registerDesignPlan(context, {
        ...designPlan,
        pageId,
        outputMode: "single-raster",
        rasterAssetRoles: ["final-single-image"],
        singleRasterEvidence: "Refine the mobile experience",
      }),
    ).toThrow("explicitly requests one flattened image");

    const scatteredDraft: DesignApplyToolInput = {
      label: "Scatter one root layer",
      commands: [
        {
          commandId: "insert_scattered",
          type: "insert_element",
          pageId,
          parentId: null,
          index: 0,
          node: {
            id: "scattered",
            kind: "rectangle",
            name: "Scattered layer",
            parentId: null,
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 0, 0],
            size: { width: 200, height: 120 },
            opacity: 1,
            properties: {
              fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
              cornerRadius: 0,
            },
            extensions: {},
          },
        },
      ],
    };
    expect(() =>
      coordinator.assertDesignPlanForApply(context, scatteredDraft),
    ).toThrow("planned axis-aligned Page-root Frame");

    const plannedDraft: DesignApplyToolInput = {
      label: "Create planned editable workspace",
      commands: [
        {
          commandId: "insert_artboard",
          type: "insert_element",
          pageId,
          parentId: null,
          index: 0,
          node: {
            id: "workspace_artboard",
            kind: "frame",
            name: "Workspace artboard",
            parentId: null,
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 120, 80],
            size: { width: 1440, height: 1024 },
            opacity: 1,
            properties: {
              fills: [{ type: "solid", color: "#f8fafc", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
              cornerRadius: 0,
              clipsContent: true,
            },
            extensions: {},
          },
        },
        {
          commandId: "insert_title",
          type: "insert_element",
          pageId,
          parentId: "workspace_artboard",
          index: 0,
          node: {
            id: "workspace_title",
            kind: "text",
            name: "Workspace title",
            parentId: "workspace_artboard",
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 48, 40],
            size: { width: 520, height: 48 },
            opacity: 1,
            properties: {
              content: "Analytics workspace",
              fontFamily: "Inter",
              fontSize: 32,
              fontWeight: 650,
              lineHeight: 40,
              letterSpacing: -0.5,
              textAlignHorizontal: "left",
              textAlignVertical: "top",
              fills: [{ type: "solid", color: "#0f172a", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
            },
            extensions: {},
          },
        },
      ],
    };
    const misplacedDraft = structuredClone(plannedDraft);
    const misplacedArtboard = misplacedDraft.commands[0];
    if (!misplacedArtboard || misplacedArtboard.type !== "insert_element") {
      throw new Error("Planned artboard command is missing");
    }
    misplacedArtboard.node.transform = [1, 0, 0, 1, 0, 0];
    expect(() =>
      coordinator.assertDesignPlanForApply(context, misplacedDraft),
    ).toThrow("declared position and dimensions");
    expect(() =>
      coordinator.assertDesignPlanForApply(context, {
        ...plannedDraft,
        commands: [plannedDraft.commands[0]],
      }),
    ).toThrow("design_workflow.empty_artboard_draft");
    expect(coordinator.getDeliveryLedger(context.runId)?.targets).toMatchObject(
      [{ targetId: "workspace_artboard", status: "pending" }],
    );
    const authorization = coordinator.assertDesignPlanForApply(
      context,
      plannedDraft,
    );
    coordinator.recordDesignApplyCompleted(
      context.runId,
      plannedDraft,
      authorization,
      1,
    );
    expect(coordinator.resolveCanvasCaptureTarget(context)).toEqual({
      kind: "frame",
      nodeId: "workspace_artboard",
      pageId,
    });
    expect(() => coordinator.recordCanvasCapture(context, 0)).toThrow(
      "design_workflow.capture_revision_invalid",
    );
    expect(coordinator.recordCanvasCapture(context, 1)).toEqual({
      captureSequence: 1,
      capturedRevision: 1,
      deliveryTargetId: "workspace_artboard",
      nextAction: "record-visual-review",
      reviewEligible: true,
    });
    expect(() => coordinator.assertVisualReviewBeforeWrite(context)).toThrow(
      "structured visual review",
    );
    coordinator.registerVisualReview(context, visualReview);
    expect(() =>
      coordinator.registerVisualReview(context, visualReview),
    ).toThrow("design_workflow.capture_required");
    expect(coordinator.recordCanvasCapture(context, 1)).toEqual({
      captureSequence: 2,
      capturedRevision: 1,
      deliveryTargetId: "workspace_artboard",
      nextAction: "refine-reviewed-target",
      reviewEligible: false,
    });
    expect(() =>
      coordinator.registerVisualReview(context, visualReview),
    ).toThrow("design_workflow.capture_required");
    expect(() =>
      coordinator.assertVisualReviewBeforeWrite(context),
    ).not.toThrow();
    const navigationRegion: DesignApplyToolInput = {
      label: "Create planned navigation region",
      commands: [
        {
          commandId: "insert_navigation_region",
          type: "insert_element",
          pageId,
          parentId: "workspace_artboard",
          index: 1,
          node: {
            id: "workspace_navigation",
            kind: "group",
            name: "Navigation",
            parentId: "workspace_artboard",
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 32, 32],
            size: { width: 1376, height: 72 },
            opacity: 1,
            properties: {},
            extensions: {},
          },
        },
        {
          commandId: "insert_navigation_label",
          type: "insert_element",
          pageId,
          parentId: "workspace_navigation",
          index: 0,
          node: {
            id: "workspace_navigation_label",
            kind: "text",
            name: "Navigation label",
            parentId: "workspace_navigation",
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 16, 16],
            size: { width: 240, height: 32 },
            opacity: 1,
            properties: {
              content: "Workspace navigation",
              fontFamily: "Inter",
              fontSize: 16,
              fontWeight: 600,
              lineHeight: 24,
              letterSpacing: 0,
              textAlignHorizontal: "left",
              textAlignVertical: "top",
              fills: [{ type: "solid", color: "#0f172a", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
            },
            extensions: {},
          },
        },
      ],
    };
    expect(() =>
      coordinator.assertDesignPlanForApply(context, navigationRegion),
    ).not.toThrow();
    const misplacedRegion = structuredClone(navigationRegion);
    const misplacedRegionInsert = misplacedRegion.commands[0];
    if (
      !misplacedRegionInsert ||
      misplacedRegionInsert.type !== "insert_element"
    ) {
      throw new Error("Planned region command is missing");
    }
    misplacedRegionInsert.node.transform = [1, 0, 0, 1, 48, 32];
    expect(() =>
      coordinator.assertDesignPlanForApply(context, misplacedRegion),
    ).toThrow("directly inside the artboard at its declared bounds");
    expect(() =>
      coordinator.assertDesignPlanForApply(context, scatteredDraft),
    ).toThrow("outside the planned artboard Frame");
    expect(() =>
      coordinator.assertDesignPlanForImagePlacement(
        context,
        "hero",
        "wrong_parent",
      ),
    ).toThrow("planned artboard Frame");
    expect(() =>
      coordinator.assertDesignPlanForImagePlacement(
        context,
        "background",
        "workspace_artboard",
        "image_generated",
      ),
    ).toThrow("declared as hero");
    expect(() =>
      coordinator.assertDesignPlanForImagePlacement(
        context,
        "hero",
        "workspace_artboard",
        "image_generated",
      ),
    ).not.toThrow();

    store.close();
  });

  it("persists and enforces every user-requested delivery target", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_multi_delivery",
      sessionId: "conversation_mobile",
      prompt: "Design the Home and Profile screens",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_multi_delivery",
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: opened.document.revision,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(opened.document, pageId),
    );
    const plan = multiTargetPlan(pageId);
    coordinator.registerDesignPlan(context, plan);
    expect(coordinator.getDeliveryLedger(context.runId)).toMatchObject({
      activeTargetId: "target_home",
      targets: [
        { targetId: "target_home", status: "pending" },
        { targetId: "target_profile", status: "pending" },
      ],
    });

    const draft = draftTargets(pageId, plan.targets);
    const draftAuthorization = coordinator.assertDesignPlanForApply(
      context,
      draft,
    );
    expect(draftAuthorization?.targetIds).toEqual([
      "target_home",
      "target_profile",
    ]);
    coordinator.recordDesignApplyCompleted(
      context.runId,
      draft,
      draftAuthorization,
      1,
    );
    const draftedDocument = withDraftedTargets(
      opened.document,
      pageId,
      plan.targets,
      1,
    );
    expect(coordinator.getDeliveryLedger(context.runId)?.targets).toMatchObject(
      [
        { targetId: "target_home", status: "drafted", draftRevision: 1 },
        { targetId: "target_profile", status: "drafted", draftRevision: 1 },
      ],
    );

    expect(coordinator.resolveCanvasCaptureTarget(context)).toEqual({
      kind: "frame",
      pageId,
      nodeId: "frame_home",
    });
    coordinator.recordCanvasCapture(context, 1);
    coordinator.registerVisualReview(context, visualReview);
    const refineHome: DesignApplyToolInput = {
      label: "Refine Home hierarchy",
      commands: [
        {
          commandId: "refine_home",
          type: "update_properties",
          nodeId: "frame_home_content",
          opacity: 0.98,
        },
      ],
    };
    const homeAuthorization = coordinator.assertDesignPlanForApply(
      context,
      refineHome,
    );
    coordinator.recordDesignApplyCompleted(
      context.runId,
      refineHome,
      homeAuthorization,
      2,
    );
    const homeRefinedDocument = structuredClone(draftedDocument);
    homeRefinedDocument.revision = 2;
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(homeRefinedDocument, pageId),
    );
    expect(coordinator.resolveCanvasCaptureTarget(context)).toMatchObject({
      nodeId: "frame_home",
    });
    expect(coordinator.recordCanvasCapture(context, 2)).toMatchObject({
      deliveryTargetId: "target_home",
      nextAction: "continue-next-target",
      verified: true,
    });

    expect(coordinator.resolveCanvasCaptureTarget(context)).toMatchObject({
      nodeId: "frame_profile",
    });
    coordinator.recordCanvasCapture(context, 2);
    coordinator.registerVisualReview(context, visualReview);
    const refineProfile: DesignApplyToolInput = {
      label: "Refine Profile hierarchy",
      commands: [
        {
          commandId: "refine_profile",
          type: "update_properties",
          nodeId: "frame_profile_content",
          opacity: 0.98,
        },
      ],
    };
    const profileAuthorization = coordinator.assertDesignPlanForApply(
      context,
      refineProfile,
    );
    coordinator.recordDesignApplyCompleted(
      context.runId,
      refineProfile,
      profileAuthorization,
      3,
    );
    const profileRefinedDocument = structuredClone(homeRefinedDocument);
    profileRefinedDocument.revision = 3;
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(profileRefinedDocument, pageId),
    );
    expect(coordinator.recordCanvasCapture(context, 3)).toMatchObject({
      deliveryTargetId: "target_profile",
      nextAction: "complete-delivery",
      verified: true,
    });
    expect(coordinator.getDeliveryLedger(context.runId)).toMatchObject({
      activeTargetId: null,
      targets: [
        { targetId: "target_home", status: "verified", verifiedRevision: 2 },
        {
          targetId: "target_profile",
          status: "verified",
          verifiedRevision: 3,
        },
      ],
    });
    expect(
      store.listGlobalTasks().find((task) => task.runId === context.runId)
        ?.delivery,
    ).toEqual(coordinator.getDeliveryLedger(context.runId));

    store.close();
  });

  it("refuses to verify a delivery target whose planned region is empty", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_empty_delivery",
      sessionId: "conversation_mobile",
      prompt: "Design one Home screen",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_empty_delivery",
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: opened.document.revision,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(opened.document, pageId),
    );
    const sourcePlan = multiTargetPlan(pageId);
    const homeTarget = sourcePlan.targets[0];
    if (!homeTarget) throw new Error("Home target is missing");
    const plan: DesignPlanToolInputV3 = {
      ...sourcePlan,
      objective: "Design the requested Home screen",
      targets: [homeTarget],
    };
    coordinator.registerDesignPlan(context, plan);
    const fullDraft = draftTargets(pageId, plan.targets);
    const emptyDraft: DesignApplyToolInput = {
      ...fullDraft,
      commands: fullDraft.commands.filter(
        (command) =>
          command.type !== "insert_element" ||
          command.node.id !== "frame_home_material",
      ),
    };
    expect(() =>
      coordinator.assertDesignPlanForApply(context, emptyDraft),
    ).toThrow("design_workflow.empty_region_draft");
    expect(coordinator.getDeliveryLedger(context.runId)?.targets).toMatchObject(
      [{ targetId: "target_home", status: "pending" }],
    );
    const authorization = coordinator.assertDesignPlanForApply(
      context,
      fullDraft,
    );
    coordinator.recordDesignApplyCompleted(
      context.runId,
      fullDraft,
      authorization,
      1,
    );
    coordinator.recordCanvasCapture(context, 1);
    coordinator.registerVisualReview(context, visualReview);
    const refinement: DesignApplyToolInput = {
      label: "Refine Home shell",
      commands: [
        {
          commandId: "refine_empty_home",
          type: "update_properties",
          nodeId: "frame_home_content",
          opacity: 0.98,
        },
      ],
    };
    coordinator.recordDesignApplyCompleted(
      context.runId,
      refinement,
      coordinator.assertDesignPlanForApply(context, refinement),
      2,
    );
    const emptyDocument = withDraftedTargets(
      opened.document,
      pageId,
      plan.targets,
      2,
    );
    const region = emptyDocument.nodesById.frame_home_content;
    if (!region) throw new Error("Home region is missing");
    region.childIds = [];
    delete emptyDocument.nodesById.frame_home_content_material;
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(emptyDocument, pageId),
    );

    expect(() => coordinator.recordCanvasCapture(context, 2)).toThrow(
      "Planned region frame_home_content is empty",
    );
    expect(coordinator.getDeliveryLedger(context.runId)).toMatchObject({
      activeTargetId: "target_home",
      targets: [{ targetId: "target_home", status: "refined" }],
    });

    store.close();
  });

  it("recovers the first incomplete target from an interrupted persisted ledger", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_interrupted_delivery",
      sessionId: "conversation_mobile",
      prompt: "Design the Home and Profile screens",
      documentId: file.documentId,
      revision: 0,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const interrupted = store
      .listGlobalTasks()
      .find((task) => task.runId === "run_interrupted_delivery");
    if (!interrupted) throw new Error("Interrupted task is missing");
    store.saveGlobalTask({
      ...interrupted,
      lifecycle: "interrupted",
      delivery: {
        version: 1,
        targets: [
          {
            targetId: "target_home",
            label: "Home",
            pageId,
            rootNodeId: "frame_home",
            status: "verified",
            draftRevision: 1,
            captureRevision: 1,
            reviewRevision: 1,
            refinementRevision: 2,
            verifiedRevision: 2,
          },
          {
            targetId: "target_profile",
            label: "Profile",
            pageId,
            rootNodeId: "frame_profile",
            status: "drafted",
            draftRevision: 2,
          },
        ],
        activeTargetId: "target_profile",
      },
      updatedAt: "2026-08-11T12:00:00.000Z",
    });

    await coordinator.registerRun({
      type: "run.start",
      runId: "run_resumed_delivery",
      sessionId: "conversation_mobile",
      prompt: "Finish the design",
      documentId: file.documentId,
      revision: 2,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_resumed_delivery",
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: 2,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };
    expect(coordinator.getRecoverableDelivery(context)).toMatchObject({
      activeTargetId: "target_profile",
    });
    const plan = multiTargetPlan(pageId);
    const existingPlan: DesignPlanToolInputV3 = {
      ...plan,
      targets: plan.targets.map((target) => ({
        ...target,
        artboard: { ...target.artboard, mode: "existing" },
      })),
    };
    const recoveredDocument = withDraftedTargets(
      opened.document,
      pageId,
      existingPlan.targets,
      2,
    );
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(recoveredDocument, pageId),
    );
    coordinator.registerDesignPlan(context, existingPlan);
    expect(coordinator.getDeliveryLedger(context.runId)).toMatchObject({
      activeTargetId: "target_profile",
      targets: [
        { targetId: "target_home", status: "verified", verifiedRevision: 2 },
        { targetId: "target_profile", status: "drafted", draftRevision: 2 },
      ],
    });
    expect(coordinator.resolveCanvasCaptureTarget(context)).toEqual({
      kind: "frame",
      pageId,
      nodeId: "frame_profile",
    });

    store.close();
  });

  it("resolves existing artboard descendants from the authoritative inspection", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const document = withExistingArtboard(opened.document, pageId);
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_existing_artboard",
      sessionId: "conversation_mobile",
      prompt: "Continue the existing workspace design",
      documentId: file.documentId,
      revision: document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_existing_artboard",
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: document.revision,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(document, pageId),
    );
    const existingPlan: DesignPlanToolInput = {
      ...designPlan,
      pageId,
      artboard: {
        mode: "existing",
        frameId: "existing_artboard",
        x: 80,
        y: 64,
        width: 1120,
        height: 720,
      },
    };

    expect(() =>
      coordinator.registerDesignPlan(context, {
        ...existingPlan,
        artboard: { ...existingPlan.artboard, frameId: "missing_frame" },
      }),
    ).toThrow("design_workflow.existing_artboard_invalid");
    expect(() =>
      coordinator.registerDesignPlan(context, existingPlan),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDesignPlanForApply(
        context,
        insertExistingChild(pageId, "existing_group", "nested_group_child"),
      ),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDesignPlanForApply(
        context,
        insertExistingChild(
          pageId,
          "existing_nested_frame",
          "nested_frame_child",
        ),
      ),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDesignPlanForImagePlacement(
        context,
        "hero",
        "existing_nested_frame",
      ),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDesignPlanForApply(
        context,
        insertExistingChild(pageId, null, "scattered_existing_child"),
      ),
    ).toThrow("outside the planned artboard Frame");

    store.close();
  });

  it("requires a current inspection revision and recovers after re-inspection", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const document = withExistingArtboard(opened.document, pageId);
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_existing_revision",
      sessionId: "conversation_mobile",
      prompt: "Continue after a concurrent canvas revision",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const initialContext = {
      runId: "run_existing_revision",
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: opened.document.revision,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };
    coordinator.recordDocumentInspection(
      initialContext,
      inspectionResult(document, pageId),
    );
    coordinator.handleAgentEvent({
      type: "tool.completed",
      runId: "run_existing_revision",
      toolCallId: "tool_external_revision",
      result: { ok: true },
      revision: opened.document.revision + 1,
      transactionId: "transaction_external_revision",
    });
    const currentContext = {
      ...initialContext,
      revision: opened.document.revision + 1,
    };
    const existingPlan: DesignPlanToolInput = {
      ...designPlan,
      pageId,
      artboard: {
        mode: "existing",
        frameId: "existing_artboard",
        x: 80,
        y: 64,
        width: 1120,
        height: 720,
      },
    };
    expect(() =>
      coordinator.registerDesignPlan(currentContext, existingPlan),
    ).toThrow("design_workflow.inspection_stale");

    coordinator.recordDocumentInspection(
      currentContext,
      inspectionResult(document, pageId, currentContext.revision),
    );
    expect(() =>
      coordinator.registerDesignPlan(currentContext, existingPlan),
    ).not.toThrow();

    store.close();
  });

  it("moves the active Conversation to the front when a new Run starts", async () => {
    const { store, host, file, opened, pageId } = await setup();
    store.createConversation({
      conversationId: "conversation_recent",
      homeProjectId: "project_acme",
      title: "A newer idle conversation",
      createdAt: "2026-08-08T12:00:00.000Z",
      updatedAt: "2026-08-08T12:00:00.000Z",
      lifecycle: "active",
    });
    const coordinator = new GlobalTaskCoordinator(
      host,
      store,
      () => new Date("2026-08-10T01:00:00.000Z"),
    );

    await coordinator.registerRun({
      type: "run.start",
      runId: "run_reorder",
      sessionId: "conversation_mobile",
      prompt: "Continue the older Conversation",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });

    expect(
      store
        .listConversations("project_acme")
        .map((conversation) => [
          conversation.conversationId,
          conversation.updatedAt,
        ]),
    ).toEqual([
      ["conversation_mobile", "2026-08-10T01:00:00.000Z"],
      ["conversation_recent", "2026-08-08T12:00:00.000Z"],
    ]);
    store.close();
  });

  it("expands a Page Run only after one Main-recorded Page structure approval", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_page_access",
      sessionId: "conversation_mobile",
      prompt: "Create a Research page",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_page_access",
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: opened.document.revision,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(opened.document, pageId),
    );

    expect(() =>
      coordinator.assertPageToolAccess(context, {
        action: "rename",
        pageId,
      }),
    ).not.toThrow();
    expect(() =>
      coordinator.assertPageToolAccess(context, { action: "create" }),
    ).toThrow("page_structure_access_required");
    expect(coordinator.resolveExecutionContext(context).mutationTarget).toEqual(
      { kind: "page", pageId },
    );
    const crossPagePlan = multiTargetPlan(pageId);
    const secondTarget = crossPagePlan.targets[1];
    if (!secondTarget) throw new Error("Second target is missing");
    secondTarget.pageId = "page_research";
    expect(() =>
      coordinator.registerDesignPlan(context, crossPagePlan),
    ).toThrow("outside the registered Page mutation target");

    coordinator.grantPageStructureAccess(
      context.runId,
      "approval_pages",
      "tool_page_access",
    );

    expect(coordinator.hasPageStructureAccess(context.runId)).toBe(true);
    expect(coordinator.resolveExecutionContext(context)).toMatchObject({
      scope: { kind: "document", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "document" },
    });
    expect(() => coordinator.assertDocumentInspected(context)).toThrow(
      "inspection_required",
    );
    const fullDocument = structuredClone(opened.document);
    fullDocument.pageOrder.push("page_research");
    fullDocument.pagesById.page_research = {
      id: "page_research",
      name: "Research",
      rootNodeIds: [],
      extensions: {},
    };
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(fullDocument, pageId, fullDocument.revision, true),
    );
    expect(() =>
      coordinator.registerDesignPlan(context, crossPagePlan),
    ).not.toThrow();
    expect(() =>
      coordinator.assertPageToolAccess(context, { action: "create" }),
    ).not.toThrow();

    coordinator.handleAgentEvent({
      type: "run.completed",
      runId: context.runId,
      finishedAt: "2026-08-11T12:00:00.000Z",
      stopReason: "complete",
    });
    expect(coordinator.hasPageStructureAccess(context.runId)).toBe(false);
    store.close();
  });

  it("persists trusted run identity and terminal lifecycle transitions", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    const task = await coordinator.registerRun({
      type: "run.start",
      runId: "run_mobile",
      sessionId: "conversation_mobile",
      prompt: "Refine the mobile experience",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });

    expect(task).toMatchObject({
      taskId: "task_run_mobile",
      conversationId: "conversation_mobile",
      homeProjectId: "project_acme",
      runId: "run_mobile",
      lifecycle: "queued",
      targetSet: {
        primaryTarget: {
          projectId: "project_acme",
          designFileId: file.designFileId,
          documentId: file.documentId,
          pageId,
        },
      },
    });
    const toolContext = {
      runId: "run_mobile",
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: opened.document.revision,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };
    expect(() =>
      coordinator.assertDesignToolContext(toolContext),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDesignToolContext({
        ...toolContext,
        sessionId: "conversation_forged",
      }),
    ).toThrow("does not match its registered Run");
    expect(() =>
      coordinator.assertDesignToolContext({
        ...toolContext,
        scope: { kind: "document", selectedNodeIds: [] },
      }),
    ).toThrow("does not match its registered Run");
    coordinator.handleAgentEvent({
      type: "run.started",
      runId: "run_mobile",
      startedAt: "2026-08-07T12:01:00.000Z",
    });
    expect(store.listGlobalTasks()[0]?.lifecycle).toBe("running");
    coordinator.handleAgentEvent({
      type: "approval.requested",
      runId: "run_mobile",
      toolCallId: "tool_1",
      approvalId: "approval_1",
      title: "Apply design change",
      summary: "Review the structured edit",
    });
    expect(store.listGlobalTasks()[0]?.lifecycle).toBe("waiting_approval");
    coordinator.handleAgentEvent({
      type: "tool.completed",
      runId: "run_mobile",
      toolCallId: "tool_1",
      result: { ok: true },
      revision: opened.document.revision + 1,
      transactionId: "transaction_1",
    });
    expect(() => coordinator.assertDesignToolContext(toolContext)).toThrow(
      "Design tool revision conflict",
    );
    expect(() =>
      coordinator.assertDesignToolContext({
        ...toolContext,
        revision: opened.document.revision + 1,
      }),
    ).not.toThrow();
    coordinator.handleAgentEvent({
      type: "run.completed",
      runId: "run_mobile",
      finishedAt: "2026-08-07T12:02:00.000Z",
      stopReason: "complete",
    });
    expect(store.listGlobalTasks()[0]?.lifecycle).toBe("completed");
    expect(() =>
      coordinator.assertDesignToolContext({
        ...toolContext,
        revision: opened.document.revision + 1,
      }),
    ).toThrow("requires an active registered Run");
    store.close();
  });

  it("rejects unregistered Conversations and marks stale tasks interrupted", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await expect(
      coordinator.registerRun({
        type: "run.start",
        runId: "run_unknown",
        sessionId: "conversation_unknown",
        prompt: "Unknown Conversation",
        documentId: file.documentId,
        revision: opened.document.revision,
        modelSelection,
        scope: { kind: "page", pageId, selectedNodeIds: [] },
        mutationTarget: { kind: "page", pageId },
      }),
    ).rejects.toThrow("Agent run requires an active Conversation");
    await expect(
      coordinator.registerRun({
        type: "run.start",
        runId: "run_stale",
        sessionId: "conversation_mobile",
        prompt: "Use a stale revision",
        documentId: file.documentId,
        revision: opened.document.revision - 1,
        modelSelection,
        scope: { kind: "page", pageId, selectedNodeIds: [] },
        mutationTarget: { kind: "page", pageId },
      }),
    ).rejects.toThrow("Agent run revision is stale");
    await expect(
      coordinator.registerRun({
        type: "run.start",
        runId: "run_live_unsaved",
        sessionId: "conversation_mobile",
        prompt: "Work from the newer live canvas",
        documentId: file.documentId,
        revision: opened.document.revision + 1,
        modelSelection,
        scope: { kind: "page", pageId, selectedNodeIds: [] },
        mutationTarget: { kind: "page", pageId },
      }),
    ).resolves.toMatchObject({
      runId: "run_live_unsaved",
      targetSet: {
        primaryTarget: { baseRevision: opened.document.revision + 1 },
      },
    });
    await expect(
      coordinator.registerRun({
        type: "run.start",
        runId: "run_forged_selection",
        sessionId: "conversation_mobile",
        prompt: "Use a forged selection",
        documentId: file.documentId,
        revision: opened.document.revision,
        modelSelection,
        scope: {
          kind: "selection",
          pageId,
          selectedNodeIds: ["node_missing"],
          primaryNodeId: "node_missing",
        },
        mutationTarget: { kind: "page", pageId },
      }),
    ).rejects.toThrow("Agent run selection is outside the target page");

    await coordinator.registerRun({
      type: "run.start",
      runId: "run_interrupted",
      sessionId: "conversation_mobile",
      prompt: "Start a durable task",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    new GlobalTaskCoordinator(host, store).reconcileInterruptedTasks();
    expect(store.listGlobalTasks()[0]?.lifecycle).toBe("interrupted");
    store.close();
  });

  it("interrupts every active task when a process-level Agent error has no run ID", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_process_error",
      sessionId: "conversation_mobile",
      prompt: "Start a durable task",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });

    coordinator.handleAgentEvent({
      type: "agent.error",
      code: "process_error",
      message: "Agent process transport failed",
    });

    expect(store.listGlobalTasks()[0]?.lifecycle).toBe("interrupted");
    store.close();
  });
});
