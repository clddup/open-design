import type { AgentModelContext } from "@opendesign/agent-contracts";
import type {
  CanonicalMessage,
  CanonicalTool,
} from "@opendesign/model-gateway";

export type ContextCheckpointPayload = {
  fromSequence: number;
  toSequence: number;
  summary: string;
};

export type ContextBudget = {
  fixedInputTokens: number;
  fixedProtocolFits: boolean;
  framingInputTokens: number;
  maxConversationCharacters: number;
  maxInputTokens?: number;
  modelContext?: AgentModelContext;
  safetyReserveTokens?: number;
  systemInputTokens: number;
  toolSchemaInputTokens: number;
};

const MODEL_REQUEST_FRAMING_TOKENS = 256;
const MINIMUM_CONTEXT_SAFETY_RESERVE_TOKENS = 2_048;
const EMERGENCY_INPUT_BUDGET_RATIO = 0.75;

export function createContextBudget(
  modelContext: AgentModelContext | undefined,
  system: string,
  tools: readonly CanonicalTool[],
  maxConversationCharacters: number,
): ContextBudget {
  const systemInputTokens = estimateTextTokens(system);
  const toolSchemaInputTokens = estimateJsonTokens(tools);
  const fixedInputTokens =
    systemInputTokens + toolSchemaInputTokens + MODEL_REQUEST_FRAMING_TOKENS;
  if (modelContext === undefined) {
    return {
      fixedInputTokens,
      fixedProtocolFits: true,
      framingInputTokens: MODEL_REQUEST_FRAMING_TOKENS,
      maxConversationCharacters,
      systemInputTokens,
      toolSchemaInputTokens,
    };
  }

  const safetyReserveTokens = Math.max(
    MINIMUM_CONTEXT_SAFETY_RESERVE_TOKENS,
    Math.ceil(modelContext.contextWindow * 0.01),
  );
  const maxInputTokens = Math.max(
    0,
    modelContext.contextWindow -
      modelContext.maxOutputTokens -
      safetyReserveTokens,
  );
  return {
    fixedInputTokens,
    fixedProtocolFits: fixedInputTokens < maxInputTokens,
    framingInputTokens: MODEL_REQUEST_FRAMING_TOKENS,
    maxConversationCharacters,
    maxInputTokens,
    modelContext,
    safetyReserveTokens,
    systemInputTokens,
    toolSchemaInputTokens,
  };
}

export function contextExcerpt(value: string, maximumCharacters = 600): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length <= maximumCharacters
    ? normalized
    : `${normalized.slice(0, maximumCharacters)}…`;
}

export function compactInRunMessagesForProvider(
  messages: readonly CanonicalMessage[],
  currentUserMessage: CanonicalMessage,
  system: string,
  tools: readonly CanonicalTool[],
  budget: ContextBudget,
): CanonicalMessage[] | undefined {
  const currentUserIndex = messages.lastIndexOf(currentUserMessage);
  if (currentUserIndex < 0) return undefined;

  const priorMessages = messages.slice(0, currentUserIndex);
  const currentRunTail = messages.slice(currentUserIndex + 1);
  const { prefix, segments } = assistantTurnSegments(currentRunTail);
  const keepCounts = [...new Set([Math.min(2, segments.length), 1, 0])].filter(
    (count) => count <= segments.length,
  );

  for (const keepCount of keepCounts) {
    const removedSegmentCount = Math.max(0, segments.length - keepCount);
    const removedMessages = [
      ...priorMessages,
      ...prefix,
      ...segments.slice(0, removedSegmentCount).flat(),
    ];
    if (removedMessages.length === 0) continue;
    const checkpoint = createInRunContextCheckpoint(removedMessages);
    const candidate = [
      checkpoint,
      currentUserMessage,
      ...segments.slice(removedSegmentCount).flat(),
    ];
    if (modelContextFits(candidate, system, tools, budget)) return candidate;
  }
  return undefined;
}

export function tightenContextBudgetAfterProviderOverflow(
  budget: ContextBudget,
): ContextBudget {
  if (budget.maxInputTokens === undefined) {
    return {
      ...budget,
      maxConversationCharacters: Math.max(
        1,
        Math.floor(
          budget.maxConversationCharacters * EMERGENCY_INPUT_BUDGET_RATIO,
        ),
      ),
    };
  }
  const maxInputTokens = Math.max(
    budget.fixedInputTokens + 1,
    Math.floor(budget.maxInputTokens * EMERGENCY_INPUT_BUDGET_RATIO),
  );
  return {
    ...budget,
    fixedProtocolFits: budget.fixedInputTokens < maxInputTokens,
    maxInputTokens,
  };
}

