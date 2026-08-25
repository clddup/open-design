import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  ExportSvgContract,
  EXPORT_SVG_TOOL_NAME,
  isPreparedAgentSvgExport,
} from "@/shared/design-agent-tools";
import type { SvgFileService } from "../svg/svg-file-service";

interface RendererSvgExportPort {
  execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<TrustedToolResult>;
}

type SvgSavePort = Pick<SvgFileService, "saveSvgFile">;

/**
 * Main-owned finalization boundary for Agent SVG delivery.
 *
 * Renderer prepares pure SVG from the frozen DesignDocument revision. Main
 * validates the complete response, opens the native save dialog, and returns
 * only delivery metadata to the model. Paths and SVG source never cross into
 * the Agent utility process.
 */
export class AgentSvgExportHost {
  constructor(
    private readonly renderer: RendererSvgExportPort,
    private readonly files: SvgSavePort,
  ) {}

  async execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<TrustedToolResult> {
    if (call.toolName !== EXPORT_SVG_TOOL_NAME) {
      throw new TypeError("Invalid Agent SVG export tool call");
    }
    const parsed = ExportSvgContract.parse(call.input);
    if (!parsed.ok) throw new TypeError("Invalid Agent SVG export tool call");
    const publicInput = parsed.value;
    throwIfAborted(signal);
    const preparedResult = await this.renderer.execute(
      { ...call, input: publicInput },
      context,
      signal,
    );
    throwIfAborted(signal);
    const prepared = preparedResult.content;
    if (!isPreparedAgentSvgExport(prepared)) {
      throw new TypeError("Renderer returned an invalid SVG export");
    }
    if (
      prepared.revision !== context.revision ||
      preparedResult.observedRevision !== prepared.revision
    ) {
      throw new Error(
        `SVG export revision conflict: expected ${context.revision}, received ${prepared.revision}`,
      );
    }
    if (
      prepared.suggestedName !== publicInput.suggestedName ||
      !publicInput.rootNodeIds.every((nodeId) =>
        prepared.exportedNodeIds.includes(nodeId),
      )
    ) {
      throw new TypeError("Renderer returned mismatched SVG export metadata");
    }
    const saved = await this.files.saveSvgFile(
      {
        suggestedName: prepared.suggestedName,
        contents: prepared.svg,
      },
      signal,
    );
    return {
      observedRevision: prepared.revision,
      content: {
        ok: true,
        format: "svg",
        saved: saved !== null,
        name: saved?.name ?? prepared.suggestedName,
        revision: prepared.revision,
        exportedNodeIds: [...prepared.exportedNodeIds],
        issues: prepared.issues.map((issue) => ({ ...issue })),
      },
    };
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("SVG export cancelled", "AbortError");
}
