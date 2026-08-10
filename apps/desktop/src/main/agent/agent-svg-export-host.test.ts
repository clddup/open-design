import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import { EXPORT_SVG_TOOL_NAME } from "../../shared/design-agent-tools";
import { AgentSvgExportHost } from "./agent-svg-export-host";

const context: TrustedToolContext = {
  runId: "run_svg",
  sessionId: "conversation_svg",
  documentId: "document_brand",
  revision: 7,
  scope: {
    kind: "page",
    pageId: "page_brand",
    selectedNodeIds: [],
  },
  mutationTarget: { kind: "page", pageId: "page_brand" },
};

const call: ToolCallRequest = {
  toolCallId: "tool_export_svg",
  toolName: EXPORT_SVG_TOOL_NAME,
  input: {
    pageId: "page_brand",
    rootNodeIds: ["brand_mark"],
    suggestedName: "Acme brand",
    includeLayerIds: true,
    padding: 16,
  },
};

function prepared(
  overrides: Partial<TrustedToolResult> = {},
): TrustedToolResult {
  return {
    observedRevision: 7,
    content: {
      kind: "svg-export-preparation",
      version: 1,
      suggestedName: "Acme brand",
      svg: '<svg viewBox="0 0 312 312"><path /></svg>',
      revision: 7,
      exportedNodeIds: ["brand_mark"],
      issues: [
        {
          code: "boolean-flattened",
          message: "Boolean operands were exported as one path",
          severity: "warning",
          nodeId: "brand_mark",
        },
      ],
    },
    ...overrides,
  };
}

describe("AgentSvgExportHost", () => {
  it("validates Renderer output, saves through Main, and hides source and path", async () => {
    const renderer = { execute: vi.fn().mockResolvedValue(prepared()) };
    const files = {
      saveSvgFile: vi.fn().mockResolvedValue({ name: "Acme brand.svg" }),
    };
    const host = new AgentSvgExportHost(renderer, files);

    const result = await host.execute(
      call,
      context,
      new AbortController().signal,
    );

    expect(renderer.execute).toHaveBeenCalledWith(
      call,
      context,
      expect.any(AbortSignal),
    );
    expect(files.saveSvgFile).toHaveBeenCalledWith(
      {
        suggestedName: "Acme brand",
        contents: '<svg viewBox="0 0 312 312"><path /></svg>',
      },
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      observedRevision: 7,
      content: {
        ok: true,
        format: "svg",
        saved: true,
        name: "Acme brand.svg",
        revision: 7,
        exportedNodeIds: ["brand_mark"],
        issues: [{ code: "boolean-flattened" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("<svg");
    expect(JSON.stringify(result)).not.toContain("filePath");
  });

  it("returns a non-error cancelled delivery when the native dialog is dismissed", async () => {
    const host = new AgentSvgExportHost(
      { execute: vi.fn().mockResolvedValue(prepared()) },
      { saveSvgFile: vi.fn().mockResolvedValue(null) },
    );

    await expect(
      host.execute(call, context, new AbortController().signal),
    ).resolves.toMatchObject({
      content: { ok: true, saved: false, name: "Acme brand" },
    });
  });

  it("rejects forged or stale Renderer results before opening a save dialog", async () => {
    const saveSvgFile = vi.fn();
    const forged = prepared({
      content: {
        ...(prepared().content as Record<string, unknown>),
        filePath: "/tmp/acme.svg",
      },
    });
    const forgedHost = new AgentSvgExportHost(
      { execute: vi.fn().mockResolvedValue(forged) },
      { saveSvgFile },
    );
    await expect(
      forgedHost.execute(call, context, new AbortController().signal),
    ).rejects.toThrow("invalid SVG export");

    const staleHost = new AgentSvgExportHost(
      {
        execute: vi.fn().mockResolvedValue(
          prepared({
            observedRevision: 6,
            content: {
              ...(prepared().content as Record<string, unknown>),
              revision: 6,
            },
          }),
        ),
      },
      { saveSvgFile },
    );
    await expect(
      staleHost.execute(call, context, new AbortController().signal),
    ).rejects.toThrow("revision conflict");
    expect(saveSvgFile).not.toHaveBeenCalled();
  });

  it("rejects Renderer metadata that does not match the explicit request", async () => {
    const saveSvgFile = vi.fn();
    const wrongName = prepared({
      content: {
        ...(prepared().content as Record<string, unknown>),
        suggestedName: "Different export",
      },
    });
    await expect(
      new AgentSvgExportHost(
        { execute: vi.fn().mockResolvedValue(wrongName) },
        { saveSvgFile },
      ).execute(call, context, new AbortController().signal),
    ).rejects.toThrow("mismatched SVG export metadata");

    const missingRoot = prepared({
      content: {
        ...(prepared().content as Record<string, unknown>),
        exportedNodeIds: ["different_root"],
      },
    });
    await expect(
      new AgentSvgExportHost(
        { execute: vi.fn().mockResolvedValue(missingRoot) },
        { saveSvgFile },
      ).execute(call, context, new AbortController().signal),
    ).rejects.toThrow("mismatched SVG export metadata");
    expect(saveSvgFile).not.toHaveBeenCalled();
  });

  it("honors cancellation before Renderer work starts", async () => {
    const renderer = { execute: vi.fn() };
    const files = { saveSvgFile: vi.fn() };
    const controller = new AbortController();
    controller.abort();

    await expect(
      new AgentSvgExportHost(renderer, files).execute(
        call,
        context,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(renderer.execute).not.toHaveBeenCalled();
    expect(files.saveSvgFile).not.toHaveBeenCalled();
  });
});
