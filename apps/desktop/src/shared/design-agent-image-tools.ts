import {
  isDesignAsset,
  isImagePlacement,
  type DesignAsset,
  type ImagePlacement,
} from "@opendesign/design-contracts";
import {
  isPlaceableRasterAssetRole,
  isRasterAssetRole,
  type PlaceableRasterAssetRole,
  type RasterAssetRole,
} from "./design-agent-plan-review";
import {
  exactKeys,
  finite,
  isRecord,
  positive,
  safeId,
} from "./design-agent-validation";

export type ReadImageToolInput = { source: string };
export type ImageGenerationSize = "auto" | `${number}x${number}`;
export type ImageGenerationQuality = "auto" | "low" | "medium" | "high";
export type ImageGenerationOutputFormat = "png" | "jpeg" | "webp";

export type GenerateImageToolInput = {
  prompt: string;
  role: RasterAssetRole;
  size?: ImageGenerationSize;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
};

type PlaceImageToolBaseInput = {
  pageId: string;
  parentId: string | null;
  index: number;
  nodeId: string;
  name: string;
  role: PlaceableRasterAssetRole;
  x: number;
  y: number;
  width?: number;
  height?: number;
  placement?: ImagePlacement;
};

export type PlaceImageToolInput = PlaceImageToolBaseInput &
  (
    | { attachmentId: string; assetId?: never }
    | { assetId: string; attachmentId?: never; width: number; height: number }
  );

export type UpdateImageToolInput =
  | {
      action: "set-placement";
      label: string;
      pageId: string;
      nodeId: string;
      placement: ImagePlacement;
    }
  | {
      action: "replace-source";
      label: string;
      pageId: string;
      nodeId: string;
      attachmentId: string;
      placement?: ImagePlacement;
    };

export type InternalUpdateImageToolInput =
  | Extract<UpdateImageToolInput, { action: "set-placement" }>
  | {
      action: "replace-source";
      label: string;
      pageId: string;
      nodeId: string;
      asset: DesignAsset;
      placement?: ImagePlacement;
    };

const NORMALIZED_POINT_SCHEMA = {
  type: "object",
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["x", "y"],
  additionalProperties: false,
} as const;

export const DESIGN_IMAGE_PLACEMENT_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: { mode: { const: "stretch" } },
      required: ["mode"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { mode: { const: "fit" } },
      required: ["mode"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        mode: { const: "fill" },
        focalPoint: NORMALIZED_POINT_SCHEMA,
      },
      required: ["mode", "focalPoint"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        mode: { const: "crop" },
        focalPoint: NORMALIZED_POINT_SCHEMA,
        zoom: { type: "number", minimum: 1, maximum: 64 },
        rotation: { type: "number", minimum: -360, maximum: 360 },
        flipHorizontal: { type: "boolean" },
        flipVertical: { type: "boolean" },
      },
      required: [
        "mode",
        "focalPoint",
        "zoom",
        "rotation",
        "flipHorizontal",
        "flipVertical",
      ],
      additionalProperties: false,
    },
  ],
} as const;

export const READ_IMAGE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    source: { type: "string", minLength: 1, maxLength: 4_096 },
  },
  required: ["source"],
  additionalProperties: false,
} as const;

export const GENERATE_IMAGE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string", minLength: 1, maxLength: 32_000 },
    role: {
      enum: [
        "reference",
        "background",
        "hero",
        "supporting-content",
        "final-single-image",
      ],
    },
    size: {
      type: "string",
      pattern: "^(auto|[1-9][0-9]{2,3}x[1-9][0-9]{2,3})$",
      description:
        "Output resolution. Popular values include 1024x1024, 1536x1024, 1024x1536, 2048x2048, 2048x1152, 3840x2160, 2160x3840, and auto.",
    },
    quality: { enum: ["auto", "low", "medium", "high"] },
    outputFormat: { enum: ["png", "jpeg", "webp"] },
  },
  required: ["prompt", "role"],
  additionalProperties: false,
} as const;

export const PLACE_IMAGE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    attachmentId: { type: "string", pattern: "^image_[a-f0-9]{64}$" },
    assetId: {
      type: "string",
      pattern: "^asset_[a-f0-9]{64}$",
      description:
        "Persistent image asset in the current Design File. Use either assetId or attachmentId. Existing assets require explicit width and height from inspection metadata.",
    },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    parentId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "null" },
      ],
    },
    index: { type: "integer", minimum: 0 },
    nodeId: { type: "string", minLength: 1, maxLength: 256 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    role: {
      enum: ["background", "hero", "supporting-content", "final-single-image"],
    },
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number", exclusiveMinimum: 0 },
    height: { type: "number", exclusiveMinimum: 0 },
    placement: DESIGN_IMAGE_PLACEMENT_SCHEMA,
  },
  required: ["pageId", "parentId", "index", "nodeId", "name", "role", "x", "y"],
  oneOf: [
    { required: ["attachmentId"], not: { required: ["assetId"] } },
    {
      required: ["assetId", "width", "height"],
      not: { required: ["attachmentId"] },
    },
  ],
  additionalProperties: false,
} as const;

export const UPDATE_IMAGE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      enum: ["set-placement", "replace-source"],
      description:
        "set-placement requires placement; replace-source requires attachmentId and may also provide placement.",
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    nodeId: { type: "string", minLength: 1, maxLength: 256 },
    attachmentId: {
      type: "string",
      pattern: "^image_[a-f0-9]{64}$",
      description: "Required only for replace-source.",
    },
    placement: {
      ...DESIGN_IMAGE_PLACEMENT_SCHEMA,
      description:
        "Required for set-placement and optional for replace-source.",
    },
  },
  required: ["action", "label", "pageId", "nodeId"],
  additionalProperties: false,
} as const;

