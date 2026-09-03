import { describe, expect, it } from "vitest";
import {
  deleteVariableWidthPoints,
  insertVariableWidthPoint,
  updateVariableWidthPoints,
} from "./vector-variable-width-edit.js";

describe("variable width point editing", () => {
  it("converts a preset and inserts an interpolated point", () => {
    expect(insertVariableWidthPoint({ widthProfile: "EYE" }, 0.25)).toEqual({
      index: 1,
      profile: {
        widthProfile: "CUSTOM",
        variableWidthPoints: [
          { position: 0, width: 0 },
          { position: 0.25, width: 0.5 },
          { position: 0.5, width: 1 },
          { position: 1, width: 0 },
        ],
      },
    });
  });

  it("moves selected points without crossing their neighbors", () => {
    const profile = {
      widthProfile: "CUSTOM" as const,
      variableWidthPoints: [
        { position: 0, width: 0 },
        { position: 0.25, width: 0.5 },
        { position: 0.5, width: 1 },
        { position: 1, width: 0 },
      ],
    };
    const moved = updateVariableWidthPoints(profile, [1, 2], 1, {
      position: 0.8,
      width: 1,
    });
    expect(moved?.variableWidthPoints[1]!.position).toBeCloseTo(0.74999);
    expect(moved?.variableWidthPoints[2]!.position).toBeCloseTo(0.99999);
    expect(moved?.variableWidthPoints[1]!.width).toBe(1);
    expect(moved?.variableWidthPoints[2]!.width).toBe(1.5);
  });

  it("deletes selected points but preserves the two-point minimum", () => {
    const profile = {
      widthProfile: "CUSTOM" as const,
      variableWidthPoints: [
        { position: 0, width: 0 },
        { position: 0.5, width: 1 },
        { position: 1, width: 0 },
      ],
    };
    expect(deleteVariableWidthPoints(profile, [1])).toMatchObject({
      variableWidthPoints: [
        { position: 0, width: 0 },
        { position: 1, width: 0 },
      ],
    });
    expect(deleteVariableWidthPoints(profile, [0, 1])).toBeNull();
  });
});
