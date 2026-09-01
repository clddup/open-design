import { describe, expect, it, vi } from "vitest";
import { exportLeaferFlattenRaster } from "./raster-export.js";

describe("Flatten raster export", () => {
  it("keeps parent-local render bounds and exports a transparent 2x PNG", async () => {
    const exportImage = vi.fn().mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      width: 240,
      height: 160,
    });
    const result = await exportLeaferFlattenRaster({
      export: exportImage,
      getBounds: () => ({ x: 4, y: 6, width: 120, height: 80 }),
    });

    expect(exportImage).toHaveBeenCalledWith(
      "png",
      expect.objectContaining({
        blob: true,
        pixelRatio: 1,
        scale: 2,
        smooth: true,
      }),
    );
    expect(result).toMatchObject({
      bounds: { x: 4, y: 6, width: 120, height: 80 },
      width: 240,
      height: 160,
      mimeType: "image/png",
    });
    expect([...result.bytes]).toEqual([1, 2, 3]);
  });

  it("uses Leafer's integer surface dimensions for fractional render bounds", async () => {
    const exportImage = vi.fn().mockResolvedValue({
      data: new Blob([new Uint8Array([1])], { type: "image/png" }),
      width: 200,
      height: 161,
    });

    const result = await exportLeaferFlattenRaster({
      export: exportImage,
      getBounds: () => ({ x: 0.25, y: -0.5, width: 100.4, height: 80.9 }),
    });

    expect(result).toMatchObject({
      bounds: { x: 0.25, y: -0.5, width: 100.4, height: 80.9 },
      width: 200,
      height: 161,
    });
  });

  it("rejects a raster that would downsample document pixels", async () => {
    await expect(
      exportLeaferFlattenRaster({
        export: vi.fn(),
        getBounds: () => ({ width: 20_000, height: 20_000 }),
      }),
    ).rejects.toThrow("lossless document-pixel");
  });
});
