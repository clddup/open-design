import { describe, expect, it } from "vitest";
import {
  applyTextParagraphRangeStyle,
  canonicalizeTextParagraphRuns,
  remapTextParagraphRunsAfterContentChange,
  textParagraphRanges,
  validateTextParagraphRuns,
  type TextParagraphStyle,
} from "./text-paragraphs.js";

const base: TextParagraphStyle = {
  paragraphIndent: 0,
  paragraphSpacing: 0,
};

describe("Text Paragraph Service", () => {
  it("uses paragraph boundaries that preserve LF, CRLF, and CR delimiters", () => {
    expect(textParagraphRanges("one\ntwo\r\nthree\rfour")).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 9 },
      { start: 9, end: 15 },
      { start: 15, end: 19 },
    ]);
  });

  it("expands a UTF-16 selection to complete touched paragraphs", () => {
    const content = "First paragraph\nSecond paragraph\nThird";
    const runs = applyTextParagraphRangeStyle(
      content,
      [],
      base,
      { start: 7, end: 25 },
      (style) => ({ ...style, paragraphIndent: 24, paragraphSpacing: 12 }),
      same,
    );
    expect(runs).toEqual([
      {
        start: 0,
        end: 33,
        style: { paragraphIndent: 24, paragraphSpacing: 12 },
      },
      { start: 33, end: 38, style: base },
    ]);
    expect(validateTextParagraphRuns(content, runs)).toBeNull();
  });

  it("inherits paragraph style when splitting and keeps the first paragraph when merging", () => {
    const split = remapTextParagraphRunsAfterContentChange(
      "Alpha beta",
      "Alpha\n beta",
      [
        {
          start: 0,
          end: 10,
          style: { paragraphIndent: 16, paragraphSpacing: 8 },
        },
      ],
      base,
      "before",
      same,
    );
    expect(split).toEqual([
      {
        start: 0,
        end: 11,
        style: { paragraphIndent: 16, paragraphSpacing: 8 },
      },
    ]);

    const merged = remapTextParagraphRunsAfterContentChange(
      "Alpha\nBeta",
      "AlphaBeta",
      [
        {
          start: 0,
          end: 6,
          style: { paragraphIndent: 8, paragraphSpacing: 4 },
        },
        {
          start: 6,
          end: 10,
          style: { paragraphIndent: 32, paragraphSpacing: 20 },
        },
      ],
      base,
      "before",
      same,
    );
    expect(merged).toEqual([
      {
        start: 0,
        end: 9,
        style: { paragraphIndent: 8, paragraphSpacing: 4 },
      },
    ]);
  });

  it("rejects style ranges that split paragraphs", () => {
    expect(
      validateTextParagraphRuns("One\nTwo", [
        { start: 0, end: 2, style: base },
        { start: 2, end: 7, style: base },
      ]),
    ).toContain("paragraph boundaries");
    expect(canonicalizeTextParagraphRuns("One\nTwo", [], base, same)).toEqual([
      { start: 0, end: 7, style: base },
    ]);
  });
});

function same(left: TextParagraphStyle, right: TextParagraphStyle): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