export function isReadImageToolInput(
  input: unknown,
): input is ReadImageToolInput {
  return (
    isRecord(input) &&
    typeof input.source === "string" &&
    input.source.length > 0 &&
    input.source.length <= 4_096 &&
    exactKeys(input, ["source"])
  );
}

export function isGenerateImageToolInput(
  input: unknown,
): input is GenerateImageToolInput {
  if (!isRecord(input)) return false;
  return (
    typeof input.prompt === "string" &&
    input.prompt.trim().length > 0 &&
    input.prompt.length <= 32_000 &&
    isRasterAssetRole(input.role) &&
    (input.size === undefined || isImageGenerationSize(input.size)) &&
    (input.quality === undefined ||
      input.quality === "auto" ||
      input.quality === "low" ||
      input.quality === "medium" ||
      input.quality === "high") &&
    (input.outputFormat === undefined ||
      input.outputFormat === "png" ||
      input.outputFormat === "jpeg" ||
      input.outputFormat === "webp") &&
    Object.keys(input).every((key) =>
      ["prompt", "role", "size", "quality", "outputFormat"].includes(key),
    )
  );
}

export function isPlaceImageToolInput(
  input: unknown,
): input is PlaceImageToolInput {
  if (!isRecord(input)) return false;
  const attachmentSource =
    typeof input.attachmentId === "string" &&
    /^image_[a-f0-9]{64}$/.test(input.attachmentId) &&
    input.assetId === undefined;
  const assetSource =
    typeof input.assetId === "string" &&
    /^asset_[a-f0-9]{64}$/.test(input.assetId) &&
    input.attachmentId === undefined &&
    positive(input.width) &&
    positive(input.height);
  return (
    (attachmentSource || assetSource) &&
    safeId(input.pageId) &&
    (input.parentId === null || safeId(input.parentId)) &&
    Number.isInteger(input.index) &&
    Number(input.index) >= 0 &&
    safeId(input.nodeId) &&
    typeof input.name === "string" &&
    input.name.length > 0 &&
    input.name.length <= 256 &&
    isPlaceableRasterAssetRole(input.role) &&
    finite(input.x) &&
    finite(input.y) &&
    (input.width === undefined || positive(input.width)) &&
    (input.height === undefined || positive(input.height)) &&
    (input.placement === undefined || isImagePlacement(input.placement)) &&
    Object.keys(input).every((key) =>
      [
        "attachmentId",
        "assetId",
        "pageId",
        "parentId",
        "index",
        "nodeId",
        "name",
        "role",
        "x",
        "y",
        "width",
        "height",
        "placement",
      ].includes(key),
    )
  );
}

export function isUpdateImageToolInput(
  input: unknown,
): input is UpdateImageToolInput {
  if (!isRecord(input) || !hasCommonUpdateFields(input)) return false;
  if (input.action === "set-placement") {
    return (
      isImagePlacement(input.placement) &&
      exactKeys(input, ["action", "label", "pageId", "nodeId", "placement"])
    );
  }
  return (
    input.action === "replace-source" &&
    typeof input.attachmentId === "string" &&
    /^image_[a-f0-9]{64}$/.test(input.attachmentId) &&
    (input.placement === undefined || isImagePlacement(input.placement)) &&
    exactKeys(input, [
      "action",
      "label",
      "pageId",
      "nodeId",
      "attachmentId",
      ...(input.placement === undefined ? [] : ["placement"]),
    ])
  );
}

export function isInternalUpdateImageToolInput(
  input: unknown,
): input is InternalUpdateImageToolInput {
  if (!isRecord(input) || !hasCommonUpdateFields(input)) return false;
  if (input.action === "set-placement") {
    return (
      isImagePlacement(input.placement) &&
      exactKeys(input, ["action", "label", "pageId", "nodeId", "placement"])
    );
  }
  return (
    input.action === "replace-source" &&
    isBoundedEmbeddedImageAsset(input.asset) &&
    (input.placement === undefined || isImagePlacement(input.placement)) &&
    exactKeys(input, [
      "action",
      "label",
      "pageId",
      "nodeId",
      "asset",
      ...(input.placement === undefined ? [] : ["placement"]),
    ])
  );
}

function hasCommonUpdateFields(input: Record<string, unknown>): boolean {
  return (
    typeof input.label === "string" &&
    input.label.length > 0 &&
    input.label.length <= 256 &&
    safeId(input.pageId) &&
    safeId(input.nodeId)
  );
}

function isBoundedEmbeddedImageAsset(value: unknown): value is DesignAsset {
  if (!isDesignAsset(value) || value.kind !== "image") return false;
  return (
    /^asset_[a-f0-9]{64}$/.test(value.id) &&
    /^(?:image\/png|image\/jpeg|image\/webp|image\/gif)$/.test(
      value.mimeType ?? "",
    ) &&
    value.source.type === "data" &&
    value.source.value.length > 0 &&
    value.source.value.length <= 24_000_000 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value.source.value) &&
    value.size !== undefined &&
    value.size.width > 0 &&
    value.size.height > 0
  );
}

function isImageGenerationSize(value: unknown): value is ImageGenerationSize {
  if (value === "auto") return true;
  if (typeof value !== "string") return false;
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || !Number.isInteger(width) || !Number.isInteger(height)) {
    return false;
  }
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  return (
    shortEdge >= 256 &&
    longEdge <= 4_096 &&
    longEdge / shortEdge <= 4 &&
    width * height <= 16_777_216
  );
}
