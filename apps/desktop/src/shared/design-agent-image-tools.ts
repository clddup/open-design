import {
  executableJsonSchema,
  isDesignAsset,
  isImageAssetDerivation,
  ImagePaintSchema,
  isImageFilters,
  isImagePaint,
  isImagePlacement,
  isImageLightingPreset,
  schemaValidationIssues,
  type DesignAsset,
  type ImageFilters,
  type ImagePlacement,
  type ImageLightingPreset,
  type ImagePaint,
  type ImageAssetDerivation,
  type TSchema,
} from "@opendesign/design-contracts";
import {
  isPlaceableRasterAssetRole,
  type PlaceableRasterAssetRole,
  type RasterAssetRole,
} from "./design-agent-plan-review";
import type { ValidationIssue, ValidationResult } from "./contract-validation";
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
      action: "set-filters";
      label: string;
      pageId: string;
      nodeId: string;
      filters: ImageFilters;
    }
  | {
      action: "set-paint-filters";
      label: string;
      pageId: string;
      nodeId: string;
      paintField: "fills" | "strokes";
      paintIndex: number;
      expectedPaint: ImagePaint;
      filters: ImageFilters;
    }
  | {
      action: "replace-source";
      label: string;
      pageId: string;
      nodeId: string;
      attachmentId: string;
      placement?: ImagePlacement;
    }
  | {
      action: "switch-source";
      label: string;
      pageId: string;
      nodeId: string;
      expectedAssetId: string;
      assetId: string;
    };

type EditImageToolBase = {
  label: string;
  pageId: string;
  nodeId: string;
  expectedAssetId: string;
};

export type EditImageToolInput = EditImageToolBase &
  (
    | { action: "remove-background" }
    | { action: "upscale" }
    | {
        action: "replace-background";
        prompt: string;
      }
    | {
        action: "relight";
        lightingPreset: ImageLightingPreset;
      }
    | {
        action: "prompt-edit";
        prompt: string;
        referenceAttachmentId?: string;
      }
    | {
        action: "erase-object";
        selection: ImageAreaSelection;
      }
    | {
        action: "isolate-object";
        selection: ImageAreaSelection;
        resultNodeId: string;
      }
    | {
        action: "expand";
        expansion: ImageExpansion;
      }
  );

export type ImageAreaSelection = {
  points: Array<{ x: number; y: number }>;
};

export type ImageExpansion = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type InternalReadImageSourceToolInput = {
  pageId: string;
  nodeId: string;
  expectedAssetId: string;
};

export type PreparedImageEditSource = {
  kind: "prepared-image-edit-source";
  pageId: string;
  nodeId: string;
  expectedAssetId: string;
  asset: DesignAsset;
  placement: ImagePlacement;
  targetSize: { width: number; height: number };
};

export type InternalUpdateImageToolInput =
  | Exclude<UpdateImageToolInput, { action: "replace-source" }>
  | {
      action: "replace-source";
      label: string;
      pageId: string;
      nodeId: string;
      asset: DesignAsset;
      placement?: ImagePlacement;
    }
  | {
      action: "derive-source";
      label: string;
      pageId: string;
      nodeId: string;
      expectedAssetId: string;
      asset: DesignAsset;
      derivation: ImageAssetDerivation;
      supportingAssets?: DesignAsset[];
    }
  | {
      action: "derive-layer";
      label: string;
      pageId: string;
      nodeId: string;
      expectedAssetId: string;
      resultNodeId: string;
      resultNodeName: string;
      asset: DesignAsset;
      derivation: ImageAssetDerivation;
      supportingAssets?: DesignAsset[];
    }
  | {
      action: "expand-source";
      label: string;
      pageId: string;
      nodeId: string;
      expectedAssetId: string;
      expectedPlacement: ImagePlacement;
      expectedTargetSize: { width: number; height: number };
      expansion: ImageExpansion;
      asset: DesignAsset;
      derivation: ImageAssetDerivation;
      supportingAssets: DesignAsset[];
    }
  | {
      action: "upscale-source";
      label: string;
      pageId: string;
      nodeId: string;
      expectedAssetId: string;
      expectedSourceSize: { width: number; height: number };
      targetSize: { width: number; height: number };
      asset: DesignAsset;
      derivation: ImageAssetDerivation;
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

export const READ_IMAGE_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  properties: {
    source: { type: "string", minLength: 1, maxLength: 4_096 },
  },
  required: ["source"],
  additionalProperties: false,
});

