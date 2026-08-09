import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import type { RendererDesignToolRequest } from "../shared/design-tool-bridge";
import { executeDesignToolRequest } from "./design-tool-execution";

const selectionContext = {
  runId: "run_1",
  sessionId: "conversation_1",
  documentId: "document_welcome",
  revision: 0,
  scope: {
    kind: "selection" as const,
    pageId: "page_welcome",
    selectedNodeIds: ["feature_one"],
    primaryNodeId: "feature_one",
  },
};

describe("Renderer design tool scope", () => {
  it("refreshes a stale read context but still rejects a stale write", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const applied = runtime.apply({
      transactionId: "transaction_user_1",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "user", id: "local-user" },
      label: "User edit while the Agent is thinking",
      commands: [
        {
          commandId: "rename_feature",
          type: "update_properties",
          nodeId: "feature_one",
          name: "New live state",
        },
      ],
    });
    expect(applied.ok).toBe(true);

    const inspection = await executeDesignToolRequest(
      {
        requestId: "inspect_refresh",
        call: {
          toolCallId: "tool_inspect_refresh",
          toolName: "opendesign_inspect_document",
          input: {},
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
    );
    expect(inspection.ok).toBe(true);
    if (inspection.ok) expect(inspection.result.observedRevision).toBe(1);

    await expect(
      executeDesignToolRequest(
        {
          requestId: "apply_stale",
          call: {
            toolCallId: "tool_apply_stale",
            toolName: "opendesign_apply_transaction",
            input: {
              label: "Stale write",
              commands: [
                {
                  commandId: "stale_rename",
                  type: "update_properties",
                  nodeId: "feature_one",
                  name: "Should not apply",
                },
              ],
            },
          },
          context: selectionContext,
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("expected 0, current 1");
  });

  it("returns only the registered selection subtree", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "inspect_1",
        call: {
          toolCallId: "tool_1",
          toolName: "opendesign_inspect_document",
          input: {},
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
    );

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const serialized = JSON.stringify(response.result.content);
    expect(serialized).toContain('"feature_one"');
    expect(serialized).not.toContain('"title_welcome"');
    expect(serialized).not.toContain('"feature_two"');
  });

  it("rejects a write outside the registered selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const request: RendererDesignToolRequest = {
      requestId: "apply_1",
      call: {
        toolCallId: "tool_1",
        toolName: "opendesign_apply_transaction",
        input: {
          label: "Rename an unrelated node",
          commands: [
            {
              commandId: "rename_title",
              type: "update_properties",
              nodeId: "title_welcome",
              name: "Out of scope",
            },
          ],
        },
      },
      context: selectionContext,
    };

    await expect(
      executeDesignToolRequest(request, runtime, "page_welcome"),
    ).rejects.toThrow("exceeds the registered selection scope");
    expect(runtime.getSnapshot().document.revision).toBe(0);
    expect(runtime.getSnapshot().document.nodesById.title_welcome?.name).toBe(
      "Title",
    );
  });

  it("applies a write inside the registered selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "apply_1",
        call: {
          toolCallId: "tool_1",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Rename selected card",
            commands: [
              {
                commandId: "rename_card",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Selected card",
              },
            ],
          },
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
    );

    expect(response.ok).toBe(true);
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Selected card",
    );
  });

  it("renders a large tool transaction in visible stages with one undo entry", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = executeDesignToolRequest(
      {
        requestId: "apply_progressive",
        call: {
          toolCallId: "tool_progressive",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Refine selected card progressively",
            commands: [
              {
                commandId: "progressive_name_first",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Visible first stage",
              },
              {
                commandId: "progressive_opacity",
                type: "update_properties",
                nodeId: "feature_one",
                opacity: 0.85,
              },
              {
                commandId: "progressive_size",
                type: "update_properties",
                nodeId: "feature_one",
                size: { width: 260, height: 128 },
              },
              {
                commandId: "progressive_name_final",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Finished card",
              },
            ],
          },
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
      { stageDelayMs: 0 },
    );

    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Visible first stage",
    );

    const completed = await response;
    expect(completed).toMatchObject({
      ok: true,
      result: {
        content: { revision: 2, stages: 2 },
        designRevision: { previousRevision: 0, revision: 2 },
      },
    });
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Finished card",
    );
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);

    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Structured editing",
    );
  });

  it("rolls back every visible stage when generation is cancelled", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const controller = new AbortController();
    const response = executeDesignToolRequest(
      {
        requestId: "apply_cancelled",
        call: {
          toolCallId: "tool_cancelled",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Cancelled card refinement",
            commands: [
              {
                commandId: "cancelled_name_first",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Temporary stage",
              },
              {
                commandId: "cancelled_opacity",
                type: "update_properties",
                nodeId: "feature_one",
                opacity: 0.75,
              },
              {
                commandId: "cancelled_size",
                type: "update_properties",
                nodeId: "feature_one",
                size: { width: 280, height: 144 },
              },
              {
                commandId: "cancelled_name_final",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Must not remain",
              },
            ],
          },
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
      { signal: controller.signal },
    );

    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Temporary stage",
    );
    controller.abort();
    await expect(response).rejects.toMatchObject({ name: "AbortError" });

    const snapshot = runtime.getSnapshot();
    expect(snapshot.document.nodesById.feature_one?.name).toBe(
      "Structured editing",
    );
    expect(snapshot.state.history.canUndo).toBe(false);
    expect(snapshot.state.dirty).toBe(false);
  });
});
