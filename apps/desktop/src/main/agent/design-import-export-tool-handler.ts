import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  type ImportSvgToolInput,
} from "@/shared/design-agent-tools.js";
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
    input.coordinator.assertDocumentInspected(input.context);
    return await input
      .getSvgExportHost()
      .execute(
        { ...input.call, input: input.call.input },
        input.executionContext,
        input.signal,
      );
  }

  if (input.call.toolName === EXPORT_RASTER_TOOL_NAME) {
    input.coordinator.assertDocumentInspected(input.context);
    return await input
      .getRasterExportHost()
      .execute(
        { ...input.call, input: input.call.input },
        input.executionContext,
        input.signal,
      );
  }

  if (input.call.toolName !== IMPORT_SVG_TOOL_NAME) return null;

  const importInput = input.call.input as ImportSvgToolInput;
  input.coordinator.assertDocumentInspected(input.context);
  const targetIds = input.coordinator.resolveMaterialTargetIdsIfPlanned(
    input.context,
    [],
    importInput.parentId,
  );
  const result = await input
    .getSvgImportHost()
    .execute(
      { ...input.call, input: importInput },
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
