import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import { handleDesignStructureTool } from "./design-structure-tool-handler.js";

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

describe("design structure Main tool boundary", () => {
  it("returns the structured Contract error before executing invalid input", async () => {
    const execute =
      vi.fn<(call: ToolCallRequest) => Promise<TrustedToolResult>>();
    await expect(
      handleDesignStructureTool({
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

  it("executes a canonical clone and records created structure", async () => {
    const sourceInput = {
      action: "group",
      label: "Group logo",
      pageId: "page_1",
      nodeIds: ["mark", "wordmark"],
      groupId: "logo_lockup",
      name: "Logo lockup",
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
      handleDesignStructureTool({
        call: {
          toolCallId: "call_group",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: sourceInput,
        },
        context,
        coordinator: taskCoordinator as unknown as GlobalTaskCoordinator,
        execute,
        withDelivery: (value) => value,
      }),
    ).resolves.toBe(result);
    const executed = execute.mock.calls[0]?.[0];
    expect(executed?.input).toEqual(sourceInput);
    expect(executed?.input).not.toBe(sourceInput);
    expect(taskCoordinator.resolveMaterialTargetIds).toHaveBeenCalledWith(
      context,
      ["mark", "wordmark"],
      undefined,
    );
    expect(
      taskCoordinator.recordMaterialDesignWriteCompleted,
    ).toHaveBeenCalledWith("run_1", ["target_1"], 1, ["logo_lockup"]);
  });

  it("preserves reparent, cross-layer, Mask, and Boolean target bookkeeping", async () => {
    const cases = [
      {
        toolName: DESIGN_HIERARCHY_TOOL_NAME,
        input: {
          action: "reparent",
          label: "Move logo",
          pageId: "page_1",
          nodeIds: ["mark", "wordmark"],
          parentId: "delivery_frame",
          index: 2,
        },
        nodeIds: ["mark", "wordmark"],
        parentId: "delivery_frame",
        created: [],
      },
      {
        toolName: DESIGN_VECTOR_TOOL_NAME,
        input: {
          action: "transform-layers-vertices",
          label: "Scale logo layers",
          pageId: "page_1",
          targets: [
            { nodeId: "mark", vertexIds: ["vertex_mark"] },
            { nodeId: "shadow", vertexIds: ["vertex_shadow"] },
          ],
          transform: [1, 0, 0, 1, 8, 8],
        },
        nodeIds: ["mark", "shadow"],
        parentId: undefined,
        created: [],
      },
      {
        toolName: DESIGN_HIERARCHY_TOOL_NAME,
        input: {
          action: "create-mask",
          label: "Mask portrait",
          pageId: "page_1",
          nodeIds: ["mask_shape", "portrait"],
          groupId: "portrait_mask",
          name: "Portrait mask",
          maskType: "alpha",
        },
        nodeIds: ["mask_shape", "portrait"],
        parentId: undefined,
        created: ["portrait_mask"],
      },
      {
        toolName: DESIGN_HIERARCHY_TOOL_NAME,
        input: {
          action: "create-boolean",
          label: "Create logo cutout",
          pageId: "page_1",
          nodeIds: ["mark_body", "mark_cutout"],
          booleanId: "mark_boolean",
          name: "Logo mark",
          operation: "subtract",
        },
        nodeIds: ["mark_body", "mark_cutout"],
        parentId: undefined,
        created: ["mark_boolean"],
      },
    ] as const;

    for (const [index, entry] of cases.entries()) {
      const taskCoordinator = coordinatorMocks();
      const result: TrustedToolResult = { content: { ok: true } };
      await handleDesignStructureTool({
        call: {
          toolCallId: `call_${index}`,
          toolName: entry.toolName,
          input: entry.input,
        },
        context,
        coordinator: taskCoordinator as unknown as GlobalTaskCoordinator,
        execute: () => Promise.resolve(result),
        withDelivery: (value) => value,
      });
      expect(taskCoordinator.resolveMaterialTargetIds).toHaveBeenCalledWith(
        context,
        entry.nodeIds,
        entry.parentId,
      );
      expect(
        taskCoordinator.recordMaterialDesignWriteCompleted,
      ).toHaveBeenCalledWith("run_1", ["target_1"], undefined, entry.created);
    }
  });
});
