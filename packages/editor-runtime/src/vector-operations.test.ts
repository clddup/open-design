import type {
  DesignDocument,
  ImageNode,
  VectorNetwork,
  VectorNode,
} from "@opendesign/design-contracts";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "@opendesign/geometry-service/vector-path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { getWorldTransform, transformPoint } from "./geometry.js";
import { EditorRuntime } from "./runtime.js";
import { planCreateBooleanGroup } from "./boolean-operations.js";
import {
  planDeleteVectorNode,
  planVectorLayersLineCut,
  planVectorLayersEndpointConnect,
  planVectorLayersVertexTransform,
  planVectorNetworkUpdate,
  planVectorNetworkUpdates,
  planVectorOutlineStroke,
  planVectorSemanticEdit,
  resolveVectorEditCollectionScope,
  resolveVectorEditScope,
  type VectorSemanticEdit,
} from "./vector-operations.js";
import { planFlattenNodes } from "./vector-flatten.js";
import type { FlattenTextRunStyle } from "./vector-flatten-text.js";
import type { TextRunLayoutProvider } from "@opendesign/text-service";

const require = createRequire(import.meta.url);
let geometry: VectorGeometryProvider;

beforeAll(async () => {
  geometry = await createPathKitGeometryProvider({
    wasmBinary: await readFile(
      require.resolve("pathkit-wasm/bin/pathkit.wasm"),
    ),
  });
});

function glyphOutlineProvider(): TextRunLayoutProvider<FlattenTextRunStyle> {
  return {
    id: "test-glyph-outlines",
    version: "1",
    layout(request) {
      const style = request.runs[0]?.style ?? request.baseStyle;
      return {
        ok: true,
        provider: "test-glyph-outlines",
        providerVersion: "1",
        size: { width: 12, height: 16 },
        contentBounds: { x: 0, y: 0, width: 12, height: 16 },
        displayContent: request.content,
        fragments: [
          {
            baseline: 12,
            ...(style.textDecoration === "none"
              ? {}
              : {
                  decorations: [
                    {
                      color:
                        style.textDecorationColor?.value === "auto" ||
                        style.textDecorationColor === null
                          ? "auto"
                          : structuredClone(style.textDecorationColor.value),
                      kind: style.textDecoration,
                      path: "M0 -2L12 -2L12 -1L0 -1Z",
                      style: style.textDecorationStyle ?? "solid",
                    },
                  ],
                }),
            end: 1,
            glyphs: [
              {
                clusterEnd: 1,
                clusterStart: 0,
                glyphId: 1,
                path: "M0 0L12 0L12 16L0 16Z",
                x: 0,
                xAdvance: 12,
                y: 0,
                yAdvance: 0,
              },
            ],
            height: 16,
            lineIndex: 0,
            start: 0,
            style,
            text: request.content,
            width: 12,
            x: 0,
            y: 0,
          },
        ],
        fullContentBounds: { x: 0, y: 0, width: 12, height: 16 },
        lines: [
          {
            baseline: 12,
            end: 1,
            height: 16,
            start: 0,
            width: 12,
            x: 0,
            y: 0,
          },
        ],
        markers: [],
        sourceContentEnd: request.content.length,
        truncated: false,
        warnings: [],
      };
    },
  };
}

function network(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
      { id: "vertex_b", x: 100, y: 0, handleMode: "corner" },
      { id: "vertex_c", x: 100, y: 100, handleMode: "corner" },
    ],
    segments: [
      { id: "segment_ab", startVertexId: "vertex_a", endVertexId: "vertex_b" },
      { id: "segment_bc", startVertexId: "vertex_b", endVertexId: "vertex_c" },
    ],
    paths: [
      {
        id: "path_open",
        closed: false,
        segments: [
          { segmentId: "segment_ab", reversed: false },
          { segmentId: "segment_bc", reversed: false },
        ],
      },
    ],
    regions: [],
  };
}

function branchCandidateNetwork(): VectorNetwork {
  const source = network();
  source.vertices.push(
    { id: "vertex_d", x: 180, y: 0, handleMode: "corner" },
    { id: "vertex_e", x: 220, y: 50, handleMode: "corner" },
    { id: "vertex_f", x: 180, y: 100, handleMode: "corner" },
  );
  source.segments.push(
    { id: "segment_de", startVertexId: "vertex_d", endVertexId: "vertex_e" },
    { id: "segment_ef", startVertexId: "vertex_e", endVertexId: "vertex_f" },
  );
  source.paths.push({
    id: "path_branch_target",
    closed: false,
    segments: [
      { segmentId: "segment_de", reversed: false },
      { segmentId: "segment_ef", reversed: false },
    ],
  });
  return source;
}

function closedNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
      { id: "vertex_b", x: 100, y: 0, handleMode: "corner" },
      { id: "vertex_c", x: 100, y: 100, handleMode: "corner" },
      { id: "vertex_d", x: 0, y: 100, handleMode: "corner" },
    ],
    segments: [
      { id: "segment_ab", startVertexId: "vertex_a", endVertexId: "vertex_b" },
      { id: "segment_bc", startVertexId: "vertex_b", endVertexId: "vertex_c" },
      { id: "segment_cd", startVertexId: "vertex_c", endVertexId: "vertex_d" },
      { id: "segment_da", startVertexId: "vertex_d", endVertexId: "vertex_a" },
    ],
    paths: [
      {
        id: "path_closed",
        closed: true,
        segments: [
          { segmentId: "segment_ab", reversed: false },
          { segmentId: "segment_bc", reversed: false },
          { segmentId: "segment_cd", reversed: false },
          { segmentId: "segment_da", reversed: false },
        ],
      },
    ],
    regions: [
      {
        id: "region_face",
        windingRule: "nonzero",
        loops: [{ pathId: "path_closed", reversed: false }],
      },
    ],
  };
}

function compoundNetwork(): VectorNetwork {
  const source = closedNetwork();
  source.vertices.push(
    { id: "vertex_e", x: 30, y: 30, handleMode: "corner" },
    { id: "vertex_f", x: 70, y: 30, handleMode: "corner" },
    { id: "vertex_g", x: 70, y: 70, handleMode: "corner" },
    { id: "vertex_h", x: 30, y: 70, handleMode: "corner" },
  );
  source.segments.push(
    { id: "segment_ef", startVertexId: "vertex_e", endVertexId: "vertex_f" },
    { id: "segment_fg", startVertexId: "vertex_f", endVertexId: "vertex_g" },
    { id: "segment_gh", startVertexId: "vertex_g", endVertexId: "vertex_h" },
    { id: "segment_he", startVertexId: "vertex_h", endVertexId: "vertex_e" },
  );
  source.paths.push({
    id: "path_hole",
    closed: true,
    segments: [
      { segmentId: "segment_ef", reversed: false },
      { segmentId: "segment_fg", reversed: false },
      { segmentId: "segment_gh", reversed: false },
      { segmentId: "segment_he", reversed: false },
    ],
  });
  source.regions[0]!.loops.push({ pathId: "path_hole", reversed: true });
  return source;
}

function concaveFourCrossingNetwork(): VectorNetwork {
  const points = [
    [0, 0],
    [100, 0],
    [100, 100],
    [70, 100],
    [70, 30],
    [30, 30],
    [30, 100],
    [0, 100],
  ] as const;
  const vertexIds = points.map((_point, index) => `vertex_concave_${index}`);
  const segmentIds = points.map((_point, index) => `segment_concave_${index}`);
  return {
    vertices: points.map(([x, y], index) => ({
      id: vertexIds[index]!,
      x,
      y,
    })),
    segments: points.map((_point, index) => ({
      id: segmentIds[index]!,
      startVertexId: vertexIds[index]!,
      endVertexId: vertexIds[(index + 1) % vertexIds.length]!,
    })),
    paths: [
      {
        id: "path_concave",
        closed: true,
        segments: segmentIds.map((segmentId) => ({
          segmentId,
          reversed: false,
        })),
      },
    ],
    regions: [
      {
        id: "region_concave",
        windingRule: "nonzero",
        loops: [{ pathId: "path_concave", reversed: false }],
      },
    ],
  };
}

