import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DESIGN_FONT_TOOL_NAME,
  DESIGN_TEXT_RANGE_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import { handleDesignTypographyTool } from "./design-typography-tool-handler.js";

const context: TrustedToolContext = {
  runId: "run_typography",
  sessionId: "conversation_typography",
  documentId: "document_typography",
  revision: 4,
  scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_1" },
};

function coordinatorMocks() {
  return {
    assertDocumentInspected: vi.fn(),
    assertVisualReviewBeforeWrite: vi.fn(),
    resolveMaterialTargetIdsIfPlanned: vi.fn(() => ["target_1"]),
    recordMaterialDesignWriteCompleted: vi.fn(),
  };
}

describe("design typography Main tool boundary", () => {
  it("rejects invalid Font branch fields before Renderer execution", async () => {
    const execute = vi.fn();
    await expect(
      handleDesignTypographyTool({
        call: {
          toolCallId: "font_invalid",
          toolName: DESIGN_FONT_TOOL_NAME,
          input: {
            action: "reflow",
            label: "Reflow heading",
            pageId: "page_1",
            nodeIds: ["heading"],
            expectedFont: {
              fontFamily: "Inter",
              fontStyleName: "Regular",
              fontWeight: 400,
              fontSlant: "normal",
            },
            replacementFont: {
              fontFamily: "Arial",
              fontStyleName: "Regular",
              fontWeight: 400,
              fontSlant: "normal",
            },
          },
        },
        context,
        coordinator: coordinatorMocks() as unknown as GlobalTaskCoordinator,
        execute,
        withDelivery: (result) => result,
      }),
    ).rejects.toThrow("design_font.schema_invalid");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    {
      toolName: DESIGN_FONT_TOOL_NAME,
      input: {
        action: "reflow",
        label: "Reflow heading",
        pageId: "page_1",
        nodeIds: ["heading", "subtitle"],
        expectedFont: {
          fontFamily: "Inter",
          fontStyleName: "Regular",
          fontWeight: 400,
          fontSlant: "normal",
        },
      },
      nodeIds: ["heading", "subtitle"],
    },
    {
      toolName: DESIGN_TEXT_RANGE_TOOL_NAME,
      input: {
        label: "Emphasize title",
        pageId: "page_1",
        nodeId: "heading",
        start: 0,
        end: 5,
        style: { fontWeight: 700 },
      },
      nodeIds: ["heading"],
    },
  ] as const)("executes canonical $toolName input", async (entry) => {
    const coordinator = coordinatorMocks();
    const result: TrustedToolResult = {
      content: { ok: true },
      designRevision: {
        previousRevision: 4,
        revision: 5,
        transactionId: "transaction_typography",
      },
    };
    const execute = vi.fn<
      (call: ToolCallRequest) => Promise<TrustedToolResult>
    >(() => Promise.resolve(result));

    await expect(
      handleDesignTypographyTool({
        call: {
          toolCallId: "typography_valid",
          toolName: entry.toolName,
          input: entry.input,
        },
        context,
        coordinator: coordinator as unknown as GlobalTaskCoordinator,
        execute,
        withDelivery: (value) => value,
      }),
    ).resolves.toBe(result);
    expect(coordinator.assertDocumentInspected).toHaveBeenCalledWith(context);
    expect(coordinator.assertVisualReviewBeforeWrite).toHaveBeenCalledWith(
      context,
    );
    expect(coordinator.resolveMaterialTargetIdsIfPlanned).toHaveBeenCalledWith(
      context,
      entry.nodeIds,
    );
    expect(coordinator.recordMaterialDesignWriteCompleted).toHaveBeenCalledWith(
      "run_typography",
      ["target_1"],
      5,
    );
    expect(execute.mock.calls[0]?.[0]?.input).toEqual(entry.input);
    expect(execute.mock.calls[0]?.[0]?.input).not.toBe(entry.input);
  });
});
