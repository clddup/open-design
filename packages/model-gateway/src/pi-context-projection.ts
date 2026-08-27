import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Tool,
} from "@earendil-works/pi-ai";
import type {
  ModelApiFormat,
  ResolvedModelIdentity,
} from "./provider-config.js";
import type {
  ModelRequest,
  ProviderModelConfiguration,
} from "./model-gateway-ports.js";

export function toPiModel(
  configuration: ProviderModelConfiguration,
): Model<Api> {
  return {
    id: configuration.model.modelId,
    name: configuration.model.name,
    api: toPiApi(configuration.apiFormat),
    provider: configuration.providerId,
    baseUrl: configuration.baseUrl.replace(/\/+$/, ""),
    reasoning: configuration.model.reasoning,
    input: configuration.model.imageInput ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: configuration.model.contextWindow,
    maxTokens: configuration.model.maxOutputTokens,
  };
}

function toPiApi(format: ModelApiFormat): Api {
  if (format === "openai-chat-completions") return "openai-completions";
  return format;
}

export function toPiContext(
  request: ModelRequest,
  currentIdentity: ResolvedModelIdentity,
): Context {
  const toolNames = new Map<string, string>();
  for (const message of request.messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.blocks) {
      if (block.type === "tool_call") {
        toolNames.set(block.toolCallId, block.name);
      }
    }
  }
  return {
    systemPrompt: request.system,
    messages: request.messages.map((message) => {
      const timestamp = Date.now();
      if (message.role === "user") {
        return {
          role: "user",
          content:
            typeof message.content === "string"
              ? message.content
              : message.content.map((block) => {
                  if (block.type === "text") return block;
                  if (block.type === "image") {
                    return {
                      type: "image" as const,
                      data: block.data,
                      mimeType: block.mimeType,
                    };
                  }
                  throw new Error(
                    `Unresolved model attachment: ${block.attachmentId}`,
                  );
                }),
          timestamp,
        };
      }
      if (message.role === "tool") {
        return {
          role: "toolResult",
          toolCallId: message.toolCallId,
          toolName:
            message.toolName ?? toolNames.get(message.toolCallId) ?? "tool",
          content: [
            {
              type: "text",
              text:
                typeof message.content === "string"
                  ? message.content
                  : JSON.stringify(message.content),
            },
          ],
          isError: message.isError,
          timestamp,
        };
      }
      const source = message.source ?? currentIdentity;
      return {
        role: "assistant",
        content: message.blocks.map((block) => {
          if (block.type === "text") {
            return { type: "text" as const, text: block.text };
          }
          if (block.type === "reasoning_summary") {
            return {
              type: "thinking" as const,
              thinking: block.summary ?? "",
              ...(block.signature === undefined
                ? {}
                : { thinkingSignature: block.signature }),
            };
          }
          return {
            type: "toolCall" as const,
            id: block.toolCallId,
            name: block.name,
            arguments: asRecord(block.input),
          };
        }),
        api: toPiApi(source.apiFormat),
        provider: source.providerId,
        model: source.modelId,
        ...(source.responseId === undefined
          ? {}
          : { responseId: source.responseId }),
        usage: emptyPiUsage(),
        stopReason: "stop" as const,
        timestamp,
      } satisfies AssistantMessage;
    }),
    tools: request.tools.map((tool): Tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

function emptyPiUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
