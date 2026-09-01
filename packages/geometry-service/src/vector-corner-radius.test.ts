import type { VectorNetwork } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  serializeVectorNetwork,
  validateVectorNetwork,
} from "./editable-vector.js";
import { reverseVectorPath } from "./vector-edit.js";
import { projectVectorNetworkCornerRadii } from "./vector-corner-radius.js";

describe("Vector vertex corner radius", () => {
  it("projects a closed square into trimmed edges and circular cubic corners", () => {
    const network = squareNetwork();
    network.vertices[0]!.cornerRadius = 10;
    const result = projectVectorNetworkCornerRadii(network);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.paths[0]?.segments).toHaveLength(5);
    expect(result.network.vertices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 0, y: 10 }),
        expect.objectContaining({ x: 10, y: 0 }),
      ]),
    );
    const serialized = serializeVectorNetwork(result.network);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(serialized.path).toContain("C");
  });

  it("uses the node fallback and clamps each corner to half adjacent edges", () => {
    const result = projectVectorNetworkCornerRadii(squareNetwork(), 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const points = result.network.vertices.map(({ x, y }) => [x, y]);
    expect(points).toEqual(
      expect.arrayContaining([
        [0, 50],
        [50, 0],
        [100, 50],
        [50, 100],
      ]),
    );
  });

  it("projects node-level smoothing as two curvature ramps and a circular center", () => {
    const network = squareNetwork();
    network.vertices[0]!.cornerRadius = 10;
    const result = projectVectorNetworkCornerRadii(network, 0, 0.6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.paths[0]?.segments).toHaveLength(7);
    expect(result.network.vertices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 0, y: 16 }),
        expect.objectContaining({ x: 16, y: 0 }),
      ]),
    );
    const circleStart = result.network.vertices.find((item) =>
      item.id.includes("__corner_circle_start_"),
    );
    const circleEnd = result.network.vertices.find((item) =>
      item.id.includes("__corner_circle_end_"),
    );
    expect(circleStart?.x).toBeCloseTo(1.089934758);
    expect(circleStart?.y).toBeCloseTo(5.460095003);
    expect(circleEnd?.x).toBeCloseTo(5.460095003);
    expect(circleEnd?.y).toBeCloseTo(1.089934758);
    const cornerSegments = result.network.segments.filter((segment) =>
      segment.id.includes("__corner_"),
    );
    expect(cornerSegments.map((segment) => segment.id)).toEqual([
      expect.stringContaining("__corner_ramp_in_"),
      expect.stringContaining("__corner_arc_"),
      expect.stringContaining("__corner_ramp_out_"),
    ]);
    expect(cornerSegments[0]?.tangentStart?.x).toBeCloseTo(0);
    expect(serializeVectorNetwork(result.network)).toMatchObject({ ok: true });
  });

  it("reduces smoothing before radius when adjacent edges exhaust the budget", () => {
    const network = squareNetwork();
    network.vertices[0]!.cornerRadius = 40;
    const result = projectVectorNetworkCornerRadii(network, 0, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.vertices).toContainEqual(
      expect.objectContaining({ x: 0, y: 50 }),
    );
    expect(
      result.network.segments.filter((segment) =>
        segment.id.includes("__corner_"),
      ),
    ).toHaveLength(3);
  });

  it("joins full smoothing ramps without a zero-length central arc", () => {
    const network = squareNetwork();
    network.vertices[0]!.cornerRadius = 10;
    const result = projectVectorNetworkCornerRadii(network, 0, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.network.segments.filter((segment) =>
        segment.id.includes("__corner_"),
      ),
    ).toHaveLength(2);
    expect(validateVectorNetwork(result.network)).toEqual([]);
  });

  it("rejects smoothing outside the Figma-compatible zero-to-one range", () => {
    expect(projectVectorNetworkCornerRadii(squareNetwork(), 4, -0.1)).toEqual({
      ok: false,
      message: "Vector corner smoothing must be between 0 and 1",
    });
    expect(projectVectorNetworkCornerRadii(squareNetwork(), 4, 1.1)).toEqual({
      ok: false,
      message: "Vector corner smoothing must be between 0 and 1",
    });
  });

  it("keeps open paths and curve-handle vertices sharp", () => {
    const open = squareNetwork();
    open.paths[0]!.closed = false;
    open.paths[0]!.segments.pop();
    open.segments.pop();
    open.regions = [];
    open.vertices[1]!.cornerRadius = 12;
    expect(projectVectorNetworkCornerRadii(open)).toEqual({
      ok: true,
      network: open,
    });

    const curved = squareNetwork();
    curved.vertices[1]!.cornerRadius = 12;
    curved.segments[0]!.tangentStart = { x: 20, y: 0 };
    const result = projectVectorNetworkCornerRadii(curved);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.paths[0]?.segments).toHaveLength(4);
  });

  it("preserves the authored network instead of persisting synthetic points", () => {
    const network = squareNetwork();
    network.vertices[0]!.cornerRadius = 8;
    const source = structuredClone(network);
    projectVectorNetworkCornerRadii(network);
    expect(network).toEqual(source);
  });

  it("preserves reversed traversal and produces valid unique synthetic topology", () => {
    const source = squareNetwork();
    source.vertices[0]!.cornerRadius = 8;
    source.vertices[2]!.cornerRadius = 16;
    const reversed = reverseVectorPath(source);
    if (!reversed.ok) throw new Error(reversed.message);
    const result = projectVectorNetworkCornerRadii(reversed.network);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.paths[0]?.segments).toHaveLength(6);
    expect(validateVectorNetwork(result.network)).toEqual([]);
    const ids = [
      ...result.network.vertices.map((item) => item.id),
      ...result.network.segments.map((item) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(serializeVectorNetwork(result.network)).toMatchObject({ ok: true });
  });

  it("rounds concave corners and lets an explicit zero override the node fallback", () => {
    const concave = squareNetwork();
    concave.vertices[2] = { id: "vertex_c", x: 40, y: 40, cornerRadius: 6 };
    const concaveResult = projectVectorNetworkCornerRadii(concave);
    expect(concaveResult.ok).toBe(true);
    if (concaveResult.ok) {
      expect(concaveResult.network.paths[0]?.segments).toHaveLength(5);
      expect(serializeVectorNetwork(concaveResult.network)).toMatchObject({
        ok: true,
      });
    }

    const fallback = squareNetwork();
    fallback.vertices[0]!.cornerRadius = 0;
    const fallbackResult = projectVectorNetworkCornerRadii(fallback, 10);
    expect(fallbackResult.ok).toBe(true);
    if (!fallbackResult.ok) return;
    expect(fallbackResult.network.paths[0]?.segments).toHaveLength(7);
    expect(fallbackResult.network.vertices).toContainEqual(
      expect.objectContaining({ id: "vertex_a", x: 0, y: 0 }),
    );
  });
});

function squareNetwork(): VectorNetwork {
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
        id: "path_square",
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
        id: "region_square",
        windingRule: "nonzero",
        loops: [{ pathId: "path_square", reversed: false }],
      },
    ],
  };
}