export const GENERATE_IMAGE_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  properties: {
    prompt: {
      type: "string",
      minLength: 1,
      maxLength: 32_000,
      pattern: "\\S",
    },
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
        "Output resolution or auto. For explicit dimensions each edge must be 256..4096 px, aspect ratio at most 4:1, and total area at most 16,777,216 pixels. Popular values include 1024x1024, 1536x1024, 1024x1536, 2048x2048, 2048x1152, 3840x2160, and 2160x3840.",
    },
    quality: { enum: ["auto", "low", "medium", "high"] },
    outputFormat: { enum: ["png", "jpeg", "webp"] },
  },
  required: ["prompt", "role"],
  additionalProperties: false,
});

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
      enum: [
        "set-placement",
        "set-filters",
        "set-paint-filters",
        "replace-source",
        "switch-source",
      ],
      description:
        "set-placement targets an Image node; set-filters targets an Image node; set-paint-filters targets one exact image Fill/Stroke; replace-source requires attachmentId and may also provide placement; switch-source selects an existing inspected source-family asset and requires the expected current asset ID.",
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    nodeId: { type: "string", minLength: 1, maxLength: 256 },
    attachmentId: {
      type: "string",
      pattern: "^image_[a-f0-9]{64}$",
      description: "Required only for replace-source.",
    },
    expectedAssetId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "Required only for switch-source.",
    },
    assetId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "Existing source-family asset required by switch-source.",
    },
    placement: {
      ...DESIGN_IMAGE_PLACEMENT_SCHEMA,
      description:
        "Required for set-placement and optional for replace-source.",
    },
    filters: {
      type: "object",
      properties: Object.fromEntries(
        [
          "exposure",
          "contrast",
          "saturation",
          "temperature",
          "tint",
          "highlights",
          "shadows",
        ].map((key) => [key, { type: "number", minimum: -1, maximum: 1 }]),
      ),
      additionalProperties: false,
      description:
        "Sparse non-destructive image adjustments. Missing fields are neutral; pass an empty object to reset all adjustments.",
    },
    paintField: { enum: ["fills", "strokes"] },
    paintIndex: { type: "integer", minimum: 0, maximum: 4_095 },
    expectedPaint: ImagePaintSchema,
  },
  required: ["action", "label", "pageId", "nodeId"],
  additionalProperties: false,
} as const;

