import { describe, expect, it } from "vitest";
import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import {
  toFigmaFontName,
  toFigmaNodeStyleReferences,
  toFigmaSharedStyleMetadata,
  toFigmaSharedStylePayload,
} from "./index.js";

describe("Figma Shared Style compatibility", () => {
  it("maps exact face style identity to Figma FontName without guessing from weight", () => {
    expect(
      toFigmaFontName({
        fontFamily: "IBM Plex Sans",
        fontStyleName: "Semi Bold Italic",
      }),
    ).toEqual({ family: "IBM Plex Sans", style: "Semi Bold Italic" });
    expect(
      toFigmaFontName({ fontFamily: "Inter", fontStyleName: "Black" }),
    ).toEqual({
      family: "Inter",
      style: "Black",
    });
    expect(
      toFigmaFontName({ fontFamily: "Legacy Sans", fontStyleName: null }),
    ).toBeNull();
  });

  it("preserves stable metadata, folder names, node references and supported payloads", () => {
    const style = {
      id: "brand-primary",
      key: "brand-primary-key",
      name: "Brand/Primary",
      description: "Primary brand fill",
      hiddenFromPublishing: false,
      styleType: "PAINT",
      paints: [{ type: "solid", color: "#3366cc80", opacity: 0.5 }],
      extensions: {},
    } satisfies DesignDocument["stylesById"][string];
    expect(toFigmaSharedStyleMetadata(style)).toEqual({
      id: "brand-primary",
      key: "brand-primary-key",
      name: "Brand/Primary",
      description: "Primary brand fill",
      type: "PAINT",
    });
    expect(toFigmaSharedStylePayload(style)).toEqual({
      ok: true,
      payload: {
        type: "PAINT",
        paints: [
          expect.objectContaining({
            type: "SOLID",
            color: { r: 0.2, g: 0.4, b: 0.8 },
            opacity: 0.25098039215686274,
          }),
        ],
      },
    });
    const node: DesignNode = {
      id: "styled",
      kind: "group",
      name: "Styled",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      fillStyleId: "brand-primary",
      effectStyleId: "effect-soft",
      properties: {},
      extensions: {},
    };
    expect(toFigmaNodeStyleReferences(node)).toEqual({
      fillStyleId: "brand-primary",
      effectStyleId: "effect-soft",
    });
  });

  it("reports unsupported payloads instead of silently degrading them", () => {
    const result = toFigmaSharedStylePayload({
      id: "image-style",
      key: "image-style-key",
      name: "Media/Hero",
      description: "",
      hiddenFromPublishing: false,
      styleType: "PAINT",
      paints: [
        {
          type: "image",
          assetId: "hero",
          fit: "cover",
          opacity: 1,
        },
      ],
      extensions: {},
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [expect.stringContaining("dedicated asset or gradient adapter")],
    });
  });

  it("maps non-default Typography Core Text Style fields to Figma", () => {
    const style = {
      id: "display-accent",
      key: "display-accent-key",
      name: "Display/Accent",
      description: "Uppercase underlined display style",
      hiddenFromPublishing: false,
      styleType: "TEXT",
      textStyle: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: "Bold Italic",
        fontSize: 32,
        fontWeight: 700,
        fontSlant: "italic",
        lineHeight: 40,
        letterSpacing: 1.5,
        paragraphIndent: 12,
        paragraphSpacing: 18,
        listSpacing: 0,
        hangingList: false,
        textCase: "small-caps",
        textDecoration: "underline",
        textDecorationStyle: "solid",
        textDecorationOffset: { unit: "auto" },
        textDecorationThickness: { unit: "auto" },
        textDecorationColor: { value: "auto" },
        textDecorationSkipInk: false,
      },
      extensions: {},
    } satisfies DesignDocument["stylesById"][string];

    expect(toFigmaSharedStylePayload(style)).toEqual({
      ok: true,
      payload: {
        type: "TEXT",
        text: {
          fontName: { family: "IBM Plex Sans", style: "Bold Italic" },
          fontSize: 32,
          lineHeight: { unit: "PIXELS", value: 40 },
          letterSpacing: { unit: "PIXELS", value: 1.5 },
          textDecoration: "UNDERLINE",
          textCase: "SMALL_CAPS",
          paragraphIndent: 12,
          paragraphSpacing: 18,
          listSpacing: 0,
          hangingList: false,
        },
      },
    });

    expect(
      toFigmaSharedStylePayload({
        ...style,
        id: "legacy-display-accent",
        key: "legacy-display-accent-key",
        textStyle: { ...style.textStyle, fontStyleName: null },
      }),
    ).toEqual({
      ok: false,
      issues: [expect.stringContaining("unresolved font face style name")],
    });
    expect(
      toFigmaSharedStylePayload({
        ...style,
        textStyle: {
          ...style.textStyle,
          textDecorationStyle: "wavy",
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: [expect.stringContaining("cannot encode")],
    });
  });
});
