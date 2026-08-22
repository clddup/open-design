import { createStarterProjectFiles } from "../../shared/project/starter-project.js";
import {
  BUILTIN_GRAPHIC_DESIGN_SKILL_REFS,
  BUILTIN_UI_DESIGN_SKILL_REFS,
} from "@opendesign/design-skills";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DesignDocument } from "@opendesign/design-contracts";
import {
  diagnoseDesignTargetLayout,
  type DesignLayoutQualityReport,
} from "@opendesign/editor-runtime";
import { ProjectHost } from "../project/project-host.js";
import { WorkspaceStore } from "../project/workspace-store.js";
import { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import type { DesignVisualCriticResult } from "./design-visual-critic.js";
import type {
  DesignApplyToolInput,
  DesignPlanTarget,
  DesignPlanToolInput,
} from "../../shared/design-agent-tools.js";
import { createAgentDesignIdAllocation } from "../../shared/design-id-allocation.js";

const modelSelection = {
  providerId: "provider_1",
  modelId: "design-model",
  reasoningEffort: "medium" as const,
};

const designPlan: DesignPlanToolInput = {
  version: 1,
  deliverable: "ui",
  objective: "Design a polished product workspace",
  outputMode: "editable-composition",
  targets: [
    {
      targetId: "workspace",
      label: "Product workspace",
      pageId: "page_welcome",
      objective: "Design a polished product workspace",
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
      editableLayers: ["Navigation", "Workspace", "Inspector"],
      implementationSteps: ["Create artboard", "Build hierarchy", "Add states"],
      validationChecks: ["Check hierarchy", "Check density", "Check focus"],
      qualityProfile: {
        kind: "ui",
        platform: "web",
        interactionMode: "pointer",
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        safeAreaNodeIds: ["workspace_navigation", "workspace_primary"],
        interactiveNodeIds: [],
      },
    },
  ],
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
  componentStrategy: {
    summary: "No reusable semantic object is needed in this fixture.",
    candidates: [],
  },
  briefFidelity: {
    requiredContent: ["Product workspace"],
    preservedSemantics: [],
    prohibitedAdditions: ["No unrequested product capability"],
    assumptions: ["Use a desktop Web workspace"],
  },
  designIntent: {
    subject: "A desktop workspace for focused product operations",
    audience: "Product operators managing dense day-to-day decisions",
    primaryJob: "See the primary work state and act without losing context",
    visualThesis:
      "A precise signal workspace makes operational hierarchy visible without a generic card dashboard.",
    signatureMotif:
      "One continuous signal rail connects navigation, primary work, and contextual inspection.",
    typographyLanguage:
      "Compact utilitarian labels support one decisive editorial heading tier.",
    colorMaterialLanguage:
      "Tinted neutral planes and one focused action accent establish controlled depth.",
    compositionTension:
      "An asymmetric primary plane and narrow contextual edge create deliberate focus.",
    antiPatterns: [
      "No equal grid of interchangeable cards",
      "No decorative purple gradient as identity",
      "No floating icon tile above every section",
    ],
  },
  skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
    ...reference,
  })),
};

const visualReview = {
  version: 1 as const,
  skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
    ...reference,
  })),
  briefFidelity:
    "The rendered workspace preserves the requested product structure and adds no unrequested capability",
  distinctiveness:
    "The signal workspace has a recognizable hierarchy beyond a generic product dashboard.",
  signatureMotif:
    "The continuous signal rail links navigation and the dominant primary work plane.",
  composition: "The primary work area needs more width",
  hierarchy: "The inspector competes with the page title",
  typography: "Secondary labels need lower contrast",
  assetIntegration: "Native icons align with the control grid",
  formAndSurface: "Secondary groups use too many borders",
  effects: "Selection treatment is clear and restrained",
  antiTemplate:
    "The result avoids an equal card grid and decorative gradient identity.",
  criteria: {
    "visual-thesis":
      "The operational signal thesis is visible in the primary plane.",
    "signature-motif":
      "The rail remains visible across navigation and content.",
    "composition-tension":
      "The asymmetric split establishes one dominant region.",
    "typography-character": "Type roles are distinct and remain readable.",
    "material-coherence":
      "Neutral planes and one accent form a coherent system.",
    "template-avoidance":
      "The capture avoids repeated cards and ornamental gradients.",
    "glance-legibility":
      "The primary task and action remain clear at thumbnail scale.",
    "subject-specificity":
      "The composition remains tied to the requested product subject.",
    "craft-precision":
      "Spacing and control proportions still need deliberate refinement.",
  },
  failedCriteria: ["composition-tension", "craft-precision"] as const,
  refinements: ["Reduce inspector contrast", "Remove secondary borders"],
};

function independentCritic(
  observedRevision: number,
  passed: boolean,
): DesignVisualCriticResult {
  return {
    version: 1,
    observedRevision,
    passed,
    averageScore: passed ? 4 : 2.8,
    summary: passed
      ? "The exact revision clears every independent delivery criterion."
      : "The exact revision still has generic composition and weak craft.",
    criteria: Object.fromEntries(
      Object.entries(visualReview.criteria).map(([id, evidence]) => [
        id,
        { score: passed ? 4 : 2, evidence },
      ]),
    ),
    failedCriteria: passed ? [] : ["composition-tension", "craft-precision"],
    refinements: passed ? [] : [...visualReview.refinements],
    review: structuredClone(visualReview),
  };
}

function designPlanForPage(pageId: string): DesignPlanToolInput {
  return {
    ...structuredClone(designPlan),
    targets: designPlan.targets.map((target) => ({
      ...structuredClone(target),
      pageId,
    })),
  };
}

function existingArtboardPlan(
  pageId: string,
  frameId = "existing_artboard",
): DesignPlanToolInput {
  const plan = designPlanForPage(pageId);
  return {
    ...plan,
    targets: plan.targets.map((target) => ({
      ...target,
      artboard: {
        mode: "existing",
        frameId,
        x: 80,
        y: 64,
        width: 1120,
        height: 720,
      },
      qualityProfile: {
        kind: "ui",
        platform: "web",
        interactionMode: "pointer",
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        safeAreaNodeIds: ["workspace_navigation"],
        interactiveNodeIds: [],
      },
    })),
  };
}

function multiTargetPlan(pageId: string): DesignPlanToolInput {
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
    qualityProfile: {
      kind: "ui",
      platform: "ios",
      interactionMode: "touch",
      safeAreaInsets: { top: 59, right: 0, bottom: 34, left: 0 },
      safeAreaNodeIds: [`${frameId}_content`],
      interactiveNodeIds: [],
    },
  });
  return {
    version: 1,
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
    componentStrategy: {
      summary: "No reusable semantic object is needed for this fixture.",
      candidates: [],
    },
    briefFidelity: {
      requiredContent: ["Home and Profile screens"],
      preservedSemantics: [],
      prohibitedAdditions: ["No unrequested product capability"],
      assumptions: ["Use an iOS safe area"],
    },
    designIntent: {
      subject: "A mobile product for focused creative work",
      audience: "Independent designers continuing time-sensitive work",
      primaryJob: "Recognize the next task and continue it immediately",
      visualThesis:
        "A directional editorial field expresses momentum instead of a generic mobile card stack.",
      signatureMotif:
        "One cropped signal rail connects identity, next action, and progress.",
      typographyLanguage:
        "Editorial display type sets pace while compact neutral text preserves clarity.",
      colorMaterialLanguage:
        "Tinted ink planes and one electric signal color create controlled hierarchy.",
      compositionTension:
        "Offset alignment and decisive scale contrast pull attention toward action.",
      antiPatterns: [
        "No centered card floating on a decorative background",
        "No equal grid of same-radius feature tiles",
        "No generic purple gradient used as the only identity",
      ],
    },
    skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
      ...reference,
    })),
  };
}

