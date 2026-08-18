import { describe, expect, it } from "vitest";
import {
  solveGridAutoLayout,
  type GridAutoLayoutRequest,
} from "./grid-layout.js";

function request(): GridAutoLayoutRequest {
  return {
    version: 1,
    frame: { width: 600, height: 300 },
    frameSizing: { horizontal: "fixed", vertical: "fixed" },
    padding: { top: 20, right: 20, bottom: 20, left: 20 },
    rowGap: 10,
    columnGap: 20,
    rows: [
      { type: "fixed", value: 100 },
      { type: "fill", value: 1 },
    ],
    columns: [
      { type: "fixed", value: 120 },
      { type: "fill", value: 1 },
      { type: "fill", value: 2 },
    ],
    itemsPositioning: "manual",
    children: [
      {
        id: "hero",
        width: 100,
        height: 80,
        sizing: { horizontal: "fill", vertical: "fill" },
        placement: {
          row: 0,
          column: 1,
          rowSpan: 1,
          columnSpan: 2,
          horizontalAlign: "auto",
          verticalAlign: "auto",
        },
      },
    ],
  };
}

describe("solveGridAutoLayout", () => {
  it("resolves fixed/fr tracks, gaps, span and fill geometry", () => {
    const result = solveGridAutoLayout(request());
    expect(result).toMatchObject({
      ok: true,
      frame: { width: 600, height: 300 },
      rowSizes: [100, 150],
      columnSizes: [120, 133.33333333333331, 266.66666666666663],
      placements: [
        expect.objectContaining({ id: "hero", x: 160, y: 20, height: 100 }),
      ],
    });
    expect(result.ok && result.placements[0]?.width).toBeCloseTo(420);
  });

  it("sizes Hug tracks from content and aligns fixed children", () => {
    const source = request();
    source.frameSizing = { horizontal: "hug", vertical: "hug" };
    source.columns = [{ type: "hug" }, { type: "fixed", value: 40 }];
    source.rows = [{ type: "hug" }];
    source.children = [
      {
        id: "label",
        width: 80,
        height: 30,
        sizing: { horizontal: "fixed", vertical: "fixed" },
        placement: {
          row: 0,
          column: 0,
          rowSpan: 1,
          columnSpan: 1,
          horizontalAlign: "center",
          verticalAlign: "end",
        },
      },
    ];
    expect(solveGridAutoLayout(source)).toMatchObject({
      ok: true,
      frame: { width: 180, height: 70 },
      rowSizes: [30],
      columnSizes: [80, 40],
      placements: [{ id: "label", x: 20, y: 20, width: 80, height: 30 }],
    });
  });

  it("places ordered children row-major and rejects capacity overflow", () => {
    const source = request();
    source.itemsPositioning = "row-auto-flow";
    source.rows = [{ type: "fill", value: 1 }];
    source.columns = [
      { type: "fill", value: 1 },
      { type: "fill", value: 1 },
    ];
    source.children = ["one", "two"].map((id) => ({
      id,
      width: 20,
      height: 20,
      sizing: { horizontal: "fixed" as const, vertical: "fixed" as const },
    }));
    const result = solveGridAutoLayout(source);
    expect(
      result.ok && result.placements.map((item) => item.placement),
    ).toEqual([
      expect.objectContaining({ row: 0, column: 0 }),
      expect.objectContaining({ row: 0, column: 1 }),
    ]);
    source.children.push({
      id: "three",
      width: 20,
      height: 20,
      sizing: { horizontal: "fixed", vertical: "fixed" },
    });
    expect(solveGridAutoLayout(source)).toMatchObject({
      ok: false,
      code: "placement-conflict",
    });
  });

  it("rejects overlapping manual cells and Fill tracks on a Hug axis", () => {
    const overlap = request();
    overlap.children.push({
      ...structuredClone(overlap.children[0]!),
      id: "copy",
    });
    expect(solveGridAutoLayout(overlap)).toMatchObject({
      ok: false,
      code: "placement-conflict",
    });
    const conflict = request();
    conflict.frameSizing.horizontal = "hug";
    expect(solveGridAutoLayout(conflict)).toMatchObject({
      ok: false,
      code: "sizing-conflict",
    });
  });
});
