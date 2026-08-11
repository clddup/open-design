import { describe, expect, it } from "vitest";
import {
  isRasterExportRequest,
  planRasterExportDimensions,
  rasterExportExtension,
  rasterExportMimeType,
} from "./raster.js";

describe("Raster Export v1", () => {
  it("plans 1x/2x/3x and fixed-edge output without changing aspect ratio", () => {
    expect(
      planRasterExportDimensions(
        { width: 800, height: 600 },
        { mode: "scale", value: 2 },
      ),
    ).toEqual({
      ok: true,
      dimensions: { width: 1600, height: 1200, scale: 2 },
    });
    expect(
      planRasterExportDimensions(
        { width: 800, height: 600 },
        { mode: "width", value: 1200 },
      ),
    ).toEqual({
      ok: true,
      dimensions: { width: 1200, height: 900, scale: 1.5 },
    });
    expect(
      planRasterExportDimensions(
        { width: 800, height: 600 },
        { mode: "height", value: 300 },
      ),
    ).toEqual({
      ok: true,
      dimensions: { width: 400, height: 300, scale: 0.5 },
    });
  });

  it("rejects invalid and excessive output before allocating a surface", () => {
    expect(
      planRasterExportDimensions(
        { width: 0, height: 600 },
        { mode: "scale", value: 1 },
      ),
    ).toMatchObject({ ok: false, code: "invalid-source" });
    expect(
      planRasterExportDimensions(
        { width: 16000, height: 16000 },
        { mode: "scale", value: 3 },
      ),
    ).toMatchObject({ ok: false, code: "size-budget-exceeded" });
  });

  it("validates exact format-specific requests", () => {
    const request = {
      version: 1,
      pageId: "page_1",
      rootNodeId: "frame_1",
      format: "png",
      size: { mode: "scale", value: 2 },
      background: { mode: "transparent" },
      resampling: "smooth",
    };
    expect(isRasterExportRequest(request)).toBe(true);
    expect(isRasterExportRequest({ ...request, quality: 0.8 })).toBe(false);
    expect(
      isRasterExportRequest({
        ...request,
        format: "jpeg",
        quality: 0.9,
        background: { mode: "transparent" },
      }),
    ).toBe(false);
    expect(isRasterExportRequest({ ...request, filePath: "/tmp/a.png" })).toBe(
      false,
    );
  });

  it("maps stable MIME types and portable extensions", () => {
    expect(rasterExportMimeType("jpeg")).toBe("image/jpeg");
    expect(rasterExportMimeType("webp")).toBe("image/webp");
    expect(rasterExportExtension("jpeg")).toBe(".jpg");
    expect(rasterExportExtension("png")).toBe(".png");
  });
});
