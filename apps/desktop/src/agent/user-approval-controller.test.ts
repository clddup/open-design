import type {
  ApprovalRequest,
  TrustedToolContext,
} from "@opendesign/agent-runtime";
import { describe, expect, it } from "vitest";
import { UserApprovalController } from "./user-approval-controller.js";

const request: ApprovalRequest = {
  approvalId: "approval_pages",
  toolCallId: "tool_pages",
  toolName: "opendesign_request_page_structure_access",
  title: "Allow page structure changes",
  summary: "Allow this task to update Pages.",
  risk: "design_write",
};

const context: TrustedToolContext = {
  runId: "run_pages",
  sessionId: "conversation_pages",
  documentId: "document_pages",
  revision: 4,
  scope: { kind: "page", pageId: "page_home", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_home" },
};

describe("UserApprovalController", () => {
  it("resolves only the exact pending Run, tool call and approval", async () => {
    const controller = new UserApprovalController();
    const decision = controller.requestApproval(
      request,
      context,
      new AbortController().signal,
    );

    expect(
      controller.resolve({
        runId: "run_wrong",
        toolCallId: request.toolCallId,
        approvalId: request.approvalId,
        decision: "allow_once",
      }),
    ).toBe(false);
    expect(
      controller.resolve({
        runId: context.runId,
        toolCallId: request.toolCallId,
        approvalId: request.approvalId,
        decision: "allow_once",
      }),
    ).toBe(true);
    await expect(decision).resolves.toBe("allow_once");
  });

  it("denies and clears an approval when its tool is cancelled", async () => {
    const controller = new UserApprovalController();
    const abort = new AbortController();
    const decision = controller.requestApproval(request, context, abort.signal);

    abort.abort();

    await expect(decision).resolves.toBe("deny");
    expect(
      controller.resolve({
        runId: context.runId,
        toolCallId: request.toolCallId,
        approvalId: request.approvalId,
        decision: "allow_once",
      }),
    ).toBe(false);
  });
});
