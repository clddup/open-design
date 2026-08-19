import { createWelcomeDocument } from "@opendesign/editor-runtime";
import type {
  TextLayoutProvider,
  TextRunLayoutProvider,
} from "@opendesign/text-service";
import { describe, expect, it, vi } from "vitest";
import type { LeaferTextRunStyle } from "./text-run-layout.js";
import { inspectDesignTextLayoutQuality } from "./text-quality-inspection.js";

describe("design text layout quality inspection", () => {
  it("proves silent fixed-box clipping from full provider measurement", () => {
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.size = { width: 180, height: 36 };
    title.properties.textWrap = "word";
    title.properties.textOverflow = "clip";
    title.properties.textTruncation = "disabled";
    title.properties.maxLines = null;
    const measure = vi.fn<TextLayoutProvider["measure"]>((request) => ({
      ok: true,
      provider: "test-plain",
      providerVersion: "1",
      size: { width: request.width ?? 420, height: 96 },
      warnings: [],
    }));
    const evidence = inspectDesignTextLayoutQuality(
      document,
      "page_welcome",
      "frame_welcome",
      { id: "test-plain", version: "1", measure },
      unusedRunProvider(),
    );
    expect(evidence.measurements).toContainEqual(
      expect.objectContaining({
        status: "measured",
        nodeId: "title_welcome",
        overflow: { horizontal: false, vertical: true },
        truncated: false,
      }),
    );
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "auto-height",
        textTruncation: "disabled",
        width: 180,
      }),
    );
  });

  it("distinguishes explicit ending truncation from silent clipping", () => {
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.size = { width: 180, height: 48 };
    title.properties.textWrap = "word";
    title.properties.textOverflow = "clip";
    title.properties.textTruncation = "ending";
    title.properties.maxLines = 2;
    const measure = vi.fn<TextLayoutProvider["measure"]>((request) => ({
      ok: true,
      provider: "test-plain",
      providerVersion: "1",
      size: {
        width: request.width ?? 420,
        height: request.textTruncation === "ending" ? 48 : 120,
      },
      warnings: [],
    }));
    const evidence = inspectDesignTextLayoutQuality(
      document,
      "page_welcome",
      "frame_welcome",
      { id: "test-plain", version: "1", measure },
      unusedRunProvider(),
    );
    expect(evidence.measurements).toContainEqual(
      expect.objectContaining({
        status: "measured",
        nodeId: "title_welcome",
        truncated: true,
        displayedContentSize: { width: 180, height: 48 },
        fullContentSize: { width: 180, height: 120 },
      }),
    );
    expect(measure).toHaveBeenCalledTimes(3);
  });

  it("uses rich-text content bounds and fails closed for unsupported ellipsis", () => {
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.size = { width: 320, height: 40 };
    title.properties.runs = [
      {
        start: 0,
        end: title.properties.content.length,
        style: {
          fontFamily: title.properties.fontFamily,
          fontStyleName: title.properties.fontStyleName,
          fontSize: title.properties.fontSize,
          fontWeight: title.properties.fontWeight,
          fontSlant: title.properties.fontSlant,
          letterSpacing: title.properties.letterSpacing,
          lineHeight: title.properties.lineHeight,
          textCase: title.properties.textCase,
          textDecoration: title.properties.textDecoration,
          fills: title.properties.fills,
        },
      },
    ];
    const layout = vi.fn<TextRunLayoutProvider<LeaferTextRunStyle>["layout"]>(
      (request) => ({
        ok: true,
        provider: "test-runs",
        providerVersion: "1",
        size: { width: request.width ?? 320, height: request.height ?? 96 },
        contentBounds: { x: 0, y: 0, width: 300, height: 96 },
        lines: [
          {
            start: 0,
            end: request.content.length,
            x: 0,
            y: 0,
            width: 300,
            height: 96,
            baseline: 72,
          },
        ],
        fragments: [
          {
            start: 0,
            end: request.content.length,
            text: request.content,
            style: request.baseStyle,
            x: 0,
            y: 0,
            width: 300,
            height: 96,
            baseline: 72,
            lineIndex: 0,
          },
        ],
        markers: [],
        warnings: [],
      }),
    );
    const providers = {
      plain: unusedPlainProvider(),
      rich: { id: "test-runs", version: "1", layout },
    };
    let evidence = inspectDesignTextLayoutQuality(
      document,
      "page_welcome",
      "frame_welcome",
      providers.plain,
      providers.rich,
    );
    expect(evidence.measurements).toContainEqual(
      expect.objectContaining({
        status: "measured",
        nodeId: "title_welcome",
        overflow: { horizontal: false, vertical: true },
      }),
    );
    title.properties.textTruncation = "ending";
    title.properties.maxLines = 1;
    evidence = inspectDesignTextLayoutQuality(
      document,
      "page_welcome",
      "frame_welcome",
      providers.plain,
      providers.rich,
    );
    expect(evidence.measurements).toContainEqual({
      status: "unavailable",
      nodeId: "title_welcome",
      message:
        "Rich text ending truncation is not supported by the production text-run layout provider",
    });
  });
});

function unusedPlainProvider(): TextLayoutProvider {
  return {
    id: "unused-plain",
    version: "1",
    measure: () => ({
      ok: false,
      code: "provider-unavailable",
      message: "unused",
      retryable: false,
    }),
  };
}

function unusedRunProvider(): TextRunLayoutProvider<LeaferTextRunStyle> {
  return {
    id: "unused-runs",
    version: "1",
    layout: () => ({
      ok: false,
      code: "provider-unavailable",
      message: "unused",
      retryable: false,
    }),
  };
}
