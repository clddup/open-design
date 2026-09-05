import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentRequest,
  TrustedToolContext,
} from "@opendesign/agent-contracts";
import type { DesignDocument } from "@opendesign/design-contracts";
import { createStarterProjectFiles } from "@/shared/project/starter-project.js";
import { createAgentDesignIdAllocation } from "@/shared/design-id-allocation.js";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  type DesignDeliveryScope,
} from "@/shared/design-agent-tools.js";
import { ProjectHost } from "../project/project-host.js";
import { WorkspaceStore } from "../project/workspace-store.js";
import { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import { createDesignCaptureReviewSession } from "./design-capture-review-tool-handler.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;
const resources: { store: WorkspaceStore; root: string }[] = [];
afterEach(async () => {
  for (const { store, root } of resources.splice(0)) {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function setup() {
  const store = new WorkspaceStore(":memory:");
  const host = new ProjectHost(store);
  const root = await mkdtemp(join(tmpdir(), "opendesign-clear-scope-"));
  resources.push({ store, root });
  const [first] = createStarterProjectFiles("clear_scope");
  const [second] = createStarterProjectFiles("other_document");
  const document = first.document;
  const pageId = document.pageOrder[0];
  document.pageOrder.push("page_other");
  document.pagesById.page_other = {
    id: "page_other",
    name: "Other",
    rootNodeIds: [],
    extensions: {},
  };
  second.descriptor.relativePath = "designs/other.opendesign";
  const manifest = await host.createProject(
    join(root, "Project"),
    {
      projectId: "clear_scope",
      name: "Clear scope",
    },
    [first, second],
  );
  store.createConversation({
    conversationId: "conversation_clear",
    originProjectId: manifest.projectId,
    filedProjectId: manifest.projectId,
    title: "Clear scope",
    lifecycle: "active",
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  });
  return {
    store,
    document,
    otherDocument: second.document,
    pageId,
    coordinator: new GlobalTaskCoordinator(
      host,
      store,
      () => new Date("2026-09-06T01:00:00.000Z"),
    ),
  };
}

function request(
  document: DesignDocument,
  runId: string,
  pageId = document.pageOrder[0],
): RunStartRequest {
  return {
    type: "run.start",
    runId,
    sessionId: "conversation_clear",
    prompt: "Clear and redesign the requested Page",
    documentId: document.documentId,
    revision: document.revision,
    modelSelection: { providerId: "provider", modelId: "model" },
    scope: { kind: "page", pageId, selectedNodeIds: [] },
    mutationTarget: { kind: "page", pageId },
  };
}

function inspection(document: DesignDocument, runId: string) {
  return {
    observedRevision: document.revision,
    content: {
      document: {
        ...structuredClone(document),
        imageAssetDerivations: [],
        imageAssetDerivationsTruncated: false,
      },
      idAllocation: createAgentDesignIdAllocation(runId),
    },
  };
}

async function register(
  coordinator: GlobalTaskCoordinator,
  document: DesignDocument,
  run: RunStartRequest,
) {
  await coordinator.registerRun(run);
  coordinator.recordDocumentInspection(run, inspection(document, run.runId));
  return run;
}

function reserve(
  coordinator: GlobalTaskCoordinator,
  context: TrustedToolContext,
  targetId = "old_target",
) {
  const scope: DesignDeliveryScope = {
    version: 1,
    deliverable: "ui",
    objective: `Design ${targetId}`,
    targets: [
      {
        targetId,
        label: targetId,
        objective: `Design ${targetId}`,
        requiredContent: ["Main content"],
        artboard: { width: 800, height: 600 },
      },
    ],
    exclusions: [],
    assumptions: [],
  };
  const reservation = coordinator.createDeliveryScopeReservation(
    context,
    scope,
  );
  return coordinator.recordDeliveryScopeCompleted(context, scope, reservation);
}

async function capture(
  coordinator: GlobalTaskCoordinator,
  document: DesignDocument,
  context: TrustedToolContext,
) {
  const session = createDesignCaptureReviewSession({
    coordinator,
    context,
    signal: new AbortController().signal,
    execute: (call) =>
      Promise.resolve(
        call.toolName === DESIGN_CAPTURE_TOOL_NAME
          ? {
              observedRevision: document.revision,
              content: {
                attachment: {
                  attachmentId: "capture",
                  name: "Page capture",
                  mimeType: "image/jpeg",
                  byteSize: 1,
                },
              },
            }
          : inspection(document, context.runId),
      ),
    getModelProviderHost: () => {
      throw new Error("A cleared Page must not require a visual critic");
    },
  });
  return session.capture({
    toolCallId: "capture_cleared",
    toolName: DESIGN_CAPTURE_TOOL_NAME,
    input: {},
  });
}

describe("Main Page clear delivery scope", () => {
  it("clears reservations without a Plan, does not resurrect them on capture, and accepts a new scope", async () => {
    const { coordinator, store, document, pageId } = await setup();
    const context = await register(
      coordinator,
      document,
      request(document, "run_clear"),
    );
    reserve(coordinator, context);
    expect(coordinator.getDeliveryStageContext(context.runId)).toMatchObject({
      plannedTargets: 0,
      totalTargets: 1,
    });

    expect(
      coordinator.supersedeDesignDeliveryForClearedPage(context, pageId),
    ).toBe(true);
    expect(coordinator.getDeliveryLedger(context.runId)).toBeUndefined();
    expect(coordinator.getDeliveryStageContext(context.runId)).toBeUndefined();
    expect(
      store.listGlobalTasks().find((task) => task.runId === context.runId)
        ?.delivery,
    ).toBeUndefined();
    const result = await capture(coordinator, document, context);
    expect(result.content).toMatchObject({
      delivery: undefined,
      deliveryStage: undefined,
    });

    reserve(coordinator, context, "new_target");
    const newCapture = await capture(coordinator, document, context);
    expect(newCapture.content).toMatchObject({
      delivery: { targets: [{ targetId: "new_target" }] },
      deliveryStage: { totalTargets: 1 },
    });
    expect(coordinator.getDeliveryLedger(context.runId)?.targets).toHaveLength(
      1,
    );
  });

  it("preserves other Runs including another Page, document and a peer on the same Page", async () => {
    const { coordinator, store, document, otherDocument, pageId } =
      await setup();
    const context = await register(
      coordinator,
      document,
      request(document, "run_clear"),
    );
    reserve(coordinator, context);
    const peers = [
      [document, request(document, "run_other_page", "page_other")],
      [otherDocument, request(otherDocument, "run_other_document")],
      [document, request(document, "run_same_page")],
    ] as const;
    for (const [source, run] of peers) {
      await register(coordinator, source, run);
      reserve(coordinator, run, run.runId);
    }
    const before = store
      .listGlobalTasks()
      .filter((task) => task.runId !== context.runId);

    coordinator.supersedeDesignDeliveryForClearedPage(context, pageId);

    expect(
      store.listGlobalTasks().filter((task) => task.runId !== context.runId),
    ).toEqual(before);
    for (const [, run] of peers) {
      expect(
        coordinator.getDeliveryLedger(run.runId)?.targets[0]?.targetId,
      ).toBe(run.runId);
      expect(coordinator.getDeliveryStageContext(run.runId)?.totalTargets).toBe(
        1,
      );
    }
  });

  it("preserves a document-scoped Run's delivery when a different Page is cleared", async () => {
    const { coordinator, store, document } = await setup();
    const run = {
      ...request(document, "run_document"),
      mutationTarget: { kind: "document" as const },
    };
    const context = await register(coordinator, document, run);
    reserve(coordinator, context);
    const before = store.listGlobalTasks();

    expect(
      coordinator.supersedeDesignDeliveryForClearedPage(context, "page_other"),
    ).toBe(false);

    expect(
      coordinator.getDeliveryLedger(context.runId)?.targets[0]?.targetId,
    ).toBe("old_target");
    expect(
      coordinator.getDeliveryStageContext(context.runId)?.totalTargets,
    ).toBe(1);
    expect(store.listGlobalTasks()).toEqual(before);
  });

  it("clears the continuation's matching parent recovery without reviving its reservations", async () => {
    const { coordinator, document, pageId, store } = await setup();
    const parent = await register(
      coordinator,
      document,
      request(document, "run_parent"),
    );
    reserve(coordinator, parent);
    coordinator.handleAgentEvent({
      type: "run.continuation",
      runId: parent.runId,
      status: "scheduled",
      nextRunId: "run_child",
      attempt: 1,
      maxAttempts: 3,
      reason: "budget",
    });
    coordinator.handleAgentEvent({
      type: "run.completed",
      runId: parent.runId,
      finishedAt: "2026-09-06T01:00:00.000Z",
      stopReason: "budget",
    });
    const child = await register(coordinator, document, {
      ...request(document, "run_child"),
      continuation: {
        parentRunId: parent.runId,
        rootRunId: parent.runId,
        attempt: 1,
        maxAttempts: 3,
        reason: "budget",
      },
    });

    coordinator.supersedeDesignDeliveryForClearedPage(child, pageId);

    expect(coordinator.getRecoverableDelivery(child)).toBeUndefined();
    expect(
      store.listGlobalTasks().find((task) => task.runId === parent.runId)
        ?.delivery,
    ).toBeUndefined();
    expect((await capture(coordinator, document, child)).content).toMatchObject(
      { delivery: undefined, deliveryStage: undefined },
    );
    reserve(coordinator, child, "replacement_target");
  });
});
