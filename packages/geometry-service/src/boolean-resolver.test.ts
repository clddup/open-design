import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  type BooleanNode,
  type DesignDocument,
  type DesignNode,
  type EllipseNode,
  type PathNode,
  type PolygonNode,
  type RectangleNode,
  type StarNode,
  type VectorNode,
} from "@opendesign/design-contracts";
import { createBooleanGeometryResolver } from "./boolean-resolver.js";
import { cutVectorPath, setVectorPathClosed } from "./vector-edit.js";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "./vector-path.js";

const require = createRequire(import.meta.url);
let provider: VectorGeometryProvider;

beforeAll(async () => {
  const wasmPath = require.resolve("pathkit-wasm/bin/pathkit.wasm");
  provider = await createPathKitGeometryProvider({
    wasmBinary: await readFile(wasmPath),
  });
});

describe("non-destructive Boolean geometry resolver", () => {
  it("resolves ordered subtract geometry without mutating source nodes", () => {
    const base = rectangle("base", "mark", 100, 100);
    const cutout = ellipse("cutout", "mark", 40, 40, [1, 0, 0, 1, 30, 30]);
    const mark = booleanNode("mark", null, "subtract", [base.id, cutout.id]);
    const document = designDocument([mark, base, cutout], [mark.id]);
    const before = structuredClone(document);

    const resolution = createBooleanGeometryResolver(provider).resolve(
      document,
      "page",
    );

    expect(document).toEqual(before);
    expect(resolution.issues).toEqual([]);
    expect(resolution.computedNodeIds).toEqual(["mark"]);
    expect(resolution.resultsByNodeId.get("mark")).toMatchObject({
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      empty: false,
      nodeId: "mark",
      provider: "skia-pathkit",
      providerVersion: "1.0.0",
    });
    expect(
      resolution.resultsByNodeId.get("mark")?.path.match(/M/g)?.length,
    ).toBe(2);
  });

  it("resolves sharp Polygon and Star geometry and invalidates semantic parameters", () => {
    const hexagon = polygon("hexagon", "regular", 100, 100, 6);
    const signal = star("signal", "regular", 100, 100, 5, 0.4);
    signal.transform = [1, 0, 0, 1, 120, 0];
    const regular = booleanNode("regular", null, "union", [
      hexagon.id,
      signal.id,
    ]);
    const document = designDocument([regular, hexagon, signal], [regular.id]);
    const resolver = createBooleanGeometryResolver(provider);
    const first = resolver.resolve(document, "page");

    expect(first.issues).toEqual([]);
    expect(first.resultsByNodeId.get(regular.id)).toMatchObject({
      empty: false,
      nodeId: regular.id,
    });
    expect(first.resultsByNodeId.get(regular.id)?.path.length).toBeGreaterThan(
      20,
    );

    const changed = structuredClone(document);
    changed.revision += 1;
    const changedStar = changed.nodesById.signal;
    if (!changedStar || changedStar.kind !== "star") {
      throw new Error("Missing Star operand");
    }
    changedStar.properties.pointCount = 7;
    changedStar.properties.innerRadius = 0.5;
    expect(resolver.resolve(changed, "page").computedNodeIds).toEqual([
      regular.id,
    ]);

    const rounded = structuredClone(document);
    rounded.revision += 1;
    const roundedPolygon = rounded.nodesById.hexagon;
    if (!roundedPolygon || roundedPolygon.kind !== "polygon") {
      throw new Error("Missing Polygon operand");
    }
    roundedPolygon.properties.cornerRadius = 6;
    const rejected = resolver.resolve(rounded, "page");
    expect(rejected.resultsByNodeId.has(regular.id)).toBe(false);
    expect(rejected.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported-style",
          nodeId: hexagon.id,
        }),
      ]),
    );
  });

  it("keeps authored Path coordinates and applies the node transform exactly once", () => {
    const authored = pathNode(
      "authored",
      "natural",
      "M10 20H30V40H10Z",
      [1, 0, 0, 1, 5, 7],
      { width: 400, height: 300 },
    );
    const hidden = rectangle("hidden", "natural", 10, 10);
    hidden.visible = false;
    const group = booleanNode("natural", null, "union", [
      authored.id,
      hidden.id,
    ]);
    const resolution = createBooleanGeometryResolver(provider).resolve(
      designDocument([group, authored, hidden], [group.id]),
      "page",
    );

    expect(resolution.resultsByNodeId.get(group.id)?.bounds).toEqual({
      x: 15,
      y: 27,
      width: 20,
      height: 20,
    });
  });

  it("resolves editable vector networks and invalidates changed vertex geometry", () => {
    const editable = vectorNode("editable", "network_boolean");
    const hidden = rectangle("hidden_network", "network_boolean", 10, 10);
    hidden.visible = false;
    const group = booleanNode("network_boolean", null, "union", [
      editable.id,
      hidden.id,
    ]);
    const document = designDocument([group, editable, hidden], [group.id]);
    const resolver = createBooleanGeometryResolver(provider);
    const first = resolver.resolve(document, "page");

    expect(first.issues).toEqual([]);
    expect(first.resultsByNodeId.get(group.id)?.bounds).toEqual({
      x: 12,
      y: 16,
      width: 100,
      height: 100,
    });

    const changed = structuredClone(document);
    changed.revision += 1;
    const changedVector = changed.nodesById.editable;
    if (
      !changedVector ||
      changedVector.kind !== "vector" ||
      !("network" in changedVector.properties)
    ) {
      throw new Error("Missing editable vector operand");
    }
    changedVector.properties.network.vertices[2]!.y = 120;
    expect(resolver.resolve(changed, "page").computedNodeIds).toEqual([
      group.id,
    ]);
  });

  it("does not invent fill geometry for an editable open contour", () => {
    const editable = vectorNode("editable_open", "network_boolean_open");
    if (!("network" in editable.properties)) {
      throw new Error("Missing editable vector network fixture");
    }
    const opened = setVectorPathClosed(editable.properties.network, false);
    if (!opened.ok) throw new Error(opened.message);
    editable.properties.network = opened.network;
    const hidden = rectangle(
      "hidden_network_open",
      "network_boolean_open",
      10,
      10,
    );
    hidden.visible = false;
    const group = booleanNode("network_boolean_open", null, "union", [
      editable.id,
      hidden.id,
    ]);
    const result = createBooleanGeometryResolver(provider).resolve(
      designDocument([group, editable, hidden], [group.id]),
      "page",
    );

    expect(result.issues).toEqual([]);
    expect(result.resultsByNodeId.get(group.id)).toMatchObject({
      bounds: null,
      empty: true,
      path: "",
    });

    const cut = cutVectorPath(opened.network, opened.network.paths[0]!.id, {
      kind: "segment",
      segmentId: opened.network.paths[0]!.segments[0]!.segmentId,
      t: 0.5,
    });
    if (!cut.ok) throw new Error(cut.message);
    editable.properties.network = cut.network;
    const cutResult = createBooleanGeometryResolver(provider).resolve(
      designDocument([group, editable, hidden], [group.id]),
      "page",
    );
    expect(cutResult.issues).toEqual([]);
    expect(cutResult.resultsByNodeId.get(group.id)).toMatchObject({
      bounds: null,
      empty: true,
      path: "",
    });
  });

  it("uses fill plus aligned stroke geometry and supports nested Booleans", () => {
    const left = rectangle("left", "inner", 40, 40);
    const right = rectangle("right", "inner", 40, 40, [1, 0, 0, 1, 20, 0]);
    const inner = booleanNode("inner", "outer", "union", [left.id, right.id]);
    inner.properties.strokes = [solid("#ffffff")];
    inner.properties.strokeWidth = 10;
    inner.properties.strokeAlign = "outside";
    const far = rectangle("far", "outer", 10, 10, [1, 0, 0, 1, 100, 0]);
    const outer = booleanNode("outer", null, "union", [inner.id, far.id]);
    const document = designDocument(
      [outer, inner, left, right, far],
      [outer.id],
    );
    const resolver = createBooleanGeometryResolver(provider);
    const resolution = resolver.resolve(document, "page");

    expect(resolution.issues).toEqual([]);
    expect(resolution.resultsByNodeId.get("inner")?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 40,
    });
    expect(resolution.resultsByNodeId.get("outer")?.bounds).toEqual({
      x: -10,
      y: -10,
      width: 120,
      height: 60,
    });

    const changedFillRule = structuredClone(document);
    changedFillRule.revision += 1;
    const changedInner = changedFillRule.nodesById.inner;
    if (!changedInner || changedInner.kind !== "boolean") {
      throw new Error("Missing inner Boolean");
    }
    changedInner.properties.fillRule = "evenodd";
    const fillRuleResolution = resolver.resolve(changedFillRule, "page");
    expect(fillRuleResolution.computedNodeIds).toEqual(["outer"]);
    expect(fillRuleResolution.reusedNodeIds).toEqual(["inner"]);
  });

  it("returns an honest empty intersect and rejects lossy dash approximations", () => {
    const first = rectangle("first", "empty", 20, 20);
    const second = rectangle("second", "empty", 20, 20, [1, 0, 0, 1, 40, 40]);
    const empty = booleanNode("empty", null, "intersect", [
      first.id,
      second.id,
    ]);
    const emptyResolution = createBooleanGeometryResolver(provider).resolve(
      designDocument([empty, first, second], [empty.id]),
      "page",
    );
    expect(emptyResolution.resultsByNodeId.get("empty")).toMatchObject({
      bounds: null,
      empty: true,
      path: "",
    });

    const dashed = structuredClone(first);
    dashed.id = "dashed";
    dashed.parentId = "unsupported";
    dashed.properties.strokes = [solid("#000000")];
    dashed.properties.strokeWidth = 4;
    dashed.properties.dashPattern = [2, 3, 4];
    const companion = rectangle("companion", "unsupported", 10, 10);
    const unsupported = booleanNode("unsupported", null, "union", [
      dashed.id,
      companion.id,
    ]);
    const unsupportedResolution = createBooleanGeometryResolver(
      provider,
    ).resolve(
      designDocument([unsupported, dashed, companion], [unsupported.id]),
      "page",
    );
    expect(unsupportedResolution.resultsByNodeId.has("unsupported")).toBe(
      false,
    );
    expect(unsupportedResolution.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported-style",
          nodeId: "dashed",
        }),
      ]),
    );

    const open = pathNode("open", "open_group", "M0 0H40", [1, 0, 0, 1, 0, 0], {
      width: 40,
      height: 0,
    });
    open.properties.fills = [];
    open.properties.strokes = [solid("#000000")];
    open.properties.strokeWidth = 4;
    open.properties.strokeAlign = "inside";
    const openCompanion = rectangle("open_companion", "open_group", 10, 10);
    const openGroup = booleanNode("open_group", null, "union", [
      open.id,
      openCompanion.id,
    ]);
    const openResolution = createBooleanGeometryResolver(provider).resolve(
      designDocument([openGroup, open, openCompanion], [openGroup.id]),
      "page",
    );
    expect(openResolution.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported-style",
          nodeId: "open",
        }),
      ]),
    );
  });

  it("reuses unrelated and color-only geometry while invalidating exact ancestors", () => {
    const a1 = rectangle("a1", "a", 20, 20);
    const a2 = rectangle("a2", "a", 20, 20, [1, 0, 0, 1, 10, 0]);
    const a = booleanNode("a", null, "union", [a1.id, a2.id]);
    const b1 = rectangle("b1", "b", 20, 20);
    const b2 = rectangle("b2", "b", 20, 20, [1, 0, 0, 1, 10, 0]);
    const b = booleanNode("b", null, "union", [b1.id, b2.id]);
    const resolver = createBooleanGeometryResolver(provider);
    const first = designDocument([a, a1, a2, b, b1, b2], [a.id, b.id]);

    expect(resolver.resolve(first, "page").computedNodeIds).toEqual(["a", "b"]);

    const recolored = structuredClone(first);
    recolored.revision += 1;
    const recoloredA1 = recolored.nodesById.a1;
    if (!recoloredA1 || recoloredA1.kind !== "rectangle") {
      throw new Error("Missing a1");
    }
    recoloredA1.properties.fills = [solid("#ff00ff")];
    const colorResolution = resolver.resolve(recolored, "page");
    expect(colorResolution.computedNodeIds).toEqual([]);
    expect(colorResolution.reusedNodeIds).toEqual(["a", "b"]);

    const moved = structuredClone(recolored);
    moved.revision += 1;
    const movedA1 = moved.nodesById.a1;
    if (!movedA1) throw new Error("Missing a1");
    movedA1.transform = [1, 0, 0, 1, 5, 0];
    const movedResolution = resolver.resolve(moved, "page");
    expect(movedResolution.computedNodeIds).toEqual(["a"]);
    expect(movedResolution.reusedNodeIds).toEqual(["b"]);
  });
});

