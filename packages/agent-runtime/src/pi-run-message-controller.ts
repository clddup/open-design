import type { AgentEvent as PiAgentEvent } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AgentRunFailure,
  AssistantTimelineBlock,
  RunStopReason,
} from "@opendesign/agent-contracts";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type {
  AgentToolCallRecord,
  AgentUnresolvedDesignWriteFailure,
  CompletionGuardPort,
} from "./completion-guard.js";
import { canonicalUserMessage } from "./model-message-projection.js";
import {
  blockId,
  generatedTokens,
  requireAssistantMessage,
  toResolvedIdentity,
  toTimelineBlocks,
  userText,
  type PiAgentEventMessage,
} from "./pi-run-event-messages.js";
import { projectAgentRunPrompt, type AgentRunRequest } from "./run-request.js";
import type { appendRunJournalEvent } from "./run-journal-writer.js";

type AppendJournal = (
  type: Parameters<typeof appendRunJournalEvent>[2],
  payload: unknown,
  createdAt?: string,
) => Promise<number>;

interface ActiveAssistantMessage {
  messageId: string;
}

interface PendingCompletion {
  active: ActiveAssistantMessage;
  blocks: AssistantTimelineBlock[];
  message: AssistantMessage;
}

export interface PiRunMessageControllerOptions {
  append: AppendJournal;
  completionGuard?: CompletionGuardPort;
  currentRevision: () => number;
  maxCompletionGuardRejections: number;
  maxGeneratedTokens: number;
  maxTurns: number;
  now: () => Date;
  publish: (event: AgentEvent) => Promise<void>;
  request: Readonly<AgentRunRequest>;
  requestContinuation?: (message: UserMessage) => void;
  toolCallRecords: () => readonly AgentToolCallRecord[];
  toolsEnabled: boolean;
  unresolvedDesignWriteFailure: () =>
    Readonly<AgentUnresolvedDesignWriteFailure> | undefined;
}

export class PiRunMessageController {
  readonly #options: PiRunMessageControllerOptions;
  #activeAssistant: ActiveAssistantMessage | undefined;
  #activeToolResultCallId: string | undefined;
  #activeUserMessage = false;
  #forcedError: AgentRunFailure | undefined;
  #forcedStopReason: RunStopReason | undefined;
  #generatedTokens = 0;
  #guardRejections = 0;
  #initialPromptConsumed = false;
  #lastAssistantError: string | undefined;
  #lastAssistantHadToolCalls = false;
  #lastAssistantStopReason: AssistantMessage["stopReason"] | undefined;
  #pendingCompletion: PendingCompletion | undefined;
  #stopAfterTurn = false;
  readonly #trustedContinuations: string[] = [];
  #turn = 0;
  #userMessageSequence = 0;

  constructor(options: PiRunMessageControllerOptions) {
    this.#options = options;
  }

  get forcedError(): AgentRunFailure | undefined {
    return this.#forcedError;
  }

  get forcedStopReason(): RunStopReason | undefined {
    return this.#forcedStopReason;
  }

  get lastAssistantError(): string | undefined {
    return this.#lastAssistantError;
  }

  get lastAssistantHadToolCalls(): boolean {
    return this.#lastAssistantHadToolCalls;
  }

  get lastAssistantStopReason(): AssistantMessage["stopReason"] | undefined {
    return this.#lastAssistantStopReason;
  }

  get stopAfterTurn(): boolean {
    return this.#stopAfterTurn;
  }

