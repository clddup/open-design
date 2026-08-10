import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  isDesignDocument,
  type DesignDocument,
  type DesignNode,
  type Paint,
} from "@opendesign/design-contracts";
import { createBooleanGeometryResolver } from "@opendesign/geometry-service/boolean-resolver";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "@opendesign/geometry-service/vector-path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  exportSvg,
  importSvg,
  isSvgInterchangeIssue,
  resolvedBooleanPathsForSvg,
} from "./svg.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
let geometry: VectorGeometryProvider;

beforeAll(async () => {
  geometry = await createPathKitGeometryProvider({
    wasmBinary: readFileSync(require.resolve("pathkit-wasm/bin/pathkit.wasm")),
  });
});

describe("versioned SVG interchange", () => {
  it("validates structured fidelity issues at process boundaries", () => {
    const issue = {
      code: "effect-omitted",
      message: "SVG filters are outside the current editable subset",
      severity: "warning",
      nodeId: "hero_glow",
    };

    expect(isSvgInterchangeIssue(issue)).toBe(true);
    expect(isSvgInterchangeIssue({ ...issue, code: "made-up" })).toBe(false);
    expect(isSvgInterchangeIssue({ ...issue, filePath: "/tmp/a.svg" })).toBe(
      false,
    );
  });

  it("exports the OD-BRAND Boolean master as one standard path and reimports editable geometry", () => {
    const document = readBrandFixture();
    const resolution = createBooleanGeometryResolver(geometry).resolve(
      document,
      "page_brand_01",
    );
    expect(resolution.issues).toEqual([]);
    const result = resolution.resultsByNodeId.get("brand_mark");
    expect(result).toBeDefined();

    const exported = exportSvg({
      document,
      rootNodeIds: ["brand_mark"],
      viewport: { x: 0, y: 0, width: 280, height: 280 },
      includeLayerIds: true,
      resolvedBooleanPaths: resolvedBooleanPathsForSvg(resolution),
      title: "OD-BRAND-01 Boolean master",
    });

    expect(exported.ok).toBe(true);
    if (!exported.ok || !result) return;
    expect(exported.exportedNodeIds).toEqual(["brand_mark"]);
    expect(exported.issues.map((issue) => issue.code)).toEqual([
      "effect-omitted",
      "angular-gradient-flattened",
      "stroke-alignment-flattened",
      "boolean-flattened",
    ]);
    expect(exported.svg).toContain('data-opendesign-source-kind="boolean"');
    expect(exported.svg).toContain(
      'data-opendesign-geometry-provider="skia-pathkit"',
    );
    expect(exported.svg).not.toContain("brand_mark_outer");
    expect(exported.svg).not.toContain("brand_mark_inner");
    expect(exported.svg).not.toContain("brand_mark_slot");

    const imported = importSvg(
      { svg: exported.svg, idPrefix: "brand_roundtrip" },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    expect(imported.nodes).toHaveLength(2);
    const importedPath = imported.nodes.find(
      (node) => node.kind === "vector" || node.kind === "path",
    );
    expect(importedPath).toMatchObject({
      kind: "vector",
      parentId: imported.rootNodeId,
      properties: {
        fills: [{ type: "solid", color: "#68efff", opacity: 1 }],
      },
    });
    if (!importedPath || !isPathLike(importedPath)) return;
    const reprojected = geometry.transform(
      {
        path: importedPath.properties.path,
        fillRule: importedPath.properties.fillRule ?? "nonzero",
      },
      importedPath.transform,
    );
    expect(reprojected.ok).toBe(true);
    if (!reprojected.ok) return;
    const expected = geometry.normalize({
      path: result.path,
      fillRule: result.fillRule,
    });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(reprojected).toMatchObject({
      path: expected.path,
      bounds: expected.bounds,
      fillRule: expected.fillRule,
    });
    expect(asDocument(imported.nodes, imported.rootNodeId)).toSatisfy(
      isDesignDocument,
    );
  });

  it("round-trips Path, Vector, Rectangle, Ellipse, gradients, hierarchy, and transforms deterministically", () => {
    const document = shapeDocument();
    const request = {
      document,
      rootNodeIds: ["shape_group"],
      viewport: { x: 0, y: 0, width: 240, height: 200 },
      includeLayerIds: true,
      title: "Structured vector exchange",
    } as const;
    const first = exportSvg(request);
    const second = exportSvg(request);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.issues).toEqual([]);
    expect(first.svg).toContain("<linearGradient");
    expect(first.svg).toContain('data-opendesign-kind="vector"');

    const imported = importSvg(
      {
        svg: first.svg,
        idPrefix: "structured_svg",
        name: "Structured SVG",
      },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    expect(imported.sourceViewport).toEqual({
      x: 0,
      y: 0,
      width: 240,
      height: 200,
    });
    expect(imported.nodes.map((node) => node.kind).sort()).toEqual([
      "ellipse",
      "group",
      "group",
      "path",
      "rectangle",
      "vector",
    ]);
    const importedRectangle = findImportedSource(
      imported.nodes,
      "rect_gradient",
    );
    expect(importedRectangle).toMatchObject({
      kind: "rectangle",
      properties: {
        cornerRadius: 12,
        fills: [
          {
            type: "linear-gradient",
            rotation: 24,
            from: { x: 0, y: 0.5 },
            to: { x: 1, y: 0.5 },
            stops: [
              { offset: 0, color: "#44e5ff", opacity: 1 },
              { offset: 1, color: "#725cff", opacity: 0.8 },
            ],
          },
        ],
      },
    });
    expect(findImportedSource(imported.nodes, "path_curve")?.kind).toBe("path");
    expect(findImportedSource(imported.nodes, "vector_mark")?.kind).toBe(
      "vector",
    );
    expect(asDocument(imported.nodes, imported.rootNodeId)).toSatisfy(
      isDesignDocument,
    );
  });

  it("parses standard SVG transform lists and normalizes viewBox coordinates without flattening hierarchy", () => {
    const imported = importSvg(
      {
        idPrefix: "external_svg",
        svg: `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 100 80" fill="#123456">
            <g id="rotated" transform="translate(12 14) rotate(30)">
              <path id="curve" d="M 10 10 C 40 0 60 50 80 30 Z"/>
            </g>
          </svg>
        `,
      },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    const root = imported.nodes[0];
    const group = findImportedSource(imported.nodes, "rotated");
    const path = findImportedSource(imported.nodes, "curve");
    expect(root).toMatchObject({
      kind: "group",
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 80 },
    });
    expect(group?.kind).toBe("group");
    expect(group?.transform.every(Number.isFinite)).toBe(true);
    expect(group?.transform).not.toEqual([1, 0, 0, 1, 0, 0]);
    expect(group?.size.width).toBeGreaterThan(0);
    expect(group?.size.height).toBeGreaterThan(0);
    expect(path).toMatchObject({
      kind: "vector",
      parentId: group?.id,
      properties: {
        fills: [{ type: "solid", color: "#123456", opacity: 1 }],
      },
    });
    expect(path?.transform[4]).toBeCloseTo(0, 8);
    expect(path?.transform[5]).toBeCloseTo(0, 8);
    expect(asDocument(imported.nodes, imported.rootNodeId)).toSatisfy(
      isDesignDocument,
    );
  });

  it("retains valid empty path layers as invisible editable vectors with an explicit warning", () => {
    const imported = importSvg(
      {
        idPrefix: "empty_svg",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path id="empty" d="M 0 0" fill="#000000"/></svg>`,
      },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toMatchObject([
      { code: "empty-geometry", severity: "warning" },
    ]);
    expect(findImportedSource(imported.nodes, "empty")).toMatchObject({
      kind: "vector",
      visible: false,
      size: { width: 0, height: 0 },
      properties: { path: "M 0 0" },
    });
    expect(
      isDesignDocument(asDocument(imported.nodes, imported.rootNodeId)),
    ).toBe(true);
  });

  it("rejects unsafe XML, executable elements, stylesheets, external paints, and unresolved Booleans", () => {
    expect(
      importSvg(
        {
          idPrefix: "unsafe_svg",
          svg: `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10V10Z"/></svg>`,
        },
        geometry,
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-xml" }],
    });
    const script = importSvg(
      {
        idPrefix: "script_svg",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><script>alert(1)</script></defs><path d="M0 0H10V10Z"/></svg>`,
      },
      geometry,
    );
    expect(script.ok).toBe(false);
    expect(
      script.issues.some((issue) => issue.code === "unsupported-element"),
    ).toBe(true);
    const stylesheet = importSvg(
      {
        idPrefix: "style_svg",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>path{fill:red}</style><path d="M0 0H10V10Z"/></svg>`,
      },
      geometry,
    );
    expect(stylesheet.ok).toBe(false);
    expect(
      stylesheet.issues.some((issue) => issue.code === "unsupported-css"),
    ).toBe(true);
    const external = importSvg(
      {
        idPrefix: "external_svg",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10V10Z" fill="url(https://example.test/p.svg#paint)"/></svg>`,
      },
      geometry,
    );
    expect(external.ok).toBe(false);
    expect(
      external.issues.some((issue) => issue.code === "external-reference"),
    ).toBe(true);

    const document = readBrandFixture();
    const unresolved = exportSvg({
      document,
      rootNodeIds: ["brand_mark"],
      viewport: { x: 0, y: 0, width: 280, height: 280 },
    });
    expect(unresolved.ok).toBe(false);
    expect(
      unresolved.issues.some(
        (issue) => issue.code === "missing-boolean-geometry",
      ),
    ).toBe(true);

    const nested = importSvg(
      {
        idPrefix: "nested_svg",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${"<g>".repeat(65)}<path d="M0 0H10V10Z"/>${"</g>".repeat(65)}</svg>`,
      },
      geometry,
    );
    expect(nested.ok).toBe(false);
    expect(nested.issues.some((issue) => issue.code === "depth-limit")).toBe(
      true,
    );
    const oversized = importSvg(
      { idPrefix: "oversized_svg", svg: " ".repeat(2_000_001) },
      geometry,
    );
    expect(oversized).toMatchObject({
      ok: false,
      issues: [{ code: "size-limit" }],
    });
  });
});

function readBrandFixture(): DesignDocument {
  const value: unknown = JSON.parse(
    readFileSync(
      join(
        repositoryRoot,
        "fixtures/professional/OD-BRAND-01/document.opendesign",
      ),
      "utf8",
    ),
  );
  if (!isDesignDocument(value)) {
    throw new Error("OD-BRAND-01 fixture is invalid");
  }
  return value;
}

function isPathLike(
  node: DesignNode,
): node is Extract<DesignNode, { kind: "path" | "vector" }> {
  return node.kind === "path" || node.kind === "vector";
}

function findImportedSource(
  nodes: readonly DesignNode[],
  sourceId: string,
): DesignNode | undefined {
  return nodes.find((node) => {
    const imported = node.extensions.svgImport;
    return (
      typeof imported === "object" &&
      imported !== null &&
      !Array.isArray(imported) &&
      imported.sourceId === sourceId
    );
  });
}

function asDocument(
  nodes: readonly DesignNode[],
  rootNodeId: string,
): DesignDocument {
  return {
    format: DESIGN_FORMAT,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "svg_import_test",
    revision: 0,
    pageOrder: ["page"],
    pagesById: {
      page: {
        id: "page",
        name: "SVG",
        rootNodeIds: [rootNodeId],
        extensions: {},
      },
    },
    nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    componentsById: {},
    variantSetsById: {},
    tokenCollectionsById: {},
    tokensById: {},
    interactionsById: {},
    assetsById: {},
    extensions: {},
  };
}

function shapeDocument(): DesignDocument {
  const gradient: Paint = {
    type: "linear-gradient",
    opacity: 1,
    stops: [
      { offset: 0, color: "#44e5ff", opacity: 1 },
      { offset: 1, color: "#725cff", opacity: 0.8 },
    ],
    rotation: 24,
  };
  const nodes: DesignNode[] = [
    {
      id: "shape_group",
      kind: "group",
      name: "Shape group",
      parentId: null,
      childIds: ["rect_gradient", "ellipse_solid", "path_curve", "vector_mark"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 10, 20],
      size: { width: 200, height: 150 },
      opacity: 1,
      properties: {},
      extensions: {},
    },
    {
      id: "rect_gradient",
      kind: "rectangle",
      name: "Gradient rectangle",
      parentId: "shape_group",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 4, 8],
      size: { width: 90, height: 60 },
      opacity: 1,
      properties: {
        fills: [gradient],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 12,
      },
      extensions: {},
    },
    {
      id: "ellipse_solid",
      kind: "ellipse",
      name: "Solid ellipse",
      parentId: "shape_group",
      childIds: [],
      visible: true,
      locked: false,
      transform: [0.96, 0.18, -0.18, 0.96, 112, 12],
      size: { width: 58, height: 58 },
      opacity: 0.9,
      properties: {
        fills: [{ type: "solid", color: "#ff5b91", opacity: 0.8 }],
        strokes: [{ type: "solid", color: "#ffffff", opacity: 0.6 }],
        strokeWidth: 2,
        strokeAlign: "center",
        strokeCap: "none",
        strokeJoin: "round",
      },
      extensions: {},
    },
    {
      id: "path_curve",
      kind: "path",
      name: "Curve path",
      parentId: "shape_group",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 12, 96],
      size: { width: 84, height: 36 },
      opacity: 1,
      properties: {
        path: "M0 28 C18 -4 58 2 84 30 L72 36 C48 16 22 12 8 34 Z",
        fillRule: "evenodd",
        fills: [{ type: "solid", color: "#f4f8ff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    },
    {
      id: "vector_mark",
      kind: "vector",
      name: "Vector mark",
      parentId: "shape_group",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 116, 100],
      size: { width: 62, height: 32 },
      opacity: 1,
      properties: {
        path: "M0 16 C18 0 42 0 62 16 C42 32 18 32 0 16 Z",
        fillRule: "nonzero",
        fills: [],
        strokes: [{ type: "solid", color: "#64eaff", opacity: 1 }],
        strokeWidth: 3,
        strokeAlign: "center",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [8, 4],
      },
      extensions: {},
    },
  ];
  return {
    format: DESIGN_FORMAT,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "svg_shape_document",
    revision: 0,
    pageOrder: ["page"],
    pagesById: {
      page: {
        id: "page",
        name: "SVG shapes",
        rootNodeIds: ["shape_group"],
        extensions: {},
      },
    },
    nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    componentsById: {},
    variantSetsById: {},
    tokenCollectionsById: {},
    tokensById: {},
    interactionsById: {},
    assetsById: {},
    extensions: {},
  };
}
