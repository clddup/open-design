import { Type, type Static } from "@sinclair/typebox";

export const MODEL_API_FORMATS = [
  "openai-responses",
  "openai-chat-completions",
  "anthropic-messages",
] as const;
export const MODEL_AUTH_MODES = ["bearer", "x-api-key", "none"] as const;
export const MODEL_REASONING_EFFORTS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ModelApiFormat = (typeof MODEL_API_FORMATS)[number];
export type ModelAuthMode = (typeof MODEL_AUTH_MODES)[number];
export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number];

export const ModelWireIdSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
export const ModelWireTextSchema = (maximum: number) =>
  Type.String({ maxLength: maximum });

export const ModelReasoningEffortSchema = Type.Union(
  MODEL_REASONING_EFFORTS.map((value) => Type.Literal(value)),
);
export const ModelApiFormatSchema = Type.Union(
  MODEL_API_FORMATS.map((value) => Type.Literal(value)),
);
export const ModelAuthModeSchema = Type.Union(
  MODEL_AUTH_MODES.map((value) => Type.Literal(value)),
);

export const ModelSelectionSchema = Type.Object(
  {
    providerId: ModelWireIdSchema,
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    reasoningEffort: Type.Optional(ModelReasoningEffortSchema),
  },
  { additionalProperties: false },
);

export const ResolvedModelIdentitySchema = Type.Object(
  {
    ...ModelSelectionSchema.properties,
    apiFormat: ModelApiFormatSchema,
    responseId: Type.Optional(ModelWireIdSchema),
  },
  { additionalProperties: false },
);

export type ModelSelection = Static<typeof ModelSelectionSchema>;
export type ResolvedModelIdentity = Static<typeof ResolvedModelIdentitySchema>;
