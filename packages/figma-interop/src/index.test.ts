import { describe, expect, it } from "vitest";
import type {
  ComponentDefinition,
  DesignDocument,
  InstanceNode,
} from "@opendesign/design-contracts";
import {
  toFigmaComponentProperties,
  toFigmaComponentPropertyDefinitions,
  toFigmaComponentPropertyReferences,
} from "./index.js";

describe("Figma component property compatibility", () => {
  it("projects OpenDesign definitions, references, and effective values to official Plugin API shapes", () => {
    const component: ComponentDefinition = {
      id: "button",
      name: "Button",
      rootNodeId: "main",
      componentPropertyDefinitions: {
        "Label#button:1": { type: "TEXT", defaultValue: "Continue" },
      },
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
      schemaVersion: "1.21.0",
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
            textAlignHorizontal: "center",
            textAlignVertical: "center",
            textWrap: "word",
            textOverflow: "visible",
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
      tokenCollectionsById: {},
      tokensById: {},
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
});
