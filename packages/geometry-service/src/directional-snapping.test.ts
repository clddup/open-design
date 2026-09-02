import { describe, expect, it } from "vitest";
import {
  createDirectionalSnapTargetIndex,
  directionalTargetFromAxis,
  resolveDirectionalMoveSnapping,
  resolveDirectionalResizeSnapping,
  type DirectionalSnapFrame,
  type DirectionalSnapTarget,
} from "./directional-snapping.js";

const SQRT_HALF = Math.SQRT1_2;
const ROTATED_FRAME: DirectionalSnapFrame = {
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  transform: [SQRT_HALF, SQRT_HALF, -SQRT_HALF, SQRT_HALF, 0, 0],
};

describe("directional move snapping", () => {
  it("snaps a selection anchor to a 45 degree Frame guide", () => {
    const guide = target("diagonal", { x: 0, y: 0 }, { x: 100, y: 100 });
    const result = resolveDirectionalMoveSnapping({
      frame: axisFrame(10, 12, 1, 1),
      primaryTargetIds: new Set([guide.id]),
      targets: createDirectionalSnapTargetIndex([guide]),
      threshold: 2,
    });

    expect(result.delta.x).toBeCloseTo(0.5);
    expect(result.delta.y).toBeCloseTo(-0.5);
    expect(result.matches).toEqual([{ source: "guide", targetId: "diagonal" }]);
    expect(result.lines[0]).toMatchObject({ kind: "segment" });
  });

  it("combines a directional guide with a non-parallel axis target", () => {
    const diagonal = target("diagonal", { x: 0, y: 0 }, { x: 100, y: 100 });
    const horizontal = directionalTargetFromAxis({
      axis: "y",
      id: "page-horizontal",
      position: 12,
      range: { start: 0, end: 100 },
      source: "guide",
    });
    const result = resolveDirectionalMoveSnapping({
      frame: axisFrame(10, 12.5, 1, 1),
      primaryTargetIds: new Set([diagonal.id]),
      targets: createDirectionalSnapTargetIndex([diagonal, horizontal]),
      threshold: 2,
    });

    expect(result.matches).toHaveLength(2);
    expect(result.matches.map(({ targetId }) => targetId).sort()).toEqual([
      "diagonal",
      "page-horizontal",
    ]);
  });

  it("fails open for distant, degenerate, and invalid geometry", () => {
    const targets = createDirectionalSnapTargetIndex([
      target("distant", { x: 100, y: 100 }, { x: 200, y: 200 }),
      target("zero", { x: 0, y: 0 }, { x: 0, y: 0 }),
    ]);
    const result = resolveDirectionalMoveSnapping({
      frame: { ...axisFrame(0, 0, 10, 10), transform: [1, 0, 1, 0, 0, 0] },
      primaryTargetIds: new Set(["distant", "zero"]),
      targets,
      threshold: 2,
    });

    expect(result).toEqual({ delta: { x: 0, y: 0 }, lines: [], matches: [] });
    expect(targets.groups).toHaveLength(1);
  });

  it("indexes many parallel guides as one sorted direction group", () => {
    const guides = Array.from({ length: 2_000 }, (_, index) =>
      target(`guide-${index}`, { x: index, y: 0 }, { x: index + 100, y: 100 }),
    );
    const index = createDirectionalSnapTargetIndex(guides);
    const result = resolveDirectionalMoveSnapping({
      frame: axisFrame(1_000, 0, 1, 1),
      primaryTargetIds: new Set(guides.map(({ id }) => id)),
      targets: index,
      threshold: 1,
    });

    expect(index.groups).toHaveLength(1);
    expect(result.matches.length).toBeLessThanOrEqual(1);
  });
});

describe("directional resize snapping", () => {
  it("snaps a rotated frame side and corner to its local guide direction", () => {
    const guide = rotatedVerticalGuide("frame-guide", 10.4);
    const targets = createDirectionalSnapTargetIndex([guide]);
    const side = resolveDirectionalResizeSnapping({
      aroundCenter: false,
      frame: ROTATED_FRAME,
      horizontal: "end",
      lockRatio: false,
      primaryTargetIds: new Set([guide.id]),
      scaleX: 0.98,
      scaleY: 1,
      targets,
      threshold: 1,
      vertical: null,
    });
    const corner = resolveDirectionalResizeSnapping({
      aroundCenter: false,
      frame: ROTATED_FRAME,
      horizontal: "end",
      lockRatio: false,
      primaryTargetIds: new Set([guide.id]),
      scaleX: 0.98,
      scaleY: 0.98,
      targets,
      threshold: 1,
      vertical: "end",
    });

    expect(side.scaleX).toBeCloseTo(1.04);
    expect(side.scaleY).toBe(1);
    expect(corner.scaleX).toBeCloseTo(1.04);
    expect(corner.matches[0]).toEqual({
      source: "guide",
      targetId: "frame-guide",
    });
  });

  it("keeps ratio lock and center resize coupled", () => {
    const guide = rotatedVerticalGuide("frame-guide", 10.4);
    const shared = {
      frame: ROTATED_FRAME,
      primaryTargetIds: new Set([guide.id]),
      targets: createDirectionalSnapTargetIndex([guide]),
      threshold: 1,
    };
    const ratio = resolveDirectionalResizeSnapping({
      ...shared,
      aroundCenter: false,
      horizontal: "end" as const,
      lockRatio: true,
      scaleX: 0.98,
      scaleY: 0.98,
      vertical: "end" as const,
    });
    const centered = resolveDirectionalResizeSnapping({
      ...shared,
      aroundCenter: true,
      horizontal: "end" as const,
      lockRatio: false,
      scaleX: 0.98,
      scaleY: 1,
      vertical: null,
    });

    expect(ratio.scaleX).toBeCloseTo(1.04);
    expect(ratio.scaleY).toBeCloseTo(1.04);
    expect(centered.scaleX).toBeCloseTo(1.08);
    expect(centered.scaleY).toBe(1);
  });

  it("uses the full transform for a skewed non-uniform Frame", () => {
    const frame: DirectionalSnapFrame = {
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      transform: [2, 0.5, 0.4, 1.5, 10, 20],
    };
    const guide = target(
      "skewed-guide",
      { x: 30.8, y: 25.2 },
      { x: 34.8, y: 40.2 },
    );
    const result = resolveDirectionalResizeSnapping({
      aroundCenter: false,
      frame,
      horizontal: "end",
      lockRatio: false,
      primaryTargetIds: new Set([guide.id]),
      scaleX: 0.98,
      scaleY: 1,
      targets: createDirectionalSnapTargetIndex([guide]),
      threshold: 2,
      vertical: null,
    });

    expect(result.scaleX).toBeCloseTo(1.04);
    expect(result.scaleY).toBe(1);
    expect(result.matches[0]?.targetId).toBe("skewed-guide");
  });
});

function axisFrame(
  x: number,
  y: number,
  width: number,
  height: number,
): DirectionalSnapFrame {
  return {
    bounds: { x, y, width, height },
    transform: [1, 0, 0, 1, 0, 0],
  };
}

function target(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): DirectionalSnapTarget {
  return { end, id, source: "guide", start };
}

function rotatedVerticalGuide(id: string, localX: number) {
  return target(
    id,
    { x: localX * SQRT_HALF, y: localX * SQRT_HALF },
    {
      x: localX * SQRT_HALF - 20 * SQRT_HALF,
      y: localX * SQRT_HALF + 20 * SQRT_HALF,
    },
  );
}
