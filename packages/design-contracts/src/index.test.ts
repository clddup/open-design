import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  ComponentOverridePatchSchema,
  DesignNodeSchema,
  DesignOperationSchema,
  DesignTransactionSchema,
  EffectSchema,
  MAX_TRANSACTION_COMMANDS,
  PaintSchema,
  isDesignTransaction,
  migrateDesignDocument,
  normalizeLineEndpoints,
  resolveRegularPolygonPoints,
  resolveLineEndpointPoint,
  resolveStarPoints,
  schemaValidationIssues,
} from "./index.js";

const actor = { type: "user" as const, id: "user_1" };

function textDocumentFixture() {
  return {
    format: DESIGN_FORMAT,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "document_text_current",
    revision: 0,
    pageOrder: ["page_1"],
    pagesById: {
      page_1: {
        id: "page_1",
        name: "Page 1",
        rootNodeIds: ["text_1"],
        extensions: {},
      },
    },
    nodesById: {
      text_1: {
        id: "text_1",
        name: "Text",
        parentId: null,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0] as const,
        size: { width: 240, height: 64 },
        opacity: 1,
        extensions: {},
        kind: "text" as const,
        properties: {
          content: "Text",
          fontFamily: "Inter",
          fontSize: 20,
          fontWeight: 500,
          lineHeight: 28,
          letterSpacing: 0,
          textAlignHorizontal: "left" as const,
          textAlignVertical: "top" as const,
          textResize: "fixed" as const,
          textWrap: "word" as const,
          textOverflow: "clip" as const,
          fills: [{ type: "solid" as const, color: "#111827", opacity: 1 }],
          strokes: [],
          strokeWidth: 0,
        },
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
}

function operation() {
  return {
    commandId: "command_1",
    type: "delete_element" as const,
    nodeId: "node_1",
  };
}

describe("design contract schemas", () => {
  it("validates component overrides without permitting structural edits", () => {
    expect(
      Value.Check(ComponentOverridePatchSchema, {
        visible: false,
        opacity: 0.8,
        properties: { content: "Buy now" },
      }),
    ).toBe(true);
    expect(
      Value.Check(ComponentOverridePatchSchema, {
        transform: [1, 0, 0, 1, 40, 40],
      }),
    ).toBe(false);
  });

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

  it("expands discriminated node union failures to actionable fields", () => {
    const invalidFrame = {
      id: "frame_invalid",
      name: "Invalid frame",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      opacity: 1,
      extensions: {},
      kind: "frame",
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
      },
    };

    const issues = schemaValidationIssues(DesignNodeSchema, invalidFrame);

    expect(issues).toContainEqual({
      path: "/properties/clipsContent",
      message: "Expected required property",
    });
    expect(
      issues.some((issue) => issue.message === "Expected union value"),
    ).toBe(false);

    const transactionIssues = schemaValidationIssues(DesignTransactionSchema, {
      transactionId: "transaction_invalid_frame",
      documentId: "document_1",
      baseRevision: 0,
      actor,
      commands: [
        {
          commandId: "insert_invalid_frame",
          type: "insert_element",
          pageId: "page_1",
          parentId: null,
          index: 0,
          node: invalidFrame,
        },
      ],
    });
    expect(transactionIssues).toContainEqual({
      path: "/commands/0/node/properties/clipsContent",
      message: "Expected required property",
    });
    expect(
      transactionIssues.some(
        (issue) => issue.message === "Expected union value",
      ),
    ).toBe(false);
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

  it("defines editable vector networks as an exclusive path geometry source", () => {
    const vectorNode = {
      id: "vector_mark",
      name: "Editable mark",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 20, 30],
      size: { width: 100, height: 100 },
      opacity: 1,
      extensions: {},
      kind: "vector",
      properties: {
        network: {
          vertices: [
            { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
            { id: "vertex_b", x: 100, y: 0, handleMode: "smooth" },
            { id: "vertex_c", x: 50, y: 100, handleMode: "independent" },
          ],
          segments: [
            {
              id: "segment_ab",
              startVertexId: "vertex_a",
              endVertexId: "vertex_b",
            },
            {
              id: "segment_bc",
              startVertexId: "vertex_b",
              endVertexId: "vertex_c",
            },
            {
              id: "segment_ca",
              startVertexId: "vertex_c",
              endVertexId: "vertex_a",
            },
          ],
          paths: [
            {
              id: "path_outer",
              closed: true,
              segments: [
                { segmentId: "segment_ab", reversed: false },
                { segmentId: "segment_bc", reversed: false },
                { segmentId: "segment_ca", reversed: false },
              ],
            },
          ],
          regions: [
            {
              id: "region_outer",
              windingRule: "nonzero",
              loops: [{ pathId: "path_outer", reversed: false }],
            },
          ],
        },
        fillRule: "nonzero",
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokeWidth: 2,
      },
    };

    expect(Value.Check(DesignNodeSchema, vectorNode)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...vectorNode,
        properties: { ...vectorNode.properties, path: "M 0 0 L 100 0" },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...vectorNode,
        properties: {
          ...vectorNode.properties,
          network: {
            ...vectorNode.properties.network,
            vertices: [
              {
                ...vectorNode.properties.network.vertices[0],
                handleMode: "automatic",
              },
              ...vectorNode.properties.network.vertices.slice(1),
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...vectorNode,
        properties: {
          ...vectorNode.properties,
          network: {
            ...vectorNode.properties.network,
            vertices: [
              { id: "invalid id", x: 0, y: 0 },
              ...vectorNode.properties.network.vertices.slice(1),
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...vectorNode,
        properties: { ...vectorNode.properties, unsupportedGeometry: true },
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

  it("defines bounded semantic Polygon and Star nodes", () => {
    const base = {
      id: "shape_1",
      name: "Semantic shape",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 40, 32],
      size: { width: 200, height: 160 },
      opacity: 1,
      extensions: {},
    };
    const shape = {
      fills: [{ type: "solid", color: "#f59e0b", opacity: 1 }],
      strokes: [{ type: "solid", color: "#78350f", opacity: 1 }],
      strokeWidth: 2,
      strokeAlign: "inside",
      strokeJoin: "round",
      dashPattern: [],
      pointCount: 6,
      cornerRadius: 8,
    };
    const polygon = { ...base, kind: "polygon", properties: shape };
    const star = {
      ...base,
      id: "star_1",
      kind: "star",
      properties: { ...shape, pointCount: 5, innerRadius: 0.382 },
    };

    expect(Value.Check(DesignNodeSchema, polygon)).toBe(true);
    expect(Value.Check(DesignNodeSchema, star)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...polygon,
        properties: { ...shape, pointCount: 2 },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...star,
        properties: { ...star.properties, innerRadius: 1.01 },
      }),
    ).toBe(false);
  });

  it("resolves Polygon and Star vertices from the top in local bounds", () => {
    const polygon = resolveRegularPolygonPoints({ width: 100, height: 80 }, 4);
    const expectedPolygon = [
      { x: 50, y: 0 },
      { x: 100, y: 40 },
      { x: 50, y: 80 },
      { x: 0, y: 40 },
    ];
    polygon.forEach((point, index) => {
      expect(point.x).toBeCloseTo(expectedPolygon[index]!.x, 10);
      expect(point.y).toBeCloseTo(expectedPolygon[index]!.y, 10);
    });
    const star = resolveStarPoints({ width: 100, height: 100 }, 5, 0.5);
    expect(star).toHaveLength(10);
    expect(star[0]).toEqual({ x: 50, y: 0 });
    expect(star[1]?.x).toBeCloseTo(64.6946, 4);
    expect(star[1]?.y).toBeCloseTo(29.7746, 4);
    expect(() =>
      resolveRegularPolygonPoints({ width: 10, height: 10 }, 61),
    ).toThrow("pointCount");
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
      tokenCollectionsById: {},
      tokensById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.5-fixture" },
    };

    expect(migrateDesignDocument(lineDocument)).toEqual({
      ...lineDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
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
      tokenCollectionsById: {},
      tokensById: {},
      interactionsById: {},
      assetsById: {},
      extensions: { source: "1.6-fixture" },
    };

    const migrated = migrateDesignDocument(regularShapeDocument);
    expect(migrated).toEqual({
      ...regularShapeDocument,
      schemaVersion: DESIGN_SCHEMA_VERSION,
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
      tokenCollectionsById: {},
      tokensById: {},
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

  it("migrates 1.8 Text to explicit wrapping and overflow without changing its bounds", () => {
    const source = {
      format: DESIGN_FORMAT,
      schemaVersion: "1.8.0",
      documentId: "document_text_1_8",
      revision: 12,
      pageOrder: ["page_1"],
      pagesById: {
        page_1: {
          id: "page_1",
          name: "Page 1",
          rootNodeIds: ["text_1"],
          extensions: {},
        },
      },
      nodesById: {
        text_1: {
          id: "text_1",
          name: "Legacy text box",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 20, 24],
          size: { width: 240, height: 64 },
          opacity: 1,
          extensions: {},
          kind: "text",
          properties: {
            content: "A long line from an older document",
            fontFamily: "Inter",
            fontSize: 20,
            fontWeight: 500,
            lineHeight: 28,
            letterSpacing: 0,
            textAlignHorizontal: "left",
            textAlignVertical: "top",
            fills: [{ type: "solid", color: "#111827", opacity: 1 }],
            strokes: [],
            strokeWidth: 0,
          },
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

    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const text = migrated?.nodesById.text_1;
    if (!text || text.kind !== "text") throw new Error("Missing text");
    expect(text.size).toEqual(source.nodesById.text_1.size);
    expect(text.properties).toMatchObject({
      textResize: "fixed",
      textWrap: "character",
      textOverflow: "visible",
    });
    expect(Value.Check(DesignNodeSchema, text)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: { ...text.properties, textOverflow: "fade" },
      }),
    ).toBe(false);
  });

  it("migrates 1.9 fixed text boxes to explicit Fixed resizing", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.9.0" as typeof source.schemaVersion;
    const text = Object.values(source.nodesById).find(
      (node) => node.kind === "text",
    );
    if (!text || text.kind !== "text") throw new Error("Missing text");
    delete (text.properties as Partial<typeof text.properties>).textResize;

    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    const migratedText = migrated?.nodesById[text.id];
    expect(migratedText).toMatchObject({
      kind: "text",
      size: text.size,
      properties: { textResize: "fixed" },
    });
  });

  it("migrates 1.10 documents but refuses ambiguous legacy instance semantics", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.10.0" as typeof source.schemaVersion;
    expect(migrateDesignDocument(source)?.schemaVersion).toBe(
      DESIGN_SCHEMA_VERSION,
    );

    const legacyInstance = structuredClone(source) as Record<string, unknown>;
    legacyInstance.nodesById = {
      instance_legacy: {
        id: "instance_legacy",
        kind: "instance",
        name: "Unknown legacy instance",
        parentId: null,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0],
        size: { width: 100, height: 40 },
        opacity: 1,
        properties: {},
        extensions: {},
      },
    };
    expect(migrateDesignDocument(legacyInstance)).toBeNull();
  });

  it("migrates 1.11 component documents through constraints to current layout semantics", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.11.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.constraints).toBeUndefined();
  });

  it("migrates 1.12 documents without inventing Auto Layout", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.12.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.constraints).toBeUndefined();
  });

  it("migrates 1.13 Auto Layout without inventing Hug or Fill sizing", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.13.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.layoutSizing).toBeUndefined();
    expect(migrated?.nodesById.text_1).not.toHaveProperty(
      "properties.autoLayout.sizing",
    );
  });

  it("migrates 1.14 sizing without inventing Auto Layout wrap", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.14.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1).not.toHaveProperty(
      "properties.autoLayout.wrap",
    );
  });

  it("migrates 1.15 wrap without inventing layout limits", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.15.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.layoutLimits).toBeUndefined();
  });

  it("migrates 1.16 limits without inventing Auto gap", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.16.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.layoutLimits).toBeUndefined();
  });

  it("migrates 1.17 Auto gap documents without inventing absolute children", () => {
    const source = textDocumentFixture();
    source.schemaVersion = "1.17.0" as typeof source.schemaVersion;
    const migrated = migrateDesignDocument(source);
    expect(migrated?.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated?.nodesById.text_1?.layoutPositioning).toBeUndefined();
  });

  it("validates strict linear Auto Layout only on Frame properties", () => {
    const frame = {
      id: "frame_layout",
      name: "Auto Layout",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 320, height: 120 },
      opacity: 1,
      extensions: {},
      kind: "frame",
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
        autoLayout: {
          mode: "horizontal",
          padding: { top: 12, right: 16, bottom: 12, left: 16 },
          gap: 8,
          primaryAlignment: "start",
          counterAlignment: "center",
        },
      },
    };
    expect(Value.Check(DesignNodeSchema, frame)).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            primaryAlignment: "space-between",
          },
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            counterAlignment: "space-between",
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: { ...frame.properties.autoLayout, wrap: true },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            wrap: { mode: "wrap", counterGap: 12 },
          },
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            mode: "vertical",
            wrap: { mode: "wrap", counterGap: 12 },
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            wrap: { mode: "wrap", counterGap: 12, future: true },
          },
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        kind: "rectangle",
        properties: {
          fills: [],
          strokes: [],
          strokeWidth: 0,
          cornerRadius: 0,
          autoLayout: frame.properties.autoLayout,
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            sizing: { horizontal: "hug", vertical: "fixed" },
          },
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...frame,
        properties: {
          ...frame.properties,
          autoLayout: {
            ...frame.properties.autoLayout,
            sizing: { horizontal: "fill", vertical: "fixed" },
          },
        },
      }),
    ).toBe(false);
  });

  it("validates strict child Fixed/Fill sizing and nullable removal", () => {
    const text = textDocumentFixture().nodesById.text_1;
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutSizing: { horizontal: "fill", vertical: "fixed" },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutSizing: { horizontal: "hug", vertical: "fixed" },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "clear_layout_sizing",
        type: "update_properties",
        nodeId: "text_1",
        layoutSizing: null,
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "unknown_layout_sizing",
        type: "update_properties",
        nodeId: "text_1",
        layoutSizing: {
          horizontal: "fixed",
          vertical: "fixed",
          future: true,
        },
      }),
    ).toBe(false);
  });

  it("validates strict layout limits and rejects inverted intervals at public guards", () => {
    const text = textDocumentFixture().nodesById.text_1;
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutLimits: { minWidth: 80, maxWidth: 320, minHeight: 24 },
      }),
    ).toBe(true);
    for (const layoutLimits of [
      {},
      { minWidth: -1 },
      { maxHeight: 1_000_001 },
      { minWidth: 20, future: 40 },
    ]) {
      expect(Value.Check(DesignNodeSchema, { ...text, layoutLimits })).toBe(
        false,
      );
    }
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "set_layout_limits",
        type: "update_properties",
        nodeId: "text_1",
        layoutLimits: { minWidth: 80, maxWidth: 320 },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "clear_layout_limits",
        type: "update_properties",
        nodeId: "text_1",
        layoutLimits: null,
      }),
    ).toBe(true);
    const inverted = {
      commandId: "invert_layout_limits",
      type: "update_properties" as const,
      nodeId: "text_1",
      layoutLimits: { minWidth: 320, maxWidth: 80 },
    };
    expect(Value.Check(DesignOperationSchema, inverted)).toBe(true);
    expect(
      isDesignTransaction({
        transactionId: "transaction_limits",
        documentId: "document_1",
        baseRevision: 0,
        actor,
        commands: [inverted],
      }),
    ).toBe(false);
  });

  it("validates explicit constraints and nullable update removal", () => {
    const text = textDocumentFixture().nodesById.text_1;
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        constraints: { horizontal: "left-right", vertical: "bottom" },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        constraints: { horizontal: "stretch", vertical: "bottom" },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "clear_constraints",
        type: "update_properties",
        nodeId: "text_1",
        constraints: null,
      }),
    ).toBe(true);
  });

  it("validates strict absolute child positioning and nullable removal", () => {
    const text = textDocumentFixture().nodesById.text_1;
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutPositioning: "absolute",
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        layoutPositioning: "flow",
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignOperationSchema, {
        commandId: "clear_positioning",
        type: "update_properties",
        nodeId: text.id,
        layoutPositioning: null,
      }),
    ).toBe(true);
  });

  it("enforces canonical wrapping and overflow for Auto Size text", () => {
    const source = textDocumentFixture();
    const text = Object.values(source.nodesById).find(
      (node) => node.kind === "text",
    );
    if (!text || text.kind !== "text") throw new Error("Missing text");
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: {
          ...text.properties,
          textResize: "auto-width",
          textWrap: "none",
          textOverflow: "visible",
        },
      }),
    ).toBe(true);
    const invalidAutoWidth = {
      ...text,
      properties: {
        ...text.properties,
        textResize: "auto-width" as const,
        textWrap: "word" as const,
        textOverflow: "visible" as const,
      },
    };
    expect(Value.Check(DesignNodeSchema, invalidAutoWidth)).toBe(false);
    const issues = schemaValidationIssues(DesignNodeSchema, invalidAutoWidth);
    expect(issues.some((issue) => issue.path === "/properties/textWrap")).toBe(
      true,
    );
    expect(
      issues.some((issue) => issue.message === "Expected union value"),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...text,
        properties: {
          ...text.properties,
          textResize: "auto-height",
          textWrap: "word",
          textOverflow: "clip",
        },
      }),
    ).toBe(false);
  });
});
