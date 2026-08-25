import { isSvgInterchangeIssue } from "@opendesign/import-export-service/svg-issues";
import { SVG_MAX_CHARACTERS } from "@opendesign/import-export-service/limits";
import type { TSchema } from "@opendesign/design-contracts";
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
import {
  contractDiscriminatedSchemaIssues,
  contractSchemaIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./contract-validation";
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

export const ImportSvgContract = contract<ImportSvgToolInput>(
  IMPORT_SVG_TOOL_INPUT_SCHEMA,
  "design_import_svg.schema_invalid",
  "SVG import",
  undefined,
);

export const InternalImportSvgContract = contract<InternalImportSvgToolInput>(
  INTERNAL_IMPORT_SVG_TOOL_INPUT_SCHEMA,
  "internal_import_svg.schema_invalid",
  "internal SVG import",
  undefined,
  false,
);

export const ExportSvgContract = contract<ExportSvgToolInput>(
  EXPORT_SVG_TOOL_INPUT_SCHEMA,
  "design_export_svg.schema_invalid",
  "SVG export",
  refinePortableSuggestedName,
);

export const ExportRasterContract =
  discriminatedContract<ExportRasterToolInput>(
    EXPORT_RASTER_TOOL_INPUT_SCHEMA,
    "format",
    "design_export_raster.schema_invalid",
    "Raster export",
    refinePortableSuggestedName,
  );

function contract<T>(
  schema: TSchema,
  code: string,
  subject: string,
  refine: ((value: T) => ValidationIssue[]) | undefined,
  clone = true,
) {
  const parse = (input: unknown): ValidationResult<T> => {
    const structureIssues = contractSchemaIssues(schema, input, {
      code,
      subject,
      maximum: 32,
    });
    if (structureIssues.length > 0) {
      return { ok: false, issues: structureIssues };
    }
    const value = (clone ? structuredClone(input) : input) as T;
    const domainIssues = refine?.(value) ?? [];
    return domainIssues.length > 0
      ? { ok: false, issues: domainIssues }
      : { ok: true, value };
  };
  return {
    schema,
    parse,
    issues: (input: unknown): ValidationIssue[] => {
      const result = parse(input);
      return result.ok ? [] : result.issues;
    },
  };
}

function discriminatedContract<T>(
  schema: TSchema,
  discriminant: string,
  code: string,
  subject: string,
  refine: ((value: T) => ValidationIssue[]) | undefined,
) {
  const parse = (input: unknown): ValidationResult<T> => {
    const structureIssues = contractDiscriminatedSchemaIssues(
      schema,
      input,
      discriminant,
      { code, subject, maximum: 32 },
    );
    if (structureIssues.length > 0) {
      return { ok: false, issues: structureIssues };
    }
    const value = structuredClone(input) as T;
    const domainIssues = refine?.(value) ?? [];
    return domainIssues.length > 0
      ? { ok: false, issues: domainIssues }
      : { ok: true, value };
  };
  return {
    schema,
    parse,
    issues: (input: unknown): ValidationIssue[] => {
      const result = parse(input);
      return result.ok ? [] : result.issues;
    },
  };
}

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
