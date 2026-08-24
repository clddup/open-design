import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DESIGN_STYLE_TOOL_NAME,
  DESIGN_VARIABLE_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import { handleDesignSystemTool } from "./design-system-tool-handler.js";

const context: TrustedToolContext = {
  runId: "run_1",
  sessionId: "conversation_1",
  documentId: "document_1",
  revision: 0,
  scope: {
    kind: "page",
    pageId: "page_1",
    selectedNodeIds: [],
  },
  mutationTarget: { kind: "page", pageId: "page_1" },
};

function coordinator() {
  return {
    assertDocumentInspected: vi.fn(),
    assertVisualReviewBeforeWrite: vi.fn(),
    resolveMaterialTargetIdsIfPlanned: vi.fn(() => []),
    recordMaterialDesignWriteCompleted: vi.fn(),
  } as unknown as GlobalTaskCoordinator;
}

describe("design system Main tool boundary", () => {
  it("returns the structured Contract error before executing invalid input", async () => {
    const execute =
      vi.fn<(call: ToolCallRequest) => Promise<TrustedToolResult>>();
    await expect(
      handleDesignSystemTool({
        call: {
          toolCallId: "call_invalid_variable",
          toolName: DESIGN_VARIABLE_TOOL_NAME,
          input: {
            action: "set-mode",
            label: "Invalid mode target",
            pageId: "page_1",
            target: { kind: "node", nodeId: "title" },
            collectionId: "theme",
            modeId: "dark",
          },
        },
        context,
        coordinator: coordinator(),
        execute,
        withDelivery: (result) => result,
      }),
    ).rejects.toThrow(/design_variable\.schema_invalid at \/target\/id/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes a canonical clone to execution", async () => {
    const sourceInput = {
      action: "update-metadata",
      label: "Rename style",
      pageId: "page_1",
      styleId: "brand",
      name: "Brand/Primary",
    } as const;
    const result: TrustedToolResult = { content: { ok: true } };
    const execute = vi.fn((call: ToolCallRequest) => {
      void call;
      return Promise.resolve(result);
    });

    await expect(
      handleDesignSystemTool({
        call: {
          toolCallId: "call_style",
          toolName: DESIGN_STYLE_TOOL_NAME,
          input: sourceInput,
        },
        context,
        coordinator: coordinator(),
        execute,
        withDelivery: (value) => value,
      }),
    ).resolves.toBe(result);
    const executed = execute.mock.calls[0]?.[0];
    expect(executed?.input).toEqual(sourceInput);
    expect(executed?.input).not.toBe(sourceInput);
  });
});
