import type { VectorNetwork } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  deleteVectorVertices,
  inferVectorPointMode,
  listVectorVertexHandles,
  moveVectorHandle,
  moveVectorVertices,
  setVectorPointMode,
  vectorNetworkEditability,
} from "./vector-edit.js";

function openNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
      { id: "vertex_b", x: 60, y: 30, handleMode: "corner" },
      { id: "vertex_c", x: 120, y: 0, handleMode: "corner" },
      { id: "vertex_d", x: 180, y: 30, handleMode: "corner" },
    ],
    segments: [
      { id: "segment_ab", startVertexId: "vertex_a", endVertexId: "vertex_b" },
      { id: "segment_bc", startVertexId: "vertex_b", endVertexId: "vertex_c" },
      { id: "segment_cd", startVertexId: "vertex_c", endVertexId: "vertex_d" },
    ],
    paths: [
      {
        id: "path_open",
        closed: false,
        segments: [
          { segmentId: "segment_ab", reversed: false },
          { segmentId: "segment_bc", reversed: false },
          { segmentId: "segment_cd", reversed: false },
        ],
      },
    ],
    regions: [],
  };
}

function closedNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 0, y: 0 },
      { id: "vertex_b", x: 100, y: 0 },
      { id: "vertex_c", x: 100, y: 100 },
      { id: "vertex_d", x: 0, y: 100 },
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

