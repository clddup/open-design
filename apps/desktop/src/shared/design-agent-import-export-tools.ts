import {
  isSvgInterchangeIssue,
  type SvgInterchangeIssue,
} from "@opendesign/import-export-service/svg-issues";
import { SVG_MAX_CHARACTERS } from "@opendesign/import-export-service/limits";
import {
  RASTER_EXPORT_MAX_ENCODED_BYTES,
  RASTER_EXPORT_VERSION,
  isRasterExportRequest,
  rasterExportMimeType,
  type RasterExportBackground,
  type RasterExportFormat,
  type RasterExportMimeType,
  type RasterExportResampling,
  type RasterExportSize,
} from "@opendesign/import-export-service/raster";
import { isPortableFileName } from "./portable-file-name";
import {
  boundedText,
  exactKeys,
  finite,
  isRecord,
  safeId,
} from "./design-agent-validation";

export type ExportSvgToolInput = {
  pageId: string;
  rootNodeIds: string[];
  suggestedName: string;
  includeLayerIds?: boolean;
  padding?: number;
};

export type ExportRasterToolInput = {
  pageId: string;
  rootNodeId: string;
  suggestedName: string;
  format: RasterExportFormat;
  size: RasterExportSize;
  background: RasterExportBackground;
  quality?: number;
  resampling: RasterExportResampling;
};

export type PreparedAgentRasterExport = {
  kind: "raster-export-preparation";
  version: 1;
  suggestedName: string;
  format: RasterExportFormat;
  mimeType: RasterExportMimeType;
  bytes: Uint8Array;
  width: number;
  height: number;
  revision: number;
  rootNodeId: string;
};

export type ImportSvgToolInput = {
  attachmentId: string;
  pageId: string;
  parentId: string | null;
  index: number;
  x: number;
  y: number;
};

export type InternalImportSvgToolInput = ImportSvgToolInput & {
  name: string;
  svg: string;
  idPrefix: string;
};

export type AgentSvgImportResult = {
  kind: "svg-import-result";
  version: 1;
  ok: true;
  format: "svg";
  attachmentId: string;
  name: string;
  pageId: string;
  parentId: string | null;
  rootNodeId: string;
  importedNodeIds: string[];
  revision: number;
  atomic: true;
  issues: SvgInterchangeIssue[];
};

export type PreparedAgentSvgExport = {
  kind: "svg-export-preparation";
  version: 1;
  suggestedName: string;
  svg: string;
  revision: number;
  exportedNodeIds: string[];
  issues: SvgInterchangeIssue[];
};

export const IMPORT_SVG_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    attachmentId: { type: "string", pattern: "^svg_[a-f0-9]{64}$" },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    parentId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "null" },
      ],
    },
    index: { type: "integer", minimum: 0 },
    x: { type: "number" },
    y: { type: "number" },
  },
  required: ["attachmentId", "pageId", "parentId", "index", "x", "y"],
  additionalProperties: false,
} as const;

export const EXPORT_SVG_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    rootNodeIds: {
      type: "array",
      minItems: 1,
      maxItems: 512,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    suggestedName: {
      type: "string",
      minLength: 1,
      maxLength: 255,
      description:
        "Portable file name only, never a path. OpenDesign appends .svg when needed.",
    },
    includeLayerIds: { type: "boolean" },
    padding: { type: "number", minimum: 0, maximum: 100_000 },
  },
  required: ["pageId", "rootNodeIds", "suggestedName"],
  additionalProperties: false,
} as const;

export const EXPORT_RASTER_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    rootNodeId: { type: "string", minLength: 1, maxLength: 256 },
    suggestedName: {
      type: "string",
      minLength: 1,
      maxLength: 255,
      description: "Portable file name only, never a path.",
    },
    format: { enum: ["png", "jpeg", "webp"] },
    size: {
      oneOf: [
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
            value: {
              type: "integer" as const,
              minimum: 1,
              maximum: 16_384,
            },
          },
          required: ["mode", "value"],
          additionalProperties: false,
        })),
      ],
    },
    background: {
      oneOf: [
        {
          type: "object",
          properties: { mode: { const: "transparent" } },
          required: ["mode"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            mode: { const: "color" },
            color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          },
          required: ["mode", "color"],
          additionalProperties: false,
        },
      ],
    },
    quality: { type: "number", minimum: 0.01, maximum: 1 },
    resampling: { enum: ["smooth", "pixelated"] },
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
} as const;

export function isExportSvgToolInput(
  input: unknown,
): input is ExportSvgToolInput {
  if (!isRecord(input)) return false;
  return (
    safeId(input.pageId) &&
    Array.isArray(input.rootNodeIds) &&
    input.rootNodeIds.length > 0 &&
    input.rootNodeIds.length <= 512 &&
    input.rootNodeIds.every(safeId) &&
    new Set(input.rootNodeIds).size === input.rootNodeIds.length &&
    isPortableFileName(input.suggestedName) &&
    (input.includeLayerIds === undefined ||
      typeof input.includeLayerIds === "boolean") &&
    (input.padding === undefined ||
      (finite(input.padding) &&
        input.padding >= 0 &&
        input.padding <= 100_000)) &&
    Object.keys(input).every((key) =>
      [
        "pageId",
        "rootNodeIds",
        "suggestedName",
        "includeLayerIds",
        "padding",
      ].includes(key),
    )
  );
}

