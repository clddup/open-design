import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  ExportRasterContract,
  ExportSvgContract,
  IMPORT_SVG_TOOL_NAME,
  ImportSvgContract,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { AgentRasterExportHost } from "./agent-raster-export-host.js";
import type { AgentSvgExportHost } from "./agent-svg-export-host.js";
import type { AgentSvgImportHost } from "./agent-svg-import-host.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export type DesignImportExportToolHandlerInput = {
  call: ToolCallRequest;
  context: TrustedToolContext;
  executionContext: TrustedToolContext;
  signal: AbortSignal;
  coordinator: GlobalTaskCoordinator;
  getSvgExportHost(): AgentSvgExportHost;
  getRasterExportHost(): AgentRasterExportHost;
  getSvgImportHost(): AgentSvgImportHost;
  withDelivery(result: TrustedToolResult): TrustedToolResult;
};

export async function handleDesignImportExportTool(
  input: DesignImportExportToolHandlerInput,
): Promise<TrustedToolResult | null> {
  if (input.call.toolName === EXPORT_SVG_TOOL_NAME) {
    const parsed = ExportSvgContract.parse(input.call.input);
    if (!parsed.ok) {
      throw new TypeError(formatValidationFailure("SVG export", parsed.issues));
    }
    input.coordinator.assertDocumentInspected(input.context);
    return await input
      .getSvgExportHost()
      .execute(
        { ...input.call, input: parsed.value },
        input.executionContext,
        input.signal,
      );
  }

  if (input.call.toolName === EXPORT_RASTER_TOOL_NAME) {
    const parsed = ExportRasterContract.parse(input.call.input);
    if (!parsed.ok) {
      throw new TypeError(
        formatValidationFailure("Raster export", parsed.issues),
      );
    }
    input.coordinator.assertDocumentInspected(input.context);
    return await input
      .getRasterExportHost()
      .execute(
        { ...input.call, input: parsed.value },
        input.executionContext,
        input.signal,
      );
  }

  if (input.call.toolName !== IMPORT_SVG_TOOL_NAME) return null;

  const parsed = ImportSvgContract.parse(input.call.input);
  if (!parsed.ok) {
    throw new TypeError(formatValidationFailure("SVG import", parsed.issues));
  }
  input.coordinator.assertDocumentInspected(input.context);
  input.coordinator.assertVisualReviewBeforeWrite(input.context);
  const targetIds = input.coordinator.resolveMaterialTargetIds(
    input.context,
    [],
    parsed.value.parentId,
  );
  const result = await input
    .getSvgImportHost()
    .execute(
      { ...input.call, input: parsed.value },
      input.executionContext,
      input.signal,
    );
  input.coordinator.recordMaterialDesignWriteCompleted(
    input.context.runId,
    targetIds,
    result.designRevision?.revision,
    importedNodeIdsFromResult(result),
  );
  return input.withDelivery(result);
}

function importedNodeIdsFromResult(result: TrustedToolResult): string[] {
  if (!isRecord(result.content)) return [];
  const importedNodeIds = result.content.importedNodeIds;
  return Array.isArray(importedNodeIds)
    ? importedNodeIds.filter(
        (nodeId): nodeId is string =>
          typeof nodeId === "string" && nodeId.length > 0,
      )
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
