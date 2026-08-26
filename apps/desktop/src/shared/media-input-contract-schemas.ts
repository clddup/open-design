import {
  AgentDocumentAttachmentSchema,
  AgentImageAttachmentSchema,
  AgentSvgAttachmentSchema,
  type AgentAttachment,
} from "@opendesign/agent-contracts";
import {
  DesignAssetSchema,
  ImageAssetDerivationSchema,
  ImageLightingPresetSchema,
  ImagePlacementSchema,
  NormalizedPointSchema,
  SizeSchema,
} from "@opendesign/design-contracts";
import { StableIdSchema } from "@opendesign/workspace-contracts";
import { Type, type Static } from "@sinclair/typebox";

const AttachmentIdSchema = Type.String({
  pattern: "^(image|file|svg)_[a-f0-9]{64}$",
});
const ImagePreviewDataUrlSchema = Type.String({
  minLength: 1,
  maxLength: 24_000_000,
  pattern: "^data:image/(png|jpeg|webp|gif);base64,",
});
const EditPromptSchema = Type.String({ minLength: 1, maxLength: 32_000 });
const DesignImageEditRequestBase = {
  requestId: StableIdSchema,
  pageId: StableIdSchema,
  nodeId: StableIdSchema,
  expectedAssetId: StableIdSchema,
  source: DesignAssetSchema,
};

export const AgentAttachmentSelectionSchema = Type.Union([
  Type.Object(
    {
      ...AgentImageAttachmentSchema.properties,
      previewDataUrl: ImagePreviewDataUrlSchema,
    },
    { additionalProperties: false },
  ),
  AgentDocumentAttachmentSchema,
  AgentSvgAttachmentSchema,
]);

export const AgentAttachmentImportSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 255 }),
    bytes: Type.Uint8Array({
      minByteLength: 1,
      maxByteLength: 16 * 1024 * 1024,
    }),
  },
  { additionalProperties: false },
);

export const AgentAttachmentPreviewRequestSchema = Type.Object(
  { attachmentId: AttachmentIdSchema },
  { additionalProperties: false },
);

export const AgentAttachmentPreviewResultSchema = Type.Object(
  {
    attachmentId: AttachmentIdSchema,
    previewDataUrl: Type.Union([ImagePreviewDataUrlSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const DesignImageSelectionSchema = Type.Object(
  { asset: DesignAssetSchema },
  { additionalProperties: false },
);

export const DesignImageAreaSelectionSchema = Type.Object(
  {
    points: Type.Array(NormalizedPointSchema, {
      minItems: 3,
      maxItems: 512,
    }),
  },
  { additionalProperties: false },
);

export const DesignImageExpansionSchema = Type.Object(
  {
    top: Type.Number({ minimum: 0, maximum: 1_000_000 }),
    right: Type.Number({ minimum: 0, maximum: 1_000_000 }),
    bottom: Type.Number({ minimum: 0, maximum: 1_000_000 }),
    left: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  },
  { additionalProperties: false },
);

export const DesignImageEditRequestSchema = Type.Union([
  simpleImageEditRequest("remove-background"),
  simpleImageEditRequest("upscale"),
  Type.Object(
    {
      ...DesignImageEditRequestBase,
      action: Type.Literal("replace-background"),
      prompt: EditPromptSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DesignImageEditRequestBase,
      action: Type.Literal("relight"),
      lightingPreset: ImageLightingPresetSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DesignImageEditRequestBase,
      action: Type.Literal("prompt-edit"),
      prompt: EditPromptSchema,
      reference: Type.Optional(DesignAssetSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DesignImageEditRequestBase,
      action: Type.Union([
        Type.Literal("erase-object"),
        Type.Literal("isolate-object"),
      ]),
      selection: DesignImageAreaSelectionSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DesignImageEditRequestBase,
      action: Type.Literal("expand"),
      expansion: DesignImageExpansionSchema,
      placement: ImagePlacementSchema,
      targetSize: SizeSchema,
    },
    { additionalProperties: false },
  ),
]);

export const DesignImageEditResultSchema = Type.Object(
  {
    requestId: StableIdSchema,
    action: Type.Union([
      Type.Literal("remove-background"),
      Type.Literal("replace-background"),
      Type.Literal("relight"),
      Type.Literal("prompt-edit"),
      Type.Literal("erase-object"),
      Type.Literal("isolate-object"),
      Type.Literal("expand"),
      Type.Literal("upscale"),
    ]),
    sourceAssetId: StableIdSchema,
    asset: DesignAssetSchema,
    derivation: ImageAssetDerivationSchema,
    supportingAssets: Type.Optional(
      Type.Array(DesignAssetSchema, { maxItems: 1 }),
    ),
  },
  { additionalProperties: false },
);

export const CancelDesignImageEditRequestSchema = Type.Object(
  { requestId: StableIdSchema },
  { additionalProperties: false },
);

export type AgentAttachmentSelection = AgentAttachment & {
  previewDataUrl?: string;
};
export type AgentAttachmentImport = Static<typeof AgentAttachmentImportSchema>;
export type AgentAttachmentPreviewRequest = Static<
  typeof AgentAttachmentPreviewRequestSchema
>;
export type AgentAttachmentPreviewResult = Static<
  typeof AgentAttachmentPreviewResultSchema
>;
export type DesignImageSelection = Static<typeof DesignImageSelectionSchema>;
export type DesignImageAreaSelection = Static<
  typeof DesignImageAreaSelectionSchema
>;
export type DesignImageExpansion = Static<typeof DesignImageExpansionSchema>;
export type DesignImageEditRequest = Static<
  typeof DesignImageEditRequestSchema
>;
export type DesignImageEditResult = Static<typeof DesignImageEditResultSchema>;
export type DesignImageEditAction = DesignImageEditResult["action"];
export type CancelDesignImageEditRequest = Static<
  typeof CancelDesignImageEditRequestSchema
>;

function simpleImageEditRequest<
  const Action extends "remove-background" | "upscale",
>(action: Action) {
  return Type.Object(
    {
      ...DesignImageEditRequestBase,
      action: Type.Literal(action),
    },
    { additionalProperties: false },
  );
}
