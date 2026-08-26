import {
  isRetryableAssistantError,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type ThinkingLevel,
  type Tool,
} from "@earendil-works/pi-ai";
import { streamSimple as streamAnthropicMessages } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as streamOpenAIResponses } from "@earendil-works/pi-ai/api/openai-responses";
import { Type, type Static } from "@sinclair/typebox";
import {
  ModelApiFormatSchema,
  ModelSelectionSchema,
  ModelWireIdSchema,
  ModelWireTextSchema,
  type ModelApiFormat,
  type ModelAuthMode,
} from "./provider-config.js";
import { exposesReasoningSummary } from "./reasoning-visibility.js";
export {
  MODEL_API_FORMATS,
  MODEL_AUTH_MODES,
  MODEL_REASONING_EFFORTS,
  ModelApiFormatSchema,
  ModelAuthModeSchema,
  ModelReasoningEffortSchema,
  ModelSelectionSchema,
  ModelWireIdSchema,
  ModelWireTextSchema,
  type ModelApiFormat,
  type ModelAuthMode,
  type ModelReasoningEffort,
  type ModelSelection,
} from "./provider-config.js";
export type ModelLatencyProfile = "interactive" | "extended";

export const ResolvedModelIdentitySchema = Type.Object(
  {
    ...ModelSelectionSchema.properties,
    apiFormat: ModelApiFormatSchema,
    responseId: Type.Optional(ModelWireIdSchema),
  },
  { additionalProperties: false },
);

