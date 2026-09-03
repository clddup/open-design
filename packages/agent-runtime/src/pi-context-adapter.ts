import {
  isAgentAttachment,
  type AgentAttachment,
} from "@opendesign/agent-contracts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Message, Model, UserMessage } from "@earendil-works/pi-ai";
import type {
  CanonicalMessage,
  CanonicalTool,
  ModelError,
  ModelRequest,
} from "@opendesign/model-gateway";
import type { SessionStore } from "@opendesign/session-store";
import {
  compactInRunMessagesForProvider,
  contextBudgetExceededMessage,
  createContextBudget,
  modelContextCompatibilityMessage,
  modelContextFits,
  tightenContextBudgetAfterProviderOverflow,
  type ContextBudget,
} from "./context-budget.js";
import { planContextCompaction } from "./context-checkpoint.js";
import {
  canonicalUserMessage,
  restoreModelMessages,
} from "./model-message-projection.js";
import {
  canonicalUserParts,
  collectCanonicalToolNames,
  emptyUsage,
  modelResultText,
  toPiApi,
  toPiAssistantBlock,
} from "./pi-context-message-projection.js";
import {
  projectPiMessageToCanonical,
  type PiContextFailure,
  type PiModelContextProjectionPort,
} from "./pi-model-gateway-adapter.js";
import { appendRunJournalEvent } from "./run-journal-writer.js";
import { projectAgentRunPrompt, type AgentRunRequest } from "./run-request.js";
import { toCanonicalTool, type AgentToolDefinition } from "./runtime-ports.js";

const DEFAULT_MAX_CONTEXT_CHARACTERS = 240_000;

export interface PrepareOpenDesignPiContextOptions {
  request: AgentRunRequest;
  sessionStore: SessionStore;
  systemPrompt: string;
  toolDefinitions: readonly AgentToolDefinition[];
  model: Model<Api>;
  maxContextCharacters?: number;
  now?: () => Date;
}

export interface PreparedOpenDesignPiContext {
  context: OpenDesignPiContextAdapter;
  initialMessages: Message[];
  promptMessage: UserMessage;
  systemPrompt: string;
  priorToolCallIds: string[];
  compactedThroughSequence?: number;
}

export interface PiContextFailurePort {
  consumeFailure(): PiContextFailure | undefined;
}

/**
 * Builds Pi's disposable model transcript from the OpenDesign Conversation
 * journal. The journal remains the only durable transcript; Pi messages are a
 * run-local projection and never contain inline attachment bytes.
 */
export async function prepareOpenDesignPiContext(
  options: PrepareOpenDesignPiContextOptions,
): Promise<PreparedOpenDesignPiContext> {
  const maxContextCharacters =
    options.maxContextCharacters ?? DEFAULT_MAX_CONTEXT_CHARACTERS;
  if (!Number.isInteger(maxContextCharacters) || maxContextCharacters < 1) {
    throw new RangeError("Pi context character limit must be positive");
  }

  const request = snapshotRequest(options.request);
  const tools = options.toolDefinitions.map(toCanonicalTool);
  const currentMessage = canonicalUserMessage(
    projectAgentRunPrompt(request),
    request.attachments ?? [],
  );
  const budget = createContextBudget(
    request.modelContext,
    options.systemPrompt,
    tools,
    maxContextCharacters,
  );
  let priorEvents = await options.sessionStore.read(request.sessionId);
  let compactedThroughSequence: number | undefined;

  if (budget.fixedProtocolFits) {
    const compaction = planContextCompaction(priorEvents, {
      budget,
      currentMessage,
      system: options.systemPrompt,
      tools,
    });
    if (compaction !== undefined) {
      await appendRunJournalEvent(
        options.sessionStore,
        request,
        "context.compacted",
        compaction,
        (options.now ?? (() => new Date()))().toISOString(),
      );
      compactedThroughSequence = compaction.toSequence;
      priorEvents = await options.sessionStore.read(request.sessionId);
    }
  }

  const restored = restoreModelMessages(priorEvents);
  const priorToolCallIds = collectPriorToolCallIds(priorEvents);
  const context = new OpenDesignPiContextAdapter({
    budget,
    maxContextCharacters,
    model: options.model,
    system: options.systemPrompt,
    tools,
  });
  const initialMessages = context.projectCanonicalMessages(restored);
  const promptMessage = context.projectCanonicalUserMessage(currentMessage);
  context.setCurrentPrompt(promptMessage);

  if (!budget.fixedProtocolFits) {
    context.fail(
      "model_context_incompatible",
      modelContextCompatibilityMessage(budget),
    );
  } else if (
    !modelContextFits(
      [...restored, currentMessage],
      options.systemPrompt,
      tools,
      budget,
    )
  ) {
    context.fail(
      "context_budget_exceeded",
      contextBudgetExceededMessage(
        [...restored, currentMessage],
        budget,
        "after local compaction",
      ),
    );
  }

  return {
    context,
    initialMessages,
    promptMessage,
    systemPrompt: options.systemPrompt,
    priorToolCallIds,
    ...(compactedThroughSequence === undefined
      ? {}
      : { compactedThroughSequence }),
  };
}

