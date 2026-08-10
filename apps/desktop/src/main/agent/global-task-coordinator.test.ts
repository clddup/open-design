import { createStarterProjectFiles } from "../../shared/project/starter-project.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectHost } from "../project/project-host.js";
import { WorkspaceStore } from "../project/workspace-store.js";
import { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import type {
  DesignApplyToolInput,
  DesignPlanToolInput,
} from "../../shared/design-agent-tools.js";

const modelSelection = {
  providerId: "provider_1",
  modelId: "design-model",
  reasoningEffort: "medium" as const,
};

const designPlan: DesignPlanToolInput = {
  pageId: "page_welcome",
  deliverable: "ui",
  objective: "Design a polished product workspace",
  outputMode: "editable-composition",
  artboard: {
    mode: "create",
    frameId: "workspace_artboard",
    width: 1440,
    height: 1024,
  },
  composition: {
    direction: "Dense desktop workspace with a dominant primary work area",
    hierarchy: ["Navigation", "Primary work area", "Contextual inspector"],
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
    coordinator.recordDocumentInspection(context);
    coordinator.registerDesignPlan(context, { ...designPlan, pageId });
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
    ).toThrow("planned Page-root Frame");

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
            transform: [1, 0, 0, 1, 0, 0],
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
    expect(() =>
      coordinator.assertDesignPlanForApply(context, plannedDraft),
    ).not.toThrow();
    coordinator.recordDesignApplyCompleted(context.runId, plannedDraft);
    coordinator.recordCanvasCapture(context);
    expect(() => coordinator.assertVisualReviewBeforeWrite(context)).toThrow(
      "structured visual review",
    );
    coordinator.registerVisualReview(context, visualReview);
    expect(() =>
      coordinator.assertVisualReviewBeforeWrite(context),
    ).not.toThrow();
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
