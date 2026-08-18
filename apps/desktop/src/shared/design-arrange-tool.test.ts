import { describe, expect, it } from "vitest";
import { isDesignArrangeToolInput } from "./design-arrange-tool.js";

describe("Grid arrange tool contract", () => {
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
