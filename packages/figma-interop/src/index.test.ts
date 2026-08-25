import { describe, expect, it } from "vitest";
import type {
  ComponentDefinition,
  DesignDocument,
  DesignNode,
  InstanceNode,
} from "@opendesign/design-contracts";
import { DESIGN_SCHEMA_VERSION } from "@opendesign/design-contracts";
import {
  toFigmaComponentProperties,
  toFigmaComponentPropertyDefinitions,
  toFigmaComponentPropertyReferences,
  toFigmaExplicitVariableModes,
  toFigmaExportSettings,
  toFigmaFontName,
  toFigmaTextRangeSegments,
  fromFigmaTextRangeSegments,
  toFigmaNodeType,
  toFigmaNodeBoundVariables,
  toFigmaNodeStyleReferences,
  toFigmaGridAutoLayout,
  toFigmaGridChild,
  toFigmaWrapAutoLayout,
  fromFigmaGridAutoLayout,
  fromFigmaWrapAutoLayout,
  toFigmaImageFilters,
  fromFigmaImageFilters,
  toFigmaSharedStyleMetadata,
  toFigmaSharedStylePayload,
  toFigmaVariable,
  toFigmaVariableCollection,
  toFigmaVariantProperties,
  toFigmaVariantSetPropertyDefinitions,
} from "./index.js";

describe("Figma image adjustment compatibility", () => {
  it("round-trips the public seven-field ImageFilters shape", () => {
    const filters = {
      exposure: 0.2,
      contrast: -0.1,
      saturation: 0.3,
      temperature: -0.4,
      tint: 0.15,
      highlights: -0.25,
      shadows: 0.5,
    };
    const figma = toFigmaImageFilters(filters);
    expect(figma).toEqual(filters);
    expect(fromFigmaImageFilters(figma)).toEqual({ ok: true, filters });
    expect(fromFigmaImageFilters({ exposure: 1.5 })).toMatchObject({
      ok: false,
    });
  });
});

describe("Figma wrapped Auto Layout compatibility", () => {
  it("round-trips public counterAxisAlignContent and counterAxisSpacing", () => {
    const figma = toFigmaWrapAutoLayout({
      mode: "horizontal",
      padding: { top: 8, right: 16, bottom: 12, left: 16 },
      gap: 10,
      primaryAlignment: "space-between",
      counterAlignment: "center",
      sizing: { horizontal: "fixed", vertical: "fixed" },
      wrap: {
        mode: "wrap",
        counterGap: 18,
        counterAxisAlignContent: "space-between",
      },
    });
    expect(figma).toEqual({
      layoutMode: "HORIZONTAL",
      layoutWrap: "WRAP",
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 12,
      paddingLeft: 16,
      itemSpacing: 10,
      counterAxisSpacing: 18,
      primaryAxisAlignItems: "SPACE_BETWEEN",
      counterAxisAlignItems: "CENTER",
      counterAxisAlignContent: "SPACE_BETWEEN",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
    });
    if (!figma) throw new Error("missing Figma wrap projection");
    expect(fromFigmaWrapAutoLayout(figma)).toEqual({
      ok: true,
      layout: {
        mode: "horizontal",
        padding: { top: 8, right: 16, bottom: 12, left: 16 },
        gap: 10,
        primaryAlignment: "space-between",
        counterAlignment: "center",
        sizing: { horizontal: "fixed", vertical: "fixed" },
        wrap: {
          mode: "wrap",
          counterGap: 18,
          counterAxisAlignContent: "space-between",
        },
      },
    });
    expect(
      fromFigmaWrapAutoLayout({
        ...figma,
        counterAxisAlignItems: "BASELINE",
      }),
    ).toMatchObject({ ok: false });
  });

  it("returns null for a non-wrapping horizontal flow", () => {
    expect(
      toFigmaWrapAutoLayout({
        mode: "horizontal",
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0,
        primaryAlignment: "start",
        counterAlignment: "start",
      }),
    ).toBeNull();
  });
});

