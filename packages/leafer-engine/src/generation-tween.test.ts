import { describe, expect, it } from "vitest";
import {
  createGenerationTweenPlan,
  generationTweenCadence,
  generationTweenFrame,
  interpolatePathData,
  interpolateTransform,
} from "./generation-tween.js";

describe("Agent generation property tween", () => {
  it("interpolates transform, geometry, paint, effects, and text metrics", () => {
    const plan = createGenerationTweenPlan(
      "hero",
      {
        data: {
          fill: [{ type: "solid", color: "#000000", opacity: 0.5 }],
          fontSize: 20,
          height: 100,
          shadow: [{ x: 0, y: 4, blur: 8, spread: 0, color: "#00000080" }],
          width: 120,
        },
        transform: [1, 0, 0, 1, 10, 20],
      },
      {
        data: {
          fill: [{ type: "solid", color: "#ffffff", opacity: 1 }],
          fontSize: 32,
          height: 160,
          shadow: [{ x: 8, y: 12, blur: 24, spread: 2, color: "#6574ffff" }],
          width: 240,
        },
        transform: [1, 0, 0, 1, 110, 220],
      },
      1_000,
      300,
    );
    expect(plan).toBeDefined();
    const frame = generationTweenFrame(plan!, 1_150);
    expect(frame.done).toBe(false);
    expect(frame.data.width).toBe(180);
    expect(frame.data.height).toBe(130);
    expect(frame.data.fontSize).toBe(26);
    expect(frame.transform[4]).toBe(60);
    expect(frame.transform[5]).toBe(120);
    expect(JSON.stringify(frame.data.fill)).toContain("rgba(128, 128, 128");
    expect(JSON.stringify(frame.data.shadow)).not.toContain("NaN");
  });

  it("uses the shortest rotation path and falls back safely for degenerate matrices", () => {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const matrix = (
      degrees: number,
    ): [number, number, number, number, number, number] => [
      Math.cos(radians(degrees)),
      Math.sin(radians(degrees)),
      -Math.sin(radians(degrees)),
      Math.cos(radians(degrees)),
      0,
      0,
    ];
    const halfway = interpolateTransform(matrix(170), matrix(-170), 0.5);
    expect(halfway[0]).toBeCloseTo(-1, 5);
    expect(halfway[1]).toBeCloseTo(0, 5);
    expect(
      interpolateTransform([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 20, 40], 0.5),
    ).toEqual([0, 0, 0, 0, 10, 20]);
    const affine: [number, number, number, number, number, number] = [
      0.8, 0.6, -0.2, 1.1, 24, 36,
    ];
    interpolateTransform([1, 0, 0, 1, 0, 0], affine, 1).forEach(
      (value, index) => expect(value).toBeCloseTo(affine[index]!, 5),
    );
  });

  it("morphs compatible path topology and dissolves incompatible values", () => {
    expect(
      interpolatePathData(
        "M0 0 C10 0 20 10 30 10",
        "M0 0 C20 0 40 20 60 20",
        0.5,
      ),
    ).toBe("M0 0 C15 0 30 15 45 15");
    expect(
      interpolatePathData("M0 0 L10 10", "M0 0 C4 4 8 8 10 10", 0.5),
    ).toBeUndefined();

    const plan = createGenerationTweenPlan(
      "label",
      {
        data: {
          opacity: 1,
          text: "Before",
          textOverflow: "hide",
          textWrap: "normal",
        },
        transform: [1, 0, 0, 1, 0, 0],
      },
      {
        data: {
          opacity: 1,
          text: "After",
          textOverflow: "ellipsis",
          textWrap: "none",
        },
        transform: [1, 0, 0, 1, 0, 0],
      },
      0,
      200,
    );
    const middle = generationTweenFrame(plan!, 100);
    expect(middle.data.text).toBe("After");
    expect(middle.data.textOverflow).toBe("ellipsis");
    expect(middle.data.textWrap).toBe("none");
    expect(middle.data.opacity).toBeCloseTo(0.45);
    expect(JSON.stringify(middle)).not.toContain("NaN");
  });

  it("bounds cadence under dense or slow-frame batches", () => {
    expect(
      generationTweenCadence({
        averageFrameMs: 16.67,
        nodeCount: 3,
        visibleNodeCount: 3,
      }),
    ).toEqual({
      durationMs: 300,
      maximumAnimatedNodeCount: 48,
      staggerMs: 24,
    });
    expect(
      generationTweenCadence({
        averageFrameMs: 32,
        nodeCount: 1_000,
        visibleNodeCount: 900,
      }),
    ).toEqual({
      durationMs: 140,
      maximumAnimatedNodeCount: 12,
      staggerMs: 0,
    });
    expect(
      generationTweenCadence({
        averageFrameMs: 16,
        nodeCount: 12,
        visibleNodeCount: 0,
      }).durationMs,
    ).toBe(0);
  });
});
