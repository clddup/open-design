import type { VectorNetwork } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  projectVariableWidthStrokePaths,
  variableWidthHitPosition,
  variableWidthPathLocation,
  variableWidthProfilePoints,
} from "./vector-variable-width.js";

describe("variable width stroke projection", () => {
  it("projects a wedge as a filled editable-path outline", () => {
    const result = projectVariableWidthStrokePaths(
      lineNetwork(),
      { widthProfile: "WEDGE" },
      options(),
    );
    expect(result).toEqual({
      ok: true,
      paths: ["M 0 10 L 100 0 L 100 0 L 0 -10 Z"],
    });
  });

  it("places custom width points by path arc length", () => {
    const result = projectVariableWidthStrokePaths(
      lineNetwork(),
      {
        widthProfile: "CUSTOM",
        variableWidthPoints: [
          { position: 0, width: 0 },
          { position: 0.25, width: 1 },
          { position: 1, width: 0.5 },
        ],
      },
      { ...options(), strokeWidth: 8 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paths[0]).toContain("L 25 4");
    expect(result.paths[0]).toContain("L 25 -4");
  });

  it("adaptively follows cubic curvature without non-finite geometry", () => {
    const network = lineNetwork();
    network.segments[0]!.tangentStart = { x: 0, y: 100 };
    network.segments[0]!.tangentEnd = { x: 0, y: 100 };
    const result = projectVariableWidthStrokePaths(
      network,
      { widthProfile: "EYE" },
      { ...options(), cap: "round", join: "round" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const numbers =
      result.paths[0]!.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(numbers.length).toBeGreaterThan(40);
    expect(numbers.every(Number.isFinite)).toBe(true);
  });

  it("honors inside alignment on a clockwise closed path", () => {
    const result = projectVariableWidthStrokePaths(
      rectangleNetwork(),
      { widthProfile: "MIRRORED_TAPER" },
      { ...options(), align: "inside" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paths[0]).toContain("M 0 0");
    expect(result.paths[0]).toContain("L 100 12.5");
  });

  it("rejects dashed and branching sources before projecting", () => {
    expect(
      projectVariableWidthStrokePaths(
        lineNetwork(),
        { widthProfile: "TAPER" },
        { ...options(), dashPattern: [4, 2] },
      ),
    ).toEqual({
      ok: false,
      message: "Variable width strokes do not support dash patterns",
    });
    const network = lineNetwork();
    network.vertices.push({ id: "c", x: 50, y: 50 });
    network.vertices.push({ id: "d", x: 50, y: -50 });
    network.segments.push({
      id: "bc",
      startVertexId: "b",
      endVertexId: "c",
    });
    network.paths.push({
      id: "branch",
      closed: false,
      segments: [{ segmentId: "bc", reversed: false }],
    });
    network.segments.push({
      id: "bd",
      startVertexId: "b",
      endVertexId: "d",
    });
    network.paths.push({
      id: "branch_two",
      closed: false,
      segments: [{ segmentId: "bd", reversed: false }],
    });
    expect(
      projectVariableWidthStrokePaths(
        network,
        { widthProfile: "TAPER" },
        options(),
      ),
    ).toEqual({
      ok: false,
      message:
        "Variable width strokes do not support branching Vector Networks",
    });
  });

  it("resolves preset controls and bidirectional arc-length locations", () => {
    expect(variableWidthProfilePoints({ widthProfile: "EYE" })).toEqual([
      { position: 0, width: 0 },
      { position: 0.5, width: 1 },
      { position: 1, width: 0 },
    ]);
    const network = lineNetwork();
    const midpoint = variableWidthPathLocation(network, "line", 0.5);
    expect(midpoint?.pathId).toBe("line");
    expect(midpoint?.point.x).toBeCloseTo(50);
    expect(midpoint?.point.y).toBeCloseTo(0);
    expect(midpoint?.position).toBe(0.5);
    expect(midpoint?.tangent).toEqual({ x: 1, y: 0 });
    const quarter = variableWidthHitPosition(network, "line", "ab", 0.25);
    expect(quarter?.point.x).toBeCloseTo(25);
    expect(quarter?.point.y).toBeCloseTo(0);
    expect(quarter?.position).toBeCloseTo(0.25);
  });
});

function options() {
  return {
    align: "center" as const,
    cap: "butt" as const,
    join: "miter" as const,
    strokeWidth: 20,
  };
}

function lineNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
    ],
    segments: [{ id: "ab", startVertexId: "a", endVertexId: "b" }],
    paths: [
      {
        id: "line",
        closed: false,
        segments: [{ segmentId: "ab", reversed: false }],
      },
    ],
    regions: [],
  };
}

function rectangleNetwork(): VectorNetwork {
  return {
    vertices: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
      { id: "c", x: 100, y: 100 },
      { id: "d", x: 0, y: 100 },
    ],
    segments: [
      { id: "ab", startVertexId: "a", endVertexId: "b" },
      { id: "bc", startVertexId: "b", endVertexId: "c" },
      { id: "cd", startVertexId: "c", endVertexId: "d" },
      { id: "da", startVertexId: "d", endVertexId: "a" },
    ],
    paths: [
      {
        id: "rectangle",
        closed: true,
        segments: ["ab", "bc", "cd", "da"].map((segmentId) => ({
          segmentId,
          reversed: false,
        })),
      },
    ],
    regions: [],
  };
}