describe("Figma Grid Auto Layout compatibility", () => {
  it("maps OpenDesign-owned tracks and cell semantics to public Plugin API shapes", () => {
    const figmaGrid = toFigmaGridAutoLayout({
      mode: "grid",
      padding: { top: 8, right: 16, bottom: 8, left: 16 },
      rowGap: 12,
      columnGap: 20,
      rows: [{ type: "hug" }, { type: "fixed", value: 120 }],
      columns: [
        { type: "fixed", value: 180 },
        { type: "fill", value: 2 },
      ],
      itemsPositioning: "row-auto-flow",
    });
    expect(figmaGrid).toEqual({
      layoutMode: "GRID",
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 16,
      gridRowCount: 2,
      gridColumnCount: 2,
      gridRowGap: 12,
      gridColumnGap: 20,
      gridRowSizes: [{ type: "HUG" }, { type: "FIXED", value: 120 }],
      gridColumnSizes: [
        { type: "FIXED", value: 180 },
        { type: "FLEX", value: 2 },
      ],
      gridItemsPositioning: "ROW_AUTO_FLOW",
      gridAutoTracks: "NONE",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
    });
    expect(fromFigmaGridAutoLayout(figmaGrid)).toMatchObject({
      ok: true,
      grid: {
        mode: "grid",
        rows: [{ type: "hug" }, { type: "fixed", value: 120 }],
        columns: [
          { type: "fixed", value: 180 },
          { type: "fill", value: 2 },
        ],
      },
    });
    expect(
      fromFigmaGridAutoLayout({ ...figmaGrid, gridAutoTracks: "ROWS" }),
    ).toMatchObject({
      ok: true,
      grid: { autoTracks: "rows" },
    });
    expect(
      toFigmaGridAutoLayout({
        mode: "grid",
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        rowGap: 0,
        columnGap: 0,
        rows: [{ type: "fill", value: 1 }],
        columns: [{ type: "fill", value: 1 }],
        itemsPositioning: "row-auto-flow",
        autoTracks: "rows",
      }).gridAutoTracks,
    ).toBe("ROWS");
    const node = {
      id: "card",
      kind: "rectangle",
      name: "Card",
      parentId: "grid",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 80 },
      opacity: 1,
      exportSettings: [],
      gridPlacement: {
        row: 1,
        column: 0,
        rowSpan: 1,
        columnSpan: 2,
        horizontalAlign: "center",
        verticalAlign: "end",
      },
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
      },
      extensions: {},
    } satisfies DesignNode;
    expect(toFigmaGridChild(node)).toEqual({
      gridRowAnchorIndex: 1,
      gridColumnAnchorIndex: 0,
      gridRowSpan: 1,
      gridColumnSpan: 2,
      gridChildHorizontalAlign: "CENTER",
      gridChildVerticalAlign: "MAX",
    });
  });
});

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
  });
});

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

describe("Figma Slice and export settings compatibility", () => {
  it("projects Slice identity and public export settings without private format data", () => {
    const node: DesignNode = {
      id: "slice",
      kind: "slice",
      name: "Hero",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 180 },
      exportSettings: [
        {
          format: "PNG",
          suffix: "@2x",
          contentsOnly: true,
          useAbsoluteBounds: false,
          colorProfile: "DOCUMENT",
          constraint: { type: "SCALE", value: 2 },
        },
      ],
      opacity: 1,
      properties: {},
      extensions: {},
    };
    expect(toFigmaNodeType(node)).toBe("SLICE");
    expect(toFigmaExportSettings(node)).toEqual({
      ok: true,
      settings: [
        expect.objectContaining({
          format: "PNG",
          suffix: "@2x",
          constraint: { type: "SCALE", value: 2 },
        }),
      ],
    });
    node.exportSettings = [
      {
        format: "WEBP",
        suffix: "",
        contentsOnly: true,
        useAbsoluteBounds: false,
        colorProfile: "DOCUMENT",
        constraint: { type: "SCALE", value: 1 },
      },
    ];
    expect(toFigmaExportSettings(node)).toMatchObject({
      ok: false,
      issues: [expect.stringContaining("OpenDesign WEBP extension")],
    });
  });
});

