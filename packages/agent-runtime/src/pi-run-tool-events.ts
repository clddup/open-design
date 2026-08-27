import type { AgentEvent as PiAgentEvent } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AgentToolFailureDetails,
  RunStopReason,
} from "@opendesign/agent-contracts";
import type { appendRunJournalEvent } from "./run-journal-writer.js";
import type { AgentRunRequest } from "./run-request.js";
import type {
  PiToolApprovalRequested,
  PiToolApprovalResolved,
} from "./pi-tool-approval.js";
import type { OpenDesignPiToolAdapter } from "./pi-tool-adapter.js";

type AppendJournal = (
  type: Parameters<typeof appendRunJournalEvent>[2],
  payload: unknown,
  createdAt?: string,
) => Promise<number>;

export class PiRunToolEventBridge {
  constructor(
    private readonly adapter: OpenDesignPiToolAdapter,
    private readonly request: Readonly<AgentRunRequest>,
    private readonly append: AppendJournal,
    private readonly publish: (event: AgentEvent) => Promise<void>,
  ) {}

  async accept(
    event: Extract<
      PiAgentEvent,
      {
        type:
          | "tool_execution_start"
          | "tool_execution_update"
          | "tool_execution_end";
      }
    >,
  ): Promise<void> {
    if (event.type === "tool_execution_start") {
      const requested = this.adapter.beginToolCall(event);
      if (requested.duplicate) return;
      await this.append("tool.requested", {
        toolCallId: requested.toolCallId,
        toolName: requested.toolName,
        input: requested.input,
        risk: requested.risk,
      });
      await this.publish({
        type: "tool.requested",
        runId: this.request.runId,
        toolCallId: requested.toolCallId,
        toolName: requested.toolName,
        input: requested.input,
        risk: requested.risk,
      });
      return;
    }
    if (event.type === "tool_execution_update") {
      const progress = this.adapter.updateToolCall(event);
      if (!progress) return;
      await this.append("tool.progress", progress);
      await this.publish({
        type: "tool.progress",
        runId: this.request.runId,
        ...progress,
      });
      return;
    }
    await this.#complete(event);
  }

  async finalizePending(stopReason: RunStopReason): Promise<void> {
    for (const failure of this.adapter.finalizePendingTools(stopReason)) {
      await this.#recordFailure(failure);
    }
  }

  async approvalRequested(approval: PiToolApprovalRequested): Promise<void> {
    await this.append("approval.requested", {
      approvalId: approval.approvalId,
      toolCallId: approval.toolCallId,
      title: approval.title,
      summary: approval.summary,
    });
    await this.publish({
      type: "approval.requested",
      runId: this.request.runId,
      approvalId: approval.approvalId,
      toolCallId: approval.toolCallId,
      title: approval.title,
      summary: approval.summary,
    });
  }

  async approvalResolved(approval: PiToolApprovalResolved): Promise<void> {
    await this.append("approval.resolved", approval, approval.resolvedAt);
    await this.publish({
      type: "approval.resolved",
      runId: this.request.runId,
      ...approval,
    });
  }

  async #complete(
    event: Extract<PiAgentEvent, { type: "tool_execution_end" }>,
  ): Promise<void> {
    const terminal = this.adapter.endToolCall(event);
    if (!terminal) {
      this.adapter.acknowledgeToolCall(event.toolCallId);
      return;
    }
    if (terminal.status === "failed") {
      await this.#recordFailure(terminal, () =>
        this.adapter.acknowledgeToolCall(event.toolCallId),
      );
      return;
    }
    const nextRevision =
      terminal.designRevision?.revision ?? terminal.observedRevision;
    const completion = {
      toolCallId: terminal.toolCallId,
      result: terminal.content,
      ...(nextRevision === undefined ||
      nextRevision === terminal.previousRevision
        ? {}
        : {
            revision: nextRevision,
            ...(terminal.designRevision
              ? { transactionId: terminal.designRevision.transactionId }
              : {}),
          }),
    };
    await this.append("tool.completed", completion);
    if (terminal.designRevision) {
      await this.append("design.revision", {
        documentId: this.request.documentId,
        previousRevision: terminal.designRevision.previousRevision,
        revision: terminal.designRevision.revision,
        transactionId: terminal.designRevision.transactionId,
        toolCallId: terminal.toolCallId,
      });
    }
    this.adapter.acknowledgeToolCall(event.toolCallId);
    await this.publish({
      type: "tool.completed",
      runId: this.request.runId,
      ...completion,
    });
  }

  async #recordFailure(
    failure: {
      toolCallId: string;
      code: string;
      message: string;
      retryable: boolean;
      recoverable: boolean;
      details?: AgentToolFailureDetails;
    },
    acknowledge?: () => void,
  ): Promise<void> {
    const message = boundedToolFailureMessage(failure.message);
    const payload = {
      toolCallId: failure.toolCallId,
      code: failure.code,
      message,
      retryable: failure.retryable,
      recoverable: failure.recoverable,
      ...(failure.details ? { details: failure.details } : {}),
    };
    await this.append("tool.failed", payload);
    acknowledge?.();
    await this.publish({
      type: "tool.failed",
      runId: this.request.runId,
      ...payload,
    });
  }
}

const MAX_TOOL_FAILURE_MESSAGE_LENGTH = 20_000;
const TOOL_FAILURE_TRUNCATION_SUFFIX =
  "\n[OpenDesign truncated oversized internal tool diagnostics]";

function boundedToolFailureMessage(message: string): string {
  if (message.length <= MAX_TOOL_FAILURE_MESSAGE_LENGTH) return message;
  return `${message.slice(
    0,
    MAX_TOOL_FAILURE_MESSAGE_LENGTH - TOOL_FAILURE_TRUNCATION_SUFFIX.length,
  )}${TOOL_FAILURE_TRUNCATION_SUFFIX}`;
}