  start(message: PiAgentEventMessage): void {
    if (message.role === "toolResult") {
      if (!this.#options.toolsEnabled) {
        throw new Error(
          "Pi tool-result messages require the OpenDesign production tool adapter",
        );
      }
      if (this.#activeToolResultCallId) {
        throw new Error("Pi started overlapping tool-result messages");
      }
      this.#activeToolResultCallId = message.toolCallId;
      return;
    }
    if (message.role === "user") {
      if (this.#activeUserMessage || this.#activeAssistant) {
        throw new Error("Pi started overlapping messages");
      }
      this.#activeUserMessage = true;
      return;
    }
    requireAssistantMessage(message);
    if (this.#activeAssistant || this.#activeUserMessage) {
      throw new Error("Pi started overlapping messages");
    }
    this.#turn += 1;
    this.#activeAssistant = {
      messageId: `${this.#options.request.runId}_assistant_${this.#turn}`,
    };
  }

  async update(
    event: Extract<PiAgentEvent, { type: "message_update" }>,
  ): Promise<void> {
    const message = requireAssistantMessage(event.message);
    const active = this.#activeAssistant;
    if (!active) {
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
    await this.#options.publish({
      type: "message.delta",
      runId: this.#options.request.runId,
      messageId: active.messageId,
      blockId: blockId(active.messageId, update.contentIndex),
      delta: update.delta,
    });
  }

  async end(message: PiAgentEventMessage): Promise<void> {
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
    await this.#endAssistant(requireAssistantMessage(message));
  }

  async endTurn(
    event: Extract<PiAgentEvent, { type: "turn_end" }>,
  ): Promise<void> {
    const message = requireAssistantMessage(event.message);
    const hasToolCalls = message.content.some(
      (block) => block.type === "toolCall",
    );
    if (this.#turn >= this.#options.maxTurns) {
      this.#stopAfterTurn = true;
      if (hasToolCalls) this.#forcedStopReason = "budget";
    }
    const pending = this.#pendingCompletion;
    if (!pending) return;
    this.#pendingCompletion = undefined;
    const guard = this.#options.completionGuard;
    const requestContinuation = this.#options.requestContinuation;
    if (!guard || !requestContinuation) {
      throw new Error("Pi completion review dependencies became unavailable");
    }
    let decision;
    try {
      const unresolved = this.#options.unresolvedDesignWriteFailure();
      decision = await guard.review({
        request: this.#options.request,
        currentRevision: this.#options.currentRevision(),
        turn: this.#turn,
        rejectionCount: this.#guardRejections,
        toolCalls: this.#options.toolCallRecords(),
        ...(unresolved ? { unresolvedDesignWriteFailure: unresolved } : {}),
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
      this.#guardRejections > this.#options.maxCompletionGuardRejections ||
      this.#turn >= this.#options.maxTurns
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
      timestamp: this.#options.now().getTime(),
    });
  }

  async prepareEnd(cancellationRequested: boolean): Promise<void> {
    if (this.#activeAssistant || this.#activeUserMessage) {
      throw new Error("Pi ended a run with an active message");
    }
    if (this.#pendingCompletion) {
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
    if (this.#activeToolResultCallId) {
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
  }

  async #endAssistant(message: AssistantMessage): Promise<void> {
    const active = this.#activeAssistant;
    if (!active) {
      throw new Error("Pi ended an assistant message before message_start");
    }
    this.#activeAssistant = undefined;
    if (message.stopReason === "pending" || message.stopReason === "deferred") {
      throw new Error(
        `Pi ended an assistant message with ${message.stopReason}`,
      );
    }
    this.#lastAssistantStopReason = message.stopReason;
    this.#lastAssistantError = message.errorMessage;
    this.#lastAssistantHadToolCalls = message.content.some(
      (block) => block.type === "toolCall",
    );
    this.#generatedTokens += generatedTokens(message);
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return;
    }
    const blocks = toTimelineBlocks(message, active.messageId);
    const canReview =
      this.#options.completionGuard &&
      message.stopReason === "stop" &&
      !this.#lastAssistantHadToolCalls &&
      this.#generatedTokens <= this.#options.maxGeneratedTokens;
    if (canReview) {
      this.#pendingCompletion = { active, blocks, message };
      return;
    }
    await this.#finalizeAssistant(active, message, blocks);
    if (
      message.stopReason === "length" ||
      this.#generatedTokens > this.#options.maxGeneratedTokens
    ) {
      this.#forcedStopReason = "budget";
    }
  }

  async #persistUserMessage(message: UserMessage): Promise<void> {
    const content = userText(message);
    if (!this.#initialPromptConsumed) {
      this.#initialPromptConsumed = true;
      if (content !== projectedInitialUserText(this.#options.request)) {
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
    await this.#options.append("message.user", {
      messageId: `${this.#options.request.runId}_user_${this.#userMessageSequence}`,
      content,
      documentId: this.#options.request.documentId,
      revision: this.#options.currentRevision(),
      scope: this.#options.request.scope,
      mutationTarget: this.#options.request.mutationTarget,
    });
  }

  async #finalizeAssistant(
    active: ActiveAssistantMessage,
    message: AssistantMessage,
    blocks: AssistantTimelineBlock[],
  ): Promise<void> {
    await this.#options.append("message.assistant", {
      messageId: active.messageId,
      blocks,
      source: toResolvedIdentity(message, this.#options.request),
    });
    await this.#options.publish({
      type: "message.completed",
      runId: this.#options.request.runId,
      messageId: active.messageId,
      blocks,
    });
  }

  #publishProvisionalClear(messageId: string): Promise<void> {
    return this.#options.publish({
      type: "message.completed",
      runId: this.#options.request.runId,
      messageId,
      blocks: [],
    });
  }
}

function projectedInitialUserText(request: Readonly<AgentRunRequest>): string {
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