describe("Figma Variables compatibility", () => {
  it("preserves public collection, variable, mode, alias, and binding shapes", () => {
    const collection = {
      id: "theme",
      key: "theme-key",
      name: "Theme",
      hiddenFromPublishing: false,
      modes: [
        { modeId: "light", name: "Light" },
        { modeId: "dark", name: "Dark" },
      ],
      variableIds: ["surface"],
      defaultModeId: "light",
      extensions: {},
    } satisfies DesignDocument["variableCollectionsById"][string];
    const variable = {
      id: "surface",
      key: "surface-key",
      name: "Color/Surface",
      description: "Surface color",
      hiddenFromPublishing: false,
      variableCollectionId: "theme",
      resolvedType: "COLOR",
      valuesByMode: {
        light: { r: 1, g: 1, b: 1 },
        dark: { type: "VARIABLE_ALIAS", id: "dark-primitive" },
      },
      scopes: ["FRAME_FILL"],
      codeSyntax: { WEB: "--color-surface", iOS: "colorSurface" },
      extensions: {},
    } satisfies DesignDocument["variablesById"][string];
    expect(toFigmaVariableCollection(collection)).toEqual({
      id: "theme",
      key: "theme-key",
      name: "Theme",
      hiddenFromPublishing: false,
      modes: collection.modes,
      variableIds: ["surface"],
      defaultModeId: "light",
    });
    expect(toFigmaVariable(variable)).toMatchObject({
      resolvedType: "COLOR",
      valuesByMode: variable.valuesByMode,
      scopes: ["FRAME_FILL"],
      codeSyntax: { WEB: "--color-surface", iOS: "colorSurface" },
    });
    const node: DesignNode = {
      id: "node",
      kind: "group",
      name: "Node",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      explicitVariableModes: { theme: "dark" },
      boundVariables: {
        opacity: { type: "VARIABLE_ALIAS" as const, id: "opacity" },
      },
      properties: {},
      extensions: {},
    };
    expect(toFigmaExplicitVariableModes(node)).toEqual({ theme: "dark" });
    expect(toFigmaNodeBoundVariables(node)).toEqual({
      opacity: { type: "VARIABLE_ALIAS", id: "opacity" },
    });
  });
});

