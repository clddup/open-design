import {
  ModelApiFormatSchema,
  ModelAuthModeSchema,
  ModelReasoningEffortSchema,
  ModelSelectionSchema,
} from "@opendesign/model-gateway/provider-config";
import { Type, type Static } from "@sinclair/typebox";

export const MODEL_PROVIDER_CATALOG_VERSION = 3 as const;
export const GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION = 1 as const;

const ControlFreeTextPattern = "^[^\\u0000-\\u001F\\u007F]+$";
const ProviderIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$",
});
const DisplayNameSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: ControlFreeTextPattern,
});
const ModelIdSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: ControlFreeTextPattern,
});
const OptionalModelIdSchema = Type.String({
  maxLength: 256,
  pattern: "^(?:|[^\\u0000-\\u001F\\u007F]+)$",
});
const BaseUrlSchema = Type.String({ minLength: 1, maxLength: 2_048 });
const ApiKeySchema = Type.String({
  minLength: 1,
  maxLength: 8_192,
  pattern: ControlFreeTextPattern,
});
const NullableTimestampSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: 64 }),
  Type.Null(),
]);

export const ModelCapabilitiesSchema = Type.Object(
  {
    toolUse: Type.Boolean(),
    imageInput: Type.Boolean(),
    reasoning: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ModelProfileSchema = Type.Object(
  {
    modelId: ModelIdSchema,
    name: DisplayNameSchema,
    contextWindow: Type.Integer({ minimum: 1_024, maximum: 10_000_000 }),
    maxOutputTokens: Type.Integer({ minimum: 1, maximum: 2_000_000 }),
    capabilities: ModelCapabilitiesSchema,
    reasoningEfforts: Type.Array(ModelReasoningEffortSchema, {
      minItems: 1,
      maxItems: 7,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export const ModelProviderProfileSchema = Type.Object(
  {
    providerId: ProviderIdSchema,
    name: DisplayNameSchema,
    enabled: Type.Boolean(),
    apiFormat: ModelApiFormatSchema,
    authMode: ModelAuthModeSchema,
    baseUrl: BaseUrlSchema,
    models: Type.Array(ModelProfileSchema, { maxItems: 128 }),
    hasApiKey: Type.Boolean(),
    updatedAt: NullableTimestampSchema,
  },
  { additionalProperties: false },
);

export const ModelProviderCatalogSchema = Type.Object(
  {
    version: Type.Literal(MODEL_PROVIDER_CATALOG_VERSION),
    providers: Type.Array(ModelProviderProfileSchema, { maxItems: 64 }),
    defaultSelection: Type.Optional(ModelSelectionSchema),
    visualCriticSelection: Type.Optional(ModelSelectionSchema),
  },
  { additionalProperties: false },
);

export const SaveVisualCriticSelectionRequestSchema = Type.Object(
  {
    selection: Type.Union([ModelSelectionSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const SaveModelProviderProfileRequestSchema = Type.Object(
  {
    providerId: ProviderIdSchema,
    name: DisplayNameSchema,
    enabled: Type.Boolean(),
    apiFormat: ModelApiFormatSchema,
    authMode: ModelAuthModeSchema,
    baseUrl: BaseUrlSchema,
    models: Type.Array(ModelProfileSchema, { minItems: 1, maxItems: 128 }),
    apiKey: Type.Optional(ApiKeySchema),
    clearApiKey: Type.Optional(Type.Boolean()),
    setAsDefault: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const DeleteModelProviderProfileRequestSchema = Type.Object(
  { providerId: ProviderIdSchema },
  { additionalProperties: false },
);

export const TestModelProviderConnectionRequestSchema = ModelSelectionSchema;

export const GlobalImageGenerationSettingsSchema = Type.Object(
  {
    version: Type.Literal(GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION),
    enabled: Type.Boolean(),
    apiFormat: Type.Literal("openai-images"),
    authMode: ModelAuthModeSchema,
    baseUrl: BaseUrlSchema,
    modelId: OptionalModelIdSchema,
    hasApiKey: Type.Boolean(),
    updatedAt: NullableTimestampSchema,
  },
  { additionalProperties: false },
);

export const SaveGlobalImageGenerationSettingsRequestSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    apiFormat: Type.Literal("openai-images"),
    authMode: ModelAuthModeSchema,
    baseUrl: BaseUrlSchema,
    modelId: OptionalModelIdSchema,
    apiKey: Type.Optional(ApiKeySchema),
    clearApiKey: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ProviderConnectionResultSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("compatible"),
      Type.Literal("text-only"),
      Type.Literal("unreachable"),
    ]),
    ok: Type.Boolean(),
    message: Type.String({
      minLength: 1,
      maxLength: 2_000,
      pattern: ControlFreeTextPattern,
    }),
    providerId: ProviderIdSchema,
    modelId: ModelIdSchema,
    latencyMs: Type.Number({ minimum: 0 }),
    textLatencyMs: Type.Optional(Type.Number({ minimum: 0 })),
    toolLatencyMs: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export type ImageGenerationApiFormat = "openai-images";
export type ModelCapabilities = Static<typeof ModelCapabilitiesSchema>;
export type ModelProfile = Static<typeof ModelProfileSchema>;
export type ModelProviderProfile = Static<typeof ModelProviderProfileSchema>;
export type ModelProviderCatalog = Static<typeof ModelProviderCatalogSchema>;
export type SaveModelProviderProfileRequest = Static<
  typeof SaveModelProviderProfileRequestSchema
>;
export type SaveVisualCriticSelectionRequest = Static<
  typeof SaveVisualCriticSelectionRequestSchema
>;
export type DeleteModelProviderProfileRequest = Static<
  typeof DeleteModelProviderProfileRequestSchema
>;
export type TestModelProviderConnectionRequest = Static<
  typeof TestModelProviderConnectionRequestSchema
>;
export type GlobalImageGenerationSettings = Static<
  typeof GlobalImageGenerationSettingsSchema
>;
export type SaveGlobalImageGenerationSettingsRequest = Static<
  typeof SaveGlobalImageGenerationSettingsRequestSchema
>;
export type ProviderConnectionResult = Static<
  typeof ProviderConnectionResultSchema
>;
