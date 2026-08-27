import { describe, expect, it } from "vitest";
import type { DesignNode } from "@opendesign/design-contracts";
import {
  fromFigmaTextRangeSegments,
  toFigmaTextRangeSegments,
} from "./index.js";

describe("Figma rich text range compatibility", () => {
  it("round-trips exact UTF-16 segments without guessing face names", () => {
    const node = richTextNode();
    const exported = toFigmaTextRangeSegments(node);
    expect(exported).toMatchObject({
      ok: true,
      segments: [
        expect.objectContaining({
          start: 0,
          end: 2,
          fontName: { family: "Inter", style: "Regular" },
        }),
        expect.objectContaining({
          start: 2,
          end: 4,
          fontName: { family: "IBM Plex Sans", style: "Semi Bold" },
          fontWeight: 600,
        }),
      ],
    });
    if (!exported.ok) throw new Error(exported.issues.join("; "));
    expect(
      fromFigmaTextRangeSegments(node.properties.content, exported.segments),
    ).toEqual({
      ok: true,
      paragraphRuns: [
        {
          start: 0,
          end: 4,
          style: {
            listOptions: { type: "none" },
            indentation: 0,
            listSpacing: 0,
            paragraphIndent: 0,
            paragraphSpacing: 0,
          },
        },
      ],
      runs: node.properties.runs,
    });
  });

  it("splits styled segments at paragraph boundaries and preserves paragraph fields", () => {
    const node = richTextNode();
    node.properties.content = "One\nTwo";
    node.properties.runs = [];
    node.properties.paragraphRuns = [
      {
        start: 0,
        end: 4,
        style: {
          listOptions: { type: "ordered" },
          indentation: 1,
          listSpacing: 8,
          paragraphIndent: 8,
          paragraphSpacing: 12,
        },
      },
      {
        start: 4,
        end: 7,
        style: {
          listOptions: { type: "unordered" },
          indentation: 2,
          listSpacing: 4,
          paragraphIndent: 20,
          paragraphSpacing: 4,
        },
      },
    ];
    const exported = toFigmaTextRangeSegments(node);
    expect(exported).toMatchObject({
      ok: true,
      segments: [
        expect.objectContaining({
          start: 0,
          end: 4,
          paragraphIndent: 8,
          paragraphSpacing: 12,
          listOptions: { type: "ORDERED" },
          indentation: 1,
          listSpacing: 8,
        }),
        expect.objectContaining({
          start: 4,
          end: 7,
          paragraphIndent: 20,
          paragraphSpacing: 4,
          listOptions: { type: "UNORDERED" },
          indentation: 2,
          listSpacing: 4,
        }),
      ],
    });
    if (!exported.ok) throw new Error(exported.issues.join("; "));
    expect(
      fromFigmaTextRangeSegments(node.properties.content, exported.segments),
    ).toMatchObject({
      ok: true,
      paragraphRuns: node.properties.paragraphRuns,
      runs: [{ start: 0, end: 7 }],
    });
    const inconsistentParagraphs = fromFigmaTextRangeSegments(
      node.properties.content,
      [
        { ...exported.segments[0]!, end: 2 },
        {
          ...exported.segments[0]!,
          start: 2,
          end: 4,
          paragraphIndent: 99,
        },
        exported.segments[1]!,
      ],
    );
    expect(inconsistentParagraphs.ok).toBe(false);
    if (inconsistentParagraphs.ok) {
      throw new Error("Expected inconsistent paragraph fields to be rejected");
    }
    expect(
      inconsistentParagraphs.issues.some((issue) =>
        issue.includes("inconsistent paragraph fields"),
      ),
    ).toBe(true);
  });

  it("rejects non-contiguous and half-surrogate Figma segments", () => {
    const node = richTextNode();
    const exported = toFigmaTextRangeSegments(node);
    if (!exported.ok) throw new Error(exported.issues.join("; "));
    const invalidUtf16 = fromFigmaTextRangeSegments("A😀B", [
      { ...exported.segments[0]!, start: 0, end: 2 },
      { ...exported.segments[1]!, start: 2, end: 4 },
    ]);
    expect(invalidUtf16.ok).toBe(false);
    if (invalidUtf16.ok) {
      throw new Error("Expected half-surrogate segments to be rejected");
    }
    expect(invalidUtf16.issues.some((issue) => issue.includes("UTF-16"))).toBe(
      true,
    );
  });
});

function richTextNode(): Extract<DesignNode, { kind: "text" }> {
  const base = {
    fontFamily: "Inter",
    fontStyleName: "Regular",
    fontSize: 16,
    fontWeight: 400,
    fontSlant: "normal" as const,
    lineHeight: 24,
    letterSpacing: 0,
    textCase: "original" as const,
    textDecoration: "none" as const,
    fills: [{ type: "solid" as const, color: "#111111", opacity: 1 }],
  };
  return {
    id: "rich",
    kind: "text",
    name: "Rich",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 200, height: 40 },
    exportSettings: [],
    opacity: 1,
    properties: {
      content: "ABCD",
      ...base,
      paragraphRuns: [],
      runs: [
        { start: 0, end: 2, style: base },
        {
          start: 2,
          end: 4,
          style: {
            ...base,
            fontFamily: "IBM Plex Sans",
            fontStyleName: "Semi Bold",
            fontWeight: 600,
            fills: [{ type: "solid", color: "#ff3366", opacity: 1 }],
          },
        },
      ],
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textResize: "fixed",
      textWrap: "character",
      textOverflow: "visible",
      textTruncation: "disabled",
      maxLines: null,
      strokes: [],
      strokeWidth: 0,
      strokeAlign: "center",
      strokeCap: "none",
      strokeJoin: "miter",
      dashPattern: [],
    },
    extensions: {},
  };
}
