import { describe, expect, it } from "vitest";
import { fromFigmaImageFilters, toFigmaImageFilters } from "./index.js";

describe("Figma image adjustment compatibility", () => {
  it("round-trips the public seven-field ImageFilters shape", () => {
    const filters = {
      exposure: 0.2,
      contrast: -0.1,
      saturation: 0.3,
      temperature: -0.4,
      tint: 0.15,
      highlights: -0.25,
      shadows: 0.5,
    };
    const figma = toFigmaImageFilters(filters);
    expect(figma).toEqual(filters);
    expect(fromFigmaImageFilters(figma)).toEqual({ ok: true, filters });
    expect(fromFigmaImageFilters({ exposure: 1.5 })).toMatchObject({
      ok: false,
    });
  });
});
