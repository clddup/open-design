import { describe, expect, it } from "vitest";
import { constrainPointToOctant } from "./angle-constraint.js";

describe("constrainPointToOctant", () => {
  it("preserves distance while choosing the nearest 45-degree direction", () => {
    const horizontal = constrainPointToOctant(
      { x: 20, y: 30 },
      { x: 100, y: 50 },
    );
    expect(horizontal.x).toBeCloseTo(102.4621, 4);
    expect(horizontal.y).toBeCloseTo(30, 6);

    const diagonal = constrainPointToOctant(
      { x: 20, y: 30 },
      { x: 80, y: 100 },
    );
    expect(diagonal.x - 20).toBeCloseTo(diagonal.y - 30, 6);
  });

  it("keeps a coincident point stable", () => {
    expect(constrainPointToOctant({ x: 4, y: 8 }, { x: 4, y: 8 })).toEqual({
      x: 4,
      y: 8,
    });
  });
});