function qualityProfilePlan(pageId: string): DesignPlanToolInput {
  const source = multiTargetPlan(pageId);
  const home = source.targets[0];
  if (!home) throw new Error("Home target is missing");
  return {
    ...source,
    objective: "Design the Home screen with executable UI geometry policy",
    targets: [home],
    briefFidelity: {
      requiredContent: ["Home screen"],
      preservedSemantics: [],
      prohibitedAdditions: ["No unrequested product capability"],
      assumptions: ["Use an iOS safe area"],
    },
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
          exportSettings: [],
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
          exportSettings: [],
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
          exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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

function withAllocatedTargets(
  source: DesignDocument,
  pageId: string,
  targets: readonly DesignPlanTarget[],
  revision: number,
): DesignDocument {
  const document = structuredClone(source);
  document.revision = revision;
  for (const target of targets) {
    document.pagesById[pageId].rootNodeIds.push(target.artboard.frameId);
    document.nodesById[target.artboard.frameId] = {
      id: target.artboard.frameId,
      kind: "frame",
      name: target.label,
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, target.artboard.x, target.artboard.y],
      size: { width: target.artboard.width, height: target.artboard.height },
      exportSettings: [],
      opacity: 1,
      properties: {
        fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
      },
      extensions: { agentTargetId: target.targetId },
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
    originProjectId: manifest.projectId,
    filedProjectId: manifest.projectId,
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

function cleanLayoutQuality(
  documentId: string,
  pageId: string,
  artboardFrameId: string,
  revision: number,
  qualityProfile: DesignPlanTarget["qualityProfile"],
): DesignLayoutQualityReport {
  return {
    version: 6,
    documentId,
    revision,
    pageId,
    artboardFrameId,
    checkedNodeCount: 1,
    checkedQualityNodeCount: 0,
    checkedTextNodeCount: 0,
    errorCount: 0,
    warningCount: 0,
    issues: [],
    qualityProfile: structuredClone(qualityProfile),
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
          exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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
  it("binds the accepted Plan v6 quality profile to the active Frame capture target", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_quality_profile",
      sessionId: "conversation_mobile",
      prompt: "Design an iOS Home screen",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_quality_profile",
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
    const plan = qualityProfilePlan(pageId);
    coordinator.registerDesignPlan(context, plan);
    coordinator.recordDesignPlanAllocated(
      context.runId,
      plan.targets.map((target) => target.targetId),
      1,
    );

    expect(coordinator.resolveCanvasCaptureTarget(context)).toEqual({
      kind: "frame",
      pageId,
      nodeId: "frame_home",
      qualityProfile: plan.targets[0]?.qualityProfile,
    });
  });

  it("requires every Run image to receive one bounded reference decision", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    const runId = "run_reference_strategy";
    const attachmentId = `image_${"b".repeat(64)}`;
    await coordinator.registerRun({
      type: "run.start",
      runId,
      sessionId: "conversation_mobile",
      prompt: "Use the attached image as visual direction for this interface",
      attachments: [
        {
          attachmentId,
          name: "reference.png",
          mimeType: "image/png",
          byteSize: 4_000,
        },
      ],
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId,
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
    const basePlan = qualityProfilePlan(pageId);
    expect(() => coordinator.registerDesignPlan(context, basePlan)).toThrow(
      "design_workflow.reference_strategy_required",
    );
    expect(() =>
      coordinator.registerDesignPlan(context, {
        ...basePlan,
        referenceStrategy: {
          synthesis:
            "Use the authorized reference only for transferable visual decisions.",
          references: [
            {
              attachmentId: `image_${"c".repeat(64)}`,
              decision: "style-reference",
              application:
                "Transfer restrained contrast without copying the original subject.",
              preserve: ["restrained contrast"],
              avoid: ["literal copying"],
            },
          ],
        },
      }),
    ).toThrow("design_workflow.reference_strategy_invalid");

    const plan: DesignPlanToolInput = {
      ...basePlan,
      referenceStrategy: {
        synthesis:
          "Use the reference's restrained contrast while preserving the requested product structure.",
        references: [
          {
            attachmentId,
            decision: "style-reference",
            application:
              "Transfer the tonal hierarchy and quiet material contrast into the interface.",
            preserve: ["tonal hierarchy"],
            avoid: ["literal composition copy"],
          },
        ],
      },
    };
    coordinator.registerDesignPlan(context, plan);
    coordinator.recordDesignPlanAllocated(
      runId,
      plan.targets.map((target) => target.targetId),
      1,
    );
    const draft = draftTargets(pageId, plan.targets);
    const authorization = coordinator.assertDesignPlanForApply(context, draft);
    coordinator.recordDesignApplyCompleted(
      runId,
      authorization?.input ?? draft,
      authorization,
      2,
    );
    expect(
      coordinator.resolveVisualCriticContext(context, 2, {
        attachmentId: "capture_reference",
        byteSize: 12_000,
        mimeType: "image/jpeg",
        name: "capture.jpg",
      }),
    ).toMatchObject({
      referenceAttachments: [
        {
          attachmentId,
          mimeType: "image/png",
          byteSize: 4_000,
        },
      ],
    });
    store.close();
  });

  it("binds review skills from the active non-UI Plan instead of the normalizer default", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    const runId = "run_design_skills";
    await coordinator.registerRun({
      type: "run.start",
      runId,
      sessionId: "conversation_mobile",
      prompt: "Design a distinctive summer camp poster",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId,
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
    const uiPlan = qualityProfilePlan(pageId);
    const plan: DesignPlanToolInput = {
      ...uiPlan,
      deliverable: "poster",
      rasterAssetRoles: ["hero"],
      skillRefs: BUILTIN_GRAPHIC_DESIGN_SKILL_REFS.map((reference) => ({
        ...reference,
      })),
      targets: uiPlan.targets.map((target) => ({
        ...target,
        qualityProfile: { kind: "graphic" },
      })),
    };
    coordinator.registerDesignPlan(context, plan);
    coordinator.recordDesignPlanAllocated(runId, [plan.targets[0].targetId], 1);
    const draft = draftTargets(pageId, plan.targets);
    const authorization = coordinator.assertDesignPlanForApply(context, draft);
    coordinator.recordDesignApplyCompleted(
      runId,
      authorization?.input ?? draft,
      authorization,
      2,
    );
    const drafted = withDraftedTargets(
      opened.document,
      pageId,
      plan.targets,
      2,
    );
    coordinator.recordCanvasCapture(
      context,
      2,
      diagnoseDesignTargetLayout(
        drafted,
        pageId,
        plan.targets[0].artboard.frameId,
        plan.targets[0].qualityProfile,
      ),
    );

    expect(() =>
      coordinator.assertDesignPlanForImagePlacement(
        context,
        "hero",
        plan.targets[0].artboard.frameId,
      ),
    ).not.toThrow();

    expect(() =>
      coordinator.registerVisualReview(context, visualReview),
    ).not.toThrow();
    expect(() =>
      coordinator.registerVisualReview(context, visualReview),
    ).toThrow("design_workflow.capture_required");
    store.close();
  });

  it("requires the trusted Run namespace for create-plan document node IDs", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    const runId = "run_namespace";
    await coordinator.registerRun({
      type: "run.start",
      runId,
      sessionId: "conversation_mobile",
      prompt: "Design one new workspace",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId,
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: opened.document.revision,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };
    const inspected = inspectionResult(opened.document, pageId);
    coordinator.recordDocumentInspection(context, {
      ...inspected,
      content: {
        ...inspected.content,
        idAllocation: createAgentDesignIdAllocation(runId),
      },
    });
    const genericPlan: DesignPlanToolInput = {
      ...designPlan,
      targets: designPlan.targets.map((target) => ({ ...target, pageId })),
    };

    expect(() => coordinator.registerDesignPlan(context, genericPlan)).toThrow(
      /new_node_id_namespace_required.*workspace_artboard.*odr_run_namespace_/,
    );

    const prefix = "odr_run_namespace_";
    const namespacedPlan = {
      ...genericPlan,
      targets: genericPlan.targets.map((target) => ({
        ...target,
        artboard: {
          ...target.artboard,
          frameId: `${prefix}${target.artboard.frameId}`,
        },
        composition: {
          ...target.composition,
          regions: target.composition.regions.map((region) => ({
            ...region,
            nodeId: `${prefix}${region.nodeId}`,
          })),
        },
        qualityProfile:
          target.qualityProfile.kind === "ui"
            ? {
                ...target.qualityProfile,
                safeAreaNodeIds: target.qualityProfile.safeAreaNodeIds.map(
                  (nodeId) => `${prefix}${nodeId}`,
                ),
              }
            : target.qualityProfile,
      })),
    };
    expect(() =>
      coordinator.registerDesignPlan(context, namespacedPlan),
    ).not.toThrow();
    expect(
      coordinator.createDesignPlanAllocation(runId)?.input.commands[0],
    ).toMatchObject({
      node: { id: `${prefix}workspace_artboard` },
    });
    const qualitySource = qualityProfilePlan(pageId);
    const qualityTarget = qualitySource.targets[0];
    const qualityPlan = {
      ...qualitySource,
      targets: [
        {
          ...qualityTarget,
          artboard: {
            ...qualityTarget.artboard,
            frameId: `${prefix}${qualityTarget.artboard.frameId}`,
          },
          composition: {
            ...qualityTarget.composition,
            regions: qualityTarget.composition.regions.map((region) => ({
              ...region,
              nodeId: `${prefix}${region.nodeId}`,
            })),
          },
        },
      ],
    } satisfies DesignPlanToolInput;
    expect(() => coordinator.registerDesignPlan(context, qualityPlan)).toThrow(
      /new_node_id_namespace_required.*frame_home_content/i,
    );
    const qualityProfile = qualityPlan.targets[0].qualityProfile;
    if (!qualityProfile || qualityProfile.kind !== "ui") {
      throw new Error("UI profile required");
    }
    qualityPlan.targets[0].qualityProfile = {
      ...qualityProfile,
      safeAreaNodeIds: qualityProfile.safeAreaNodeIds.map(
        (nodeId) => `${prefix}${nodeId}`,
      ),
    };
    expect(() =>
      coordinator.registerDesignPlan(context, qualityPlan),
    ).not.toThrow();
    store.close();
  });
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
      coordinator.registerDesignPlan(context, designPlanForPage(pageId)),
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
    coordinator.registerDesignPlan(context, designPlanForPage(pageId));
    expect(coordinator.recordCanvasCapture(context)).toEqual({
      capturedRevision: 0,
      nextAction: "write-material-content",
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
    expect(
      coordinator.resolveGeneratedRasterAttachmentId(
        context,
        `image_${"f".repeat(64)}`,
        "hero",
      ),
    ).toBe("image_generated");
    expect(
      coordinator.resolveGeneratedRasterAttachmentId(
        context,
        "image_generated",
        "hero",
      ),
    ).toBe("image_generated");
    coordinator.recordGeneratedRaster(context, "image_generated_2", "hero");
    expect(() =>
      coordinator.resolveGeneratedRasterAttachmentId(
        context,
        `image_${"e".repeat(64)}`,
        "hero",
      ),
    ).toThrow("image_attachment_ambiguous");
    expect(() =>
      coordinator.resolveGeneratedRasterAttachmentId(
        context,
        "image_generated",
        "background",
      ),
    ).toThrow("cannot be placed as background");
    expect(() =>
      coordinator.registerDesignPlan(context, {
        ...designPlanForPage(pageId),
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
            exportSettings: [],
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
            exportSettings: [],
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
            exportSettings: [],
            opacity: 1,
            properties: {
              content: "Analytics workspace",
              fontFamily: "Inter",
              fontStyleName: null,
              fontSize: 32,
              fontWeight: 650,
              fontSlant: "normal",
              lineHeight: 40,
              letterSpacing: -0.5,
              paragraphIndent: 0,
              paragraphSpacing: 0,
              listSpacing: 0,
              hangingList: false,
              textCase: "original",
              textDecoration: "none",
              textAlignHorizontal: "left",
              textAlignVertical: "top",
              textResize: "fixed",
              textWrap: "word",
              textOverflow: "clip",
              textTruncation: "disabled",
              maxLines: null,
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
    const resolvedDraft = coordinator.assertDesignPlanForApply(
      context,
      misplacedDraft,
    );
    expect(resolvedDraft?.input.commands[0]).toMatchObject({
      pageId,
      parentId: null,
      node: {
        id: "workspace_artboard",
        parentId: null,
        transform: [1, 0, 0, 1, 120, 80],
        size: { width: 1440, height: 1024 },
      },
    });
    expect(resolvedDraft?.rebaseGuard).toBeUndefined();
    expect(() =>
      coordinator.assertDesignPlanForApply(context, {
        ...plannedDraft,
        commands: [plannedDraft.commands[0]],
      }),
    ).toThrow("design_workflow.empty_artboard_draft");
    expect(coordinator.getDeliveryLedger(context.runId)?.targets).toMatchObject(
      [{ targetId: "workspace", status: "pending" }],
    );
    const authorization = coordinator.assertDesignPlanForApply(
      context,
      plannedDraft,
    );
    coordinator.recordDesignApplyCompleted(
      context.runId,
      authorization?.input ?? plannedDraft,
      authorization,
      1,
    );
    expect(coordinator.resolveCanvasCaptureTarget(context)).toEqual({
      kind: "frame",
      nodeId: "workspace_artboard",
      pageId,
      qualityProfile: designPlan.targets[0].qualityProfile,
    });
    expect(() => coordinator.recordCanvasCapture(context, 0)).toThrow(
      "design_workflow.capture_revision_invalid",
    );
    expect(() => coordinator.recordCanvasCapture(context, 1)).toThrow(
      "design_workflow.layout_quality_unavailable",
    );
    expect(
      coordinator.recordCanvasCapture(
        context,
        1,
        cleanLayoutQuality(
          context.documentId,
          pageId,
          "workspace_artboard",
          1,
          designPlan.targets[0].qualityProfile,
        ),
      ),
    ).toEqual({
      captureSequence: 1,
      capturedRevision: 1,
      deliveryTargetId: "workspace",
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
    expect(
      coordinator.recordCanvasCapture(
        context,
        1,
        cleanLayoutQuality(
          context.documentId,
          pageId,
          "workspace_artboard",
          1,
          designPlan.targets[0].qualityProfile,
        ),
      ),
    ).toEqual({
      captureSequence: 2,
      capturedRevision: 1,
      deliveryTargetId: "workspace",
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
            exportSettings: [],
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
            exportSettings: [],
            opacity: 1,
            properties: {
              content: "Workspace navigation",
              fontFamily: "Inter",
              fontStyleName: null,
              fontSize: 16,
              fontWeight: 600,
              fontSlant: "normal",
              lineHeight: 24,
              letterSpacing: 0,
              paragraphIndent: 0,
              paragraphSpacing: 0,
              listSpacing: 0,
              hangingList: false,
              textCase: "original",
              textDecoration: "none",
              textAlignHorizontal: "left",
              textAlignVertical: "top",
              textResize: "fixed",
              textWrap: "word",
              textOverflow: "clip",
              textTruncation: "disabled",
              maxLines: null,
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
    const resolvedRegion = coordinator.assertDesignPlanForApply(
      context,
      misplacedRegion,
    );
    expect(resolvedRegion?.input.commands[0]).toMatchObject({
      parentId: "workspace_artboard",
      node: {
        id: "workspace_navigation",
        parentId: "workspace_artboard",
        transform: [1, 0, 0, 1, 32, 32],
        size: { width: 1376, height: 72 },
      },
    });
    expect(resolvedRegion?.rebaseGuard).toEqual({
      fromRevision: 0,
      targets: [
        {
          frameId: "workspace_artboard",
          pageId,
          width: 1440,
          height: 1024,
        },
      ],
    });
    expect(() =>
      coordinator.assertDesignApplyResult(context, resolvedRegion, {
        content: { ok: true },
        designRevision: {
          previousRevision: 1,
          rebasedFromRevision: 0,
          revision: 2,
          transactionId: "transaction_rebased_region",
        },
      }),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDesignApplyResult(context, resolvedRegion, {
        content: { ok: true },
        designRevision: {
          previousRevision: 1,
          revision: 2,
          transactionId: "transaction_unproven_rebase",
        },
      }),
    ).toThrow("unauthorized planned design revision rebase");
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

  it("lets fast mode complete a clean first draft without an elective refinement round", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_fast_delivery",
      sessionId: "conversation_mobile",
      prompt: "Design one focused logo",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      generationMode: "fast",
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_fast_delivery",
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
    const plan: DesignPlanToolInput = {
      ...designPlanForPage(pageId),
      deliverable: "brand-asset",
      rasterAssetRoles: [],
      skillRefs: BUILTIN_GRAPHIC_DESIGN_SKILL_REFS.map((reference) => ({
        ...reference,
      })),
      targets: designPlanForPage(pageId).targets.map((target) => ({
        ...target,
        composition: {
          ...target.composition,
          regions: target.composition.regions.slice(0, 1),
        },
        qualityProfile: { kind: "graphic" },
      })),
    };
    const target = plan.targets[0];
    if (!target) throw new Error("Fast delivery target is missing");
    coordinator.registerDesignPlan(context, plan);
    const allocation = coordinator.createDesignPlanAllocation(context.runId);
    coordinator.recordDesignPlanAllocated(
      context.runId,
      allocation?.targetIds ?? [],
      1,
    );
    const draft = draftTargets(pageId, plan.targets);
    const authorization = coordinator.assertDesignPlanForApply(context, draft);
    coordinator.recordDesignApplyCompleted(
      context.runId,
      authorization?.input ?? draft,
      authorization,
      2,
    );
    const draftedDocument = withDraftedTargets(
      opened.document,
      pageId,
      plan.targets,
      2,
    );
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(draftedDocument, pageId),
    );

    expect(
      coordinator.recordCanvasCapture(
        context,
        2,
        diagnoseDesignTargetLayout(
          draftedDocument,
          pageId,
          target.artboard.frameId,
          target.qualityProfile,
        ),
      ),
    ).toMatchObject({
      nextAction: "complete-delivery",
      verified: true,
      verification: "deterministic-fast-delivery",
    });
    expect(
      coordinator.getDeliveryLedger(context.runId)?.targets[0],
    ).toMatchObject({
      status: "verified",
      captureRevision: 2,
      reviewRevision: 2,
      verifiedRevision: 2,
    });
    store.close();
  });

  it("verifies fast delivery without a Provider critic or forced refinement", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_fast_bounded_review",
      sessionId: "conversation_mobile",
      prompt: "Design one focused logo",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      generationMode: "fast",
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_fast_bounded_review",
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
    const plan: DesignPlanToolInput = {
      ...designPlanForPage(pageId),
      deliverable: "brand-asset",
      rasterAssetRoles: [],
      skillRefs: BUILTIN_GRAPHIC_DESIGN_SKILL_REFS.map((reference) => ({
        ...reference,
      })),
      targets: designPlanForPage(pageId).targets.map((target) => ({
        ...target,
        composition: {
          ...target.composition,
          regions: target.composition.regions.slice(0, 1),
        },
        qualityProfile: { kind: "graphic" },
      })),
    };
    const target = plan.targets[0];
    if (!target) throw new Error("Fast delivery target is missing");
    coordinator.registerDesignPlan(context, plan);
    const allocation = coordinator.createDesignPlanAllocation(context.runId);
    coordinator.recordDesignPlanAllocated(
      context.runId,
      allocation?.targetIds ?? [],
      1,
    );
    const draft = draftTargets(pageId, plan.targets);
    const draftAuthorization = coordinator.assertDesignPlanForApply(
      context,
      draft,
    );
    coordinator.recordDesignApplyCompleted(
      context.runId,
      draftAuthorization?.input ?? draft,
      draftAuthorization,
      2,
    );
    const draftedDocument = withDraftedTargets(
      opened.document,
      pageId,
      plan.targets,
      2,
    );
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(draftedDocument, pageId),
    );
    expect(
      coordinator.resolveVisualCriticContext(context, 2, {
        attachmentId: "capture_fast",
        byteSize: 12_000,
        mimeType: "image/jpeg",
        name: "fast.jpg",
      }),
    ).toBeNull();
    expect(
      coordinator.recordCanvasCapture(
        context,
        2,
        diagnoseDesignTargetLayout(
          draftedDocument,
          pageId,
          target.artboard.frameId,
          target.qualityProfile,
        ),
      ),
    ).toMatchObject({
      nextAction: "complete-delivery",
      verified: true,
      verification: "deterministic-fast-delivery",
    });
    expect(
      coordinator.getDeliveryLedger(context.runId)?.targets[0],
    ).toMatchObject({
      status: "verified",
      captureRevision: 2,
      reviewRevision: 2,
      verifiedRevision: 2,
    });
    store.close();
  });

  it("keeps a bounded visual critic for fast Logo work and binds repeated command Pages to the registered Run", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_fast_logo_review",
      sessionId: "conversation_mobile",
      prompt: "为 OpenDesign 设计一个有独立识别度的 Logo",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      generationMode: "fast",
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_fast_logo_review",
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
    const plan: DesignPlanToolInput = {
      ...designPlanForPage(pageId),
      deliverable: "logo",
      rasterAssetRoles: [],
      logoOutputs: ["symbol"],
      skillRefs: BUILTIN_GRAPHIC_DESIGN_SKILL_REFS.map((reference) => ({
        ...reference,
      })),
      targets: designPlanForPage(pageId).targets.map((target) => ({
        ...target,
        qualityProfile: { kind: "graphic" },
      })),
    };
    coordinator.registerDesignPlan(context, plan);
    const allocation = coordinator.createDesignPlanAllocation(context.runId);
    coordinator.recordDesignPlanAllocated(
      context.runId,
      allocation?.targetIds ?? [],
      1,
    );
    const draft = draftTargets(pageId, plan.targets);
    draft.commands = draft.commands.map((command) =>
      command.type === "insert_element"
        ? { ...command, pageId: "page_create_from_run_timestamp_typo" }
        : command,
    );
    const authorization = coordinator.assertDesignPlanForApply(context, draft);
    expect(
      authorization?.input.commands.every(
        (command) =>
          command.type !== "insert_element" || command.pageId === pageId,
      ),
    ).toBe(true);
    coordinator.recordDesignApplyCompleted(
      context.runId,
      authorization?.input ?? draft,
      authorization,
      2,
    );
    const draftedDocument = withDraftedTargets(
      opened.document,
      pageId,
      plan.targets,
      2,
    );
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(draftedDocument, pageId),
    );

    expect(
      coordinator.resolveVisualCriticContext(context, 2, {
        attachmentId: "capture_fast_logo",
        byteSize: 12_000,
        mimeType: "image/jpeg",
        name: "fast-logo.jpg",
      }),
    ).toMatchObject({
      generationMode: "fast",
      plan: { deliverable: "logo" },
      observedRevision: 2,
      phase: "draft",
    });
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
    const ambiguousPlan = structuredClone(plan);
    ambiguousPlan.targets[1].composition.regions[0].nodeId =
      ambiguousPlan.targets[0].composition.regions[0].nodeId;
    expect(() =>
      coordinator.registerDesignPlan(context, ambiguousPlan),
    ).toThrow("plan_node_ambiguous");
    coordinator.registerDesignPlan(context, plan);
    const allocation = coordinator.createDesignPlanAllocation(context.runId);
    expect(allocation?.targetIds).toEqual(["target_home", "target_profile"]);
    expect(allocation?.input.commands).toHaveLength(2);
    const homeTarget = plan.targets[0];
    const profileTarget = plan.targets[1];
    if (!homeTarget || !profileTarget) {
      throw new Error("Multi-target fixture is incomplete");
    }
    const compactHomeDraft = draftTargets(pageId, [homeTarget]);
    compactHomeDraft.commands = compactHomeDraft.commands.filter(
      (command) =>
        command.type !== "insert_element" ||
        command.node.id !== homeTarget.artboard.frameId,
    );
    expect(
      coordinator.assertDesignPlanForAllocatedApply(
        context,
        compactHomeDraft,
        allocation?.targetIds ?? [],
      ),
    ).toMatchObject({ targetIds: ["target_home"] });
    expect(coordinator.getDeliveryLedger(context.runId)?.targets).toMatchObject(
      [
        { targetId: "target_home", status: "pending" },
        { targetId: "target_profile", status: "pending" },
      ],
    );
    coordinator.recordDesignPlanAllocated(
      context.runId,
      allocation?.targetIds ?? [],
      1,
    );
    expect(coordinator.getDeliveryLedger(context.runId)).toMatchObject({
      activeTargetId: "target_home",
      targets: [
        {
          targetId: "target_home",
          status: "allocated",
          allocatedRevision: 1,
        },
        {
          targetId: "target_profile",
          status: "allocated",
          allocatedRevision: 1,
        },
      ],
    });
    expect(coordinator.recordCanvasCapture(context, 1)).toMatchObject({
      nextAction: "write-material-content",
      reviewEligible: false,
    });

    const draft = draftTargets(pageId, plan.targets);
    expect(coordinator.assertDesignPlanForApply(context, draft)).toMatchObject({
      targetIds: ["target_home", "target_profile"],
    });
    const homeDraft = draftTargets(pageId, [homeTarget]);
    const draftAuthorization = coordinator.assertDesignPlanForApply(
      context,
      homeDraft,
    );
    expect(draftAuthorization?.targetIds).toEqual(["target_home"]);
    expect(
      draftAuthorization?.input.commands.some(
        (command) =>
          command.type === "insert_element" &&
          command.node.id === homeTarget.artboard.frameId,
      ),
    ).toBe(false);
    coordinator.recordDesignApplyCompleted(
      context.runId,
      draftAuthorization?.input ?? homeDraft,
      draftAuthorization,
      2,
    );
    const draftedDocument = withDraftedTargets(
      opened.document,
      pageId,
      [homeTarget],
      2,
    );
    expect(coordinator.getDeliveryLedger(context.runId)?.targets).toMatchObject(
      [
        {
          targetId: "target_home",
          status: "drafted",
          allocatedRevision: 1,
          draftRevision: 2,
        },
        { targetId: "target_profile", status: "allocated" },
      ],
    );

    expect(coordinator.resolveCanvasCaptureTarget(context)).toEqual({
      kind: "frame",
      pageId,
      nodeId: "frame_home",
      qualityProfile: homeTarget.qualityProfile,
    });
    expect(
      coordinator.resolveVisualCriticContext(context, 2, {
        attachmentId: "capture_home",
        byteSize: 12_000,
        mimeType: "image/jpeg",
        name: "home.jpg",
      }),
    ).toMatchObject({
      modelSelection,
      observedRevision: 2,
      phase: "draft",
      target: { targetId: "target_home" },
      attachment: { attachmentId: "capture_home" },
    });
    expect(() => coordinator.assertDesignRefinementReady(context)).toThrow(
      "trusted independent visual review",
    );
    expect(() =>
      coordinator.recordCanvasCapture(
        context,
        2,
        diagnoseDesignTargetLayout(
          draftedDocument,
          pageId,
          "frame_profile",
          profileTarget.qualityProfile,
        ),
      ),
    ).toThrow("design_workflow.layout_quality_unavailable");
    expect(
      coordinator.recordCanvasCapture(
        context,
        2,
        diagnoseDesignTargetLayout(
          draftedDocument,
          pageId,
          "frame_home",
          homeTarget.qualityProfile,
        ),
        independentCritic(2, false),
      ),
    ).toMatchObject({
      nextAction: "refine-independent-critic-findings",
      reviewEligible: false,
      critic: {
        passed: false,
        criteria: {
          "composition-tension": {
            score: 2,
            evidence: visualReview.criteria["composition-tension"],
          },
        },
        failedCriteria: ["composition-tension", "craft-precision"],
      },
    });
    expect(() =>
      coordinator.assertDesignRefinementReady(context),
    ).not.toThrow();
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
      3,
    );
    const homeRefinedDocument = structuredClone(draftedDocument);
    homeRefinedDocument.revision = 3;
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(homeRefinedDocument, pageId),
    );
    expect(coordinator.resolveCanvasCaptureTarget(context)).toMatchObject({
      nodeId: "frame_home",
    });
    const overflowingHome = structuredClone(homeRefinedDocument);
    const overflowingHomeMaterial =
      overflowingHome.nodesById.frame_home_content_material;
    if (!overflowingHomeMaterial) {
      throw new Error("Home material fixture is missing");
    }
    overflowingHomeMaterial.transform = [1, 0, 0, 1, 500, 900];
    const failingHomeQuality = diagnoseDesignTargetLayout(
      overflowingHome,
      pageId,
      "frame_home",
      homeTarget.qualityProfile,
    );
    expect(failingHomeQuality.errorCount).toBeGreaterThan(0);
    expect(
      coordinator.recordCanvasCapture(context, 3, failingHomeQuality),
    ).toMatchObject({
      deliveryTargetId: "target_home",
      nextAction: "repair-layout-overflow",
      reviewEligible: false,
      repair: {
        toolName: "opendesign_arrange_layers",
        input: {
          action: "repair-overflow",
          pageId,
          frameId: "frame_home",
        },
        errorCount: failingHomeQuality.errorCount,
      },
    });
    expect(
      coordinator.getDeliveryLedger(context.runId)?.targets[0]?.status,
    ).toBe("refined");
    expect(() =>
      coordinator.recordCanvasCapture(
        context,
        3,
        diagnoseDesignTargetLayout(
          homeRefinedDocument,
          pageId,
          "frame_home",
          homeTarget.qualityProfile,
        ),
      ),
    ).toThrow(
      "Final delivery verification requires an independent visual critic",
    );
    expect(
      coordinator.recordCanvasCapture(
        context,
        3,
        diagnoseDesignTargetLayout(
          homeRefinedDocument,
          pageId,
          "frame_home",
          homeTarget.qualityProfile,
        ),
        independentCritic(3, false),
      ),
    ).toMatchObject({
      nextAction: "refine-independent-critic-findings",
      reviewEligible: false,
      critic: { passed: false },
    });
    expect(
      coordinator.getDeliveryLedger(context.runId)?.targets[0]?.status,
    ).toBe("refined");
    expect(
      coordinator.recordCanvasCapture(
        context,
        3,
        diagnoseDesignTargetLayout(
          homeRefinedDocument,
          pageId,
          "frame_home",
          homeTarget.qualityProfile,
        ),
        independentCritic(3, true),
      ),
    ).toMatchObject({
      deliveryTargetId: "target_home",
      nextAction: "continue-next-target",
      verified: true,
    });

    expect(coordinator.resolveCanvasCaptureTarget(context)).toMatchObject({
      nodeId: "frame_profile",
    });
    const profileDraft = draftTargets(pageId, [profileTarget]);
    const profileDraftAuthorization = coordinator.assertDesignPlanForApply(
      context,
      profileDraft,
    );
    coordinator.recordDesignApplyCompleted(
      context.runId,
      profileDraftAuthorization?.input ?? profileDraft,
      profileDraftAuthorization,
      4,
    );
    const profileDraftedDocument = withDraftedTargets(
      opened.document,
      pageId,
      plan.targets,
      4,
    );
    coordinator.recordCanvasCapture(
      context,
      4,
      diagnoseDesignTargetLayout(
        profileDraftedDocument,
        pageId,
        "frame_profile",
        profileTarget.qualityProfile,
      ),
    );
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
      5,
    );
    const profileRefinedDocument = structuredClone(profileDraftedDocument);
    profileRefinedDocument.revision = 5;
    const profileFrame = profileRefinedDocument.nodesById.frame_profile;
    if (profileFrame?.kind !== "frame") {
      throw new Error("Profile Frame fixture is missing");
    }
    profileFrame.properties.clipsContent = false;
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(profileRefinedDocument, pageId),
    );
    const profileQuality = diagnoseDesignTargetLayout(
      profileRefinedDocument,
      pageId,
      "frame_profile",
      profileTarget.qualityProfile,
    );
    expect(profileQuality.errorCount).toBe(0);
    expect(profileQuality.warningCount).toBeGreaterThan(0);
    expect(
      coordinator.recordCanvasCapture(
        context,
        5,
        profileQuality,
        independentCritic(5, true),
      ),
    ).toMatchObject({
      deliveryTargetId: "target_profile",
      nextAction: "complete-delivery",
      verified: true,
    });
    expect(coordinator.getDeliveryLedger(context.runId)).toMatchObject({
      activeTargetId: null,
      targets: [
        { targetId: "target_home", status: "verified", verifiedRevision: 3 },
        {
          targetId: "target_profile",
          status: "verified",
          verifiedRevision: 5,
        },
      ],
    });
    expect(
      store.listGlobalTasks().find((task) => task.runId === context.runId)
        ?.delivery,
    ).toEqual(coordinator.getDeliveryLedger(context.runId));

    store.close();
  });

  it("versions plan amendments while preserving material target identities", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_plan_amendment",
      sessionId: "conversation_mobile",
      prompt: "Design the Home and Profile screens",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_plan_amendment",
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
    expect(coordinator.registerDesignPlan(context, plan)).toMatchObject({
      status: "accepted",
      planRevision: 1,
    });
    expect(
      coordinator.registerDesignPlan(context, structuredClone(plan)),
    ).toMatchObject({
      status: "unchanged",
      planRevision: 1,
      changedTargetIds: [],
    });

    const home = plan.targets[0];
    if (!home) throw new Error("Home target is missing");
    const draft = draftTargets(pageId, [home]);
    const authorization = coordinator.assertDesignPlanForApply(context, draft);
    coordinator.recordDesignApplyCompleted(
      context.runId,
      draft,
      authorization,
      1,
    );
    coordinator.handleAgentEvent({
      type: "tool.completed",
      runId: context.runId,
      toolCallId: "tool_home_draft",
      result: { ok: true },
      revision: 1,
    });
    const draftedDocument = withDraftedTargets(
      opened.document,
      pageId,
      [home],
      1,
    );
    const contextAtRevision1 = { ...context, revision: 1 };
    coordinator.recordDocumentInspection(
      contextAtRevision1,
      inspectionResult(draftedDocument, pageId),
    );

    const profile = plan.targets[1];
    if (!profile) throw new Error("Profile target is missing");
    const settings: DesignPlanTarget = {
      ...structuredClone(profile),
      targetId: "target_settings",
      label: "Settings",
      objective: "Design the Settings screen",
      artboard: {
        ...profile.artboard,
        frameId: "frame_settings",
        x: 996,
      },
      composition: {
        ...structuredClone(profile.composition),
        regions: profile.composition.regions.map((region) => ({
          ...region,
          nodeId: region.nodeId.replace("frame_profile", "frame_settings"),
        })),
      },
      qualityProfile:
        profile.qualityProfile.kind === "ui"
          ? {
              ...structuredClone(profile.qualityProfile),
              safeAreaNodeIds: profile.qualityProfile.safeAreaNodeIds.map(
                (nodeId) => nodeId.replace("frame_profile", "frame_settings"),
              ),
              interactiveNodeIds: profile.qualityProfile.interactiveNodeIds.map(
                (nodeId) => nodeId.replace("frame_profile", "frame_settings"),
              ),
            }
          : structuredClone(profile.qualityProfile),
    };
    const amended: DesignPlanToolInput = {
      ...structuredClone(plan),
      objective: "Design the Home, Profile, and Settings screens",
      targets: [
        {
          ...structuredClone(home),
          implementationSteps: [
            ...home.implementationSteps,
            "Improve the Home hierarchy after visual review",
          ],
        },
        structuredClone(profile),
        settings,
      ],
      visualSystem: {
        ...structuredClone(plan.visualSystem),
        formLanguage: "Sharper mobile hierarchy with asymmetric emphasis",
      },
    };
    const registration = coordinator.registerDesignPlan(
      contextAtRevision1,
      amended,
    );
    expect(registration).toMatchObject({
      status: "amended",
      planRevision: 2,
    });
    expect(registration.changedTargetIds).toContain("target_home");
    expect(registration.changedTargetIds).toContain("target_settings");
    expect(coordinator.getDeliveryLedger(context.runId)).toMatchObject({
      activeTargetId: "target_home",
      targets: [
        {
          targetId: "target_home",
          pageId,
          rootNodeId: "frame_home",
          status: "drafted",
          draftRevision: 1,
        },
        { targetId: "target_profile", status: "pending" },
        { targetId: "target_settings", status: "pending" },
      ],
    });

    expect(() =>
      coordinator.registerDesignPlan(contextAtRevision1, {
        ...amended,
        targets: amended.targets.filter(
          (target) => target.targetId !== "target_home",
        ),
      }),
    ).toThrow("Material target target_home cannot be removed");
    expect(() =>
      coordinator.registerDesignPlan(contextAtRevision1, {
        ...amended,
        targets: amended.targets.map((target) =>
          target.targetId === "target_home"
            ? {
                ...target,
                artboard: { ...target.artboard, frameId: "frame_home_v2" },
              }
            : target,
        ),
      }),
    ).toThrow("must preserve its Page and artboard Frame ID");

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
    const plan: DesignPlanToolInput = {
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
    const draftedDocument = withDraftedTargets(
      opened.document,
      pageId,
      plan.targets,
      1,
    );
    coordinator.recordCanvasCapture(
      context,
      1,
      diagnoseDesignTargetLayout(
        draftedDocument,
        pageId,
        "frame_home",
        homeTarget.qualityProfile,
      ),
    );
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

    expect(() =>
      coordinator.recordCanvasCapture(
        context,
        2,
        diagnoseDesignTargetLayout(
          emptyDocument,
          pageId,
          "frame_home",
          homeTarget.qualityProfile,
        ),
        independentCritic(2, true),
      ),
    ).toThrow("Planned region frame_home_content is empty");
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
        version: 3,
        targets: [
          {
            targetId: "target_home",
            label: "Home",
            pageId,
            rootNodeId: "frame_home",
            reservedNodeIds: ["frame_home", "frame_home_content"],
            status: "verified",
            allocatedRevision: 1,
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
            reservedNodeIds: ["frame_profile", "frame_profile_content"],
            status: "drafted",
            allocatedRevision: 1,
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
    const existingPlan: DesignPlanToolInput = {
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
    const profileRoot = recoveredDocument.nodesById.frame_profile;
    if (!profileRoot || profileRoot.kind !== "frame") {
      throw new Error("Recovered Profile Frame is missing");
    }
    profileRoot.childIds = [];
    delete recoveredDocument.nodesById.frame_profile_content;
    delete recoveredDocument.nodesById.frame_profile_content_material;
    const recoveredInspection = inspectionResult(recoveredDocument, pageId);
    coordinator.recordDocumentInspection(context, {
      ...recoveredInspection,
      content: {
        ...recoveredInspection.content,
        idAllocation: createAgentDesignIdAllocation(context.runId),
      },
    });
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
      qualityProfile: existingPlan.targets[1].qualityProfile,
    });
    expect(() =>
      coordinator.assertDesignPlanForApply(
        context,
        insertExistingChild(pageId, "frame_profile", "frame_profile_content"),
      ),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDesignPlanForApply(
        context,
        insertExistingChild(pageId, "frame_profile", "legacy_unreserved"),
      ),
    ).toThrow("new_node_id_namespace_required");

    store.close();
  });

  it("resolves existing artboard descendants from the authoritative inspection", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const document = withExistingArtboard(opened.document, pageId);
    const logicalRegionIdCollision = insertExistingChild(
      pageId,
      null,
      "workspace_primary",
    ).commands[0];
    if (
      !logicalRegionIdCollision ||
      logicalRegionIdCollision.type !== "insert_element"
    ) {
      throw new Error("Logical region collision fixture is invalid");
    }
    document.pagesById[pageId].rootNodeIds.push(
      logicalRegionIdCollision.node.id,
    );
    document.nodesById[logicalRegionIdCollision.node.id] = structuredClone(
      logicalRegionIdCollision.node,
    );
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
    const existingPlan = existingArtboardPlan(pageId);

    expect(() =>
      coordinator.registerDesignPlan(
        context,
        existingArtboardPlan(pageId, "missing_frame"),
      ),
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
    const logicalRegionWrite = insertExistingChild(
      pageId,
      "existing_nested_frame",
      "workspace_navigation",
    );
    const resolvedLogicalRegion = coordinator.assertDesignPlanForApply(
      context,
      logicalRegionWrite,
    );
    expect(resolvedLogicalRegion?.input.commands[0]).toMatchObject({
      parentId: "existing_nested_frame",
      node: {
        id: "workspace_navigation",
        parentId: "existing_nested_frame",
        transform: [1, 0, 0, 1, 24, 24],
        size: { width: 120, height: 80 },
      },
    });
    coordinator.recordDesignApplyCompleted(
      context.runId,
      logicalRegionWrite,
      resolvedLogicalRegion,
      1,
    );
    coordinator.handleAgentEvent({
      type: "tool.completed",
      runId: context.runId,
      toolCallId: "tool_existing_logical_region",
      result: { ok: true },
      revision: 1,
    });
    const contextAtRevision1 = { ...context, revision: 1 };
    expect(
      coordinator.recordCanvasCapture(
        contextAtRevision1,
        1,
        cleanLayoutQuality(
          context.documentId,
          pageId,
          "existing_artboard",
          1,
          existingPlan.targets[0].qualityProfile,
        ),
      ),
    ).toMatchObject({
      reviewEligible: true,
      deliveryTargetId: "workspace",
    });
    coordinator.registerVisualReview(contextAtRevision1, visualReview);
    const refinement: DesignApplyToolInput = {
      label: "Refine existing logical region",
      commands: [
        {
          commandId: "refine_workspace_navigation",
          type: "update_properties",
          nodeId: "workspace_navigation",
          opacity: 0.96,
        },
      ],
    };
    const refinementAuthorization = coordinator.assertDesignPlanForApply(
      contextAtRevision1,
      refinement,
    );
    coordinator.recordDesignApplyCompleted(
      context.runId,
      refinement,
      refinementAuthorization,
      2,
    );
    coordinator.handleAgentEvent({
      type: "tool.completed",
      runId: context.runId,
      toolCallId: "tool_existing_refinement",
      result: { ok: true },
      revision: 2,
    });
    const verifiedDocument = withExistingArtboard(opened.document, pageId);
    const existingNested = verifiedDocument.nodesById.existing_nested_frame;
    const logicalRegionCommand = logicalRegionWrite.commands[0];
    if (
      !existingNested ||
      !logicalRegionCommand ||
      logicalRegionCommand.type !== "insert_element"
    ) {
      throw new Error("Existing logical region fixture is invalid");
    }
    verifiedDocument.revision = 2;
    existingNested.childIds.push(logicalRegionCommand.node.id);
    verifiedDocument.nodesById[logicalRegionCommand.node.id] = structuredClone(
      logicalRegionCommand.node,
    );
    const contextAtRevision2 = { ...context, revision: 2 };
    coordinator.recordDocumentInspection(
      contextAtRevision2,
      inspectionResult(verifiedDocument, pageId),
    );
    expect(
      coordinator.recordCanvasCapture(
        contextAtRevision2,
        2,
        diagnoseDesignTargetLayout(
          verifiedDocument,
          pageId,
          "existing_artboard",
          existingPlan.targets[0].qualityProfile,
        ),
        independentCritic(2, true),
      ),
    ).toMatchObject({
      verified: true,
      nextAction: "complete-delivery",
    });
    expect(() =>
      coordinator.assertDesignPlanForImagePlacement(
        contextAtRevision2,
        "hero",
        "existing_nested_frame",
      ),
    ).toThrow("design_workflow.delivery_already_verified");
    expect(() =>
      coordinator.assertDesignPlanForApply(
        contextAtRevision2,
        insertExistingChild(pageId, null, "scattered_existing_child"),
      ),
    ).toThrow("outside the planned artboard Frame");

    store.close();
  });

  it("tracks replacement subtree IDs immediately and reconciles them from inspection", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const document = withExistingArtboard(opened.document, pageId);
    const nested = document.nodesById.existing_nested_frame;
    if (!nested || nested.kind !== "frame") {
      throw new Error("Existing nested Frame fixture is missing");
    }
    nested.childIds = ["old_mark"];
    document.nodesById.old_mark = {
      id: "old_mark",
      kind: "rectangle",
      name: "Old mark",
      parentId: nested.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 16, 16],
      size: { width: 40, height: 40 },
      exportSettings: [],
      opacity: 1,
      properties: {
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 8,
      },
      extensions: {},
    };
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_replace_descendants",
      sessionId: "conversation_mobile",
      prompt: "Replace the existing nested design",
      documentId: file.documentId,
      revision: document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_replace_descendants",
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
    coordinator.registerDesignPlan(context, existingArtboardPlan(pageId));
    const replacement: DesignApplyToolInput = {
      label: "Replace nested design",
      commands: [
        {
          commandId: "replace_nested_design",
          type: "replace_subtree",
          rootNodeId: "existing_nested_frame",
          nodes: [
            {
              ...structuredClone(nested),
              childIds: ["replacement_mark"],
            },
            {
              id: "replacement_mark",
              kind: "rectangle",
              name: "Replacement mark",
              parentId: "existing_nested_frame",
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, 24, 24],
              size: { width: 56, height: 56 },
              exportSettings: [],
              opacity: 1,
              properties: {
                fills: [{ type: "solid", color: "#756DFF", opacity: 1 }],
                strokes: [],
                strokeWidth: 0,
                cornerRadius: 12,
              },
              extensions: {},
            },
          ],
        },
      ],
    };
    const authorization = coordinator.assertDesignPlanForApply(
      context,
      replacement,
    );
    coordinator.recordDesignApplyCompleted(
      context.runId,
      replacement,
      authorization,
      1,
    );
    coordinator.handleAgentEvent({
      type: "tool.completed",
      runId: context.runId,
      toolCallId: "replace_nested_design",
      result: { ok: true },
      revision: 1,
    });
    const contextAtRevision1 = { ...context, revision: 1 };
    const updateReplacement: DesignApplyToolInput = {
      label: "Update replacement",
      commands: [
        {
          commandId: "solid_mark",
          type: "update_properties",
          nodeId: "replacement_mark",
          opacity: 0.9,
        },
      ],
    };
    expect(() =>
      coordinator.assertDesignPlanForApply(
        contextAtRevision1,
        updateReplacement,
      ),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDesignPlanForApply(contextAtRevision1, {
        label: "Update stale replacement",
        commands: [
          {
            commandId: "stale_mark",
            type: "update_properties",
            nodeId: "old_mark",
            opacity: 0.9,
          },
        ],
      }),
    ).toThrow("outside every declared delivery artboard");

    const replacedDocument = structuredClone(document);
    replacedDocument.revision = 1;
    const replacementCommand = replacement.commands[0];
    if (!replacementCommand || replacementCommand.type !== "replace_subtree") {
      throw new Error("Replacement command fixture is invalid");
    }
    replacedDocument.nodesById.existing_nested_frame = structuredClone(
      replacementCommand.nodes[0],
    );
    delete replacedDocument.nodesById.old_mark;
    replacedDocument.nodesById.replacement_mark = structuredClone(
      replacementCommand.nodes[1],
    );
    coordinator.recordDocumentInspection(
      contextAtRevision1,
      inspectionResult(replacedDocument, pageId),
    );
    expect(() =>
      coordinator.assertDesignPlanForApply(
        contextAtRevision1,
        updateReplacement,
      ),
    ).not.toThrow();

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
    const existingPlan = existingArtboardPlan(pageId);
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

  it("allows sequential Page lifecycle writes after one post-approval inspection", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_page_sequence",
      sessionId: "conversation_mobile",
      prompt: "Rename the current Page and create another Page",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const initialContext = {
      runId: "run_page_sequence",
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: opened.document.revision,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };

    expect(() =>
      coordinator.assertPageLifecycleInspected(initialContext),
    ).toThrow("design_workflow.inspection_required");
    coordinator.recordDocumentInspection(
      initialContext,
      inspectionResult(opened.document, pageId),
    );
    coordinator.handleAgentEvent({
      type: "tool.completed",
      runId: initialContext.runId,
      toolCallId: "rename_page",
      result: { ok: true },
      revision: 1,
      transactionId: "transaction_rename_page",
    });

    expect(() =>
      coordinator.assertPageLifecycleInspected({
        ...initialContext,
        revision: 1,
      }),
    ).not.toThrow();
    expect(() =>
      coordinator.assertDocumentInspected({ ...initialContext, revision: 1 }),
    ).toThrow("design_workflow.inspection_stale");

    store.close();
  });

  it("continues an allocated target after translation but rejects structural drift", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_allocated_recovery",
      sessionId: "conversation_mobile",
      prompt: "Design Home",
      documentId: file.documentId,
      revision: 0,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    const context = {
      runId: "run_allocated_recovery",
      sessionId: "conversation_mobile",
      documentId: file.documentId,
      revision: 0,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };
    coordinator.recordDocumentInspection(
      context,
      inspectionResult(opened.document, pageId),
    );
    const source = multiTargetPlan(pageId);
    const home = source.targets[0];
    if (!home) throw new Error("Home target is missing");
    const plan: DesignPlanToolInput = {
      ...source,
      objective: "Design Home",
      targets: [home],
    };
    coordinator.registerDesignPlan(context, plan);
    coordinator.recordDesignPlanAllocated(context.runId, [home.targetId], 1);

    const translated = withAllocatedTargets(opened.document, pageId, [home], 1);
    const frame = translated.nodesById[home.artboard.frameId];
    if (frame?.kind !== "frame") throw new Error("Allocated Frame is missing");
    frame.transform = [1, 0, 0, 1, home.artboard.x + 200, home.artboard.y + 80];
    const translatedContext = { ...context, revision: 1 };
    coordinator.handleAgentEvent({
      type: "tool.completed",
      runId: context.runId,
      toolCallId: "allocation_revision",
      result: { ok: true },
      revision: 1,
    });
    coordinator.recordDocumentInspection(
      translatedContext,
      inspectionResult(translated, pageId),
    );
    expect(() =>
      coordinator.registerDesignPlan(translatedContext, plan),
    ).not.toThrow();

    const resized = structuredClone(translated);
    const resizedFrame = resized.nodesById[home.artboard.frameId];
    if (resizedFrame?.kind !== "frame") {
      throw new Error("Allocated Frame is missing");
    }
    resizedFrame.size.width += 1;
    coordinator.recordDocumentInspection(
      translatedContext,
      inspectionResult(resized, pageId),
    );
    expect(() =>
      coordinator.registerDesignPlan(translatedContext, plan),
    ).toThrow("design_workflow.allocated_artboard_invalid");

    const deleted = structuredClone(translated);
    delete deleted.nodesById[home.artboard.frameId];
    deleted.pagesById[pageId].rootNodeIds = deleted.pagesById[
      pageId
    ].rootNodeIds.filter((nodeId) => nodeId !== home.artboard.frameId);
    coordinator.recordDocumentInspection(
      translatedContext,
      inspectionResult(deleted, pageId),
    );
    expect(() =>
      coordinator.registerDesignPlan(translatedContext, plan),
    ).toThrow("design_workflow.allocated_artboard_invalid");

    store.close();
  });

  it("moves the active Conversation to the front when a new Run starts", async () => {
    const { store, host, file, opened, pageId } = await setup();
    store.createConversation({
      conversationId: "conversation_recent",
      originProjectId: "project_acme",
      filedProjectId: "project_acme",
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
        .listConversations()
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
      coordinator.assertPageToolAccess(context, {
        action: "clear",
        pageId,
      }),
    ).not.toThrow();
    expect(() =>
      coordinator.assertPageToolAccess(context, { action: "create" }),
    ).toThrow("page_structure_access_required");
    expect(() =>
      coordinator.assertComponentToolAccess(context, {
        action: "create-component",
        label: "Create component",
        pageId,
        rootNodeId: "feature_group",
        componentId: "component_feature",
        name: "Feature",
      }),
    ).not.toThrow();
    expect(() =>
      coordinator.assertComponentToolAccess(context, {
        action: "create-instance",
        label: "Place component on Research",
        pageId: "page_research",
        componentId: "component_feature",
        instanceId: "instance_feature",
        parentId: null,
        index: 0,
        x: 40,
        y: 40,
      }),
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
      ["create-page", "cross-page-edit"],
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
      coordinator.registerDesignPlan(context, multiTargetPlan(pageId)),
    ).toThrow("page_creation_required");
    coordinator.recordPageToolCompleted(context.runId, "create");
    expect(() =>
      coordinator.registerDesignPlan(context, crossPagePlan),
    ).not.toThrow();
    expect(() =>
      coordinator.assertPageToolAccess(context, { action: "create" }),
    ).not.toThrow();
    expect(() =>
      coordinator.assertComponentToolAccess(context, {
        action: "create-instance",
        label: "Place component on Research",
        pageId: "page_research",
        componentId: "component_feature",
        instanceId: "instance_feature",
        parentId: null,
        index: 0,
        x: 40,
        y: 40,
      }),
    ).not.toThrow();

    coordinator.supersedeDesignDeliveryForClearedPage(context, pageId);
    expect(coordinator.getDeliveryLedger(context.runId)).toBeUndefined();
    expect(
      store.listGlobalTasks().find((task) => task.runId === context.runId)
        ?.delivery,
    ).toBeUndefined();

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

  it("keeps a structured provider failure recoverable until Run continuation", async () => {
    const { store, host, file, opened, pageId } = await setup();
    const coordinator = new GlobalTaskCoordinator(host, store);
    await coordinator.registerRun({
      type: "run.start",
      runId: "run_retryable",
      sessionId: "conversation_mobile",
      prompt: "Build the complete page",
      documentId: file.documentId,
      revision: opened.document.revision,
      modelSelection,
      scope: { kind: "page", pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId },
    });
    coordinator.handleAgentEvent({
      type: "agent.error",
      runId: "run_retryable",
      code: "provider_timeout",
      message: "Provider timed out",
      failure: {
        code: "provider_timeout",
        message: "Provider timed out",
        retryable: true,
      },
    });
    expect(store.listGlobalTasks()[0]?.lifecycle).toBe("failed");

    coordinator.handleAgentEvent({
      type: "run.continuation",
      runId: "run_retryable",
      status: "scheduled",
      attempt: 1,
      maxAttempts: 3,
      reason: "retryable-error",
      nextRunId: "run_retryable_next",
    });

    expect(store.listGlobalTasks()[0]?.lifecycle).toBe("interrupted");
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