function designDocument(
  nodes: readonly DesignNode[],
  rootNodeIds: readonly string[],
): DesignDocument {
  return {
    assetsById: {},
    componentsById: {},
    documentId: "boolean_resolver_fixture",
    extensions: {},
    format: DESIGN_FORMAT,
    interactionsById: {},
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    libraryStylesById: {},
    nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    pageOrder: ["page"],
    pagesById: {
      page: {
        id: "page",
        name: "Boolean",
        rootNodeIds: [...rootNodeIds],
        extensions: {},
      },
    },
    revision: 0,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
    variantSetsById: {},
  };
}

function booleanNode(
  id: string,
  parentId: string | null,
  operation: BooleanNode["properties"]["operation"],
  childIds: readonly string[],
): BooleanNode {
  return {
    childIds: [...childIds],
    extensions: {},
    id,
    kind: "boolean",
    locked: false,
    name: id,
    exportSettings: [],
    opacity: 1,
    parentId,
    properties: {
      fills: [solid("#111827")],
      operation,
      strokes: [],
      strokeWidth: 0,
    },
    size: { width: 100, height: 100 },
    transform: [1, 0, 0, 1, 0, 0],
    visible: true,
  };
}

function rectangle(
  id: string,
  parentId: string | null,
  width: number,
  height: number,
  transform: RectangleNode["transform"] = [1, 0, 0, 1, 0, 0],
): RectangleNode {
  return {
    childIds: [],
    extensions: {},
    id,
    kind: "rectangle",
    locked: false,
    name: id,
    exportSettings: [],
    opacity: 1,
    parentId,
    properties: {
      cornerRadius: 0,
      fills: [solid("#111827")],
      strokes: [],
      strokeWidth: 0,
    },
    size: { width, height },
    transform,
    visible: true,
  };
}