export const EDIT_IMAGE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      enum: [
        "remove-background",
        "replace-background",
        "relight",
        "prompt-edit",
        "erase-object",
        "isolate-object",
        "expand",
        "upscale",
      ],
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    nodeId: { type: "string", minLength: 1, maxLength: 256 },
    expectedAssetId: { type: "string", minLength: 1, maxLength: 256 },
    prompt: { type: "string", minLength: 1, maxLength: 32_000 },
    lightingPreset: {
      enum: [
        "natural-soft",
        "studio-softbox",
        "golden-hour",
        "moonlight",
        "neon",
      ],
      description:
        "Provider-independent lighting direction. The host adds the exact preservation prompt.",
    },
    referenceAttachmentId: {
      type: "string",
      pattern: "^image_[a-f0-9]{64}$",
    },
    selection: {
      type: "object",
      properties: {
        points: {
          type: "array",
          minItems: 3,
          maxItems: 512,
          items: NORMALIZED_POINT_SCHEMA,
        },
      },
      required: ["points"],
      additionalProperties: false,
      description:
        "Closed lasso polygon in normalized source-image coordinates from current visual inspection.",
    },
    resultNodeId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "Stable new Image layer ID required only by isolate-object.",
    },
    expansion: {
      type: "object",
      properties: Object.fromEntries(
        ["top", "right", "bottom", "left"].map((edge) => [
          edge,
          { type: "number", minimum: 0, maximum: 1_000_000 },
        ]),
      ),
      required: ["top", "right", "bottom", "left"],
      additionalProperties: false,
      description:
        "Outward expansion in Image node-local design units. At least one edge must be positive; each edge is limited by the current node size at execution.",
    },
  },
  required: ["action", "label", "pageId", "nodeId", "expectedAssetId"],
  oneOf: [
    {
      properties: { action: { const: "remove-background" } },
      not: {
        anyOf: [
          { required: ["prompt"] },
          { required: ["lightingPreset"] },
          { required: ["referenceAttachmentId"] },
          { required: ["selection"] },
          { required: ["resultNodeId"] },
          { required: ["expansion"] },
        ],
      },
    },
    {
      properties: { action: { const: "replace-background" } },
      required: ["prompt"],
      not: {
        anyOf: [
          { required: ["lightingPreset"] },
          { required: ["referenceAttachmentId"] },
          { required: ["selection"] },
          { required: ["resultNodeId"] },
          { required: ["expansion"] },
        ],
      },
    },
    {
      properties: { action: { const: "relight" } },
      required: ["lightingPreset"],
      not: {
        anyOf: [
          { required: ["prompt"] },
          { required: ["referenceAttachmentId"] },
          { required: ["selection"] },
          { required: ["resultNodeId"] },
          { required: ["expansion"] },
        ],
      },
    },
    {
      properties: { action: { const: "prompt-edit" } },
      required: ["prompt"],
      not: {
        anyOf: [
          { required: ["lightingPreset"] },
          { required: ["selection"] },
          { required: ["resultNodeId"] },
          { required: ["expansion"] },
        ],
      },
    },
    {
      properties: { action: { const: "erase-object" } },
      required: ["selection"],
      not: {
        anyOf: [
          { required: ["prompt"] },
          { required: ["lightingPreset"] },
          { required: ["referenceAttachmentId"] },
          { required: ["resultNodeId"] },
          { required: ["expansion"] },
        ],
      },
    },
    {
      properties: { action: { const: "isolate-object" } },
      required: ["selection", "resultNodeId"],
      not: {
        anyOf: [
          { required: ["prompt"] },
          { required: ["lightingPreset"] },
          { required: ["referenceAttachmentId"] },
          { required: ["expansion"] },
        ],
      },
    },
    {
      properties: { action: { const: "expand" } },
      required: ["expansion"],
      not: {
        anyOf: [
          { required: ["prompt"] },
          { required: ["lightingPreset"] },
          { required: ["referenceAttachmentId"] },
          { required: ["selection"] },
          { required: ["resultNodeId"] },
        ],
      },
    },
    {
      properties: { action: { const: "upscale" } },
      not: {
        anyOf: [
          { required: ["prompt"] },
          { required: ["lightingPreset"] },
          { required: ["referenceAttachmentId"] },
          { required: ["selection"] },
          { required: ["resultNodeId"] },
          { required: ["expansion"] },
        ],
      },
    },
  ],
  additionalProperties: false,
} as const;

function parseReadImage(input: unknown): ValidationResult<ReadImageToolInput> {
  const issues = imageToolSchemaIssues(
    READ_IMAGE_TOOL_INPUT_SCHEMA,
    input,
    "read_image.schema_invalid",
    "Read Image",
  );
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: structuredClone(input as ReadImageToolInput) };
}

export const ReadImageContract = {
  schema: READ_IMAGE_TOOL_INPUT_SCHEMA,
  parse: parseReadImage,
  issues: (input: unknown): ValidationIssue[] => {
    const result = parseReadImage(input);
    return result.ok ? [] : result.issues;
  },
} as const;

function parseGenerateImage(
  input: unknown,
): ValidationResult<GenerateImageToolInput> {
  const structureIssues = imageToolSchemaIssues(
    GENERATE_IMAGE_TOOL_INPUT_SCHEMA,
    input,
    "generate_image.schema_invalid",
    "Generate Image",
  );
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }

  const value = input as GenerateImageToolInput;
  const sizeIssue = explicitImageGenerationSizeIssue(value.size);
  return sizeIssue
    ? { ok: false, issues: [sizeIssue] }
    : { ok: true, value: structuredClone(value) };
}

export const GenerateImageContract = {
  schema: GENERATE_IMAGE_TOOL_INPUT_SCHEMA,
  parse: parseGenerateImage,
  issues: (input: unknown): ValidationIssue[] => {
    const result = parseGenerateImage(input);
    return result.ok ? [] : result.issues;
  },
} as const;

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
  if (input.action === "set-filters") {
    return (
      isImageFilters(input.filters) &&
      exactKeys(input, ["action", "label", "pageId", "nodeId", "filters"])
    );
  }
  if (input.action === "set-paint-filters") {
    return (
      (input.paintField === "fills" || input.paintField === "strokes") &&
      Number.isInteger(input.paintIndex) &&
      Number(input.paintIndex) >= 0 &&
      Number(input.paintIndex) <= 4_095 &&
      isImagePaint(input.expectedPaint) &&
      isImageFilters(input.filters) &&
      exactKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "paintField",
        "paintIndex",
        "expectedPaint",
        "filters",
      ])
    );
  }
  if (input.action === "switch-source") {
    return (
      safeId(input.expectedAssetId) &&
      safeId(input.assetId) &&
      exactKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "expectedAssetId",
        "assetId",
      ])
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

