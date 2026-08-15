import { describe, expect, it } from "vitest";
import {
  applyTextContentEdit,
  canonicalizeTextStyleRuns,
  diffTextContent,
  remapTextStyleRunsAfterContentChange,
  validateTextStyleRuns,
  type TextStyleRun,
} from "./text-ranges.js";

type Style = "regular" | "bold" | "accent";

const equal = (left: Style, right: Style) => left === right;

describe("Figma-compatible text range core", () => {
  it("uses UTF-16 [start, end) offsets without splitting emoji", () => {
    const content = "A😀B";
    expect(content.length).toBe(4);
    expect(
      validateTextStyleRuns(content, [
        { start: 0, end: 1, style: "regular" },
        { start: 1, end: 3, style: "accent" },
        { start: 3, end: 4, style: "regular" },
      ]),
    ).toBeNull();
    expect(
      validateTextStyleRuns(content, [
        { start: 0, end: 2, style: "regular" },
        { start: 2, end: 4, style: "accent" },
      ]),
    ).toContain("surrogate pair");
    expect(() =>
      applyTextContentEdit(content, [], "regular", {
        start: 2,
        end: 2,
        insert: "x",
      }),
    ).toThrow("UTF-16");
  });

  it("requires non-empty runs to cover the complete string", () => {
    expect(
      validateTextStyleRuns("abcd", [
        { start: 0, end: 2, style: "regular" },
        { start: 3, end: 4, style: "bold" },
      ]),
    ).toContain("contiguous");
    expect(validateTextStyleRuns("", [])).toBeNull();
    expect(
      validateTextStyleRuns("", [{ start: 0, end: 1, style: "bold" }]),
    ).toContain("Empty text");
  });

  it("materializes the base style and merges adjacent equal styles", () => {
    expect(canonicalizeTextStyleRuns("abc", [], "regular", equal)).toEqual([
      { start: 0, end: 3, style: "regular" },
    ]);
    expect(
      canonicalizeTextStyleRuns(
        "abcd",
        [
          { start: 0, end: 2, style: "bold" },
          { start: 2, end: 4, style: "bold" },
        ],
        "regular",
        equal,
      ),
    ).toEqual([{ start: 0, end: 4, style: "bold" }]);
  });

  it("inherits the preceding style for ordinary direct-edit insertion", () => {
    const runs: TextStyleRun<Style>[] = [
      { start: 0, end: 2, style: "bold" },
      { start: 2, end: 4, style: "regular" },
    ];
    expect(
      applyTextContentEdit(
        "abcd",
        runs,
        "regular",
        { start: 2, end: 2, insert: "XY" },
        equal,
      ),
    ).toMatchObject({
      content: "abXYcd",
      insertedRange: { start: 2, end: 4 },
      runs: [
        { start: 0, end: 4, style: "bold" },
        { start: 4, end: 6, style: "regular" },
      ],
    });
  });

  it("supports explicit after-style inheritance at a range boundary", () => {
    const result = applyTextContentEdit(
      "abcd",
      [
        { start: 0, end: 2, style: "bold" },
        { start: 2, end: 4, style: "regular" },
      ],
      "regular",
      { start: 2, end: 2, insert: "XY", inheritStyle: "after" },
      equal,
    );
    expect(result.runs).toEqual([
      { start: 0, end: 2, style: "bold" },
      { start: 2, end: 6, style: "regular" },
    ]);
  });

  it("clips deleted ranges, shifts survivors, and merges matching sides", () => {
    const result = applyTextContentEdit(
      "abcdef",
      [
        { start: 0, end: 2, style: "regular" },
        { start: 2, end: 4, style: "bold" },
        { start: 4, end: 6, style: "regular" },
      ],
      "regular",
      { start: 1, end: 5, insert: "" },
      equal,
    );
    expect(result).toMatchObject({
      content: "af",
      runs: [{ start: 0, end: 2, style: "regular" }],
    });
  });

  it("diffs one bounded edit and preserves styled suffixes across emoji changes", () => {
    expect(diffTextContent("A😀B", "A✨B")).toEqual({
      start: 1,
      end: 3,
      insert: "✨",
    });
    const result = remapTextStyleRunsAfterContentChange(
      "A😀B",
      "A✨B",
      [
        { start: 0, end: 1, style: "regular" },
        { start: 1, end: 3, style: "accent" },
        { start: 3, end: 4, style: "bold" },
      ],
      "regular",
      "before",
      equal,
    );
    expect(result.runs).toEqual([
      { start: 0, end: 1, style: "regular" },
      { start: 1, end: 2, style: "accent" },
      { start: 2, end: 3, style: "bold" },
    ]);
  });
});
