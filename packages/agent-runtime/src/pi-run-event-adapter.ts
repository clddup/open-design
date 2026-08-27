import type {
  AgentEvent as PiAgentEvent,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AgentRunFailure,
  AgentToolFailureDetails,
  AssistantTimelineBlock,
  RunStopReason,
} from "@opendesign/agent-contracts";
import type { SessionStore } from "@opendesign/session-store";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type {
  AgentToolCallRecord,
  CompletionGuardPort,
} from "./completion-guard.js";
import { canonicalUserMessage } from "./model-message-projection.js";
import {
  projectAgentRunPrompt,
  type AgentRunRequest,
  type ModelToolSurface,
} from "./run-request.js";
import type {
  AgentToolDefinition,
  ApprovalPort,
  ToolExecutorPort,
} from "./runtime-ports.js";
import {
  OpenDesignPiToolAdapter,
  type PiToolApprovalRequested,
  type PiToolApprovalResolved,
} from "./pi-tool-adapter.js";
import type { PiContextFailurePort } from "./pi-context-adapter.js";
import type { PiModelFailurePort } from "./pi-model-gateway-adapter.js";
import { terminalRunFailure } from "./pi-terminal-failure.js";
import {
  blockId,
  generatedTokens,
  requireAssistantMessage,
  toResolvedIdentity,
  toRunStopReason,
  toTimelineBlocks,
  userText,
  type PiAgentEventMessage,
} from "./pi-run-event-messages.js";
import { appendRunJournalEvent } from "./run-journal-writer.js";
export interface PiRunEventAdapterOptions {
  request: AgentRunRequest;
  sessionStore: SessionStore;
  emit: (event: AgentEvent) => Promise<void> | void;
  toolDefinitions?: readonly AgentToolDefinition[];
  toolExecutor?: ToolExecutorPort;
  approvalPort?: ApprovalPort;
  completionGuard?: CompletionGuardPort;
  contextFailurePort?: PiContextFailurePort;
  modelFailurePort?: PiModelFailurePort;
  isCancellationRequested?: () => boolean;
  requestContinuation?: (message: UserMessage) => void;
  maxToolCalls?: number;
  maxTurns?: number;
  maxGeneratedTokens?: number;
  maxCompletionGuardRejections?: number;
  priorToolCallIds?: readonly string[];
  initialModelToolSurface?: ModelToolSurface;
  now?: () => Date;
}

interface ActiveAssistantMessage {
  messageId: string;
}
interface PendingCompletion {
  active: ActiveAssistantMessage;
  blocks: AssistantTimelineBlock[];
  message: AssistantMessage;
}

/**
 * Projects Pi's ephemeral loop events into OpenDesign's versioned renderer
 * events and durable Conversation journal.
 *
 * Model and tool lifecycle events reuse OpenDesign's existing AgentEvent,
 * ToolExecutor, approval, revision, attachment and journal semantics. The
 * adapter never creates a Pi session or a second durable transcript.
 */
export class PiRunEventAdapter {
  readonly #emit: PiRunEventAdapterOptions["emit"];
  readonly #completionGuard: CompletionGuardPort | undefined;
  readonly #contextFailurePort: PiContextFailurePort | undefined;
  readonly #maxCompletionGuardRejections: number;
  readonly #maxGeneratedTokens: number;
  readonly #maxTurns: number;
  readonly #modelFailurePort: PiModelFailurePort | undefined;
  readonly #isCancellationRequested: (() => boolean) | undefined;
  readonly #now: () => Date;
  readonly #request: AgentRunRequest;
  readonly #requestContinuation: ((message: UserMessage) => void) | undefined;
  readonly #sessionStore: SessionStore;
  #activeAssistant: ActiveAssistantMessage | undefined;
  #activeToolResultCallId: string | undefined;
  #activeUserMessage = false;
  #ended = false;
  #forcedError: AgentRunFailure | undefined;
  #forcedStopReason: RunStopReason | undefined;
  #guardRejections = 0;
  #initialPromptConsumed = false;
  #lastAssistantError: string | undefined;
  #lastAssistantHadToolCalls = false;
  #lastAssistantStopReason: AssistantMessage["stopReason"] | undefined;
  #pendingCompletion: PendingCompletion | undefined;
  #started = false;
  #startedAt = "";
  #stopAfterTurn = false;
  readonly #toolAdapter: OpenDesignPiToolAdapter | undefined;
  #turn = 0;
  #generatedTokens = 0;
  readonly #trustedContinuations: string[] = [];
  #userMessageSequence = 0;

