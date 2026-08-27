import type {
  CanonicalContentBlock,
  CanonicalMessage,
  ModelApiFormat,
} from "@opendesign/model-gateway";
import type { Api, Message, Tool } from "@earendil-works/pi-ai";
import type { PiModelContextProjectionPort } from "./pi-model-gateway-ports.js";

export function projectPiMessagesToCanonical(
  messages: readonly Message[],
  attachments?: Pick<PiModelContextProjectionPort, "attachmentsFor">,
): CanonicalMessage[] {
  return messages.flatMap((message, messageIndex) =>
    projectPiMessageToCanonical(message, messageIndex, attachments),
  );
}

export function projectPiMessageToCanonical(
  message: Message,
  messageIndex: number,
  attachments?: Pick<PiModelContextProjectionPort, "attachmentsFor">,
): CanonicalMessage[] {
  const projected = toCanonicalMessage(message, messageIndex);
  const references = attachments?.attachmentsFor(message) ?? [];
  if (references.length === 0) return [projected];
  if (
    references.some((attachment) => attachment.attachmentId.startsWith("svg_"))
  ) {
    throw new TypeError(
      "SVG resources cannot enter the Provider attachment projection",
    );
  }
  const referenceMessage: CanonicalMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text:
          message.role === "toolResult"
            ? `Multimodal content returned by tool call ${message.toolCallId}.`
            : userMessageText(message),
      },
      ...references.map((attachment) =>
        attachment.attachmentId.startsWith("image_")
          ? {
              type: "image_ref" as const,
              attachmentId: attachment.attachmentId,
              name: attachment.name,
              mimeType: attachment.mimeType,
              byteSize: attachment.byteSize,
            }
          : {
              type: "document_ref" as const,
              attachmentId: attachment.attachmentId,
              name: attachment.name,
              mimeType: attachment.mimeType,
              byteSize: attachment.byteSize,
            },
      ),
    ],
  };
  return message.role === "toolResult"
    ? [projected, referenceMessage]
    : [referenceMessage];
}

function userMessageText(message: Message): string {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

function toCanonicalMessage(
  message: Message,
  messageIndex: number,
): CanonicalMessage {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return { role: "user", content: message.content };
    }
    return {
      role: "user",
      content: message.content.map((block) => {
        if (block.type === "image") {
          throw new TypeError(
            "Inline Pi image content is not allowed in the OpenDesign utility process",
          );
        }
        return { type: "text" as const, text: block.text };
      }),
    };
  }
  if (message.role === "toolResult") {
    if (message.content.some((block) => block.type === "image")) {
      throw new TypeError(
        "Inline Pi tool-result images are not allowed; use OpenDesign attachment references",
      );
    }
    return {
      role: "tool",
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      content: message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n"),
      isError: message.isError,
    };
  }
  return {
    role: "assistant",
    blocks: message.content.map((block, blockIndex): CanonicalContentBlock => {
      const id = `pi_message_${messageIndex}_block_${blockIndex}`;
      if (block.type === "text") {
        return { id, type: "text", text: block.text };
      }
      if (block.type === "thinking") {
        return {
          id,
          type: "reasoning_summary",
          status: block.thinking ? "completed" : "omitted",
          ...(block.thinking ? { summary: block.thinking } : {}),
          ...(block.thinkingSignature === undefined
            ? {}
            : { signature: block.thinkingSignature }),
        };
      }
      return {
        id,
        type: "tool_call",
        toolCallId: block.id,
        name: block.name,
        input: block.arguments,
      };
    }),
    source: {
      providerId: message.provider,
      modelId: message.model,
      apiFormat: toOpenDesignApi(message.api),
      ...(message.responseId === undefined
        ? {}
        : { responseId: message.responseId }),
    },
  };
}

export function toCanonicalTool(tool: Tool) {
  if (!tool.parameters || typeof tool.parameters !== "object") {
    throw new TypeError(`Pi tool has an invalid schema: ${tool.name}`);
  }
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as Record<string, unknown>,
  };
}

function toOpenDesignApi(api: Api): ModelApiFormat {
  if (api === "openai-completions") return "openai-chat-completions";
  if (api === "openai-responses") return "openai-responses";
  if (api === "anthropic-messages") return "anthropic-messages";
  throw new TypeError(`Unsupported Pi model API: ${api}`);
}
