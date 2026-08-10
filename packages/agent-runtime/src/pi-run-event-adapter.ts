import type { AgentEvent as PiAgentEvent } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AssistantTimelineBlock,
  RunStopReason,
} from "@opendesign/agent-contracts";
import type {
  ModelApiFormat,
  ResolvedModelIdentity,
} from "@opendesign/model-gateway";
import type { SessionStore } from "@opendesign/session-store";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { AgentRunRequest } from "./index.js";
import { appendRunJournalEvent } from "./run-journal-writer.js";

export interface PiRunEventAdapterOptions {
  request: AgentRunRequest;
  sessionStore: SessionStore;
  emit: (event: AgentEvent) => Promise<void> | void;
  now?: () => Date;
}

interface ActiveAssistantMessage {
  messageId: string;
  turn: number;
}

/**
 * Projects Pi's ephemeral loop events into OpenDesign's versioned renderer
 * events and durable Conversation journal.
 *
 * This stage intentionally accepts only model/message lifecycle events. Tool
 * events fail closed until the production ToolExecutor adapter can attach
 * trusted risk, approval, revision and attachment metadata in migration stage
 * 2. The adapter never creates a Pi session or a second durable transcript.
 */
export class PiRunEventAdapter {
  readonly #emit: PiRunEventAdapterOptions["emit"];
  readonly #now: () => Date;
  readonly #request: AgentRunRequest;
  readonly #sessionStore: SessionStore;
  #activeAssistant: ActiveAssistantMessage | undefined;
  #activeUserMessage = false;
  #ended = false;
  #initialPromptConsumed = false;
  #lastAssistantError: string | undefined;
  #lastAssistantHadToolCalls = false;
  #lastAssistantStopReason: AssistantMessage["stopReason"] | undefined;
  #started = false;
  #startedAt = "";
  #turn = 0;
  #userMessageSequence = 0;

