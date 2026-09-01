import { describe, expect, it } from "vitest";
import { projectDashedStrokeFragments } from "./vector-dash-projection.js";

describe("vector dash projection", () => {
  it("carries one dash cursor across authored segment boundaries", () => {
    const result = projectDashedStrokeFragments(
      [
        {
          start: { id: "a", x: 0, y: 0 },
          end: { id: "b", x: 50, y: 0 },
        },
        {
          start: { id: "b", x: 50, y: 0 },
          end: { id: "c", x: 100, y: 0 },
        },
      ],
      [60, 10],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.fragments.map(({ startBoundary, endBoundary }) => ({
        startBoundary,
        endBoundary,
      })),
    ).toEqual([
      { startBoundary: "path", endBoundary: "segment" },
      { startBoundary: "segment", endBoundary: "dash" },
      { startBoundary: "dash", endBoundary: "path" },
    ]);
    expect(result.fragments[0]?.start.x).toBeCloseTo(0);
    expect(result.fragments[0]?.end.x).toBeCloseTo(50);
    expect(result.fragments[1]?.end.x).toBeCloseTo(60);
    expect(result.fragments[2]?.start.x).toBeCloseTo(70);
    expect(result.fragments[2]?.end.x).toBeCloseTo(100);
  });

  it("splits cubic dashes by arc length without flattening their controls", () => {
    const result = projectDashedStrokeFragments(
      [
        {
          start: { id: "a", x: 0, y: 0 },
          controlStart: { x: 0, y: 100 },
          controlEnd: { x: 100, y: 100 },
          end: { id: "b", x: 100, y: 0 },
        },
      ],
      [50, 10, 20],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragments.length).toBeGreaterThan(2);
    expect(result.fragments[0]).toMatchObject({
      start: { x: 0, y: 0 },
      startBoundary: "path",
      endBoundary: "dash",
    });
    expect(result.fragments[0]?.controlStart).toBeDefined();
    expect(
      result.fragments.every((fragment) =>
        [
          fragment.start.x,
          fragment.start.y,
          fragment.end.x,
          fragment.end.y,
          fragment.controlStart?.x ?? 0,
          fragment.controlEnd?.y ?? 0,
        ].every(Number.isFinite),
      ),
    ).toBe(true);
  });
});
