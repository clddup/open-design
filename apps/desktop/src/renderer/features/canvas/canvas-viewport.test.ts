import { describe, expect, it } from "vitest";
import { fitViewportToBounds, generationFitPadding } from "./canvas-viewport";

const viewport = {
  panX: 0,
  panY: 0,
  zoom: 1,
  width: 1_000,
  height: 800,
};

describe("canvas viewport fitting", () => {
  it("centers bounds with stable screen padding", () => {
    expect(
      fitViewportToBounds(viewport, {
        x: 100,
        y: 200,
        width: 500,
        height: 400,
      }),
    ).toEqual({ zoom: 1.68, panX: -88, panY: -272 });
  });

  it("caps generated artboards at 100% instead of enlarging them", () => {
    expect(
      fitViewportToBounds(
        viewport,
        { x: 200, y: 100, width: 390, height: 500 },
        { maxZoom: 1, padding: generationFitPadding(viewport) },
      ),
    ).toEqual({ zoom: 1, panX: 105, panY: 50 });
  });

  it("does nothing before the canvas has a measurable viewport", () => {
    expect(
      fitViewportToBounds(
        { ...viewport, width: 0 },
        { x: 0, y: 0, width: 100, height: 100 },
      ),
    ).toBeNull();
  });
});
