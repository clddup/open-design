import type { VectorNetwork } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  cutVectorPath,
  deleteVectorVertices,
  findVectorPathIdForVertex,
  inferVectorPointMode,
  listVectorVertexHandles,
  moveVectorHandle,
  moveVectorVertices,
  nearestVectorSegmentPoint,
  reverseVectorPath,
  setVectorPathClosed,
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

function twoContourNetwork(): VectorNetwork {
  const first = openNetwork();
  return {
    vertices: [
      ...first.vertices,
      { id: "vertex_e", x: 240, y: 0 },
      { id: "vertex_f", x: 300, y: 30 },
      { id: "vertex_g", x: 360, y: 0 },
    ],
    segments: [
      ...first.segments,
      { id: "segment_ef", startVertexId: "vertex_e", endVertexId: "vertex_f" },
      { id: "segment_fg", startVertexId: "vertex_f", endVertexId: "vertex_g" },
    ],
    paths: [
      ...first.paths,
      {
        id: "path_second",
        closed: false,
        segments: [
          { segmentId: "segment_ef", reversed: false },
          { segmentId: "segment_fg", reversed: false },
        ],
      },
    ],
    regions: [],
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

  it("closes and reopens one contour with deterministic IDs and region semantics", () => {
    const source = openNetwork();
    const closed = setVectorPathClosed(source, true);
    expect(closed).toMatchObject({ ok: true });
    if (!closed.ok) throw new Error(closed.message);
    expect(closed.network.paths[0]).toEqual({
      id: "path_open",
      closed: true,
      segments: [
        { segmentId: "segment_ab", reversed: false },
        { segmentId: "segment_bc", reversed: false },
        { segmentId: "segment_cd", reversed: false },
        { segmentId: "segment_edit_1", reversed: false },
      ],
    });
    expect(closed.network.segments.at(-1)).toEqual({
      id: "segment_edit_1",
      startVertexId: "vertex_d",
      endVertexId: "vertex_a",
    });
    expect(closed.network.regions).toEqual([
      {
        id: "region_edit_1",
        windingRule: "nonzero",
        loops: [{ pathId: "path_open", reversed: false }],
      },
    ]);

    const reopened = setVectorPathClosed(closed.network, false);
    expect(reopened).toEqual({ ok: true, network: source });
  });

  it("mirrors smooth and mirrored endpoint handles onto the closing edge", () => {
    const source = openNetwork();
    source.vertices[0]!.handleMode = "smooth";
    source.vertices.at(-1)!.handleMode = "mirrored";
    source.segments[0]!.tangentStart = { x: 18, y: -6 };
    source.segments.at(-1)!.tangentEnd = { x: -12, y: 9 };

    const result = setVectorPathClosed(source, true);
    if (!result.ok) throw new Error(result.message);
    expect(result.network.segments.at(-1)).toEqual({
      id: "segment_edit_1",
      startVertexId: "vertex_d",
      endVertexId: "vertex_a",
      tangentStart: { x: 12, y: -9 },
      tangentEnd: { x: -18, y: 6 },
    });
    expect(inferVectorPointMode(result.network, "vertex_a")).toBe("smooth");
    expect(inferVectorPointMode(result.network, "vertex_d")).toBe("mirrored");
  });

  it("preserves stable segments and effective region winding when reversing twice", () => {
    const source = closedNetwork();
    source.paths[0]!.segments = [
      { segmentId: "segment_ab", reversed: false },
      { segmentId: "segment_bc", reversed: false },
      { segmentId: "segment_cd", reversed: true },
      { segmentId: "segment_da", reversed: false },
    ];
    source.segments[2] = {
      id: "segment_cd",
      startVertexId: "vertex_d",
      endVertexId: "vertex_c",
    };

    const reversed = reverseVectorPath(source);
    if (!reversed.ok) throw new Error(reversed.message);
    expect(reversed.network.paths[0]!.segments).toEqual([
      { segmentId: "segment_da", reversed: true },
      { segmentId: "segment_cd", reversed: false },
      { segmentId: "segment_bc", reversed: true },
      { segmentId: "segment_ab", reversed: true },
    ]);
    expect(reversed.network.regions[0]!.loops[0]!.reversed).toBe(true);
    expect(reversed.network.segments).toEqual(source.segments);

    const restored = reverseVectorPath(reversed.network);
    expect(restored).toEqual({ ok: true, network: source });
  });

  it("cuts a closed contour at an existing vertex into one editable open contour", () => {
    const source = closedNetwork();
    const result = cutVectorPath(source, "path_closed", {
      kind: "vertex",
      vertexId: "vertex_b",
    });
    expect(result).toMatchObject({
      ok: true,
      cutVertexIds: ["vertex_b", "vertex_edit_1"],
      pathIds: ["path_closed"],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.network.paths).toEqual([
      {
        id: "path_closed",
        closed: false,
        segments: [
          { segmentId: "segment_bc", reversed: false },
          { segmentId: "segment_cd", reversed: false },
          { segmentId: "segment_da", reversed: false },
          { segmentId: "segment_ab", reversed: false },
        ],
      },
    ]);
    expect(result.network.regions).toEqual([]);
    expect(
      result.network.vertices.find((vertex) => vertex.id === "vertex_edit_1"),
    ).toMatchObject({ x: 100, y: 0 });
    expect(
      result.network.segments.find((segment) => segment.id === "segment_ab"),
    ).toMatchObject({ endVertexId: "vertex_edit_1" });
    expect(vectorNetworkEditability(result.network)).toEqual({
      editable: true,
    });

    const reversed = reverseVectorPath(source, "path_closed");
    if (!reversed.ok) throw new Error(reversed.message);
    const reversedCut = cutVectorPath(reversed.network, "path_closed", {
      kind: "vertex",
      vertexId: "vertex_b",
    });
    expect(reversedCut).toMatchObject({ ok: true });
    if (!reversedCut.ok) throw new Error(reversedCut.message);
    expect(vectorNetworkEditability(reversedCut.network)).toEqual({
      editable: true,
    });
  });

  it("cuts an open contour at an internal vertex and keeps both sides independently editable", () => {
    const result = cutVectorPath(openNetwork(), "path_open", {
      kind: "vertex",
      vertexId: "vertex_c",
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.cutVertexIds).toEqual(["vertex_c", "vertex_edit_1"]);
    expect(result.pathIds).toEqual(["path_open", "path_edit_1"]);
    expect(result.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [
          { segmentId: "segment_ab", reversed: false },
          { segmentId: "segment_bc", reversed: false },
        ],
      },
      {
        id: "path_edit_1",
        closed: false,
        segments: [{ segmentId: "segment_cd", reversed: false }],
      },
    ]);
    const moved = moveVectorVertices(result.network, ["vertex_edit_1"], {
      x: 12,
      y: 8,
    });
    if (!moved.ok) throw new Error(moved.message);
    expect(
      moved.network.vertices.find((vertex) => vertex.id === "vertex_c"),
    ).toMatchObject({ x: 120, y: 0 });
    expect(
      moved.network.vertices.find((vertex) => vertex.id === "vertex_edit_1"),
    ).toMatchObject({ x: 132, y: 8 });
  });

  it("splits line and reversed cubic segments exactly with stable directed IDs", () => {
    const line = cutVectorPath(openNetwork(), "path_open", {
      kind: "segment",
      segmentId: "segment_bc",
      t: 0.25,
    });
    if (!line.ok) throw new Error(line.message);
    expect(line.cutVertexIds).toEqual(["vertex_edit_1", "vertex_edit_2"]);
    expect(
      line.network.vertices.filter((vertex) =>
        line.cutVertexIds.includes(vertex.id),
      ),
    ).toEqual([
      { id: "vertex_edit_1", x: 75, y: 22.5, handleMode: "corner" },
      { id: "vertex_edit_2", x: 75, y: 22.5, handleMode: "corner" },
    ]);
    expect(line.network.paths[0]?.segments.at(-1)?.segmentId).toBe(
      "segment_bc",
    );
    expect(line.network.paths[1]?.segments[0]?.segmentId).toBe(
      "segment_edit_1",
    );

    const cubic: VectorNetwork = {
      vertices: [
        { id: "vertex_a", x: 0, y: 0 },
        { id: "vertex_b", x: 100, y: 0 },
      ],
      segments: [
        {
          id: "segment_curve",
          startVertexId: "vertex_a",
          endVertexId: "vertex_b",
          tangentStart: { x: 0, y: 100 },
          tangentEnd: { x: 0, y: 100 },
        },
      ],
      paths: [
        {
          id: "path_curve",
          closed: false,
          segments: [{ segmentId: "segment_curve", reversed: true }],
        },
      ],
      regions: [],
    };
    const curved = cutVectorPath(cubic, "path_curve", {
      kind: "segment",
      segmentId: "segment_curve",
      t: 0.5,
    });
    if (!curved.ok) throw new Error(curved.message);
    expect(curved.network.vertices.slice(-2)).toEqual([
      { id: "vertex_edit_1", x: 50, y: 75, handleMode: "independent" },
      { id: "vertex_edit_2", x: 50, y: 75, handleMode: "independent" },
    ]);
    expect(curved.network.segments).toEqual([
      {
        id: "segment_curve",
        startVertexId: "vertex_edit_1",
        endVertexId: "vertex_b",
        tangentStart: { x: 25, y: 0 },
        tangentEnd: { x: 0, y: 50 },
      },
      {
        id: "segment_edit_1",
        startVertexId: "vertex_a",
        endVertexId: "vertex_edit_2",
        tangentStart: { x: 0, y: 50 },
        tangentEnd: { x: -25, y: 0 },
      },
    ]);
    expect(curved.network.paths.map((path) => path.segments)).toEqual([
      [{ segmentId: "segment_curve", reversed: true }],
      [{ segmentId: "segment_edit_1", reversed: true }],
    ]);
  });

  it("finds deterministic path-directed line and cubic cut locations", () => {
    const line = nearestVectorSegmentPoint(openNetwork(), { x: 92, y: 17 });
    expect(line).toMatchObject({
      pathId: "path_open",
      segmentId: "segment_bc",
    });
    expect(line?.t).toBeCloseTo(0.513333);
    expect(line?.point).toEqual({ x: 90.8, y: 14.6 });

    const curved = openNetwork();
    curved.segments[0]!.tangentStart = { x: 20, y: 80 };
    curved.segments[0]!.tangentEnd = { x: -20, y: 80 };
    const hit = nearestVectorSegmentPoint(curved, { x: 30, y: 60 });
    expect(hit).toMatchObject({ pathId: "path_open", segmentId: "segment_ab" });
    expect(hit?.t).toBeGreaterThan(0);
    expect(hit?.t).toBeLessThan(1);
    expect(hit?.distance).toBeLessThan(20);
  });

  it("keeps disjoint contours editable and requires an explicit topology target", () => {
    const source = twoContourNetwork();
    expect(vectorNetworkEditability(source)).toEqual({ editable: true });
    expect(findVectorPathIdForVertex(source, "vertex_f")).toBe("path_second");
    expect(reverseVectorPath(source)).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
    const reversed = reverseVectorPath(source, "path_second");
    if (!reversed.ok) throw new Error(reversed.message);
    expect(reversed.network.paths[0]).toEqual(source.paths[0]);
    expect(reversed.network.paths[1]?.segments).toEqual([
      { segmentId: "segment_fg", reversed: true },
      { segmentId: "segment_ef", reversed: true },
    ]);

    const deleted = deleteVectorVertices(source, ["vertex_e", "vertex_f"]);
    if (!deleted.ok || deleted.deleteNode)
      throw new Error("Expected one contour");
    expect(deleted.network.paths.map((path) => path.id)).toEqual(["path_open"]);
    expect(
      deleted.network.vertices.some((vertex) => vertex.id === "vertex_g"),
    ).toBe(false);
  });

  it("returns recoverable cut failures for endpoints and stale geometry IDs", () => {
    expect(
      cutVectorPath(openNetwork(), "path_open", {
        kind: "vertex",
        vertexId: "vertex_a",
      }),
    ).toMatchObject({ ok: false, code: "no-op" });
    expect(
      cutVectorPath(openNetwork(), "missing_path", {
        kind: "vertex",
        vertexId: "vertex_b",
      }),
    ).toMatchObject({ ok: false, code: "missing-path" });
    expect(
      cutVectorPath(openNetwork(), "path_open", {
        kind: "segment",
        segmentId: "missing_segment",
        t: 0.5,
      }),
    ).toMatchObject({ ok: false, code: "missing-segment" });
    expect(
      cutVectorPath(openNetwork(), "path_open", {
        kind: "segment",
        segmentId: "segment_ab",
        t: 1.1,
      }),
    ).toMatchObject({ ok: false, code: "invalid-network" });
  });

  it("rejects topology no-ops and closing a two-point contour", () => {
    expect(setVectorPathClosed(openNetwork(), false)).toMatchObject({
      ok: false,
      code: "no-op",
    });
    expect(setVectorPathClosed(closedNetwork(), true)).toMatchObject({
      ok: false,
      code: "no-op",
    });
    const twoPoint = openNetwork();
    twoPoint.vertices = twoPoint.vertices.slice(0, 2);
    twoPoint.segments = twoPoint.segments.slice(0, 1);
    twoPoint.paths[0]!.segments = twoPoint.paths[0]!.segments.slice(0, 1);
    expect(setVectorPathClosed(twoPoint, true)).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
  });

  it("rejects connected path runs until connect/disconnect editing is available", () => {
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
