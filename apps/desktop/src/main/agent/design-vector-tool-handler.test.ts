import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import { DESIGN_VECTOR_TOOL_NAME } from "@/shared/design-agent-tools.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import { handleDesignVectorTool } from "./design-vector-tool-handler.js";

const context: TrustedToolContext = {
  runId: "run_1",
  sessionId: "conversation_1",
  documentId: "document_1",
  revision: 0,
  scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_1" },
};

function coordinatorMocks() {
  return {
    assertVisualReviewBeforeWrite: vi.fn(),
    resolveMaterialTargetIds: vi.fn(() => ["target_1"]),
    recordMaterialDesignWriteCompleted: vi.fn(),
  };
}

describe("design vector Main tool boundary", () => {
  it("returns the structured Contract error before executing invalid input", async () => {
    const execute =
      vi.fn<(call: ToolCallRequest) => Promise<TrustedToolResult>>();
    await expect(
      handleDesignVectorTool({
        call: {
          toolCallId: "call_invalid_vector",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "cut-path",
            label: "Cut logo",
            pageId: "page_1",
            nodeId: "logo_path",
            pathId: "outer_path",
            at: { kind: "segment", segmentId: "curve" },
          },
        },
        context,
        coordinator: coordinatorMocks() as unknown as GlobalTaskCoordinator,
        execute,
        withDelivery: (result) => result,
      }),
    ).rejects.toThrow(/design_vector\.schema_invalid at \/at\/t/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("records all cross-layer vector targets as one material write", async () => {
    const sourceInput = {
      action: "transform-layers-vertices",
      label: "Scale logo layers",
      pageId: "page_1",
      targets: [
        { nodeId: "mark", vertexIds: ["vertex_mark"] },
        { nodeId: "shadow", vertexIds: ["vertex_shadow"] },
      ],
      transform: [1, 0, 0, 1, 8, 8],
    } as const;
    const result: TrustedToolResult = {
      content: { ok: true },
      designRevision: {
        previousRevision: 0,
        revision: 1,
        transactionId: "transaction_1",
      },
    };
    const execute = vi.fn((call: ToolCallRequest) => {
      void call;
      return Promise.resolve(result);
    });
    const taskCoordinator = coordinatorMocks();

    await expect(
      handleDesignVectorTool({
        call: {
          toolCallId: "call_transform_layers",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: sourceInput,
        },
        context,
        coordinator: taskCoordinator as unknown as GlobalTaskCoordinator,
        execute,
        withDelivery: (value) => value,
      }),
    ).resolves.toBe(result);
    expect(execute.mock.calls[0]?.[0].input).toEqual(sourceInput);
    expect(taskCoordinator.resolveMaterialTargetIds).toHaveBeenCalledWith(
      context,
      ["mark", "shadow"],
      undefined,
    );
    expect(
      taskCoordinator.recordMaterialDesignWriteCompleted,
    ).toHaveBeenCalledWith("run_1", ["target_1"], 1, []);
  });
});
