import { describe, expect, it } from "vitest";
import {
  formatSvgNumber,
  sanitizeSvgXmlId,
  serializeSvgMatrixAttribute,
} from "./svg-serialize.js";

describe("SVG serialization values", () => {
  it("formats finite values deterministically and rejects non-finite output", () => {
    expect(formatSvgNumber(1.23456789)).toBe("1.234568");
    expect(formatSvgNumber(-0)).toBe("0");
    expect(formatSvgNumber(Number.POSITIVE_INFINITY)).toBe("0");
  });

  it("creates safe XML identifiers and matrix attributes", () => {
    expect(sanitizeSvgXmlId("9 hero/card")).toBe("od_9_hero_card");
    expect(sanitizeSvgXmlId("hero.card")).toBe("hero.card");
    expect(serializeSvgMatrixAttribute([1, 0, 0, 1, 12.5, -0])).toBe(
      "matrix(1 0 0 1 12.5 0)",
    );
  });
});
