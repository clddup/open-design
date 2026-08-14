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
  toFigmaNodeType,
  toFigmaNodeBoundVariables,
  toFigmaNodeStyleReferences,
  toFigmaSharedStyleMetadata,
  toFigmaSharedStylePayload,
  toFigmaVariable,
  toFigmaVariableCollection,
  toFigmaVariantProperties,
  toFigmaVariantSetPropertyDefinitions,
} from "./index.js";

describe("Figma Shared Style compatibility", () => {
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
        fontSize: 32,
        fontWeight: 700,
        lineHeight: 40,
        letterSpacing: 1.5,
        paragraphIndent: 12,
        paragraphSpacing: 18,
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
          fontName: { family: "IBM Plex Sans", style: "Bold" },
          fontSize: 32,
          lineHeight: { unit: "PIXELS", value: 40 },
          letterSpacing: { unit: "PIXELS", value: 1.5 },
          textDecoration: "UNDERLINE",
          textCase: "SMALL_CAPS",
          paragraphIndent: 12,
          paragraphSpacing: 18,
        },
      },
    });
  });
});

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
            fontSize: 16,
            fontWeight: 500,
            lineHeight: 20,
            letterSpacing: 0,
            paragraphIndent: 0,
            paragraphSpacing: 0,
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
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
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
