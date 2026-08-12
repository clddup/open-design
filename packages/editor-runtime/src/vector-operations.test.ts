import type {
  DesignDocument,
  VectorNetwork,
  VectorNode,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { EditorRuntime } from "./runtime.js";
import {
  planDeleteVectorNode,
  planVectorLayersLineCut,
  planVectorNetworkUpdate,
  planVectorSemanticEdit,
  resolveVectorEditCollectionScope,
  resolveVectorEditScope,
  type VectorSemanticEdit,
} from "./vector-operations.js";

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

describe("vector editing runtime plans", () => {
  it("derives selected point mode and locked read-only state without persisting edit UI", () => {
    const document = documentWithVector();
    expect(
      resolveVectorEditScope(
        document,
        "page_welcome",
        ["vector_editable"],
        "vector_editable",
        ["vertex_b"],
      ),
    ).toEqual({
      activePathId: "path_open",
      nodeId: "vector_editable",
      pathCount: 1,
      pointMode: "corner",
      readOnly: false,
      selectedVertexIds: ["vertex_b"],
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
