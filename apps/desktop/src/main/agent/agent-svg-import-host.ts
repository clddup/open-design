import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { createHash } from "node:crypto";
import {
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  isAgentSvgImportResult,
  isImportSvgToolInput,
  type InternalImportSvgToolInput,
} from "@/shared/design-agent-tools";

interface RendererSvgImportPort {
  execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<TrustedToolResult>;
}

interface SvgReferencePort {
  materializeSvg(
    attachmentId: string,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<{
    attachment: {
      attachmentId: string;
      name: string;
      mimeType: "image/svg+xml";
      byteSize: number;
    };
    svg: string;
  }>;
}

/**
 * Main-owned authorization and materialization boundary for Agent SVG import.
 *
 * The public model tool carries only a run-scoped attachment handle and an
 * explicit inspected target. Main resolves the source, creates collision-safe
 * internal node IDs, and validates the complete Renderer transaction result.
 * SVG source and the internal prefix never return to the Agent process.
 */
export class AgentSvgImportHost {
  constructor(
    private readonly renderer: RendererSvgImportPort,
    private readonly references: SvgReferencePort,
  ) {}

  async execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<TrustedToolResult> {
    if (
      call.toolName !== IMPORT_SVG_TOOL_NAME ||
      !isImportSvgToolInput(call.input)
    ) {
      throw new TypeError("Invalid Agent SVG import tool call");
    }
    throwIfAborted(signal);
    const materialized = await this.references.materializeSvg(
      call.input.attachmentId,
      context,
      signal,
    );
    throwIfAborted(signal);
    const idPrefix = createSvgIdPrefix(call, context);
    const name = safeSvgName(materialized.attachment.name);
    const internalInput: InternalImportSvgToolInput = {
      ...call.input,
      name,
      svg: materialized.svg,
      idPrefix,
    };
    const rendered = await this.renderer.execute(
      {
        ...call,
        toolName: INTERNAL_IMPORT_SVG_TOOL_NAME,
        input: internalInput,
      },
      context,
      signal,
    );

    const result = rendered.content;
    if (!isAgentSvgImportResult(result)) {
      throw new TypeError("Renderer returned an invalid SVG import result");
    }
    if (
      result.attachmentId !== call.input.attachmentId ||
      result.name !== name ||
      result.pageId !== call.input.pageId ||
      result.parentId !== call.input.parentId ||
      !result.importedNodeIds.every((nodeId) =>
        nodeId.startsWith(`${idPrefix}_`),
      )
    ) {
      throw new TypeError("Renderer returned mismatched SVG import metadata");
    }
    if (
      result.revision !== context.revision + 1 ||
      rendered.observedRevision !== result.revision ||
      rendered.designRevision?.previousRevision !== context.revision ||
      rendered.designRevision.revision !== result.revision
    ) {
      throw new Error(
        `SVG import revision conflict: expected ${context.revision + 1}, received ${result.revision}`,
      );
    }

    return {
      observedRevision: result.revision,
      designRevision: { ...rendered.designRevision },
      content: {
        ...result,
        importedNodeIds: [...result.importedNodeIds],
        issues: result.issues.map((issue) => ({ ...issue })),
      },
    };
  }
}

function safeSvgName(value: string): string {
  const printable = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
        ? " "
        : character;
    })
    .join("");
  return printable.trim().slice(0, 255) || "Imported SVG";
}

function createSvgIdPrefix(
  call: ToolCallRequest,
  context: TrustedToolContext,
): string {
  const digest = createHash("sha256")
    .update(context.runId)
    .update("\0")
    .update(context.documentId)
    .update("\0")
    .update(String(context.revision))
    .update("\0")
    .update(call.toolCallId)
    .update("\0")
    .update(String((call.input as { attachmentId: string }).attachmentId))
    .digest("hex");
  return `agent_svg_${digest.slice(0, 48)}`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("SVG import cancelled", "AbortError");
}