function ellipse(
  id: string,
  parentId: string | null,
  width: number,
  height: number,
  transform: EllipseNode["transform"] = [1, 0, 0, 1, 0, 0],
): EllipseNode {
  return {
    childIds: [],
    extensions: {},
    id,
    kind: "ellipse",
    locked: false,
    name: id,
    exportSettings: [],
    opacity: 1,
    parentId,
    properties: {
      fills: [solid("#111827")],
      strokes: [],
      strokeWidth: 0,
    },
    size: { width, height },
    transform,
    visible: true,
  };
}

function polygon(
  id: string,
  parentId: string | null,
  width: number,
  height: number,
  pointCount: number,
): PolygonNode {
  return {
    childIds: [],
    extensions: {},
    id,
    kind: "polygon",
    locked: false,
    name: id,
    exportSettings: [],
    opacity: 1,
    parentId,
    properties: {
      cornerRadius: 0,
      fills: [solid("#111827")],
      pointCount,
      strokes: [],
      strokeWidth: 0,
    },
    size: { width, height },
    transform: [1, 0, 0, 1, 0, 0],
    visible: true,
  };
}

function star(
  id: string,
  parentId: string | null,
  width: number,
  height: number,
  pointCount: number,
  innerRadius: number,
): StarNode {
  return {
    childIds: [],
    extensions: {},
    id,
    kind: "star",
    locked: false,
    name: id,
    exportSettings: [],
    opacity: 1,
    parentId,
    properties: {
      cornerRadius: 0,
      fills: [solid("#111827")],
      innerRadius,
      pointCount,
      strokes: [],
      strokeWidth: 0,
    },
    size: { width, height },
    transform: [1, 0, 0, 1, 0, 0],
    visible: true,
  };
}

