import { isSvgInterchangeIssue } from "@opendesign/import-export-service/svg-issues";
import { SVG_MAX_CHARACTERS } from "@opendesign/import-export-service/limits";
import {
  RASTER_EXPORT_MAX_ENCODED_BYTES,
  rasterExportMimeType,
} from "@opendesign/import-export-service/raster";
import { isPortableFileName } from "./portable-file-name";
import {
  EXPORT_RASTER_TOOL_INPUT_SCHEMA,
  EXPORT_SVG_TOOL_INPUT_SCHEMA,
  IMPORT_SVG_TOOL_INPUT_SCHEMA,
  INTERNAL_IMPORT_SVG_TOOL_INPUT_SCHEMA,
} from "./design-agent-import-export-tool-schema";
import type {
  AgentSvgImportResult,
  ExportRasterToolInput,
  ExportSvgToolInput,
  ImportSvgToolInput,
  InternalImportSvgToolInput,
  PreparedAgentRasterExport,
  PreparedAgentSvgExport,
} from "./design-agent-import-export-tool-types";
import { defineContract, type ValidationIssue } from "./contract-validation";
import {
  boundedText,
  exactKeys,
  isRecord,
  safeId,
} from "./design-agent-validation";

export {
  EXPORT_RASTER_TOOL_INPUT_SCHEMA,
  EXPORT_SVG_TOOL_INPUT_SCHEMA,
  IMPORT_SVG_TOOL_INPUT_SCHEMA,
  INTERNAL_IMPORT_SVG_TOOL_INPUT_SCHEMA,
} from "./design-agent-import-export-tool-schema";
export type {
  AgentSvgImportResult,
  ExportRasterToolInput,
  ExportSvgToolInput,
  ImportSvgToolInput,
  InternalImportSvgToolInput,
  PreparedAgentRasterExport,
  PreparedAgentSvgExport,
} from "./design-agent-import-export-tool-types";

export const ImportSvgContract = defineContract<ImportSvgToolInput>({
  schema: IMPORT_SVG_TOOL_INPUT_SCHEMA,
  code: "design_import_svg.schema_invalid",
  subject: "SVG import",
  maximum: 32,
});

export const InternalImportSvgContract =
  defineContract<InternalImportSvgToolInput>({
    schema: INTERNAL_IMPORT_SVG_TOOL_INPUT_SCHEMA,
    code: "internal_import_svg.schema_invalid",
    subject: "internal SVG import",
    maximum: 32,
    clone: false,
  });

export const ExportSvgContract = defineContract<ExportSvgToolInput>({
  schema: EXPORT_SVG_TOOL_INPUT_SCHEMA,
  code: "design_export_svg.schema_invalid",
  subject: "SVG export",
  maximum: 32,
  refine: refinePortableSuggestedName,
});

export const ExportRasterContract = defineContract<ExportRasterToolInput>({
  schema: EXPORT_RASTER_TOOL_INPUT_SCHEMA,
  code: "design_export_raster.schema_invalid",
  subject: "Raster export",
  maximum: 32,
  refine: refinePortableSuggestedName,
});

function refinePortableSuggestedName(value: {
  suggestedName: string;
}): ValidationIssue[] {
  return isPortableFileName(value.suggestedName)
    ? []
    : [
        {
          code: "design_export.portable_name_invalid",
          path: "/suggestedName",
          message: "suggestedName must be a portable file name, never a path",
          actual: value.suggestedName,
          recovery:
            "Use a plain macOS/Windows-compatible file name without a directory, reserved device name, control character, or trailing dot/space.",
        },
      ];
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