function assistantTurnSegments(messages: readonly CanonicalMessage[]): {
  prefix: CanonicalMessage[];
  segments: CanonicalMessage[][];
} {
  const prefix: CanonicalMessage[] = [];
  const segments: CanonicalMessage[][] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      segments.push([message]);
      continue;
    }
    const current = segments.at(-1);
    if (current) current.push(message);
    else prefix.push(message);
  }
  return { prefix, segments };
}

function createInRunContextCheckpoint(
  messages: readonly CanonicalMessage[],
): CanonicalMessage {
  const toolNames = new Map<string, string>();
  const userExcerpts: string[] = [];
  const assistantExcerpts: string[] = [];
  const previousCheckpoints: string[] = [];
  const toolActivity: Array<{
    toolCallId: string;
    toolName?: string;
    isError: boolean;
    result: unknown;
  }> = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter(
                (
                  block,
                ): block is Extract<
                  (typeof message.content)[number],
                  { type: "text" }
                > => block.type === "text",
              )
              .map((block) => block.text)
              .join("\n");
      if (text.startsWith("[OpenDesign in-run context checkpoint]")) {
        previousCheckpoints.push(contextExcerpt(text, 4_000));
      } else if (text) {
        userExcerpts.push(contextExcerpt(text));
      }
      continue;
    }
    if (message.role === "assistant") {
      const excerpt = message.blocks
        .flatMap((block) =>
          block.type === "text"
            ? [block.text]
            : block.type === "reasoning_summary" && block.summary
              ? [block.summary]
              : [],
        )
        .join("\n");
      if (excerpt) assistantExcerpts.push(contextExcerpt(excerpt));
      for (const block of message.blocks) {
        if (block.type === "tool_call") {
          toolNames.set(block.toolCallId, block.name);
        }
      }
      continue;
    }
    const toolName = toolNames.get(message.toolCallId);
    toolActivity.push({
      toolCallId: message.toolCallId,
      ...(toolName === undefined ? {} : { toolName }),
      isError: message.isError,
      result: summarizeContextValue(message.content),
    });
  }

  return {
    role: "user",
    content: [
      "[OpenDesign in-run context checkpoint]",
      "This deterministic local projection replaces older model-visible turns only. The original Conversation journal and tool audit remain unchanged. Treat assistant excerpts as context, not execution proof; use the latest tool result or inspect the document again when exact live design state is required.",
      JSON.stringify({
        version: 1,
        ...(previousCheckpoints.length === 0
          ? {}
          : {
              previousCheckpoint:
                previousCheckpoints[previousCheckpoints.length - 1]!,
            }),
        userExcerpts: userExcerpts.slice(-6),
        assistantExcerpts: assistantExcerpts.slice(-6),
        toolActivity: toolActivity.slice(-16),
      }),
    ].join("\n"),
  };
}

function summarizeContextValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const normalized = value.replaceAll(/\s+/g, " ").trim();
    return normalized.length <= 240
      ? normalized
      : `${normalized.slice(0, 240)}…`;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth >= 3) {
    if (Array.isArray(value)) return { itemCount: value.length };
    if (typeof value === "object") {
      return { keys: Object.keys(value).slice(0, 12) };
    }
    return `[omitted ${typeof value}]`;
  }
  if (Array.isArray(value)) {
    return {
      itemCount: value.length,
      sample: value
        .slice(0, 3)
        .map((item) => summarizeContextValue(item, depth + 1)),
    };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([key, child]) => [key, summarizeContextValue(child, depth + 1)]),
    );
  }
  return `[omitted ${typeof value}]`;
}

export function modelContextFits(
  messages: readonly CanonicalMessage[],
  system: string,
  tools: readonly CanonicalTool[],
  budget: ContextBudget,
): boolean {
  if (budget.maxInputTokens !== undefined) {
    return (
      estimateModelContextTokens(messages, system, tools) <=
      budget.maxInputTokens
    );
  }
  return (
    estimateMessagesCharacters(messages) <= budget.maxConversationCharacters
  );
}