  constructor(options: PiRunEventAdapterOptions) {
    this.#request = snapshotRequest(options.request);
    this.#sessionStore = options.sessionStore;
    this.#emit = options.emit;
    this.#now = options.now ?? (() => new Date());
    this.#completionGuard = options.completionGuard;
    this.#contextFailurePort = options.contextFailurePort;
    this.#modelFailurePort = options.modelFailurePort;
    this.#isCancellationRequested = options.isCancellationRequested;
    this.#requestContinuation = options.requestContinuation;
    this.#maxTurns = options.maxTurns ?? 8;
    this.#maxGeneratedTokens = options.maxGeneratedTokens ?? 200_000;
    this.#maxCompletionGuardRejections =
      options.maxCompletionGuardRejections ?? 3;
    if (
      !Number.isInteger(this.#maxTurns) ||
      this.#maxTurns < 1 ||
      !Number.isInteger(this.#maxGeneratedTokens) ||
      this.#maxGeneratedTokens < 1 ||
      !Number.isInteger(this.#maxCompletionGuardRejections) ||
      this.#maxCompletionGuardRejections < 0
    ) {
      throw new RangeError("Pi run limits are invalid");
    }
    if (
      this.#completionGuard !== undefined &&
      this.#requestContinuation === undefined
    ) {
      throw new TypeError(
        "Pi completion guard requires a trusted continuation queue",
      );
    }
    if (options.toolDefinitions !== undefined) {
      this.#toolAdapter = new OpenDesignPiToolAdapter({
        request: this.#request,
        definitions: options.toolDefinitions,
        ...(options.toolExecutor === undefined
          ? {}
          : { toolExecutor: options.toolExecutor }),
        ...(options.approvalPort === undefined
          ? {}
          : { approvalPort: options.approvalPort }),
        maxToolCalls: options.maxToolCalls ?? 32,
        initialInspection: this.#request.initialDesignInspection !== undefined,
        ...(options.initialModelToolSurface === undefined
          ? {}
          : { initialModelToolSurface: options.initialModelToolSurface }),
        ...(options.priorToolCallIds === undefined
          ? {}
          : { priorToolCallIds: options.priorToolCallIds }),
        now: this.#now,
        lifecycle: {
          approvalRequested: (approval) =>
            this.#recordApprovalRequested(approval),
          approvalResolved: (approval) =>
            this.#recordApprovalResolved(approval),
        },
      });
    }
  }
  get tools(): readonly AgentTool[] {
    return this.#toolAdapter?.tools ?? [];
  }
  get modelTools(): readonly AgentTool[] {
    return this.#toolAdapter?.modelTools ?? [];
  }
  get toolCallRecords(): readonly AgentToolCallRecord[] {
    return this.#toolAdapter?.toolCallRecords ?? [];
  }
  get unresolvedDesignWriteFailure() {
    return this.#toolAdapter?.unresolvedDesignWriteFailure;
  }
  readonly beforeToolCall = (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    if (this.#toolAdapter === undefined) return Promise.resolve(undefined);
    return this.#toolAdapter.beforeToolCall(context, signal);
  };

  readonly shouldStopAfterTurn = (): boolean =>
    this.#stopAfterTurn ||
    this.#forcedStopReason !== undefined ||
    this.#toolAdapter?.forcedStopReason !== undefined;

  async accept(event: PiAgentEvent): Promise<void> {
    if (this.#ended) {
      throw new Error(`Pi emitted ${event.type} after agent_end`);
    }
    if (event.type === "agent_start") {
      await this.#startRun();
      return;
    }
    if (!this.#started) {
      throw new Error(`Pi emitted ${event.type} before agent_start`);
    }

    if (event.type === "message_start") {
      this.#startMessage(event.message);
      return;
    }
    if (event.type === "message_update") {
      await this.#updateMessage(event);
      return;
    }
    if (event.type === "message_end") {
      await this.#endMessage(event.message);
      return;
    }
    if (event.type === "turn_end") {
      await this.#endTurn(event);
      return;
    }
    if (
      event.type === "tool_execution_start" ||
      event.type === "tool_execution_update" ||
      event.type === "tool_execution_end"
    ) {
      await this.#acceptToolEvent(event);
      return;
    }
    if (event.type === "agent_end") {
      await this.#endRun();
    }
  }

  async #startRun(): Promise<void> {
    if (this.#started) throw new Error("Pi emitted duplicate agent_start");
    this.#startedAt = this.#now().toISOString();
    const continuation = this.#request.continuation;
    await this.#append("message.user", {
      messageId: `${this.#request.runId}_user`,
      content: this.#request.prompt,
      ...(this.#request.attachments === undefined
        ? {}
        : { attachments: this.#request.attachments }),
      documentId: this.#request.documentId,
      revision: this.#request.revision,
      scope: this.#request.scope,
      mutationTarget: this.#request.mutationTarget,
    });
    await this.#append(
      "run.state",
      {
        status: "started",
        startedAt: this.#startedAt,
        modelSelection: this.#request.modelSelection,
        ...(continuation ? { continuation } : {}),
      },
      this.#startedAt,
    );
    this.#started = true;
    await this.#publish({
      type: "run.started",
      runId: this.#request.runId,
      startedAt: this.#startedAt,
      ...(continuation ? { continuation } : {}),
    });
  }

  #startMessage(message: PiAgentEventMessage): void {
    if (message.role === "toolResult") {
      if (this.#toolAdapter === undefined) {
        throw new Error(
          "Pi tool-result messages require the OpenDesign production tool adapter",
        );
      }
      if (this.#activeToolResultCallId !== undefined) {
        throw new Error("Pi started overlapping tool-result messages");
      }
      this.#activeToolResultCallId = message.toolCallId;
      return;
    }
    if (message.role === "user") {
      if (this.#activeUserMessage || this.#activeAssistant !== undefined) {
        throw new Error("Pi started overlapping messages");
      }
      this.#activeUserMessage = true;
      return;
    }
    requireAssistantMessage(message);
    if (this.#activeAssistant !== undefined || this.#activeUserMessage) {
      throw new Error("Pi started overlapping messages");
    }
    this.#turn += 1;
    this.#activeAssistant = {
      messageId: `${this.#request.runId}_assistant_${this.#turn}`,
    };
  }

  async #updateMessage(
    event: Extract<PiAgentEvent, { type: "message_update" }>,
  ): Promise<void> {
    const message = requireAssistantMessage(event.message);
    const active = this.#activeAssistant;
    if (active === undefined) {
      throw new Error("Pi updated an assistant message before message_start");
    }
    const update = event.assistantMessageEvent;
    if (update.type !== "text_delta" || update.delta.length === 0) return;
    if (update.delta.length > 200_000) {
      throw new RangeError("Pi text delta exceeds AgentEvent protocol limits");
    }
    const block = message.content[update.contentIndex];
    if (block?.type !== "text") {
      throw new Error("Pi text delta referenced a non-text content block");
    }
    await this.#publish({
      type: "message.delta",
      runId: this.#request.runId,
      messageId: active.messageId,
      blockId: blockId(active.messageId, update.contentIndex),
      delta: update.delta,
    });
  }
  async #endMessage(message: PiAgentEventMessage): Promise<void> {
    if (message.role === "toolResult") {
      if (this.#activeToolResultCallId !== message.toolCallId) {
        throw new Error("Pi ended an unexpected tool-result message");
      }
      this.#activeToolResultCallId = undefined;
      return;
    }
    if (message.role === "user") {
      if (!this.#activeUserMessage) {
        throw new Error("Pi ended a user message before message_start");
      }
      this.#activeUserMessage = false;
      await this.#persistUserMessage(message);
      return;
    }
    const assistantMessage = requireAssistantMessage(message);
    const active = this.#activeAssistant;
    if (active === undefined) {
      throw new Error("Pi ended an assistant message before message_start");
    }
    this.#activeAssistant = undefined;
    if (
      assistantMessage.stopReason === "pending" ||
      assistantMessage.stopReason === "deferred"
    ) {
      throw new Error(
        `Pi ended an assistant message with ${assistantMessage.stopReason}`,
      );
    }
    this.#lastAssistantStopReason = assistantMessage.stopReason;
    this.#lastAssistantError = assistantMessage.errorMessage;
    this.#lastAssistantHadToolCalls = assistantMessage.content.some(
      (block) => block.type === "toolCall",
    );
    this.#generatedTokens += generatedTokens(assistantMessage);
    if (
      assistantMessage.stopReason === "error" ||
      assistantMessage.stopReason === "aborted"
    ) {
      return;
    }

    const blocks = toTimelineBlocks(assistantMessage, active.messageId);
    const canReviewCompletion =
      this.#completionGuard !== undefined &&
      assistantMessage.stopReason === "stop" &&
      !this.#lastAssistantHadToolCalls &&
      this.#generatedTokens <= this.#maxGeneratedTokens;
    if (canReviewCompletion) {
      this.#pendingCompletion = {
        active,
        blocks,
        message: assistantMessage,
      };
      return;
    }
    await this.#finalizeAssistant(active, assistantMessage, blocks);
    if (
      assistantMessage.stopReason === "length" ||
      this.#generatedTokens > this.#maxGeneratedTokens
    ) {
      this.#forcedStopReason = "budget";
    }
  }

  async #persistUserMessage(message: UserMessage): Promise<void> {
    const content = userText(message);
    if (!this.#initialPromptConsumed) {
      this.#initialPromptConsumed = true;
      if (content !== projectedInitialUserText(this.#request)) {
        throw new Error(
          "Pi initial prompt does not match the durable run request",
        );
      }
      return;
    }
    if (content === this.#trustedContinuations[0]) {
      this.#trustedContinuations.shift();
      return;
    }
    this.#userMessageSequence += 1;
    await this.#append("message.user", {
      messageId: `${this.#request.runId}_user_${this.#userMessageSequence}`,
      content,
      documentId: this.#request.documentId,
      revision: this.#toolAdapter?.currentRevision ?? this.#request.revision,
      scope: this.#request.scope,
      mutationTarget: this.#request.mutationTarget,
    });
  }
  async #endRun(): Promise<void> {
    const cancellationRequested = this.#isCancellationRequested?.() === true;
    if (this.#activeAssistant !== undefined || this.#activeUserMessage) {
      throw new Error("Pi ended a run with an active message");
    }
    if (this.#pendingCompletion !== undefined) {
      await this.#publishProvisionalClear(
        this.#pendingCompletion.active.messageId,
      );
      this.#pendingCompletion = undefined;
      if (!cancellationRequested) {
        this.#forcedStopReason = "error";
        this.#forcedError = {
          code: "completion_guard_interrupted",
          message: "Pi Agent ended before completion review settled",
          retryable: true,
        };
      }
    }
    if (this.#activeToolResultCallId !== undefined) {
      this.#activeToolResultCallId = undefined;
      if (!cancellationRequested) {
        this.#forcedStopReason = "error";
        this.#forcedError = {
          code: "tool_result_interrupted",
          message: "Pi Agent ended during a tool-result message",
          retryable: true,
        };
      }
    }
    const contextFailure = this.#contextFailurePort?.consumeFailure();
    if (!cancellationRequested && contextFailure !== undefined) {
      this.#forcedStopReason = "error";
      this.#forcedError = { ...contextFailure, retryable: false };
    }
    const terminalFailure = terminalRunFailure(
      this.#modelFailurePort?.consumeFailure(),
      this.#toolAdapter?.forcedError,
    );
    if (!cancellationRequested && terminalFailure !== undefined) {
      this.#forcedStopReason = "error";
      this.#forcedError = terminalFailure;
    }
    const stopReason = cancellationRequested
      ? "cancelled"
      : (this.#forcedStopReason ??
        this.#toolAdapter?.forcedStopReason ??
        toRunStopReason(
          this.#lastAssistantStopReason,
          this.#lastAssistantHadToolCalls,
        ));
    for (const failure of this.#toolAdapter?.finalizePendingTools(stopReason) ??
      []) {
      await this.#recordToolFailure(failure);
    }
    if (stopReason === "error") {
      const invalidToolStop =
        this.#lastAssistantStopReason === "toolUse" &&
        !this.#lastAssistantHadToolCalls;
      const failure: AgentRunFailure =
        this.#forcedError ??
        (invalidToolStop
          ? {
              code: "invalid_model_response",
              message: "Model stopped for tool use without a tool call",
              retryable: true,
            }
          : {
              code: "run_failed",
              message: this.#lastAssistantError ?? "Pi Agent run failed",
              retryable: true,
            });
      this.#forcedError = failure;
      await this.#publish({
        type: "agent.error",
        code: failure.code,
        message: failure.message,
        runId: this.#request.runId,
        failure,
      });
    }
    const finishedAt = this.#now().toISOString();
    await this.#append(
      "run.state",
      {
        status: stopReason === "complete" ? "completed" : stopReason,
        startedAt: this.#startedAt,
        finishedAt,
        stopReason,
        ...(this.#forcedError === undefined
          ? {}
          : { failure: this.#forcedError }),
      },
      finishedAt,
    );
    await this.#publish({
      type: "run.completed",
      runId: this.#request.runId,
      finishedAt,
      stopReason,
    });
    this.#ended = true;
  }

  #append(
    type: Parameters<typeof appendRunJournalEvent>[2],
    payload: unknown,
    createdAt = this.#now().toISOString(),
  ): Promise<number> {
    return appendRunJournalEvent(
      this.#sessionStore,
      this.#request,
      type,
      payload,
      createdAt,
    );
  }

  async #publish(event: AgentEvent): Promise<void> {
    await this.#emit(event);
  }

  async #endTurn(
    event: Extract<PiAgentEvent, { type: "turn_end" }>,
  ): Promise<void> {
    const message = requireAssistantMessage(event.message);
    const hasToolCalls = message.content.some(
      (block) => block.type === "toolCall",
    );
    if (this.#turn >= this.#maxTurns) {
      this.#stopAfterTurn = true;
      if (hasToolCalls) this.#forcedStopReason = "budget";
    }
    const pending = this.#pendingCompletion;
    if (pending === undefined) return;
    this.#pendingCompletion = undefined;
    const guard = this.#completionGuard;
    const requestContinuation = this.#requestContinuation;
    if (guard === undefined || requestContinuation === undefined) {
      throw new Error("Pi completion review dependencies became unavailable");
    }

    let decision;
    try {
      decision = await guard.review({
        request: this.#request,
        currentRevision:
          this.#toolAdapter?.currentRevision ?? this.#request.revision,
        turn: this.#turn,
        rejectionCount: this.#guardRejections,
        toolCalls: this.#toolAdapter?.toolCallRecords ?? [],
        ...(this.#toolAdapter?.unresolvedDesignWriteFailure === undefined
          ? {}
          : {
              unresolvedDesignWriteFailure:
                this.#toolAdapter.unresolvedDesignWriteFailure,
            }),
      });
    } catch (error) {
      await this.#publishProvisionalClear(pending.active.messageId);
      this.#forcedStopReason = "error";
      this.#forcedError = {
        code: "completion_guard_failed",
        message: errorMessage(error),
        retryable: true,
      };
      return;
    }
    if (decision.allow) {
      await this.#finalizeAssistant(
        pending.active,
        pending.message,
        pending.blocks,
      );
      return;
    }

    await this.#publishProvisionalClear(pending.active.messageId);
    this.#guardRejections += 1;
    if (
      this.#guardRejections > this.#maxCompletionGuardRejections ||
      this.#turn >= this.#maxTurns
    ) {
      this.#forcedStopReason = "error";
      this.#forcedError = {
        code: "completion_guard_blocked",
        message: decision.message,
        retryable: true,
      };
      return;
    }
    const content = [
      "Trusted OpenDesign host completion review:",
      decision.message,
      "Continue the same run and satisfy this review before finishing.",
    ].join("\n");
    this.#trustedContinuations.push(content);
    requestContinuation({
      role: "user",
      content,
      timestamp: this.#now().getTime(),
    });
  }

  async #finalizeAssistant(
    active: ActiveAssistantMessage,
    message: AssistantMessage,
    blocks: AssistantTimelineBlock[],
  ): Promise<void> {
    await this.#append("message.assistant", {
      messageId: active.messageId,
      blocks,
      source: toResolvedIdentity(message, this.#request),
    });
    await this.#publish({
      type: "message.completed",
      runId: this.#request.runId,
      messageId: active.messageId,
      blocks,
    });
  }

  #publishProvisionalClear(messageId: string): Promise<void> {
    return this.#publish({
      type: "message.completed",
      runId: this.#request.runId,
      messageId,
      blocks: [],
    });
  }

  async #acceptToolEvent(
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
    const adapter = this.#toolAdapter;
    if (adapter === undefined) {
      throw new Error(
        "Pi tool events require the OpenDesign production tool adapter",
      );
    }
    if (event.type === "tool_execution_start") {
      const requested = adapter.beginToolCall(event);
      if (requested.duplicate) return;
      await this.#append("tool.requested", {
        toolCallId: requested.toolCallId,
        toolName: requested.toolName,
        input: requested.input,
        risk: requested.risk,
      });
      await this.#publish({
        type: "tool.requested",
        runId: this.#request.runId,
        toolCallId: requested.toolCallId,
        toolName: requested.toolName,
        input: requested.input,
        risk: requested.risk,
      });
      return;
    }
    if (event.type === "tool_execution_update") {
      const progress = adapter.updateToolCall(event);
      if (progress === undefined) return;
      await this.#append("tool.progress", progress);
      await this.#publish({
        type: "tool.progress",
        runId: this.#request.runId,
        ...progress,
      });
      return;
    }

    const terminal = adapter.endToolCall(event);
    if (terminal === undefined) {
      adapter.acknowledgeToolCall(event.toolCallId);
      return;
    }
    if (terminal.status === "failed") {
      await this.#recordToolFailure(terminal, () =>
        adapter.acknowledgeToolCall(event.toolCallId),
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
            ...(terminal.designRevision === undefined
              ? {}
              : { transactionId: terminal.designRevision.transactionId }),
          }),
    };
    await this.#append("tool.completed", completion);
    if (terminal.designRevision !== undefined) {
      await this.#append("design.revision", {
        documentId: this.#request.documentId,
        previousRevision: terminal.designRevision.previousRevision,
        revision: terminal.designRevision.revision,
        transactionId: terminal.designRevision.transactionId,
        toolCallId: terminal.toolCallId,
      });
    }
    adapter.acknowledgeToolCall(event.toolCallId);
    await this.#publish({
      type: "tool.completed",
      runId: this.#request.runId,
      ...completion,
    });
  }

  async #recordToolFailure(
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
      ...(failure.details === undefined ? {} : { details: failure.details }),
    };
    await this.#append("tool.failed", payload);
    acknowledge?.();
    await this.#publish({
      type: "tool.failed",
      runId: this.#request.runId,
      ...payload,
    });
  }

  async #recordApprovalRequested(
    approval: PiToolApprovalRequested,
  ): Promise<void> {
    await this.#append("approval.requested", {
      approvalId: approval.approvalId,
      toolCallId: approval.toolCallId,
      title: approval.title,
      summary: approval.summary,
    });
    await this.#publish({
      type: "approval.requested",
      runId: this.#request.runId,
      approvalId: approval.approvalId,
      toolCallId: approval.toolCallId,
      title: approval.title,
      summary: approval.summary,
    });
  }

  async #recordApprovalResolved(
    approval: PiToolApprovalResolved,
  ): Promise<void> {
    await this.#append("approval.resolved", approval, approval.resolvedAt);
    await this.#publish({
      type: "approval.resolved",
      runId: this.#request.runId,
      ...approval,
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

function snapshotRequest(request: AgentRunRequest): AgentRunRequest {
  return structuredClone(request);
}

function projectedInitialUserText(request: AgentRunRequest): string {
  const message = canonicalUserMessage(
    projectAgentRunPrompt(request),
    request.attachments ?? [],
  );
  if (typeof message.content === "string") return message.content;
  const text = message.content.find((block) => block.type === "text");
  if (!text)
    throw new Error("Canonical initial user message has no text block");
  return text.text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Completion review failed";
}
