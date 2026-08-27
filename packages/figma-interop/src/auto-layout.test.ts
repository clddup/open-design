import { describe, expect, it } from "vitest";
import type { DesignNode } from "@opendesign/design-contracts";
import {
  fromFigmaGridAutoLayout,
  fromFigmaWrapAutoLayout,
  fromFigmaWrapChildLayout,
  toFigmaGridAutoLayout,
  toFigmaGridChild,
  toFigmaWrapAutoLayout,
  toFigmaWrapChildLayout,
} from "./index.js";

describe("Figma wrapped Auto Layout compatibility", () => {
  it("round-trips public counterAxisAlignContent and counterAxisSpacing", () => {
    const figma = toFigmaWrapAutoLayout({
      mode: "horizontal",
      padding: { top: 8, right: 16, bottom: 12, left: 16 },
      gap: 10,
      primaryAlignment: "space-between",
      counterAlignment: "center",
      sizing: { horizontal: "fixed", vertical: "fixed" },
      wrap: {
        mode: "wrap",
        counterGap: 18,
        counterAxisAlignContent: "space-between",
      },
    });
    expect(figma).toEqual({
      layoutMode: "HORIZONTAL",
      layoutWrap: "WRAP",
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 12,
      paddingLeft: 16,
      itemSpacing: 10,
      counterAxisSpacing: 18,
      primaryAxisAlignItems: "SPACE_BETWEEN",
      counterAxisAlignItems: "CENTER",
      counterAxisAlignContent: "SPACE_BETWEEN",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
    });
    if (!figma) throw new Error("missing Figma wrap projection");
    expect(fromFigmaWrapAutoLayout(figma)).toEqual({
      ok: true,
      layout: {
        mode: "horizontal",
        padding: { top: 8, right: 16, bottom: 12, left: 16 },
        gap: 10,
        primaryAlignment: "space-between",
        counterAlignment: "center",
        sizing: { horizontal: "fixed", vertical: "fixed" },
        wrap: {
          mode: "wrap",
          counterGap: 18,
          counterAxisAlignContent: "space-between",
        },
      },
    });
    expect(
      fromFigmaWrapAutoLayout({
        ...figma,
        counterAxisAlignItems: "BASELINE",
      }),
    ).toMatchObject({
      ok: true,
      layout: { counterAlignment: "baseline" },
    });
    expect(
      toFigmaWrapAutoLayout({
        mode: "horizontal",
        padding: { top: 8, right: 16, bottom: 12, left: 16 },
        gap: 10,
        primaryAlignment: "space-between",
        counterAlignment: "baseline",
        sizing: { horizontal: "fixed", vertical: "fixed" },
        wrap: {
          mode: "wrap",
          counterGap: 18,
          counterAxisAlignContent: "space-between",
        },
      })?.counterAxisAlignItems,
    ).toBe("BASELINE");
  });

  it("returns null for a non-wrapping horizontal flow", () => {
    expect(
      toFigmaWrapAutoLayout({
        mode: "horizontal",
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0,
        primaryAlignment: "start",
        counterAlignment: "start",
      }),
    ).toBeNull();
  });

  it("round-trips Figma primary and counter-axis Fill child semantics", () => {
    const figma = toFigmaWrapChildLayout({
      horizontal: "fill",
      vertical: "fill",
    });
    expect(figma).toEqual({ layoutGrow: 1, layoutAlign: "STRETCH" });
    expect(fromFigmaWrapChildLayout(figma)).toEqual({
      ok: true,
      sizing: { horizontal: "fill", vertical: "fill" },
    });
    expect(
      fromFigmaWrapChildLayout({ layoutGrow: 0.5, layoutAlign: "INHERIT" }),
    ).toMatchObject({ ok: false });
    expect(
      fromFigmaWrapChildLayout({ layoutGrow: 0, layoutAlign: "CENTER" }),
    ).toMatchObject({ ok: false });
  });
});

describe("Figma Grid Auto Layout compatibility", () => {
  it("maps OpenDesign-owned tracks and cell semantics to public Plugin API shapes", () => {
    const figmaGrid = toFigmaGridAutoLayout({
      mode: "grid",
      padding: { top: 8, right: 16, bottom: 8, left: 16 },
      rowGap: 12,
      columnGap: 20,
      rows: [{ type: "hug" }, { type: "fixed", value: 120 }],
      columns: [
        { type: "fixed", value: 180 },
        { type: "fill", value: 2 },
      ],
      itemsPositioning: "row-auto-flow",
    });
    expect(figmaGrid).toEqual({
      layoutMode: "GRID",
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 16,
      gridRowCount: 2,
      gridColumnCount: 2,
      gridRowGap: 12,
      gridColumnGap: 20,
      gridRowSizes: [{ type: "HUG" }, { type: "FIXED", value: 120 }],
      gridColumnSizes: [
        { type: "FIXED", value: 180 },
        { type: "FLEX", value: 2 },
      ],
      gridItemsPositioning: "ROW_AUTO_FLOW",
      gridAutoTracks: "NONE",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
    });
    expect(fromFigmaGridAutoLayout(figmaGrid)).toMatchObject({
      ok: true,
      grid: {
        mode: "grid",
        rows: [{ type: "hug" }, { type: "fixed", value: 120 }],
        columns: [
          { type: "fixed", value: 180 },
          { type: "fill", value: 2 },
        ],
      },
    });
    expect(
      fromFigmaGridAutoLayout({ ...figmaGrid, gridAutoTracks: "ROWS" }),
    ).toMatchObject({
      ok: true,
      grid: { autoTracks: "rows" },
    });
    expect(
      toFigmaGridAutoLayout({
        mode: "grid",
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        rowGap: 0,
        columnGap: 0,
        rows: [{ type: "fill", value: 1 }],
        columns: [{ type: "fill", value: 1 }],
        itemsPositioning: "row-auto-flow",
        autoTracks: "rows",
      }).gridAutoTracks,
    ).toBe("ROWS");
    const node = {
      id: "card",
      kind: "rectangle",
      name: "Card",
      parentId: "grid",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 80 },
      opacity: 1,
      exportSettings: [],
      gridPlacement: {
        row: 1,
        column: 0,
        rowSpan: 1,
        columnSpan: 2,
        horizontalAlign: "center",
        verticalAlign: "end",
      },
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
      },
      extensions: {},
    } satisfies DesignNode;
    expect(toFigmaGridChild(node)).toEqual({
      gridRowAnchorIndex: 1,
      gridColumnAnchorIndex: 0,
      gridRowSpan: 1,
      gridColumnSpan: 2,
      gridChildHorizontalAlign: "CENTER",
      gridChildVerticalAlign: "MAX",
    });
  });
});
