import { executableJsonSchema } from "@opendesign/design-contracts";
import { SVG_MAX_CHARACTERS } from "@opendesign/import-export-service/limits";
import {
  RASTER_EXPORT_MAX_DIMENSION,
  RASTER_EXPORT_MAX_ENCODED_BYTES,
} from "@opendesign/import-export-service/raster";
import { SvgInterchangeIssueSchema } from "@opendesign/import-export-service/svg-issues";
import { Type } from "@sinclair/typebox";
import { PortableFileNameSchema } from "./portable-file-name";

const ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
} as const;

const PORTABLE_FILE_NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 255,
  pattern:
    '^(?!\\s*$)(?!\\.{1,2}$)(?!.*[. ]$)[^<>:"/\\\\|?*\\u0000-\\u001F\\u007F]+$',
  description:
    "Portable file name only, never a path. Windows reserved device names are rejected by the same Contract refinement.",
} as const;

const IMPORT_SVG_COMMON_PROPERTIES = {
  attachmentId: { type: "string", pattern: "^svg_[a-f0-9]{64}$" },
  pageId: ID_SCHEMA,
  parentId: { anyOf: [ID_SCHEMA, { type: "null" }] },
  index: { type: "integer", minimum: 0 },
  x: { type: "number" },
  y: { type: "number" },
} as const;

const IMPORT_SVG_REQUIRED = [
  "attachmentId",
  "pageId",
  "parentId",
  "index",
  "x",
  "y",
] as const;

export const IMPORT_SVG_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Import one content-addressed SVG attachment authorized by this Conversation into an explicit inspected Page/Frame/Group insertion target at finite parent-local coordinates. The host resolves source bytes, allocates node IDs, validates capability/revision, and commits one atomic editable transaction; the model never submits SVG XML or a file path.",
  properties: IMPORT_SVG_COMMON_PROPERTIES,
  required: IMPORT_SVG_REQUIRED,
  additionalProperties: false,
});

export const INTERNAL_IMPORT_SVG_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Trusted Main-to-Renderer SVG materialization. Public attachment metadata stays bound while Main supplies bounded XML and the host-owned node ID prefix; paths remain unavailable.",
  properties: {
    ...IMPORT_SVG_COMMON_PROPERTIES,
    name: { type: "string", minLength: 1, maxLength: 255, pattern: "\\S" },
    svg: {
      type: "string",
      minLength: 1,
      maxLength: SVG_MAX_CHARACTERS,
    },
    idPrefix: {
      type: "string",
      minLength: 1,
      maxLength: 80,
      pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
    },
  },
  required: [...IMPORT_SVG_REQUIRED, "name", "svg", "idPrefix"],
  additionalProperties: false,
});

export const EXPORT_SVG_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Export one to 512 explicit inspected Page roots as editable SVG through the native save dialog. suggestedName is a portable file name, never a path. includeLayerIds and non-negative padding are optional. The host freezes the exact revision and returns bounded fidelity issues without exposing bytes or the chosen path to the model.",
  properties: {
    pageId: ID_SCHEMA,
    rootNodeIds: {
      type: "array",
      minItems: 1,
      maxItems: 512,
      uniqueItems: true,
      items: ID_SCHEMA,
    },
    suggestedName: PORTABLE_FILE_NAME_SCHEMA,
    includeLayerIds: { type: "boolean" },
    padding: { type: "number", minimum: 0, maximum: 100_000 },
  },
  required: ["pageId", "rootNodeIds", "suggestedName"],
  additionalProperties: false,
});

const RASTER_SIZE_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        mode: { const: "scale" },
        value: { enum: [1, 2, 3] },
      },
      required: ["mode", "value"],
      additionalProperties: false,
    },
    ...(["width", "height"] as const).map((mode) => ({
      type: "object" as const,
      properties: {
        mode: { const: mode },
        value: { type: "integer" as const, minimum: 1, maximum: 16_384 },
      },
      required: ["mode", "value"],
      additionalProperties: false,
    })),
  ],
} as const;

const TRANSPARENT_BACKGROUND_SCHEMA = {
  type: "object",
  properties: { mode: { const: "transparent" } },
  required: ["mode"],
  additionalProperties: false,
} as const;

const COLOR_BACKGROUND_SCHEMA = {
  type: "object",
  properties: {
    mode: { const: "color" },
    color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
  },
  required: ["mode", "color"],
  additionalProperties: false,
} as const;

const RASTER_BACKGROUND_SCHEMA = {
  anyOf: [TRANSPARENT_BACKGROUND_SCHEMA, COLOR_BACKGROUND_SCHEMA],
} as const;

const RASTER_COMMON_PROPERTIES = {
  pageId: ID_SCHEMA,
  rootNodeId: ID_SCHEMA,
  suggestedName: PORTABLE_FILE_NAME_SCHEMA,
  size: RASTER_SIZE_SCHEMA,
  background: RASTER_BACKGROUND_SCHEMA,
  quality: { type: "number", minimum: 0.01, maximum: 1 },
  resampling: { enum: ["smooth", "pixelated"] },
} as const;