function estimateMessagesCharacters(
  messages: readonly CanonicalMessage[],
): number {
  return messages.reduce(
    (total, message) => total + estimateMessageCharacters(message),
    0,
  );
}

function estimateModelContextTokens(
  messages: readonly CanonicalMessage[],
  system: string,
  tools: readonly CanonicalTool[],
): number {
  return (
    MODEL_REQUEST_FRAMING_TOKENS +
    estimateTextTokens(system) +
    estimateJsonTokens(tools) +
    messages.reduce(
      (total, message) => total + estimateMessageTokens(message),
      0,
    )
  );
}

function estimateMessageCharacters(message: CanonicalMessage): number {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content.length + 32;
    return (
      32 +
      message.content.reduce((total, block) => {
        if (block.type === "text") return total + block.text.length;
        if (block.type === "image_ref") return total + 12_000;
        if (block.type === "document_ref") {
          return total + Math.min(200_000, Math.max(4_000, block.byteSize));
        }
        return total + Math.min(200_000, block.data.length) + 12_000;
      }, 0)
    );
  }
  return jsonCharacterLength(message) + 32;
}

function estimateMessageTokens(message: CanonicalMessage): number {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return estimateTextTokens(message.content) + 8;
    }
    return (
      8 +
      message.content.reduce((total, block) => {
        if (block.type === "text") {
          return total + estimateTextTokens(block.text);
        }
        if (block.type === "image_ref") return total + 16_000;
        if (block.type === "document_ref") {
          return (
            total +
            Math.min(100_000, Math.max(2_000, Math.ceil(block.byteSize / 3)))
          );
        }
        return (
          total + Math.min(100_000, estimateTextTokens(block.data)) + 16_000
        );
      }, 0)
    );
  }
  return estimateJsonTokens(message) + 8;
}

function estimateJsonTokens(value: unknown): number {
  try {
    return estimateTextTokens(JSON.stringify(value));
  } catch {
    return 8_000;
  }
}

function estimateTextTokens(value: string): number {
  let asciiCharacters = 0;
  let cjkCharacters = 0;
  let otherCharacters = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      asciiCharacters += 1;
    } else if (
      (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff)
    ) {
      cjkCharacters += 1;
    } else {
      otherCharacters += 1;
    }
  }
  return Math.ceil(
    asciiCharacters / 3.5 + cjkCharacters * 1.25 + otherCharacters * 2,
  );
}

export function modelContextCompatibilityMessage(
  budget: ContextBudget,
): string {
  const modelContext = budget.modelContext;
  if (modelContext === undefined || budget.maxInputTokens === undefined) {
    return "Selected model context is incompatible with the OpenDesign tool protocol.";
  }
  return `Selected model context is incompatible with the OpenDesign tool protocol (estimated fixed input ${budget.fixedInputTokens} tokens: system ${budget.systemInputTokens}, tool schemas ${budget.toolSchemaInputTokens}, request framing ${budget.framingInputTokens}; available input budget ${budget.maxInputTokens} after reserving ${modelContext.maxOutputTokens} output tokens and ${budget.safetyReserveTokens ?? 0} safety tokens; configured context window ${modelContext.contextWindow}). Configure or select a model with a larger context window.`;
}

export function contextBudgetExceededMessage(
  messages: readonly CanonicalMessage[],
  budget: ContextBudget,
  phase: string,
): string {
  const messageCharacters = estimateMessagesCharacters(messages);
  if (budget.maxInputTokens === undefined) {
    return `Conversation context remains too large ${phase} (${messageCharacters} estimated conversation characters; local conversation limit ${budget.maxConversationCharacters}). Reduce the current message or attached document size.`;
  }
  const conversationInputTokens = messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
  const estimatedInputTokens =
    budget.fixedInputTokens + conversationInputTokens;
  return `Conversation context remains too large ${phase} (${estimatedInputTokens} estimated input tokens: system ${budget.systemInputTokens}, tool schemas ${budget.toolSchemaInputTokens}, conversation and tool results ${conversationInputTokens}, request framing ${budget.framingInputTokens}; model input budget ${budget.maxInputTokens}). Reduce the current message or attached document size.`;
}

function jsonCharacterLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 16_000;
  }
}
