import { describe, expect, it } from "vitest";
import { fromFigmaGuides, toFigmaGuides } from "./guides.js";

describe("Figma ruler guide interop", () => {
  it("round-trips the public axis and owner-relative offset shape", () => {
    const source: Guide[] = [
      { axis: "X", offset: 120 },
      { axis: "Y", offset: -24.5 },
    ];

    expect(toFigmaGuides(fromFigmaGuides(source))).toEqual(source);
  });
});
