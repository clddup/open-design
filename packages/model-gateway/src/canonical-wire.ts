import { Type, type Static } from "@sinclair/typebox";
import {
  ModelSelectionSchema,
  ResolvedModelIdentitySchema,
  ModelWireIdSchema,
  ModelWireTextSchema,
} from "./provider-config.js";

export type ModelLatencyProfile = "interactive" | "extended";

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
