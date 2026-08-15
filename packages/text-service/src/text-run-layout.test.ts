import { describe, expect, it } from "vitest";
import {
  validateTextRunLayoutRequest,
  validateTextRunLayoutResult,
  type TextRunLayoutRequest,
  type TextRunLayoutResult,
  type TextRunLayoutStyle,
} from "./text-run-layout.js";

const regular: TextRunLayoutStyle = {
  fontFamily: "Inter",
  fontSize: 16,
  fontSlant: "normal",
  fontStyleName: "Regular",
  fontWeight: 400,
  letterSpacing: 0,
  lineHeight: 24,
  textCase: "original",
  textDecoration: "none",
};

function request(
  overrides: Partial<TextRunLayoutRequest> = {},
): TextRunLayoutRequest {
  return {
    baseStyle: regular,
    content: "A😀B",
    mode: "auto-height",
    paragraphIndent: 0,
    paragraphSpacing: 0,
    runs: [
      { start: 0, end: 1, style: regular },
      { start: 1, end: 3, style: { ...regular, fontSize: 24 } },
      { start: 3, end: 4, style: regular },
    ],
    textAlignHorizontal: "left",
    textAlignVertical: "top",
    textWrap: "character",
    width: 120,
    ...overrides,
  };
}

describe("text run layout contract", () => {
  it("accepts complete UTF-16 runs for Auto Height and Fixed modes", () => {
    expect(validateTextRunLayoutRequest(request())).toBeNull();
    expect(
      validateTextRunLayoutRequest(
        request({ height: 80, mode: "fixed", width: 120 }),
      ),
    ).toBeNull();
    const autoWidth = request({ mode: "auto-width", textWrap: "none" });
    delete autoWidth.width;
    delete autoWidth.height;
    expect(validateTextRunLayoutRequest(autoWidth)).toBeNull();
  });

  it("rejects split surrogate pairs and mode-specific bounds", () => {
    expect(
      validateTextRunLayoutRequest(
        request({
          runs: [
            { start: 0, end: 2, style: regular },
            { start: 2, end: 4, style: regular },
          ],
        }),
      ),
    ).toContain("surrogate pair");
    expect(
      validateTextRunLayoutRequest(
        request({ height: 100, mode: "auto-height" }),
      ),
    ).toContain("only a finite positive width");
  });

  it("requires provider fragments to preserve exact source ranges", () => {
    const input = request({
      content: "A😀B",
      runs: [],
    });
    const result: TextRunLayoutResult = {
      contentBounds: { x: 0, y: 0, width: 40, height: 24 },
      fragments: [
        {
          baseline: 18,
          end: 4,
          height: 24,
          lineIndex: 0,
          start: 0,
          style: regular,
          text: "A😀B",
          width: 40,
          x: 0,
          y: 0,
        },
      ],
      lines: [
        {
          baseline: 18,
          end: 4,
          height: 24,
          start: 0,
          width: 40,
          x: 0,
          y: 0,
        },
      ],
      ok: true,
      provider: "test",
      providerVersion: "1",
      size: { width: 120, height: 24 },
      warnings: [],
    };
    expect(validateTextRunLayoutResult(result, input)).toBeNull();
    const corrupted = structuredClone(result);
    if (!corrupted.ok) throw new Error("Expected successful fixture");
    corrupted.fragments[0]!.text = "AxxB";
    expect(validateTextRunLayoutResult(corrupted, input)).toContain(
      "invalid fragments",
    );
  });

  it("validates bounded UTF-16 glyph clusters and outline budgets", () => {
    const input = request({ content: "ffi", runs: [] });
    const result: TextRunLayoutResult = {
      contentBounds: { x: 0, y: 0, width: 20, height: 24 },
      fragments: [
        {
          baseline: 18,
          end: 3,
          glyphs: [
            {
              clusterEnd: 3,
              clusterStart: 0,
              glyphId: 42,
              path: "M0 0L1 0L1 1Z",
              x: 0,
              xAdvance: 20,
              y: 0,
              yAdvance: 0,
            },
          ],
          height: 24,
          lineIndex: 0,
          start: 0,
          style: regular,
          text: "ffi",
          width: 20,
          x: 0,
          y: 0,
        },
      ],
      lines: [
        {
          baseline: 18,
          end: 3,
          height: 24,
          start: 0,
          width: 20,
          x: 0,
          y: 0,
        },
      ],
      ok: true,
      provider: "test",
      providerVersion: "2",
      size: { width: 120, height: 24 },
      warnings: [],
    };
    expect(validateTextRunLayoutResult(result, input)).toBeNull();
    const gap = structuredClone(result);
    if (!gap.ok || !gap.fragments[0]?.glyphs?.[0]) {
      throw new Error("Expected glyph fixture");
    }
    gap.fragments[0].glyphs[0].clusterStart = 1;
    expect(validateTextRunLayoutResult(gap, input)).toContain(
      "clusters do not cover",
    );
  });
});
