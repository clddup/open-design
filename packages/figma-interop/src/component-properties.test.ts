import { describe, expect, it } from "vitest";
import {
  DESIGN_SCHEMA_VERSION,
  type ComponentDefinition,
  type DesignDocument,
  type InstanceNode,
} from "@opendesign/design-contracts";
import {
  toFigmaComponentProperties,
  toFigmaComponentPropertyDefinitions,
  toFigmaComponentPropertyReferences,
  toFigmaVariantProperties,
  toFigmaVariantSetPropertyDefinitions,
} from "./index.js";

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
            textDecorationStyle: null,
            textDecorationOffset: null,
            textDecorationThickness: null,
            textDecorationColor: null,
            textDecorationSkipInk: null,
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
