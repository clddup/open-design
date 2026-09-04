import { describe, expect, it, vi } from "vitest";
import { INTERNAL_DESIGN_APPLY_TOOL_NAME } from "@/shared/design-agent-tools";
import { executeSemanticDesignTransaction } from "./design-transaction-steps";

describe("executeSemanticDesignTransaction", () => {
  it("reports the shortest semantic candidate's first failure and exact commands", async () => {
    const firstError = {
      code: "document.invalid",
      message: "Planned region footer_region has the wrong node kind",
    };
    const laterError = {
      code: "document.invalid",
      message: "Index 1 exceeds child count 0",
    };
    const commands = [
      {
        commandId: "first_slice_1",
        type: "update_properties" as const,
        nodeId: "footer_region",
        name: "Footer",
      },
      {
        commandId: "first_slice_2",
        type: "update_properties" as const,
        nodeId: "footer_copy",
        name: "Footer Copy",
      },
    ];
    const runtime = {
      getSnapshot: vi.fn().mockReturnValue({ document: { revision: 0 } }),
      preview: vi
        .fn()
        .mockReturnValueOnce({ ok: false, error: firstError })
        .mockReturnValueOnce({ ok: false, error: laterError }),
    };
    const createFailure = vi.fn(
      (error: { message: string }, failedCommands: typeof commands) =>
        new Error(
          `${error.message} · ${failedCommands.map((command) => command.commandId).join(",")}`,
        ),
    );

    await expect(
      executeSemanticDesignTransaction({
        request: {
          requestId: "request_first_error",
          call: {
            toolCallId: "tool_first_error",
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              label: "Build login",
              steps: [
                {
                  stepId: "footer",
                  label: "Build footer",
                  commandIds: ["first_slice_1"],
                },
                {
                  stepId: "copy",
                  label: "Add copy",
                  commandIds: ["first_slice_2"],
                },
              ],
              commands,
            },
          },
          context: {
            runId: "run_first_error",
            sessionId: "conversation_first_error",
            documentId: "document_first_error",
            revision: 0,
            scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
            mutationTarget: { kind: "page", pageId: "page_1" },
          },
        } as never,
        applyInput: {
          label: "Build login",
          steps: [
            {
              stepId: "footer",
              label: "Build footer",
              commandIds: ["first_slice_1"],
            },
            {
              stepId: "copy",
              label: "Add copy",
              commandIds: ["first_slice_2"],
            },
          ],
          commands,
        },
        runtime: runtime as never,
        transaction: {
          transactionId: "transaction_first_error",
          documentId: "document_first_error",
          baseRevision: 0,
          actor: { type: "agent", id: "run_first_error" },
          label: "Build login",
          commands,
        },
        preview: { ok: true } as never,
        execution: {},
        createFailure: createFailure as never,
      }),
    ).rejects.toThrow(
      "Planned region footer_region has the wrong node kind · first_slice_1",
    );
    expect(createFailure).toHaveBeenCalledWith(firstError, [commands[0]]);
  });
});
