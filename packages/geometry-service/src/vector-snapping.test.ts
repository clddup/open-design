import { describe, expect, it } from "vitest";
import {
  createVectorSnapPathTarget,
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

  it("snaps to the nearest point on a line as one two-dimensional match", () => {
    const result = resolveVectorPointSnapping({
      movingPoints: [{ id: "moving", x: 0, y: 0 }],
      paths: [
        createVectorSnapPathTarget("line", {
          start: { x: 0, y: 50 },
          startVertexId: "a",
          end: { x: 100, y: 50 },
          endVertexId: "b",
        }),
      ],
      pixelGrid: false,
      rawDelta: { x: 48, y: 47 },
      targets: createVectorSnapTargetIndex([]),
      threshold: 5,
    });

    expect(result.delta).toEqual({ x: 48, y: 50 });
    expect(result.matches).toEqual([
      expect.objectContaining({
        kind: "path",
        movingPointId: "moving",
        targetPathId: "line",
        targetPoint: { x: 48, y: 50 },
      }),
    ]);
    expect(result.lines).toEqual([
      {
        kind: "point",
        position: { x: 48, y: 50 },
        radius: 3,
        source: "geometry",
      },
    ]);
  });

  it("resolves a cubic nearest point instead of sampling a point cloud", () => {
    const result = resolveVectorPointSnapping({
      movingPoints: [{ id: "moving", x: 0, y: 0 }],
      paths: [
        createVectorSnapPathTarget("cubic", {
          start: { x: 0, y: 0 },
          startVertexId: "a",
          tangentStart: { x: 0, y: 100 },
          end: { x: 100, y: 0 },
          endVertexId: "b",
          tangentEnd: { x: 0, y: 100 },
        }),
      ],
      pixelGrid: false,
      rawDelta: { x: 50, y: 79 },
      targets: createVectorSnapTargetIndex([]),
      threshold: 5,
    });

    expect(result.delta.x).toBeCloseTo(50, 5);
    expect(result.delta.y).toBeCloseTo(75, 5);
    expect(result.matches[0]).toMatchObject({
      kind: "path",
      t: 0.5,
      targetPathId: "cubic",
    });
  });

  it("keeps point geometry ahead of paths and paths ahead of pixel grid", () => {
    const path = createVectorSnapPathTarget("line", {
      start: { x: 0, y: 50 },
      startVertexId: "a",
      end: { x: 100, y: 50 },
      endVertexId: "b",
    });
    const point = resolveVectorPointSnapping({
      movingPoints: [{ id: "moving", x: 0, y: 0 }],
      paths: [path],
      pixelGrid: true,
      rawDelta: { x: 48.4, y: 49.2 },
      targets: createVectorSnapTargetIndex([{ id: "point", x: 50, y: 200 }]),
      threshold: 5,
    });
    expect(point.delta).toEqual({ x: 50, y: 49 });
    expect(point.matches.map(({ kind }) => kind)).toEqual(["axis", "axis"]);

    const pathBeforePixel = resolveVectorPointSnapping({
      movingPoints: [{ id: "moving", x: 0, y: 0 }],
      paths: [path],
      pixelGrid: true,
      rawDelta: { x: 48.4, y: 49.2 },
      targets: createVectorSnapTargetIndex([]),
      threshold: 5,
    });
    expect(pathBeforePixel.delta).toEqual({ x: 48.4, y: 50 });
    expect(pathBeforePixel.matches[0]?.kind).toBe("path");
  });

  it("does not snap a moving anchor back to an excluded incident path", () => {
    const result = resolveVectorPointSnapping({
      movingPoints: [
        {
          excludedPathTargetIds: ["incident"],
          id: "moving",
          x: 0,
          y: 0,
        },
      ],
      paths: [
        createVectorSnapPathTarget("incident", {
          start: { x: 0, y: 0 },
          startVertexId: "moving",
          end: { x: 100, y: 100 },
          endVertexId: "b",
        }),
      ],
      pixelGrid: false,
      rawDelta: { x: 50, y: 53 },
      targets: createVectorSnapTargetIndex([]),
      threshold: 5,
    });

    expect(result.delta).toEqual({ x: 50, y: 53 });
    expect(result.matches).toEqual([]);
  });
});