function rasterFormatBranch(
  format: "png" | "jpeg" | "webp",
  options: { quality: boolean; background: Record<string, unknown> },
) {
  return {
    type: "object" as const,
    properties: {
      pageId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      suggestedName: PORTABLE_FILE_NAME_SCHEMA,
      format: { const: format },
      size: RASTER_SIZE_SCHEMA,
      background: options.background,
      ...(options.quality ? { quality: RASTER_COMMON_PROPERTIES.quality } : {}),
      resampling: RASTER_COMMON_PROPERTIES.resampling,
    },
    required: [
      "pageId",
      "rootNodeId",
      "suggestedName",
      "format",
      "size",
      "background",
      "resampling",
    ],
    additionalProperties: false,
  };
}

export const EXPORT_RASTER_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Export one explicit inspected root as PNG, JPEG, or WebP through the native save dialog. Scale is exactly 1x, 2x, or 3x; fixed width/height is 1..16384. PNG has no quality field, JPEG requires an opaque color background, and WebP may use either background. suggestedName is a portable file name, never a path. The host freezes the exact revision, enforces final pixel/byte budgets, and never exposes encoded bytes or the chosen path to the model.",
  properties: {
    ...RASTER_COMMON_PROPERTIES,
    format: { enum: ["png", "jpeg", "webp"] },
  },
  required: [
    "pageId",
    "rootNodeId",
    "suggestedName",
    "format",
    "size",
    "background",
    "resampling",
  ],
  anyOf: [
    rasterFormatBranch("png", {
      quality: false,
      background: RASTER_BACKGROUND_SCHEMA,
    }),
    rasterFormatBranch("jpeg", {
      quality: true,
      background: COLOR_BACKGROUND_SCHEMA,
    }),
    rasterFormatBranch("webp", {
      quality: true,
      background: RASTER_BACKGROUND_SCHEMA,
    }),
  ],
  additionalProperties: false,
});

const INTERNAL_ID_SCHEMA = Type.String({ minLength: 1, maxLength: 256 });
const INTERNAL_REVISION_SCHEMA = Type.Integer({ minimum: 0 });
const INTERNAL_SVG_ISSUES_SCHEMA = Type.Array(SvgInterchangeIssueSchema, {
  maxItems: 1_000,
});

export const PREPARED_AGENT_RASTER_EXPORT_SCHEMA = Type.Object(
  {
    kind: Type.Literal("raster-export-preparation"),
    version: Type.Literal(1),
    suggestedName: PortableFileNameSchema,
    format: Type.Union([
      Type.Literal("png"),
      Type.Literal("jpeg"),
      Type.Literal("webp"),
    ]),
    mimeType: Type.Union([
      Type.Literal("image/png"),
      Type.Literal("image/jpeg"),
      Type.Literal("image/webp"),
    ]),
    bytes: Type.Uint8Array({
      minByteLength: 1,
      maxByteLength: RASTER_EXPORT_MAX_ENCODED_BYTES,
    }),
    width: Type.Integer({ minimum: 1, maximum: RASTER_EXPORT_MAX_DIMENSION }),
    height: Type.Integer({ minimum: 1, maximum: RASTER_EXPORT_MAX_DIMENSION }),
    revision: INTERNAL_REVISION_SCHEMA,
    rootNodeId: INTERNAL_ID_SCHEMA,
  },
  { additionalProperties: false },
);

export const AGENT_SVG_IMPORT_RESULT_SCHEMA = Type.Object(
  {
    kind: Type.Literal("svg-import-result"),
    version: Type.Literal(1),
    ok: Type.Literal(true),
    format: Type.Literal("svg"),
    attachmentId: Type.String({ pattern: "^svg_[a-f0-9]{64}$" }),
    name: Type.String({ minLength: 1, maxLength: 255, pattern: "\\S" }),
    pageId: INTERNAL_ID_SCHEMA,
    parentId: Type.Union([INTERNAL_ID_SCHEMA, Type.Null()]),
    rootNodeId: INTERNAL_ID_SCHEMA,
    importedNodeIds: Type.Array(INTERNAL_ID_SCHEMA, {
      minItems: 1,
      maxItems: 10_000,
      uniqueItems: true,
    }),
    revision: Type.Integer({ minimum: 1 }),
    atomic: Type.Literal(true),
    issues: INTERNAL_SVG_ISSUES_SCHEMA,
  },
  { additionalProperties: false },
);

export const PREPARED_AGENT_SVG_EXPORT_SCHEMA = Type.Object(
  {
    kind: Type.Literal("svg-export-preparation"),
    version: Type.Literal(1),
    suggestedName: PortableFileNameSchema,
    svg: Type.String({ minLength: 1, maxLength: SVG_MAX_CHARACTERS }),
    revision: INTERNAL_REVISION_SCHEMA,
    exportedNodeIds: Type.Array(INTERNAL_ID_SCHEMA, {
      minItems: 1,
      maxItems: 10_000,
      uniqueItems: true,
    }),
    issues: INTERNAL_SVG_ISSUES_SCHEMA,
  },
  { additionalProperties: false },
);
