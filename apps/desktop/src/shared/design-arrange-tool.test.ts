import { describe, expect, it } from "vitest";
import { isDesignArrangeToolInput } from "./design-arrange-tool.js";

describe("Grid arrange tool contract", () => {
  it("accepts only the bounded delivery overflow repair target", () => {
    expect(
      isDesignArrangeToolInput({
        action: "repair-overflow",
        label: "Reveal clipped content",
        pageId: "page_1",
        frameId: "delivery_frame",
      }),
    ).toBe(true);
    expect(
      isDesignArrangeToolInput({
        action: "repair-overflow",
        label: "Reveal clipped content",
        pageId: "page_1",
        frameId: "delivery_frame",
        width: 999,
      }),
    ).toBe(false);
  });

  it("accepts Figma-shaped Grid tracks and strict child placement", () => {
    expect(
      isDesignArrangeToolInput({
        action: "set-auto-layout",
        label: "Create product grid",
        pageId: "page_1",
        frameId: "frame_grid",
        autoLayout: {
          mode: "grid",
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
          rowGap: 12,
          columnGap: 16,
          rows: [{ type: "hug" }, { type: "fixed", value: 120 }],
          columns: [
            { type: "fixed", value: 180 },
            { type: "fill", value: 1 },
          ],
          itemsPositioning: "manual",
          sizing: { horizontal: "fixed", vertical: "hug" },
        },
      }),
    ).toBe(true);
    expect(
      isDesignArrangeToolInput({
        action: "set-auto-layout",
        label: "Create automatic product rows",
        pageId: "page_1",
        frameId: "frame_grid",
        autoLayout: {
          mode: "grid",
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
          rowGap: 12,
          columnGap: 16,
          rows: [{ type: "fill", value: 1 }],
          columns: [{ type: "fill", value: 1 }],
          itemsPositioning: "row-auto-flow",
          autoTracks: "rows",
        },
      }),
    ).toBe(true);
    expect(
      isDesignArrangeToolInput({
        action: "reorder-grid-tracks",
        label: "Move hero rows",
        pageId: "page_1",
        frameId: "frame_grid",
        axis: "rows",
        fromIndices: [2, 0, 2],
        insertionIndex: 3,
      }),
    ).toBe(true);
    expect(
      isDesignArrangeToolInput({
        action: "set-grid-placement",
        label: "Span hero",
        pageId: "page_1",
        nodeId: "hero",
        placement: {
          row: 0,
          column: 0,
          rowSpan: 1,
          columnSpan: 2,
          horizontalAlign: "auto",
          verticalAlign: "center",
        },
      }),
    ).toBe(true);
  });

  it("rejects zero Fill weights, invalid spans and unknown Grid fields", () => {
    expect(
      isDesignArrangeToolInput({
        action: "set-auto-layout",
        label: "Invalid grid",
        pageId: "page_1",
        frameId: "frame_grid",
        autoLayout: {
          mode: "grid",
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          rowGap: 0,
          columnGap: 0,
          rows: [{ type: "fill", value: 0 }],
          columns: [{ type: "fill", value: 1 }],
          itemsPositioning: "row-auto-flow",
        },
      }),
    ).toBe(false);
    expect(
      isDesignArrangeToolInput({
        action: "set-auto-layout",
        label: "Invalid automatic rows",
        pageId: "page_1",
        frameId: "frame_grid",
        autoLayout: {
          mode: "grid",
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          rowGap: 0,
          columnGap: 0,
          rows: [{ type: "fill", value: 1 }],
          columns: [{ type: "fill", value: 1 }],
          itemsPositioning: "manual",
          autoTracks: "rows",
        },
      }),
    ).toBe(false);
    expect(
      isDesignArrangeToolInput({
        action: "reorder-grid-tracks",
        label: "Invalid reorder",
        pageId: "page_1",
        frameId: "frame_grid",
        axis: "rows",
        fromIndices: [],
        insertionIndex: 0,
      }),
    ).toBe(false);
    expect(
      isDesignArrangeToolInput({
        action: "set-grid-placement",
        label: "Invalid span",
        pageId: "page_1",
        nodeId: "hero",
        placement: {
          row: 0,
          column: 0,
          rowSpan: 0,
          columnSpan: 1,
          horizontalAlign: "auto",
          verticalAlign: "auto",
        },
      }),
    ).toBe(false);
  });
});
