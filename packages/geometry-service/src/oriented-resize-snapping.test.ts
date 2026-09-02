import { describe, expect, it } from "vitest";
import { createSnapTargetIndex, type SnapTarget } from "./snapping.js";
import { resolveOrientedResizeSnapping } from "./oriented-resize-snapping.js";

describe("resolveOrientedResizeSnapping", () => {
  it("snaps a 90-degree rotated edge along its document-space movement", () => {
    const result = resolve({
      frame: frame([0, 1, -1, 0, 900, 100]),
      horizontal: "end",
      scaleX: 0.96,
      targets: targets([target("y", 200, "guide")]),
    });

    expect(result.scaleX).toBeCloseTo(1);
    expect(result.scaleY).toBe(1);
    expect(result.matches).toEqual([
      expect.objectContaining({ axis: "y", source: "guide" }),
    ]);
    expect(result.lines).toEqual([
      expect.objectContaining({ axis: "y", position: 200 }),
    ]);
  });

  it("uses the full affine basis for a skewed edge", () => {
    const result = resolve({
      frame: frame([1, 0.25, 0.4, 1, 10, 20]),
      horizontal: "end",
      scaleX: 0.96,
      targets: targets([target("x", 120, "object")]),
    });

    expect(result.scaleX).toBeCloseTo(1);
    expect(result.scaleY).toBe(1);
  });

  it("solves both dimensions when a rotated corner reaches an intersection", () => {
    const result = resolve({
      frame: frame([0, 1, -1, 0, 0, 0]),
      horizontal: "end",
      scaleX: 0.96,
      scaleY: 0.96,
      targets: targets([target("x", -50, "guide"), target("y", 100, "guide")]),
      vertical: "end",
    });

    expect(result.scaleX).toBeCloseTo(1);
    expect(result.scaleY).toBeCloseTo(1);
    expect(result.matches).toHaveLength(2);
  });

  it("keeps ratio-locked and center resize corrections coupled", () => {
    const ratio = resolve({
      frame: frame([0, 1, -1, 0, 0, 0]),
      horizontal: "end",
      lockRatio: true,
      scaleX: 0.96,
      scaleY: 0.96,
      targets: targets([target("y", 100, "guide")]),
      vertical: "end",
    });
    const centered = resolve({
      aroundCenter: true,
      frame: frame([1, 0, 0, 1, 0, 0]),
      horizontal: "start",
      scaleX: 0.94,
      targets: targets([target("x", 0, "guide")]),
    });

    expect(ratio.scaleX).toBeCloseTo(1);
    expect(ratio.scaleY).toBeCloseTo(1);
    expect(centered.scaleX).toBeCloseTo(1);
  });

  it("prefers guides and falls back to pixel snapping without a guide line", () => {
    const preferred = resolve({
      frame: frame([1, 0.25, 0.4, 1, 10, 20]),
      horizontal: "end",
      scaleX: 0.96,
      targets: targets([target("x", 119, "guide"), target("x", 120, "object")]),
    });
    const pixel = resolve({
      frame: frame([1, 0, 0, 1, 0.4, 0]),
      horizontal: "end",
      pixelGrid: true,
      scaleX: 0.956,
    });

    expect(preferred.scaleX).toBeCloseTo(0.99);
    expect(preferred.matches[0]?.source).toBe("guide");
    expect(pixel.scaleX).toBeCloseTo(0.956);
    expect(pixel.matches[0]?.source).toBe("pixel-grid");
    expect(pixel.lines).toEqual([]);
  });

  it("fails open for flips, singular transforms, and unreachable targets", () => {
    const flipped = resolve({
      frame: frame([1, 0, 0, 1, 0, 0]),
      horizontal: "end",
      scaleX: -0.5,
      targets: targets([target("x", 100, "guide")]),
    });
    const singular = resolve({
      frame: frame([1, 0, 2, 0, 0, 0]),
      horizontal: "end",
      scaleX: 0.96,
      targets: targets([target("x", 100, "guide")]),
    });
    const far = resolve({
      frame: frame([1, 0, 0, 1, 0, 0]),
      horizontal: "end",
      scaleX: 0.5,
      targets: targets([target("x", 100, "guide")]),
    });

    expect(flipped.scaleX).toBe(-0.5);
    expect(singular.scaleX).toBe(0.96);
    expect(far.scaleX).toBe(0.5);
    expect(far.matches).toEqual([]);
  });
});

function resolve(
  overrides: Partial<Parameters<typeof resolveOrientedResizeSnapping>[0]> = {},
) {
  return resolveOrientedResizeSnapping({
    aroundCenter: false,
    frame: frame([1, 0, 0, 1, 0, 0]),
    horizontal: null,
    lockRatio: false,
    pixelGrid: false,
    scaleX: 1,
    scaleY: 1,
    targets: targets([]),
    threshold: 5,
    vertical: null,
    ...overrides,
  });
}

function frame(transform: [number, number, number, number, number, number]) {
  return { bounds: { x: 0, y: 0, width: 100, height: 50 }, transform };
}

function target(
  axis: "x" | "y",
  position: number,
  source: "guide" | "object",
): SnapTarget {
  return {
    axis,
    id: `${source}:${axis}:${position}`,
    position,
    range: { start: 0, end: 200 },
    source,
  };
}

function targets(values: readonly SnapTarget[]) {
  return createSnapTargetIndex(values);
}
