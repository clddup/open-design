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
      authorizeIndependentDesignEdit: vi.fn(() => authorization),
      assertDesignPlanForApply: vi.fn(() => authorization),
      assertDesignApplyResult: vi.fn(),
      recordDesignEditCompleted: vi.fn(),
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
    expect(coordinator.recordDesignEditCompleted).toHaveBeenCalledWith(
      context,
      authorization,
      result,
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
      authorizeIndependentDesignEdit: vi.fn(() => authorization),
      assertDesignPlanForApply: vi.fn(() => authorization),
      assertDesignApplyResult: vi.fn(),
      recordDesignEditCompleted: vi.fn(),
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

  it("does not require rebase for a mixed edit at the exact revision", async () => {
    const nodeInput = {
      label: "Refine",
      commands: [
        {
          commandId: "update",
          type: "update_properties" as const,
          nodeId: "a",
          opacity: 0.9,
        },
      ],
    };
    const authorization = {
      input: nodeInput,
      plan: {} as never,
      targetIds: ["target_a"],
      rebaseGuard: {
        fromRevision: 4,
        targets: [
          { frameId: "frame_a", pageId: "page_main", width: 100, height: 100 },
        ],
      },
    };
    const result = {
      content: { ok: true },
      designRevision: {
        previousRevision: 4,
        revision: 5,
        transactionId: "mixed",
      },
    };
    const execute = vi.fn().mockResolvedValue(result);
    const coordinator = {
      assertDesignPlanForApply: vi.fn(() => authorization),
      assertDesignApplyResult: vi.fn(),
      recordDesignEditCompleted: vi.fn(),
    };
    await handleEditDesignTool({
      call: {
        toolCallId: "mixed",
        toolName: DESIGN_EDIT_TOOL_NAME,
        input: {
          label: "Refine and align",
          edits: [
            { kind: "node", input: nodeInput },
            {
              kind: "arrange",
              input: {
                action: "align-left",
                label: "Align",
                pageId: "page_main",
                nodeIds: ["b", "c"],
              },
            },
          ],
        },
      },
      context,
      coordinator: coordinator as never,
      execute,
      withDelivery: (value) => value,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(execute.mock.calls)).not.toContain("rebaseGuard");
    expect(
      coordinator.assertDesignApplyResult.mock.calls[0]?.[1],
    ).not.toHaveProperty("rebaseGuard");
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
      recordDesignEditCompleted: vi.fn(),
      assertDesignApplyResult: vi.fn(),
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
    expect(coordinator.recordDesignEditCompleted).toHaveBeenCalledWith(
      context,
      undefined,
      result,
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
      recordDesignEditCompleted: vi.fn(),
      assertDesignApplyResult: vi.fn(),
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
    expect(coordinator.recordDesignEditCompleted).toHaveBeenCalledWith(
      context,
      undefined,
      result,
    );
  });

  it("allows one atomic edit across existing delivery artboards", async () => {
    const result: TrustedToolResult = {
      content: { ok: true },
      designRevision: {
        previousRevision: 4,
        revision: 5,
        transactionId: "transaction_cross_artboard_edit",
      },
    };
    const execute = vi.fn().mockResolvedValue(result);
    const coordinator = {
      recordDesignEditCompleted: vi.fn(),
      assertDesignApplyResult: vi.fn(),
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
    ).resolves.toBe(result);
    expect(execute).toHaveBeenCalledOnce();
    expect(coordinator.recordDesignEditCompleted).toHaveBeenCalledWith(
      context,
      undefined,
      result,
    );
  });
});
