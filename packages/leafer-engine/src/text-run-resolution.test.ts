import { createWelcomeDocument } from "@opendesign/editor-runtime";
import type { TextRunLayoutProvider } from "@opendesign/text-service";
import { describe, expect, it, vi } from "vitest";
import type { LeaferTextRunStyle } from "./text-run-layout.js";
import { resolveDesignTextRuns } from "./text-run-resolution.js";

describe("design rich-text projection resolution", () => {
  it("resolves persisted runs into exact-revision disposable fragments", () => {
    const document = richDocument();
    const layout = vi.fn<TextRunLayoutProvider<LeaferTextRunStyle>["layout"]>(
      (request) => ({
        ok: true,
        provider: "test-runs",
        providerVersion: "1",
        size: { width: 320, height: 64 },
        contentBounds: { x: 0, y: 0, width: 120, height: 24 },
        lines: [
          {
            start: 0,
            end: request.content.length,
            x: 0,
            y: 0,
            width: 120,
            height: 24,
            baseline: 18,
          },
        ],
        fragments: request.runs.map((run, index) => ({
          start: run.start,
          end: run.end,
          text: request.content.slice(run.start, run.end),
          style: run.style,
          x: index * 60,
          y: 0,
          width: 60,
          height: 24,
          baseline: 18,
          lineIndex: 0,
        })),
        warnings: [],
      }),
    );
    const result = resolveDesignTextRuns(document, "page_welcome", {
      id: "test-runs",
      version: "1",
      layout,
    });
    expect(result.warnings).toEqual([]);
    expect(result.projection).toMatchObject({
      documentId: document.documentId,
      pageId: "page_welcome",
      revision: document.revision,
    });
    expect(
      result.projection.resultsByNodeId.get("title_welcome")?.fragments,
    ).toHaveLength(2);
    expect(layout.mock.calls[0]?.[0].runs[1]?.style.fill).toEqual([
      expect.objectContaining({ type: "solid", color: "#ff3366" }),
    ]);
  });

  it("keeps the authoritative Text visible and reports provider failure", () => {
    const document = richDocument();
    const result = resolveDesignTextRuns(document, "page_welcome", {
      id: "failed-runs",
      version: "1",
      layout: () => ({
        ok: false,
        code: "provider-unavailable",
        message: "Imported face unavailable",
        retryable: true,
      }),
    });
    expect(result.projection.resultsByNodeId.size).toBe(0);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "rich-text-layout-failed",
        nodeId: "title_welcome",
        message: "Imported face unavailable",
      }),
    ]);
  });

  it("uses the rich projection for paragraph-only styles", () => {
    const document = richDocument();
    const node = document.nodesById.title_welcome;
    if (!node || node.kind !== "text") throw new Error("Missing title");
    node.properties.runs = [];
    node.properties.paragraphRuns = [
      {
        start: 0,
        end: node.properties.content.length,
        style: { paragraphIndent: 24, paragraphSpacing: 10 },
      },
    ];
    const layout = vi.fn<TextRunLayoutProvider<LeaferTextRunStyle>["layout"]>(
      (request) => ({
        ok: true,
        provider: "test-paragraphs",
        providerVersion: "1",
        size: { width: 320, height: 64 },
        contentBounds: { x: 24, y: 0, width: 120, height: 24 },
        lines: [
          {
            start: 0,
            end: request.content.length,
            x: 24,
            y: 0,
            width: 120,
            height: 24,
            baseline: 18,
          },
        ],
        fragments: [
          {
            start: 0,
            end: request.content.length,
            text: request.content,
            style: request.baseStyle,
            x: 24,
            y: 0,
            width: 120,
            height: 24,
            baseline: 18,
            lineIndex: 0,
          },
        ],
        warnings: [],
      }),
    );
    const result = resolveDesignTextRuns(document, "page_welcome", {
      id: "test-paragraphs",
      version: "1",
      layout,
    });
    expect(result.warnings).toEqual([]);
    expect(layout.mock.calls[0]?.[0].paragraphRuns).toEqual(
      node.properties.paragraphRuns,
    );
    expect(result.projection.resultsByNodeId.has(node.id)).toBe(true);
  });
});

function richDocument() {
  const document = structuredClone(createWelcomeDocument());
  const node = document.nodesById.title_welcome;
  if (!node || node.kind !== "text") throw new Error("Missing title");
  const base = {
    fontFamily: node.properties.fontFamily,
    fontStyleName: node.properties.fontStyleName,
    fontSize: node.properties.fontSize,
    fontWeight: node.properties.fontWeight,
    fontSlant: node.properties.fontSlant,
    letterSpacing: node.properties.letterSpacing,
    lineHeight: node.properties.lineHeight,
    textCase: node.properties.textCase,
    textDecoration: node.properties.textDecoration,
    fills: node.properties.fills,
  };
  node.properties.runs = [
    { start: 0, end: 4, style: base },
    {
      start: 4,
      end: node.properties.content.length,
      style: {
        ...base,
        fontWeight: 700,
        fills: [{ type: "solid", color: "#ff3366", opacity: 1 }],
      },
    },
  ];
  return document;
}
