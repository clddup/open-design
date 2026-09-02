import type { VectorNetwork } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { insertVectorPoint } from "./vector-point-insert.js";

describe("insertVectorPoint", () => {
  it("splits a line without opening its path or region", () => {
    const network = lineNetwork(true);

    const result = insertVectorPoint(network, "path_main", "segment_ab", 0.25);

    expect(result).toMatchObject({
      incomingHandle: { segmentId: "segment_ab", side: "end" },
      ok: true,
      outgoingHandle: { segmentId: "segment_pen_1", side: "start" },
      segmentIds: ["segment_ab", "segment_pen_1"],
      vertexId: "vertex_pen_1",
    });
    if (!result.ok) return;
    expect(result.network.vertices.at(-1)).toEqual({
      id: "vertex_pen_1",
      x: 25,
      y: 0,
    });
    expect(result.network.segments).toEqual([
      {
        id: "segment_ab",
        startVertexId: "vertex_a",
        endVertexId: "vertex_pen_1",
      },
      {
        id: "segment_pen_1",
        startVertexId: "vertex_pen_1",
        endVertexId: "vertex_b",
      },
      {
        id: "segment_ba",
        startVertexId: "vertex_b",
        endVertexId: "vertex_a",
      },
    ]);
    expect(result.network.paths[0]).toEqual({
      id: "path_main",
      closed: true,
      segments: [
        { segmentId: "segment_ab", reversed: false },
        { segmentId: "segment_pen_1", reversed: false },
        { segmentId: "segment_ba", reversed: false },
      ],
    });
    expect(result.network.regions).toEqual(network.regions);
    expect(network.segments).toHaveLength(2);
  });

  it("uses de Casteljau handles to preserve a cubic exactly", () => {
    const network = lineNetwork(false);
    network.segments[0] = {
      ...network.segments[0]!,
      tangentStart: { x: 30, y: 60 },
      tangentEnd: { x: -20, y: 40 },
    };

    const result = insertVectorPoint(network, "path_main", "segment_ab", 0.5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.vertices.at(-1)).toEqual({
      id: "vertex_pen_1",
      x: 53.75,
      y: 37.5,
    });
    expect(result.network.segments).toEqual([
      {
        id: "segment_ab",
        startVertexId: "vertex_a",
        endVertexId: "vertex_pen_1",
        tangentStart: { x: 15, y: 30 },
        tangentEnd: { x: -18.75, y: 2.5 },
      },
      {
        id: "segment_pen_1",
        startVertexId: "vertex_pen_1",
        endVertexId: "vertex_b",
        tangentStart: { x: 18.75, y: -2.5 },
        tangentEnd: { x: -10, y: 20 },
      },
    ]);
  });

  it("keeps path-directed order for a reversed segment reference", () => {
    const network = lineNetwork(false);
    network.paths[0]!.segments[0] = {
      segmentId: "segment_ab",
      reversed: true,
    };

    const result = insertVectorPoint(network, "path_main", "segment_ab", 0.25);

    expect(result).toMatchObject({
      incomingHandle: { segmentId: "segment_ab", side: "start" },
      ok: true,
      outgoingHandle: { segmentId: "segment_pen_1", side: "end" },
    });
    if (!result.ok) return;
    expect(result.network.vertices.at(-1)).toEqual({
      id: "vertex_pen_1",
      x: 75,
      y: 0,
    });
    expect(result.network.segments).toEqual([
      {
        id: "segment_ab",
        startVertexId: "vertex_pen_1",
        endVertexId: "vertex_b",
      },
      {
        id: "segment_pen_1",
        startVertexId: "vertex_a",
        endVertexId: "vertex_pen_1",
      },
    ]);
    expect(result.network.paths[0]?.segments).toEqual([
      { segmentId: "segment_ab", reversed: true },
      { segmentId: "segment_pen_1", reversed: true },
    ]);
  });

  it("fails closed for endpoints, missing targets, and invalid input", () => {
    const network = lineNetwork(false);
    expect(
      insertVectorPoint(network, "path_main", "segment_ab", 0),
    ).toMatchObject({ code: "no-op", ok: false });
    expect(
      insertVectorPoint(network, "missing", "segment_ab", 0.5),
    ).toMatchObject({ code: "missing-path", ok: false });
    expect(
      insertVectorPoint(network, "path_main", "missing", 0.5),
    ).toMatchObject({ code: "missing-segment", ok: false });
    expect(
      insertVectorPoint(network, "path_main", "segment_ab", Number.NaN),
    ).toMatchObject({ code: "invalid-network", ok: false });
    expect(network).toEqual(lineNetwork(false));
  });
});

function lineNetwork(closed: boolean): VectorNetwork {
  return {
    vertices: [
      { id: "vertex_a", x: 0, y: 0 },
      { id: "vertex_b", x: 100, y: 0 },
    ],
    segments: [
      {
        id: "segment_ab",
        startVertexId: "vertex_a",
        endVertexId: "vertex_b",
      },
      ...(closed
        ? [
            {
              id: "segment_ba",
              startVertexId: "vertex_b",
              endVertexId: "vertex_a",
            },
          ]
        : []),
    ],
    paths: [
      {
        id: "path_main",
        closed,
        segments: [
          { segmentId: "segment_ab", reversed: false },
          ...(closed ? [{ segmentId: "segment_ba", reversed: false }] : []),
        ],
      },
    ],
    regions: closed
      ? [
          {
            id: "region_main",
            loops: [{ pathId: "path_main", reversed: false }],
            windingRule: "nonzero",
          },
        ]
      : [],
  };
}
