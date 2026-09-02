import type {
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import { DESIGN_EDIT_TOOL_NAME } from "@/shared/design-agent-tools.js";
import { handleEditDesignTool } from "./design-edit-tool-handler.js";

const context: TrustedToolContext = {
  runId: "run_edit",
  sessionId: "conversation_edit",
  documentId: "document_edit",
  revision: 4,
  scope: { kind: "page", pageId: "page_main", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_main" },
};

describe("Edit Design Main boundary", () => {
  it("normalizes a planned node edit and records its authoritative target", async () => {
    const nodeInput = {
      label: "Refine card",
      commands: [
        {
          commandId: "update_card",
          type: "update_properties",
          nodeId: "card_a",
          opacity: 0.92,
        },
      ],
    } as const;
    const canonicalInput = structuredClone(nodeInput);
    const authorization = {
      input: canonicalInput,
      plan: {} as never,
      targetIds: ["target_main"],
    };
    const result: TrustedToolResult = {
      content: { ok: true },
      designRevision: {
        previousRevision: 4,
        revision: 5,
        transactionId: "transaction_node_edit",
      },
    };
    const execute = vi.fn().mockResolvedValue(result);
    const coordinator = {
      assertVisualReviewBeforeWrite: vi.fn(),
      assertDesignPlanForApply: vi.fn(() => authorization),
      assertDesignApplyResult: vi.fn(),
      recordDesignApplyCompleted: vi.fn(),
      recordMaterialDesignWriteCompleted: vi.fn(),
    };

    await expect(
      handleEditDesignTool({
        call: {
          toolCallId: "node_edit_call",
          toolName: DESIGN_EDIT_TOOL_NAME,
          input: {
            label: "Refine current card",
            edits: [{ kind: "node", input: nodeInput }],
          },
        },
        context,
        coordinator: coordinator as never,
        execute,
        withDelivery: (value) => value,
      }),
    ).resolves.toBe(result);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          label: "Refine current card",
          edits: [{ kind: "node", input: canonicalInput }],
        },
      }),
    );
    expect(coordinator.recordDesignApplyCompleted).toHaveBeenCalledWith(
      context.runId,
      canonicalInput,
      authorization,
      5,
      result.content,
    );
  });

  it("keeps the planned rebase guard off non-insert edits", async () => {
    const nodeInput = {
      label: "Refine card",
      commands: [
        {
          commandId: "update_card",
          type: "update_properties",
          nodeId: "card_a",
          opacity: 0.92,
        },
      ],
    } as const;
    const authorization = {
      input: structuredClone(nodeInput),
      plan: {} as never,
      targetIds: ["target_main"],
      rebaseGuard: {
        fromRevision: 4,
        targets: [
          {
            frameId: "frame_main",
            pageId: "page_main",
            width: 960,
            height: 640,
          },
        ],
      },
    };
    const execute = vi.fn().mockResolvedValue({
      content: { ok: true },
      designRevision: {
        previousRevision: 4,
        revision: 5,
        transactionId: "transaction_node_edit",
      },
    } satisfies TrustedToolResult);
    const coordinator = {
      assertVisualReviewBeforeWrite: vi.fn(),
      assertDesignPlanForApply: vi.fn(() => authorization),
      assertDesignApplyResult: vi.fn(),
      recordDesignApplyCompleted: vi.fn(),
      recordMaterialDesignWriteCompleted: vi.fn(),
    };

    await handleEditDesignTool({
      call: {
        toolCallId: "node_edit_call",
        toolName: DESIGN_EDIT_TOOL_NAME,
        input: {
          label: "Refine current card",
          edits: [{ kind: "node", input: nodeInput }],
        },
      },
      context,
      coordinator: coordinator as never,
      execute,
      withDelivery: (value) => value,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          label: "Refine current card",
          edits: [{ kind: "node", input: structuredClone(nodeInput) }],
        },
      }),
    );
  });

  it("authorizes all entries against one delivery target and dispatches once", async () => {
    const result: TrustedToolResult = {
      content: { ok: true },
      designRevision: {
        previousRevision: 4,
        revision: 5,
        transactionId: "transaction_edit",
      },
    };
    const execute = vi.fn().mockResolvedValue(result);
    const coordinator = {
      assertVisualReviewBeforeWrite: vi.fn(),
      resolveMaterialTargetIds: vi.fn(() => ["target_main"]),
      recordMaterialDesignWriteCompleted: vi.fn(),
      assertDesignApplyResult: vi.fn(),
      recordDesignApplyCompleted: vi.fn(),
    };
    const withDelivery = vi.fn((value: TrustedToolResult) => value);
    const call = {
      toolCallId: "edit_call",
      toolName: DESIGN_EDIT_TOOL_NAME,
      input: {
        label: "Group and align cards",
        edits: [
          {
            kind: "hierarchy",
            input: {
              action: "group",
              label: "Group cards",
              pageId: "page_main",
              nodeIds: ["card_a", "card_b"],
              groupId: "card_group",
              name: "Cards",
            },
          },
          {
            kind: "arrange",
            input: {
              action: "align-top",
              label: "Align cards",
              pageId: "page_main",
              nodeIds: ["card_a", "card_b"],
            },
          },
        ],
      },
    };

    await expect(
      handleEditDesignTool({
        call,
        context,
        coordinator: coordinator as never,
        execute,
        withDelivery,
      }),
    ).resolves.toBe(result);
    expect(execute).toHaveBeenCalledOnce();
    expect(coordinator.resolveMaterialTargetIds).toHaveBeenCalledTimes(2);
    expect(coordinator.recordMaterialDesignWriteCompleted).toHaveBeenCalledWith(
      context.runId,
      ["target_main"],
      5,
      ["card_group"],
    );
  });

  it("keeps Page ruler guides in the current Page scope without inventing a node target", async () => {
    const result: TrustedToolResult = {
      content: { ok: true },
      designRevision: {
        previousRevision: 4,
        revision: 5,
        transactionId: "transaction_page_guides",
      },
    };
    const execute = vi.fn().mockResolvedValue(result);
    const coordinator = {
      assertVisualReviewBeforeWrite: vi.fn(),
      resolveMaterialTargetIds: vi.fn(() => []),
      recordMaterialDesignWriteCompleted: vi.fn(),
      assertDesignApplyResult: vi.fn(),
      recordDesignApplyCompleted: vi.fn(),
    };

    await expect(
      handleEditDesignTool({
        call: {
          toolCallId: "page_guides_call",
          toolName: DESIGN_EDIT_TOOL_NAME,
          input: {
            label: "Add page guides",
            edits: [
              {
                kind: "arrange",
                input: {
                  action: "set-ruler-guides",
                  label: "Add page guides",
                  pageId: "page_main",
                  target: "page",
                  guides: [{ axis: "X", offset: 120 }],
                },
              },
            ],
          },
        },
        context,
        coordinator: coordinator as never,
        execute,
        withDelivery: (value) => value,
      }),
    ).resolves.toBe(result);
    expect(coordinator.resolveMaterialTargetIds).toHaveBeenCalledWith(
      context,
      [],
    );
    expect(coordinator.recordMaterialDesignWriteCompleted).toHaveBeenCalledWith(
      context.runId,
      [],
      5,
      [],
    );
  });

  it("rejects an invalid nested edit before execution", async () => {
    const execute = vi.fn();
    await expect(
      handleEditDesignTool({
        call: {
          toolCallId: "invalid_edit",
          toolName: DESIGN_EDIT_TOOL_NAME,
          input: {
            label: "Invalid",
            edits: [
              {
                kind: "arrange",
                input: {
                  action: "resize-frame",
                  label: "Resize",
                  pageId: "page_main",
                  frameId: "frame_main",
                  width: 0,
                  height: 720,
                },
              },
            ],
          },
        },
        context,
        coordinator: {} as never,
        execute,
        withDelivery: (value) => value,
      }),
    ).rejects.toThrow("design_edit.schema_invalid at /edits/0/input/width");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects one atomic edit that resolves to multiple delivery artboards", async () => {
    const execute = vi.fn();
    const coordinator = {
      assertVisualReviewBeforeWrite: vi.fn(),
      resolveMaterialTargetIds: vi
        .fn()
        .mockReturnValueOnce(["target_a"])
        .mockReturnValueOnce(["target_b"]),
    };

    await expect(
      handleEditDesignTool({
        call: {
          toolCallId: "cross_artboard_edit",
          toolName: DESIGN_EDIT_TOOL_NAME,
          input: {
            label: "Invalid cross-artboard edit",
            edits: [
              {
                kind: "hierarchy",
                input: {
                  action: "group",
                  label: "Group first target",
                  pageId: "page_main",
                  nodeIds: ["a_1", "a_2"],
                  groupId: "a_group",
                  name: "A",
                },
              },
              {
                kind: "arrange",
                input: {
                  action: "align-top",
                  label: "Align second target",
                  pageId: "page_main",
                  nodeIds: ["b_1", "b_2"],
                },
              },
            ],
          },
        },
        context,
        coordinator: coordinator as never,
        execute,
        withDelivery: (value) => value,
      }),
    ).rejects.toThrow("cross_artboard_edit_invalid");
    expect(execute).not.toHaveBeenCalled();
  });
});