export function isEditImageToolInput(
  input: unknown,
): input is EditImageToolInput {
  if (
    !isRecord(input) ||
    !hasCommonUpdateFields(input) ||
    !safeId(input.expectedAssetId)
  ) {
    return false;
  }
  if (input.action === "remove-background" || input.action === "upscale") {
    return exactKeys(input, [
      "action",
      "label",
      "pageId",
      "nodeId",
      "expectedAssetId",
    ]);
  }
  if (input.action === "replace-background") {
    return (
      typeof input.prompt === "string" &&
      input.prompt.trim().length > 0 &&
      input.prompt.length <= 32_000 &&
      exactKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "expectedAssetId",
        "prompt",
      ])
    );
  }
  if (input.action === "relight") {
    return (
      isImageLightingPreset(input.lightingPreset) &&
      exactKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "expectedAssetId",
        "lightingPreset",
      ])
    );
  }
  if (input.action === "erase-object" || input.action === "isolate-object") {
    return (
      isImageAreaSelection(input.selection) &&
      (input.action !== "isolate-object" || safeId(input.resultNodeId)) &&
      exactKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "expectedAssetId",
        "selection",
        ...(input.action === "isolate-object" ? ["resultNodeId"] : []),
      ])
    );
  }
  if (input.action === "expand") {
    return (
      isImageExpansion(input.expansion) &&
      exactKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "expectedAssetId",
        "expansion",
      ])
    );
  }
  return (
    input.action === "prompt-edit" &&
    typeof input.prompt === "string" &&
    input.prompt.trim().length > 0 &&
    input.prompt.length <= 32_000 &&
    (input.referenceAttachmentId === undefined ||
      (typeof input.referenceAttachmentId === "string" &&
        /^image_[a-f0-9]{64}$/.test(input.referenceAttachmentId))) &&
    exactKeys(input, [
      "action",
      "label",
      "pageId",
      "nodeId",
      "expectedAssetId",
      "prompt",
      ...(input.referenceAttachmentId === undefined
        ? []
        : ["referenceAttachmentId"]),
    ])
  );
}

export function isInternalReadImageSourceToolInput(
  input: unknown,
): input is InternalReadImageSourceToolInput {
  return (
    isRecord(input) &&
    safeId(input.pageId) &&
    safeId(input.nodeId) &&
    safeId(input.expectedAssetId) &&
    exactKeys(input, ["pageId", "nodeId", "expectedAssetId"])
  );
}

export function isPreparedImageEditSource(
  input: unknown,
): input is PreparedImageEditSource {
  return (
    isRecord(input) &&
    input.kind === "prepared-image-edit-source" &&
    safeId(input.pageId) &&
    safeId(input.nodeId) &&
    safeId(input.expectedAssetId) &&
    isBoundedEmbeddedImageAsset(input.asset) &&
    input.asset.id === input.expectedAssetId &&
    isImagePlacement(input.placement) &&
    isPositiveSize(input.targetSize) &&
    exactKeys(input, [
      "kind",
      "pageId",
      "nodeId",
      "expectedAssetId",
      "asset",
      "placement",
      "targetSize",
    ])
  );
}

