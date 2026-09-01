import type { VectorNetwork } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  bendVectorSegment,
  connectVectorEndpoints,
  cutVectorNetworkByLine,
  cutVectorPath,
  deleteVectorSegments,
  deleteVectorSelection,
  deleteVectorVertices,
  disconnectVectorVertex,
  findVectorPathIdForVertex,
  inferVectorPointMode,
  listVectorVertexHandles,
  moveVectorHandle,
  moveVectorVertices,
  nearestVectorSegmentPoint,
  reverseVectorPath,
  setVectorPathClosed,
  setVectorPointMode,
  setVectorRegionFills,
  setVectorRegionFillStyle,
  setVectorVertexCornerRadius,
  setVectorVertexStrokeAppearance,
  transformVectorVertices,
  vectorVertexBounds,
  vectorNetworkEditability,
  vectorNetworkPointEditability,
} from "./vector-edit.js";

describe("vector vertex corner radius editing", () => {
  it("sets, clears, and reports no-op radius overrides", () => {
    const set = setVectorVertexCornerRadius(
      closedNetwork(),
      ["vertex_a", "vertex_b"],
      12.5,
    );
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.network.vertices.slice(0, 2)).toEqual([
      expect.objectContaining({ id: "vertex_a", cornerRadius: 12.5 }),
      expect.objectContaining({ id: "vertex_b", cornerRadius: 12.5 }),
    ]);
    expect(
      setVectorVertexCornerRadius(set.network, ["vertex_a"], 12.5),
    ).toMatchObject({ ok: false, code: "no-op" });
    const cleared = setVectorVertexCornerRadius(
      set.network,
      ["vertex_a"],
      null,
    );
    expect(cleared.ok).toBe(true);
    if (cleared.ok)
      expect(cleared.network.vertices[0]).not.toHaveProperty("cornerRadius");
  });

  it("rejects positive radii on open paths and curved corners", () => {
    expect(
      setVectorVertexCornerRadius(openNetwork(), ["vertex_b"], 8),
    ).toMatchObject({ ok: false, code: "unsupported-topology" });
    const curved = closedNetwork();
    curved.segments[0]!.tangentEnd = { x: -10, y: 0 };
    expect(setVectorVertexCornerRadius(curved, ["vertex_b"], 8)).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
    expect(
      setVectorVertexCornerRadius(closedNetwork(), ["missing"], 8),
    ).toMatchObject({ ok: false, code: "missing-vertex" });
    expect(
      setVectorVertexCornerRadius(closedNetwork(), ["vertex_a"], -1),
    ).toMatchObject({ ok: false, code: "invalid-network" });
  });
});

describe("vector vertex stroke appearance editing", () => {
  it("sets and clears explicit overrides without changing geometry", () => {
    const source = openNetwork();
    const set = setVectorVertexStrokeAppearance(
      source,
      ["vertex_b", "vertex_c"],
      { strokeCap: "round", strokeJoin: "bevel" },
    );
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.network.vertices[1]).toMatchObject({
      id: "vertex_b",
      strokeCap: "round",
      strokeJoin: "bevel",
    });
    expect(set.network.segments).toEqual(source.segments);

    const cleared = setVectorVertexStrokeAppearance(set.network, ["vertex_b"], {
      strokeCap: null,
      strokeJoin: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.network.vertices[1]).not.toHaveProperty("strokeCap");
    expect(cleared.network.vertices[1]).not.toHaveProperty("strokeJoin");
    expect(cleared.network.vertices[2]).toMatchObject({
      strokeCap: "round",
      strokeJoin: "bevel",
    });
  });

  it("returns structured missing and no-op failures", () => {
    expect(
      setVectorVertexStrokeAppearance(openNetwork(), ["missing"], {
        strokeCap: "square",
      }),
    ).toMatchObject({ ok: false, code: "missing-vertex" });
    expect(
      setVectorVertexStrokeAppearance(openNetwork(), ["vertex_a"], {}),
    ).toMatchObject({ ok: false, code: "no-op" });
  });
});

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

function sameSegmentDoubleCrossingNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 0, y: 50 },
      { id: "vertex_b", x: 100, y: 50 },
      { id: "vertex_c", x: 100, y: 150 },
      { id: "vertex_d", x: 0, y: 150 },
    ],
    segments: [
      {
        id: "segment_curve",
        startVertexId: "vertex_a",
        endVertexId: "vertex_b",
        tangentStart: { x: 0, y: -150 },
        tangentEnd: { x: 0, y: -150 },
      },
      { id: "segment_bc", startVertexId: "vertex_b", endVertexId: "vertex_c" },
      { id: "segment_cd", startVertexId: "vertex_c", endVertexId: "vertex_d" },
      { id: "segment_da", startVertexId: "vertex_d", endVertexId: "vertex_a" },
    ],
    paths: [
      {
        id: "path_closed",
        closed: true,
        segments: [
          { segmentId: "segment_curve", reversed: false },
          { segmentId: "segment_bc", reversed: false },
          { segmentId: "segment_cd", reversed: false },
          { segmentId: "segment_da", reversed: false },
        ],
      },
    ],
    regions: [
      {
        id: "region_face",
        windingRule: "evenodd",
        loops: [{ pathId: "path_closed", reversed: true }],
      },
    ],
  };
}

function twoClosedContourNetwork(): VectorNetwork {
  const first = closedNetwork();
  return {
    vertices: [
      ...first.vertices,
      { id: "vertex_e", x: 140, y: 0 },
      { id: "vertex_f", x: 240, y: 0 },
      { id: "vertex_g", x: 240, y: 80 },
      { id: "vertex_h", x: 140, y: 80 },
    ],
    segments: [
      ...first.segments,
      { id: "segment_ef", startVertexId: "vertex_e", endVertexId: "vertex_f" },
      { id: "segment_fg", startVertexId: "vertex_f", endVertexId: "vertex_g" },
      { id: "segment_gh", startVertexId: "vertex_g", endVertexId: "vertex_h" },
      { id: "segment_he", startVertexId: "vertex_h", endVertexId: "vertex_e" },
    ],
    paths: [
      ...first.paths,
      {
        id: "path_second",
        closed: true,
        segments: [
          { segmentId: "segment_ef", reversed: false },
          { segmentId: "segment_fg", reversed: false },
          { segmentId: "segment_gh", reversed: false },
          { segmentId: "segment_he", reversed: false },
        ],
      },
    ],
    regions: [
      ...first.regions,
      {
        id: "region_second",
        windingRule: "nonzero",
        loops: [{ pathId: "path_second", reversed: false }],
      },
    ],
  };
}

