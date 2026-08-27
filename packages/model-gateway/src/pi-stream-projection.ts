import type {
  AssistantMessage,
  AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai";
import type {
  CanonicalStreamEvent,
  ModelError,
  ModelStopReason,
  ModelUsage,
} from "./canonical-wire.js";

export function mapPiEvent(
  event: AssistantMessageEvent,
  attemptId: string,
): CanonicalStreamEvent[] {
  if (event.type === "start") return [];
  const blockId = `${attemptId}_block_${"contentIndex" in event ? event.contentIndex : 0}`;
  if (event.type === "text_start") {
    return [{ type: "block.started", attemptId, blockId, kind: "text" }];
  }
  if (event.type === "text_delta") {
    return [{ type: "block.delta", attemptId, blockId, delta: event.delta }];
  }
  if (event.type === "text_end") {
    return [
      {
        type: "block.completed",
        attemptId,
        block: { id: blockId, type: "text", text: event.content },
      },
    ];
  }
  if (event.type === "thinking_start") {
    return [
      {
        type: "block.started",
        attemptId,
        blockId,
        kind: "reasoning_summary",
      },
    ];
  }
  if (event.type === "thinking_delta") {
    return [{ type: "block.delta", attemptId, blockId, delta: event.delta }];
  }
  if (event.type === "thinking_end") {
    const content = event.partial.content[event.contentIndex];
    return [
      {
        type: "block.completed",
        attemptId,
        block: {
          id: blockId,
          type: "reasoning_summary",
          status: event.content ? "completed" : "omitted",
          ...(event.content ? { summary: event.content } : {}),
          ...(content?.type === "thinking" && content.thinkingSignature
            ? { signature: content.thinkingSignature }
            : {}),
        },
      },
    ];
  }
  if (event.type === "toolcall_start") {
    return [{ type: "block.started", attemptId, blockId, kind: "tool_call" }];
  }
  if (event.type === "toolcall_delta") {
    return [{ type: "block.delta", attemptId, blockId, delta: event.delta }];
  }
  if (event.type === "toolcall_end") {
    return [
      {
        type: "block.completed",
        attemptId,
        block: {
          id: blockId,
          type: "tool_call",
          toolCallId: event.toolCall.id,
          name: event.toolCall.name,
          input: event.toolCall.arguments,
        },
      },
    ];
  }
  if (event.type === "done") {
    return [
      {
        type: "attempt.completed",
        attemptId,
        stopReason: mapPiStopReason(event.message.stopReason),
        ...(event.message.rawStopReason
          ? { providerStopReason: event.message.rawStopReason }
          : {}),
        ...(event.message.responseId
          ? { providerRequestId: event.message.responseId }
          : {}),
        usage: toCanonicalUsage(event.message),
      },
    ];
  }
  return [
    {
      type: "attempt.failed",
      attemptId,
      error: {
        code: event.reason === "aborted" ? "cancelled" : "provider_error",
        message: event.error.errorMessage ?? "Model provider request failed",
        retryable:
          event.reason !== "aborted" &&
          isRetryableProviderFailureMessage(
            event.error.errorMessage ?? "Model provider request failed",
          ),
        provider: event.error.provider,
        ...(event.error.responseId
          ? { providerRequestId: event.error.responseId }
          : {}),
      },
    },
  ];
}

function toCanonicalUsage(message: AssistantMessage): ModelUsage {
  return {
    inputTokens: message.usage.input,
    outputTokens: message.usage.output,
    cacheReadTokens: message.usage.cacheRead,
    cacheWriteTokens: message.usage.cacheWrite,
    reasoningTokens: message.usage.reasoning ?? 0,
    costUsd: message.usage.cost.total,
  };
}

function mapPiStopReason(
  reason: AssistantMessage["stopReason"],
): ModelStopReason {
  if (reason === "stop") return "complete";
  if (reason === "toolUse") return "tool_use";
  if (reason === "length") return "length";
  if (reason === "aborted") return "cancelled";
  if (reason === "error") return "error";
  return "other";
}

export function modelError(
  error: unknown,
  provider: string,
  aborted: boolean,
): ModelError {
  const message =
    error instanceof Error ? error.message : "Model request failed";
  return {
    code: aborted ? "cancelled" : "provider_request_failed",
    message,
    retryable: !aborted && isRetryableProviderFailureMessage(message),
    provider,
  };
}

const deterministicProviderFailurePattern =
  /context[_ -]?(?:too[_ -]?large|length|window)|input exceeds|invalid[_ -]?request|authentication|unauthorized|forbidden|permission denied|api[_ -]?key|content[_ -]?filter|moderation|unsupported|schema|validation/i;

function isRetryableProviderFailureMessage(message: string): boolean {
  const status = message.match(
    /(?:api error|http|status(?: code)?)\s*\(?\s*(\d{3})\b/i,
  )?.[1];
  if (status !== undefined) {
    const value = Number(status);
    if (value >= 500 && value < 600) return true;
    if ([408, 409, 425, 429].includes(value)) return true;
    if (value >= 400 && value < 500) return false;
  }
  if (deterministicProviderFailurePattern.test(message)) return false;
  return isRetryableAssistantError({
    stopReason: "error",
    errorMessage: message,
  } as AssistantMessage);
}
