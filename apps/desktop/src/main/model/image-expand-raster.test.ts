import { describe, expect, it } from "vitest";
import { inspectImageEditMaskPng } from "./image-edit-mask";
import {
  compositeProtectedImageExpansion,
  createImageExpansionRaster,
} from "./image-expand-raster";

describe("trusted image expansion raster", () => {
  it("places the visible source inside a transparent provider canvas and masks only new borders", () => {
    const prepared = createImageExpansionRaster({
      source: {
        size: { width: 2, height: 2 },
        bgra: Uint8Array.from([
          10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
        ]),
      },
      placement: { mode: "stretch" },
      targetSize: { width: 200, height: 200 },
      expansion: { top: 0, right: 200, bottom: 0, left: 0 },
    });
    expect(prepared.geometry.outputSize).toEqual({
      width: 2048,
      height: 1024,
    });
    expect(prepared.geometry.sourceRect).toEqual({
      x: 0,
      y: 0,
      width: 1024,
      height: 1024,
    });
    expect(inspectImageEditMaskPng(prepared.maskPng)).toEqual({
      width: 2048,
      height: 1024,
      transparentPixels: 1024 * 1024,
    });
    expect(prepared.sourceCanvas.bgra[3]).toBe(255);
    expect(prepared.sourceCanvas.bgra.at(-1)).toBe(0);
  });

  it("restores every protected source pixel over the generated result", () => {
    const prepared = createImageExpansionRaster({
      source: {
        size: { width: 1, height: 1 },
        bgra: Uint8Array.from([10, 20, 30, 255]),
      },
      placement: { mode: "stretch" },
      targetSize: { width: 100, height: 100 },
      expansion: { top: 0, right: 100, bottom: 0, left: 0 },
    });
    const generated = new Uint8Array(prepared.sourceCanvas.bgra.length).fill(9);
    const result = compositeProtectedImageExpansion({
      generated: { bgra: generated, size: prepared.geometry.outputSize },
      prepared,
    });
    const protectedOffset =
      (prepared.geometry.sourceRect.y * prepared.geometry.outputSize.width +
        prepared.geometry.sourceRect.x) *
      4;
    const generatedOffset =
      (prepared.geometry.sourceRect.y * prepared.geometry.outputSize.width +
        prepared.geometry.sourceRect.x +
        prepared.geometry.sourceRect.width) *
      4;
    expect(
      Array.from(result.bgra.slice(protectedOffset, protectedOffset + 4)),
    ).toEqual([10, 20, 30, 255]);
    expect(
      Array.from(result.bgra.slice(generatedOffset, generatedOffset + 4)),
    ).toEqual([9, 9, 9, 9]);
  });
});