function pathNode(
  id: string,
  parentId: string | null,
  path: string,
  transform: PathNode["transform"],
  size: PathNode["size"],
): PathNode {
  return {
    childIds: [],
    extensions: {},
    id,
    kind: "path",
    locked: false,
    name: id,
    exportSettings: [],
    opacity: 1,
    parentId,
    properties: {
      fillRule: "nonzero",
      fills: [solid("#111827")],
      path,
      strokes: [],
      strokeWidth: 0,
    },
    size,
    transform,
    visible: true,
  };
}

function vectorNode(id: string, parentId: string | null): VectorNode {
  return {
    childIds: [],
    extensions: {},
    id,
    kind: "vector",
    locked: false,
    name: id,
    exportSettings: [],
    opacity: 1,
    parentId,
    properties: {
      network: {
        vertices: [
          { id: "vertex_a", x: 0, y: 0 },
          { id: "vertex_b", x: 100, y: 0 },
          { id: "vertex_c", x: 50, y: 100 },
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
            id: "path_1",
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
            id: "region_1",
            windingRule: "nonzero",
            loops: [{ pathId: "path_1", reversed: false }],
          },
        ],
      },
      fills: [solid("#111827")],
      strokes: [],
      strokeWidth: 0,
    },
    size: { width: 100, height: 100 },
    transform: [1, 0, 0, 1, 12, 16],
    visible: true,
  };
}

function solid(color: string) {
  return { type: "solid" as const, color, opacity: 1 };
}
