import { describe, expect, it } from "vitest";
import { localReflectionTransform, reflectionTransform } from "./reflection.js";

describe("reflection transforms", () => {
  it("reflects document bounds around their requested center axis", () => {
    expect(
      reflectionTransform("horizontal", {
        x: 20,
        y: 30,
        width: 80,
        height: 40,
      }),
    ).toEqual([-1, 0, 0, 1, 120, 0]);
    expect(
      reflectionTransform("vertical", {
        x: 20,
        y: 30,
        width: 80,
        height: 40,
      }),
    ).toEqual([1, 0, 0, -1, 0, 100]);
  });

  it("reflects local geometry around its own center", () => {
    expect(
      localReflectionTransform("horizontal", { width: 80, height: 40 }),
    ).toEqual([-1, 0, 0, 1, 80, 0]);
    expect(
      localReflectionTransform("vertical", { width: 80, height: 40 }),
    ).toEqual([1, 0, 0, -1, 0, 40]);
  });
});
