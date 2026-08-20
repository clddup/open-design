import { describe, expect, it } from "vitest";
import {
  pointInPolygon,
  vectorLassoPath,
  vectorSelectionResizeTransform,
  vectorSelectionRotationTransform,
} from "./vector-selection-transform.js";

describe("vector selection transforms", () => {
  it("selects points inside or on a freeform lasso boundary", () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 80, y: 80 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon({ x: 40, y: 40 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 50 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 95, y: 70 }, polygon)).toBe(false);
    expect(vectorLassoPath(polygon)).toBe("M 0 0 L 100 0 L 80 80 L 0 100 Z");
  });

  it("builds opposite-edge and center-based resize matrices", () => {
    const bounds = { x: 10, y: 20, width: 100, height: 50 };
    expect(
      vectorSelectionResizeTransform(
        bounds,
        "south-east",
        { x: 210, y: 120 },
        { fromCenter: false, proportional: false },
      ),
    ).toEqual([2, 0, 0, 2, -10, -20]);
    expect(
      vectorSelectionResizeTransform(
        bounds,
        "east",
        { x: 160, y: 45 },
        { fromCenter: true, proportional: false },
      ),
    ).toEqual([2, 0, 0, 1, -60, 0]);
  });

  it("preserves aspect ratio and snaps rotation to fifteen degrees", () => {
    const bounds = { x: 0, y: 0, width: 100, height: 50 };
    expect(
      vectorSelectionResizeTransform(
        bounds,
        "south-east",
        { x: 180, y: 70 },
        { fromCenter: false, proportional: true },
      ),
    ).toEqual([1.8, 0, 0, 1.8, 0, 0]);
    expect(
      vectorSelectionResizeTransform(
        bounds,
        "east",
        { x: 200, y: 25 },
        { fromCenter: false, proportional: true },
      ),
    ).toEqual([2, 0, 0, 2, 0, -25]);
    const rotation = vectorSelectionRotationTransform(
      bounds,
      { x: 100, y: 25 },
      { x: 93, y: 50 },
      true,
    );
    expect(rotation[0]).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(rotation[1]).toBeCloseTo(Math.sin(Math.PI / 6));
  });
});
