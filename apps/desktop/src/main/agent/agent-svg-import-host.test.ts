import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  type InternalImportSvgToolInput,
} from "../../shared/design-agent-tools";
import { AgentSvgImportHost } from "./agent-svg-import-host";

const attachmentId = `svg_${"a".repeat(64)}`;
const svg = '<svg viewBox="0 0 20 20"><path d="M0 0H20V20Z"/></svg>';
const context: TrustedToolContext = {
  runId: "run_svg_import",
  sessionId: "conversation_svg_import",
  documentId: "document_brand",
  revision: 7,
  scope: { kind: "page", pageId: "page_brand", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_brand" },
};
const call: ToolCallRequest = {
  toolCallId: "tool_import_svg",
  toolName: IMPORT_SVG_TOOL_NAME,
  input: {
    attachmentId,
    pageId: "page_brand",
    parentId: "brand_frame",
    index: 2,
    x: 120,
    y: 80,
  },
};

function references() {
  return {
    materializeSvg: vi.fn().mockResolvedValue({
      attachment: {
        attachmentId,
        name: "Brand mark.svg",
        mimeType: "image/svg+xml" as const,
        byteSize: Buffer.byteLength(svg),
      },
      svg,
    }),
  };
}

function successfulResult(
  internal: InternalImportSvgToolInput,
): TrustedToolResult {
  const rootNodeId = `${internal.idPrefix}_0001_svg`;
  const childNodeId = `${internal.idPrefix}_0002_path`;
  return {
    observedRevision: 8,
    designRevision: {
      previousRevision: 7,
      revision: 8,
      transactionId: "transaction_svg_import",
    },
    content: {
      kind: "svg-import-result",
      version: 1,
      ok: true,
      format: "svg",
      attachmentId,
      name: internal.name,
      pageId: internal.pageId,
      parentId: internal.parentId,
      rootNodeId,
      importedNodeIds: [rootNodeId, childNodeId],
      revision: 8,
      atomic: true,
      issues: [
        {
          code: "effect-omitted",
          message: "One filter was omitted",
          severity: "warning",
        },
      ],
    },
  };
}

describe("AgentSvgImportHost", () => {
  it("materializes one authorized handle and returns only bounded transaction metadata", async () => {
    let internalCall: ToolCallRequest | undefined;
    const renderer = {
      execute: vi.fn((candidate: ToolCallRequest) => {
        internalCall = candidate;
        return Promise.resolve(
          successfulResult(candidate.input as InternalImportSvgToolInput),
        );
      }),
    };
    const referenceHost = references();
    const result = await new AgentSvgImportHost(
      renderer,
      referenceHost,
    ).execute(call, context, new AbortController().signal);

    expect(referenceHost.materializeSvg).toHaveBeenCalledWith(
      attachmentId,
      context,
      expect.any(AbortSignal),
    );
    expect(internalCall).toMatchObject({
      toolCallId: call.toolCallId,
      toolName: INTERNAL_IMPORT_SVG_TOOL_NAME,
      input: {
        attachmentId,
        name: "Brand mark.svg",
        svg,
        pageId: "page_brand",
        parentId: "brand_frame",
        index: 2,
        x: 120,
        y: 80,
      },
    });
    expect(
      (internalCall?.input as InternalImportSvgToolInput).idPrefix,
    ).toMatch(/^agent_svg_[a-f0-9]{48}$/);
    expect(result).toMatchObject({
      observedRevision: 8,
      designRevision: { previousRevision: 7, revision: 8 },
      content: {
        kind: "svg-import-result",
        attachmentId,
        revision: 8,
        atomic: true,
        issues: [{ code: "effect-omitted" }],
      },
    });
    expect((result.content as { rootNodeId: string }).rootNodeId).toMatch(
      /^agent_svg_/,
    );
    expect(JSON.stringify(result)).not.toContain("<svg");
    expect(JSON.stringify(result)).not.toContain("idPrefix");
    expect(JSON.stringify(result)).not.toContain("filePath");
  });

  it("rejects unauthorized, forged, and stale materialization results", async () => {
    const unauthorized = references();
    unauthorized.materializeSvg.mockRejectedValueOnce(
      new Error("SVG attachment is not authorized for this run"),
    );
    const renderer = { execute: vi.fn() };
    await expect(
      new AgentSvgImportHost(renderer, unauthorized).execute(
        call,
        context,
        new AbortController().signal,
      ),
    ).rejects.toThrow("not authorized");
    expect(renderer.execute).not.toHaveBeenCalled();

    const forged = new AgentSvgImportHost(
      {
        execute: vi.fn((candidate: ToolCallRequest) => {
          const result = successfulResult(
            candidate.input as InternalImportSvgToolInput,
          );
          return Promise.resolve({
            ...result,
            content: {
              ...(result.content as Record<string, unknown>),
              svg,
            },
          });
        }),
      },
      references(),
    );
    await expect(
      forged.execute(call, context, new AbortController().signal),
    ).rejects.toThrow("invalid SVG import result");

    const stale = new AgentSvgImportHost(
      {
        execute: vi.fn((candidate: ToolCallRequest) => {
          const result = successfulResult(
            candidate.input as InternalImportSvgToolInput,
          );
          return Promise.resolve({
            ...result,
            observedRevision: 9,
            designRevision: {
              previousRevision: 8,
              revision: 9,
              transactionId: "transaction_wrong_revision",
            },
          });
        }),
      },
      references(),
    );
    await expect(
      stale.execute(call, context, new AbortController().signal),
    ).rejects.toThrow("revision conflict");
  });

  it("honors cancellation before materialization or Renderer dispatch", async () => {
    const renderer = { execute: vi.fn() };
    const referenceHost = references();
    const controller = new AbortController();
    controller.abort();

    await expect(
      new AgentSvgImportHost(renderer, referenceHost).execute(
        call,
        context,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(referenceHost.materializeSvg).not.toHaveBeenCalled();
    expect(renderer.execute).not.toHaveBeenCalled();
  });
});
