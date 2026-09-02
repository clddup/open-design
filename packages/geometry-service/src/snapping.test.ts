import { describe, expect, it } from "vitest";
import {
  createSnapTargetIndex,
  resolveMoveSnapping,
  type SnapTarget,
} from "./snapping.js";

const selection = { x: 97, y: 48, width: 20, height: 20 };

describe("resolveMoveSnapping", () => {
  it("aligns outer edges and centers on both axes", () => {
    const targets: SnapTarget[] = [
      objectTarget("x", "right", 120, 10, 90),
      objectTarget("y", "center", 60, 20, 160),
    ];

    const result = resolveMoveSnapping({
      pixelGrid: true,
      selection,
      targets: createSnapTargetIndex(targets),
      threshold: 5,
    });

    expect(result.delta).toEqual({ x: 3, y: 2 });
    expect(result.matches).toMatchObject([
      { selectionAnchor: "end", source: "object", targetId: "right" },
      { selectionAnchor: "center", source: "object", targetId: "center" },
    ]);
    expect(result.lines).toEqual([
      {
        axis: "x",
        position: 120,
        range: { start: 10, end: 90 },
        source: "object",
      },
      {
        axis: "y",
        position: 60,
        range: { start: 20, end: 160 },
        source: "object",
      },
    ]);
  });

  it("gives ruler guides precedence and keeps ties deterministic", () => {
    const targets: SnapTarget[] = [
      objectTarget("x", "z-object", 97, 0, 100),
      guideTarget("x", "z-guide", 100),
      guideTarget("x", "a-guide", 100),
    ];

    const result = resolveMoveSnapping({
      pixelGrid: false,
      selection,
      targets: createSnapTargetIndex(targets),
      threshold: 5,
    });

    expect(result.delta.x).toBe(3);
    expect(result.matches[0]).toMatchObject({
      selectionAnchor: "start",
      source: "guide",
      targetId: "a-guide",
    });
  });

  it("falls back to the pixel grid without drawing a smart guide", () => {
    const result = resolveMoveSnapping({
      pixelGrid: true,
      selection: { x: 10.4, y: 20.6, width: 30, height: 40 },
      targets: createSnapTargetIndex([]),
      threshold: 1,
    });

    expect(result.delta.x).toBeCloseTo(-0.4);
    expect(result.delta.y).toBeCloseTo(0.4);
    expect(result.matches.map(({ source }) => source)).toEqual([
      "pixel-grid",
      "pixel-grid",
    ]);
    expect(result.lines).toEqual([]);
  });

  it("does not snap outside the screen-derived threshold", () => {
    const result = resolveMoveSnapping({
      pixelGrid: false,
      selection,
      targets: createSnapTargetIndex([objectTarget("x", "far", 123, 0, 100)]),
      threshold: 5,
    });

    expect(result.delta).toEqual({ x: 0, y: 0 });
    expect(result.matches).toEqual([]);
  });
});

function objectTarget(
  axis: "x" | "y",
  id: string,
  position: number,
  start: number,
  end: number,
): SnapTarget {
  return { axis, id, position, range: { start, end }, source: "object" };
}

function guideTarget(
  axis: "x" | "y",
  id: string,
  position: number,
): SnapTarget {
  return {
    axis,
    id,
    position,
    range: { start: -1_000, end: 1_000 },
    source: "guide",
  };
}
