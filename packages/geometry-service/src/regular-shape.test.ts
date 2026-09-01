import { describe, expect, it } from "vitest";
import type { PolygonNode, StarNode } from "@opendesign/design-contracts";
import { resolveRegularShapeGeometry } from "./regular-shape.js";

describe("Figma-compatible regular shape geometry", () => {
  it("rounds every Polygon vertex with one shape-level smoothing value", () => {
    const result = resolveRegularShapeGeometry(
      polygon({ width: 140, height: 90 }, 6, 12, 0.6),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.vertices).toHaveLength(6);
    expect(
      result.network.vertices.every((vertex) => vertex.cornerRadius === 12),
    ).toBe(true);
    expect(result.path.match(/C /g)).toHaveLength(18);
    expect(result.bounds.x).toBeGreaterThanOrEqual(0);
    expect(result.bounds.y).toBeGreaterThanOrEqual(0);
    expect(result.bounds.x + result.bounds.width).toBeLessThanOrEqual(140);
    expect(result.bounds.y + result.bounds.height).toBeLessThanOrEqual(90);
  });

  it("rounds only Star outer tips and preserves sharp inner vertices", () => {
    const result = resolveRegularShapeGeometry(
      star({ width: 120, height: 80 }, 5, 0.42, 9, 0.6),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network.vertices).toHaveLength(10);
    result.network.vertices.forEach((vertex, index) => {
      expect(vertex.cornerRadius).toBe(index % 2 === 0 ? 9 : undefined);
    });
    expect(result.path.match(/C /g)).toHaveLength(5);
    expect(result.path.match(/L /g)).toHaveLength(10);
  });

  it("changes the exact curve for smoothing and clamps oversized radii", () => {
    const circular = resolveRegularShapeGeometry(
      polygon({ width: 48, height: 32 }, 4, 4, 0),
    );
    const smooth = resolveRegularShapeGeometry(
      polygon({ width: 48, height: 32 }, 4, 4, 1),
    );

    expect(circular.ok).toBe(true);
    expect(smooth.ok).toBe(true);
    if (!circular.ok || !smooth.ok) return;
    expect(circular.path).not.toBe(smooth.path);
    expect(circular.bounds.width).toBeLessThanOrEqual(48);
    expect(circular.bounds.height).toBeLessThanOrEqual(32);
    expect(smooth.bounds.width).toBeLessThanOrEqual(48);
    expect(smooth.bounds.height).toBeLessThanOrEqual(32);

    const clamped = resolveRegularShapeGeometry(
      polygon({ width: 48, height: 32 }, 4, 100, 1),
    );
    expect(clamped.ok).toBe(true);
    if (!clamped.ok) return;
    expect(clamped.bounds.width).toBeLessThanOrEqual(48);
    expect(clamped.bounds.height).toBeLessThanOrEqual(32);
  });
});

function polygon(
  size: PolygonNode["size"],
  pointCount: number,
  cornerRadius: number,
  cornerSmoothing: number,
): PolygonNode {
  return {
    ...base("polygon", size),
    kind: "polygon",
    properties: {
      ...shape(),
      pointCount,
      cornerRadius,
      cornerSmoothing,
    },
  };
}

function star(
  size: StarNode["size"],
  pointCount: number,
  innerRadius: number,
  cornerRadius: number,
  cornerSmoothing: number,
): StarNode {
  return {
    ...base("star", size),
    kind: "star",
    properties: {
      ...shape(),
      pointCount,
      innerRadius,
      cornerRadius,
      cornerSmoothing,
    },
  };
}

function base(
  kind: "polygon" | "star",
  size: PolygonNode["size"],
): Omit<PolygonNode, "kind" | "properties"> {
  return {
    id: `${kind}_fixture`,
    name: kind,
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size,
    opacity: 1,
    exportSettings: [],
    extensions: {},
  };
}

function shape() {
  return {
    fills: [{ type: "solid" as const, color: "#111827", opacity: 1 }],
    strokes: [],
    strokeWidth: 0,
  };
}
