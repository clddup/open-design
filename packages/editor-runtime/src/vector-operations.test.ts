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
  planVectorNetworkUpdate,
  planVectorSemanticEdit,
  resolveVectorEditScope,
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
      nodeId: "vector_editable",
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
      edit:
        { action: "set-closed"; closed: boolean } | { action: "reverse-path" },
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
});

function vectorNetworkFrom(runtime: EditorRuntime): VectorNetwork {
  const node = runtime.getSnapshot().document.nodesById.vector_editable;
  if (!node || node.kind !== "vector" || !("network" in node.properties)) {
    throw new Error("Missing editable vector");
  }
  return node.properties.network;
}
