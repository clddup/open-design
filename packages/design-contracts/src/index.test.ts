import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  DesignNodeSchema,
  DesignOperationSchema,
  DesignTransactionSchema,
  EffectSchema,
  MAX_TRANSACTION_COMMANDS,
  PaintSchema,
  isDesignTransaction,
  migrateDesignDocument,
  normalizeLineEndpoints,
  resolveLineEndpointPoint,
  schemaValidationIssues,
} from "./index.js";

const actor = { type: "user" as const, id: "user_1" };

function operation() {
  return {
    commandId: "command_1",
    type: "delete_element" as const,
    nodeId: "node_1",
  };
}

describe("design contract schemas", () => {
  it("rejects unknown operation and transaction properties", () => {
    expect(Value.Check(DesignOperationSchema, operation())).toBe(true);
    expect(
      Value.Check(DesignOperationSchema, { ...operation(), unexpected: true }),
    ).toBe(false);
    expect(
      Value.Check(DesignTransactionSchema, {
        transactionId: "transaction_1",
        documentId: "document_1",
        baseRevision: 0,
        actor,
        commands: [operation()],
        unexpected: true,
      }),
    ).toBe(false);
  });

  it("rejects cyclic JSON values without throwing", () => {
    const extensions: Record<string, unknown> = {};
    extensions.self = extensions;
    const value = {
      transactionId: "transaction_cyclic",
      documentId: "document_1",
      baseRevision: 0,
      actor,
      commands: [operation()],
      extensions,
    };

    expect(() => isDesignTransaction(value)).not.toThrow();
    expect(isDesignTransaction(value)).toBe(false);
    expect(schemaValidationIssues(DesignTransactionSchema, value)).toEqual([
      {
        path: "",
        message: "Value contains an unsupported cyclic structure",
      },
    ]);
  });

  it("enforces a non-empty command list capped at 500", () => {
    const transaction = {
      transactionId: "transaction_1",
      documentId: "document_1",
      baseRevision: 0,
      actor,
    };
    expect(
      Value.Check(DesignTransactionSchema, { ...transaction, commands: [] }),
    ).toBe(false);
    expect(
      Value.Check(DesignTransactionSchema, {
        ...transaction,
        commands: Array.from(
          { length: MAX_TRANSACTION_COMMANDS + 1 },
          (_, index) => ({
            ...operation(),
            commandId: `command_${index}`,
          }),
        ),
      }),
    ).toBe(false);
  });

  it("validates explicit non-destructive image placement modes", () => {
    const base = {
      id: "image_1",
      name: "Hero",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 640, height: 360 },
      opacity: 1,
      extensions: {},
      kind: "image",
      properties: {
        assetId: "asset_1",
        altText: "Hero image",
        cornerRadius: 0,
      },
    };
    expect(
      Value.Check(DesignNodeSchema, {
        ...base,
        properties: {
          ...base.properties,
          placement: {
            mode: "crop",
            focalPoint: { x: 0.3, y: 0.65 },
            zoom: 1.4,
            rotation: -12,
            flipHorizontal: false,
            flipVertical: true,
          },
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...base,
        properties: {
          ...base.properties,
          placement: {
            mode: "crop",
            focalPoint: { x: 1.1, y: 0.5 },
            zoom: 0.5,
            rotation: 0,
            flipHorizontal: false,
            flipVertical: false,
          },
        },
      }),
    ).toBe(false);
  });

  it("accepts complex paints and effects as engine-independent design semantics", () => {
    expect(
      Value.Check(PaintSchema, {
        type: "linear-gradient",
        opacity: 0.9,
        from: { x: 0, y: 0.5 },
        to: { x: 1, y: 0.5 },
        stops: [
          { offset: 0, color: "#3366ff", opacity: 1 },
          { offset: 1, color: "#9b5cff", opacity: 0.35 },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(EffectSchema, {
        type: "outer-glow",
        color: "#4f7fff",
        opacity: 0.6,
        radius: 28,
        spread: 3,
      }),
    ).toBe(true);
  });

  it("defines portable SVG path geometry with the same appearance semantics as shapes", () => {
    const pathNode = {
      id: "path_penguin",
      name: "Penguin silhouette",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 160, height: 220 },
      opacity: 1,
      extensions: {},
      kind: "path",
      properties: {
        path: "M 80 4 C 126 4 154 46 148 108 C 143 171 118 214 80 216 C 42 214 17 171 12 108 C 6 46 34 4 80 4 Z",
        fillRule: "evenodd",
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [{ type: "solid", color: "#030712", opacity: 0.8 }],
        strokeWidth: 3,
        strokeAlign: "inside",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [],
      },
    };

    expect(Value.Check(DesignNodeSchema, pathNode)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...pathNode,
        properties: { ...pathNode.properties, path: "<script>bad()</script>" },
      }),
    ).toBe(false);
  });

  it("defines a directed editable line with independent endpoint decorations", () => {
    const lineNode = {
      id: "line_flow",
      name: "Directed flow",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 40, 32],
      size: { width: 240, height: 120 },
      opacity: 1,
      extensions: {},
      kind: "line",
      properties: {
        fills: [],
        strokes: [{ type: "solid", color: "#2563eb", opacity: 1 }],
        strokeWidth: 3,
        strokeAlign: "center",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [12, 6],
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        startEndpoint: "circle",
        endEndpoint: "triangle-arrow",
      },
    };

    expect(Value.Check(DesignNodeSchema, lineNode)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...lineNode,
        properties: {
          ...lineNode.properties,
          endEndpoint: "custom-unsafe-marker",
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...lineNode,
        properties: {
          ...lineNode.properties,
          fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...lineNode,
        properties: { ...lineNode.properties, strokeAlign: "inside" },
      }),
    ).toBe(false);
    expect(
      resolveLineEndpointPoint(lineNode.size, lineNode.properties.start),
    ).toEqual({ x: 240, y: 0 });
  });

  it("normalizes line direction without losing horizontal or reverse endpoints", () => {
    expect(normalizeLineEndpoints({ x: 80, y: 40 }, { x: 20, y: 40 })).toEqual({
      bounds: { x: 20, y: 40, width: 60, height: 0 },
      start: { x: 1, y: 0.5 },
      end: { x: 0, y: 0.5 },
    });
  });

  it("defines a non-destructive Boolean container without persisting derived provider geometry", () => {
    const booleanNode = {
      id: "boolean_logo",
      name: "Logo cutout",
      parentId: null,
      childIds: ["path_base", "path_cutout"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 160, height: 160 },
      opacity: 1,
      effects: [
        {
          type: "outer-glow",
          color: "#5b8cff",
          opacity: 0.45,
          radius: 20,
          spread: 2,
        },
      ],
      extensions: {},
      kind: "boolean",
      properties: {
        operation: "subtract",
        fillRule: "evenodd",
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
    };

    expect(Value.Check(DesignNodeSchema, booleanNode)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...booleanNode,
        properties: { ...booleanNode.properties, operation: "divide" },
      }),
    ).toBe(false);
    expect(booleanNode.properties).not.toHaveProperty("path");
  });

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
      tokenCollectionsById: {},
      tokensById: {},
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
          opacity: 1,
          extensions: {},
          kind: "path",
          properties: legacyPathProperties,
        },
      },
      componentsById: {},
      variantSetsById: {},
      tokenCollectionsById: {},
      tokensById: {},
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
      tokenCollectionsById: {},
      tokensById: {},
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
      tokenCollectionsById: {},
      tokensById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.3-fixture" },
    };

    expect(migrateDesignDocument(imagePlacementDocument)).toEqual({
      ...imagePlacementDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
    });
  });

  it("migrates a 1.4 document to 1.5 without inventing Line state", () => {
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
      tokenCollectionsById: {},
      tokensById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.4-fixture" },
    };

    expect(migrateDesignDocument(maskDocument)).toEqual({
      ...maskDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
    });
  });
});
