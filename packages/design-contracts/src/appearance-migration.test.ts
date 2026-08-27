import { describe, expect, it } from "vitest";
import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  migrateDesignDocument,
} from "./index.js";

describe("appearance migrations", () => {
  it("migrates 1.0 documents to the versioned appearance contract", () => {
    const legacy = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.0.0",
      documentId: "document_legacy",
      revision: 0,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: [],
          extensions: {},
        },
      },
      nodesById: {},
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: {},
    };
    expect(migrateDesignDocument(legacy)?.schemaVersion).toBe(
      DESIGN_SCHEMA_VERSION,
    );
    expect(
      migrateDesignDocument({ ...legacy, schemaVersion: "0.9.0" }),
    ).toBeNull();
  });

  it("migrates 1.1 path placeholders without losing their legacy payload", () => {
    const legacyPathProperties = {
      path: [1, 10, 10, 2, 80, 80, 11],
      customGeometryHint: "legacy compact command stream",
    };
    const legacy = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.1.0",
      documentId: "document_path_legacy",
      revision: 3,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: ["path_1"],
          extensions: {},
        },
      },
      nodesById: {
        path_1: {
          id: "path_1",
          name: "Legacy path",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 100, height: 100 },
          exportSettings: [],
          opacity: 1,
          extensions: {},
          kind: "path",
          properties: legacyPathProperties,
        },
      },
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: {},
    };

    const migrated = migrateDesignDocument(legacy);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const path = migrated?.nodesById.path_1;
    expect(path?.kind).toBe("path");
    if (!path || path.kind !== "path") throw new Error("Missing path node");
    expect(path.properties).toMatchObject({
      path: "M 0 0",
      fills: [],
      strokes: [],
      strokeWidth: 0,
    });
    expect(path.extensions["dev.opendesign.path.migration"]).toEqual({
      sourceSchemaVersion: "1.1.0",
      originalProperties: legacyPathProperties,
      usedPlaceholderPath: true,
    });
  });

  it.each([
    ["fill", { mode: "stretch" }],
    ["contain", { mode: "fit" }],
    ["cover", { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } }],
  ])("migrates 1.2 image fit %s to explicit placement", (fit, placement) => {
    const legacy = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.2.0",
      documentId: `document_image_${fit}`,
      revision: 2,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: ["image_1"],
          extensions: {},
        },
      },
      nodesById: {
        image_1: {
          id: "image_1",
          name: "Legacy image",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 320, height: 240 },
          exportSettings: [],
          opacity: 1,
          extensions: {},
          kind: "image",
          properties: {
            assetId: "asset_1",
            fit,
            altText: "Legacy image",
            cornerRadius: 0,
          },
        },
      },
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {
        asset_1: {
          id: "asset_1",
          kind: "image",
          name: "Legacy asset",
          mimeType: "image/png",
          source: { type: "data", value: "aW1hZ2U=" },
          size: { width: 640, height: 480 },
          extensions: {},
        },
      },
      extensions: {},
    };

    const migrated = migrateDesignDocument(legacy);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const image = migrated?.nodesById.image_1;
    expect(image?.kind).toBe("image");
    if (!image || image.kind !== "image") throw new Error("Missing image");
    expect(image.properties.placement).toEqual(placement);
    expect(
      image.extensions["dev.opendesign.image-placement.migration"],
    ).toEqual({ sourceSchemaVersion: "1.2.0", legacyFit: fit });
  });

  it("migrates a 1.3 document to the current schema without inventing state", () => {
    const imagePlacementDocument = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.3.0",
      documentId: "document_image_placement",
      revision: 7,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: [],
          extensions: {},
        },
      },
      nodesById: {},
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.3-fixture" },
    };

    expect(migrateDesignDocument(imagePlacementDocument)).toEqual({
      ...imagePlacementDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
      libraryComponentsById: {},
      libraryVariantSetsById: {},
      libraryStylesById: {},
      libraryVariableCollectionsById: {},
      libraryVariablesById: {},
      imageAssetDerivationOrder: [],
      imageAssetDerivationsById: {},
    });
  });

  it("migrates a 1.4 document to the current schema without inventing Line state", () => {
    const maskDocument = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.4.0",
      documentId: "document_mask",
      revision: 9,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: [],
          extensions: {},
        },
      },
      nodesById: {},
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.4-fixture" },
    };

    expect(migrateDesignDocument(maskDocument)).toEqual({
      ...maskDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
      libraryComponentsById: {},
      libraryVariantSetsById: {},
      libraryStylesById: {},
      libraryVariableCollectionsById: {},
      libraryVariablesById: {},
      imageAssetDerivationOrder: [],
      imageAssetDerivationsById: {},
    });
  });

  it("migrates a 1.5 document without inventing Polygon, Star, or vector state", () => {
    const lineDocument = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.5.0",
      documentId: "document_line",
      revision: 10,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: [],
          extensions: {},
        },
      },
      nodesById: {},
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.5-fixture" },
    };

    expect(migrateDesignDocument(lineDocument)).toEqual({
      ...lineDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
      libraryComponentsById: {},
      libraryVariantSetsById: {},
      libraryStylesById: {},
      libraryVariableCollectionsById: {},
      libraryVariablesById: {},
      imageAssetDerivationOrder: [],
      imageAssetDerivationsById: {},
    });
  });

  it("migrates a 1.6 document without converting exact path data into an editable network", () => {
    const regularShapeDocument = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.6.0",
      documentId: "document_regular_shape",
      revision: 11,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: ["path_1"],
          extensions: {},
        },
      },
      nodesById: {
        path_1: {
          id: "path_1",
          name: "Exact imported path",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 100, height: 100 },
          exportSettings: [],
          opacity: 1,
          extensions: {},
          kind: "path",
          properties: {
            path: "M 0 0 L 100 0 L 50 100 Z",
            fills: [{ type: "solid", color: "#111827", opacity: 1 }],
            strokes: [],
            strokeWidth: 0,
          },
        },
      },
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.6-fixture" },
    };

    const migrated = migrateDesignDocument(regularShapeDocument);
    expect(migrated).toEqual({
      ...regularShapeDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
      libraryComponentsById: {},
      libraryVariantSetsById: {},
      libraryStylesById: {},
      libraryVariableCollectionsById: {},
      libraryVariablesById: {},
      imageAssetDerivationOrder: [],
      imageAssetDerivationsById: {},
    });
    const path = migrated?.nodesById.path_1;
    expect(path?.kind).toBe("path");
    if (!path || path.kind !== "path") throw new Error("Missing path");
    expect(path.properties).toHaveProperty("path");
    expect(path.properties).not.toHaveProperty("network");
  });

  it("migrates a 1.7 editable network without inventing handle behavior", () => {
    const source = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.7.0",
      documentId: "document_vector_1_7",
      revision: 3,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: ["vector_1"],
          extensions: {},
        },
      },
      nodesById: {
        vector_1: {
          id: "vector_1",
          name: "Legacy editable vector",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 100, height: 0 },
          exportSettings: [],
          opacity: 1,
          extensions: {},
          kind: "vector",
          properties: {
            network: {
              vertices: [
                { id: "vertex_a", x: 0, y: 0 },
                { id: "vertex_b", x: 100, y: 0 },
              ],
              segments: [
                {
                  id: "segment_ab",
                  startVertexId: "vertex_a",
                  endVertexId: "vertex_b",
                },
              ],
              paths: [
                {
                  id: "path_open",
                  closed: false,
                  segments: [{ segmentId: "segment_ab", reversed: false }],
                },
              ],
              regions: [],
            },
            fills: [],
            strokes: [{ type: "solid", color: "#151515", opacity: 1 }],
            strokeWidth: 2,
          },
        },
      },
      componentsById: {},
      variantSetsById: {},
      variableCollectionOrder: [],
      variableCollectionsById: {},
      variablesById: {},
      styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
      stylesById: {},
      interactionsById: {},
      assetsById: {},
      extensions: {},
    };

    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const node = migrated?.nodesById.vector_1;
    if (!node || node.kind !== "vector" || !("network" in node.properties)) {
      throw new Error("Missing migrated vector");
    }
    expect(node.properties.network.vertices).toEqual(
      source.nodesById.vector_1.properties.network.vertices,
    );
  });
});
