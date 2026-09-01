import type * as LeaferEditorModule from "leafer-editor";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import { projectDesignPage } from "./mapping.js";
import { projectResolvedTextRuns } from "./text-run-projection.js";
import {
  createLeaferTextRunLayoutProvider,
  leaferTextRunLayoutToProjection,
  LEAFER_TEXT_RUN_LAYOUT_PROVIDER_ID,
  LEAFER_TEXT_RUN_LAYOUT_PROVIDER_VERSION,
  type LeaferTextRunStyle,
} from "./text-run-layout.js";

class FakeRunText {
  static readonly destroy = vi.fn();
  readonly input: Record<string, unknown>;

  constructor(input: Record<string, unknown>) {
    this.input = input;
  }

  get boxBounds() {
    return {
      x: 0,
      y: 0,
      width: this.advance,
      height: this.lineHeight,
    };
  }

  get __() {
    return {
      __baseLine:
        this.lineHeight -
        (this.lineHeight - Number(this.input.fontSize) * 0.7) / 2,
      __lineHeight: this.lineHeight,
      __textDrawData: { rows: [{ width: this.advance }] },
    };
  }

  destroy(): void {
    FakeRunText.destroy();
  }

  private get advance(): number {
    const fontSize = Number(this.input.fontSize);
    const letterSpacing = Number(
      (this.input.letterSpacing as { value?: number } | undefined)?.value ?? 0,
    );
    const familyScale = String(this.input.fontFamily).includes("Wide")
      ? 1.5
      : 1;
    return Array.from(String(this.input.text)).reduce(
      (sum) => sum + fontSize * 0.5 * familyScale + letterSpacing,
      0,
    );
  }

  private get lineHeight(): number {
    return Number(
      (this.input.lineHeight as { value?: number } | undefined)?.value ??
        this.input.fontSize,
    );
  }
}

const leafer = {
  Text: FakeRunText,
} as unknown as Pick<typeof LeaferEditorModule, "Text">;

function style(
  overrides: Partial<LeaferTextRunStyle> = {},
): LeaferTextRunStyle {
  return {
    fill: "#111827",
    fontFamily: "Inter",
    fontSize: 20,
    fontSlant: "normal",
    fontStyleName: "Regular",
    fontWeight: 400,
    letterSpacing: 0,
    lineHeight: 24,
    textCase: "original",
    textDecoration: "none",
    textDecorationStyle: null,
    textDecorationOffset: null,
    textDecorationThickness: null,
    textDecorationColor: null,
    textDecorationSkipInk: null,
    ...overrides,
  };
}

