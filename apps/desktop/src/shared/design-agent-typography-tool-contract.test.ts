import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_FONT_TOOL_INPUT_SCHEMA,
  DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
  DesignFontContract,
  DesignTextRangeContract,
} from "./design-agent-typography-tools";

const expectedFont = {
  fontFamily: "Inter",
  fontStyleName: "Semi Bold",
  fontWeight: 600,
  fontSlant: "normal",
} as const;

describe("design typography tool contracts", () => {
  it("uses one closed discriminated Font contract for reflow and replace", () => {
    const reflow = {
      action: "reflow",
      label: "Reflow headings",
      pageId: "page_1",
      nodeIds: ["heading", "subheading"],
      expectedFont,
    } as const;
    const replace = {
      ...reflow,
      action: "replace",
      replacementFont: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: null,
        fontWeight: 500,
        fontSlant: "normal",
      },
    } as const;

    expect(
      schemaValidationIssues(DESIGN_FONT_TOOL_INPUT_SCHEMA, reflow),
    ).toEqual([]);
    expect(DesignFontContract.parse(reflow)).toMatchObject({ ok: true });
    expect(DesignFontContract.parse(replace)).toMatchObject({ ok: true });

    const invalidReflow = DesignFontContract.parse({
      ...reflow,
      replacementFont: replace.replacementFont,
    });
    expect(invalidReflow).toMatchObject({
      ok: false,
      issues: [{ code: "design_font.schema_invalid" }],
    });
    const invalidReplace = DesignFontContract.parse({
      ...replace,
      replacementFont: { ...replace.replacementFont, fontWeight: 500.5 },
    });
    expect(invalidReplace).toMatchObject({
      ok: false,
      issues: [{ path: "/replacementFont/fontWeight" }],
    });
  });

  it("reuses the authoritative rich-text style shape and locates field errors", () => {
    const input = {
      label: "Emphasize the current selection",
      pageId: "page_1",
      nodeId: "body_copy",
      start: 4,
      end: 18,
      style: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: null,
        fontSize: 18,
        fontWeight: 500,
        fontSlant: "normal",
        paragraphSpacing: 12,
        listOptions: { type: "unordered" },
        indentation: 1,
        fills: [{ type: "solid", color: "#123456", opacity: 1 }],
        textStyleId: "body-emphasis",
        fillStyleId: null,
      },
    } as const;

    expect(
      schemaValidationIssues(DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA, input),
    ).toEqual([]);
    expect(DesignTextRangeContract.parse(input)).toMatchObject({ ok: true });

    const emptyStyle = DesignTextRangeContract.parse({ ...input, style: {} });
    expect(emptyStyle).toMatchObject({
      ok: false,
      issues: [{ code: "design_text_range.schema_invalid", path: "/style" }],
    });
    const invalidWeight = DesignTextRangeContract.parse({
      ...input,
      style: { fontWeight: 500.5 },
    });
    expect(invalidWeight).toMatchObject({
      ok: false,
      issues: [{ path: "/style/fontWeight" }],
    });
  });

  it("keeps the non-empty UTF-16 range relation as one explicit refinement", () => {
    const invalid = DesignTextRangeContract.parse({
      label: "Style selection",
      pageId: "page_1",
      nodeId: "body_copy",
      start: 8,
      end: 8,
      style: { textDecoration: "underline" },
    });
    expect(invalid).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design_text_range.range_empty",
          path: "/end",
          actual: 8,
        }),
      ],
    });
  });

  it("projects advanced underline fields from the authoritative range schema", () => {
    const input = {
      label: "Style underline",
      pageId: "page_1",
      nodeId: "body_copy",
      start: 0,
      end: 4,
      style: {
        textDecoration: "underline",
        textDecorationStyle: "dotted",
        textDecorationOffset: { unit: "pixels", value: 2 },
        textDecorationThickness: { unit: "percent", value: 10 },
        textDecorationColor: {
          value: { type: "solid", color: "#2563eb", opacity: 1 },
        },
        textDecorationSkipInk: false,
      },
    } as const;
    expect(DesignTextRangeContract.parse(input)).toMatchObject({ ok: true });
    expect(
      DesignTextRangeContract.parse({
        ...input,
        style: { ...input.style, textDecorationStyle: "double" },
      }),
    ).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: "/style/textDecorationStyle" })],
    });
  });
});