function compoundRegionNetwork(): VectorNetwork {
  const source = closedNetwork();
  source.vertices.push(
    { id: "vertex_e", x: 30, y: 20 },
    { id: "vertex_f", x: 70, y: 20 },
    { id: "vertex_g", x: 70, y: 60 },
    { id: "vertex_h", x: 30, y: 60 },
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

describe("editable vector point operations", () => {
  it("sets one region fill without changing geometry or other stable ids", () => {
    const source = closedNetwork();
    const result = setVectorRegionFills(source, "region_face", [
      { type: "solid", color: "#ef4444", opacity: 1 },
    ]);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.network.regions[0]?.fills).toEqual([
      { type: "solid", color: "#ef4444", opacity: 1 },
    ]);
    expect(result.network.paths).toEqual(source.paths);
    expect(result.network.segments).toEqual(source.segments);
    expect(setVectorRegionFills(source, "missing", [])).toMatchObject({
      ok: false,
      code: "missing-region",
    });
  });

  it("links one region to a Fill Style and direct Paint detaches it", () => {
    const source = closedNetwork();
    source.regions[0]!.fills = [
      { type: "solid", color: "#ef4444", opacity: 1 },
    ];
    const linked = setVectorRegionFillStyle(
      source,
      "region_face",
      "brand-accent",
    );
    expect(linked).toMatchObject({ ok: true });
    if (!linked.ok) return;
    expect(linked.network.regions[0]).toMatchObject({
      fillStyleId: "brand-accent",
    });
    expect(linked.network.regions[0]).not.toHaveProperty("fills");

    const detached = setVectorRegionFills(linked.network, "region_face", [
      { type: "solid", color: "#22c55e", opacity: 1 },
    ]);
    expect(detached).toMatchObject({ ok: true });
    if (!detached.ok) return;
    expect(detached.network.regions[0]?.fills).toEqual([
      { type: "solid", color: "#22c55e", opacity: 1 },
    ]);
    expect(detached.network.regions[0]).not.toHaveProperty("fillStyleId");
  });

  it("bends straight and reversed path segments through an explicit point", () => {
    const bent = bendVectorSegment(
      openNetwork(),
      "path_open",
      "segment_ab",
      0.5,
      { x: 30, y: 45 },
    );
    if (!bent.ok) throw new Error(bent.message);
    expect(bent.network.segments[0]).toMatchObject({
      tangentStart: { x: 20, y: 50 },
      tangentEnd: { x: -20, y: 30 },
    });
    expect(
      nearestVectorSegmentPoint(bent.network, { x: 30, y: 45 }),
    ).toMatchObject({
      pathId: "path_open",
      point: { x: 30, y: 45 },
      segmentId: "segment_ab",
      t: 0.5,
    });

    const reversed = openNetwork();
    reversed.vertices = reversed.vertices.slice(0, 2);
    reversed.segments = reversed.segments.slice(0, 1);
    reversed.paths[0] = {
      id: "path_open",
      closed: false,
      segments: [{ segmentId: "segment_ab", reversed: true }],
    };
    const reversedBent = bendVectorSegment(
      reversed,
      "path_open",
      "segment_ab",
      0.25,
      { x: 45, y: 38 },
    );
    if (!reversedBent.ok) throw new Error(reversedBent.message);
    expect(
      nearestVectorSegmentPoint(reversedBent.network, { x: 45, y: 38 }),
    ).toMatchObject({
      pathId: "path_open",
      point: { x: 45, y: 38 },
      segmentId: "segment_ab",
      t: 0.25,
    });
  });

  it("adds editable collinear handles on Bend click and rejects invalid targets", () => {
    const converted = bendVectorSegment(
      openNetwork(),
      "path_open",
      "segment_ab",
      0.5,
      { x: 30, y: 15 },
    );
    if (!converted.ok) throw new Error(converted.message);
    expect(converted.network.segments[0]).toMatchObject({
      tangentStart: { x: 20, y: 10 },
      tangentEnd: { x: -20, y: -10 },
    });
    expect(
      bendVectorSegment(converted.network, "path_open", "segment_ab", 0.5, {
        x: 30,
        y: 15,
      }),
    ).toMatchObject({ ok: false, code: "no-op" });
    expect(
      bendVectorSegment(openNetwork(), "path_missing", "segment_ab", 0.5, {
        x: 30,
        y: 15,
      }),
    ).toMatchObject({ ok: false, code: "missing-path" });
    expect(
      bendVectorSegment(openNetwork(), "path_open", "segment_ab", 0, {
        x: 0,
        y: 0,
      }),
    ).toMatchObject({ ok: false, code: "invalid-network" });
  });

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

  it("bounds and affinely transforms explicit vertices with their Bézier tangents", () => {
    const source = openNetwork();
    const curvedSegment = source.segments[1];
    if (!curvedSegment) throw new Error("Expected the middle test segment");
    source.segments[1] = {
      ...curvedSegment,
      tangentStart: { x: 10, y: 0 },
      tangentEnd: { x: -10, y: 0 },
    };
    expect(vectorVertexBounds(source, ["vertex_b", "vertex_c"])).toEqual({
      x: 60,
      y: 0,
      width: 60,
      height: 30,
    });
    const result = transformVectorVertices(
      source,
      ["vertex_b", "vertex_c"],
      [2, 0, 0, 0.5, 10, -5],
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.network.vertices).toEqual([
      source.vertices[0],
      { ...source.vertices[1]!, x: 130, y: 10 },
      { ...source.vertices[2]!, x: 250, y: -5 },
      source.vertices[3],
    ]);
    expect(result.network.segments[1]).toEqual({
      ...source.segments[1],
      tangentStart: { x: 20, y: 0 },
      tangentEnd: { x: -20, y: 0 },
    });
    expect(
      transformVectorVertices(source, ["vertex_missing"], [1, 0, 0, 1, 0, 0]),
    ).toMatchObject({ ok: false, code: "missing-vertex" });
    expect(
      transformVectorVertices(source, ["vertex_b"], [1, 0, 0, 1, 0, 0]),
    ).toMatchObject({ ok: false, code: "no-op" });
    expect(
      transformVectorVertices(
        source,
        ["vertex_b"],
        [1, 0, 0, 1, Number.NaN, 0],
      ),
    ).toMatchObject({ ok: false, code: "invalid-network" });
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

  it("deletes selected path segments into stable open runs", () => {
    const open = deleteVectorSegments(openNetwork(), ["segment_bc"]);
    expect(open).toMatchObject({ ok: true, deleteNode: false });
    if (!open.ok || open.deleteNode) throw new Error("Expected split paths");
    expect(open.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [{ segmentId: "segment_ab", reversed: false }],
      },
      {
        id: "path_edit_1",
        closed: false,
        segments: [{ segmentId: "segment_cd", reversed: false }],
      },
    ]);
    expect(open.network.segments.map((segment) => segment.id)).toEqual([
      "segment_ab",
      "segment_cd",
    ]);

    const closed = deleteVectorSegments(closedNetwork(), ["segment_bc"]);
    if (!closed.ok || closed.deleteNode)
      throw new Error("Expected one opened path");
    expect(closed.network.paths).toEqual([
      {
        id: "path_closed",
        closed: false,
        segments: [
          { segmentId: "segment_cd", reversed: false },
          { segmentId: "segment_da", reversed: false },
          { segmentId: "segment_ab", reversed: false },
        ],
      },
    ]);
    expect(closed.network.regions).toEqual([]);
  });

  it("deletes mixed point and path selections in one deterministic edit", () => {
    const result = deleteVectorSelection(
      openNetwork(),
      ["vertex_a"],
      ["segment_bc"],
    );
    if (!result.ok || result.deleteNode)
      throw new Error("Expected one retained path");
    expect(result.network.paths).toEqual([
      {
        id: "path_edit_1",
        closed: false,
        segments: [{ segmentId: "segment_cd", reversed: false }],
      },
    ]);
    expect(result.network.vertices.map((vertex) => vertex.id)).toEqual([
      "vertex_c",
      "vertex_d",
    ]);
    expect(
      deleteVectorSegments(openNetwork(), ["segment_missing"]),
    ).toMatchObject({ ok: false, code: "missing-segment" });
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

  it("connects two open contours into one stable non-branching path", () => {
    const result = connectVectorEndpoints(twoContourNetwork(), [
      "vertex_d",
      "vertex_e",
    ]);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);
    expect(result.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [
          { segmentId: "segment_ab", reversed: false },
          { segmentId: "segment_bc", reversed: false },
          { segmentId: "segment_cd", reversed: false },
          { segmentId: "segment_edit_1", reversed: false },
          { segmentId: "segment_ef", reversed: false },
          { segmentId: "segment_fg", reversed: false },
        ],
      },
    ]);
    expect(result.network.segments.at(-1)).toEqual({
      id: "segment_edit_1",
      startVertexId: "vertex_d",
      endVertexId: "vertex_e",
    });
    expect(vectorNetworkEditability(result.network)).toEqual({
      editable: true,
    });
  });

  it("orients either selected endpoint and preserves the earlier path identity", () => {
    const result = connectVectorEndpoints(twoContourNetwork(), [
      "vertex_a",
      "vertex_g",
    ]);
    if (!result.ok) throw new Error(result.message);
    expect(result.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [
          { segmentId: "segment_cd", reversed: true },
          { segmentId: "segment_bc", reversed: true },
          { segmentId: "segment_ab", reversed: true },
          { segmentId: "segment_edit_1", reversed: false },
          { segmentId: "segment_fg", reversed: true },
          { segmentId: "segment_ef", reversed: true },
        ],
      },
    ]);
  });

  it("closes one contour through Connect and rejects a same-path branch", () => {
    const closed = connectVectorEndpoints(openNetwork(), [
      "vertex_a",
      "vertex_d",
    ]);
    expect(closed).toMatchObject({
      ok: true,
      network: { paths: [{ id: "path_open", closed: true }] },
    });
    expect(
      connectVectorEndpoints(openNetwork(), ["vertex_a", "vertex_c"]),
    ).toEqual({
      ok: false,
      code: "unsupported-topology",
      message:
        "Vector branch Connect cannot target the same path as its source endpoint",
    });
  });

  it("connects an endpoint to another path vertex as an editable branch", () => {
    const result = connectVectorEndpoints(twoContourNetwork(), [
      "vertex_d",
      "vertex_f",
    ]);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.network.paths).toHaveLength(2);
    expect(result.network.paths[0]?.segments.at(-1)).toEqual({
      segmentId: "segment_edit_1",
      reversed: false,
    });
    expect(result.network.segments.at(-1)).toEqual({
      id: "segment_edit_1",
      startVertexId: "vertex_d",
      endVertexId: "vertex_f",
    });
    expect(vectorNetworkPointEditability(result.network)).toEqual({
      editable: true,
    });
    expect(vectorNetworkEditability(result.network)).toMatchObject({
      editable: false,
    });
    expect(findVectorPathIdForVertex(result.network, "vertex_f")).toBe(
      undefined,
    );
    const transformed = transformVectorVertices(
      result.network,
      ["vertex_f"],
      [1, 0, 0, 1, 12, -8],
    );
    expect(transformed).toMatchObject({ ok: true });
    if (!transformed.ok) return;
    expect(
      transformed.network.vertices.find(({ id }) => id === "vertex_f"),
    ).toMatchObject({ x: 312, y: 22 });
  });

  it("merges a coincident endpoint into the branch junction without orphan geometry", () => {
    const network = twoContourNetwork();
    const endpoint = network.vertices.find(({ id }) => id === "vertex_d")!;
    const target = network.vertices.find(({ id }) => id === "vertex_f")!;
    endpoint.x = target.x;
    endpoint.y = target.y;

    const result = connectVectorEndpoints(network, ["vertex_d", "vertex_f"]);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;

    expect(result.network.vertices.some(({ id }) => id === "vertex_d")).toBe(
      false,
    );
    expect(result.network.segments).toHaveLength(network.segments.length);
    expect(
      result.network.segments.filter(
        ({ startVertexId, endVertexId }) =>
          startVertexId === "vertex_f" || endVertexId === "vertex_f",
      ),
    ).toHaveLength(3);
    expect(vectorNetworkPointEditability(result.network)).toEqual({
      editable: true,
    });
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
    const result = disconnectVectorVertex(
      openNetwork(),
      "path_open",
      "vertex_c",
    );
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

    const reconnected = connectVectorEndpoints(result.network, [
      "vertex_c",
      "vertex_edit_1",
    ]);
    expect(reconnected).toEqual({ ok: true, network: openNetwork() });
  });

  it("divides a closed object with one finite drag line into two closed networks", () => {
    const source = closedNetwork();
    source.regions[0]!.fills = [
      { type: "solid", color: "#2563eb", opacity: 0.75 },
    ];
    const result = cutVectorNetworkByLine(
      source,
      { x: -20, y: 40 },
      { x: 120, y: 40 },
    );
    expect(result).toMatchObject({
      ok: true,
      retainedPathIds: ["path_closed"],
      extractedPathIds: ["path_edit_1"],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.intersections).toHaveLength(2);
    expect(
      result.intersections.map((intersection) => intersection.point),
    ).toEqual([
      { x: 0, y: 40 },
      { x: 100, y: 40 },
    ]);
    expect(result.retainedNetwork.paths).toEqual([
      expect.objectContaining({ id: "path_closed", closed: true }),
    ]);
    expect(result.extractedNetwork.paths).toEqual([
      expect.objectContaining({ id: "path_edit_1", closed: true }),
    ]);
    expect(result.retainedNetwork.regions).toEqual([
      {
        id: "region_face",
        windingRule: "nonzero",
        loops: [{ pathId: "path_closed", reversed: false }],
        fills: [{ type: "solid", color: "#2563eb", opacity: 0.75 }],
      },
    ]);
    expect(result.extractedNetwork.regions).toEqual([
      {
        id: "region_edit_1",
        windingRule: "nonzero",
        loops: [{ pathId: "path_edit_1", reversed: false }],
        fills: [{ type: "solid", color: "#2563eb", opacity: 0.75 }],
      },
    ]);
    for (const divided of [result.retainedNetwork, result.extractedNetwork]) {
      expect(vectorNetworkEditability(divided)).toEqual({ editable: true });
      const cutEdges = divided.segments.filter((segment) => {
        const start = divided.vertices.find(
          (vertex) => vertex.id === segment.startVertexId,
        );
        const end = divided.vertices.find(
          (vertex) => vertex.id === segment.endVertexId,
        );
        return start?.y === 40 && end?.y === 40;
      });
      expect(cutEdges).toHaveLength(1);
    }
  });

  it("divides an open stroke at one crossing without inventing connectors or regions", () => {
    const result = cutVectorNetworkByLine(
      openNetwork(),
      { x: 90, y: -20 },
      { x: 90, y: 50 },
    );
    expect(result).toMatchObject({
      ok: true,
      retainedPathIds: ["path_open"],
      extractedPathIds: ["path_edit_1"],
      intersections: [{ pathId: "path_open", point: { x: 90, y: 15 } }],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.retainedNetwork.paths).toEqual([
      expect.objectContaining({ id: "path_open", closed: false }),
    ]);
    expect(result.extractedNetwork.paths).toEqual([
      expect.objectContaining({ id: "path_edit_1", closed: false }),
    ]);
    for (const divided of [result.retainedNetwork, result.extractedNetwork]) {
      expect(divided.regions).toEqual([]);
      expect(vectorNetworkEditability(divided)).toEqual({ editable: true });
    }
  });

  it("keeps an uncut branch with the divided component that owns its junction", () => {
    const source = openNetwork();
    source.vertices.push({ id: "vertex_branch", x: 60, y: 90 });
    source.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_b",
      endVertexId: "vertex_branch",
    });
    source.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: true }],
    });

    const result = cutVectorNetworkByLine(
      source,
      { x: -20, y: 60 },
      { x: 200, y: 60 },
    );

    expect(result).toMatchObject({
      ok: true,
      retainedPathIds: ["path_branch"],
      extractedPathIds: ["path_open", "path_edit_1"],
    });
    if (!result.ok) throw new Error(result.message);
    expect(vectorNetworkPointEditability(result.extractedNetwork)).toEqual({
      editable: true,
    });
    expect(vectorNetworkEditability(result.extractedNetwork)).toMatchObject({
      editable: false,
    });
    const extractedJunctionOwners = result.extractedNetwork.segments.filter(
      (segment) =>
        segment.startVertexId === "vertex_b" ||
        segment.endVertexId === "vertex_b",
    );
    expect(extractedJunctionOwners).toHaveLength(3);
    expect(
      result.retainedNetwork.vertices.some(
        (vertex) => vertex.id === "vertex_b",
      ),
    ).toBe(false);
  });

  it("moves an attached closed-path branch with the extracted fill component", () => {
    const source = closedNetwork();
    source.vertices.push({ id: "vertex_branch", x: 150, y: 100 });
    source.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_c",
      endVertexId: "vertex_branch",
    });
    source.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: false }],
    });

    const result = cutVectorNetworkByLine(
      source,
      { x: -20, y: 40 },
      { x: 170, y: 40 },
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);
    expect(result.retainedPathIds).toEqual(["path_closed"]);
    expect(result.extractedPathIds).toEqual(["path_branch", "path_edit_1"]);
    expect(result.retainedNetwork.regions[0]?.id).toBe("region_face");
    expect(result.extractedNetwork.regions).toHaveLength(1);
    expect(
      result.extractedNetwork.segments.filter(
        (segment) =>
          segment.startVertexId === "vertex_c" ||
          segment.endVertexId === "vertex_c",
      ),
    ).toHaveLength(3);
  });

  it("rejects a drag line through a shared junction instead of guessing incident ownership", () => {
    const source = openNetwork();
    source.vertices.push({ id: "vertex_branch", x: 90, y: 90 });
    source.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_b",
      endVertexId: "vertex_branch",
    });
    source.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: false }],
    });

    const result = cutVectorNetworkByLine(
      source,
      { x: 60, y: -20 },
      { x: 60, y: 120 },
    );

    expect(result).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
    if (result.ok) throw new Error("Shared-junction line Cut should fail");
    expect(result.message).toContain("shared junction vertex_b");
  });

  it("alternates open-stroke pieces across three crossings and preserves source traversal order", () => {
    const result = cutVectorNetworkByLine(
      openNetwork(),
      { x: -20, y: 15 },
      { x: 200, y: 15 },
    );
    expect(result).toMatchObject({
      ok: true,
      retainedPathIds: ["path_open", "path_edit_2"],
      extractedPathIds: ["path_edit_3", "path_edit_1"],
    });
    if (!result.ok) throw new Error(result.message);
    expect(
      result.intersections.map((intersection) => intersection.point),
    ).toEqual([
      { x: 30, y: 15 },
      { x: 90, y: 15 },
      { x: 150, y: 15 },
    ]);
    expect(result.retainedNetwork.paths).toHaveLength(2);
    expect(result.extractedNetwork.paths).toHaveLength(2);
    expect(result.retainedNetwork.paths.every((path) => !path.closed)).toBe(
      true,
    );
    expect(result.extractedNetwork.paths.every((path) => !path.closed)).toBe(
      true,
    );
    expect(result.retainedNetwork.regions).toEqual([]);
    expect(result.extractedNetwork.regions).toEqual([]);
    expect(vectorNetworkEditability(result.retainedNetwork)).toEqual({
      editable: true,
    });
    expect(vectorNetworkEditability(result.extractedNetwork)).toEqual({
      editable: true,
    });
  });

  it("remaps two open-stroke crossings on one cubic without reusing a stale parameter", () => {
    const source = sameSegmentDoubleCrossingNetwork();
    source.vertices = source.vertices.slice(0, 2);
    source.segments = source.segments.slice(0, 1);
    source.paths = [
      {
        id: "path_open",
        closed: false,
        segments: [{ segmentId: "segment_curve", reversed: false }],
      },
    ];
    source.regions = [];
    const result = cutVectorNetworkByLine(
      source,
      { x: -20, y: 0 },
      { x: 120, y: 0 },
    );
    expect(result).toMatchObject({
      ok: true,
      retainedPathIds: ["path_open", "path_edit_1"],
      extractedPathIds: ["path_edit_2"],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.intersections).toHaveLength(2);
    expect(result.retainedNetwork.paths).toHaveLength(2);
    expect(result.extractedNetwork.paths).toHaveLength(1);
    expect(vectorNetworkEditability(result.retainedNetwork)).toEqual({
      editable: true,
    });
    expect(vectorNetworkEditability(result.extractedNetwork)).toEqual({
      editable: true,
    });
  });

  it("solves two crossings on one cubic before remapping the second split", () => {
    const result = cutVectorNetworkByLine(
      sameSegmentDoubleCrossingNetwork(),
      { x: -20, y: 0 },
      { x: 120, y: 0 },
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);
    expect(result.intersections).toHaveLength(2);
    expect(
      result.intersections.every(
        (intersection) =>
          intersection.location.kind === "segment" &&
          intersection.location.segmentId === "segment_curve",
      ),
    ).toBe(true);
    expect(result.intersections[0]!.point.x).toBeLessThan(
      result.intersections[1]!.point.x,
    );
    expect(result.retainedNetwork.regions[0]).toMatchObject({
      id: "region_face",
      windingRule: "evenodd",
      loops: [{ pathId: "path_closed", reversed: true }],
    });
    expect(result.extractedNetwork.paths[0]?.segments).toHaveLength(2);
    expect(vectorNetworkEditability(result.extractedNetwork)).toEqual({
      editable: true,
    });
  });

  it("divides multiple independent closed contours into one retained and one extracted network", () => {
    const result = cutVectorNetworkByLine(
      twoClosedContourNetwork(),
      { x: -20, y: 40 },
      { x: 260, y: 40 },
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);
    expect(result.intersections).toHaveLength(4);
    expect(result.retainedPathIds).toEqual(["path_closed", "path_second"]);
    expect(result.extractedPathIds).toEqual(["path_edit_1", "path_edit_2"]);
    expect(result.retainedNetwork.paths).toHaveLength(2);
    expect(result.extractedNetwork.paths).toHaveLength(2);
    expect(result.retainedNetwork.regions).toHaveLength(2);
    expect(result.extractedNetwork.regions).toHaveLength(2);
    expect(vectorNetworkEditability(result.retainedNetwork)).toEqual({
      editable: true,
    });
    expect(vectorNetworkEditability(result.extractedNetwork)).toEqual({
      editable: true,
    });
  });

  it("preserves a closed stroke-only contour without inventing fill regions", () => {
    const source = closedNetwork();
    source.regions = [];
    const result = cutVectorNetworkByLine(
      source,
      { x: -20, y: 40 },
      { x: 120, y: 40 },
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.retainedNetwork.regions).toEqual([]);
    expect(result.extractedNetwork.regions).toEqual([]);
    expect(result.retainedNetwork.paths[0]?.closed).toBe(true);
    expect(result.extractedNetwork.paths[0]?.closed).toBe(true);
  });

  it("divides a concave closed region across four crossings into one retained and two extracted components", () => {
    const result = cutVectorNetworkByLine(
      concaveFourCrossingNetwork(),
      { x: -20, y: 50 },
      { x: 120, y: 50 },
    );
    expect(result).toMatchObject({
      ok: true,
      retainedPathIds: ["path_concave"],
      extractedPathIds: ["path_edit_1", "path_edit_2"],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.intersections.map((item) => item.point)).toEqual([
      { x: 0, y: 50 },
      { x: 30, y: 50 },
      { x: 70, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(result.retainedNetwork.regions).toHaveLength(1);
    expect(result.extractedNetwork.regions).toHaveLength(2);
    expect(result.extractedNetwork.paths.every((path) => path.closed)).toBe(
      true,
    );
    expect(vectorNetworkEditability(result.retainedNetwork)).toEqual({
      editable: true,
    });
    expect(vectorNetworkEditability(result.extractedNetwork)).toEqual({
      editable: true,
    });
  });

  it("moves an uncut compound hole with the divided side that contains it", () => {
    const source = compoundRegionNetwork();
    source.regions[0]!.loops.reverse();
    const result = cutVectorNetworkByLine(
      source,
      { x: -20, y: 10 },
      { x: 120, y: 10 },
    );
    expect(result).toMatchObject({
      ok: true,
      retainedPathIds: ["path_closed"],
      extractedPathIds: ["path_edit_1", "path_hole"],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.retainedNetwork.regions).toEqual([
      {
        id: "region_face",
        windingRule: "nonzero",
        loops: [{ pathId: "path_closed", reversed: false }],
      },
    ]);
    expect(result.extractedNetwork.paths.map((path) => path.id)).toEqual([
      "path_edit_1",
      "path_hole",
    ]);
    expect(result.extractedNetwork.regions).toEqual([
      expect.objectContaining({
        windingRule: "nonzero",
        loops: [
          { pathId: "path_edit_1", reversed: false },
          { pathId: "path_hole", reversed: true },
        ],
      }),
    ]);
    expect(vectorNetworkEditability(result.retainedNetwork)).toEqual({
      editable: true,
    });
    expect(vectorNetworkEditability(result.extractedNetwork)).toEqual({
      editable: true,
    });
  });

  it("keeps an uncut compound hole in the retained source side", () => {
    const result = cutVectorNetworkByLine(
      compoundRegionNetwork(),
      { x: -20, y: 70 },
      { x: 120, y: 70 },
    );
    expect(result).toMatchObject({
      ok: true,
      retainedPathIds: ["path_closed", "path_hole"],
      extractedPathIds: ["path_edit_1"],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.retainedNetwork.regions).toEqual([
      {
        id: "region_face",
        windingRule: "nonzero",
        loops: [
          { pathId: "path_closed", reversed: false },
          { pathId: "path_hole", reversed: true },
        ],
      },
    ]);
    expect(result.extractedNetwork.regions).toEqual([
      expect.objectContaining({
        windingRule: "nonzero",
        loops: [{ pathId: "path_edit_1", reversed: false }],
      }),
    ]);
  });

  it("redistributes multiple uncut holes to opposite divided sides", () => {
    const source = compoundRegionNetwork();
    source.vertices = source.vertices.map((vertex) => {
      if (vertex.id === "vertex_e") return { ...vertex, y: 8 };
      if (vertex.id === "vertex_f") return { ...vertex, y: 8 };
      if (vertex.id === "vertex_g") return { ...vertex, y: 28 };
      if (vertex.id === "vertex_h") return { ...vertex, y: 28 };
      return vertex;
    });
    source.vertices.push(
      { id: "vertex_i", x: 30, y: 52 },
      { id: "vertex_j", x: 70, y: 52 },
      { id: "vertex_k", x: 70, y: 72 },
      { id: "vertex_l", x: 30, y: 72 },
    );
    source.segments.push(
      { id: "segment_ij", startVertexId: "vertex_i", endVertexId: "vertex_j" },
      { id: "segment_jk", startVertexId: "vertex_j", endVertexId: "vertex_k" },
      { id: "segment_kl", startVertexId: "vertex_k", endVertexId: "vertex_l" },
      { id: "segment_li", startVertexId: "vertex_l", endVertexId: "vertex_i" },
    );
    source.paths.push({
      id: "path_hole_second",
      closed: true,
      segments: [
        { segmentId: "segment_ij", reversed: false },
        { segmentId: "segment_jk", reversed: false },
        { segmentId: "segment_kl", reversed: false },
        { segmentId: "segment_li", reversed: false },
      ],
    });
    source.regions[0]!.loops.push({
      pathId: "path_hole_second",
      reversed: true,
    });

    const result = cutVectorNetworkByLine(
      source,
      { x: -20, y: 40 },
      { x: 120, y: 40 },
    );
    expect(result).toMatchObject({
      ok: true,
      retainedPathIds: ["path_closed", "path_hole"],
      extractedPathIds: ["path_edit_1", "path_hole_second"],
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.retainedNetwork.regions[0]?.loops).toEqual([
      { pathId: "path_closed", reversed: false },
      { pathId: "path_hole", reversed: true },
    ]);
    expect(result.extractedNetwork.regions[0]?.loops).toEqual([
      { pathId: "path_edit_1", reversed: false },
      { pathId: "path_hole_second", reversed: true },
    ]);
    expect(vectorNetworkEditability(result.retainedNetwork)).toEqual({
      editable: true,
    });
    expect(vectorNetworkEditability(result.extractedNetwork)).toEqual({
      editable: true,
    });
  });

  it("ignores open endpoints, rejects overlap/non-crossing, and stitches crossed-hole boundaries", () => {
    expect(
      cutVectorNetworkByLine(
        openNetwork(),
        { x: 0, y: -100 },
        { x: 0, y: 100 },
      ),
    ).toMatchObject({ ok: false, code: "no-op" });
    expect(
      cutVectorNetworkByLine(
        closedNetwork(),
        { x: -20, y: 0 },
        { x: 120, y: 0 },
      ),
    ).toMatchObject({ ok: false, code: "unsupported-topology" });
    expect(
      cutVectorNetworkByLine(
        closedNetwork(),
        { x: -20, y: -20 },
        { x: 120, y: -20 },
      ),
    ).toMatchObject({ ok: false, code: "no-op" });
    const compound = cutVectorNetworkByLine(
      compoundRegionNetwork(),
      { x: -20, y: 40 },
      { x: 120, y: 40 },
    );
    expect(compound).toMatchObject({
      ok: true,
      retainedPathIds: ["path_closed"],
      extractedPathIds: ["path_edit_1"],
    });
    if (!compound.ok) throw new Error(compound.message);
    expect(compound.intersections.map((item) => item.point)).toEqual([
      { x: 0, y: 40 },
      { x: 30, y: 40 },
      { x: 70, y: 40 },
      { x: 100, y: 40 },
    ]);
    for (const divided of [
      compound.retainedNetwork,
      compound.extractedNetwork,
    ]) {
      expect(divided.paths).toHaveLength(1);
      expect(divided.regions).toEqual([
        expect.objectContaining({
          windingRule: "nonzero",
          loops: [expect.objectContaining({ reversed: false })],
        }),
      ]);
      expect(vectorNetworkEditability(divided)).toEqual({ editable: true });
    }
  });

  it("rejects direct hole cuts, ambiguous outers, and shared compound loops", () => {
    const directHole = cutVectorNetworkByLine(
      compoundRegionNetwork(),
      { x: 20, y: 40 },
      { x: 80, y: 40 },
    );
    expect(directHole).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
    if (directHole.ok) throw new Error("Direct hole Cut should fail");
    expect(directHole.message).toContain("outer boundary");

    const ambiguous = compoundRegionNetwork();
    ambiguous.vertices = ambiguous.vertices.map((vertex) => {
      if (vertex.id.startsWith("vertex_a")) return { ...vertex, x: 0, y: 0 };
      if (vertex.id === "vertex_b") return { ...vertex, x: 80, y: 0 };
      if (vertex.id === "vertex_c") return { ...vertex, x: 80, y: 80 };
      if (vertex.id === "vertex_d") return { ...vertex, x: 0, y: 80 };
      if (vertex.id === "vertex_e") return { ...vertex, x: 20, y: -10 };
      if (vertex.id === "vertex_f") return { ...vertex, x: 100, y: -10 };
      if (vertex.id === "vertex_g") return { ...vertex, x: 100, y: 70 };
      if (vertex.id === "vertex_h") return { ...vertex, x: 20, y: 70 };
      return vertex;
    });
    const ambiguousOuter = cutVectorNetworkByLine(
      ambiguous,
      { x: -20, y: 40 },
      { x: 120, y: 40 },
    );
    expect(ambiguousOuter).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
    if (ambiguousOuter.ok) throw new Error("Ambiguous outer Cut should fail");
    expect(ambiguousOuter.message).toContain("unambiguous outer loop");

    const shared = compoundRegionNetwork();
    shared.regions.push({
      id: "region_shared_hole",
      windingRule: "evenodd",
      loops: [{ pathId: "path_hole", reversed: false }],
    });
    const sharedLoop = cutVectorNetworkByLine(
      shared,
      { x: -20, y: 10 },
      { x: 120, y: 10 },
    );
    expect(sharedLoop).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
    if (sharedLoop.ok) throw new Error("Shared compound loop Cut should fail");
    expect(sharedLoop.message).toContain("exactly one fill region");
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

  it("keeps branch junctions point-editable while topology editing stays guarded", () => {
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
    const moved = moveVectorVertices(network, ["vertex_b"], { x: 1, y: 1 });
    expect(moved).toMatchObject({ ok: true });
    if (!moved.ok) return;
    expect(
      moved.network.vertices.find(({ id }) => id === "vertex_b"),
    ).toMatchObject({ x: 61, y: 31 });
  });

  it("connects unique endpoints inside an existing branch network", () => {
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

    const merged = connectVectorEndpoints(network, [
      "vertex_d",
      "vertex_branch",
    ]);
    expect(merged).toMatchObject({ ok: true });
    if (!merged.ok) return;
    expect(merged.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [
          { segmentId: "segment_ab", reversed: false },
          { segmentId: "segment_bc", reversed: false },
          { segmentId: "segment_cd", reversed: false },
          { segmentId: "segment_edit_1", reversed: false },
          { segmentId: "segment_branch", reversed: true },
        ],
      },
    ]);
    expect(
      merged.network.segments.find(({ id }) => id === "segment_edit_1"),
    ).toMatchObject({
      startVertexId: "vertex_d",
      endVertexId: "vertex_branch",
    });
    expect(vectorNetworkPointEditability(merged.network)).toEqual({
      editable: true,
    });

    const closed = connectVectorEndpoints(network, ["vertex_a", "vertex_d"]);
    expect(closed).toMatchObject({ ok: true });
    if (!closed.ok) return;
    expect(closed.network.paths).toMatchObject([
      { id: "path_open", closed: true },
      { id: "path_branch", closed: false },
    ]);
    expect(closed.network.regions).toHaveLength(1);
    expect(vectorNetworkPointEditability(closed.network)).toEqual({
      editable: true,
    });
  });

  it("deletes a shared branch junction without rewriting unaffected path IDs", () => {
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

    const deleted = deleteVectorVertices(network, ["vertex_b"]);
    expect(deleted).toMatchObject({ ok: true, deleteNode: false });
    if (!deleted.ok || deleted.deleteNode) return;
    expect(deleted.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [
          { segmentId: "segment_edit_1", reversed: false },
          { segmentId: "segment_cd", reversed: false },
        ],
      },
    ]);
    expect(deleted.network.segments).toEqual([
      {
        id: "segment_edit_1",
        startVertexId: "vertex_a",
        endVertexId: "vertex_c",
      },
      {
        id: "segment_cd",
        startVertexId: "vertex_c",
        endVertexId: "vertex_d",
      },
    ]);
    expect(deleted.network.vertices.map(({ id }) => id)).toEqual([
      "vertex_a",
      "vertex_c",
      "vertex_d",
    ]);
    expect(vectorNetworkEditability(deleted.network)).toEqual({
      editable: true,
    });
  });

  it("cuts one explicit path at a shared branch junction", () => {
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

    const cut = cutVectorPath(network, "path_open", {
      kind: "vertex",
      vertexId: "vertex_b",
    });
    expect(cut).toMatchObject({
      ok: true,
      cutVertexIds: ["vertex_b", "vertex_edit_1"],
      pathIds: ["path_open", "path_edit_1"],
    });
    if (!cut.ok) return;
    expect(cut.network.paths).toEqual([
      {
        id: "path_open",
        closed: false,
        segments: [{ segmentId: "segment_ab", reversed: false }],
      },
      {
        id: "path_edit_1",
        closed: false,
        segments: [
          { segmentId: "segment_bc", reversed: false },
          { segmentId: "segment_cd", reversed: false },
        ],
      },
      {
        id: "path_branch",
        closed: false,
        segments: [{ segmentId: "segment_branch", reversed: false }],
      },
    ]);
    expect(
      cut.network.segments.find(({ id }) => id === "segment_bc"),
    ).toMatchObject({ startVertexId: "vertex_edit_1" });
    expect(
      cut.network.segments.find(({ id }) => id === "segment_branch"),
    ).toMatchObject({ startVertexId: "vertex_b" });
    expect(vectorNetworkPointEditability(cut.network)).toEqual({
      editable: true,
    });
  });

  it("disconnects one explicit path endpoint from a shared branch junction", () => {
    const network = openNetwork();
    network.vertices.push({ id: "vertex_branch", x: 60, y: 90 });
    network.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_b",
      endVertexId: "vertex_branch",
      tangentStart: { x: 0, y: 20 },
    });
    network.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: false }],
    });

    const disconnected = disconnectVectorVertex(
      network,
      "path_branch",
      "vertex_b",
    );
    expect(disconnected).toMatchObject({
      ok: true,
      cutVertexIds: ["vertex_b", "vertex_edit_1"],
      pathIds: ["path_branch"],
    });
    if (!disconnected.ok) return;
    expect(
      disconnected.network.segments.find(({ id }) => id === "segment_branch"),
    ).toMatchObject({
      startVertexId: "vertex_edit_1",
      tangentStart: { x: 0, y: 20 },
    });
    expect(
      disconnected.network.segments.find(({ id }) => id === "segment_ab"),
    ).toMatchObject({ endVertexId: "vertex_b" });
    expect(vectorNetworkEditability(disconnected.network)).toEqual({
      editable: true,
    });

    expect(
      disconnectVectorVertex(network, "path_open", "vertex_b"),
    ).toMatchObject({
      ok: false,
      code: "unsupported-topology",
      message:
        "Disconnecting an internal branch junction requires an explicit incident edge",
    });

    const detachedIncoming = disconnectVectorVertex(
      network,
      "path_open",
      "vertex_b",
      "segment_ab",
    );
    expect(detachedIncoming).toMatchObject({
      ok: true,
      cutVertexIds: ["vertex_b", "vertex_edit_1"],
      pathIds: ["path_open", "path_edit_1"],
    });
    if (!detachedIncoming.ok) return;
    expect(
      detachedIncoming.network.segments.find(({ id }) => id === "segment_ab"),
    ).toMatchObject({ endVertexId: "vertex_edit_1" });
    expect(
      detachedIncoming.network.segments.find(({ id }) => id === "segment_bc"),
    ).toMatchObject({ startVertexId: "vertex_b" });
    expect(vectorNetworkPointEditability(detachedIncoming.network)).toEqual({
      editable: true,
    });
    expect(vectorNetworkEditability(detachedIncoming.network)).toEqual({
      editable: false,
      reason: "Connected path runs require topology-specific editing",
    });

    const cutSegment = cutVectorPath(network, "path_branch", {
      kind: "segment",
      segmentId: "segment_branch",
      t: 0.5,
    });
    expect(cutSegment).toMatchObject({
      ok: true,
      cutVertexIds: ["vertex_edit_1", "vertex_edit_2"],
      pathIds: ["path_branch", "path_edit_1"],
    });
    if (!cutSegment.ok) return;
    expect(vectorNetworkPointEditability(cutSegment.network)).toEqual({
      editable: true,
    });
    expect(
      cutVectorPath(network, "path_open", {
        kind: "vertex",
        vertexId: "vertex_b",
      }),
    ).toMatchObject({
      ok: true,
      cutVertexIds: ["vertex_b", "vertex_edit_1"],
      pathIds: ["path_open", "path_edit_1"],
    });

    const deleted = deleteVectorSegments(network, ["segment_branch"]);
    expect(deleted).toMatchObject({ ok: true, deleteNode: false });
    if (!deleted.ok || deleted.deleteNode) return;
    expect(deleted.network.paths).toEqual([network.paths[0]]);
    expect(
      deleted.network.vertices.some(({ id }) => id === "vertex_branch"),
    ).toBe(false);
    expect(vectorNetworkEditability(deleted.network)).toEqual({
      editable: true,
    });
  });

  it("disconnects an explicit incident edge from a closed branch junction", () => {
    const network = closedNetwork();
    network.vertices.push({ id: "vertex_branch", x: 140, y: 40 });
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

    const incoming = disconnectVectorVertex(
      network,
      "path_closed",
      "vertex_b",
      "segment_ab",
    );
    expect(incoming).toMatchObject({
      ok: true,
      cutVertexIds: ["vertex_b", "vertex_edit_1"],
      pathIds: ["path_closed"],
    });
    if (!incoming.ok) return;
    expect(incoming.network.paths).toEqual([
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
      {
        id: "path_branch",
        closed: false,
        segments: [{ segmentId: "segment_branch", reversed: false }],
      },
    ]);
    expect(
      incoming.network.segments.find(({ id }) => id === "segment_ab"),
    ).toMatchObject({ endVertexId: "vertex_edit_1" });
    expect(
      incoming.network.segments.find(({ id }) => id === "segment_branch"),
    ).toMatchObject({ startVertexId: "vertex_b" });
    expect(incoming.network.regions).toEqual([]);

    const outgoing = disconnectVectorVertex(
      network,
      "path_closed",
      "vertex_b",
      "segment_bc",
    );
    expect(outgoing).toMatchObject({ ok: true });
    if (!outgoing.ok) return;
    expect(
      outgoing.network.segments.find(({ id }) => id === "segment_bc"),
    ).toMatchObject({ startVertexId: "vertex_edit_1" });
    expect(vectorNetworkPointEditability(outgoing.network)).toEqual({
      editable: true,
    });
  });

  it("moves one branch-junction handle independently", () => {
    const network = openNetwork();
    network.segments[0]!.tangentEnd = { x: -20, y: 0 };
    network.segments[1]!.tangentStart = { x: 20, y: 0 };
    network.vertices.push({ id: "vertex_branch", x: 60, y: 90 });
    network.segments.push({
      id: "segment_branch",
      startVertexId: "vertex_b",
      endVertexId: "vertex_branch",
      tangentStart: { x: 0, y: 20 },
    });
    network.paths.push({
      id: "path_branch",
      closed: false,
      segments: [{ segmentId: "segment_branch", reversed: false }],
    });

    const moved = moveVectorHandle(
      network,
      { segmentId: "segment_branch", side: "start" },
      { x: 8, y: 26 },
    );
    expect(moved).toMatchObject({ ok: true });
    if (!moved.ok) return;
    expect(
      moved.network.segments.find(({ id }) => id === "segment_ab"),
    ).toMatchObject({ tangentEnd: { x: -20, y: 0 } });
    expect(
      moved.network.segments.find(({ id }) => id === "segment_bc"),
    ).toMatchObject({ tangentStart: { x: 20, y: 0 } });
    expect(
      moved.network.segments.find(({ id }) => id === "segment_branch"),
    ).toMatchObject({ tangentStart: { x: 8, y: 26 } });
    expect(
      moved.network.vertices.find(({ id }) => id === "vertex_b"),
    ).toMatchObject({ handleMode: "independent" });

    const bent = bendVectorSegment(
      moved.network,
      "path_branch",
      "segment_branch",
      0.5,
      { x: 78, y: 62 },
    );
    expect(bent).toMatchObject({ ok: true });
    if (!bent.ok) return;
    const bentBranch = bent.network.segments.find(
      ({ id }) => id === "segment_branch",
    );
    expect(bentBranch?.tangentStart).toBeDefined();
    expect(bentBranch?.tangentEnd).toBeDefined();
    expect(
      bent.network.segments.find(({ id }) => id === "segment_ab"),
    ).toMatchObject({ tangentEnd: { x: -20, y: 0 } });
  });
});
