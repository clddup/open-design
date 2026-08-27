import type { AgentEvent as PiAgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type {
  AssistantTimelineBlock,
  RunStopReason,
} from "@opendesign/agent-contracts";
import type {
  ModelApiFormat,
  ResolvedModelIdentity,
} from "@opendesign/model-gateway";
import { normalizeAssistantTimelineBlocks } from "@opendesign/session-store";
import type { AgentRunRequest } from "./index.js";

export type PiAgentEventMessage = Extract<
  PiAgentEvent,
  { type: "message_start" | "message_end" }
>["message"];

export function toTimelineBlocks(
  message: AssistantMessage,
  messageId: string,
): AssistantTimelineBlock[] {
  return normalizeAssistantTimelineBlocks(
    message.content.flatMap((block, index): AssistantTimelineBlock[] => {
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
    }),
  );
}

export function toResolvedIdentity(
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

export function toRunStopReason(
  stopReason: AssistantMessage["stopReason"] | undefined,
  hadToolCalls: boolean,
): RunStopReason {
  if (stopReason === "aborted") return "cancelled";
  if (stopReason === "length") return "budget";
  if (stopReason === "error" || stopReason === undefined) return "error";
  if (stopReason === "toolUse" && !hadToolCalls) return "error";
  return "complete";
}

export function userText(message: UserMessage): string {
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

export function requireAssistantMessage(
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

export function generatedTokens(message: AssistantMessage): number {
  return message.usage.output;
}

function toModelApiFormat(api: AssistantMessage["api"]): ModelApiFormat {
  if (api === "openai-responses") return "openai-responses";
  if (api === "openai-completions") return "openai-chat-completions";
  if (api === "anthropic-messages") return "anthropic-messages";
  throw new TypeError(`Unsupported Pi model API in run journal: ${api}`);
}

export function blockId(messageId: string, contentIndex: number): string {
  return `${messageId}_block_${contentIndex}`;
}
