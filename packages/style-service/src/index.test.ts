import { describe, expect, it } from "vitest";
import {
  DESIGN_SCHEMA_VERSION,
  type DesignDocument,
} from "@opendesign/design-contracts";
import {
  materializeSharedStyles,
  styleConsumers,
  validateStyleDocument,
} from "./index.js";

describe("Style Service", () => {
  it("preserves document identity when no style projection is required", () => {
    const document = fixture();
    for (const node of Object.values(document.nodesById)) {
      delete node.fillStyleId;
      delete node.strokeStyleId;
      delete node.textStyleId;
      delete node.effectStyleId;
      delete node.gridStyleId;
    }
    expect(materializeSharedStyles(document).document).toBe(document);
  });

  it("materializes all four local style types without mutating fallbacks", () => {
    const document = fixture();
    const result = materializeSharedStyles(document);
    expect(result.issues).toEqual([]);
    expect(result.document.nodesById.text).toMatchObject({
      effects: [{ type: "layer-blur", radius: 6 }],
      properties: {
        fills: [{ type: "solid", color: "#2563eb", opacity: 1 }],
        fontFamily: "Inter",
        fontStyleName: null,
        fontSize: 18,
        fontWeight: 600,
        fontSlant: "normal",
        lineHeight: 26,
      },
    });
    expect(result.document.nodesById.frame).toMatchObject({
      properties: { layoutGuides: [{ type: "grid", size: 8 }] },
    });
    expect(document.nodesById.text?.properties).toMatchObject({
      fills: [{ color: "#111111" }],
      fontSize: 14,
    });
  });

  it("validates stable keys, typed order and compatible references", () => {
    const document = fixture();
    document.stylesById.paint2 = {
      ...structuredClone(document.stylesById.paint!),
      id: "paint2",
    };
    document.styleOrderByType.TEXT.push("paint2");
    document.nodesById.frame!.textStyleId = "paint";
    expect(validateStyleDocument(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-key" }),
        expect.objectContaining({ code: "order-type-mismatch" }),
        expect.objectContaining({ code: "incompatible-reference" }),
      ]),
    );
  });

  it("finds every consumer through stable style references", () => {
    expect(styleConsumers(fixture(), "paint")).toEqual([
      { nodeId: "text", field: "fillStyleId" },
    ]);
  });
});

function fixture(): DesignDocument {
  return {
    format: "dev.opendesign.document",
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "styles",
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
        exportSettings: [],
        opacity: 1,
        gridStyleId: "grid",
        properties: {
          fills: [],
          strokes: [],
          strokeWidth: 0,
          cornerRadius: 0,
          clipsContent: false,
        },
        extensions: {},
      },
      text: {
        id: "text",
        kind: "text",
        name: "Text",
        parentId: "frame",
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 20, 20],
        size: { width: 200, height: 40 },
        exportSettings: [],
        opacity: 1,
        fillStyleId: "paint",
        textStyleId: "text",
        effectStyleId: "effect",
        properties: {
          content: "Fallback",
          fontFamily: "Arial",
          fontStyleName: null,
          fontSize: 14,
          fontWeight: 400,
          fontSlant: "normal",
          lineHeight: 20,
          letterSpacing: 0,
          paragraphIndent: 0,
          paragraphSpacing: 0,
          listSpacing: 0,
          hangingList: false,
          textCase: "original",
          textDecoration: "none",
          textAlignHorizontal: "left",
          textAlignVertical: "top",
          fills: [{ type: "solid", color: "#111111", opacity: 1 }],
          strokes: [],
          strokeWidth: 0,
          textResize: "fixed",
          textWrap: "word",
          textOverflow: "clip",
          textTruncation: "disabled",
          maxLines: null,
        },
        extensions: {},
      },
    },
    componentsById: {},
    variantSetsById: {},
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    libraryStylesById: {},
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: {
      PAINT: ["paint"],
      TEXT: ["text"],
      EFFECT: ["effect"],
      GRID: ["grid"],
    },
    stylesById: {
      paint: {
        id: "paint",
        key: "paint-key",
        name: "Brand/Primary",
        description: "",
        hiddenFromPublishing: false,
        styleType: "PAINT",
        paints: [{ type: "solid", color: "#2563eb", opacity: 1 }],
        extensions: {},
      },
      text: {
        id: "text",
        key: "text-key",
        name: "Body/Medium",
        description: "",
        hiddenFromPublishing: false,
        styleType: "TEXT",
        textStyle: {
          fontFamily: "Inter",
          fontStyleName: null,
          fontSize: 18,
          fontWeight: 600,
          fontSlant: "normal",
          lineHeight: 26,
          letterSpacing: 0,
          paragraphIndent: 0,
          paragraphSpacing: 8,
          listSpacing: 0,
          hangingList: false,
          textCase: "original",
          textDecoration: "none",
        },
        extensions: {},
      },
      effect: {
        id: "effect",
        key: "effect-key",
        name: "Blur/Small",
        description: "",
        hiddenFromPublishing: false,
        styleType: "EFFECT",
        effects: [{ type: "layer-blur", radius: 6 }],
        extensions: {},
      },
      grid: {
        id: "grid",
        key: "grid-key",
        name: "Grid/8",
        description: "",
        hiddenFromPublishing: false,
        styleType: "GRID",
        layoutGuides: [
          {
            id: "guide",
            type: "grid",
            size: 8,
            color: "#2563eb",
            opacity: 0.2,
          },
        ],
        extensions: {},
      },
    },
    interactionsById: {},
    assetsById: {},
    extensions: {},
  };
}
