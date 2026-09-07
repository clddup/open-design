import type { Size } from "@opendesign/design-contracts";
import { imageDimensionsFromData } from "image-dimensions";

export type RasterImageMetadata = {
  format: "gif" | "jpeg" | "png" | "webp";
  size: Size;
};

export function readRasterImageMetadata(
  bytes: Uint8Array,
): RasterImageMetadata | undefined {
  const dimensions = imageDimensionsFromData(bytes);
  if (
    !dimensions ||
    !isSupportedRasterFormat(dimensions.type) ||
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    return undefined;
  }
  return {
    format: dimensions.type,
    size: { width: dimensions.width, height: dimensions.height },
  };
}

function isSupportedRasterFormat(
  format: string,
): format is RasterImageMetadata["format"] {
  return (
    format === "gif" ||
    format === "jpeg" ||
    format === "png" ||
    format === "webp"
  );
}
