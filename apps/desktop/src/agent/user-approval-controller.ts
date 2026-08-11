import type { ApprovalDecision } from "@opendesign/agent-contracts";
import type {
  ApprovalPort,
  ApprovalRequest,
  TrustedToolContext,
} from "@opendesign/agent-runtime";

type PendingApproval = {
  request: ApprovalRequest;
  context: TrustedToolContext;
  resolve: (decision: ApprovalDecision) => void;
  cleanup: () => void;
};

export type ApprovalResolution = {
  runId: string;
  toolCallId: string;
  approvalId: string;
  decision: ApprovalDecision;
};

/**
 * Utility-process endpoint for approvals decided by the user through Main.
 *
 * The lifecycle event is published separately by PiRunEventAdapter before
 * requestApproval() is called. This controller only holds the cancellable
 * decision promise and never grants a capability itself.
 */
export class UserApprovalController implements ApprovalPort {
  readonly #pending = new Map<string, PendingApproval>();

  requestApproval(
    request: ApprovalRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<ApprovalDecision> {
    if (this.#pending.has(request.approvalId)) {
      return Promise.reject(new Error("Approval ID is already pending"));
    }
    if (signal.aborted) return Promise.resolve("deny");
    return new Promise((resolve) => {
      const abort = () => {
        const pending = this.#pending.get(request.approvalId);
        if (!pending) return;
        this.#pending.delete(request.approvalId);
        pending.cleanup();
        resolve("deny");
      };
      const cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      this.#pending.set(request.approvalId, {
        request: structuredClone(request),
        context: structuredClone(context),
        resolve,
        cleanup,
      });
    });
  }

  resolve(resolution: ApprovalResolution): boolean {
    const pending = this.#pending.get(resolution.approvalId);
    if (
      !pending ||
      pending.context.runId !== resolution.runId ||
      pending.request.toolCallId !== resolution.toolCallId
    ) {
      return false;
    }
    this.#pending.delete(resolution.approvalId);
    pending.cleanup();
    pending.resolve(resolution.decision);
    return true;
  }
}
