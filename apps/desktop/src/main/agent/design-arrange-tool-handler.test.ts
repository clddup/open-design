import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import { DESIGN_ARRANGE_TOOL_NAME } from "@/shared/design-agent-tools.js";
import { handleDesignArrangeTool } from "./design-arrange-tool-handler.js";

const context: TrustedToolContext = {
  runId: "run_arrange",
  sessionId: "conversation_arrange",
  documentId: "document_arrange",
  revision: 8,
  scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_1" },
};

describe("handleDesignArrangeTool", () => {
  it("parses once and records the explicit material targets", async () => {
    const call: ToolCallRequest = {
      toolCallId: "arrange_call",
      toolName: DESIGN_ARRANGE_TOOL_NAME,
      input: {
        action: "align-left",
        label: "Align navigation layers",
        pageId: "page_1",
        nodeIds: ["nav_logo", "nav_actions"],
      },
    };
    const execute = vi.fn().mockResolvedValue({
      content: { ok: true },
      designRevision: {
        previousRevision: 8,
        revision: 9,
        transactionId: "transaction_arrange",
      },
    });
    const coordinator = {
      assertVisualReviewBeforeWrite: vi.fn(),
      resolveMaterialTargetIds: vi.fn(() => ["target_navigation"]),
      recordMaterialDesignWriteCompleted: vi.fn(),
    };
    const withDelivery = vi.fn((result: TrustedToolResult) => result);

    await expect(
      handleDesignArrangeTool({
        call,
        context,
        coordinator: coordinator as never,
        execute,
        withDelivery,
      }),
    ).resolves.toMatchObject({ content: { ok: true } });
    expect(coordinator.resolveMaterialTargetIds).toHaveBeenCalledWith(context, [
      "nav_logo",
      "nav_actions",
    ]);
    expect(coordinator.recordMaterialDesignWriteCompleted).toHaveBeenCalledWith(
      context.runId,
      ["target_navigation"],
      9,
      [],
    );
  });

  it("rejects invalid action fields before Renderer execution", async () => {
    const execute = vi.fn();
    await expect(
      handleDesignArrangeTool({
        call: {
          toolCallId: "arrange_call_invalid",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "repair-overflow",
            label: "Repair overflow",
            pageId: "page_1",
            width: 1200,
          },
        },
        context,
        coordinator: {} as never,
        execute,
        withDelivery: vi.fn(),
      }),
    ).rejects.toThrow("design_arrange.schema_invalid at /frameId");
    expect(execute).not.toHaveBeenCalled();
  });
});