describe("Figma component property compatibility", () => {
  it("projects OpenDesign definitions, references, and effective values to official Plugin API shapes", () => {
    const component: ComponentDefinition = {
      id: "button",
      name: "Button",
      rootNodeId: "main",
      componentPropertyOrder: ["Label#button:1"],
      componentPropertyDefinitions: {
        "Label#button:1": { type: "TEXT", defaultValue: "Continue" },
      },
      variantProperties: {},
      extensions: {},
    };
    const instance: InstanceNode = {
      id: "instance",
      name: "Button",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 120, height: 44 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "instance",
      properties: {
        componentId: "button",
        componentProperties: { "Label#button:1": "Submit" },
        overrides: [],
      },
    };
    const document = {
      format: "dev.opendesign.document",
      schemaVersion: DESIGN_SCHEMA_VERSION,
      documentId: "figma-compatibility",
      revision: 1,
      pageOrder: ["page"],
      pagesById: {
        page: {
          id: "page",
          name: "Page",
          rootNodeIds: ["main", "instance"],
          extensions: {},
        },
      },
      nodesById: {
        main: {
          id: "main",
          name: "Button",
          parentId: null,
          childIds: ["label"],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 120, height: 44 },
          exportSettings: [],
          opacity: 1,
          extensions: {},
          kind: "frame",
          properties: {
            fills: [],
            strokes: [],
            strokeWidth: 0,
            cornerRadius: 0,
            clipsContent: false,
          },
        },
        label: {
          id: "label",
          name: "Label",
          parentId: "main",
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 80, height: 20 },
          exportSettings: [],
          opacity: 1,
          componentPropertyReferences: { characters: "Label#button:1" },
          extensions: {},
          kind: "text",
          properties: {
            content: "Continue",
            fontFamily: "Inter",
            fontStyleName: "Medium",
            fontSize: 16,
            fontWeight: 500,
            fontSlant: "normal",
            lineHeight: 20,
            letterSpacing: 0,
            paragraphIndent: 0,
            paragraphSpacing: 0,
            listSpacing: 0,
            hangingList: false,
            textCase: "original",
            textDecoration: "none",
            textAlignHorizontal: "center",
            textAlignVertical: "center",
            textWrap: "word",
            textOverflow: "visible",
            textTruncation: "disabled",
            maxLines: null,
            textResize: "fixed",
            fills: [],
            strokes: [],
            strokeWidth: 0,
          },
        },
        instance,
      },
      componentsById: { button: component },
      variantSetsById: {},
      libraryComponentsById: {},
      libraryVariantSetsById: {},
      libraryStylesById: {},
      libraryVariableCollectionsById: {},
      libraryVariablesById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      imageAssetDerivationOrder: [],
      imageAssetDerivationsById: {},
      extensions: {},
    } satisfies DesignDocument;

    expect(toFigmaComponentPropertyDefinitions(component)).toEqual(
      component.componentPropertyDefinitions,
    );
    expect(
      toFigmaComponentPropertyReferences(document.nodesById.label),
    ).toEqual({
      characters: "Label#button:1",
    });
    expect(toFigmaComponentProperties(document, instance.id)).toEqual({
      "Label#button:1": { type: "TEXT", value: "Submit" },
    });
  });

  it("projects Component Set VARIANT definitions and member values to official Plugin API shapes", () => {
    const variantSet = {
      id: "button_set",
      name: "Button",
      rootNodeId: "button_set_root",
      defaultComponentId: "button_default",
      propertyOrder: ["State"],
      componentPropertyDefinitions: {
        State: {
          type: "VARIANT" as const,
          defaultValue: "Default",
          variantOptions: ["Default", "Hover"],
        },
      },
      extensions: {},
    };
    const component: ComponentDefinition = {
      id: "button_hover",
      name: "State=Hover",
      rootNodeId: "button_hover_root",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantSetId: variantSet.id,
      variantProperties: { State: "Hover" },
      extensions: {},
    };

    expect(toFigmaVariantSetPropertyDefinitions(variantSet)).toEqual({
      State: {
        type: "VARIANT",
        defaultValue: "Default",
        variantOptions: ["Default", "Hover"],
      },
    });
    expect(toFigmaVariantProperties(component)).toEqual({ State: "Hover" });
  });

  it("projects SLOT definitions and settings to the official Plugin API shape", () => {
    const component: ComponentDefinition = {
      id: "card",
      name: "Card",
      rootNodeId: "card_main",
      componentPropertyOrder: ["Content#card:content"],
      componentPropertyDefinitions: {
        "Content#card:content": {
          type: "SLOT",
          defaultValue: "card_content",
          preferredValues: [{ type: "COMPONENT", key: "list_item" }],
          description: "Use approved content blocks",
          slotSettings: {
            stretchChildOnInsert: true,
            displayEmptyByDefault: true,
            minChildren: 1,
            maxChildren: 6,
            allowPreferredValuesOnly: true,
          },
        },
      },
      variantProperties: {},
      extensions: {},
    };

    expect(toFigmaComponentPropertyDefinitions(component)).toEqual(
      component.componentPropertyDefinitions,
    );
  });
});
