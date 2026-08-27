import { rasterExportMimeType } from "@opendesign/import-export-service/raster";
import { isPortableFileName } from "./portable-file-name";
import {
  AGENT_SVG_IMPORT_RESULT_SCHEMA,
  EXPORT_RASTER_TOOL_INPUT_SCHEMA,
  EXPORT_SVG_TOOL_INPUT_SCHEMA,
  IMPORT_SVG_TOOL_INPUT_SCHEMA,
  INTERNAL_IMPORT_SVG_TOOL_INPUT_SCHEMA,
  PREPARED_AGENT_RASTER_EXPORT_SCHEMA,
  PREPARED_AGENT_SVG_EXPORT_SCHEMA,
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

export {
  EXPORT_RASTER_TOOL_INPUT_SCHEMA,
  EXPORT_SVG_TOOL_INPUT_SCHEMA,
  IMPORT_SVG_TOOL_INPUT_SCHEMA,
  INTERNAL_IMPORT_SVG_TOOL_INPUT_SCHEMA,
  AGENT_SVG_IMPORT_RESULT_SCHEMA,
  PREPARED_AGENT_RASTER_EXPORT_SCHEMA,
  PREPARED_AGENT_SVG_EXPORT_SCHEMA,
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

export const PreparedAgentRasterExportContract =
  defineContract<PreparedAgentRasterExport>({
    schema: PREPARED_AGENT_RASTER_EXPORT_SCHEMA,
    code: "prepared_agent_raster_export.schema_invalid",
    subject: "prepared Agent raster export",
    clone: false,
    refine: (value) => {
      const issues = refinePortableSuggestedName(value);
      if (value.mimeType !== rasterExportMimeType(value.format)) {
        issues.push({
          code: "prepared_agent_raster_export.mime_mismatch",
          path: "/mimeType",
          message: "mimeType must match format",
          expected: rasterExportMimeType(value.format),
          actual: value.mimeType,
          recovery:
            "Return the encoded raster with the MIME type derived from its declared format.",
        });
      }
      return issues;
    },
  });

export const AgentSvgImportResultContract =
  defineContract<AgentSvgImportResult>({
    schema: AGENT_SVG_IMPORT_RESULT_SCHEMA,
    code: "agent_svg_import_result.schema_invalid",
    subject: "Agent SVG import result",
    clone: false,
    refine: (value) =>
      value.importedNodeIds.includes(value.rootNodeId)
        ? []
        : [
            {
              code: "agent_svg_import_result.root_missing",
              path: "/rootNodeId",
              message: "rootNodeId must be included in importedNodeIds",
              expected: "one imported node ID",
              actual: value.rootNodeId,
              recovery:
                "Return the complete imported node identity set including its root.",
            },
          ],
  });

export const PreparedAgentSvgExportContract =
  defineContract<PreparedAgentSvgExport>({
    schema: PREPARED_AGENT_SVG_EXPORT_SCHEMA,
    code: "prepared_agent_svg_export.schema_invalid",
    subject: "prepared Agent SVG export",
    clone: false,
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
  return PreparedAgentRasterExportContract.parse(value).ok;
}

export function isAgentSvgImportResult(
  value: unknown,
): value is AgentSvgImportResult {
  return AgentSvgImportResultContract.parse(value).ok;
}

export function isPreparedAgentSvgExport(
  value: unknown,
): value is PreparedAgentSvgExport {
  return PreparedAgentSvgExportContract.parse(value).ok;
}
