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
  const message = event.error.errorMessage ?? "Model provider request failed";
  const failure = classifyProviderFailure(
    message,
    "provider_error",
    event.reason === "aborted",
  );
  return [
    {
      type: "attempt.failed",
      attemptId,
      error: {
        ...failure,
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
    ...classifyProviderFailure(message, "provider_request_failed", aborted),
    provider,
  };
}

const contextTooLargePattern =
  /context[_ -]?(?:too[_ -]?large|length[_ -]?exceeded|window)|maximum context length|prompt (?:is )?too long|input (?:tokens? )?(?:exceeds?|too large)|too many input tokens/i;
const deterministicProviderFailurePattern =
  /invalid[_ -]?request|authentication|unauthorized|forbidden|permission denied|api[_ -]?key|content[_ -]?filter|moderation|unsupported|schema|validation/i;

function isContextTooLargeMessage(message: string): boolean {
  return contextTooLargePattern.test(message);
}

function classifyProviderFailure(
  message: string,
  fallbackCode: string,
  aborted: boolean,
): Pick<ModelError, "code" | "message" | "retryable"> {
  if (aborted) return { code: "cancelled", message, retryable: false };
  if (isContextTooLargeMessage(message)) {
    return { code: "context_too_large", message, retryable: false };
  }
  return {
    code: fallbackCode,
    message,
    retryable: isRetryableProviderFailureMessage(message),
  };
}

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
  if (
    isContextTooLargeMessage(message) ||
    deterministicProviderFailurePattern.test(message)
  ) {
    return false;
  }
  return isRetryableAssistantError({
    stopReason: "error",
    errorMessage: message,
  } as AssistantMessage);
}