describe("editable vector point operations", () => {
  it("moves multiple selected vertices without changing tangent offsets", () => {
    const network = openNetwork();
    network.segments[0]!.tangentEnd = { x: -10, y: 5 };
    const result = moveVectorVertices(network, ["vertex_b", "vertex_c"], {
      x: 8,
      y: -4,
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);
    expect(result.network.vertices).toEqual([
      { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
      { id: "vertex_b", x: 68, y: 26, handleMode: "corner" },
      { id: "vertex_c", x: 128, y: -4, handleMode: "corner" },
      { id: "vertex_d", x: 180, y: 30, handleMode: "corner" },
    ]);
    expect(result.network.segments[0]!.tangentEnd).toEqual({ x: -10, y: 5 });
  });

  it("creates deterministic smooth and mirrored handles from neighboring points", () => {
    const smooth = setVectorPointMode(openNetwork(), ["vertex_b"], "smooth");
    expect(smooth).toMatchObject({ ok: true });
    if (!smooth.ok) throw new Error(smooth.message);
    expect(inferVectorPointMode(smooth.network, "vertex_b")).toBe("smooth");
    const handles = listVectorVertexHandles(smooth.network, "vertex_b");
    expect(handles).toHaveLength(2);
    expect(handles[0]!.offset.x * handles[1]!.offset.y).toBeCloseTo(
      handles[0]!.offset.y * handles[1]!.offset.x,
    );

    const mirrored = setVectorPointMode(
      smooth.network,
      ["vertex_b"],
      "mirrored",
    );
    expect(mirrored).toMatchObject({ ok: true });
    if (!mirrored.ok) throw new Error(mirrored.message);
    const mirroredHandles = listVectorVertexHandles(
      mirrored.network,
      "vertex_b",
    );
    expect(mirroredHandles[0]!.offset.x).toBeCloseTo(
      -mirroredHandles[1]!.offset.x,
    );
    expect(mirroredHandles[0]!.offset.y).toBeCloseTo(
      -mirroredHandles[1]!.offset.y,
    );
  });

  it("keeps mirrored or smooth opposite handles coupled during drag", () => {
    const mirrored = setVectorPointMode(
      openNetwork(),
      ["vertex_b"],
      "mirrored",
    );
    if (!mirrored.ok) throw new Error(mirrored.message);
    const selected = listVectorVertexHandles(mirrored.network, "vertex_b")[0]!;
    const moved = moveVectorHandle(mirrored.network, selected, {
      x: -30,
      y: 12,
    });
    expect(moved).toMatchObject({ ok: true });
    if (!moved.ok) throw new Error(moved.message);
    const handles = listVectorVertexHandles(moved.network, "vertex_b");
    expect(handles.map((handle) => handle.offset)).toEqual(
      expect.arrayContaining([
        { x: -30, y: 12 },
        { x: 30, y: -12 },
      ]),
    );

    const smooth = setVectorPointMode(moved.network, ["vertex_b"], "smooth");
    if (!smooth.ok) throw new Error(smooth.message);
    const smoothHandlesBefore = listVectorVertexHandles(
      smooth.network,
      "vertex_b",
    );
    const smoothSelected = smoothHandlesBefore[0]!;
    const oppositeBefore = smoothHandlesBefore[1]!;
    const smoothMoved = moveVectorHandle(smooth.network, smoothSelected, {
      x: -10,
      y: 40,
    });
    if (!smoothMoved.ok) throw new Error(smoothMoved.message);
    const smoothHandlesAfter = listVectorVertexHandles(
      smoothMoved.network,
      "vertex_b",
    );
    const oppositeAfter = smoothHandlesAfter.find(
      (handle) =>
        handle.segmentId === oppositeBefore.segmentId &&
        handle.side === oppositeBefore.side,
    )!;
    expect(
      Math.hypot(oppositeAfter.offset.x, oppositeAfter.offset.y),
    ).toBeCloseTo(Math.hypot(oppositeBefore.offset.x, oppositeBefore.offset.y));
  });

  it("clears handles for corner mode and leaves independent handles uncoupled", () => {
    const mirrored = setVectorPointMode(
      openNetwork(),
      ["vertex_b"],
      "mirrored",
    );
    if (!mirrored.ok) throw new Error(mirrored.message);
    const independent = setVectorPointMode(
      mirrored.network,
      ["vertex_b"],
      "independent",
    );
    if (!independent.ok) throw new Error(independent.message);
    const before = listVectorVertexHandles(independent.network, "vertex_b");
    const moved = moveVectorHandle(independent.network, before[0]!, {
      x: -8,
      y: -24,
    });
    if (!moved.ok) throw new Error(moved.message);
    const after = listVectorVertexHandles(moved.network, "vertex_b");
    expect(after[1]!.offset).toEqual(before[1]!.offset);

    const corner = setVectorPointMode(moved.network, ["vertex_b"], "corner");
    if (!corner.ok) throw new Error(corner.message);
    expect(listVectorVertexHandles(corner.network, "vertex_b")).toEqual([]);
    expect(inferVectorPointMode(corner.network, "vertex_b")).toBe("corner");
  });

  it("deletes open and closed contour vertices while preserving stable retained edges", () => {
    const open = deleteVectorVertices(openNetwork(), ["vertex_b"]);
    expect(open).toMatchObject({ ok: true, deleteNode: false });
    if (!open.ok || open.deleteNode) throw new Error("Expected edited network");
    expect(open.network.vertices.map((vertex) => vertex.id)).toEqual([
      "vertex_a",
      "vertex_c",
      "vertex_d",
    ]);
    expect(open.network.segments.map((segment) => segment.id)).toEqual([
      "segment_edit_1",
      "segment_cd",
    ]);

    const closed = deleteVectorVertices(closedNetwork(), ["vertex_b"]);
    expect(closed).toMatchObject({ ok: true, deleteNode: false });
    if (!closed.ok || closed.deleteNode)
      throw new Error("Expected edited network");
    expect(closed.network.paths[0]).toMatchObject({ closed: true });
    expect(closed.network.regions).toHaveLength(1);
  });

  it("deletes the whole node when too few contour vertices would remain", () => {
    expect(
      deleteVectorVertices(openNetwork(), ["vertex_a", "vertex_b", "vertex_c"]),
    ).toEqual({ ok: true, deleteNode: true });
    expect(
      deleteVectorVertices(closedNetwork(), ["vertex_a", "vertex_b"]),
    ).toEqual({ ok: true, deleteNode: true });
  });

  it("rejects branch and multi-contour networks for this interaction slice", () => {
    const network = openNetwork();
    network.vertices.push({ id: "vertex_branch", x: 60, y: 90 });
    network.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_b",
      endVertexId: "vertex_branch",
    });
    network.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: false }],
    });

    expect(vectorNetworkEditability(network)).toMatchObject({
      editable: false,
    });
    expect(
      moveVectorVertices(network, ["vertex_b"], { x: 1, y: 1 }),
    ).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
  });
});