export function isInternalUpdateImageToolInput(
  input: unknown,
): input is InternalUpdateImageToolInput {
  if (!isRecord(input) || !hasCommonUpdateFields(input)) return false;
  if (input.action === "upscale-source") {
    return (
      safeId(input.expectedAssetId) &&
      isPositiveSize(input.expectedSourceSize) &&
      isPositiveSize(input.targetSize) &&
      isBoundedEmbeddedImageAsset(input.asset) &&
      input.asset.mimeType === "image/png" &&
      isImageAssetDerivation(input.derivation) &&
      input.derivation.operation === "upscale" &&
      input.derivation.sourceAssetId === input.expectedAssetId &&
      input.derivation.resultAssetId === input.asset.id &&
      input.derivation.prompt === undefined &&
      input.derivation.maskAssetId === undefined &&
      input.derivation.referenceAssetIds.length === 0 &&
      exactKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "expectedAssetId",
        "expectedSourceSize",
        "targetSize",
        "asset",
        "derivation",
      ])
    );
  }
  if (input.action === "expand-source") {
    return (
      safeId(input.expectedAssetId) &&
      isImagePlacement(input.expectedPlacement) &&
      isPositiveSize(input.expectedTargetSize) &&
      isImageExpansion(input.expansion) &&
      isBoundedEmbeddedImageAsset(input.asset) &&
      isImageAssetDerivation(input.derivation) &&
      input.derivation.operation === "expand" &&
      input.derivation.sourceAssetId === input.expectedAssetId &&
      input.derivation.resultAssetId === input.asset.id &&
      input.derivation.maskAssetId !== undefined &&
      input.derivation.referenceAssetIds.length === 0 &&
      Array.isArray(input.supportingAssets) &&
      input.supportingAssets.length === 1 &&
      isBoundedEmbeddedImageAsset(input.supportingAssets[0]) &&
      input.supportingAssets[0].mimeType === "image/png" &&
      input.supportingAssets[0].id === input.derivation.maskAssetId &&
      exactKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "expectedAssetId",
        "expectedPlacement",
        "expectedTargetSize",
        "expansion",
        "asset",
        "derivation",
        "supportingAssets",
      ])
    );
  }
  if (input.action === "derive-source" || input.action === "derive-layer") {
    if (
      !safeId(input.expectedAssetId) ||
      !isBoundedEmbeddedImageAsset(input.asset) ||
      !isImageAssetDerivation(input.derivation) ||
      input.derivation.sourceAssetId !== input.expectedAssetId ||
      input.derivation.resultAssetId !== input.asset.id ||
      input.derivation.operation === "replacement" ||
      (input.action === "derive-layer" &&
        (!safeId(input.resultNodeId) ||
          typeof input.resultNodeName !== "string" ||
          input.resultNodeName.trim().length === 0 ||
          input.resultNodeName.length > 256 ||
          input.derivation.operation !== "isolate-object")) ||
      (input.action === "derive-source" &&
        input.derivation.operation === "isolate-object")
    ) {
      return false;
    }
    const asset = input.asset;
    const derivation = input.derivation;
    const supportingAssets = input.supportingAssets ?? [];
    if (
      !Array.isArray(supportingAssets) ||
      supportingAssets.length > 1 ||
      !supportingAssets.every(isBoundedEmbeddedImageAsset) ||
      supportingAssets.some(
        (supportingAsset) =>
          supportingAsset.mimeType !== "image/png" &&
          supportingAsset.mimeType !== "image/jpeg" &&
          supportingAsset.mimeType !== "image/webp",
      ) ||
      supportingAssets.length !==
        derivation.referenceAssetIds.length +
          (derivation.maskAssetId === undefined ? 0 : 1) ||
      supportingAssets.some(
        (supportingAsset, index) =>
          supportingAsset.id !==
            [
              ...derivation.referenceAssetIds,
              ...(derivation.maskAssetId ? [derivation.maskAssetId] : []),
            ][index] ||
          supportingAsset.id === input.expectedAssetId ||
          supportingAsset.id === asset.id,
      )
    ) {
      return false;
    }
    if (
      (derivation.operation !== "relight" &&
        derivation.lightingPreset !== undefined) ||
      (derivation.operation === "remove-background" &&
        (derivation.prompt !== undefined ||
          derivation.maskAssetId !== undefined ||
          supportingAssets.length !== 0)) ||
      (derivation.operation === "prompt-edit" &&
        (typeof derivation.prompt !== "string" ||
          derivation.prompt.trim().length === 0 ||
          derivation.maskAssetId !== undefined)) ||
      (derivation.operation === "replace-background" &&
        (typeof derivation.prompt !== "string" ||
          derivation.prompt.trim().length === 0 ||
          derivation.maskAssetId !== undefined ||
          derivation.referenceAssetIds.length !== 0 ||
          supportingAssets.length !== 0)) ||
      (derivation.operation === "relight" &&
        (!isImageLightingPreset(derivation.lightingPreset) ||
          derivation.prompt !== undefined ||
          derivation.maskAssetId !== undefined ||
          derivation.referenceAssetIds.length !== 0 ||
          supportingAssets.length !== 0)) ||
      ((derivation.operation === "erase-object" ||
        derivation.operation === "isolate-object") &&
        (typeof derivation.prompt !== "string" ||
          derivation.prompt.trim().length === 0 ||
          derivation.referenceAssetIds.length !== 0 ||
          derivation.maskAssetId === undefined ||
          supportingAssets.length !== 1 ||
          supportingAssets[0]?.mimeType !== "image/png")) ||
      (derivation.operation !== "remove-background" &&
        derivation.operation !== "replace-background" &&
        derivation.operation !== "relight" &&
        derivation.operation !== "prompt-edit" &&
        derivation.operation !== "erase-object" &&
        derivation.operation !== "isolate-object")
    ) {
      return false;
    }
    return exactKeys(input, [
      "action",
      "label",
      "pageId",
      "nodeId",
      "expectedAssetId",
      "asset",
      "derivation",
      ...(input.action === "derive-layer"
        ? ["resultNodeId", "resultNodeName"]
        : []),
      ...(input.supportingAssets === undefined ? [] : ["supportingAssets"]),
    ]);
  }
  if (input.action === "set-placement") {
    return (
      isImagePlacement(input.placement) &&
      exactKeys(input, ["action", "label", "pageId", "nodeId", "placement"])
    );
  }
  if (input.action === "set-filters") {
    return (
      isImageFilters(input.filters) &&
      exactKeys(input, ["action", "label", "pageId", "nodeId", "filters"])
    );
  }
  if (input.action === "set-paint-filters") {
    return (
      (input.paintField === "fills" || input.paintField === "strokes") &&
      Number.isInteger(input.paintIndex) &&
      Number(input.paintIndex) >= 0 &&
      Number(input.paintIndex) <= 4_095 &&
      isImagePaint(input.expectedPaint) &&
      isImageFilters(input.filters) &&
      exactKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "paintField",
        "paintIndex",
        "expectedPaint",
        "filters",
      ])
    );
  }
  if (input.action === "switch-source") {
    return (
      safeId(input.expectedAssetId) &&
      safeId(input.assetId) &&
      exactKeys(input, [
        "action",
        "label",
        "pageId",
        "nodeId",
        "expectedAssetId",
        "assetId",
      ])
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

function isImageAreaSelection(value: unknown): value is ImageAreaSelection {
  return (
    isRecord(value) &&
    Array.isArray(value.points) &&
    value.points.length >= 3 &&
    value.points.length <= 512 &&
    value.points.every(
      (point) =>
        isRecord(point) &&
        finite(point.x) &&
        point.x >= 0 &&
        point.x <= 1 &&
        finite(point.y) &&
        point.y >= 0 &&
        point.y <= 1 &&
        exactKeys(point, ["x", "y"]),
    ) &&
    exactKeys(value, ["points"])
  );
}

function isImageExpansion(value: unknown): value is ImageExpansion {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["top", "right", "bottom", "left"])
  ) {
    return false;
  }
  const values = [value.top, value.right, value.bottom, value.left];
  return (
    values.some((candidate) => finite(candidate) && candidate > 0) &&
    values.every(
      (candidate) =>
        finite(candidate) && candidate >= 0 && candidate <= 1_000_000,
    )
  );
}

