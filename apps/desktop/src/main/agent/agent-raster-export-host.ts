import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  EXPORT_RASTER_TOOL_NAME,
  PreparedAgentRasterExportContract,
  type ExportRasterToolInput,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { RasterFileService } from "../raster/raster-file-service.js";
import type { RendererDesignToolHost } from "./renderer-design-tool-host.js";

type RendererRasterExportPort = Pick<RendererDesignToolHost, "execute">;
type RasterSavePort = Pick<RasterFileService, "saveRasterFile">;

/** Finalizes Agent raster delivery without exposing bytes or paths to the model. */
export class AgentRasterExportHost {
  constructor(
    private readonly renderer: RendererRasterExportPort,
    private readonly files: RasterSavePort,
  ) {}

  async execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<TrustedToolResult> {
    if (call.toolName !== EXPORT_RASTER_TOOL_NAME) {
      throw new TypeError("Invalid Agent raster export tool call");
    }
    const publicInput = call.input as ExportRasterToolInput;
    throwIfAborted(signal);
    const preparedResult = await this.renderer.execute(
      { ...call, input: publicInput },
      context,
      signal,
    );
    throwIfAborted(signal);
    const parsedPrepared = PreparedAgentRasterExportContract.parse(
      preparedResult.content,
    );
    if (!parsedPrepared.ok) {
      throw new TypeError(
        formatValidationFailure(
          "Renderer raster export",
          parsedPrepared.issues,
        ),
      );
    }
    const prepared = parsedPrepared.value;
    if (
      prepared.revision !== context.revision ||
      preparedResult.observedRevision !== prepared.revision
    ) {
      throw designWorkflowError(
        "revision_conflict",
        `Raster export revision conflict: expected ${context.revision}, received ${prepared.revision}`,
      );
    }
    if (
      prepared.suggestedName !== publicInput.suggestedName ||
      prepared.rootNodeId !== publicInput.rootNodeId ||
      prepared.format !== publicInput.format
    ) {
      throw new TypeError(
        "Renderer returned mismatched raster export metadata",
      );
    }
    const saved = await this.files.saveRasterFile(
      {
        suggestedName: prepared.suggestedName,
        format: prepared.format,
        mimeType: prepared.mimeType,
        bytes: prepared.bytes,
        width: prepared.width,
        height: prepared.height,
      },
      signal,
    );
    return {
      observedRevision: prepared.revision,
      content: {
        ok: true,
        format: prepared.format,
        saved: saved !== null,
        name: saved?.name ?? prepared.suggestedName,
        width: prepared.width,
        height: prepared.height,
        byteSize: saved?.byteSize ?? prepared.bytes.byteLength,
        revision: prepared.revision,
        rootNodeId: prepared.rootNodeId,
      },
    };
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Raster export cancelled", "AbortError");
}
