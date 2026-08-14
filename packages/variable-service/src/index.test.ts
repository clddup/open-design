import { describe, expect, it } from "vitest";
import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import {
  materializeVariableBindings,
  resolveVariableForConsumer,
  validateVariableDocument,
} from "./index.js";

describe("Variable Service v1", () => {
  it("resolves inherited modes independently through a cross-collection alias", () => {
    const document = fixture();
    const result = resolveVariableForConsumer(document, "semantic", {
      pageId: "page",
      nodeId: "text",
    });
    expect(result).toMatchObject({
      ok: true,
      resolved: {
        aliasChain: ["semantic", "primitive-light"],
        value: { r: 1, g: 1, b: 1, a: 0.5 },
        modes: [
          {
            collectionId: "semantic-col",
            modeId: "semantic-default",
            source: "default",
          },
          {
            collectionId: "primitive-col",
            modeId: "light",
            source: "node",
            sourceId: "frame",
          },
        ],
      },
    });
  });

  it("materializes node and paint bindings without changing the source document", () => {
    const document = fixture();
    const projected = materializeVariableBindings(document);
    expect(projected.issues).toEqual([]);
    expect(projected.document.nodesById.text).toMatchObject({
      visible: true,
      opacity: 0.4,
      properties: {
        content: "Variable copy",
        fills: [{ color: "#ffffff", opacity: 0.4 }],
      },
    });
    expect(document.nodesById.text).toMatchObject({
      opacity: 1,
      properties: {
        content: "Fallback",
        fills: [{ color: "#000000", opacity: 0.8 }],
      },
    });
  });

  it("detects alias cycles and keeps a valid fallback projection", () => {
    const document = fixture();
    document.variablesById["primitive-light"]!.valuesByMode.light = {
      type: "VARIABLE_ALIAS",
      id: "semantic",
    };
    expect(validateVariableDocument(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "alias-cycle" }),
      ]),
    );
    const projected = materializeVariableBindings(document);
    expect(projected.document.nodesById.text?.properties).toMatchObject({
      fills: [{ color: "#000000", opacity: 0.8 }],
    });
    expect(projected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "alias-cycle" }),
      ]),
    );
  });
});

function fixture(): DesignDocument {
  const text: DesignNode = {
    id: "text",
    kind: "text",
    name: "Text",
    parentId: "frame",
    childIds: [],
    visible: false,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 120, height: 40 },
    opacity: 1,
    boundVariables: {
      visible: { type: "VARIABLE_ALIAS", id: "enabled" },
      opacity: { type: "VARIABLE_ALIAS", id: "opacity" },
      characters: { type: "VARIABLE_ALIAS", id: "copy" },
    },
    properties: {
      content: "Fallback",
      fontFamily: "Inter",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 20,
      letterSpacing: 0,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      fills: [
        {
          type: "solid",
          color: "#000000",
          opacity: 0.8,
          boundVariables: { color: { type: "VARIABLE_ALIAS", id: "semantic" } },
        },
      ],
      strokes: [],
      strokeWidth: 0,
      strokeAlign: "center",
      strokeCap: "none",
      strokeJoin: "miter",
      dashPattern: [],
      textResize: "fixed",
      textWrap: "word",
      textOverflow: "clip",
    },
    extensions: {},
  };
  return {
    format: "dev.opendesign.document",
    schemaVersion: "1.26.0",
    documentId: "variables",
    revision: 0,
    pageOrder: ["page"],
    pagesById: {
      page: {
        id: "page",
        name: "Page",
        rootNodeIds: ["frame"],
        extensions: {},
      },
    },
    nodesById: {
      frame: {
        id: "frame",
        kind: "frame",
        name: "Frame",
        parentId: null,
        childIds: ["text"],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0],
        size: { width: 400, height: 400 },
        opacity: 1,
        explicitVariableModes: { "primitive-col": "light" },
        properties: {
          fills: [],
          strokes: [],
          strokeWidth: 0,
          strokeAlign: "center",
          strokeCap: "none",
          strokeJoin: "miter",
          dashPattern: [],
          cornerRadius: 0,
          clipsContent: false,
        },
        extensions: {},
      },
      text,
    },
    componentsById: {},
    variantSetsById: {},
    variableCollectionOrder: ["primitive-col", "semantic-col"],
    variableCollectionsById: {
      "primitive-col": {
        id: "primitive-col",
        key: "primitive-key",
        name: "Primitive",
        hiddenFromPublishing: false,
        modes: [
          { modeId: "dark", name: "Dark" },
          { modeId: "light", name: "Light" },
        ],
        variableIds: ["primitive-light", "enabled", "opacity", "copy"],
        defaultModeId: "dark",
        extensions: {},
      },
      "semantic-col": {
        id: "semantic-col",
        key: "semantic-key",
        name: "Semantic",
        hiddenFromPublishing: false,
        modes: [{ modeId: "semantic-default", name: "Default" }],
        variableIds: ["semantic"],
        defaultModeId: "semantic-default",
        extensions: {},
      },
    },
    variablesById: {
      "primitive-light": variable("primitive-light", "primitive-col", "COLOR", {
        dark: { r: 0, g: 0, b: 0 },
        light: { r: 1, g: 1, b: 1, a: 0.5 },
      }),
      semantic: variable("semantic", "semantic-col", "COLOR", {
        "semantic-default": { type: "VARIABLE_ALIAS", id: "primitive-light" },
      }),
      enabled: variable("enabled", "primitive-col", "BOOLEAN", {
        dark: false,
        light: true,
      }),
      opacity: variable("opacity", "primitive-col", "FLOAT", {
        dark: 0.8,
        light: 0.4,
      }),
      copy: variable("copy", "primitive-col", "STRING", {
        dark: "Dark copy",
        light: "Variable copy",
      }),
    },
    interactionsById: {},
    assetsById: {},
    extensions: {},
  };
}

function variable(
  id: string,
  variableCollectionId: string,
  resolvedType: "BOOLEAN" | "COLOR" | "FLOAT" | "STRING",
  valuesByMode: Record<string, boolean | number | string | object>,
): DesignDocument["variablesById"][string] {
  return {
    id,
    key: `${id}-key`,
    name: id,
    description: "",
    hiddenFromPublishing: false,
    variableCollectionId,
    resolvedType,
    valuesByMode: valuesByMode as never,
    scopes: ["ALL_SCOPES"],
    codeSyntax: {},
    extensions: {},
  };
}
