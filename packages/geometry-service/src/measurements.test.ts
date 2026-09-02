import { describe, expect, it } from "vitest";
import {
  formatDistanceMeasurement,
  measureGuideToRect,
  measureRectDistances,
  measureVectorAnchorDistances,
} from "./measurements.js";

describe("measureRectDistances", () => {
  it("measures both axes for diagonally separated objects", () => {
    expect(
      measureRectDistances(
        { x: 10, y: 20, width: 40, height: 30 },
        { x: 90, y: 80, width: 20, height: 20 },
      ),
    ).toEqual([
      {
        axis: "x",
        end: { x: 90, y: 65 },
        id: "x-after",
        start: { x: 50, y: 65 },
        value: 40,
      },
      {
        axis: "y",
        end: { x: 70, y: 80 },
        id: "y-after",
        start: { x: 70, y: 50 },
        value: 30,
      },
    ]);
  });

  it("measures only the separated axis when bounds overlap", () => {
    expect(
      measureRectDistances(
        { x: 100, y: 40, width: 30, height: 40 },
        { x: 20, y: 50, width: 40, height: 20 },
      ),
    ).toEqual([
      {
        axis: "x",
        end: { x: 60, y: 60 },
        id: "x-before",
        start: { x: 100, y: 60 },
        value: 40,
      },
    ]);
  });

  it("shows all non-zero inset distances for contained bounds", () => {
    expect(
      measureRectDistances(
        { x: 96, y: 242, width: 506, height: 624 },
        { x: 0, y: 0, width: 1440, height: 1000 },
      ).map(({ id, value }) => ({ id, value })),
    ).toEqual([
      { id: "x-before", value: 96 },
      { id: "x-after", value: 838 },
      { id: "y-before", value: 242 },
      { id: "y-after", value: 134 },
    ]);
  });

  it("uses the same containment semantics when the hover target is inside", () => {
    expect(
      measureRectDistances(
        { x: 0, y: 0, width: 200, height: 160 },
        { x: 20, y: 30, width: 80, height: 40 },
      ).map(({ id, value }) => ({ id, value })),
    ).toEqual([
      { id: "x-before", value: 20 },
      { id: "x-after", value: 100 },
      { id: "y-before", value: 30 },
      { id: "y-after", value: 90 },
    ]);
  });

  it("omits touching, overlapping, identical, zero, and non-finite bounds", () => {
    const selection = { x: 0, y: 0, width: 20, height: 20 };
    expect(
      measureRectDistances(selection, { x: 20, y: 0, width: 20, height: 20 }),
    ).toEqual([]);
    expect(
      measureRectDistances(selection, { x: 10, y: 10, width: 20, height: 20 }),
    ).toEqual([]);
    expect(measureRectDistances(selection, selection)).toEqual([]);
    expect(
      measureRectDistances(selection, { x: 30, y: 0, width: 0, height: 20 }),
    ).toEqual([]);
    expect(
      measureRectDistances(selection, {
        x: Number.NaN,
        y: 0,
        width: 20,
        height: 20,
      }),
    ).toEqual([]);
  });
});

describe("measureGuideToRect", () => {
  it("measures one nearest edge outside and both insets inside a bound", () => {
    const target = { x: 40, y: 20, width: 100, height: 60 };

    expect(
      measureGuideToRect({
        axis: "x",
        id: "frame",
        position: 10,
        target,
      }),
    ).toEqual([
      {
        axis: "x",
        end: { x: 40, y: 50 },
        id: "x-after:frame",
        start: { x: 10, y: 50 },
        value: 30,
      },
    ]);
    expect(
      measureGuideToRect({
        axis: "y",
        crossPosition: 70,
        id: "frame",
        position: 50,
        target,
      }).map(({ id, value }) => ({ id, value })),
    ).toEqual([
      { id: "y-before:frame", value: 30 },
      { id: "y-after:frame", value: 30 },
    ]);
  });

  it("omits zero-length and invalid guide measurements", () => {
    const target = { x: 40, y: 20, width: 100, height: 60 };
    expect(
      measureGuideToRect({
        axis: "x",
        id: "frame",
        position: 40,
        target,
      }),
    ).toEqual([]);
    expect(
      measureGuideToRect({
        axis: "x",
        id: "frame",
        position: Number.NaN,
        target,
      }),
    ).toEqual([]);
  });
});

describe("measureVectorAnchorDistances", () => {
  it("returns document-space horizontal and vertical anchor deltas", () => {
    expect(
      measureVectorAnchorDistances({
        source: { x: 100, y: 100 },
        sourceId: "first:vertex_a",
        target: { x: 70, y: 160 },
        targetId: "second:vertex_b",
      }),
    ).toEqual([
      {
        axis: "x",
        end: { x: 70, y: 100 },
        id: "vector-x:first:vertex_a:second:vertex_b",
        start: { x: 100, y: 100 },
        value: 30,
      },
      {
        axis: "y",
        end: { x: 70, y: 160 },
        id: "vector-y:first:vertex_a:second:vertex_b",
        start: { x: 70, y: 100 },
        value: 60,
      },
    ]);
  });

  it("omits zero axes and invalid points", () => {
    expect(
      measureVectorAnchorDistances({
        source: { x: 10, y: 20 },
        sourceId: "source",
        target: { x: 10, y: 50 },
        targetId: "target",
      }).map(({ axis, value }) => ({ axis, value })),
    ).toEqual([{ axis: "y", value: 30 }]);
    expect(
      measureVectorAnchorDistances({
        source: { x: Number.NaN, y: 20 },
        sourceId: "source",
        target: { x: 10, y: 50 },
        targetId: "target",
      }),
    ).toEqual([]);
  });
});

describe("formatDistanceMeasurement", () => {
  it("keeps integers compact and trims fractional zeros", () => {
    expect(formatDistanceMeasurement(96)).toBe("96");
    expect(formatDistanceMeasurement(12.5)).toBe("12.5");
    expect(formatDistanceMeasurement(1.236)).toBe("1.24");
  });
});
