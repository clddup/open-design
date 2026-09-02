import { describe, expect, it } from "vitest";
import {
  createVectorSnapTargetIndex,
  resolveVectorPointSnapping,
} from "./vector-snapping.js";

describe("resolveVectorPointSnapping", () => {
  it("aligns a moved anchor to another vector anchor on both axes", () => {
    const result = resolveVectorPointSnapping({
      movingPoints: [{ id: "moving", x: 10, y: 20 }],
      pixelGrid: false,
      rawDelta: { x: 27, y: 18 },
      targets: createVectorSnapTargetIndex([{ id: "target", x: 40, y: 40 }]),
      threshold: 5,
    });

    expect(result.delta).toEqual({ x: 30, y: 20 });
    expect(result.matches).toEqual([
      expect.objectContaining({
        axis: "x",
        movingPointId: "moving",
        source: "geometry",
        targetPointId: "target",
      }),
      expect.objectContaining({
        axis: "y",
        movingPointId: "moving",
        source: "geometry",
        targetPointId: "target",
      }),
    ]);
    expect(result.lines).toEqual([
      {
        axis: "x",
        position: 40,
        range: { start: 35, end: 45 },
        source: "geometry",
      },
      {
        axis: "y",
        position: 40,
        range: { start: 35, end: 45 },
        source: "geometry",
      },
    ]);
  });

  it("chooses a deterministic nearest pair across a multi-point selection", () => {
    const result = resolveVectorPointSnapping({
      movingPoints: [
        { id: "moving-b", x: 50, y: 0 },
        { id: "moving-a", x: 10, y: 0 },
      ],
      pixelGrid: false,
      rawDelta: { x: 3, y: 20 },
      targets: createVectorSnapTargetIndex([
        { id: "target-b", x: 53, y: 100 },
        { id: "target-a", x: 13, y: 90 },
      ]),
      threshold: 5,
    });

    expect(result.matches[0]).toMatchObject({
      movingPointId: "moving-a",
      targetPointId: "target-a",
    });
  });

  it("falls back to the pixel grid without drawing a guide", () => {
    const result = resolveVectorPointSnapping({
      movingPoints: [{ id: "moving", x: 10.3, y: 20.7 }],
      pixelGrid: true,
      rawDelta: { x: 2, y: 3 },
      targets: createVectorSnapTargetIndex([]),
      threshold: 1,
    });

    expect(result.delta.x).toBeCloseTo(1.7);
    expect(result.delta.y).toBeCloseTo(3.3);
    expect(result.matches.map(({ source }) => source)).toEqual([
      "pixel-grid",
      "pixel-grid",
    ]);
    expect(result.lines).toEqual([]);
  });

  it("keeps the raw translation when no target is within threshold", () => {
    const result = resolveVectorPointSnapping({
      movingPoints: [{ id: "moving", x: 0, y: 0 }],
      pixelGrid: false,
      rawDelta: { x: 10, y: 10 },
      targets: createVectorSnapTargetIndex([{ id: "far", x: 30, y: 30 }]),
      threshold: 5,
    });

    expect(result.delta).toEqual({ x: 10, y: 10 });
    expect(result.matches).toEqual([]);
  });
});
