import { describe, expect, it } from "vitest";
import { resolveTextListMarkers, textListMarker } from "./text-lists.js";
import type {
  TextParagraphRun,
  TextParagraphStyle,
} from "./text-paragraphs.js";

const base: TextParagraphStyle = {
  listOptions: { type: "none" },
  indentation: 0,
  listSpacing: 0,
  paragraphIndent: 0,
  paragraphSpacing: 0,
};

describe("Text List Service", () => {
  it("resolves nested ordered counters without writing markers into content", () => {
    const content = "Alpha\nBeta\nGamma\nDelta\nBullet";
    const ranges = [
      [0, 6, "ordered", 1],
      [6, 11, "ordered", 2],
      [11, 17, "ordered", 2],
      [17, 23, "ordered", 1],
      [23, 29, "unordered", 1],
    ] as const;
    const runs: TextParagraphRun<TextParagraphStyle>[] = ranges.map(
      ([start, end, type, indentation]) => ({
        start,
        end,
        style: {
          ...base,
          listOptions: { type },
          indentation,
        },
      }),
    );
    expect(resolveTextListMarkers(content, runs, base)).toMatchObject([
      { start: 0, text: "1.", ordinal: 1, indentation: 1 },
      { start: 6, text: "a.", ordinal: 1, indentation: 2 },
      { start: 11, text: "b.", ordinal: 2, indentation: 2 },
      { start: 17, text: "2.", ordinal: 2, indentation: 1 },
      { start: 23, text: "•", ordinal: null, indentation: 1 },
    ]);
    expect(content).toBe("Alpha\nBeta\nGamma\nDelta\nBullet");
  });

  it("resets ordered counters after a plain paragraph and cycles five levels", () => {
    expect(textListMarker("ordered", 1, 28)).toBe("28.");
    expect(textListMarker("ordered", 2, 28)).toBe("ab.");
    expect(textListMarker("ordered", 3, 14)).toBe("xiv.");
    expect(textListMarker("ordered", 4, 2)).toBe("2.");
    expect(textListMarker("ordered", 5, 2)).toBe("b.");

    const content = "One\nPlain\nTwo";
    const runs: TextParagraphRun<TextParagraphStyle>[] = [
      {
        start: 0,
        end: 4,
        style: {
          ...base,
          listOptions: { type: "ordered" },
          indentation: 1,
        },
      },
      { start: 4, end: 10, style: base },
      {
        start: 10,
        end: 13,
        style: {
          ...base,
          listOptions: { type: "ordered" },
          indentation: 1,
        },
      },
    ];
    expect(
      resolveTextListMarkers(content, runs, base).map((item) => item.text),
    ).toEqual(["1.", "1."]);
  });
});
