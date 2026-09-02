import { describe, expect, it } from "vitest";
import {
  createSnapTargetIndex,
  resolveMoveSnapping,
  resolveResizeSnapping,
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

describe("resolveResizeSnapping", () => {
  it("snaps only the edges controlled by an eight-way resize handle", () => {
    const result = resolveResizeSnapping({
      aroundCenter: false,
      horizontal: "end",
      lockRatio: false,
      pixelGrid: false,
      selection: { x: 20, y: 30, width: 97, height: 68 },
      targets: createSnapTargetIndex([
        objectTarget("x", "right", 120, 0, 140),
        objectTarget("y", "bottom", 100, 0, 160),
        objectTarget("y", "uncontrolled-top", 30, 0, 160),
      ]),
      threshold: 5,
      vertical: "end",
    });

    expect(result.bounds).toEqual({ x: 20, y: 30, width: 100, height: 70 });
    expect(result.delta).toEqual({ x: 3, y: 2 });
    expect(result.matches.map(({ targetId }) => targetId)).toEqual([
      "right",
      "bottom",
    ]);
  });

  it("resizes symmetrically around the center", () => {
    const result = resolveResizeSnapping({
      aroundCenter: true,
      horizontal: "start",
      lockRatio: false,
      pixelGrid: false,
      selection: { x: 23, y: 30, width: 94, height: 70 },
      targets: createSnapTargetIndex([guideTarget("x", "left-guide", 20)]),
      threshold: 5,
      vertical: null,
    });

    expect(result.bounds).toEqual({ x: 20, y: 30, width: 100, height: 70 });
    expect(result.delta.x).toBe(-3);
  });

  it("keeps the raw ratio while snapping a corner", () => {
    const result = resolveResizeSnapping({
      aroundCenter: false,
      horizontal: "end",
      lockRatio: true,
      pixelGrid: false,
      selection: { x: 20, y: 30, width: 97, height: 48.5 },
      targets: createSnapTargetIndex([objectTarget("x", "right", 120, 0, 140)]),
      threshold: 5,
      vertical: "end",
    });

    expect(result.bounds.x).toBeCloseTo(20);
    expect(result.bounds.y).toBeCloseTo(30);
    expect(result.bounds.width).toBeCloseTo(100);
    expect(result.bounds.height).toBeCloseTo(50);
    expect(result.matches).toMatchObject([{ targetId: "right" }]);
  });

  it("uses pixel-grid fallback without drawing guides", () => {
    const result = resolveResizeSnapping({
      aroundCenter: false,
      horizontal: "start",
      lockRatio: false,
      pixelGrid: true,
      selection: { x: 20.4, y: 30, width: 80, height: 50 },
      targets: createSnapTargetIndex([]),
      threshold: 1,
      vertical: null,
    });

    expect(result.bounds).toEqual({ x: 20, y: 30, width: 80.4, height: 50 });
    expect(result.matches[0]?.source).toBe("pixel-grid");
    expect(result.lines).toEqual([]);
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