export const ModelUsageSchema = Type.Object(
  {
    inputTokens: Type.Number(),
    outputTokens: Type.Number(),
    cacheReadTokens: Type.Number(),
    cacheWriteTokens: Type.Number(),
    reasoningTokens: Type.Number(),
    costUsd: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

export const ModelTimeoutSchema = Type.Object(
  {
    phase: Type.Union([
      Type.Literal("first-response"),
      Type.Literal("stream-idle"),
      Type.Literal("total"),
    ]),
    thresholdMs: Type.Integer({ minimum: 1, maximum: 86_400_000 }),
  },
  { additionalProperties: false },
);

export const ModelErrorSchema = Type.Object(
  {
    code: ModelWireTextSchema(256),
    message: ModelWireTextSchema(20_000),
    retryable: Type.Boolean(),
    provider: Type.Optional(ModelWireIdSchema),
    providerRequestId: Type.Optional(ModelWireIdSchema),
    modelRequestId: Type.Optional(ModelWireIdSchema),
    timeout: Type.Optional(ModelTimeoutSchema),
  },
  { additionalProperties: false },
);

export const CanonicalTextBlockSchema = Type.Object(
  {
    id: ModelWireIdSchema,
    type: Type.Literal("text"),
    text: ModelWireTextSchema(2_000_000),
  },
  { additionalProperties: false },
);

export const CanonicalReasoningSummaryBlockSchema = Type.Object(
  {
    id: ModelWireIdSchema,
    type: Type.Literal("reasoning_summary"),
    status: Type.Union([Type.Literal("completed"), Type.Literal("omitted")]),
    summary: Type.Optional(ModelWireTextSchema(2_000_000)),
    signature: Type.Optional(ModelWireTextSchema(200_000)),
  },
  { additionalProperties: false },
);

export const CanonicalToolCallBlockSchema = Type.Object(
  {
    id: ModelWireIdSchema,
    type: Type.Literal("tool_call"),
    toolCallId: ModelWireIdSchema,
    name: ModelWireIdSchema,
    input: Type.Unknown(),
  },
  { additionalProperties: false },
);

export const CanonicalContentBlockSchema = Type.Union([
  CanonicalTextBlockSchema,
  CanonicalReasoningSummaryBlockSchema,
  CanonicalToolCallBlockSchema,
]);

const CanonicalUserTextContentBlockSchema = Type.Object(
  {
    type: Type.Literal("text"),
    text: ModelWireTextSchema(250_000),
  },
  { additionalProperties: false },
);
const CanonicalImageReferenceContentBlockSchema = Type.Object(
  {
    type: Type.Literal("image_ref"),
    attachmentId: Type.String({ pattern: "^image_[a-f0-9]{64}$" }),
    name: ModelWireTextSchema(255),
    mimeType: Type.String(),
    byteSize: Type.Integer({ minimum: 1, maximum: 16 * 1024 * 1024 }),
  },
  { additionalProperties: false },
);
const CanonicalDocumentReferenceContentBlockSchema = Type.Object(
  {
    type: Type.Literal("document_ref"),
    attachmentId: Type.String({ pattern: "^file_[a-f0-9]{64}$" }),
    name: ModelWireTextSchema(255),
    mimeType: Type.String(),
    byteSize: Type.Integer({ minimum: 1, maximum: 16 * 1024 * 1024 }),
  },
  { additionalProperties: false },
);
const CanonicalInlineImageContentBlockSchema = Type.Object(
  {
    type: Type.Literal("image"),
    data: Type.String(),
    mimeType: Type.String(),
  },
  { additionalProperties: false },
);

export const CanonicalReferenceUserContentBlockSchema = Type.Union([
  CanonicalUserTextContentBlockSchema,
  CanonicalImageReferenceContentBlockSchema,
  CanonicalDocumentReferenceContentBlockSchema,
]);

export const CanonicalUserContentBlockSchema = Type.Union([
  CanonicalUserTextContentBlockSchema,
  CanonicalImageReferenceContentBlockSchema,
  CanonicalDocumentReferenceContentBlockSchema,
  CanonicalInlineImageContentBlockSchema,
]);

const CanonicalReferenceUserMessageSchema = Type.Object(
  {
    role: Type.Literal("user"),
    content: Type.Union([
      ModelWireTextSchema(2_000_000),
      Type.Array(CanonicalReferenceUserContentBlockSchema, { maxItems: 16 }),
    ]),
  },
  { additionalProperties: false },
);
const CanonicalUserMessageSchema = Type.Object(
  {
    role: Type.Literal("user"),
    content: Type.Union([
      ModelWireTextSchema(2_000_000),
      Type.Array(CanonicalUserContentBlockSchema, { maxItems: 16 }),
    ]),
  },
  { additionalProperties: false },
);
const CanonicalAssistantMessageSchema = Type.Object(
  {
    role: Type.Literal("assistant"),
    blocks: Type.Array(CanonicalContentBlockSchema, { maxItems: 2_000 }),
    source: Type.Optional(ResolvedModelIdentitySchema),
  },
  { additionalProperties: false },
);
const CanonicalToolMessageSchema = Type.Object(
  {
    role: Type.Literal("tool"),
    toolCallId: ModelWireIdSchema,
    toolName: Type.Optional(ModelWireIdSchema),
    content: Type.Unknown(),
    isError: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const CanonicalMessageSchema = Type.Union([
  CanonicalUserMessageSchema,
  CanonicalAssistantMessageSchema,
  CanonicalToolMessageSchema,
]);

export const CanonicalReferenceMessageSchema = Type.Union([
  CanonicalReferenceUserMessageSchema,
  CanonicalAssistantMessageSchema,
  CanonicalToolMessageSchema,
]);

export const CanonicalToolSchema = Type.Object(
  {
    name: ModelWireIdSchema,
    description: ModelWireTextSchema(20_000),
    inputSchema: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

export const SerializableModelRequestSchema = Type.Object(
  {
    attemptId: ModelWireIdSchema,
    sessionId: Type.Optional(ModelWireIdSchema),
    latencyProfile: Type.Optional(
      Type.Union([Type.Literal("interactive"), Type.Literal("extended")]),
    ),
    modelSelection: ModelSelectionSchema,
    system: ModelWireTextSchema(200_000),
    messages: Type.Array(CanonicalMessageSchema, { maxItems: 1_000 }),
    tools: Type.Array(CanonicalToolSchema, { maxItems: 256 }),
  },
  { additionalProperties: false },
);

const ModelStopReasonSchema = Type.Union([
  Type.Literal("complete"),
  Type.Literal("tool_use"),
  Type.Literal("length"),
  Type.Literal("cancelled"),
  Type.Literal("content_filter"),
  Type.Literal("error"),
  Type.Literal("other"),
]);

export const CanonicalStreamEventSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("attempt.started"),
      attemptId: ModelWireIdSchema,
      model: ModelWireTextSchema(256),
      identity: ResolvedModelIdentitySchema,
      providerRequestId: Type.Optional(ModelWireIdSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("attempt.retrying"),
      attemptId: ModelWireIdSchema,
      retry: Type.Integer({ minimum: 1, maximum: 5 }),
      maxRetries: Type.Literal(5),
      delayMs: Type.Integer({ minimum: 1, maximum: 60_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("attempt.recovered"),
      attemptId: ModelWireIdSchema,
      retriesUsed: Type.Integer({ minimum: 1, maximum: 5 }),
      maxRetries: Type.Literal(5),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("block.started"),
      attemptId: ModelWireIdSchema,
      blockId: ModelWireIdSchema,
      kind: Type.Union([
        Type.Literal("text"),
        Type.Literal("reasoning_summary"),
        Type.Literal("tool_call"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("block.delta"),
      attemptId: ModelWireIdSchema,
      blockId: ModelWireIdSchema,
      delta: ModelWireTextSchema(2_000_000),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("block.completed"),
      attemptId: ModelWireIdSchema,
      block: CanonicalContentBlockSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("attempt.completed"),
      attemptId: ModelWireIdSchema,
      stopReason: ModelStopReasonSchema,
      providerStopReason: Type.Optional(ModelWireTextSchema(20_000)),
      providerRequestId: Type.Optional(ModelWireIdSchema),
      usage: ModelUsageSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("attempt.failed"),
      attemptId: ModelWireIdSchema,
      error: ModelErrorSchema,
    },
    { additionalProperties: false },
  ),
]);

export type ResolvedModelIdentity = Static<typeof ResolvedModelIdentitySchema>;
export type ModelUsage = Static<typeof ModelUsageSchema>;
export type ModelError = Static<typeof ModelErrorSchema>;
export type CanonicalContentBlock = Static<typeof CanonicalContentBlockSchema>;
export type CanonicalUserContentBlock = Static<
  typeof CanonicalUserContentBlockSchema
>;
export type CanonicalMessage = Static<typeof CanonicalMessageSchema>;
export type CanonicalTool = Static<typeof CanonicalToolSchema>;
export type SerializableModelRequest = Static<
  typeof SerializableModelRequestSchema
>;
export type CanonicalStreamEvent = Static<typeof CanonicalStreamEventSchema>;
export type ModelStopReason = Static<typeof ModelStopReasonSchema>;

export interface ModelRequest extends Omit<
  SerializableModelRequest,
  "messages"
> {
  messages: CanonicalMessage[];
  signal: AbortSignal;
}

export interface ModelGateway {
  stream(request: ModelRequest): AsyncIterable<CanonicalStreamEvent>;
}

export interface CredentialHost {
  withCredential<T>(
    provider: string,
    operation: (credential: string) => Promise<T>,
  ): Promise<T>;
}

export interface CompletedModelResponse {
  attemptId: string;
  model?: string;
  identity?: ResolvedModelIdentity;
  providerRequestId?: string;
  blocks: CanonicalContentBlock[];
  stopReason: ModelStopReason;
  providerStopReason?: string;
  usage: ModelUsage;
}

export class ModelResponseAccumulator {
  readonly #blocks = new Map<string, CanonicalContentBlock>();
  #model?: string;
  #identity?: ResolvedModelIdentity;
  #providerRequestId?: string;
  #completion?: Extract<CanonicalStreamEvent, { type: "attempt.completed" }>;
  #failure?: ModelError;

  constructor(readonly attemptId: string) {}

  add(event: CanonicalStreamEvent): void {
    if (event.attemptId !== this.attemptId) {
      throw new Error(
        `Attempt mismatch: ${event.attemptId} != ${this.attemptId}`,
      );
    }
    if (event.type === "attempt.started") {
      this.#model = event.model;
      this.#identity = event.identity;
      if (event.providerRequestId !== undefined) {
        this.#providerRequestId = event.providerRequestId;
      }
    }
    if (event.type === "block.completed") {
      this.#blocks.set(event.block.id, event.block);
    }
    if (event.type === "attempt.completed") {
      this.#completion = event;
      if (event.providerRequestId !== undefined) {
        this.#providerRequestId = event.providerRequestId;
      }
    }
    if (event.type === "attempt.failed") this.#failure = event.error;
  }

  completedBlocks(): CanonicalContentBlock[] {
    return [...this.#blocks.values()];
  }

  result(): CompletedModelResponse {
    if (this.#failure) {
      const error = new Error(this.#failure.message);
      error.name = this.#failure.code;
      throw error;
    }
    if (!this.#completion) {
      throw new Error(`Model attempt did not complete: ${this.attemptId}`);
    }
    return {
      attemptId: this.attemptId,
      ...(this.#model === undefined ? {} : { model: this.#model }),
      ...(this.#identity === undefined
        ? {}
        : {
            identity: {
              ...this.#identity,
              ...(this.#providerRequestId === undefined
                ? {}
                : { responseId: this.#providerRequestId }),
            },
          }),
      ...(this.#providerRequestId === undefined
        ? {}
        : { providerRequestId: this.#providerRequestId }),
      blocks: this.completedBlocks(),
      stopReason: this.#completion.stopReason,
      ...(this.#completion.providerStopReason === undefined
        ? {}
        : { providerStopReason: this.#completion.providerStopReason }),
      usage: this.#completion.usage,
    };
  }
}

export interface MockModelResponse {
  blocks: CanonicalContentBlock[];
  stopReason?: ModelStopReason;
  usage?: Partial<ModelUsage>;
  providerRequestId?: string;
  providerStopReason?: string;
}

export interface ProviderModelConfiguration {
  providerId: string;
  apiFormat: ModelApiFormat;
  authMode: ModelAuthMode;
  baseUrl: string;
  credential?: string;
  model: {
    modelId: string;
    name: string;
    contextWindow: number;
    maxOutputTokens: number;
    reasoning: boolean;
    imageInput: boolean;
  };
  fetch?: typeof globalThis.fetch;
}

/**
 * Main-hosted multi-protocol adapter backed by Pi's typed API registry.
 * The caller resolves a provider profile and credential before construction;
 * neither value is exposed to Renderer or the Agent utility process.
 */
export class MultiProtocolModelGateway implements ModelGateway {
  readonly #configuration: ProviderModelConfiguration;
  readonly #fetch: typeof globalThis.fetch;

  constructor(configuration: ProviderModelConfiguration) {
    this.#configuration = configuration;
    this.#fetch = configuration.fetch ?? globalThis.fetch;
  }

  async *stream(request: ModelRequest): AsyncIterable<CanonicalStreamEvent> {
    const { providerId, modelId, reasoningEffort } = request.modelSelection;
    if (
      providerId !== this.#configuration.providerId ||
      modelId !== this.#configuration.model.modelId
    ) {
      throw new Error("Resolved model configuration does not match selection");
    }

    const identity: ResolvedModelIdentity = {
      providerId,
      modelId,
      apiFormat: this.#configuration.apiFormat,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    };
    yield {
      type: "attempt.started",
      attemptId: request.attemptId,
      model: modelId,
      identity,
    };

    try {
      const model = toPiModel(this.#configuration);
      const stream = streamConfiguredModel(
        model,
        toPiContext(request, identity),
        this.streamOptions(request),
      );
      for await (const event of stream) {
        if (!exposesReasoningSummary(this.#configuration.apiFormat, event))
          continue;
        for (const canonical of mapPiEvent(event, request.attemptId)) {
          yield canonical;
        }
      }
    } catch (error) {
      yield {
        type: "attempt.failed",
        attemptId: request.attemptId,
        error: modelError(error, providerId, request.signal.aborted),
      };
    }
  }

  private streamOptions(request: ModelRequest): SimpleStreamOptions {
    const effort = request.modelSelection.reasoningEffort;
    return {
      apiKey: this.#configuration.credential ?? "opendesign-no-auth",
      fetch: authenticatedFetch(
        this.#fetch,
        this.#configuration.authMode,
        this.#configuration.credential,
      ),
      signal: request.signal,
      ...(request.sessionId === undefined
        ? {}
        : { sessionId: request.sessionId }),
      ...(effort === undefined || effort === "off"
        ? {}
        : { reasoning: effort satisfies ThinkingLevel }),
    };
  }
}

function streamConfiguredModel(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
) {
  if (model.api === "openai-responses") {
    return streamOpenAIResponses(
      model as Model<"openai-responses">,
      context,
      options,
    );
  }
  if (model.api === "openai-completions") {
    return streamOpenAICompletions(
      model as Model<"openai-completions">,
      context,
      options,
    );
  }
  if (model.api === "anthropic-messages") {
    return streamAnthropicMessages(
      model as Model<"anthropic-messages">,
      context,
      options,
    );
  }
  throw new Error(`Unsupported model API: ${model.api}`);
}

export class MockModelGateway implements ModelGateway {
  readonly #responses: MockModelResponse[];
  #responseIndex = 0;

  constructor(response: string | MockModelResponse | MockModelResponse[]) {
    this.#responses = Array.isArray(response)
      ? response
      : [
          typeof response === "string"
            ? {
                blocks: [{ id: "mock_text", type: "text", text: response }],
              }
            : response,
        ];
  }

  async *stream(request: ModelRequest): AsyncIterable<CanonicalStreamEvent> {
    await Promise.resolve();
    const response =
      this.#responses[
        Math.min(this.#responseIndex++, this.#responses.length - 1)
      ];
    if (!response) throw new Error("Mock model has no configured response");

    yield {
      type: "attempt.started",
      attemptId: request.attemptId,
      model: request.modelSelection.modelId,
      identity: {
        ...request.modelSelection,
        apiFormat: "openai-responses",
      },
      ...(response.providerRequestId === undefined
        ? {}
        : { providerRequestId: response.providerRequestId }),
    };

    for (const configuredBlock of response.blocks) {
      if (request.signal.aborted) {
        yield completedAttempt(request.attemptId, "cancelled", response);
        return;
      }
      const block = withAttemptBlockId(request.attemptId, configuredBlock);
      yield {
        type: "block.started",
        attemptId: request.attemptId,
        blockId: block.id,
        kind: block.type,
      };
      const delta = blockDelta(block);
      if (delta.length > 0) {
        yield {
          type: "block.delta",
          attemptId: request.attemptId,
          blockId: block.id,
          delta,
        };
      }
      yield { type: "block.completed", attemptId: request.attemptId, block };
    }

    yield completedAttempt(
      request.attemptId,
      response.stopReason ??
        (response.blocks.some((block) => block.type === "tool_call")
          ? "tool_use"
          : "complete"),
      response,
    );
  }
}

function toPiModel(configuration: ProviderModelConfiguration): Model<Api> {
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

function toPiContext(
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

function mapPiEvent(
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

function authenticatedFetch(
  fetchImplementation: typeof globalThis.fetch,
  authMode: ModelAuthMode,
  credential: string | undefined,
): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    headers.delete("x-api-key");
    if (credential && authMode === "bearer") {
      headers.set("authorization", `Bearer ${credential}`);
    }
    if (credential && authMode === "x-api-key") {
      headers.set("x-api-key", credential);
    }
    return fetchImplementation(input, { ...init, headers });
  };
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

function modelError(
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

function withAttemptBlockId(
  attemptId: string,
  block: CanonicalContentBlock,
): CanonicalContentBlock {
  return { ...block, id: `${attemptId}_${block.id}` };
}

function blockDelta(block: CanonicalContentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "reasoning_summary") return block.summary ?? "";
  return JSON.stringify(block.input);
}

function completedAttempt(
  attemptId: string,
  stopReason: ModelStopReason,
  response: MockModelResponse,
): Extract<CanonicalStreamEvent, { type: "attempt.completed" }> {
  return {
    type: "attempt.completed",
    attemptId,
    stopReason,
    ...(response.providerStopReason === undefined
      ? {}
      : { providerStopReason: response.providerStopReason }),
    ...(response.providerRequestId === undefined
      ? {}
      : { providerRequestId: response.providerRequestId }),
    usage: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      cacheReadTokens: response.usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: response.usage?.cacheWriteTokens ?? 0,
      reasoningTokens: response.usage?.reasoningTokens ?? 0,
      ...(response.usage?.costUsd === undefined
        ? {}
        : { costUsd: response.usage.costUsd }),
    },
  };
}
