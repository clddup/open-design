import { describe, expect, it } from "vitest";
import {
  createSvgExportDocument,
  formatSvgNumber,
  sanitizeSvgXmlId,
  serializeSvgExportDocument,
  serializeSvgMatrixAttribute,
  SVG_NAMESPACE,
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

  it("owns root metadata, defs placement, title and XML serialization", () => {
    const value = createSvgExportDocument({
      title: "  Brand mark  ",
      version: 1,
      viewport: { x: -10, y: 20, width: 320, height: 180 },
    });
    const gradient = value.document.createElementNS(
      SVG_NAMESPACE,
      "linearGradient",
    );
    gradient.setAttribute("id", "brand_gradient");
    value.definitions.appendChild(gradient);
    value.root.appendChild(
      value.document.createElementNS(SVG_NAMESPACE, "rect"),
    );

    const result = serializeSvgExportDocument(value);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toContain('viewBox="-10 20 320 180"');
    expect(result.svg).toContain('data-opendesign-svg-version="1"');
    expect(result.svg).toContain("<title>Brand mark</title>");
    expect(result.svg.indexOf("<defs>")).toBeLessThan(
      result.svg.indexOf("<title>"),
    );
  });
});
