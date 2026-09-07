import { describe, expect, it } from "vitest";
import { readRasterImageMetadata } from "./raster-image-metadata";

describe("raster image metadata", () => {
  it("reads the lossless WebP shape returned by the image provider", () => {
    const bytes = Buffer.from(
      "52494646d41f1e00574542505650384c67ca1d002fffc5ff00cd",
      "hex",
    );

    expect(readRasterImageMetadata(bytes)).toEqual({
      format: "webp",
      size: { width: 1536, height: 1024 },
    });
  });

  it("rejects non-image bytes", () => {
    expect(
      readRasterImageMetadata(Buffer.from("not an image")),
    ).toBeUndefined();
  });
});