interface OpenDesignPiContextAdapterOptions {
  budget: ContextBudget;
  maxContextCharacters: number;
  model: Model<Api>;
  system: string;
  tools: readonly CanonicalTool[];
}

/**
 * Shared port for Pi transformContext, the ModelGateway bridge and the run
 * event adapter. Attachment references stay out-of-band in a WeakMap and are
 * materialized only as canonical image_ref/document_ref blocks for Main.
 */
export class OpenDesignPiContextAdapter
  implements PiModelContextProjectionPort, PiContextFailurePort
{
  readonly #attachments = new WeakMap<object, readonly AgentAttachment[]>();
  #budget: ContextBudget;
  readonly #maxContextCharacters: number;
  readonly #model: Model<Api>;
  readonly #system: string;
  #tools: readonly CanonicalTool[];
  #currentPrompt: UserMessage | undefined;
  #pendingFailure: PiContextFailure | undefined;
  #providerAnchorIndex: number | undefined;
  #reportedFailure: PiContextFailure | undefined;
  #providerTurn = 0;

  constructor(options: OpenDesignPiContextAdapterOptions) {
    this.#budget = options.budget;
    this.#maxContextCharacters = options.maxContextCharacters;
    this.#model = options.model;
    this.#system = options.system;
    this.#tools = [...options.tools];
  }

  readonly transformContext = (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ): Promise<AgentMessage[]> =>
    Promise.resolve(this.#transformContext(messages, signal));

  #transformContext(
    messages: AgentMessage[],
    signal?: AbortSignal,
  ): AgentMessage[] {
    if (signal?.aborted || this.#pendingFailure !== undefined) return messages;
    this.#providerAnchorIndex = undefined;
    this.#providerTurn += 1;
    try {
      if (!this.#budget.fixedProtocolFits) {
        this.fail(
          "model_context_incompatible",
          modelContextCompatibilityMessage(this.#budget),
        );
        return messages;
      }
      const llmMessages = requirePiMessages(messages);
      for (const message of llmMessages) this.#captureToolAttachments(message);
      const projected: CanonicalMessage[] = [];
      let currentCanonical: CanonicalMessage | undefined;
      for (const [index, message] of llmMessages.entries()) {
        const messageProjection = projectPiMessageToCanonical(
          message,
          index,
          this,
        );
        if (message === this.#currentPrompt) {
          currentCanonical = messageProjection[0];
        }
        projected.push(...messageProjection);
      }
      const currentPrompt = this.#currentPrompt;
      if (currentPrompt === undefined) {
        throw new Error("Pi context does not have a current prompt anchor");
      }
      if (llmMessages.indexOf(currentPrompt) < 0) {
        throw new Error("Pi context lost the current prompt anchor");
      }
      if (currentCanonical === undefined) {
        throw new Error("Pi current prompt projection is empty");
      }
      if (
        modelContextFits(projected, this.#system, this.#tools, this.#budget)
      ) {
        this.#providerAnchorIndex = projected.indexOf(currentCanonical);
        return messages;
      }

      const compacted = compactInRunMessagesForProvider(
        projected,
        currentCanonical,
        this.#system,
        this.#tools,
        this.#budget,
      );
      if (compacted === undefined) {
        this.fail(
          "context_budget_exceeded",
          contextBudgetExceededMessage(
            projected,
            this.#budget,
            `before provider turn ${this.#providerTurn}`,
          ),
        );
        return messages;
      }
      this.#providerAnchorIndex = compacted.indexOf(currentCanonical);
      return this.projectCanonicalMessages(compacted);
    } catch (error) {
      const failure = toContextFailure(error);
      this.fail(failure.code, failure.message);
      return messages;
    }
  }

  attachmentsFor(message: Message): readonly AgentAttachment[] {
    this.#captureToolAttachments(message);
    return this.#attachments.get(message) ?? [];
  }

  recoverProviderContextOverflow(
    request: ModelRequest,
    failure: ModelError,
  ): ModelRequest | undefined {
    if (failure.code !== "context_too_large") return undefined;
    const anchorIndex = this.#providerAnchorIndex;
    const currentMessage =
      anchorIndex === undefined ? undefined : request.messages[anchorIndex];
    if (currentMessage?.role !== "user") return undefined;

    const tighterBudget = tightenContextBudgetAfterProviderOverflow(
      this.#budget,
    );
    const compacted = compactInRunMessagesForProvider(
      request.messages,
      currentMessage,
      request.system,
      request.tools,
      tighterBudget,
    );
    if (
      compacted === undefined ||
      JSON.stringify(compacted).length >=
        JSON.stringify(request.messages).length
    ) {
      return undefined;
    }

    this.#budget = tighterBudget;
    this.#providerAnchorIndex = compacted.indexOf(currentMessage);
    return { ...request, messages: compacted };
  }

  beforeProviderTurn(): PiContextFailure | undefined {
    const failure = this.#pendingFailure;
    if (failure !== undefined) {
      this.#pendingFailure = undefined;
      this.#reportedFailure = failure;
    }
    return failure;
  }

  consumeFailure(): PiContextFailure | undefined {
    const failure = this.#reportedFailure;
    this.#reportedFailure = undefined;
    return failure;
  }

  fail(code: string, message: string): void {
    if (this.#pendingFailure === undefined) {
      this.#pendingFailure = { code, message };
    }
  }

  setCurrentPrompt(message: UserMessage): void {
    this.#currentPrompt = message;
  }

  setTools(tools: readonly CanonicalTool[]): void {
    this.#tools = tools.map((tool) => structuredClone(tool));
    this.#budget = createContextBudget(
      this.#budget.modelContext,
      this.#system,
      this.#tools,
      this.#maxContextCharacters,
    );
  }

  projectCanonicalUserMessage(message: CanonicalMessage): UserMessage {
    if (message.role !== "user") {
      throw new TypeError("Expected a canonical user message");
    }
    const projected = this.#projectCanonicalMessage(message, new Map());
    if (projected.role !== "user") {
      throw new Error("Canonical user projection changed role");
    }
    return projected;
  }

  projectCanonicalMessages(messages: readonly CanonicalMessage[]): Message[] {
    const toolNames = collectCanonicalToolNames(messages);
    return messages.map((message) =>
      this.#projectCanonicalMessage(message, toolNames),
    );
  }

  #projectCanonicalMessage(
    message: CanonicalMessage,
    toolNames: ReadonlyMap<string, string>,
  ): Message {
    const timestamp = Date.now();
    if (message.role === "user") {
      const { attachments, text } = canonicalUserParts(message);
      const projected: UserMessage = { role: "user", content: text, timestamp };
      if (attachments.length > 0) {
        this.#attachments.set(
          projected,
          attachments.map((attachment) => ({ ...attachment })),
        );
      }
      return projected;
    }
    if (message.role === "tool") {
      return {
        role: "toolResult",
        toolCallId: message.toolCallId,
        toolName:
          message.toolName ?? toolNames.get(message.toolCallId) ?? "tool",
        content: [{ type: "text", text: modelResultText(message.content) }],
        isError: message.isError,
        timestamp,
      };
    }

    const content = message.blocks.map(toPiAssistantBlock);
    const source = message.source;
    return {
      role: "assistant",
      content,
      api: source ? toPiApi(source.apiFormat) : this.#model.api,
      provider: source?.providerId ?? this.#model.provider,
      model: source?.modelId ?? this.#model.id,
      usage: emptyUsage(),
      stopReason: content.some((block) => block.type === "toolCall")
        ? "toolUse"
        : "stop",
      timestamp,
      ...(source?.responseId === undefined
        ? {}
        : { responseId: source.responseId }),
    };
  }

  #captureToolAttachments(message: Message): void {
    if (message.role !== "toolResult" || this.#attachments.has(message)) return;
    const details: unknown = message.details;
    if (!details || typeof details !== "object" || Array.isArray(details)) {
      return;
    }
    const candidates = (details as { attachments?: unknown }).attachments;
    if (!Array.isArray(candidates) || !candidates.every(isAgentAttachment)) {
      return;
    }
    const modelAttachments = candidates.filter(
      (attachment) => !attachment.attachmentId.startsWith("svg_"),
    );
    if (modelAttachments.length === 0) return;
    this.#attachments.set(
      message,
      modelAttachments.map((attachment) => ({ ...attachment })),
    );
  }
}

function requirePiMessages(messages: AgentMessage[]): Message[] {
  if (
    !messages.every(
      (message): message is Message =>
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "toolResult",
    )
  ) {
    throw new TypeError("Pi context contains an unsupported custom message");
  }
  return messages;
}

function toContextFailure(error: unknown): PiContextFailure {
  return {
    code: "context_projection_failed",
    message:
      error instanceof Error
        ? error.message
        : "OpenDesign context projection failed",
  };
}

function snapshotRequest(request: AgentRunRequest): AgentRunRequest {
  return structuredClone(request);
}

function collectPriorToolCallIds(
  events: readonly { type: string; payload: unknown }[],
): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool.requested") continue;
    const toolCallId = (event.payload as { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId === "string" && toolCallId.length > 0) {
      ids.add(toolCallId);
    }
  }
  return [...ids];
}
