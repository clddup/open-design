import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { ToolCallRequest } from "@opendesign/agent-contracts";
import { EditorRuntime } from "@opendesign/editor-runtime";
import { executeDesignToolRequest } from "@/renderer/features/design-tools/design-tool-execution";
import { createStarterProjectFiles } from "@/shared/project/starter-project";
import { createAgentDesignIdAllocation } from "@/shared/design-id-allocation";
import { ProjectHost } from "../project/project-host";
import { WorkspaceStore } from "../project/workspace-store";
import { GlobalTaskCoordinator } from "./global-task-coordinator";
import { parseDesignToolInput } from "./design-tool-input-parser";
import { dispatchDesignGenerationOrCapture } from "./design-generation-dispatcher";
import { handleDesignGenerationTool } from "./design-generation-tool-handler";
import { handleEditDesignTool } from "./design-edit-tool-handler";

it("commits authored groups and sibling order unchanged, supports the next edit and undoes each batch", async () => {
  const store = new WorkspaceStore(":memory:");
  const root = await mkdtemp(
    join(tmpdir(), "opendesign-generation-hierarchy-"),
  );
  try {
    const host = new ProjectHost(store);
    const manifest = await host.createProject(
      join(root, "Design"),
      { projectId: "project", name: "Design" },
      createStarterProjectFiles("project"),
    );
    const file = manifest.designFiles[0];
    const { document } = await host.readDesignFile(
      manifest.projectId,
      file.designFileId,
    );
    const pageId = document.pageOrder[0];
    store.createConversation({
      conversationId: "conversation",
      originProjectId: "project",
      filedProjectId: "project",
      title: "Design",
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
      lifecycle: "active",
    });
    const runtime = new EditorRuntime(document);
    const coordinator = new GlobalTaskCoordinator(host, store);
    let context = {
      runId: "run",
      sessionId: "conversation",
      documentId: document.documentId,
      revision: document.revision,
      scope: { kind: "page" as const, pageId, selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId },
    };
    await coordinator.registerRun({
      type: "run.start",
      ...context,
      prompt: "Create a poster",
      modelSelection: { providerId: "mock", modelId: "mock" },
    });
    coordinator.recordDocumentInspection(context, {
      observedRevision: document.revision,
      content: {
        idAllocation: createAgentDesignIdAllocation(context.runId),
        document: {
          ...document,
          assetsById: {},
          imageAssetDerivations: [],
          imageAssetDerivationsTruncated: false,
        },
      },
    });
    const execute = async (call: ToolCallRequest) => {
      const response = await executeDesignToolRequest(
        { requestId: call.toolCallId, call, context },
        runtime,
        pageId,
      );
      if (!response.ok) throw new Error(response.error.message);
      return response.result;
    };
    const call = {
      toolCallId: "generate",
      toolName: "opendesign_generate_design",
      input: composition(),
    };
    const parsed = parseDesignToolInput(coordinator, call, context);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const captureReview = { handle: vi.fn(() => Promise.resolve(null)) };
    const first = await dispatchDesignGenerationOrCapture(call, {
      generate: () =>
        handleDesignGenerationTool(
          coordinator,
          { execute } as never,
          { ...call, input: parsed.value },
          context,
          context,
          new AbortController().signal,
        ),
      captureReview,
    });
    if (!first) throw new Error("Expected committed generation");
    expect(captureReview.handle).not.toHaveBeenCalled();
    expect(first.designRevision?.revision).toBe(document.revision + 1);
    const snapshot = runtime.getSnapshot().document;
    const ledger = coordinator.getDeliveryLedger(context.runId)!;
    const artboard = snapshot.nodesById[ledger.targets[0].rootNodeId];
    expect(artboard.childIds.map((id) => snapshot.nodesById[id].name)).toEqual([
      "Background",
      "Authored group",
      "Foreground",
    ]);
    const group = snapshot.nodesById[artboard.childIds[1]];
    expect(group.kind).toBe("group");
    expect(group.transform).toEqual([1, 0, 0, 1, 64, 48]);
    expect(group.childIds.map((id) => snapshot.nodesById[id].name)).toEqual([
      "Child",
    ]);
    expect(Object.keys(snapshot.nodesById)).toHaveLength(
      Object.keys(document.nodesById).length + 5,
    );
    expect(
      ledger.planExecution?.targets[0].steps.map((step) => step.status),
    ).toEqual(["in_progress", "pending"]);

    context = { ...context, revision: first.designRevision!.revision };
    coordinator.handleAgentEvent({
      type: "tool.completed",
      runId: context.runId,
      toolCallId: call.toolCallId,
      revision: context.revision,
      result: first.content,
    });
    const second = await handleEditDesignTool({
      context,
      coordinator,
      execute,
      withDelivery: (value) => value,
      call: {
        toolCallId: "edit",
        toolName: "opendesign_edit_design",
        input: {
          label: "Refine group",
          edits: [
            {
              kind: "node",
              input: {
                label: "Refine group",
                commands: [
                  {
                    commandId: "opacity",
                    type: "update_properties",
                    nodeId: group.id,
                    opacity: 0.7,
                  },
                ],
              },
            },
          ],
        },
      },
    });
    expect(second?.designRevision?.revision).toBe(context.revision + 1);
    expect(runtime.getSnapshot().document.nodesById[group.id].opacity).toBe(
      0.7,
    );
    expect(
      coordinator
        .getDeliveryLedger(context.runId)
        ?.planExecution?.targets[0].steps.map((step) => step.status),
    ).toEqual(["in_progress", "pending"]);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById[group.id].opacity).toBe(1);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById).toEqual(
      document.nodesById,
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

function composition() {
  const shape = {
    kind: "rectangle",
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    fills: [{ type: "solid", color: "#336699", opacity: 1 }],
  };
  return {
    deliverable: "poster",
    targets: [{ frame: { width: 800, height: 600 } }],
    rasterAssetRoles: [],
    designGeneration: {
      label: "Create poster",
      elements: [
        { ...shape, id: "background", name: "Background" },
        {
          ...shape,
          id: "group",
          name: "Authored group",
          kind: "group",
          x: 64,
          y: 48,
          fills: [],
        },
        { ...shape, id: "child", name: "Child", parentId: "group" },
        { ...shape, id: "foreground", name: "Foreground" },
      ],
    },
  };
}