export function isExportRasterToolInput(
  input: unknown,
): input is ExportRasterToolInput {
  if (!isRecord(input) || !isPortableFileName(input.suggestedName)) {
    return false;
  }
  if (
    !Object.keys(input).every((key) =>
      [
        "pageId",
        "rootNodeId",
        "suggestedName",
        "format",
        "size",
        "background",
        "quality",
        "resampling",
      ].includes(key),
    )
  ) {
    return false;
  }
  return isRasterExportRequest({
    version: RASTER_EXPORT_VERSION,
    pageId: input.pageId,
    rootNodeId: input.rootNodeId,
    format: input.format,
    size: input.size,
    background: input.background,
    quality: input.quality,
    resampling: input.resampling,
  });
}

export function isPreparedAgentRasterExport(
  value: unknown,
): value is PreparedAgentRasterExport {
  if (!isRecord(value)) return false;
  return (
    value.kind === "raster-export-preparation" &&
    value.version === 1 &&
    isPortableFileName(value.suggestedName) &&
    (value.format === "png" ||
      value.format === "jpeg" ||
      value.format === "webp") &&
    value.mimeType === rasterExportMimeType(value.format) &&
    value.bytes instanceof Uint8Array &&
    value.bytes.byteLength > 0 &&
    value.bytes.byteLength <= RASTER_EXPORT_MAX_ENCODED_BYTES &&
    Number.isInteger(value.width) &&
    Number(value.width) > 0 &&
    Number(value.width) <= 16_384 &&
    Number.isInteger(value.height) &&
    Number(value.height) > 0 &&
    Number(value.height) <= 16_384 &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    safeId(value.rootNodeId) &&
    exactKeys(value, [
      "kind",
      "version",
      "suggestedName",
      "format",
      "mimeType",
      "bytes",
      "width",
      "height",
      "revision",
      "rootNodeId",
    ])
  );
}

export function isImportSvgToolInput(
  input: unknown,
): input is ImportSvgToolInput {
  return (
    isRecord(input) &&
    typeof input.attachmentId === "string" &&
    /^svg_[a-f0-9]{64}$/.test(input.attachmentId) &&
    safeId(input.pageId) &&
    (input.parentId === null || safeId(input.parentId)) &&
    Number.isInteger(input.index) &&
    Number(input.index) >= 0 &&
    finite(input.x) &&
    finite(input.y) &&
    exactKeys(input, ["attachmentId", "pageId", "parentId", "index", "x", "y"])
  );
}

export function isInternalImportSvgToolInput(
  input: unknown,
): input is InternalImportSvgToolInput {
  if (!isRecord(input)) return false;
  const publicInput = {
    attachmentId: input.attachmentId,
    pageId: input.pageId,
    parentId: input.parentId,
    index: input.index,
    x: input.x,
    y: input.y,
  };
  return (
    isImportSvgToolInput(publicInput) &&
    boundedText(input.name, 255) &&
    typeof input.svg === "string" &&
    input.svg.length > 0 &&
    input.svg.length <= SVG_MAX_CHARACTERS &&
    typeof input.idPrefix === "string" &&
    input.idPrefix.length <= 80 &&
    /^[A-Za-z][A-Za-z0-9_-]*$/.test(input.idPrefix) &&
    exactKeys(input, [
      "attachmentId",
      "pageId",
      "parentId",
      "index",
      "x",
      "y",
      "name",
      "svg",
      "idPrefix",
    ])
  );
}

export function isAgentSvgImportResult(
  value: unknown,
): value is AgentSvgImportResult {
  return (
    isRecord(value) &&
    value.kind === "svg-import-result" &&
    value.version === 1 &&
    value.ok === true &&
    value.format === "svg" &&
    typeof value.attachmentId === "string" &&
    /^svg_[a-f0-9]{64}$/.test(value.attachmentId) &&
    boundedText(value.name, 255) &&
    safeId(value.pageId) &&
    (value.parentId === null || safeId(value.parentId)) &&
    safeId(value.rootNodeId) &&
    Array.isArray(value.importedNodeIds) &&
    value.importedNodeIds.length > 0 &&
    value.importedNodeIds.length <= 10_000 &&
    value.importedNodeIds.every(safeId) &&
    new Set(value.importedNodeIds).size === value.importedNodeIds.length &&
    value.importedNodeIds.includes(value.rootNodeId) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    value.atomic === true &&
    Array.isArray(value.issues) &&
    value.issues.length <= 1_000 &&
    value.issues.every(isSvgInterchangeIssue) &&
    exactKeys(value, [
      "kind",
      "version",
      "ok",
      "format",
      "attachmentId",
      "name",
      "pageId",
      "parentId",
      "rootNodeId",
      "importedNodeIds",
      "revision",
      "atomic",
      "issues",
    ])
  );
}

export function isPreparedAgentSvgExport(
  value: unknown,
): value is PreparedAgentSvgExport {
  return (
    isRecord(value) &&
    value.kind === "svg-export-preparation" &&
    value.version === 1 &&
    isPortableFileName(value.suggestedName) &&
    typeof value.svg === "string" &&
    value.svg.length > 0 &&
    value.svg.length <= SVG_MAX_CHARACTERS &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    Array.isArray(value.exportedNodeIds) &&
    value.exportedNodeIds.length > 0 &&
    value.exportedNodeIds.length <= 10_000 &&
    value.exportedNodeIds.every(safeId) &&
    new Set(value.exportedNodeIds).size === value.exportedNodeIds.length &&
    Array.isArray(value.issues) &&
    value.issues.length <= 1_000 &&
    value.issues.every(isSvgInterchangeIssue) &&
    exactKeys(value, [
      "kind",
      "version",
      "suggestedName",
      "svg",
      "revision",
      "exportedNodeIds",
      "issues",
    ])
  );
}