function isPositiveSize(
  value: unknown,
): value is { width: number; height: number } {
  return (
    isRecord(value) &&
    positive(value.width) &&
    positive(value.height) &&
    exactKeys(value, ["width", "height"])
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

function explicitImageGenerationSizeIssue(
  value: ImageGenerationSize | undefined,
): ValidationIssue | undefined {
  if (value === undefined || value === "auto") return undefined;
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || !Number.isInteger(width) || !Number.isInteger(height)) {
    return imageGenerationSizeIssue(value);
  }
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  return shortEdge >= 256 &&
    longEdge <= 4_096 &&
    longEdge / shortEdge <= 4 &&
    width * height <= 16_777_216
    ? undefined
    : imageGenerationSizeIssue(value);
}

function imageGenerationSizeIssue(actual: string): ValidationIssue {
  return {
    code: "generate_image.size_out_of_bounds",
    path: "/size",
    message:
      "Explicit image dimensions must keep each edge within 256..4096 px, aspect ratio within 4:1, and total area within 16,777,216 pixels",
    expected:
      "256..4096 px per edge; aspect ratio <= 4:1; area <= 16,777,216 px",
    actual,
    recovery:
      "Choose a supported explicit size or use auto, then submit one revised call.",
  };
}

function imageToolSchemaIssues(
  schema: TSchema,
  input: unknown,
  code: string,
  subject: string,
): ValidationIssue[] {
  return schemaValidationIssues(schema, input)
    .slice(0, 64)
    .map((issue) => ({
      code,
      path: issue.path || "/",
      message: issue.message,
      recovery: `Correct the reported ${subject} field and submit one revised call; do not repeat unchanged arguments.`,
    }));
}
