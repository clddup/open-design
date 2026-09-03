import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  DesignNodeSchema,
  DesignDocumentContract,
  normalizeLineEndpoints,
  resolveRegularPolygonPoints,
  resolveLineEndpointPoint,
  resolveStarPoints,
  type DesignDocument,
  type DesignNode,
} from "./index.js";
import { textDocumentFixture } from "./index-test-fixtures.js";

describe("vector design contracts", () => {
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
      exportSettings: [],
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
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "vector",
      properties: {
        network: {
          vertices: [
            {
              id: "vertex_a",
              x: 0,
              y: 0,
              handleMode: "corner",
              strokeCap: "round",
              strokeJoin: "bevel",
              cornerRadius: 8.5,
            },
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
              fills: [{ type: "solid", color: "#22c55e", opacity: 1 }],
              fillStyleId: "brand-accent",
            },
          ],
        },
        fillRule: "nonzero",
        cornerRadius: 4,
        cornerSmoothing: 0.6,
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokeWidth: 2,
      },
    };

    expect(Value.Check(DesignNodeSchema, vectorNode)).toBe(true);
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
                cornerRadius: -1,
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
        properties: { ...vectorNode.properties, cornerRadius: -1 },
      }),
    ).toBe(false);
    expect(
      Value.Check(DesignNodeSchema, {
        ...vectorNode,
        properties: { ...vectorNode.properties, cornerSmoothing: 1.01 },
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
                strokeCap: "arrow-equilateral",
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
            regions: [
              {
                ...vectorNode.properties.network.regions[0],
                fillStyleId: "",
              },
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
            regions: [
              {
                ...vectorNode.properties.network.regions[0],
                fills: [{ type: "solid", color: "green", opacity: 2 }],
              },
            ],
          },
        },
      }),
    ).toBe(false);
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
        properties: {
          ...vectorNode.properties,
          variableWidthStrokeProperties: {
            widthProfile: "CUSTOM",
            variableWidthPoints: [
              { position: 0, width: 0.25 },
              { position: 0.5, width: 1 },
              { position: 1, width: 0.25 },
            ],
          },
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(DesignNodeSchema, {
        ...vectorNode,
        properties: {
          ...vectorNode.properties,
          variableWidthStrokeProperties: {
            widthProfile: "CUSTOM",
            variableWidthPoints: [{ position: 0.5, width: -1 }],
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

    const document = textDocumentFixture() as unknown as DesignDocument;
    document.nodesById.vector_mark = vectorNode as unknown as DesignNode;
    document.pagesById.page_1!.rootNodeIds.push("vector_mark");
    document.stylesById["brand-accent"] = {
      id: "brand-accent",
      key: "brand-accent-key",
      name: "Brand/Accent",
      description: "",
      hiddenFromPublishing: false,
      styleType: "PAINT",
      paints: [{ type: "solid", color: "#22c55e", opacity: 1 }],
      extensions: {},
    };
    document.styleOrderByType.PAINT.push("brand-accent");
    expect(DesignDocumentContract.parse(document)).toMatchObject({ ok: true });

    document.nodesById.vector_mark = {
      ...vectorNode,
      properties: {
        ...vectorNode.properties,
        dashPattern: [8, 4],
        variableWidthStrokeProperties: { widthProfile: "EYE" },
      },
    } as unknown as DesignNode;
    expect(DesignDocumentContract.parse(document)).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design.document_variable_width_dashed_stroke_unsupported",
          path: "/nodesById/vector_mark/properties/dashPattern",
        }),
      ],
    });

    document.nodesById.vector_mark = vectorNode as unknown as DesignNode;

    delete document.stylesById["brand-accent"];
    document.styleOrderByType.PAINT = [];
    expect(DesignDocumentContract.parse(document)).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design.document_vector_region_fill_style_reference_invalid",
          path: "/nodesById/vector_mark/properties/network/regions/0/fillStyleId",
        }),
      ],
    });
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
      exportSettings: [],
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
      exportSettings: [],
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
      cornerSmoothing: 0.6,
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
        ...star,
        properties: { ...star.properties, cornerSmoothing: 1.01 },
      }),
    ).toBe(false);
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
      exportSettings: [],
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
});