describe("Leafer native text run layout provider", () => {
  it("materializes one bounded ending-truncation display line", () => {
    const provider = createLeaferTextRunLayoutProvider(leafer, {
      fontAvailable: () => true,
    });
    const result = provider.layout({
      baseStyle: style(),
      content: "ABCDEFGHIJ",
      hangingList: false,
      listSpacing: 0,
      maxLines: 1,
      mode: "auto-height",
      paragraphIndent: 0,
      paragraphSpacing: 0,
      runs: [],
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "ending",
      textWrap: "character",
      width: 60,
    });
    expect(result).toMatchObject({
      ok: true,
      displayContent: "ABC...",
      sourceContentEnd: 3,
      truncated: true,
    });
    if (!result.ok) return;
    expect(result.lines).toHaveLength(1);
    expect(result.fullContentBounds.height).toBe(48);
    expect(result.contentBounds.height).toBe(24);
  });

  it("derives ending truncation from a Fixed text box when maxLines is null", () => {
    const provider = createLeaferTextRunLayoutProvider(leafer, {
      fontAvailable: () => true,
    });
    const result = provider.layout({
      baseStyle: style(),
      content: "ABCDEFGHIJ",
      hangingList: false,
      height: 24,
      listSpacing: 0,
      maxLines: null,
      mode: "fixed",
      paragraphIndent: 0,
      paragraphSpacing: 0,
      runs: [],
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "ending",
      textWrap: "character",
      width: 60,
    });
    expect(result).toMatchObject({
      ok: true,
      displayContent: "ABC...",
      size: { width: 60, height: 24 },
      truncated: true,
    });
  });

  it("aligns mixed face, size, and fill fragments on one native baseline", () => {
    const small = style();
    const large = style({
      fill: "#7c3aed",
      fontFamily: "Wide Display",
      fontSize: 40,
      fontStyleName: "Bold",
      fontWeight: 700,
      lineHeight: 48,
    });
    const provider = createLeaferTextRunLayoutProvider(leafer, {
      fontAvailable: () => true,
    });
    const result = provider.layout({
      baseStyle: small,
      content: "ABCD",
      height: 80,
      mode: "fixed",
      hangingList: false,
      listSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      runs: [
        { start: 0, end: 2, style: small },
        { start: 2, end: 4, style: large },
      ],
      maxLines: null,
      textAlignHorizontal: "left",
      textAlignVertical: "center",
      textTruncation: "disabled",
      textWrap: "none",
      width: 200,
    });

    expect(result).toMatchObject({
      ok: true,
      provider: LEAFER_TEXT_RUN_LAYOUT_PROVIDER_ID,
      providerVersion: LEAFER_TEXT_RUN_LAYOUT_PROVIDER_VERSION,
      size: { width: 200, height: 80 },
      warnings: [],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.fragments).toHaveLength(2);
    const [smallFragment, largeFragment] = result.fragments;
    expect(smallFragment!.y + smallFragment!.baseline).toBe(
      largeFragment!.y + largeFragment!.baseline,
    );
    expect(largeFragment).toMatchObject({
      start: 2,
      end: 4,
      text: "CD",
      style: { fill: "#7c3aed", fontFamily: "Wide Display" },
    });
    expect(result.lines[0]?.height).toBe(48);

    const projection = leaferTextRunLayoutToProjection("mixed-title", result);
    expect(projection.fragments[1]).toMatchObject({
      data: {
        fill: "#7c3aed",
        fontFamily: "Wide Display",
        fontSize: 40,
        fontWeight: 700,
      },
      text: "CD",
    });

    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text")
      throw new Error("Missing Text fixture");
    title.properties.content = "ABCD";
    const base = projectDesignPage(document, "page_welcome");
    const titleProjection = leaferTextRunLayoutToProjection(title.id, result);
    const nativeProjection = projectResolvedTextRuns(base, {
      documentId: base.documentId,
      pageId: base.pageId,
      revision: base.revision,
      resultsByNodeId: new Map([[title.id, titleProjection]]),
    });
    expect(
      nativeProjection.elementsById.get("title_welcome::text-run::1"),
    ).toMatchObject({
      data: { fill: "#7c3aed", text: "CD" },
      parentId: title.parentId,
    });
  });

  it("wraps across run boundaries without splitting UTF-16 emoji", () => {
    const compact = style();
    const large = style({ fontSize: 40, lineHeight: 48 });
    const provider = createLeaferTextRunLayoutProvider(leafer, {
      fontAvailable: () => true,
    });
    const result = provider.layout({
      baseStyle: compact,
      content: "A😀BC",
      mode: "auto-height",
      hangingList: false,
      listSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      runs: [
        { start: 0, end: 3, style: compact },
        { start: 3, end: 5, style: large },
      ],
      maxLines: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "disabled",
      textWrap: "character",
      width: 25,
    });

    if (!result.ok) throw new Error(result.message);
    expect(result.lines.map(({ start, end }) => [start, end])).toEqual([
      [0, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(
      result.fragments.map(({ start, end, text }) => [start, end, text]),
    ).toEqual([
      [0, 3, "A😀"],
      [3, 4, "B"],
      [4, 5, "C"],
    ]);
    expect(result.size).toEqual({ width: 25, height: 120 });
  });

  it("keeps joined emoji graphemes atomic and rejects styles that split them", () => {
    const base = style();
    const provider = createLeaferTextRunLayoutProvider(leafer, {
      fontAvailable: () => true,
    });
    const family = "👨‍👩‍👧‍👦";
    const content = `A${family}B`;
    const result = provider.layout({
      baseStyle: base,
      content,
      mode: "auto-height",
      hangingList: false,
      listSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      runs: [],
      maxLines: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "disabled",
      textWrap: "character",
      width: 15,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.lines.map(({ start, end }) => [start, end])).toEqual([
      [0, 1],
      [1, 1 + family.length],
      [1 + family.length, content.length],
    ]);
    expect(result.fragments[1]?.text).toBe(family);

    expect(
      provider.layout({
        baseStyle: base,
        content,
        mode: "auto-height",
        hangingList: false,
        listSpacing: 0,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        runs: [
          { start: 0, end: 3, style: base },
          {
            start: 3,
            end: content.length,
            style: { ...base, fill: "#7c3aed" },
          },
        ],
        maxLines: null,
        textAlignHorizontal: "left",
        textAlignVertical: "top",
        textTruncation: "disabled",
        textWrap: "character",
        width: 100,
      }),
    ).toMatchObject({ code: "unsupported", ok: false, retryable: false });
  });

  it("supports Auto Width, paragraph spacing, and word wrapping", () => {
    const base = style();
    const provider = createLeaferTextRunLayoutProvider(leafer, {
      fontAvailable: () => true,
    });
    const autoWidth = provider.layout({
      baseStyle: base,
      content: "AB\nC",
      mode: "auto-width",
      hangingList: false,
      listSpacing: 0,
      paragraphIndent: 8,
      paragraphSpacing: 6,
      runs: [],
      maxLines: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "disabled",
      textWrap: "none",
    });
    expect(autoWidth).toMatchObject({
      ok: true,
      size: { width: 28, height: 54 },
    });

    const mixedParagraphs = provider.layout({
      baseStyle: base,
      content: "AB\nC",
      mode: "auto-width",
      hangingList: false,
      listSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      paragraphRuns: [
        {
          start: 0,
          end: 3,
          style: {
            listOptions: { type: "none" },
            indentation: 0,
            listSpacing: 0,
            paragraphIndent: 8,
            paragraphSpacing: 6,
          },
        },
        {
          start: 3,
          end: 4,
          style: {
            listOptions: { type: "none" },
            indentation: 0,
            listSpacing: 0,
            paragraphIndent: 20,
            paragraphSpacing: 2,
          },
        },
      ],
      runs: [],
      maxLines: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "disabled",
      textWrap: "none",
    });
    expect(mixedParagraphs).toMatchObject({
      ok: true,
      size: { width: 30, height: 54 },
      lines: [
        { x: 8, y: 0 },
        { x: 20, y: 30 },
      ],
    });

    const wrapped = provider.layout({
      baseStyle: base,
      content: "ab cd",
      mode: "auto-height",
      hangingList: false,
      listSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      runs: [],
      maxLines: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "disabled",
      textWrap: "word",
      width: 32,
    });
    if (!wrapped.ok) throw new Error(wrapped.message);
    expect(wrapped.lines.map(({ start, end }) => [start, end])).toEqual([
      [0, 3],
      [3, 5],
    ]);
    expect(wrapped.lines.map(({ width }) => width)).toEqual([20, 20]);

    const cjk = provider.layout({
      baseStyle: base,
      content: "你好，世界",
      mode: "auto-height",
      hangingList: false,
      listSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      runs: [],
      maxLines: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "disabled",
      textWrap: "word",
      width: 20,
    });
    if (!cjk.ok) throw new Error(cjk.message);
    expect(cjk.lines.map(({ start, end }) => [start, end])).toEqual([
      [0, 1],
      [1, 3],
      [3, 5],
    ]);
  });

  it("lays out real ordered markers, list spacing, wrapped body insets, and hanging mode", () => {
    const base = style();
    const provider = createLeaferTextRunLayoutProvider(leafer, {
      fontAvailable: () => true,
    });
    const content = "First item wraps\nSecond";
    const paragraphRuns = [
      {
        start: 0,
        end: content.length,
        style: {
          listOptions: { type: "ordered" as const },
          indentation: 1,
          listSpacing: 12,
          paragraphIndent: 0,
          paragraphSpacing: 0,
        },
      },
    ];
    const result = provider.layout({
      baseStyle: base,
      content,
      mode: "auto-height",
      hangingList: false,
      listSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      paragraphRuns,
      runs: [],
      maxLines: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "disabled",
      textWrap: "word",
      width: 120,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markers.map((marker) => marker.text)).toEqual(["1.", "2."]);
    expect(result.markers.every((marker) => marker.x === 0)).toBe(true);
    expect(result.lines.every((line) => line.x === 30)).toBe(true);
    const second = result.lines.find((line) => line.start === 17);
    const previous = result.lines[result.lines.indexOf(second!) - 1];
    expect(second!.y - (previous!.y + previous!.height)).toBe(12);

    const hanging = provider.layout({
      baseStyle: base,
      content,
      mode: "auto-height",
      hangingList: true,
      listSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      paragraphRuns,
      runs: [],
      maxLines: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "disabled",
      textWrap: "word",
      width: 120,
    });
    expect(hanging.ok).toBe(true);
    if (!hanging.ok) return;
    expect(hanging.lines.every((line) => line.x === 0)).toBe(true);
    expect(hanging.markers.every((marker) => marker.x === -30)).toBe(true);
  });

  it("returns explicit failure for unavailable native metrics or range-local title case", () => {
    class MissingMetricsText {
      readonly input: Record<string, unknown>;

      constructor(input: Record<string, unknown>) {
        this.input = input;
      }

      get boxBounds() {
        return { x: 0, y: 0, width: 10, height: 20 };
      }

      get __(): Record<string, never> {
        return {};
      }

      destroy(): void {}
    }
    const unavailable = createLeaferTextRunLayoutProvider({
      Text: MissingMetricsText,
    } as unknown as Pick<typeof LeaferEditorModule, "Text">);
    expect(
      unavailable.layout({
        baseStyle: style(),
        content: "A",
        mode: "auto-width",
        hangingList: false,
        listSpacing: 0,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        runs: [],
        maxLines: null,
        textAlignHorizontal: "left",
        textAlignVertical: "top",
        textTruncation: "disabled",
        textWrap: "none",
      }),
    ).toMatchObject({
      code: "measurement-failed",
      ok: false,
      retryable: true,
    });

    const provider = createLeaferTextRunLayoutProvider(leafer);
    expect(
      provider.layout({
        baseStyle: style({ fill: () => "invalid" }),
        content: "A",
        mode: "auto-width",
        hangingList: false,
        listSpacing: 0,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        runs: [],
        maxLines: null,
        textAlignHorizontal: "left",
        textAlignVertical: "top",
        textTruncation: "disabled",
        textWrap: "none",
      }),
    ).toMatchObject({ code: "invalid-input", ok: false, retryable: false });

    expect(
      provider.layout({
        baseStyle: style({ textCase: "title-case" }),
        content: "title",
        mode: "auto-width",
        hangingList: false,
        listSpacing: 0,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        runs: [],
        maxLines: null,
        textAlignHorizontal: "left",
        textAlignVertical: "top",
        textTruncation: "disabled",
        textWrap: "none",
      }),
    ).toMatchObject({ code: "unsupported", ok: false, retryable: false });

    expect(
      provider.layout({
        baseStyle: style(),
        content: "مرحبا",
        mode: "auto-width",
        hangingList: false,
        listSpacing: 0,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        runs: [],
        maxLines: null,
        textAlignHorizontal: "left",
        textAlignVertical: "top",
        textTruncation: "disabled",
        textWrap: "none",
      }),
    ).toMatchObject({ code: "unsupported", ok: false, retryable: false });
  });

  it("reports missing faces without losing deterministic fragment geometry", () => {
    const provider = createLeaferTextRunLayoutProvider(leafer, {
      fontAvailable: (_descriptor, face) => face.fontFamily !== "Missing Sans",
    });
    const missing = style({
      fontFamily: "Missing Sans",
      fontStyleName: null,
    });
    const result = provider.layout({
      baseStyle: missing,
      content: "Fallback",
      mode: "auto-width",
      hangingList: false,
      listSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      runs: [],
      maxLines: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textTruncation: "disabled",
      textWrap: "none",
    });
    expect(result).toMatchObject({
      ok: true,
      warnings: [{ code: "font-fallback" }],
    });
  });
});