function documentWithVector(): DesignDocument {
  const document = structuredClone(createWelcomeDocument());
  const frame = document.nodesById.frame_welcome;
  if (!frame || frame.kind !== "frame")
    throw new Error("Missing welcome frame");
  const node: VectorNode = {
    id: "vector_editable",
    name: "Editable curve",
    parentId: frame.id,
    childIds: [],
    visible: true,
    locked: false,
    transform: [0, 1, -1, 0, 100, 200],
    size: { width: 100, height: 100 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "vector",
    properties: {
      network: network(),
      fillRule: "nonzero",
      fills: [],
      strokes: [{ type: "solid", color: "#151515", opacity: 1 }],
      strokeWidth: 2,
    },
  };
  document.nodesById[node.id] = node;
  frame.childIds.push(node.id);
  return document;
}

function documentWithSiblingVector(): {
  document: DesignDocument;
  first: VectorNode;
  second: VectorNode;
} {
  const document = documentWithVector();
  const frame = document.nodesById.frame_welcome;
  const first = document.nodesById.vector_editable;
  if (!frame || frame.kind !== "frame" || !first || first.kind !== "vector") {
    throw new Error("Missing cross-layer Connect fixture");
  }
  const second = structuredClone(first);
  second.id = "vector_appended";
  second.name = "Appended curve";
  second.transform = [1, 0, 0, 1, 260, 200];
  document.nodesById[second.id] = second;
  frame.childIds.push(second.id);
  return { document, first, second };
}

function connectSiblingEndpoints(fixture: {
  document: DesignDocument;
  first: VectorNode;
  second: VectorNode;
}) {
  return planVectorLayersEndpointConnect(fixture.document, "page_welcome", [
    { nodeId: fixture.first.id, vertexId: "vertex_c" },
    { nodeId: fixture.second.id, vertexId: "vertex_a" },
  ]);
}

describe("vector editing runtime plans", () => {
  it("connects sibling Vector endpoints across layer transforms in one revision", () => {
    const { document, first, second } = documentWithSiblingVector();
    const sourceBeforePlan = structuredClone(document);

    const plan = planVectorLayersEndpointConnect(document, "page_welcome", [
      { nodeId: first.id, vertexId: "vertex_c" },
      { nodeId: second.id, vertexId: "vertex_a" },
    ]);
    expect(document).toEqual(sourceBeforePlan);
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "update_properties",
          nodeId: first.id,
        }),
        expect.objectContaining({ type: "delete_element", nodeId: second.id }),
      ]),
    );
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "connect_vector_layers",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Connect vector layers",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true, revision: { revision: 1 } });
    const result = runtime.getSnapshot().document.nodesById[first.id];
    expect(runtime.getSnapshot().document.nodesById[second.id]).toBeUndefined();
    if (
      !result ||
      result.kind !== "vector" ||
      !("network" in result.properties)
    ) {
      throw new Error("Missing connected Vector result");
    }
    expect(result.properties.network.paths).toHaveLength(1);
    expect(
      new Set(result.properties.network.vertices.map(({ id }) => id)).size,
    ).toBe(result.properties.network.vertices.length);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.nodesById[second.id]).toBeDefined();
  });

  it("rejects unsafe cross-layer Connect targets before producing operations", () => {
    const nonSibling = documentWithSiblingVector();
    const frame = nonSibling.document.nodesById.frame_welcome;
    const page = nonSibling.document.pagesById.page_welcome;
    if (!frame || frame.kind !== "frame" || !page) throw new Error("Fixture");
    frame.childIds = frame.childIds.filter(
      (nodeId) => nodeId !== nonSibling.second.id,
    );
    nonSibling.second.parentId = null;
    page.rootNodeIds.push(nonSibling.second.id);
    expect(connectSiblingEndpoints(nonSibling)).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });

    const appearance = documentWithSiblingVector();
    appearance.second.properties.strokeWidth = 4;
    expect(connectSiblingEndpoints(appearance)).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });

    const locked = documentWithSiblingVector();
    locked.second.locked = true;
    expect(connectSiblingEndpoints(locked)).toMatchObject({
      ok: false,
      code: "locked",
    });

    const singular = documentWithSiblingVector();
    singular.first.transform = [0, 0, 0, 0, 0, 0];
    expect(connectSiblingEndpoints(singular)).toMatchObject({
      ok: false,
      code: "non-invertible",
    });

    const internalVertex = documentWithSiblingVector();
    const branch = planVectorLayersEndpointConnect(
      internalVertex.document,
      "page_welcome",
      [
        { nodeId: internalVertex.first.id, vertexId: "vertex_b" },
        { nodeId: internalVertex.second.id, vertexId: "vertex_a" },
      ],
    );
    expect(branch).toMatchObject({ ok: true });
    if (branch.ok) expect(branch.layerConnectResult).toBeDefined();

    const sameLayer = documentWithVector();
    const sameLayerPlan = planVectorLayersEndpointConnect(
      sameLayer,
      "page_welcome",
      [
        { nodeId: "vector_editable", vertexId: "vertex_a" },
        { nodeId: "vector_editable", vertexId: "vertex_c" },
      ],
    );
    expect(sameLayerPlan).toMatchObject({ ok: true });
    if (sameLayerPlan.ok) {
      expect(
        sameLayerPlan.operations.some(
          (operation) => operation.type === "delete_element",
        ),
      ).toBe(false);
    }
  });

  it("creates a branch and keeps point editing writable", () => {
    const document = documentWithVector();
    const node = document.nodesById.vector_editable;
    if (!node || node.kind !== "vector" || !("network" in node.properties)) {
      throw new Error("Missing editable Vector");
    }
    node.properties.network = branchCandidateNetwork();
    const branch = planVectorSemanticEdit(document, "page_welcome", node.id, {
      action: "connect-endpoints",
      vertexIds: ["vertex_c", "vertex_e"],
    });
    expect(branch).toMatchObject({ ok: true });
    if (!branch.ok) return;
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "create_vector_branch",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Create vector branch",
        commands: [...branch.operations],
      }),
    ).toMatchObject({ ok: true, revision: { revision: 1 } });
    const branched = runtime.getSnapshot().document;
    expect(
      resolveVectorEditScope(
        branched,
        "page_welcome",
        [node.id],
        node.id,
        ["vertex_e"],
        ["segment_edit_1"],
      ),
    ).toMatchObject({
      activePathId: "path_open",
      readOnly: false,
      topologyEditable: false,
    });
    expect(
      planVectorSemanticEdit(branched, "page_welcome", node.id, {
        action: "transform-vertices",
        transform: [1, 0, 0, 1, 12, -8],
        vertexIds: ["vertex_e"],
      }),
    ).toMatchObject({ ok: true });
    expect(
      planVectorSemanticEdit(branched, "page_welcome", node.id, {
        action: "connect-endpoints",
        vertexIds: ["vertex_a", "vertex_d"],
      }),
    ).toMatchObject({ ok: true });
    expect(
      planVectorSemanticEdit(branched, "page_welcome", node.id, {
        action: "connect-endpoints",
        vertexIds: ["vertex_d", "vertex_f"],
      }),
    ).toMatchObject({ ok: true });
    expect(
      planVectorSemanticEdit(branched, "page_welcome", node.id, {
        action: "cut-path",
        at: { kind: "segment", segmentId: "segment_edit_1", t: 0.5 },
        pathId: "path_open",
      }),
    ).toMatchObject({
      ok: true,
      cutResult: {
        cutVertexIds: ["vertex_edit_1", "vertex_edit_2"],
        pathIds: ["path_open", "path_edit_1"],
      },
    });
    expect(
      planVectorSemanticEdit(branched, "page_welcome", node.id, {
        action: "cut-path",
        at: { kind: "vertex", vertexId: "vertex_e" },
        pathId: "path_branch_target",
      }),
    ).toMatchObject({ ok: true });
    expect(
      planVectorSemanticEdit(branched, "page_welcome", node.id, {
        action: "delete-segments",
        segmentIds: ["segment_edit_1"],
      }),
    ).toMatchObject({ ok: true });
    expect(
      planVectorSemanticEdit(branched, "page_welcome", node.id, {
        action: "delete-vertices",
        vertexIds: ["vertex_e"],
      }),
    ).toMatchObject({ ok: true });
    expect(
      planVectorSemanticEdit(branched, "page_welcome", node.id, {
        action: "disconnect-vertex",
        pathId: "path_branch_target",
        segmentId: "segment_de",
        vertexId: "vertex_e",
      }),
    ).toMatchObject({
      ok: true,
      cutResult: {
        cutVertexIds: ["vertex_e", "vertex_edit_1"],
        pathIds: ["path_branch_target", "path_edit_1"],
      },
    });
    const disconnect = planVectorSemanticEdit(
      branched,
      "page_welcome",
      node.id,
      {
        action: "disconnect-vertex",
        pathId: "path_open",
        vertexId: "vertex_e",
      },
    );
    expect(disconnect).toMatchObject({
      ok: true,
      cutResult: {
        cutVertexIds: ["vertex_e", "vertex_edit_1"],
        pathIds: ["path_open"],
      },
    });
    if (!disconnect.ok) return;
    expect(
      runtime.apply({
        transactionId: "disconnect_vector_branch",
        documentId: branched.documentId,
        baseRevision: branched.revision,
        actor: { type: "user", id: "local-user" },
        label: "Disconnect vector branch",
        commands: [...disconnect.operations],
      }),
    ).toMatchObject({ ok: true, revision: { revision: 2 } });
    expect(
      resolveVectorEditScope(
        runtime.getSnapshot().document,
        "page_welcome",
        [node.id],
        node.id,
        ["vertex_edit_1"],
      ),
    ).toMatchObject({ readOnly: false, topologyEditable: true });
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
  });

  it("disconnects one explicit edge from a closed branch junction atomically", () => {
    const document = documentWithVector();
    const node = document.nodesById.vector_editable;
    if (!node || node.kind !== "vector" || !("network" in node.properties)) {
      throw new Error("Missing editable Vector");
    }
    node.properties.network = closedNetwork();
    node.properties.network.vertices.push({
      id: "vertex_branch",
      x: 140,
      y: 40,
    });
    node.properties.network.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_b",
      endVertexId: "vertex_branch",
    });
    node.properties.network.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: false }],
    });
    const plan = planVectorSemanticEdit(document, "page_welcome", node.id, {
      action: "disconnect-vertex",
      pathId: "path_closed",
      segmentId: "segment_ab",
      vertexId: "vertex_b",
    });
    expect(plan).toMatchObject({
      ok: true,
      cutResult: {
        cutVertexIds: ["vertex_b", "vertex_edit_1"],
        pathIds: ["path_closed"],
      },
    });
    if (!plan.ok) return;
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "disconnect_closed_vector_branch",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Disconnect closed vector branch",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true, revision: { revision: 1 } });
    const network = vectorNetworkFrom(runtime);
    expect(network.paths.find(({ id }) => id === "path_closed")).toMatchObject({
      closed: false,
    });
    expect(network.regions).toEqual([]);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
  });

  it("flattens same-parent Vectors into one painted network and removes sources atomically", () => {
    const document = documentWithVector();
    const frame = document.nodesById.frame_welcome;
    const first = document.nodesById.vector_editable;
    if (!frame || frame.kind !== "frame" || !first || first.kind !== "vector") {
      throw new Error("Missing flatten fixture");
    }
    const second = structuredClone(first);
    second.id = "vector_second";
    second.name = "Second curve";
    second.transform = [1, 0, 0, 1, 320, 180];
    second.properties.strokes = [
      { type: "solid", color: "#2563eb", opacity: 1 },
    ];
    document.nodesById[second.id] = second;
    frame.childIds.push(second.id);
    const runtime = new EditorRuntime(document);
    const plan = planFlattenNodes(
      document,
      "page_welcome",
      [first.id, second.id],
      "vector_flattened",
      "flatten",
      geometry,
    );
    expect(plan).toMatchObject({
      ok: true,
      flattenResult: {
        resultNodeId: "vector_flattened",
        sourceNodeIds: [first.id, second.id],
      },
    });
    if (!plan.ok) return;
    const applied = runtime.apply({
      transactionId: "flatten_vectors",
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: { type: "user", id: "local-user" },
      label: "Flatten",
      commands: [...plan.operations],
    });
    expect(applied).toMatchObject({ ok: true });
    const flattened = runtime.getSnapshot().document.nodesById.vector_flattened;
    expect(runtime.getSnapshot().document.nodesById[first.id]).toBeUndefined();
    expect(runtime.getSnapshot().document.nodesById[second.id]).toBeUndefined();
    expect(flattened).toMatchObject({
      kind: "vector",
      properties: { fills: [], strokes: [], strokeWidth: 0 },
    });
    if (
      !flattened ||
      flattened.kind !== "vector" ||
      !("network" in flattened.properties)
    ) {
      throw new Error("Missing flattened Vector");
    }
    expect(
      flattened.properties.network.regions.map((region) => region.fills),
    ).toEqual([
      [{ type: "solid", color: "#151515", opacity: 1 }],
      [{ type: "solid", color: "#2563eb", opacity: 1 }],
    ]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.nodesById[first.id]).toBeDefined();
    expect(runtime.getSnapshot().document.nodesById[second.id]).toBeDefined();
    expect(
      runtime.getSnapshot().document.nodesById.vector_flattened,
    ).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    const reopenedFlattened =
      reopened.getSnapshot().document.nodesById.vector_flattened;
    expect(reopenedFlattened?.kind).toBe("vector");
    expect(reopened.getSnapshot().document.nodesById[first.id]).toBeUndefined();
    expect(
      reopened.getSnapshot().document.nodesById[second.id],
    ).toBeUndefined();
  });

  it("materializes a Vector region Paint Style while flattening", () => {
    const document = documentWithVector();
    const source = document.nodesById.vector_editable;
    if (
      !source ||
      source.kind !== "vector" ||
      !("network" in source.properties)
    ) {
      throw new Error("Missing vector");
    }
    source.properties.network = closedNetwork();
    source.properties.network.regions[0]!.fillStyleId = "brand-accent";
    source.properties.strokes = [];
    source.properties.strokeWidth = 0;
    document.stylesById["brand-accent"] = {
      id: "brand-accent",
      key: "brand-accent-key",
      name: "Brand/Accent",
      description: "",
      hiddenFromPublishing: false,
      styleType: "PAINT",
      paints: [{ type: "solid", color: "#7c3aed", opacity: 1 }],
      extensions: {},
    };
    document.styleOrderByType.PAINT.push("brand-accent");

    const plan = planFlattenNodes(
      document,
      "page_welcome",
      [source.id],
      "vector_flattened_style",
      "flatten_style",
      geometry,
    );
    if (!plan.ok) throw new Error(plan.message);
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "flatten_style",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten styled region",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(
      vectorNetworkFrom(runtime, "vector_flattened_style").regions[0]?.fills,
    ).toEqual([{ type: "solid", color: "#7c3aed", opacity: 1 }]);
    expect(
      vectorNetworkFrom(runtime, "vector_flattened_style").regions[0],
    ).not.toHaveProperty("fillStyleId");
  });

  it("flattens regular shapes and a plain Line into one editable Vector", () => {
    const document = structuredClone(createWelcomeDocument());
    const rectangle = document.nodesById.feature_one;
    const parent = rectangle?.parentId
      ? document.nodesById[rectangle.parentId]
      : undefined;
    if (!parent || rectangle?.kind !== "rectangle") {
      throw new Error("Missing regular shape fixture");
    }
    rectangle.properties.cornerRadius = 12;
    const ellipse = {
      ...structuredClone(rectangle),
      id: "flatten_ellipse",
      kind: "ellipse" as const,
      name: "Ellipse",
      transform: [
        1, 0, 0, 1, 360, 180,
      ] as DesignDocument["nodesById"][string]["transform"],
      properties: {
        fills: [{ type: "solid" as const, color: "#2563eb", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
    };
    const line = {
      ...structuredClone(rectangle),
      id: "flatten_line",
      kind: "line" as const,
      name: "Line",
      transform: [
        1, 0, 0, 1, 520, 220,
      ] as DesignDocument["nodesById"][string]["transform"],
      size: { width: 120, height: 40 },
      properties: {
        fills: [],
        strokes: [{ type: "solid" as const, color: "#db2777", opacity: 1 }],
        strokeWidth: 8,
        strokeAlign: "center" as const,
        strokeCap: "round" as const,
        strokeJoin: "round" as const,
        dashPattern: [],
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        startEndpoint: "none" as const,
        endEndpoint: "none" as const,
      },
    };
    document.nodesById[ellipse.id] = ellipse;
    document.nodesById[line.id] = line;
    ellipse.parentId = parent.id;
    line.parentId = parent.id;
    parent.childIds.push(ellipse.id, line.id);

    const plan = planFlattenNodes(
      document,
      "page_welcome",
      [rectangle.id, ellipse.id, line.id],
      "flattened_shapes",
      "flatten_shapes",
      geometry,
    );
    if (!plan.ok) throw new Error(plan.message);
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "flatten_shapes",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten shapes",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.nodesById[rectangle.id],
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById[ellipse.id],
    ).toBeUndefined();
    expect(runtime.getSnapshot().document.nodesById[line.id]).toBeUndefined();
    const result = vectorNetworkFrom(runtime, "flattened_shapes");
    expect(result.regions).toHaveLength(3);
    expect(result.regions.map((region) => region.fills?.[0])).toEqual([
      rectangle.properties.fills[0],
      ellipse.properties.fills[0],
      line.properties.strokes[0],
    ]);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById[rectangle.id],
    ).toBeDefined();
    expect(runtime.getSnapshot().document.nodesById[ellipse.id]).toBeDefined();
    expect(runtime.getSnapshot().document.nodesById[line.id]).toBeDefined();
  });

  it("flattens one resolved Boolean and destructively replaces its operands", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const booleanPlan = planCreateBooleanGroup(
      runtime.getSnapshot().document,
      "page_welcome",
      ["feature_one", "feature_two"],
      "union",
      {
        booleanId: "boolean_features",
        commandPrefix: "boolean_features",
        name: "Feature union",
      },
    );
    expect(booleanPlan).toMatchObject({ ok: true });
    if (!booleanPlan.ok) return;
    expect(
      runtime.apply({
        transactionId: "create_feature_boolean",
        documentId: runtime.getSnapshot().document.documentId,
        baseRevision: runtime.getSnapshot().document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Create feature Boolean",
        commands: [...booleanPlan.commands],
      }),
    ).toMatchObject({ ok: true });

    const flattenPlan = planFlattenNodes(
      runtime.getSnapshot().document,
      "page_welcome",
      ["boolean_features"],
      "flattened_boolean",
      "flatten_boolean",
      geometry,
    );
    expect(flattenPlan).toMatchObject({ ok: true });
    if (!flattenPlan.ok) return;
    expect(
      runtime.apply({
        transactionId: "flatten_feature_boolean",
        documentId: runtime.getSnapshot().document.documentId,
        baseRevision: runtime.getSnapshot().document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten feature Boolean",
        commands: [...flattenPlan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.nodesById.boolean_features,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.feature_one,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.feature_two,
    ).toBeUndefined();
    const flattened = vectorNetworkFrom(runtime, "flattened_boolean");
    expect(flattened.regions.length).toBeGreaterThan(0);
    expect(
      flattened.regions.every((region) => region.fills?.length === 1),
    ).toBe(true);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.boolean_features,
    ).toBeDefined();
    expect(runtime.getSnapshot().document.nodesById.feature_one).toBeDefined();
    expect(runtime.getSnapshot().document.nodesById.feature_two).toBeDefined();
  });

  it("flattens nested Group geometry in stable child order and parent space", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    const featureGroup = document.nodesById.feature_group;
    if (!frame || frame.kind !== "frame" || featureGroup?.kind !== "group") {
      throw new Error("Missing nested Group fixture");
    }
    frame.childIds = frame.childIds.map((id) =>
      id === featureGroup.id ? "nested_feature_group" : id,
    );
    featureGroup.parentId = "nested_feature_group";
    featureGroup.transform = [1, 0, 0, 1, 14, 20];
    document.nodesById.nested_feature_group = {
      id: "nested_feature_group",
      kind: "group",
      name: "Nested capabilities",
      parentId: frame.id,
      childIds: [featureGroup.id],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 50, 320],
      size: { width: 992, height: 252 },
      opacity: 1,
      exportSettings: [],
      properties: {},
      extensions: {},
    };
    const runtime = new EditorRuntime(document);
    const plan = planFlattenNodes(
      runtime.getSnapshot().document,
      "page_welcome",
      ["nested_feature_group"],
      "flattened_group",
      "flatten_group",
      geometry,
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(
      runtime.apply({
        transactionId: "flatten_feature_group",
        documentId: runtime.getSnapshot().document.documentId,
        baseRevision: runtime.getSnapshot().document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten feature Group",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });

    expect(
      runtime.getSnapshot().document.nodesById.nested_feature_group,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.feature_group,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.feature_one,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.feature_two,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.feature_three,
    ).toBeUndefined();
    const result = runtime.getSnapshot().document.nodesById.flattened_group;
    expect(result).toMatchObject({
      kind: "vector",
      parentId: "frame_welcome",
      transform: [1, 0, 0, 1, 64, 340],
    });
    expect(vectorNetworkFrom(runtime, "flattened_group").regions).toHaveLength(
      3,
    );
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.nested_feature_group,
    ).toBeDefined();
    expect(
      runtime.getSnapshot().document.nodesById.feature_group,
    ).toBeDefined();
    expect(runtime.getSnapshot().document.nodesById.feature_one).toBeDefined();
    expect(runtime.getSnapshot().document.nodesById.feature_two).toBeDefined();
    expect(
      runtime.getSnapshot().document.nodesById.feature_three,
    ).toBeDefined();
  });

  it("flattens an unclipped Frame in visual paint order and preserves undo", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    const featureOne = document.nodesById.feature_one;
    const featureTwo = document.nodesById.feature_two;
    const featureThree = document.nodesById.feature_three;
    if (
      !frame ||
      frame.kind !== "frame" ||
      featureOne?.kind !== "rectangle" ||
      featureTwo?.kind !== "rectangle" ||
      featureThree?.kind !== "ellipse"
    ) {
      throw new Error("Missing Frame fixture");
    }
    frame.childIds = ["feature_group"];
    frame.properties.clipsContent = false;
    frame.properties.strokes = [
      { type: "solid", color: "#dc2626", opacity: 1 },
    ];
    frame.properties.strokeWidth = 4;
    frame.properties.strokeAlign = "center";
    delete document.nodesById.shape_accent;
    delete document.nodesById.title_welcome;
    delete document.nodesById.subtitle_welcome;

    const runtime = new EditorRuntime(document);
    const plan = planFlattenNodes(
      runtime.getSnapshot().document,
      "page_welcome",
      [frame.id],
      "flattened_frame",
      "flatten_frame",
      geometry,
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(
      runtime.apply({
        transactionId: "flatten_unclipped_frame",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten Frame",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });

    const result = runtime.getSnapshot().document.nodesById.flattened_frame;
    expect(result).toMatchObject({ kind: "vector", parentId: null });
    expect(vectorNetworkFrom(runtime, "flattened_frame").regions).toHaveLength(
      5,
    );
    expect(
      vectorNetworkFrom(runtime, "flattened_frame").regions.map(
        (region) => region.fills?.[0],
      ),
    ).toEqual([
      frame.properties.fills[0],
      featureOne.properties.fills[0],
      featureTwo.properties.fills[0],
      featureThree.properties.fills[0],
      frame.properties.strokes[0],
    ]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome,
    ).toBeDefined();
    expect(runtime.getSnapshot().document.nodesById.feature_one).toBeDefined();
    expect(
      runtime.getSnapshot().document.nodesById.flattened_frame,
    ).toBeUndefined();
  });

  it("clips supported Frame descendants to the exact Frame boundary", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    const featureOne = document.nodesById.feature_one;
    const featureTwo = document.nodesById.feature_two;
    if (
      !frame ||
      frame.kind !== "frame" ||
      featureOne?.kind !== "rectangle" ||
      featureTwo?.kind !== "rectangle"
    ) {
      throw new Error("Missing Frame fixture");
    }
    frame.childIds = ["feature_group"];
    frame.properties.clipsContent = true;
    frame.size = { width: 500, height: 450 };
    delete document.nodesById.shape_accent;
    delete document.nodesById.title_welcome;
    delete document.nodesById.subtitle_welcome;

    const runtime = new EditorRuntime(document);
    const plan = planFlattenNodes(
      document,
      "page_welcome",
      [frame.id],
      "clipped_frame_result",
      "clipped_frame",
      geometry,
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(
      runtime.apply({
        transactionId: "flatten_clipped_frame",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten clipped Frame",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });

    const result =
      runtime.getSnapshot().document.nodesById.clipped_frame_result;
    expect(result).toMatchObject({
      kind: "vector",
      parentId: null,
      size: frame.size,
      transform: frame.transform,
    });
    expect(
      vectorNetworkFrom(runtime, "clipped_frame_result").regions.map(
        (region) => region.fills?.[0],
      ),
    ).toEqual([
      frame.properties.fills[0],
      featureOne.properties.fills[0],
      featureTwo.properties.fills[0],
    ]);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.nodesById[frame.id]).toBeDefined();
  });

  it("flattens an Image into rounded editable geometry with an exact crop paint", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") {
      throw new Error("Missing Image Flatten fixture");
    }
    document.assetsById.photo = {
      id: "photo",
      kind: "image",
      name: "Photo",
      mimeType: "image/png",
      source: { type: "data", value: "aW1hZ2U=" },
      size: { width: 400, height: 200 },
      extensions: {},
    };
    const image: ImageNode = {
      id: "photo_node",
      kind: "image",
      name: "Photo",
      parentId: frame.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 300, 240],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      properties: {
        assetId: "photo",
        placement: {
          mode: "fill",
          focalPoint: { x: 0.5, y: 0.5 },
        },
        filters: { exposure: 0.2, shadows: -0.4 },
        altText: "Photo",
        cornerRadius: 12,
      },
    };
    document.nodesById[image.id] = image;
    frame.childIds.push(image.id);

    const plan = planFlattenNodes(
      document,
      "page_welcome",
      [image.id],
      "flattened_photo",
      "flatten_photo",
      geometry,
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) throw new Error(plan.message);
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "flatten_photo",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten Image",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });

    const result = runtime.getSnapshot().document.nodesById.flattened_photo;
    expect(result).toMatchObject({
      kind: "vector",
      transform: image.transform,
      size: image.size,
    });
    const network = vectorNetworkFrom(runtime, "flattened_photo");
    expect(network.regions).toHaveLength(1);
    expect(network.regions[0]?.fills).toEqual([
      {
        type: "image",
        assetId: "photo",
        fit: "crop",
        opacity: 1,
        scale: { x: 0.5, y: 0.5 },
        offset: { x: -50, y: 0 },
        rotation: 0,
        filters: { exposure: 0.2, shadows: -0.4 },
      },
    ]);
    expect(network.segments.some((segment) => segment.tangentStart)).toBe(true);
    expect(runtime.getSnapshot().document.nodesById[image.id]).toBeUndefined();
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.nodesById[image.id]).toBeDefined();
  });

  it("rejects rounded regular shapes and decorated Lines until exact outlines exist", () => {
    const document = structuredClone(createWelcomeDocument());
    const rectangle = document.nodesById.feature_one;
    const parent = rectangle?.parentId
      ? document.nodesById[rectangle.parentId]
      : undefined;
    if (!parent || rectangle?.kind !== "rectangle") {
      throw new Error("Missing flatten rejection fixture");
    }
    const polygon = {
      ...structuredClone(rectangle),
      id: "rounded_polygon",
      kind: "polygon" as const,
      properties: {
        ...rectangle.properties,
        pointCount: 5,
        cornerRadius: 8,
      },
    };
    const line = {
      ...structuredClone(rectangle),
      id: "decorated_line",
      kind: "line" as const,
      properties: {
        fills: [],
        strokes: rectangle.properties.fills,
        strokeWidth: 4,
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        startEndpoint: "none" as const,
        endEndpoint: "triangle-arrow" as const,
      },
    };
    document.nodesById[polygon.id] = polygon;
    document.nodesById[line.id] = line;
    polygon.parentId = parent.id;
    line.parentId = parent.id;
    parent.childIds.push(polygon.id, line.id);

    expect(
      planFlattenNodes(
        document,
        "page_welcome",
        [polygon.id],
        "rounded_result",
        "rounded_result",
        geometry,
      ),
    ).toMatchObject({ ok: false, code: "unsupported-topology" });
    expect(
      planFlattenNodes(
        document,
        "page_welcome",
        [line.id],
        "decorated_result",
        "decorated_result",
        geometry,
      ),
    ).toMatchObject({ ok: false, code: "unsupported-topology" });
  });

  it("flattens exact Text glyph outlines while preserving Paint and transform", () => {
    const document = structuredClone(createWelcomeDocument());
    const text = document.nodesById.title_welcome;
    if (!text || text.kind !== "text") {
      throw new Error("Missing Text fixture");
    }
    text.properties = {
      ...text.properties,
      content: "A",
      maxLines: null,
      textOverflow: "visible",
      textResize: "auto-width",
      textTruncation: "disabled",
      textWrap: "none",
    };
    const runtime = new EditorRuntime(document);
    const plan = planFlattenNodes(
      document,
      "page_welcome",
      [text.id],
      "flattened_text",
      "flatten_text",
      geometry,
      glyphOutlineProvider(),
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(
      runtime.apply({
        transactionId: "flatten_text",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten Text",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });

    const result = runtime.getSnapshot().document.nodesById.flattened_text;
    expect(result).toMatchObject({
      kind: "vector",
      parentId: "frame_welcome",
      transform: [1, 0, 0, 1, 64, 104],
      size: { width: 12, height: 16 },
    });
    expect(
      vectorNetworkFrom(runtime, "flattened_text").regions[0]?.fills,
    ).toEqual(text.properties.fills);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.nodesById[text.id]).toBeDefined();
  });

  it("resolves current rich-text Style references before Flatten", () => {
    const document = structuredClone(createWelcomeDocument());
    const text = document.nodesById.title_welcome;
    if (!text || text.kind !== "text") throw new Error("Missing Text fixture");
    text.properties = {
      ...text.properties,
      content: "A",
      maxLines: null,
      textOverflow: "visible",
      textResize: "auto-width",
      textTruncation: "disabled",
      textWrap: "none",
      runs: [
        {
          start: 0,
          end: 1,
          style: {
            fontFamily: "Fallback Sans",
            fontStyleName: null,
            fontSize: 12,
            fontWeight: 400,
            fontSlant: "normal",
            lineHeight: 16,
            letterSpacing: 0,
            textCase: "original",
            textDecoration: "none",
            textDecorationStyle: null,
            textDecorationOffset: null,
            textDecorationThickness: null,
            textDecorationColor: null,
            textDecorationSkipInk: null,
            fills: [{ type: "solid", color: "#111111", opacity: 1 }],
            textStyleId: "flatten_text_style",
            fillStyleId: "flatten_paint_style",
          },
        },
      ],
    };
    document.stylesById.flatten_text_style = {
      id: "flatten_text_style",
      key: "flatten-text-style-key",
      name: "Display/Flatten",
      description: "",
      hiddenFromPublishing: false,
      styleType: "TEXT",
      textStyle: {
        fontFamily: "Inter",
        fontStyleName: "Bold",
        fontSize: 32,
        fontWeight: 700,
        fontSlant: "normal",
        lineHeight: 40,
        letterSpacing: 1,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        listSpacing: 0,
        hangingList: false,
        textCase: "original",
        textDecoration: "none",
        textDecorationStyle: null,
        textDecorationOffset: null,
        textDecorationThickness: null,
        textDecorationColor: null,
        textDecorationSkipInk: null,
      },
      extensions: {},
    };
    document.stylesById.flatten_paint_style = {
      id: "flatten_paint_style",
      key: "flatten-paint-style-key",
      name: "Brand/Flatten",
      description: "",
      hiddenFromPublishing: false,
      styleType: "PAINT",
      paints: [{ type: "solid", color: "#7c3aed", opacity: 1 }],
      extensions: {},
    };
    document.styleOrderByType.TEXT.push("flatten_text_style");
    document.styleOrderByType.PAINT.push("flatten_paint_style");
    let observedStyle: FlattenTextRunStyle | undefined;
    const baseProvider = glyphOutlineProvider();
    const provider: TextRunLayoutProvider<FlattenTextRunStyle> = {
      ...baseProvider,
      layout(request) {
        observedStyle = request.runs[0]?.style;
        return baseProvider.layout(request);
      },
    };

    const runtime = new EditorRuntime(document);
    const plan = planFlattenNodes(
      document,
      "page_welcome",
      [text.id],
      "styled_flattened_text",
      "styled_flatten_text",
      geometry,
      provider,
    );
    expect(plan).toMatchObject({ ok: true });
    expect(observedStyle).toMatchObject({
      fontFamily: "Inter",
      fontStyleName: "Bold",
      fontSize: 32,
      fontWeight: 700,
    });
    if (!plan.ok) return;
    expect(
      runtime.apply({
        transactionId: "flatten_styled_text",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten Styled Text",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(
      vectorNetworkFrom(runtime, "styled_flattened_text").regions[0]?.fills,
    ).toEqual([{ type: "solid", color: "#7c3aed", opacity: 1 }]);
  });

  it("flattens exact underline outlines from the glyph provider", () => {
    const document = structuredClone(createWelcomeDocument());
    const text = document.nodesById.title_welcome;
    if (!text || text.kind !== "text") throw new Error("Missing Text fixture");
    text.properties = {
      ...text.properties,
      content: "A",
      maxLines: null,
      textDecoration: "underline",
      textDecorationStyle: "solid",
      textDecorationOffset: { unit: "auto" },
      textDecorationThickness: { unit: "auto" },
      textDecorationColor: {
        value: { type: "solid", color: "#2563eb", opacity: 0.75 },
      },
      textDecorationSkipInk: false,
      textOverflow: "visible",
      textResize: "auto-width",
      textTruncation: "disabled",
      textWrap: "none",
    };
    const runtime = new EditorRuntime(document);
    const plan = planFlattenNodes(
      document,
      "page_welcome",
      [text.id],
      "underlined_flattened_text",
      "underlined_flatten_text",
      geometry,
      glyphOutlineProvider(),
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(
      runtime.apply({
        transactionId: "flatten_underlined_text",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten Underlined Text",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    const network = vectorNetworkFrom(runtime, "underlined_flattened_text");
    expect(network.regions).toHaveLength(2);
    expect(network.regions.map((region) => region.fills)).toEqual([
      text.properties.fills,
      [{ type: "solid", color: "#2563eb", opacity: 0.75 }],
    ]);
  });

  it("flattens only the exact ending-truncation display glyphs", () => {
    const document = structuredClone(createWelcomeDocument());
    const text = document.nodesById.title_welcome;
    if (!text || text.kind !== "text") throw new Error("Missing Text fixture");
    text.properties = {
      ...text.properties,
      content: "ABCD",
      maxLines: 1,
      textOverflow: "visible",
      textResize: "auto-height",
      textTruncation: "ending",
      textWrap: "character",
    };
    text.size = { width: 48, height: 16 };
    const provider: TextRunLayoutProvider<FlattenTextRunStyle> = {
      id: "test-ending-outlines",
      version: "1",
      layout(request) {
        const displayContent = "A...";
        return {
          ok: true,
          provider: "test-ending-outlines",
          providerVersion: "1",
          size: { width: request.width!, height: 16 },
          contentBounds: { x: 0, y: 0, width: 40, height: 16 },
          displayContent,
          fragments: [
            {
              baseline: 12,
              end: displayContent.length,
              glyphs: [...displayContent].map((_, index) => ({
                clusterEnd: index + 1,
                clusterStart: index,
                glyphId: index + 1,
                path: "M0 0L8 0L8 16L0 16Z",
                x: index * 10,
                xAdvance: 10,
                y: 0,
                yAdvance: 0,
              })),
              height: 16,
              lineIndex: 0,
              start: 0,
              style: request.baseStyle,
              text: displayContent,
              width: 40,
              x: 0,
              y: 0,
            },
          ],
          fullContentBounds: { x: 0, y: 0, width: 48, height: 32 },
          lines: [
            {
              baseline: 12,
              end: displayContent.length,
              height: 16,
              start: 0,
              width: 40,
              x: 0,
              y: 0,
            },
          ],
          markers: [],
          sourceContentEnd: 1,
          truncated: true,
          warnings: [],
        };
      },
    };
    const runtime = new EditorRuntime(document);
    const plan = planFlattenNodes(
      document,
      "page_welcome",
      [text.id],
      "ending_flattened_text",
      "ending_flatten_text",
      geometry,
      provider,
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(
      runtime.apply({
        transactionId: "flatten_ending_text",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Flatten Ending Text",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(
      vectorNetworkFrom(runtime, "ending_flattened_text").regions,
    ).toHaveLength(4);
  });

  it("rejects Text when an exact glyph-outline provider is unavailable", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    const group = document.nodesById.feature_group;
    const text = document.nodesById.title_welcome;
    if (!frame || frame.kind !== "frame" || group?.kind !== "group" || !text) {
      throw new Error("Missing unsupported Group fixture");
    }
    if (text.kind !== "text") throw new Error("Missing Text fixture");
    text.properties = {
      ...text.properties,
      content: "A",
      maxLines: null,
      textOverflow: "visible",
      textResize: "auto-width",
      textTruncation: "disabled",
      textWrap: "none",
    };
    frame.childIds = frame.childIds.filter((id) => id !== text.id);
    group.childIds.push(text.id);
    text.parentId = group.id;

    expect(
      planFlattenNodes(
        document,
        "page_welcome",
        [group.id],
        "unsupported_group_result",
        "unsupported_group",
        geometry,
      ),
    ).toEqual({
      ok: false,
      code: "unsupported-topology",
      message: `Text ${text.id} requires an exact glyph-outline provider before Flatten`,
    });
    expect(document.nodesById[group.id]).toBeDefined();
    expect(document.nodesById[text.id]).toBeDefined();
  });

  it("returns a controlled failure when the glyph-outline provider throws", () => {
    const document = structuredClone(createWelcomeDocument());
    const text = document.nodesById.title_welcome;
    if (!text || text.kind !== "text") {
      throw new Error("Missing Text fixture");
    }
    text.properties = {
      ...text.properties,
      content: "A",
      maxLines: null,
      textOverflow: "visible",
      textResize: "auto-width",
      textTruncation: "disabled",
      textWrap: "none",
    };
    const provider: TextRunLayoutProvider<FlattenTextRunStyle> = {
      id: "throwing-provider",
      version: "1",
      layout() {
        throw new Error("font payload unavailable");
      },
    };

    expect(
      planFlattenNodes(
        document,
        "page_welcome",
        [text.id],
        "text-flatten-result",
        "text-flatten-throw",
        geometry,
        provider,
      ),
    ).toEqual({
      ok: false,
      code: "unsupported-topology",
      message: `Text ${text.id} glyph outline provider failed: font payload unavailable`,
    });
  });

  it("creates an editable outline sibling and preserves source through history", () => {
    const document = documentWithVector();
    const source = document.nodesById.vector_editable;
    if (
      !source ||
      source.kind !== "vector" ||
      !("network" in source.properties)
    ) {
      throw new Error("Missing editable vector fixture");
    }
    source.properties.network = closedNetwork();
    source.properties.cornerRadius = 12;
    source.properties.cornerSmoothing = 0.6;
    const runtime = new EditorRuntime(document);
    const before = runtime.getSnapshot();
    const plan = planVectorOutlineStroke(
      before.document,
      "page_welcome",
      "vector_editable",
      "vector_outline",
      "outline",
      geometry,
    );
    expect(plan).toMatchObject({
      ok: true,
      outlineResult: {
        sourceNodeId: "vector_editable",
        resultNodeId: "vector_outline",
      },
    });
    if (!plan.ok) return;
    const applied = runtime.apply({
      transactionId: "outline_vector",
      documentId: before.document.documentId,
      baseRevision: before.document.revision,
      actor: { type: "user", id: "local-user" },
      label: "Outline stroke",
      commands: [...plan.operations],
    });
    if (!applied.ok) throw new Error(JSON.stringify(applied.error));
    expect(applied).toMatchObject({ ok: true });
    const result = runtime.getSnapshot().document.nodesById.vector_outline;
    expect(result).toMatchObject({
      kind: "vector",
      parentId: "frame_welcome",
      properties: {
        cornerRadius: 0,
        cornerSmoothing: 0,
        fills: [{ type: "solid", color: "#151515", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.vector_editable,
    ).toBeDefined();
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.vector_outline,
    ).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    const reopenedOutline =
      reopened.getSnapshot().document.nodesById.vector_outline;
    expect(reopenedOutline?.kind).toBe("vector");
    if (
      !reopenedOutline ||
      reopenedOutline.kind !== "vector" ||
      !("network" in reopenedOutline.properties)
    ) {
      throw new Error("Missing reopened outlined vector");
    }
    expect(reopenedOutline.properties.network.regions.length).toBeGreaterThan(
      0,
    );
  });

  it("plans one region paint as one undoable vector network update", () => {
    const document = documentWithVector();
    const vector = document.nodesById.vector_editable;
    if (
      !vector ||
      vector.kind !== "vector" ||
      !("network" in vector.properties)
    ) {
      throw new Error("Missing vector");
    }
    vector.properties.network = closedNetwork();
    const plan = planVectorSemanticEdit(document, "page_welcome", vector.id, {
      action: "set-region-fills",
      regionId: "region_face",
      fills: [{ type: "solid", color: "#22c55e", opacity: 1 }],
    });
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    const runtime = new EditorRuntime(document);
    const applied = runtime.apply({
      transactionId: "paint_region",
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: { type: "user", id: "test" },
      label: "Paint region",
      commands: [...plan.operations],
    });
    expect(applied.ok).toBe(true);
    const painted = runtime.getSnapshot().document.nodesById.vector_editable;
    if (
      !painted ||
      painted.kind !== "vector" ||
      !("network" in painted.properties)
    ) {
      throw new Error("Missing vector");
    }
    expect(painted.properties.network.regions[0]?.fills).toEqual([
      { type: "solid", color: "#22c55e", opacity: 1 },
    ]);
    expect(runtime.undo().ok).toBe(true);
    const restored = runtime.getSnapshot().document.nodesById.vector_editable;
    if (
      !restored ||
      restored.kind !== "vector" ||
      !("network" in restored.properties)
    ) {
      throw new Error("Missing vector");
    }
    expect(restored.properties.network.regions[0]?.fills).toBeUndefined();
  });

  it("links one Vector region to a PAINT Style and preserves it through history", () => {
    const document = documentWithVector();
    const vector = document.nodesById.vector_editable;
    if (
      !vector ||
      vector.kind !== "vector" ||
      !("network" in vector.properties)
    ) {
      throw new Error("Missing vector");
    }
    vector.properties.network = closedNetwork();
    document.stylesById["brand-accent"] = {
      id: "brand-accent",
      key: "brand-accent-key",
      name: "Brand/Accent",
      description: "",
      hiddenFromPublishing: false,
      styleType: "PAINT",
      paints: [{ type: "solid", color: "#7c3aed", opacity: 1 }],
      extensions: {},
    };
    document.styleOrderByType.PAINT.push("brand-accent");
    const plan = planVectorSemanticEdit(document, "page_welcome", vector.id, {
      action: "set-region-fill-style",
      regionId: "region_face",
      fillStyleId: "brand-accent",
    });
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "style_region",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "test" },
        label: "Style region",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(vectorNetworkFrom(runtime).regions[0]).toMatchObject({
      fillStyleId: "brand-accent",
    });
    expect(vectorNetworkFrom(runtime).regions[0]).not.toHaveProperty("fills");
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(vectorNetworkFrom(runtime).regions[0]?.fillStyleId).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(vectorNetworkFrom(reopened).regions[0]?.fillStyleId).toBe(
      "brand-accent",
    );
  });

  it("updates selected vertex stroke appearance as one undoable transaction", () => {
    const document = documentWithVector();
    const plan = planVectorSemanticEdit(
      document,
      "page_welcome",
      "vector_editable",
      {
        action: "set-vertex-stroke-appearance",
        strokeCap: "round",
        strokeJoin: "bevel",
        vertexIds: ["vertex_b"],
      },
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "style_vertex_stroke",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "test" },
        label: "Style vertex stroke",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(vectorNetworkFrom(runtime).vertices[1]).toMatchObject({
      id: "vertex_b",
      strokeCap: "round",
      strokeJoin: "bevel",
    });
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(vectorNetworkFrom(runtime).vertices[1]).not.toHaveProperty(
      "strokeCap",
    );
  });

  it("updates selected vertex corner radius as one undoable transaction", () => {
    const document = documentWithVector();
    const vector = document.nodesById.vector_editable;
    if (
      !vector ||
      (vector.kind !== "path" && vector.kind !== "vector") ||
      !("network" in vector.properties)
    ) {
      throw new Error("Missing vector");
    }
    vector.properties.network = closedNetwork();
    const plan = planVectorSemanticEdit(
      document,
      "page_welcome",
      "vector_editable",
      {
        action: "set-vertex-corner-radius",
        cornerRadius: 14,
        vertexIds: ["vertex_a", "vertex_b"],
      },
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "round_vector_vertices",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "test" },
        label: "Round vector vertices",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(vectorNetworkFrom(runtime).vertices.slice(0, 2)).toEqual([
      expect.objectContaining({ cornerRadius: 14 }),
      expect.objectContaining({ cornerRadius: 14 }),
    ]);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(vectorNetworkFrom(runtime).vertices[0]).not.toHaveProperty(
      "cornerRadius",
    );
  });

  it("updates node-level Vector corner smoothing as one undoable transaction", () => {
    const document = documentWithVector();
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "smooth_vector_corners",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "test" },
        label: "Smooth vector corners",
        commands: [
          {
            commandId: "set_vector_corner_smoothing",
            type: "update_properties",
            nodeId: "vector_editable",
            properties: { cornerRadius: 12, cornerSmoothing: 0.6 },
          },
        ],
      }),
    ).toMatchObject({ ok: true, revision: { revision: 1 } });
    const updated = runtime.getSnapshot().document.nodesById.vector_editable;
    expect(
      updated &&
        (updated.kind === "path" || updated.kind === "vector") &&
        "network" in updated.properties
        ? updated.properties
        : null,
    ).toMatchObject({ cornerRadius: 12, cornerSmoothing: 0.6 });
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    const restored = runtime.getSnapshot().document.nodesById.vector_editable;
    expect(
      restored &&
        (restored.kind === "path" || restored.kind === "vector") &&
        "network" in restored.properties
        ? restored.properties.cornerSmoothing
        : null,
    ).toBeUndefined();
  });

  it("derives selected point mode and locked read-only state without persisting edit UI", () => {
    const document = documentWithVector();
    expect(
      resolveVectorEditScope(
        document,
        "page_welcome",
        ["vector_editable"],
        "vector_editable",
        ["vertex_b"],
        ["segment_ab", "segment_missing"],
      ),
    ).toEqual({
      activePathId: "path_open",
      nodeId: "vector_editable",
      pathCount: 1,
      pointMode: "corner",
      readOnly: false,
      selectedSegmentIds: ["segment_ab"],
      selectedVertexIds: ["vertex_b"],
      topologyEditable: true,
    });

    document.nodesById.frame_welcome!.locked = true;
    expect(
      resolveVectorEditScope(
        document,
        "page_welcome",
        ["vector_editable"],
        "vector_editable",
        ["vertex_b"],
      ),
    ).toMatchObject({
      readOnly: true,
      readOnlyReason: "The vector or one of its ancestors is locked",
    });
  });

  it("resolves an ordered multi-Vector edit scope with one active layer", () => {
    const document = documentWithVector();
    const frame = document.nodesById.frame_welcome;
    const first = document.nodesById.vector_editable;
    if (!frame || frame.kind !== "frame" || !first) {
      throw new Error("Missing multi-layer vector fixture");
    }
    const second = structuredClone(first);
    second.id = "vector_second";
    document.nodesById[second.id] = second;
    frame.childIds.push(second.id);
    expect(
      resolveVectorEditCollectionScope(
        document,
        "page_welcome",
        [first.id, second.id],
        [first.id, second.id],
        second.id,
        {
          [first.id]: ["vertex_a"],
          [second.id]: ["vertex_b"],
        },
      ),
    ).toMatchObject({
      activeNodeId: "vector_second",
      nodeIds: ["vector_editable", "vector_second"],
      nodes: [
        { nodeId: "vector_editable", selectedVertexIds: ["vertex_a"] },
        { nodeId: "vector_second", selectedVertexIds: ["vertex_b"] },
      ],
    });
    expect(
      resolveVectorEditCollectionScope(
        document,
        "page_welcome",
        [second.id, first.id],
        [first.id, second.id],
        second.id,
        {},
      ),
    ).toBeNull();
    expect(
      resolveVectorEditCollectionScope(
        document,
        "page_welcome",
        [first.id, second.id],
        [first.id, second.id],
        "missing",
        {},
      ),
    ).toBeNull();
    expect(
      resolveVectorEditCollectionScope(
        document,
        "page_welcome",
        [first.id, first.id],
        [first.id, first.id],
        first.id,
        {},
      ),
    ).toBeNull();
  });

  it("normalizes edited geometry and composes its offset through the node transform", () => {
    const document = documentWithVector();
    const edited = network();
    edited.vertices = edited.vertices.map((vertex) => ({
      ...vertex,
      x: vertex.x - 10,
      y: vertex.y + 20,
    }));

    const plan = planVectorNetworkUpdate(
      document,
      "page_welcome",
      "vector_editable",
      edited,
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.operations[0]).toMatchObject({
      type: "update_properties",
      nodeId: "vector_editable",
      transform: [0, 1, -1, 0, 80, 190],
      size: { width: 100, height: 100 },
      properties: {
        network: {
          vertices: [
            { id: "vertex_a", x: 0, y: 0 },
            { id: "vertex_b", x: 100, y: 0 },
            { id: "vertex_c", x: 100, y: 100 },
          ],
        },
      },
    });
  });

  it("applies one revision and survives undo, redo, save, and reopen", () => {
    const runtime = new EditorRuntime(documentWithVector());
    const edited = network();
    edited.vertices[1] = {
      ...edited.vertices[1]!,
      x: 140,
      y: -30,
      handleMode: "mirrored",
    };
    edited.segments[0]!.tangentEnd = { x: -20, y: 10 };
    edited.segments[1]!.tangentStart = { x: 20, y: -10 };
    const beforeRevision = runtime.getSnapshot().document.revision;
    const plan = planVectorNetworkUpdate(
      runtime.getSnapshot().document,
      "page_welcome",
      "vector_editable",
      edited,
    );
    if (!plan.ok) throw new Error(plan.message);
    const result = runtime.apply({
      transactionId: "vector_edit_drag",
      documentId: runtime.getSnapshot().document.documentId,
      baseRevision: beforeRevision,
      actor: { type: "user", id: "local-user" },
      label: "Edit vector points",
      commands: [...plan.operations],
    });
    expect(result).toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.revision).toBe(beforeRevision + 1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });

    const saved = JSON.stringify(runtime.getSnapshot().document);
    const reopened = new EditorRuntime(JSON.parse(saved) as unknown);
    const node = reopened.getSnapshot().document.nodesById.vector_editable;
    expect(node?.kind).toBe("vector");
    if (!node || node.kind !== "vector" || !("network" in node.properties)) {
      throw new Error("Missing reopened editable vector");
    }
    expect(node.properties.network.vertices[1]?.handleMode).toBe("mirrored");
  });

  it("plans whole-node deletion when point deletion leaves no valid contour", () => {
    const document = documentWithVector();
    expect(
      planDeleteVectorNode(document, "page_welcome", "vector_editable"),
    ).toEqual({
      ok: true,
      operations: [
        {
          commandId: "delete_vector_vector_editable",
          type: "delete_element",
          nodeId: "vector_editable",
        },
      ],
    });
  });

  it("applies close, reverse, and open as atomic semantic edits that survive history and reopen", () => {
    const runtime = new EditorRuntime(documentWithVector());
    const applySemanticEdit = (
      transactionId: string,
      edit: VectorSemanticEdit,
    ) => {
      const snapshot = runtime.getSnapshot();
      const plan = planVectorSemanticEdit(
        snapshot.document,
        "page_welcome",
        "vector_editable",
        edit,
      );
      if (!plan.ok) throw new Error(plan.message);
      return runtime.apply({
        transactionId,
        documentId: snapshot.document.documentId,
        baseRevision: snapshot.document.revision,
        actor: { type: "user", id: "local-user" },
        label: transactionId,
        commands: [...plan.operations],
      });
    };

    expect(
      applySemanticEdit("close_vector", {
        action: "set-closed",
        closed: true,
      }),
    ).toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(vectorNetworkFrom(runtime).paths[0]?.closed).toBe(true);
    expect(vectorNetworkFrom(runtime).regions).toHaveLength(1);

    const closed = structuredClone(vectorNetworkFrom(runtime));
    expect(
      applySemanticEdit("reverse_vector", { action: "reverse-path" }),
    ).toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.revision).toBe(2);
    expect(vectorNetworkFrom(runtime).paths[0]?.segments).toEqual(
      [...(closed.paths[0]?.segments ?? [])]
        .reverse()
        .map((reference) => ({ ...reference, reversed: !reference.reversed })),
    );

    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(vectorNetworkFrom(runtime)).toEqual(closed);
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const saved = JSON.stringify(runtime.getSnapshot().document);
    const reopened = new EditorRuntime(JSON.parse(saved) as unknown);
    expect(vectorNetworkFrom(reopened)).toEqual(vectorNetworkFrom(runtime));

    expect(
      applySemanticEdit("open_vector", {
        action: "set-closed",
        closed: false,
      }),
    ).toMatchObject({ ok: true });
    expect(vectorNetworkFrom(runtime).paths[0]?.closed).toBe(false);
    expect(vectorNetworkFrom(runtime).regions).toEqual([]);
  });

  it("bends one segment through preview, revision, undo, and reopen", () => {
    const runtime = new EditorRuntime(documentWithVector());
    const before = runtime.getSnapshot();
    const plan = planVectorSemanticEdit(
      before.document,
      "page_welcome",
      "vector_editable",
      {
        action: "bend-segment",
        pathId: "path_open",
        point: { x: 90, y: 36 },
        segmentId: "segment_bc",
        t: 0.5,
      },
    );
    if (!plan.ok) throw new Error(plan.message);
    const transaction = {
      transactionId: "bend_vector",
      documentId: before.document.documentId,
      baseRevision: before.document.revision,
      actor: { type: "user" as const, id: "local-user" },
      label: "Bend vector segment",
      commands: [...plan.operations],
    };
    expect(runtime.preview(transaction)).toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.revision).toBe(0);
    expect(runtime.apply(transaction)).toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(vectorNetworkFrom(runtime).segments[1]?.tangentStart).toBeDefined();
    expect(vectorNetworkFrom(runtime).segments[1]?.tangentEnd).toBeDefined();
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      vectorNetworkFrom(runtime).segments[1]?.tangentStart,
    ).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(vectorNetworkFrom(reopened)).toEqual(vectorNetworkFrom(runtime));
  });

  it("rejects semantic no-ops, unsupported topology, and inherited locks", () => {
    const document = documentWithVector();
    expect(
      planVectorSemanticEdit(document, "page_welcome", "vector_editable", {
        action: "set-closed",
        closed: false,
      }),
    ).toMatchObject({ ok: false, code: "no-op" });

    const node = document.nodesById.vector_editable;
    if (!node || node.kind !== "vector" || !("network" in node.properties)) {
      throw new Error("Missing editable vector");
    }
    node.properties.network.paths.push({
      id: "path_extra",
      closed: false,
      segments: [{ segmentId: "segment_extra", reversed: false }],
    });
    node.properties.network.vertices.push({ id: "vertex_d", x: 180, y: 0 });
    node.properties.network.segments.push({
      id: "segment_extra",
      startVertexId: "vertex_c",
      endVertexId: "vertex_d",
    });
    expect(
      planVectorSemanticEdit(document, "page_welcome", "vector_editable", {
        action: "reverse-path",
      }),
    ).toMatchObject({ ok: false, code: "unsupported-topology" });

    const locked = documentWithVector();
    locked.nodesById.frame_welcome!.locked = true;
    expect(
      planVectorSemanticEdit(locked, "page_welcome", "vector_editable", {
        action: "reverse-path",
      }),
    ).toMatchObject({ ok: false, code: "locked" });
  });

  it("cuts a path through the semantic planner as one revision and preserves both editable contours", () => {
    const runtime = new EditorRuntime(documentWithVector());
    const before = runtime.getSnapshot();
    const plan = planVectorSemanticEdit(
      before.document,
      "page_welcome",
      "vector_editable",
      {
        action: "cut-path",
        pathId: "path_open",
        at: { kind: "segment", segmentId: "segment_bc", t: 0.5 },
      },
    );
    expect(plan).toMatchObject({
      ok: true,
      cutResult: {
        cutVertexIds: ["vertex_edit_1", "vertex_edit_2"],
        pathIds: ["path_open", "path_edit_1"],
      },
    });
    if (!plan.ok) throw new Error(plan.message);
    const preview = runtime.preview({
      transactionId: "cut_vector_preview",
      documentId: before.document.documentId,
      baseRevision: before.document.revision,
      actor: { type: "user", id: "local-user" },
      label: "Cut vector path",
      commands: [...plan.operations],
    });
    expect(preview).toMatchObject({ ok: true });
    const applied = runtime.apply({
      transactionId: "cut_vector",
      documentId: before.document.documentId,
      baseRevision: before.document.revision,
      actor: { type: "user", id: "local-user" },
      label: "Cut vector path",
      commands: [...plan.operations],
    });
    expect(applied).toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(vectorNetworkFrom(runtime).paths.map((path) => path.id)).toEqual([
      "path_open",
      "path_edit_1",
    ]);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(vectorNetworkFrom(runtime)).toEqual(network());
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(vectorNetworkFrom(reopened)).toEqual(vectorNetworkFrom(runtime));
  });

  it("divides a closed vector into adjacent layers with tight local bounds in one revision", () => {
    const document = documentWithVector();
    const source = document.nodesById.vector_editable;
    if (
      !source ||
      source.kind !== "vector" ||
      !("network" in source.properties)
    ) {
      throw new Error("Missing editable vector");
    }
    source.properties.network = closedNetwork();
    const runtime = new EditorRuntime(document);
    const before = runtime.getSnapshot();
    const plan = planVectorSemanticEdit(
      before.document,
      "page_welcome",
      "vector_editable",
      {
        action: "cut-with-line",
        start: { x: -20, y: 40 },
        end: { x: 120, y: 40 },
        resultNodeId: "vector_cut_result",
      },
    );
    expect(plan).toMatchObject({
      ok: true,
      lineCutResult: {
        extractedPathIds: ["path_edit_1"],
        intersectionCount: 2,
        resultNodeIds: ["vector_editable", "vector_cut_result"],
        retainedPathIds: ["path_closed"],
      },
      operations: [
        {
          type: "update_properties",
          nodeId: "vector_editable",
          transform: [0, 1, -1, 0, 100, 200],
          size: { width: 100, height: 40 },
        },
        {
          type: "insert_element",
          pageId: "page_welcome",
          parentId: "frame_welcome",
          index: 5,
          node: {
            id: "vector_cut_result",
            name: "Editable curve Cut",
            transform: [0, 1, -1, 0, 60, 200],
            size: { width: 100, height: 60 },
          },
        },
      ],
    });
    if (!plan.ok) throw new Error(plan.message);
    const transaction = {
      transactionId: "divide_vector",
      documentId: before.document.documentId,
      baseRevision: before.document.revision,
      actor: { type: "user" as const, id: "local-user" },
      label: "Divide vector object",
      commands: [...plan.operations],
    };
    expect(runtime.preview(transaction)).toMatchObject({ ok: true });
    expect(runtime.apply(transaction)).toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(
      runtime
        .getSnapshot()
        .document.nodesById.frame_welcome?.childIds.slice(-2),
    ).toEqual(["vector_editable", "vector_cut_result"]);
    const retained = vectorNetworkFrom(runtime);
    const extracted = vectorNetworkFrom(runtime, "vector_cut_result");
    expect(retained.paths[0]).toMatchObject({
      id: "path_closed",
      closed: true,
    });
    expect(extracted.paths[0]).toMatchObject({
      id: "path_edit_1",
      closed: true,
    });
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.vector_cut_result,
    ).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(vectorNetworkFrom(reopened, "vector_cut_result")).toEqual(extracted);
  });

  it("divides an open stroke into adjacent editable layers without closing either path", () => {
    const runtime = new EditorRuntime(documentWithVector());
    const before = runtime.getSnapshot();
    const plan = planVectorSemanticEdit(
      before.document,
      "page_welcome",
      "vector_editable",
      {
        action: "cut-with-line",
        start: { x: 50, y: -20 },
        end: { x: 50, y: 20 },
        resultNodeId: "vector_open_cut_result",
      },
    );
    expect(plan).toMatchObject({
      ok: true,
      lineCutResult: {
        extractedPathIds: ["path_edit_1"],
        intersectionCount: 1,
        resultNodeIds: ["vector_editable", "vector_open_cut_result"],
        retainedPathIds: ["path_open"],
      },
      operations: [
        {
          type: "update_properties",
          nodeId: "vector_editable",
          transform: [0, 1, -1, 0, 100, 200],
          size: { width: 50, height: 0 },
        },
        {
          type: "insert_element",
          node: {
            id: "vector_open_cut_result",
            transform: [0, 1, -1, 0, 100, 250],
            size: { width: 50, height: 100 },
          },
        },
      ],
    });
    if (!plan.ok) throw new Error(plan.message);
    const transaction = {
      transactionId: "divide_open_vector",
      documentId: before.document.documentId,
      baseRevision: before.document.revision,
      actor: { type: "user" as const, id: "local-user" },
      label: "Divide open vector stroke",
      commands: [...plan.operations],
    };
    expect(runtime.preview(transaction)).toMatchObject({ ok: true });
    expect(runtime.apply(transaction)).toMatchObject({ ok: true });
    const retained = vectorNetworkFrom(runtime);
    const extracted = vectorNetworkFrom(runtime, "vector_open_cut_result");
    expect(retained.paths.every((path) => !path.closed)).toBe(true);
    expect(extracted.paths.every((path) => !path.closed)).toBe(true);
    expect(retained.regions).toEqual([]);
    expect(extracted.regions).toEqual([]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.vector_open_cut_result,
    ).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(vectorNetworkFrom(reopened, "vector_open_cut_result")).toEqual(
      extracted,
    );
  });

  it("divides a branch network without detaching an uncut junction component", () => {
    const document = documentWithVector();
    const source = document.nodesById.vector_editable;
    if (
      !source ||
      source.kind !== "vector" ||
      !("network" in source.properties)
    ) {
      throw new Error("Missing branch line Cut fixture");
    }
    source.properties.network.vertices.push({
      id: "vertex_branch",
      x: 100,
      y: -100,
    });
    source.properties.network.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_b",
      endVertexId: "vertex_branch",
    });
    source.properties.network.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: true }],
    });

    const plan = planVectorSemanticEdit(document, "page_welcome", source.id, {
      action: "cut-with-line",
      start: { x: 50, y: -50 },
      end: { x: 150, y: -50 },
      resultNodeId: "vector_branch_cut_result",
    });

    expect(plan).toMatchObject({
      ok: true,
      lineCutResult: {
        retainedPathIds: ["path_branch"],
        extractedPathIds: ["path_open", "path_edit_1"],
        resultNodeIds: ["vector_editable", "vector_branch_cut_result"],
      },
    });
    if (!plan.ok) throw new Error(plan.message);
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "divide_branch_vector",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Divide branch vector",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    const extracted = vectorNetworkFrom(runtime, "vector_branch_cut_result");
    expect(
      extracted.segments.filter(
        (segment) =>
          segment.startVertexId === "vertex_b" ||
          segment.endVertexId === "vertex_b",
      ),
    ).toHaveLength(3);
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
  });

  it("redistributes an uncut compound hole and preserves it through runtime history", () => {
    const document = documentWithVector();
    const source = document.nodesById.vector_editable;
    if (
      !source ||
      source.kind !== "vector" ||
      !("network" in source.properties)
    ) {
      throw new Error("Missing compound Vector fixture");
    }
    source.properties.network = compoundNetwork();
    const runtime = new EditorRuntime(document);
    const before = runtime.getSnapshot();
    const plan = planVectorSemanticEdit(
      before.document,
      "page_welcome",
      "vector_editable",
      {
        action: "cut-with-line",
        start: { x: -20, y: 10 },
        end: { x: 120, y: 10 },
        resultNodeId: "vector_compound_cut_result",
      },
    );
    expect(plan).toMatchObject({
      ok: true,
      lineCutResult: {
        extractedPathIds: ["path_edit_1", "path_hole"],
        intersectionCount: 2,
        retainedPathIds: ["path_closed"],
      },
      operations: [
        {
          type: "update_properties",
          nodeId: "vector_editable",
          transform: [0, 1, -1, 0, 100, 200],
          size: { width: 100, height: 10 },
        },
        {
          type: "insert_element",
          node: {
            id: "vector_compound_cut_result",
            transform: [0, 1, -1, 0, 90, 200],
            size: { width: 100, height: 90 },
          },
        },
      ],
    });
    if (!plan.ok) throw new Error(plan.message);
    const transaction = {
      transactionId: "divide_compound_vector",
      documentId: before.document.documentId,
      baseRevision: before.document.revision,
      actor: { type: "user" as const, id: "local-user" },
      label: "Divide compound vector object",
      commands: [...plan.operations],
    };
    expect(runtime.preview(transaction)).toMatchObject({ ok: true });
    expect(runtime.apply(transaction)).toMatchObject({ ok: true });
    const retained = vectorNetworkFrom(runtime);
    const extracted = vectorNetworkFrom(runtime, "vector_compound_cut_result");
    expect(retained.regions[0]?.loops).toEqual([
      { pathId: "path_closed", reversed: false },
    ]);
    expect(extracted.regions[0]?.loops).toEqual([
      { pathId: "path_edit_1", reversed: false },
      { pathId: "path_hole", reversed: true },
    ]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(vectorNetworkFrom(runtime)).toEqual(compoundNetwork());
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(vectorNetworkFrom(reopened, "vector_compound_cut_result")).toEqual(
      extracted,
    );
  });

  it("stitches a crossed compound hole into two editable sibling regions", () => {
    const document = documentWithVector();
    const source = document.nodesById.vector_editable;
    if (
      !source ||
      source.kind !== "vector" ||
      !("network" in source.properties)
    ) {
      throw new Error("Missing compound Vector fixture");
    }
    source.properties.network = compoundNetwork();
    const runtime = new EditorRuntime(document);
    const before = runtime.getSnapshot();
    const plan = planVectorSemanticEdit(
      before.document,
      "page_welcome",
      source.id,
      {
        action: "cut-with-line",
        start: { x: -20, y: 40 },
        end: { x: 120, y: 40 },
        resultNodeId: "vector_crossed_hole_result",
      },
    );
    expect(plan).toMatchObject({
      ok: true,
      lineCutResult: {
        intersectionCount: 4,
        retainedPathIds: ["path_closed"],
        extractedPathIds: ["path_edit_1"],
      },
      operations: [
        {
          type: "update_properties",
          nodeId: source.id,
          size: { width: 100, height: 40 },
        },
        {
          type: "insert_element",
          node: {
            id: "vector_crossed_hole_result",
            size: { width: 100, height: 60 },
          },
        },
      ],
    });
    if (!plan.ok) throw new Error(plan.message);
    const transaction = {
      transactionId: "divide_crossed_hole_vector",
      documentId: before.document.documentId,
      baseRevision: before.document.revision,
      actor: { type: "user" as const, id: "local-user" },
      label: "Divide crossed compound vector",
      commands: [...plan.operations],
    };
    expect(runtime.preview(transaction)).toMatchObject({ ok: true });
    expect(runtime.apply(transaction)).toMatchObject({ ok: true });
    for (const nodeId of [source.id, "vector_crossed_hole_result"]) {
      const divided = vectorNetworkFrom(runtime, nodeId);
      expect(divided.paths).toHaveLength(1);
      expect(divided.regions).toHaveLength(1);
      expect(divided.regions[0]?.loops).toEqual([
        expect.objectContaining({ reversed: false }),
      ]);
    }
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(vectorNetworkFrom(runtime)).toEqual(compoundNetwork());
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(vectorNetworkFrom(reopened, "vector_crossed_hole_result")).toEqual(
      vectorNetworkFrom(runtime, "vector_crossed_hole_result"),
    );
  });

  it("extracts both lower components of a four-crossing concave region into one sibling", () => {
    const document = documentWithVector();
    const source = document.nodesById.vector_editable;
    if (
      !source ||
      source.kind !== "vector" ||
      !("network" in source.properties)
    ) {
      throw new Error("Missing concave Vector fixture");
    }
    source.properties.network = concaveFourCrossingNetwork();
    const plan = planVectorSemanticEdit(document, "page_welcome", source.id, {
      action: "cut-with-line",
      start: { x: -20, y: 50 },
      end: { x: 120, y: 50 },
      resultNodeId: "vector_concave_result",
    });
    expect(plan).toMatchObject({
      ok: true,
      lineCutResult: {
        intersectionCount: 4,
        retainedPathIds: ["path_concave"],
        extractedPathIds: ["path_edit_1", "path_edit_2"],
        resultNodeIds: [source.id, "vector_concave_result"],
      },
    });
    if (!plan.ok) throw new Error(plan.message);
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "divide_concave_vector",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Divide concave vector",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(vectorNetworkFrom(runtime).paths.map((path) => path.id)).toEqual([
      "path_concave",
    ]);
    const extracted = vectorNetworkFrom(runtime, "vector_concave_result");
    expect(extracted.paths.map((path) => path.id)).toEqual([
      "path_edit_1",
      "path_edit_2",
    ]);
    expect(extracted.regions).toHaveLength(2);
    expect(
      runtime.getSnapshot().document.nodesById.vector_concave_result?.size,
    ).toEqual({ width: 100, height: 50 });
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.vector_concave_result,
    ).toBeUndefined();
  });

  it("rejects stale result IDs and inherited locks before planning a line Cut", () => {
    const document = documentWithVector();
    const source = document.nodesById.vector_editable;
    if (
      !source ||
      source.kind !== "vector" ||
      !("network" in source.properties)
    ) {
      throw new Error("Missing editable vector");
    }
    source.properties.network = closedNetwork();
    expect(
      planVectorSemanticEdit(document, "page_welcome", "vector_editable", {
        action: "cut-with-line",
        start: { x: -20, y: 40 },
        end: { x: 120, y: 40 },
        resultNodeId: "title_welcome",
      }),
    ).toMatchObject({ ok: false, code: "invalid-geometry" });
    document.nodesById.frame_welcome!.locked = true;
    expect(
      planVectorSemanticEdit(document, "page_welcome", "vector_editable", {
        action: "cut-with-line",
        start: { x: -20, y: 40 },
        end: { x: 120, y: 40 },
        resultNodeId: "vector_cut_result",
      }),
    ).toMatchObject({ ok: false, code: "locked" });
  });

  it("cuts multiple explicit Vector layers in document coordinates with one stable sibling order", () => {
    const document = documentWithVector();
    const frame = document.nodesById.frame_welcome;
    const first = document.nodesById.vector_editable;
    if (
      !frame ||
      frame.kind !== "frame" ||
      !first ||
      first.kind !== "vector" ||
      !("network" in first.properties)
    ) {
      throw new Error("Missing multi-layer vector fixture");
    }
    first.transform = [1, 0, 0, 1, 40, 40];
    first.properties.network = closedNetwork();
    const second = structuredClone(first);
    second.id = "vector_second";
    second.name = "Second curve";
    second.transform = [1, 0, 0, 1, 180, 40];
    if (!("network" in second.properties)) {
      throw new Error("Missing second editable Vector network");
    }
    second.properties.network = network();
    document.nodesById[second.id] = second;
    frame.childIds.push(second.id);

    const plan = planVectorLayersLineCut(
      document,
      "page_welcome",
      [
        { nodeId: first.id, resultNodeId: "vector_first_cut" },
        { nodeId: second.id, resultNodeId: "vector_second_cut" },
      ],
      { x: 100, y: 144 },
      { x: 400, y: 144 },
    );
    expect(plan).toMatchObject({
      ok: true,
      layerLineCutResult: {
        resultNodeIds: [
          "vector_editable",
          "vector_first_cut",
          "vector_second",
          "vector_second_cut",
        ],
        targets: [
          {
            nodeId: "vector_editable",
            resultNodeId: "vector_first_cut",
            intersectionCount: 2,
          },
          {
            nodeId: "vector_second",
            resultNodeId: "vector_second_cut",
            intersectionCount: 1,
          },
        ],
      },
      operations: [
        { type: "update_properties", nodeId: "vector_second" },
        {
          type: "insert_element",
          index: 6,
          node: { id: "vector_second_cut" },
        },
        { type: "update_properties", nodeId: "vector_editable" },
        {
          type: "insert_element",
          index: 5,
          node: { id: "vector_first_cut" },
        },
      ],
    });
    if (!plan.ok) throw new Error(plan.message);
    const runtime = new EditorRuntime(document);
    const before = runtime.getSnapshot();
    expect(
      runtime.apply({
        transactionId: "cut_multiple_vectors",
        documentId: before.document.documentId,
        baseRevision: before.document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Cut multiple vector layers",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    const appliedFrame = runtime.getSnapshot().document.nodesById.frame_welcome;
    expect(
      appliedFrame?.kind === "frame" ? appliedFrame.childIds.slice(-4) : [],
    ).toEqual([
      "vector_editable",
      "vector_first_cut",
      "vector_second",
      "vector_second_cut",
    ]);
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.vector_first_cut,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.vector_second_cut,
    ).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
  });

  it("disconnects and reconnects explicit endpoints through atomic semantic plans", () => {
    const runtime = new EditorRuntime(documentWithVector());
    const disconnect = planVectorSemanticEdit(
      runtime.getSnapshot().document,
      "page_welcome",
      "vector_editable",
      {
        action: "disconnect-vertex",
        pathId: "path_open",
        vertexId: "vertex_b",
      },
    );
    expect(disconnect).toMatchObject({
      ok: true,
      cutResult: {
        cutVertexIds: ["vertex_b", "vertex_edit_1"],
        pathIds: ["path_open", "path_edit_1"],
      },
    });
    if (!disconnect.ok) throw new Error(disconnect.message);
    expect(
      runtime.apply({
        transactionId: "disconnect_vector_vertex",
        documentId: runtime.getSnapshot().document.documentId,
        baseRevision: runtime.getSnapshot().document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Disconnect vector vertex",
        commands: [...disconnect.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(vectorNetworkFrom(runtime).paths).toHaveLength(2);

    const connect = planVectorSemanticEdit(
      runtime.getSnapshot().document,
      "page_welcome",
      "vector_editable",
      {
        action: "connect-endpoints",
        vertexIds: ["vertex_b", "vertex_edit_1"],
      },
    );
    if (!connect.ok) throw new Error(connect.message);
    expect(
      runtime.apply({
        transactionId: "connect_vector_endpoints",
        documentId: runtime.getSnapshot().document.documentId,
        baseRevision: runtime.getSnapshot().document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Connect vector endpoints",
        commands: [...connect.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(vectorNetworkFrom(runtime)).toEqual(network());
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(vectorNetworkFrom(runtime).paths).toHaveLength(2);
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    expect(vectorNetworkFrom(runtime)).toEqual(network());
  });

  it("transforms explicit vertices and attached curve geometry through one semantic plan", () => {
    const runtime = new EditorRuntime(documentWithVector());
    const plan = planVectorSemanticEdit(
      runtime.getSnapshot().document,
      "page_welcome",
      "vector_editable",
      {
        action: "transform-vertices",
        transform: [1, 0, 0, 1, 20, -10],
        vertexIds: ["vertex_b", "vertex_c"],
      },
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(
      runtime.apply({
        transactionId: "transform_vector_vertices",
        documentId: runtime.getSnapshot().document.documentId,
        baseRevision: runtime.getSnapshot().document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Transform vector vertices",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(vectorNetworkFrom(runtime).vertices).toEqual([
      { id: "vertex_a", x: 0, y: 10, handleMode: "corner" },
      { id: "vertex_b", x: 120, y: 0, handleMode: "corner" },
      { id: "vertex_c", x: 120, y: 100, handleMode: "corner" },
    ]);
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
  });

  it("transforms vertices across differently transformed Vector layers in one revision", () => {
    const document = documentWithVector();
    const frame = document.nodesById.frame_welcome;
    const first = document.nodesById.vector_editable;
    if (
      !frame ||
      frame.kind !== "frame" ||
      !first ||
      first.kind !== "vector" ||
      !("network" in first.properties)
    ) {
      throw new Error("Missing multi-layer vector fixture");
    }
    const second = structuredClone(first);
    second.id = "vector_second";
    second.transform = [2, 0, 0, 0.5, 300, 40];
    document.nodesById[second.id] = second;
    frame.childIds.push(second.id);
    const before = [
      worldVertex(document, first.id, "vertex_b"),
      worldVertex(document, second.id, "vertex_c"),
    ];
    const plan = planVectorLayersVertexTransform(
      document,
      "page_welcome",
      [
        { nodeId: first.id, vertexIds: ["vertex_b"] },
        { nodeId: second.id, vertexIds: ["vertex_c"] },
      ],
      [1, 0, 0, 1, 20, -10],
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.operations).toHaveLength(2);
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "transform_vector_layers",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Transform vector layers",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    const applied = runtime.getSnapshot().document;
    expect(worldVertex(applied, first.id, "vertex_b")).toEqual({
      x: before[0]!.x + 20,
      y: before[0]!.y - 10,
    });
    expect(worldVertex(applied, second.id, "vertex_c")).toEqual({
      x: before[1]!.x + 20,
      y: before[1]!.y - 10,
    });
    expect(applied.revision).toBe(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });

    second.locked = true;
    expect(
      planVectorLayersVertexTransform(
        document,
        "page_welcome",
        [
          { nodeId: first.id, vertexIds: ["vertex_b"] },
          { nodeId: second.id, vertexIds: ["vertex_c"] },
        ],
        [1, 0, 0, 1, 20, -10],
      ),
    ).toMatchObject({ ok: false, code: "locked" });
  });

  it("validates batch network updates before returning any operation", () => {
    const document = documentWithVector();
    const source = document.nodesById.vector_editable;
    if (
      !source ||
      source.kind !== "vector" ||
      !("network" in source.properties)
    ) {
      throw new Error("Missing editable vector");
    }
    expect(
      planVectorNetworkUpdates(document, "page_welcome", [
        { nodeId: source.id, network: source.properties.network },
        { nodeId: "missing", network: source.properties.network },
      ]),
    ).toMatchObject({ ok: false, code: "not-found" });
    expect(
      planVectorNetworkUpdates(document, "page_welcome", [
        { nodeId: source.id, network: source.properties.network },
        { nodeId: source.id, network: source.properties.network },
      ]),
    ).toMatchObject({ ok: false, code: "invalid-geometry" });
  });

  it("skips un-crossed Vector targets and rejects duplicate or non-invertible targets", () => {
    const document = documentWithVector();
    const frame = document.nodesById.frame_welcome;
    const first = document.nodesById.vector_editable;
    if (
      !frame ||
      frame.kind !== "frame" ||
      !first ||
      first.kind !== "vector" ||
      !("network" in first.properties)
    ) {
      throw new Error("Missing multi-layer vector fixture");
    }
    first.transform = [1, 0, 0, 1, 40, 40];
    first.properties.network = closedNetwork();
    const second = structuredClone(first);
    second.id = "vector_second";
    second.transform = [1, 0, 0, 1, 300, 40];
    document.nodesById[second.id] = second;
    frame.childIds.push(second.id);
    const partial = planVectorLayersLineCut(
      document,
      "page_welcome",
      [
        { nodeId: first.id, resultNodeId: "vector_first_cut" },
        { nodeId: second.id, resultNodeId: "vector_second_cut" },
      ],
      { x: 100, y: 144 },
      { x: 260, y: 144 },
    );
    expect(partial).toMatchObject({
      ok: true,
      layerLineCutResult: {
        resultNodeIds: ["vector_editable", "vector_first_cut"],
      },
    });
    expect(
      planVectorLayersLineCut(
        document,
        "page_welcome",
        [{ nodeId: "missing_vector", resultNodeId: "missing_vector_cut" }],
        { x: 100, y: 144 },
        { x: 500, y: 144 },
      ),
    ).toMatchObject({ ok: false, code: "not-found" });
    expect(
      planVectorLayersLineCut(
        document,
        "page_welcome",
        [
          { nodeId: first.id, resultNodeId: "same_result" },
          { nodeId: second.id, resultNodeId: "same_result" },
        ],
        { x: 100, y: 144 },
        { x: 500, y: 144 },
      ),
    ).toMatchObject({ ok: false, code: "invalid-geometry" });
    second.locked = true;
    expect(
      planVectorLayersLineCut(
        document,
        "page_welcome",
        [
          { nodeId: first.id, resultNodeId: "vector_first_cut" },
          { nodeId: second.id, resultNodeId: "vector_second_cut" },
        ],
        { x: 100, y: 144 },
        { x: 500, y: 144 },
      ),
    ).toMatchObject({ ok: false, code: "locked" });
    second.locked = false;
    second.transform = [0, 0, 0, 0, 300, 40];
    expect(
      planVectorLayersLineCut(
        document,
        "page_welcome",
        [{ nodeId: second.id, resultNodeId: "vector_second_cut" }],
        { x: 100, y: 144 },
        { x: 500, y: 144 },
      ),
    ).toMatchObject({ ok: false, code: "non-invertible" });
  });

  it("resolves the active contour from point selection and rejects stale cut IDs", () => {
    const document = documentWithVector();
    const node = document.nodesById.vector_editable;
    if (!node || node.kind !== "vector" || !("network" in node.properties)) {
      throw new Error("Missing editable vector");
    }
    const cut = planVectorSemanticEdit(
      document,
      "page_welcome",
      "vector_editable",
      {
        action: "cut-path",
        pathId: "path_open",
        at: { kind: "vertex", vertexId: "vertex_b" },
      },
    );
    if (!cut.ok) throw new Error(cut.message);
    const runtime = new EditorRuntime(document);
    const snapshot = runtime.getSnapshot();
    const applied = runtime.apply({
      transactionId: "cut_for_scope",
      documentId: snapshot.document.documentId,
      baseRevision: snapshot.document.revision,
      actor: { type: "user", id: "local-user" },
      label: "Cut vector path",
      commands: [...cut.operations],
    });
    expect(applied).toMatchObject({ ok: true });
    expect(
      resolveVectorEditScope(
        runtime.getSnapshot().document,
        "page_welcome",
        ["vector_editable"],
        "vector_editable",
        ["vertex_edit_1"],
      ),
    ).toMatchObject({
      activePathId: "path_edit_1",
      pathCount: 2,
      readOnly: false,
    });
    const bothEndpoints = resolveVectorEditScope(
      runtime.getSnapshot().document,
      "page_welcome",
      ["vector_editable"],
      "vector_editable",
      ["vertex_b", "vertex_edit_1"],
    );
    expect(bothEndpoints).toMatchObject({ pathCount: 2, readOnly: false });
    expect(Object.hasOwn(bothEndpoints ?? {}, "activePathId")).toBe(false);
    expect(
      planVectorSemanticEdit(
        runtime.getSnapshot().document,
        "page_welcome",
        "vector_editable",
        {
          action: "cut-path",
          pathId: "path_open",
          at: { kind: "segment", segmentId: "stale_segment", t: 0.5 },
        },
      ),
    ).toMatchObject({ ok: false, code: "not-found" });
  });
});

function vectorNetworkFrom(
  runtime: EditorRuntime,
  nodeId = "vector_editable",
): VectorNetwork {
  const node = runtime.getSnapshot().document.nodesById[nodeId];
  if (!node || node.kind !== "vector" || !("network" in node.properties)) {
    throw new Error("Missing editable vector");
  }
  return node.properties.network;
}

function worldVertex(
  document: DesignDocument,
  nodeId: string,
  vertexId: string,
): { x: number; y: number } {
  const node = document.nodesById[nodeId];
  const world = getWorldTransform(document, nodeId);
  if (
    !node ||
    node.kind !== "vector" ||
    !("network" in node.properties) ||
    !world
  ) {
    throw new Error(`Missing editable vector ${nodeId}`);
  }
  const vertex = node.properties.network.vertices.find(
    (candidate) => candidate.id === vertexId,
  );
  if (!vertex) throw new Error(`Missing vertex ${vertexId}`);
  return transformPoint(vertex, world);
}
