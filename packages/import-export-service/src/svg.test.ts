import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  isDesignDocument,
  type DesignDocument,
  type DesignNode,
  type Paint,
} from "@opendesign/design-contracts";
import { createBooleanGeometryResolver } from "@opendesign/geometry-service/boolean-resolver";
import { resolvePathPropertiesData } from "@opendesign/geometry-service/editable-vector";
import {
  cutVectorPath,
  setVectorPathClosed,
} from "@opendesign/geometry-service/vector-edit";
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
    expect(
      isSvgInterchangeIssue({ ...issue, code: "unsupported-filter" }),
    ).toBe(true);
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
    const importedPathData = resolvePathPropertiesData(importedPath.properties);
    expect(importedPathData).not.toBeNull();
    if (importedPathData === null) return;
    const reprojected = geometry.transform(
      {
        path: importedPathData,
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

  it("exports editable Text as standard text/tspan content and round-trips controlled box semantics", () => {
    const text: DesignNode = {
      id: "logo_wordmark_restored",
      kind: "text",
      name: "OpenDesign wordmark",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 24, 18],
      size: { width: 240, height: 80 },
      opacity: 0.92,
      properties: {
        content: "OpenDesign\n未来 & <设计>",
        fontFamily: "Inter",
        fontSize: 24,
        fontWeight: 650,
        lineHeight: 28,
        letterSpacing: -0.4,
        textAlignHorizontal: "center",
        textAlignVertical: "center",
        textResize: "fixed",
        textWrap: "word",
        textOverflow: "ellipsis",
        fills: [{ type: "solid", color: "#153eaa", opacity: 1 }],
        strokes: [{ type: "solid", color: "#ffffff", opacity: 0.5 }],
        strokeWidth: 1,
        strokeAlign: "center",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [],
      },
      extensions: {},
    };
    const document = documentFromNodes("svg_text_document", [text], [text.id]);

    const first = exportSvg({
      document,
      rootNodeIds: [text.id],
      viewport: { x: 0, y: 0, width: 300, height: 120 },
      includeLayerIds: true,
    });
    const second = exportSvg({
      document,
      rootNodeIds: [text.id],
      viewport: { x: 0, y: 0, width: 300, height: 120 },
      includeLayerIds: true,
    });

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(
      first.issues.map(({ code, severity }) => ({ code, severity })),
    ).toEqual([
      { code: "text-font-not-embedded", severity: "warning" },
      { code: "text-layout-fidelity", severity: "warning" },
    ]);
    expect(first.svg).toContain("<text");
    expect(first.svg).toContain('data-opendesign-text-version="3"');
    expect(first.svg).toContain('font-family="Inter"');
    expect(first.svg).toContain('font-size="24"');
    expect(first.svg).toContain('font-weight="650"');
    expect(first.svg).toContain('letter-spacing="-0.4"');
    expect(first.svg).toContain('text-anchor="middle"');
    expect(first.svg).toContain('dominant-baseline="text-before-edge"');
    expect(first.svg).toContain('xml:space="preserve"');
    expect(first.svg).toContain('<tspan x="120" y="12">OpenDesign</tspan>');
    expect(first.svg).toContain(
      '<tspan x="120" y="40">未来 &amp; &lt;设计&gt;</tspan>',
    );

    const imported = importSvg(
      { svg: first.svg, idPrefix: "text_roundtrip" },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    expect(findImportedSource(imported.nodes, text.id)).toMatchObject({
      kind: "text",
      name: text.name,
      transform: text.transform,
      size: text.size,
      opacity: text.opacity,
      properties: text.properties,
    });
    expect(asDocument(imported.nodes, imported.rootNodeId)).toSatisfy(
      isDesignDocument,
    );

    const legacySvg = first.svg
      .replace(
        'data-opendesign-text-version="3"',
        'data-opendesign-text-version="1"',
      )
      .replace("&quot;textResize&quot;:&quot;fixed&quot;,", "")
      .replace("&quot;textWrap&quot;:&quot;word&quot;,", "")
      .replace("&quot;textOverflow&quot;:&quot;ellipsis&quot;,", "");
    const legacyImported = importSvg(
      { svg: legacySvg, idPrefix: "text_legacy_metadata" },
      geometry,
    );
    expect(legacyImported.ok).toBe(true);
    if (legacyImported.ok) {
      expect(findImportedSource(legacyImported.nodes, text.id)).toMatchObject({
        kind: "text",
        properties: {
          textResize: "fixed",
          textWrap: "character",
          textOverflow: "visible",
        },
      });
    }
    const fixedLayoutSvg = first.svg
      .replace(
        'data-opendesign-text-version="3"',
        'data-opendesign-text-version="2"',
      )
      .replace("&quot;textResize&quot;:&quot;fixed&quot;,", "");
    const fixedLayoutImported = importSvg(
      { svg: fixedLayoutSvg, idPrefix: "text_fixed_layout_metadata" },
      geometry,
    );
    expect(fixedLayoutImported.ok).toBe(true);
    if (fixedLayoutImported.ok) {
      expect(
        findImportedSource(fixedLayoutImported.nodes, text.id),
      ).toMatchObject({
        kind: "text",
        properties: { textResize: "fixed" },
      });
    }
    const ambiguousLegacy = importSvg(
      {
        svg: first.svg.replace(
          'data-opendesign-text-version="3"',
          'data-opendesign-text-version="1"',
        ),
        idPrefix: "text_ambiguous_legacy_metadata",
      },
      geometry,
    );
    expect(ambiguousLegacy.ok).toBe(false);
    if (!ambiguousLegacy.ok) {
      expect(ambiguousLegacy.issues).toContainEqual(
        expect.objectContaining({
          code: "text-fidelity-unsupported",
          severity: "error",
        }),
      );
    }

    const tamperedContent = importSvg(
      {
        svg: first.svg.replace(">OpenDesign</tspan>", ">Tampered</tspan>"),
        idPrefix: "text_tampered_content",
      },
      geometry,
    );
    expect(tamperedContent.ok).toBe(false);
    if (!tamperedContent.ok) {
      expect(tamperedContent.issues).toContainEqual(
        expect.objectContaining({
          code: "text-fidelity-unsupported",
          severity: "error",
        }),
      );
    }

    const tamperedPaint = importSvg(
      {
        svg: first.svg.replace('fill="#153eaa"', 'fill="#ff0000"'),
        idPrefix: "text_tampered_paint",
      },
      geometry,
    );
    expect(tamperedPaint.ok).toBe(false);
    if (!tamperedPaint.ok) {
      expect(tamperedPaint.issues).toContainEqual(
        expect.objectContaining({
          code: "text-fidelity-unsupported",
          severity: "error",
        }),
      );
    }
  });

  it("keeps ordinary third-party SVG text outside the editable import boundary", () => {
    const imported = importSvg(
      {
        idPrefix: "external_text",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><text x="0" y="24" font-family="sans-serif" font-size="24">External</text></svg>`,
      },
      geometry,
    );
    expect(imported.ok).toBe(false);
    if (!imported.ok) {
      expect(imported.issues).toContainEqual(
        expect.objectContaining({
          code: "unsupported-element",
          severity: "error",
          sourceElement: "text",
        }),
      );
    }
  });

  it("round-trips Auto Width and Auto Height semantics through text metadata v3", () => {
    const autoWidth: DesignNode = {
      id: "auto_width_text",
      kind: "text",
      name: "Auto Width",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 12, 12],
      size: { width: 168.5, height: 32 },
      opacity: 1,
      properties: {
        content: "Auto Width",
        fontFamily: "Inter",
        fontSize: 24,
        fontWeight: 600,
        lineHeight: 32,
        letterSpacing: 0,
        textAlignHorizontal: "left",
        textAlignVertical: "top",
        textResize: "auto-width",
        textWrap: "none",
        textOverflow: "visible",
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    const autoHeight: DesignNode = {
      ...autoWidth,
      id: "auto_height_text",
      name: "Auto Height",
      transform: [1, 0, 0, 1, 12, 72],
      size: { width: 180, height: 96.25 },
      properties: {
        ...autoWidth.properties,
        content: "Auto Height paragraph",
        textResize: "auto-height",
        textWrap: "word",
        textOverflow: "visible",
      },
    };
    const document = documentFromNodes(
      "svg_auto_text_document",
      [autoWidth, autoHeight],
      [autoWidth.id, autoHeight.id],
    );

    const exported = exportSvg({
      document,
      rootNodeIds: [autoWidth.id, autoHeight.id],
      viewport: { x: 0, y: 0, width: 240, height: 200 },
      includeLayerIds: true,
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(
      exported.svg.match(/data-opendesign-text-version="3"/g),
    ).toHaveLength(2);

    const imported = importSvg(
      { svg: exported.svg, idPrefix: "auto_text_roundtrip" },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(findImportedSource(imported.nodes, autoWidth.id)).toMatchObject({
      size: autoWidth.size,
      properties: {
        textResize: "auto-width",
        textWrap: "none",
        textOverflow: "visible",
      },
    });
    expect(findImportedSource(imported.nodes, autoHeight.id)).toMatchObject({
      size: autoHeight.size,
      properties: {
        textResize: "auto-height",
        textWrap: "word",
        textOverflow: "visible",
      },
    });
  });

  it("preserves controlled Text gradients and editable stroke alignment while reporting standard SVG degradation", () => {
    const text: DesignNode = {
      id: "gradient_wordmark",
      kind: "text",
      name: "Gradient wordmark",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 8, 12],
      size: { width: 260, height: 48 },
      opacity: 1,
      properties: {
        content: "Gradient",
        fontFamily: "Inter",
        fontSize: 32,
        fontWeight: 700,
        lineHeight: 40,
        letterSpacing: 0,
        textAlignHorizontal: "left",
        textAlignVertical: "top",
        textResize: "fixed",
        textWrap: "none",
        textOverflow: "visible",
        fills: [
          {
            type: "solid",
            color: "#000000",
            opacity: 1,
            visible: false,
          },
          {
            type: "linear-gradient",
            opacity: 0.9,
            visible: true,
            rotation: 18,
            stops: [
              { offset: 0, color: "#2563eb", opacity: 1 },
              { offset: 1, color: "#7c3aed", opacity: 0.8 },
            ],
          },
          { type: "solid", color: "#ff0000", opacity: 1 },
        ],
        strokes: [{ type: "solid", color: "#0f172a", opacity: 1 }],
        strokeWidth: 2,
        strokeAlign: "outside",
        strokeCap: "round",
        strokeJoin: "bevel",
        dashPattern: [3, 2],
      },
      extensions: {},
    };
    const document = documentFromNodes(
      "svg_gradient_text_document",
      [text],
      [text.id],
    );
    const exported = exportSvg({
      document,
      rootNodeIds: [text.id],
      viewport: { x: 0, y: 0, width: 300, height: 90 },
      includeLayerIds: true,
    });

    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.issues.map((issue) => issue.code)).toEqual([
      "text-font-not-embedded",
      "text-layout-fidelity",
      "multiple-paints-flattened",
      "stroke-alignment-flattened",
    ]);
    const imported = importSvg(
      { svg: exported.svg, idPrefix: "gradient_text_roundtrip" },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    expect(findImportedSource(imported.nodes, text.id)).toMatchObject({
      kind: "text",
      size: text.size,
      properties: text.properties,
    });
  });

  it("round-trips controlled editable vector networks without flattening point semantics", () => {
    const document: DesignDocument = {
      format: DESIGN_FORMAT,
      schemaVersion: DESIGN_SCHEMA_VERSION,
      documentId: "document_editable_vector",
      revision: 0,
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
          name: "Editable vector",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 12, 16],
          size: { width: 100, height: 100 },
          opacity: 1,
          extensions: {},
          kind: "vector",
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
                  tangentStart: { x: 25, y: 0 },
                  tangentEnd: { x: -25, y: 0 },
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
            fillRule: "nonzero",
            fills: [{ type: "solid", color: "#4f7fff", opacity: 1 }],
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
    const exported = exportSvg({
      document,
      rootNodeIds: ["vector_1"],
      viewport: { x: 0, y: 0, width: 150, height: 150 },
      includeLayerIds: true,
      title: "Editable vector",
    });

    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.issues).toEqual([]);
    expect(exported.svg).toContain(
      'data-opendesign-vector-network-version="2"',
    );
    const imported = importSvg(
      { svg: exported.svg, idPrefix: "editable_vector" },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    const vector = imported.nodes.find((node) => node.kind === "vector");
    const sourceVector = document.nodesById.vector_1;
    if (
      !sourceVector ||
      sourceVector.kind !== "vector" ||
      !("network" in sourceVector.properties)
    ) {
      throw new Error("Missing editable vector source fixture");
    }
    expect(vector).toMatchObject({
      kind: "vector",
      transform: [1, 0, 0, 1, 12, 16],
      size: { width: 100, height: 100 },
      properties: {
        network: sourceVector.properties.network,
      },
    });
    expect(asDocument(imported.nodes, imported.rootNodeId)).toSatisfy(
      isDesignDocument,
    );

    const opened = setVectorPathClosed(sourceVector.properties.network, false);
    if (!opened.ok) throw new Error(opened.message);
    const openDocument = structuredClone(document);
    const openVector = openDocument.nodesById.vector_1;
    if (
      !openVector ||
      openVector.kind !== "vector" ||
      !("network" in openVector.properties)
    ) {
      throw new Error("Missing open vector fixture");
    }
    openVector.properties.network = opened.network;
    const openExport = exportSvg({
      document: openDocument,
      rootNodeIds: ["vector_1"],
      viewport: { x: 0, y: 0, width: 150, height: 150 },
      includeLayerIds: true,
      title: "Open editable vector",
    });
    expect(openExport.ok).toBe(true);
    if (!openExport.ok) return;
    expect(openExport.svg).toContain('fill="none"');
    const openImported = importSvg(
      { svg: openExport.svg, idPrefix: "editable_vector_open" },
      geometry,
    );
    expect(openImported.ok).toBe(true);
    if (!openImported.ok) return;
    const importedOpenVector = openImported.nodes.find(
      (node) => node.kind === "vector",
    );
    expect(importedOpenVector).toMatchObject({
      kind: "vector",
      properties: { network: opened.network, fills: [] },
    });

    const cut = cutVectorPath(opened.network, "path_1", {
      kind: "segment",
      segmentId: "segment_ab",
      t: 0.5,
    });
    if (!cut.ok) throw new Error(cut.message);
    openVector.properties.network = cut.network;
    const cutExport = exportSvg({
      document: openDocument,
      rootNodeIds: ["vector_1"],
      viewport: { x: 0, y: 0, width: 150, height: 150 },
      includeLayerIds: true,
      title: "Cut editable vector",
    });
    expect(cutExport.ok).toBe(true);
    if (!cutExport.ok) return;
    expect(cutExport.svg).toContain('fill="none"');
    expect(cutExport.svg).toContain(" M ");
    const cutImported = importSvg(
      { svg: cutExport.svg, idPrefix: "editable_vector_cut" },
      geometry,
    );
    expect(cutImported.ok).toBe(true);
    if (!cutImported.ok) return;
    expect(cutImported.issues).toEqual([]);
    expect(
      cutImported.nodes.find((node) => node.kind === "vector"),
    ).toMatchObject({
      kind: "vector",
      properties: { network: cut.network, fills: [] },
    });
  });

  it("round-trips directed Line geometry and independent standard SVG endpoint markers", () => {
    const line: DesignNode = {
      id: "flow_line",
      kind: "line",
      name: "Flow line",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 30, 24],
      size: { width: 180, height: 90 },
      opacity: 1,
      properties: {
        fills: [],
        strokes: [{ type: "solid", color: "#2563eb", opacity: 1 }],
        strokeWidth: 4,
        strokeAlign: "center",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [12, 6],
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        startEndpoint: "circle",
        endEndpoint: "triangle-arrow",
      },
      extensions: {},
    };
    const document = documentFromNodes("svg_line_document", [line], [line.id]);
    const exported = exportSvg({
      document,
      rootNodeIds: [line.id],
      viewport: { x: 0, y: 0, width: 240, height: 160 },
      includeLayerIds: true,
    });

    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.issues).toEqual([]);
    expect(exported.svg).toContain("<line");
    expect(exported.svg).toContain('x1="180"');
    expect(exported.svg).toContain('y2="90"');
    expect(exported.svg).toContain('data-opendesign-line-endpoint="circle"');
    expect(exported.svg).toContain(
      'data-opendesign-line-endpoint="triangle-arrow"',
    );
    expect(exported.svg).toContain('orient="auto-start-reverse"');

    const imported = importSvg(
      { svg: exported.svg, idPrefix: "line_roundtrip" },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    expect(findImportedSource(imported.nodes, line.id)).toMatchObject({
      kind: "line",
      transform: [1, 0, 0, 1, 30, 24],
      size: { width: 180, height: 90 },
      properties: {
        fills: [],
        strokes: [{ type: "solid", color: "#2563eb", opacity: 1 }],
        strokeWidth: 4,
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [12, 6],
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        startEndpoint: "circle",
        endEndpoint: "triangle-arrow",
      },
    });
    expect(asDocument(imported.nodes, imported.rootNodeId)).toSatisfy(
      isDesignDocument,
    );
  });

  it("imports an ordinary unmarked SVG line as a high-level Line node", () => {
    const imported = importSvg(
      {
        idPrefix: "external_line",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><line id="divider" x1="100" y1="20" x2="20" y2="60" stroke="#111827" stroke-width="3"/></svg>`,
      },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(findImportedSource(imported.nodes, "divider")).toMatchObject({
      kind: "line",
      transform: [1, 0, 0, 1, 20, 20],
      size: { width: 80, height: 40 },
      properties: {
        fills: [],
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        startEndpoint: "none",
        endEndpoint: "none",
      },
    });
  });

  it("round-trips sharp Polygon and Star semantics without guessing external polygons", () => {
    const polygon: DesignNode = {
      id: "semantic_polygon",
      kind: "polygon",
      name: "Semantic polygon",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 20, 24],
      size: { width: 160, height: 120 },
      opacity: 1,
      properties: {
        pointCount: 6,
        cornerRadius: 0,
        fills: [{ type: "solid", color: "#f59e0b", opacity: 1 }],
        strokes: [{ type: "solid", color: "#78350f", opacity: 1 }],
        strokeWidth: 2,
        strokeAlign: "center",
        strokeJoin: "round",
      },
      extensions: {},
    };
    const star: DesignNode = {
      id: "semantic_star",
      kind: "star",
      name: "Semantic star",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 210, 24],
      size: { width: 140, height: 140 },
      opacity: 0.9,
      properties: {
        pointCount: 7,
        innerRadius: 0.42,
        cornerRadius: 0,
        fills: [{ type: "solid", color: "#8b5cf6", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    const document = documentFromNodes(
      "regular_shapes",
      [polygon, star],
      [polygon.id, star.id],
    );
    const first = exportSvg({
      document,
      rootNodeIds: [polygon.id, star.id],
      viewport: { x: 0, y: 0, width: 380, height: 190 },
      includeLayerIds: true,
    });
    const second = exportSvg({
      document,
      rootNodeIds: [polygon.id, star.id],
      viewport: { x: 0, y: 0, width: 380, height: 190 },
      includeLayerIds: true,
    });
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.issues).toEqual([]);
    expect(first.svg.match(/<polygon/g)).toHaveLength(2);
    expect(first.svg).toContain('data-opendesign-regular-shape-version="1"');
    expect(first.svg).toContain('data-opendesign-inner-radius="0.42"');

    const imported = importSvg(
      { svg: first.svg, idPrefix: "regular_roundtrip" },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    expect(findImportedSource(imported.nodes, polygon.id)).toMatchObject({
      kind: "polygon",
      transform: polygon.transform,
      size: polygon.size,
      properties: {
        pointCount: 6,
        cornerRadius: 0,
      },
    });
    expect(findImportedSource(imported.nodes, star.id)).toMatchObject({
      kind: "star",
      transform: star.transform,
      size: star.size,
      properties: {
        pointCount: 7,
        innerRadius: 0.42,
        cornerRadius: 0,
      },
    });
    expect(asDocument(imported.nodes, imported.rootNodeId)).toSatisfy(
      isDesignDocument,
    );

    const external = importSvg(
      {
        idPrefix: "external_polygon",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon id="ordinary" points="50,0 100,50 50,100 0,50" fill="#111827"/></svg>`,
      },
      geometry,
    );
    expect(external.ok).toBe(true);
    if (!external.ok) return;
    expect(findImportedSource(external.nodes, "ordinary")?.kind).toBe("vector");
  });

  it("rejects tampered or rounded regular-shape interchange instead of losing fidelity", () => {
    const star: DesignNode = {
      id: "controlled_star",
      kind: "star",
      name: "Controlled star",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 10, 10],
      size: { width: 100, height: 100 },
      opacity: 1,
      properties: {
        pointCount: 5,
        innerRadius: 0.4,
        cornerRadius: 0,
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    const document = documentFromNodes("controlled_star", [star], [star.id]);
    const exported = exportSvg({
      document,
      rootNodeIds: [star.id],
      viewport: { x: 0, y: 0, width: 120, height: 120 },
      includeLayerIds: true,
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const tampered = importSvg(
      {
        idPrefix: "tampered_star",
        svg: exported.svg.replace(
          'data-opendesign-point-count="5"',
          'data-opendesign-point-count="6"',
        ),
      },
      geometry,
    );
    expect(tampered.ok).toBe(false);
    if (tampered.ok) return;
    expect(tampered.issues).toContainEqual(
      expect.objectContaining({
        code: "regular-shape-fidelity-unsupported",
      }),
    );

    const wrongElement = importSvg(
      {
        idPrefix: "wrong_regular_element",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g data-opendesign-kind="polygon" data-opendesign-regular-shape-version="1"><rect width="100" height="100"/></g></svg>`,
      },
      geometry,
    );
    expect(wrongElement.ok).toBe(false);
    if (wrongElement.ok) return;
    expect(wrongElement.issues).toContainEqual(
      expect.objectContaining({
        code: "regular-shape-fidelity-unsupported",
      }),
    );

    const rounded = structuredClone(document);
    const roundedStar = rounded.nodesById[star.id];
    if (!roundedStar || roundedStar.kind !== "star") {
      throw new Error("Missing controlled star");
    }
    roundedStar.properties.cornerRadius = 8;
    const rejected = exportSvg({
      document: rounded,
      rootNodeIds: [star.id],
      viewport: { x: 0, y: 0, width: 120, height: 120 },
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({
        code: "regular-shape-fidelity-unsupported",
      }),
    );
  });

  it("rejects external or modified SVG markers instead of flattening arrow semantics", () => {
    const external = importSvg(
      {
        idPrefix: "unsafe_marker",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><defs><marker id="custom"><path d="M0 0L10 5L0 10Z"/></marker></defs><line x1="20" y1="20" x2="100" y2="60" stroke="#111827" marker-end="url(#custom)"/></svg>`,
      },
      geometry,
    );
    expect(external.ok).toBe(false);
    if (external.ok) return;
    expect(external.issues).toContainEqual(
      expect.objectContaining({ code: "line-endpoint-unsupported" }),
    );

    const line = simpleLine("controlled", null);
    const exported = exportSvg({
      document: documentFromNodes("tampered_marker", [line], [line.id]),
      rootNodeIds: [line.id],
      viewport: { x: 0, y: 0, width: 160, height: 80 },
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const tampered = importSvg(
      {
        idPrefix: "tampered_marker",
        svg: exported.svg.replace('markerWidth="4"', 'markerWidth="40"'),
      },
      geometry,
    );
    expect(tampered.ok).toBe(false);
    if (tampered.ok) return;
    expect(tampered.issues).toContainEqual(
      expect.objectContaining({ code: "line-endpoint-unsupported" }),
    );
  });

  it("round-trips multiple drop shadows, layer blur, effect order, and hidden effects deterministically", () => {
    const document = shapeDocument();
    const node = document.nodesById.rect_gradient;
    if (!node || node.kind !== "rectangle") throw new Error("Missing fixture");
    node.effects = [
      {
        type: "drop-shadow",
        color: "#101828",
        opacity: 0.42,
        offset: { x: -6, y: 12 },
        blur: 24,
        spread: 0,
        blendMode: "normal",
      },
      {
        type: "drop-shadow",
        color: "rgba(98, 229, 255, 0.8)",
        opacity: 0.7,
        offset: { x: 8, y: 4 },
        blur: 10,
        spread: 0,
      },
      {
        type: "drop-shadow",
        color: "#f0f9ff",
        opacity: 0.25,
        offset: { x: 0, y: 2 },
        blur: 4,
        spread: 0,
        visible: false,
      },
      { type: "layer-blur", radius: 6 },
    ];

    const first = exportSvg({
      document,
      rootNodeIds: ["rect_gradient"],
      viewport: { x: 0, y: 0, width: 160, height: 120 },
    });
    const second = exportSvg({
      document,
      rootNodeIds: ["rect_gradient"],
      viewport: { x: 0, y: 0, width: 160, height: 120 },
    });
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.issues).toEqual([]);
    expect(first.svg).toContain('data-opendesign-filter-version="1"');
    expect(first.svg.match(/<feGaussianBlur/g)).toHaveLength(4);
    expect(first.svg.match(/<feMergeNode/g)).toHaveLength(3);
    expect(first.svg).toContain('data-opendesign-effect-visible="false"');
    expect(first.svg).toContain('filterUnits="userSpaceOnUse"');
    expect(first.svg).not.toContain("<feDropShadow");
    expect(first.svg.match(/in="SourceGraphic"/g)).toHaveLength(1);
    expect(first.svg).toContain('x="-54"');
    expect(first.svg).toContain('y="-36"');
    expect(first.svg).toContain('width="186"');
    expect(first.svg).toContain('height="156"');

    const imported = importSvg(
      { svg: first.svg, idPrefix: "effect_roundtrip" },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    expect(
      imported.nodes.find((candidate) => candidate.parentId !== null),
    ).toMatchObject({ effects: node.effects });

    const tampered = importSvg(
      {
        svg: first.svg.replace('in="od_effect_1_shadow"', 'in="SourceGraphic"'),
        idPrefix: "effect_tampered",
      },
      geometry,
    );
    expect(tampered.ok).toBe(true);
    if (!tampered.ok) return;
    expect(tampered.issues).toMatchObject([
      { code: "unsupported-filter", severity: "warning" },
    ]);
    expect(
      tampered.nodes.find((candidate) => candidate.parentId !== null)?.effects,
    ).toBeUndefined();

    expect(asDocument(imported.nodes, imported.rootNodeId)).toSatisfy(
      isDesignDocument,
    );
  });

  it("imports the bounded standard feDropShadow and feGaussianBlur shorthand subset", () => {
    const shadow = importSvg(
      {
        idPrefix: "standard_shadow",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60"><defs><filter id="shadow"><feDropShadow in="SourceGraphic" dx="3" dy="7" stdDeviation="5" flood-color="#334455" flood-opacity="0.35"/></filter></defs><rect id="card" width="60" height="40" filter="url(#shadow)"/></svg>`,
      },
      geometry,
    );
    expect(shadow.ok).toBe(true);
    if (!shadow.ok) return;
    expect(shadow.issues).toEqual([]);
    expect(findImportedSource(shadow.nodes, "card")).toMatchObject({
      effects: [
        {
          type: "drop-shadow",
          color: "#334455",
          opacity: 0.35,
          offset: { x: 3, y: 7 },
          blur: 10,
          spread: 0,
        },
      ],
    });

    const blur = importSvg(
      {
        idPrefix: "standard_blur",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60"><defs><filter id="blur"><feGaussianBlur in="SourceGraphic" stdDeviation="4"/></filter></defs><ellipse id="orb" cx="30" cy="30" rx="20" ry="20" style="filter:url(#blur)"/></svg>`,
      },
      geometry,
    );
    expect(blur.ok).toBe(true);
    if (!blur.ok) return;
    expect(blur.issues).toEqual([]);
    expect(findImportedSource(blur.nodes, "orb")).toMatchObject({
      effects: [{ type: "layer-blur", radius: 8 }],
    });
  });

  it("reports unsupported effect semantics and complex filter graphs without silently flattening them", () => {
    const document = shapeDocument();
    const node = document.nodesById.rect_gradient;
    if (!node || node.kind !== "rectangle") throw new Error("Missing fixture");
    node.effects = [
      {
        type: "drop-shadow",
        color: "#000000",
        opacity: 0.5,
        offset: { x: 0, y: 8 },
        blur: 16,
        spread: 2,
      },
      {
        type: "inner-shadow",
        color: "#ffffff",
        opacity: 0.3,
        offset: { x: 0, y: 2 },
        blur: 8,
        spread: 0,
      },
      { type: "background-blur", radius: 12 },
      { type: "grayscale", amount: 0.4 },
    ];
    const exported = exportSvg({
      document,
      rootNodeIds: ["rect_gradient"],
      viewport: { x: 0, y: 0, width: 160, height: 120 },
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.issues).toHaveLength(4);
    expect(
      exported.issues.every((issue) => issue.code === "effect-omitted"),
    ).toBe(true);
    expect(exported.issues.map((issue) => issue.message).join("\n")).toMatch(
      /spread 2[\s\S]*inner-shadow[\s\S]*background-blur[\s\S]*grayscale/,
    );
    expect(exported.svg).not.toContain("<filter");

    const complex = importSvg(
      {
        idPrefix: "complex_filter",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><filter id="complex"><feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/><feColorMatrix in="blur" type="saturate" values="0.5"/></filter></defs><rect id="shape" width="40" height="40" filter="url(#complex)"/></svg>`,
      },
      geometry,
    );
    expect(complex.ok).toBe(true);
    if (!complex.ok) return;
    expect(complex.issues).toMatchObject([
      { code: "unsupported-filter", severity: "warning" },
    ]);
    expect(findImportedSource(complex.nodes, "shape")?.effects).toBeUndefined();
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

  it("round-trips Frame clipsContent as a rounded local clip without creating a background layer", () => {
    const document = frameDocument();
    const first = exportSvg({
      document,
      rootNodeIds: ["frame_card"],
      viewport: { x: 0, y: 0, width: 240, height: 180 },
      includeLayerIds: true,
    });
    const second = exportSvg({
      document,
      rootNodeIds: ["frame_card"],
      viewport: { x: 0, y: 0, width: 240, height: 180 },
      includeLayerIds: true,
    });
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.issues).toEqual([]);
    expect(first.svg).toContain('data-opendesign-frame-clip="true"');
    expect(first.svg).toContain('data-opendesign-frame-content="true"');
    expect(first.svg).toContain('clipPathUnits="userSpaceOnUse"');
    expect(first.svg).toContain('<rect width="180" height="120" rx="24"');

    const imported = importSvg(
      { svg: first.svg, idPrefix: "frame_roundtrip" },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    const frame = findImportedSource(imported.nodes, "frame_card");
    expect(frame).toMatchObject({
      kind: "frame",
      size: { width: 180, height: 120 },
      properties: {
        cornerRadius: 24,
        clipsContent: true,
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
      },
    });
    expect(frame?.childIds).toHaveLength(2);
    expect(
      imported.nodes.filter(
        (node) =>
          node.extensions.svgImport &&
          typeof node.extensions.svgImport === "object" &&
          !Array.isArray(node.extensions.svgImport) &&
          node.extensions.svgImport.sourceElement === "rect",
      ),
    ).toHaveLength(2);
    expect(asDocument(imported.nodes, imported.rootNodeId)).toSatisfy(
      isDesignDocument,
    );
    const tampered = importSvg(
      {
        svg: first.svg.replace(
          '<rect width="180" height="120" rx="24"',
          '<rect width="179" height="120" rx="24"',
        ),
        idPrefix: "frame_tampered",
      },
      geometry,
    );
    expect(tampered.ok).toBe(false);
    expect(tampered.issues.some((issue) => issue.code === "mask-omitted")).toBe(
      true,
    );

    const unclippedDocument = frameDocument();
    const unclippedFrame = unclippedDocument.nodesById.frame_card;
    if (!unclippedFrame || unclippedFrame.kind !== "frame") {
      throw new Error("Missing unclipped Frame fixture");
    }
    unclippedFrame.properties.clipsContent = false;
    const unclippedExport = exportSvg({
      document: unclippedDocument,
      rootNodeIds: ["frame_card"],
      viewport: { x: 0, y: 0, width: 240, height: 180 },
      includeLayerIds: true,
    });
    expect(unclippedExport.ok).toBe(true);
    if (!unclippedExport.ok) return;
    expect(unclippedExport.svg).not.toContain("data-opendesign-frame-clip");
    const unclippedImport = importSvg(
      { svg: unclippedExport.svg, idPrefix: "frame_unclipped" },
      geometry,
    );
    expect(unclippedImport.ok).toBe(true);
    if (!unclippedImport.ok) return;
    expect(
      findImportedSource(unclippedImport.nodes, "frame_card"),
    ).toMatchObject({ kind: "frame", properties: { clipsContent: false } });
  });

  it("round-trips ordered sibling mask runs for alpha, luminance, outline, and visible clipping modes", () => {
    const document = maskDocument();
    const exported = exportSvg({
      document,
      rootNodeIds: ["mask_stage"],
      viewport: { x: 0, y: 0, width: 420, height: 180 },
      includeLayerIds: true,
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.issues).toEqual([]);
    expect(exported.exportedNodeIds).toEqual([
      "mask_stage",
      "alpha_source",
      "alpha_target",
      "luminance_source",
      "luminance_target",
      "outline_source",
      "outline_target",
      "clipping_source",
      "clipping_target",
    ]);
    expect(new Set(exported.exportedNodeIds).size).toBe(
      exported.exportedNodeIds.length,
    );
    expect(exported.svg.match(/<mask(?:\s|>)/g)).toHaveLength(3);
    expect(exported.svg.match(/<clipPath(?:\s|>)/g)).toHaveLength(1);
    expect(exported.svg.match(/mask-type="alpha"/g)).toHaveLength(2);
    expect(exported.svg.match(/mask-type="luminance"/g)).toHaveLength(1);
    expect(exported.svg).toMatch(
      /<mask[^>]+data-opendesign-mask-mode="alpha"[^>]+x="-32"[^>]+width="146"/,
    );
    expect(exported.svg.match(/data-opendesign-mask-run="true"/g)).toHaveLength(
      4,
    );
    expect(
      exported.svg.match(/data-opendesign-id="clipping_source"/g),
    ).toHaveLength(1);

    const imported = importSvg(
      { svg: exported.svg, idPrefix: "mask_roundtrip" },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    const stage = findImportedSource(imported.nodes, "mask_stage");
    expect(stage?.kind).toBe("group");
    const orderedSources = stage?.childIds.map(
      (id) =>
        imported.nodes.find((node) => node.id === id)?.extensions.svgImport,
    );
    expect(
      orderedSources?.map((source) =>
        typeof source === "object" && source !== null && !Array.isArray(source)
          ? source.sourceId
          : undefined,
      ),
    ).toEqual([
      "alpha_source",
      "alpha_target",
      "luminance_source",
      "luminance_target",
      "outline_source",
      "outline_target",
      "clipping_source",
      "clipping_target",
    ]);
    expect(findImportedSource(imported.nodes, "alpha_source")?.maskMode).toBe(
      "alpha",
    );
    expect(findImportedSource(imported.nodes, "alpha_source")?.effects).toEqual(
      [{ type: "layer-blur", radius: 12 }],
    );
    expect(
      findImportedSource(imported.nodes, "luminance_source")?.maskMode,
    ).toBe("luminance");
    expect(findImportedSource(imported.nodes, "outline_source")?.maskMode).toBe(
      "outline",
    );
    expect(
      findImportedSource(imported.nodes, "clipping_source")?.maskMode,
    ).toBe("clipping");
    expect(asDocument(imported.nodes, imported.rootNodeId)).toSatisfy(
      isDesignDocument,
    );
    const tampered = importSvg(
      {
        svg: exported.svg.replace('fill="#0f172a"', 'fill="#ffffff"'),
        idPrefix: "mask_tampered",
      },
      geometry,
    );
    expect(tampered.ok).toBe(false);
    expect(
      tampered.issues.some(
        (issue) =>
          issue.code === "mask-omitted" &&
          /does not match/i.test(issue.message),
      ),
    ).toBe(true);

    const withoutLayerIds = exportSvg({
      document,
      rootNodeIds: ["mask_stage"],
      viewport: { x: 0, y: 0, width: 420, height: 180 },
      includeLayerIds: false,
    });
    expect(withoutLayerIds.ok).toBe(true);
    if (!withoutLayerIds.ok) return;
    expect(withoutLayerIds.svg).not.toContain("data-opendesign-id");
    const importedWithoutLayerIds = importSvg(
      { svg: withoutLayerIds.svg, idPrefix: "mask_without_ids" },
      geometry,
    );
    expect(importedWithoutLayerIds.ok).toBe(true);
    if (!importedWithoutLayerIds.ok) return;
    expect(importedWithoutLayerIds.issues).toEqual([]);
    expect(
      importedWithoutLayerIds.nodes.filter(
        (node) => node.maskMode && node.maskMode !== "none",
      ),
    ).toHaveLength(4);

    const detachedMaskSource = exportSvg({
      document,
      rootNodeIds: ["alpha_source"],
      viewport: { x: 0, y: 0, width: 120, height: 150 },
    });
    expect(detachedMaskSource.ok).toBe(true);
    if (!detachedMaskSource.ok) return;
    expect(detachedMaskSource.issues).toMatchObject([
      { code: "mask-omitted", severity: "warning", nodeId: "alpha_source" },
    ]);
    expect(detachedMaskSource.issues[0]?.message).toMatch(
      /parent sibling run/i,
    );
  });

  it("imports bounded standard local mask and clipPath references as editable sibling mask groups", () => {
    const imported = importSvg(
      {
        idPrefix: "standard_masks",
        svg: `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120">
            <defs>
              <clipPath id="round_clip" clipPathUnits="userSpaceOnUse">
                <circle cx="50" cy="50" r="38"/>
              </clipPath>
              <mask id="alpha_fade" maskContentUnits="userSpaceOnUse" mask-type="alpha">
                <rect x="120" y="10" width="100" height="90" fill="#ffffff" fill-opacity="0.65"/>
              </mask>
            </defs>
            <rect id="clipped_card" x="10" y="10" width="90" height="90" fill="#6d5dfc" clip-path="url(#round_clip)"/>
            <g id="masked_group" transform="translate(10 5)" mask="url(#alpha_fade)">
              <ellipse id="masked_orb" cx="170" cy="55" rx="55" ry="40" fill="#22d3ee"/>
            </g>
          </svg>
        `,
      },
      geometry,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.issues).toEqual([]);
    const maskSources = imported.nodes.filter(
      (node) => node.maskMode && node.maskMode !== "none",
    );
    expect(maskSources.map((node) => node.maskMode).sort()).toEqual([
      "alpha",
      "outline",
    ]);
    const clipped = findImportedSource(imported.nodes, "clipped_card");
    const masked = findImportedSource(imported.nodes, "masked_group");
    expect(clipped?.parentId).not.toBe(imported.rootNodeId);
    expect(masked?.parentId).not.toBe(imported.rootNodeId);
    expect(
      imported.nodes.find((node) => node.id === clipped?.parentId)?.kind,
    ).toBe("group");
    expect(
      imported.nodes.find((node) => node.id === masked?.parentId)?.kind,
    ).toBe("group");
    const maskedWrapper = imported.nodes.find(
      (node) => node.id === masked?.parentId,
    );
    const alphaSource = maskedWrapper?.childIds
      .map((id) => imported.nodes.find((node) => node.id === id))
      .find((node) => node?.maskMode === "alpha");
    expect(alphaSource).toBeDefined();
    expect(alphaSource!.transform[4] - masked!.transform[4]).toBeCloseTo(5, 8);
    expect(alphaSource!.transform[5] - masked!.transform[5]).toBeCloseTo(-5, 8);
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

    const externalFilter = importSvg(
      {
        idPrefix: "external_filter",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10V10Z" filter="url(https://example.test/effects.svg#shadow)"/></svg>`,
      },
      geometry,
    );
    expect(externalFilter.ok).toBe(false);
    expect(
      externalFilter.issues.some(
        (issue) => issue.code === "external-reference",
      ),
    ).toBe(true);

    const externalMask = importSvg(
      {
        idPrefix: "external_mask",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" mask="url(https://example.test/masks.svg#alpha)"/></svg>`,
      },
      geometry,
    );
    expect(externalMask.ok).toBe(false);
    expect(
      externalMask.issues.some((issue) => issue.code === "external-reference"),
    ).toBe(true);

    const rootClip = importSvg(
      {
        idPrefix: "root_clip",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" clip-path="url(#clip)"><defs><clipPath id="clip"><rect width="5" height="5"/></clipPath></defs><rect width="10" height="10"/></svg>`,
      },
      geometry,
    );
    expect(rootClip.ok).toBe(false);
    expect(
      rootClip.issues.some(
        (issue) =>
          issue.code === "mask-omitted" && /root-level/i.test(issue.message),
      ),
    ).toBe(true);

    const objectBoundingBoxClip = importSvg(
      {
        idPrefix: "bbox_clip",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><clipPath id="clip" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath></defs><rect width="10" height="10" clip-path="url(#clip)"/></svg>`,
      },
      geometry,
    );
    expect(objectBoundingBoxClip.ok).toBe(false);
    expect(
      objectBoundingBoxClip.issues.some(
        (issue) => issue.code === "mask-omitted",
      ),
    ).toBe(true);

    const collidingMaskId = importSvg(
      {
        idPrefix: "colliding_mask",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><defs><linearGradient id="shared"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient><mask id="shared" mask-type="alpha"><rect width="20" height="20" fill="#fff"/></mask></defs><rect width="20" height="20" mask="url(#shared)"/></svg>`,
      },
      geometry,
    );
    expect(collidingMaskId.ok).toBe(false);
    expect(
      collidingMaskId.issues.some(
        (issue) =>
          issue.code === "mask-omitted" && /collides/i.test(issue.message),
      ),
    ).toBe(true);

    const cyclicMask = importSvg(
      {
        idPrefix: "cyclic_mask",
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><defs><mask id="cycle" mask-type="alpha"><rect width="20" height="20" mask="url(#cycle)"/></mask></defs><rect width="20" height="20" mask="url(#cycle)"/></svg>`,
      },
      geometry,
    );
    expect(cyclicMask.ok).toBe(false);
    expect(
      cyclicMask.issues.some(
        (issue) =>
          issue.code === "mask-omitted" && /cycle/i.test(issue.message),
      ),
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

function frameDocument(): DesignDocument {
  const nodes: DesignNode[] = [
    {
      id: "frame_card",
      kind: "frame",
      name: "Clipped card",
      parentId: null,
      childIds: ["frame_glow", "frame_overflow"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 20, 20],
      size: { width: 180, height: 120 },
      opacity: 1,
      properties: {
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [{ type: "solid", color: "#334155", opacity: 0.8 }],
        strokeWidth: 2,
        strokeAlign: "center",
        cornerRadius: 24,
        clipsContent: true,
      },
      extensions: {},
    },
    simpleRectangle(
      "frame_glow",
      "frame_card",
      [1, 0, 0, 1, 16, 18],
      { width: 72, height: 72 },
      "#22d3ee",
    ),
    simpleRectangle(
      "frame_overflow",
      "frame_card",
      [1, 0, 0, 1, 132, 70],
      { width: 96, height: 72 },
      "#8b5cf6",
    ),
  ];
  return documentFromNodes("svg_frame_document", nodes, ["frame_card"]);
}

function maskDocument(): DesignDocument {
  const childIds = [
    "alpha_source",
    "alpha_target",
    "luminance_source",
    "luminance_target",
    "outline_source",
    "outline_target",
    "clipping_source",
    "clipping_target",
  ];
  const nodes: DesignNode[] = [
    {
      id: "mask_stage",
      kind: "group",
      name: "Mask stage",
      parentId: null,
      childIds,
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 10, 10],
      size: { width: 400, height: 150 },
      opacity: 1,
      properties: {},
      extensions: {},
    },
    simpleRectangle(
      "alpha_source",
      "mask_stage",
      [1, 0, 0, 1, 0, 12],
      { width: 82, height: 110 },
      "#ffffff",
      "alpha",
      0.7,
    ),
    simpleRectangle(
      "alpha_target",
      "mask_stage",
      [1, 0, 0, 1, -8, 4],
      { width: 98, height: 126 },
      "#7c3aed",
    ),
    simpleRectangle(
      "luminance_source",
      "mask_stage",
      [1, 0, 0, 1, 104, 12],
      { width: 82, height: 110 },
      "#d1d5db",
      "luminance",
    ),
    simpleRectangle(
      "luminance_target",
      "mask_stage",
      [1, 0, 0, 1, 96, 4],
      { width: 98, height: 126 },
      "#06b6d4",
    ),
    simpleRectangle(
      "outline_source",
      "mask_stage",
      [1, 0, 0, 1, 208, 12],
      { width: 82, height: 110 },
      "#ffffff",
      "outline",
      0.8,
    ),
    simpleRectangle(
      "outline_target",
      "mask_stage",
      [1, 0, 0, 1, 200, 4],
      { width: 98, height: 126 },
      "#f97316",
    ),
    simpleRectangle(
      "clipping_source",
      "mask_stage",
      [1, 0, 0, 1, 312, 12],
      { width: 82, height: 110 },
      "#0f172a",
      "clipping",
      0.65,
    ),
    simpleRectangle(
      "clipping_target",
      "mask_stage",
      [1, 0, 0, 1, 304, 4],
      { width: 98, height: 126 },
      "#ec4899",
    ),
  ];
  const alphaSource = nodes.find((node) => node.id === "alpha_source");
  if (!alphaSource) throw new Error("Missing alpha mask source");
  alphaSource.effects = [{ type: "layer-blur", radius: 12 }];
  return documentFromNodes("svg_mask_document", nodes, ["mask_stage"]);
}

function simpleRectangle(
  id: string,
  parentId: string,
  transform: [number, number, number, number, number, number],
  size: { width: number; height: number },
  color: string,
  maskMode?: "alpha" | "clipping" | "luminance" | "outline",
  opacity = 1,
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
    size,
    opacity,
    ...(maskMode ? { maskMode } : {}),
    properties: {
      fills: [{ type: "solid", color, opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 18,
    },
    extensions: {},
  };
}

function simpleLine(
  id: string,
  parentId: string | null,
): Extract<DesignNode, { kind: "line" }> {
  return {
    id,
    kind: "line",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 16, 20],
    size: { width: 120, height: 24 },
    opacity: 1,
    properties: {
      fills: [],
      strokes: [{ type: "solid", color: "#111827", opacity: 1 }],
      strokeWidth: 2,
      strokeAlign: "center",
      strokeCap: "round",
      strokeJoin: "round",
      dashPattern: [],
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
      startEndpoint: "none",
      endEndpoint: "line-arrow",
    },
    extensions: {},
  };
}

function documentFromNodes(
  documentId: string,
  nodes: readonly DesignNode[],
  rootNodeIds: readonly string[],
): DesignDocument {
  return {
    format: DESIGN_FORMAT,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId,
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
