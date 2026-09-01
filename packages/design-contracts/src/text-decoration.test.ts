import { describe, expect, it } from "vitest";
import {
  DesignDocumentContract,
  IMAGE_PAINT_CROP_DESIGN_SCHEMA_VERSION,
  migrateDesignDocument,
} from "./index.js";
import { textDocumentFixture } from "./index-test-fixtures.js";

describe("advanced text decoration", () => {
  it("migrates base text, rich runs, and Text Styles from 1.53", () => {
    const source = textDocumentFixture() as unknown as Record<string, unknown>;
    source.schemaVersion = IMAGE_PAINT_CROP_DESIGN_SCHEMA_VERSION;
    const node = textNodeRecord(source);
    const properties = node.properties as Record<string, unknown>;
    properties.textDecoration = "underline";
    removeAdvancedDecoration(properties);
    properties.runs = [
      {
        start: 0,
        end: 4,
        style: legacyRunStyle(properties, "strikethrough"),
      },
    ];
    source.styleOrderByType = {
      PAINT: [],
      TEXT: ["body"],
      EFFECT: [],
      GRID: [],
    };
    source.stylesById = {
      body: {
        id: "body",
        key: "body-key",
        name: "Body",
        description: "",
        hiddenFromPublishing: false,
        styleType: "TEXT",
        textStyle: legacyTextStyle(properties, "none"),
        extensions: {},
      },
    };

    const migrated = migrateDesignDocument(source);
    expect(migrated).not.toBeNull();
    const text = migrated?.nodesById.text_1;
    expect(text?.kind).toBe("text");
    if (text?.kind !== "text") return;
    expect(text.properties).toMatchObject({
      textDecoration: "underline",
      textDecorationStyle: "solid",
      textDecorationOffset: { unit: "auto" },
      textDecorationThickness: { unit: "auto" },
      textDecorationColor: { value: "auto" },
      textDecorationSkipInk: false,
    });
    expect(text.properties.runs?.[0]?.style).toMatchObject({
      textDecoration: "strikethrough",
      textDecorationStyle: null,
      textDecorationOffset: null,
      textDecorationThickness: null,
      textDecorationColor: null,
      textDecorationSkipInk: null,
    });
    expect(migrated?.stylesById.body).toMatchObject({
      textStyle: {
        textDecoration: "none",
        textDecorationStyle: null,
        textDecorationOffset: null,
        textDecorationThickness: null,
        textDecorationColor: null,
        textDecorationSkipInk: null,
      },
    });
  });

  it("reports the exact advanced field that conflicts with decoration", () => {
    const source = textDocumentFixture();
    const sourceProperties = source.nodesById.text_1
      .properties as unknown as Record<string, unknown>;
    sourceProperties.textDecorationStyle = "solid";
    const sourceResult = DesignDocumentContract.parse(source);
    expect(sourceResult.ok).toBe(false);
    if (!sourceResult.ok) {
      expect(sourceResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "design.document_text_decoration_invalid",
            path: "/nodesById/text_1/properties/textDecorationStyle",
          }),
        ]),
      );
    }

    const underline = textDocumentFixture();
    const underlineProperties = underline.nodesById.text_1
      .properties as unknown as Record<string, unknown>;
    underlineProperties.textDecoration = "underline";
    const underlineResult = DesignDocumentContract.parse(underline);
    expect(underlineResult.ok).toBe(false);
    if (!underlineResult.ok) {
      expect(underlineResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "design.document_text_decoration_invalid",
            path: "/nodesById/text_1/properties/textDecorationStyle",
          }),
        ]),
      );
    }
  });

  it("round-trips canonical advanced decoration without rewriting it", () => {
    const source = textDocumentFixture();
    Object.assign(source.nodesById.text_1.properties, {
      textDecoration: "underline" as const,
      textDecorationStyle: "wavy" as const,
      textDecorationOffset: { unit: "pixels" as const, value: 3 },
      textDecorationThickness: { unit: "percent" as const, value: 12.5 },
      textDecorationColor: {
        value: { type: "solid" as const, color: "#2563eb", opacity: 0.8 },
      },
      textDecorationSkipInk: true,
    });
    const reopened = migrateDesignDocument(JSON.parse(JSON.stringify(source)));
    expect(reopened).toEqual(source);
  });
});

function textNodeRecord(document: Record<string, unknown>) {
  return (document.nodesById as Record<string, Record<string, unknown>>)
    .text_1!;
}

function removeAdvancedDecoration(value: Record<string, unknown>): void {
  delete value.textDecorationStyle;
  delete value.textDecorationOffset;
  delete value.textDecorationThickness;
  delete value.textDecorationColor;
  delete value.textDecorationSkipInk;
}

function legacyRunStyle(
  properties: Record<string, unknown>,
  textDecoration: "none" | "underline" | "strikethrough",
) {
  return {
    fontFamily: properties.fontFamily,
    fontStyleName: properties.fontStyleName,
    fontSize: properties.fontSize,
    fontWeight: properties.fontWeight,
    fontSlant: properties.fontSlant,
    letterSpacing: properties.letterSpacing,
    lineHeight: properties.lineHeight,
    textCase: properties.textCase,
    textDecoration,
    fills: properties.fills,
  };
}

function legacyTextStyle(
  properties: Record<string, unknown>,
  textDecoration: "none" | "underline" | "strikethrough",
) {
  return {
    fontFamily: properties.fontFamily,
    fontStyleName: properties.fontStyleName,
    fontSize: properties.fontSize,
    fontWeight: properties.fontWeight,
    fontSlant: properties.fontSlant,
    lineHeight: properties.lineHeight,
    letterSpacing: properties.letterSpacing,
    paragraphIndent: properties.paragraphIndent,
    paragraphSpacing: properties.paragraphSpacing,
    listSpacing: properties.listSpacing,
    hangingList: properties.hangingList,
    textCase: properties.textCase,
    textDecoration,
  };
}
