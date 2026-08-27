import {
  isAgentAttachment,
  type AgentAttachment,
} from "@opendesign/agent-contracts";
import type { Api, AssistantMessage } from "@earendil-works/pi-ai";
import type {
  CanonicalContentBlock,
  CanonicalMessage,
  ModelApiFormat,
} from "@opendesign/model-gateway";

export function canonicalUserParts(
  message: Extract<CanonicalMessage, { role: "user" }>,
): { text: string; attachments: AgentAttachment[] } {
  if (typeof message.content === "string") {
    return { text: message.content, attachments: [] };
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
  const attachments = message.content.flatMap((block): AgentAttachment[] => {
    if (block.type === "image_ref" || block.type === "document_ref") {
      const attachment = {
        attachmentId: block.attachmentId,
        name: block.name,
        mimeType: block.mimeType,
        byteSize: block.byteSize,
      };
      if (!isAgentAttachment(attachment)) {
        throw new TypeError("Canonical attachment reference is invalid");
      }
      return [attachment];
    }
    if (block.type === "image") {
      throw new TypeError(
        "Inline image bytes cannot enter the OpenDesign Pi transcript",
      );
    }
    return [];
  });
  return { text, attachments };
}

export function collectCanonicalToolNames(
  messages: readonly CanonicalMessage[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.blocks) {
      if (block.type === "tool_call") names.set(block.toolCallId, block.name);
    }
  }
  return names;
}

export function toPiAssistantBlock(
  block: CanonicalContentBlock,
): AssistantMessage["content"][number] {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "reasoning_summary") {
    return {
      type: "thinking",
      thinking: block.summary ?? "",
      ...(block.signature === undefined
        ? {}
        : { thinkingSignature: block.signature }),
    };
  }
  return {
    type: "toolCall",
    id: block.toolCallId,
    name: block.name,
    arguments: asRecord(block.input),
  };
}

export function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

export function toPiApi(format: ModelApiFormat): Api {
  return format === "openai-chat-completions" ? "openai-completions" : format;
}

export function modelResultText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[OpenDesign tool result could not be serialized]";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
