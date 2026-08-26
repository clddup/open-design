import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  type DesignDocument,
  type DesignNode,
} from "@opendesign/design-contracts";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import { describe, expect, it } from "vitest";
import { exportSvgNodeRoots } from "./svg-export-nodes.js";
import { importSvgNodes } from "./svg-import-nodes.js";
import { parseSvgImportSource } from "./svg-parse.js";
import {
  createSvgExportDocument,
  serializeSvgExportDocument,
} from "./svg-serialize.js";

describe("SVG node family owners", () => {
  it("exports selected roots and owns node/container traversal", () => {
    const node = rectangle("hero", null, [1, 0, 0, 1, 20, 30]);
    const source = documentFromNodes([node], [node.id]);
    const value = createSvgExportDocument({
      version: 1,
      viewport: { x: 0, y: 0, width: 200, height: 120 },
    });
    const issues: Parameters<typeof exportSvgNodeRoots>[0]["issues"] = [];

    const exportedNodeIds = exportSvgNodeRoots({
      ...value,
      issues,
      request: { document: source, includeLayerIds: true },
      rootNodeIds: [node.id],
    });
    const serialized = serializeSvgExportDocument(value);

    expect(exportedNodeIds).toEqual([node.id]);
    expect(issues).toEqual([]);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(serialized.svg).toContain('data-opendesign-id="hero"');
    expect(serialized.svg).toContain('transform="matrix(1 0 0 1 20 30)"');
  });

  it("imports parsed roots and owns stable node/container assembly", () => {
    const parsed = parseSvgImportSource({
      idPrefix: "landing",
      svg: '<svg viewBox="10 20 200 120"><g id="card" transform="translate(30 40)"><rect width="80" height="40" fill="#2563eb"/></g></svg>',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const imported = importSvgNodes({
      geometry: {} as VectorGeometryProvider,
      idPrefix: "landing",
      name: "Landing illustration",
      root: parsed.value.root,
      sourceViewport: parsed.value.sourceViewport,
      version: 1,
    });

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    expect(imported.nodes[0]).toMatchObject({
      id: imported.rootNodeId,
      kind: "group",
      name: "Landing illustration",
      size: { width: 200, height: 120 },
    });
    expect(imported.nodes.map((node) => node.kind)).toEqual([
      "group",
      "rectangle",
      "group",
    ]);
  });
});

function rectangle(
  id: string,
  parentId: string | null,
  transform: [number, number, number, number, number, number],
): Extract<DesignNode, { kind: "rectangle" }> {
  return {
    id,
    kind: "rectangle",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform,
    size: { width: 80, height: 40 },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [{ type: "solid", color: "#2563eb", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 8,
    },
    extensions: {},
  };
}

function documentFromNodes(
  nodes: readonly DesignNode[],
  rootNodeIds: readonly string[],
): DesignDocument {
  return {
    format: DESIGN_FORMAT,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "svg_node_owner",
    revision: 0,
    pageOrder: ["page"],
    pagesById: {
      page: {
        id: "page",
        name: "SVG",
        rootNodeIds: [...rootNodeIds],
        extensions: {},
      },
    },
    nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    componentsById: {},
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
  };
}
