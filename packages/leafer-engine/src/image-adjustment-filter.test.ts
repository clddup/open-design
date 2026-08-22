import { Filter } from "@leafer-ui/draw";
import { describe, expect, it, vi } from "vitest";
import {
  LEAFER_IMAGE_ADJUSTMENT_FILTER,
  toLeaferImageAdjustmentFilter,
} from "./image-adjustment-filter.js";

describe("Leafer image adjustment filter", () => {
  it("omits neutral projection data", () => {
    expect(toLeaferImageAdjustmentFilter(undefined)).toBeUndefined();
    expect(
      toLeaferImageAdjustmentFilter({ exposure: 0, contrast: 0 }),
    ).toBeUndefined();
  });

  it("processes only the bounded layer pixels and preserves alpha", () => {
    const pixels = new Uint8ClampedArray([220, 60, 20, 91, 24, 48, 72, 173]);
    const getImageData = vi.fn(() => ({ data: pixels }));
    const putImageData = vi.fn();
    const processor = Filter.list[LEAFER_IMAGE_ADJUSTMENT_FILTER];
    if (!processor)
      throw new Error("Image adjustment filter is not registered");

    processor.apply(
      { type: LEAFER_IMAGE_ADJUSTMENT_FILTER, saturation: -1 },
      {} as never,
      { x: 4, y: 6, width: 2, height: 1 } as never,
      {
        pixelRatio: 1,
        pixelWidth: 20,
        pixelHeight: 20,
        context: { getImageData, putImageData },
      } as never,
      {} as never,
      {} as never,
    );

    expect(getImageData).toHaveBeenCalledWith(4, 6, 2, 1);
    expect(putImageData).toHaveBeenCalledWith({ data: pixels }, 4, 6);
    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[1]).toBe(pixels[2]);
    expect(pixels[3]).toBe(91);
    expect(pixels[7]).toBe(173);
  });
});