  constructor(options: PiRunEventAdapterOptions) {
    this.#request = snapshotRequest(options.request);
    this.#sessionStore = options.sessionStore;
    this.#emit = options.emit;
    this.#now = options.now ?? (() => new Date());
  }

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
    if (
      event.type === "tool_execution_start" ||
      event.type === "tool_execution_update" ||
      event.type === "tool_execution_end"
    ) {
      throw new Error(
        "Pi tool events require the OpenDesign production tool adapter",
      );
    }
    if (event.type === "agent_end") {
      await this.#endRun();
    }
  }

  async #startRun(): Promise<void> {
    if (this.#started) throw new Error("Pi emitted duplicate agent_start");
    this.#startedAt = this.#now().toISOString();
    await this.#append(
      "run.state",
      {
        status: "started",
        startedAt: this.#startedAt,
        modelSelection: this.#request.modelSelection,
      },
      this.#startedAt,
    );
    this.#started = true;
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
    await this.#publish({
      type: "run.started",
      runId: this.#request.runId,
      startedAt: this.#startedAt,
    });
  }

  #startMessage(message: PiAgentEventMessage): void {
    if (message.role === "toolResult") {
      throw new Error(
        "Pi tool-result messages require the OpenDesign production tool adapter",
      );
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
      turn: this.#turn,
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
      throw new RangeError("Pi text delta exceeds AgentEvent 3.4 limits");
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
      throw new Error(
        "Pi tool-result messages require the OpenDesign production tool adapter",
      );
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
    if (
      assistantMessage.stopReason === "error" ||
      assistantMessage.stopReason === "aborted"
    ) {
      return;
    }

    const blocks = toTimelineBlocks(assistantMessage, active.messageId);
    await this.#append("message.assistant", {
      messageId: active.messageId,
      blocks,
      source: toResolvedIdentity(assistantMessage, this.#request),
    });
    await this.#publish({
      type: "message.completed",
      runId: this.#request.runId,
      messageId: active.messageId,
      blocks,
    });
  }

  async #persistUserMessage(message: UserMessage): Promise<void> {
    const content = userText(message);
    if (!this.#initialPromptConsumed) {
      this.#initialPromptConsumed = true;
      if (content !== this.#request.prompt) {
        throw new Error(
          "Pi initial prompt does not match the durable run request",
        );
      }
      return;
    }
    this.#userMessageSequence += 1;
    await this.#append("message.user", {
      messageId: `${this.#request.runId}_user_${this.#userMessageSequence}`,
      content,
      documentId: this.#request.documentId,
      revision: this.#request.revision,
      scope: this.#request.scope,
      mutationTarget: this.#request.mutationTarget,
    });
  }

  async #endRun(): Promise<void> {
    if (this.#activeAssistant !== undefined || this.#activeUserMessage) {
      throw new Error("Pi ended a run with an active message");
    }
    const stopReason = toRunStopReason(
      this.#lastAssistantStopReason,
      this.#lastAssistantHadToolCalls,
    );
    if (stopReason === "error") {
      const invalidToolStop =
        this.#lastAssistantStopReason === "toolUse" &&
        !this.#lastAssistantHadToolCalls;
      await this.#publish({
        type: "agent.error",
        code: invalidToolStop ? "invalid_model_response" : "run_failed",
        message: invalidToolStop
          ? "Model stopped for tool use without a tool call"
          : (this.#lastAssistantError ?? "Pi Agent run failed"),
        runId: this.#request.runId,
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
}

type PiAgentEventMessage = Extract<
  PiAgentEvent,
  { type: "message_start" | "message_end" }
>["message"];

function toTimelineBlocks(
  message: AssistantMessage,
  messageId: string,
): AssistantTimelineBlock[] {
  return message.content.flatMap((block, index): AssistantTimelineBlock[] => {
    if (block.type === "text") {
      return [
        {
          blockId: blockId(messageId, index),
          type: "text",
          text: block.text,
        },
      ];
    }
    if (block.type === "thinking") {
      const omitted = block.redacted === true || block.thinking.length === 0;
      return [
        {
          blockId: blockId(messageId, index),
          type: "reasoning_summary",
          status: omitted ? "omitted" : "completed",
          ...(omitted ? {} : { summary: block.thinking }),
        },
      ];
    }
    return [];
  });
}

function toResolvedIdentity(
  message: AssistantMessage,
  request: AgentRunRequest,
): ResolvedModelIdentity {
  return {
    providerId: message.provider,
    modelId: message.model,
    apiFormat: toModelApiFormat(message.api),
    ...(request.modelSelection.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: request.modelSelection.reasoningEffort }),
    ...(message.responseId === undefined
      ? {}
      : { responseId: message.responseId }),
  };
}

function toModelApiFormat(api: AssistantMessage["api"]): ModelApiFormat {
  if (api === "openai-responses") return "openai-responses";
  if (api === "openai-completions") return "openai-chat-completions";
  if (api === "anthropic-messages") return "anthropic-messages";
  throw new TypeError(`Unsupported Pi model API in run journal: ${api}`);
}

function toRunStopReason(
  stopReason: AssistantMessage["stopReason"] | undefined,
  hadToolCalls: boolean,
): RunStopReason {
  if (stopReason === "aborted") return "cancelled";
  if (stopReason === "length") return "budget";
  if (stopReason === "error" || stopReason === undefined) return "error";
  if (stopReason === "toolUse" && !hadToolCalls) return "error";
  return "complete";
}

function userText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) => {
      if (block.type === "image") {
        throw new TypeError(
          "Inline Pi user images cannot be persisted in the OpenDesign journal",
        );
      }
      return block.text;
    })
    .join("\n");
}

function requireAssistantMessage(
  message: PiAgentEventMessage,
): AssistantMessage {
  if (
    message.role !== "assistant" ||
    !("stopReason" in message) ||
    !("content" in message) ||
    !("api" in message)
  ) {
    throw new Error("Pi emitted a non-model assistant message");
  }
  return message;
}

function blockId(messageId: string, contentIndex: number): string {
  return `${messageId}_block_${contentIndex}`;
}

function snapshotRequest(request: AgentRunRequest): AgentRunRequest {
  return structuredClone(request);
}
