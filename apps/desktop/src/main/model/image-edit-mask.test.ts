import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_EDIT_MASK_PIXELS,
  createImageEditMaskPng,
  inspectImageEditMaskPng,
} from "./image-edit-mask";

describe("trusted image edit mask", () => {
  it("rasterizes a normalized lasso into an exact-size RGBA PNG", () => {
    const mask = createImageEditMaskPng({
      width: 10,
      height: 8,
      points: [
        { x: 0.2, y: 0.25 },
        { x: 0.8, y: 0.25 },
        { x: 0.8, y: 0.75 },
        { x: 0.2, y: 0.75 },
      ],
    });
    expect(inspectImageEditMaskPng(mask)).toEqual({
      width: 10,
      height: 8,
      transparentPixels: 24,
    });
  });

  it("rejects malformed, empty, and over-budget masks", () => {
    expect(() =>
      createImageEditMaskPng({
        width: 10,
        height: 10,
        points: [
          { x: 0, y: 0 },
          { x: 0.000_01, y: 0 },
          { x: 0, y: 0.000_01 },
        ],
      }),
    ).toThrow("does not cover");
    expect(() =>
      createImageEditMaskPng({
        width: MAX_IMAGE_EDIT_MASK_PIXELS + 1,
        height: 1,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
    ).toThrow("supported limit");
    expect(() => inspectImageEditMaskPng(Uint8Array.from([1, 2, 3]))).toThrow(
      "not a PNG",
    );
  });
});
