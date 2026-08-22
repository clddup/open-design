import type {
  ImagePlacement,
  Size,
  Transform,
} from "@opendesign/design-contracts";
import {
  imageTargetToSourceTransform,
  resolveImageExpansionRaster,
  type ImageExpansionInsets,
  type ImageExpansionRasterGeometry,
} from "@opendesign/image-service";
import { encodeRgbaPng } from "./image-edit-mask";

export type BgraRaster = {
  bgra: Uint8Array;
  size: Size;
};

export type PreparedImageExpansionRaster = {
  geometry: ImageExpansionRasterGeometry;
  maskPng: Uint8Array;
  sourceCanvas: BgraRaster;
};

export function createImageExpansionRaster(input: {
  expansion: ImageExpansionInsets;
  placement: ImagePlacement;
  source: BgraRaster;
  targetSize: Size;
}): PreparedImageExpansionRaster {
  assertBgraRaster(input.source);
  const geometry = resolveImageExpansionRaster({
    expansion: input.expansion,
    targetSize: input.targetSize,
  });
  const sourceCanvas = new Uint8Array(
    geometry.outputSize.width * geometry.outputSize.height * 4,
  );
  const targetToSource = imageTargetToSourceTransform({
    placement: input.placement,
    sourceSize: input.source.size,
    targetSize: input.targetSize,
  });
  const { sourceRect } = geometry;
  for (let y = sourceRect.y; y < sourceRect.y + sourceRect.height; y += 1) {
    for (let x = sourceRect.x; x < sourceRect.x + sourceRect.width; x += 1) {
      const targetPoint = {
        x:
          ((x + 0.5 - sourceRect.x) / sourceRect.width) *
          input.targetSize.width,
        y:
          ((y + 0.5 - sourceRect.y) / sourceRect.height) *
          input.targetSize.height,
      };
      const sourcePoint = transformPoint(targetToSource, targetPoint);
      sampleBilinearBgra(
        input.source,
        sourcePoint.x,
        sourcePoint.y,
        sourceCanvas,
        (y * geometry.outputSize.width + x) * 4,
      );
    }
  }
  const mask = new Uint8Array(sourceCanvas.byteLength);
  for (let index = 0; index < mask.byteLength; index += 4) {
    mask[index] = 255;
    mask[index + 1] = 255;
    mask[index + 2] = 255;
  }
  for (let y = sourceRect.y; y < sourceRect.y + sourceRect.height; y += 1) {
    for (let x = sourceRect.x; x < sourceRect.x + sourceRect.width; x += 1) {
      mask[(y * geometry.outputSize.width + x) * 4 + 3] = 255;
    }
  }
  return {
    geometry,
    maskPng: encodeRgbaPng({
      width: geometry.outputSize.width,
      height: geometry.outputSize.height,
      rgba: mask,
    }),
    sourceCanvas: {
      bgra: sourceCanvas,
      size: geometry.outputSize,
    },
  };
}

export function compositeProtectedImageExpansion(input: {
  generated: BgraRaster;
  prepared: PreparedImageExpansionRaster;
}): BgraRaster {
  assertBgraRaster(input.generated);
  assertBgraRaster(input.prepared.sourceCanvas);
  const { outputSize, sourceRect } = input.prepared.geometry;
  if (
    input.generated.size.width !== outputSize.width ||
    input.generated.size.height !== outputSize.height
  ) {
    throw new RangeError(
      "Expanded image output dimensions do not match the provider canvas",
    );
  }
  const result = new Uint8Array(input.generated.bgra);
  const source = input.prepared.sourceCanvas.bgra;
  const stride = outputSize.width * 4;
  const rowBytes = sourceRect.width * 4;
  for (let y = sourceRect.y; y < sourceRect.y + sourceRect.height; y += 1) {
    const start = y * stride + sourceRect.x * 4;
    result.set(source.subarray(start, start + rowBytes), start);
  }
  return { bgra: result, size: structuredClone(outputSize) };
}

function sampleBilinearBgra(
  source: BgraRaster,
  sourceX: number,
  sourceY: number,
  target: Uint8Array,
  targetOffset: number,
): void {
  if (
    sourceX < 0 ||
    sourceY < 0 ||
    sourceX >= source.size.width ||
    sourceY >= source.size.height
  ) {
    return;
  }
  const x = sourceX - 0.5;
  const y = sourceY - 0.5;
  const x0 = clamp(Math.floor(x), 0, source.size.width - 1);
  const y0 = clamp(Math.floor(y), 0, source.size.height - 1);
  const x1 = clamp(x0 + 1, 0, source.size.width - 1);
  const y1 = clamp(y0 + 1, 0, source.size.height - 1);
  const fractionX = clamp(x - Math.floor(x), 0, 1);
  const fractionY = clamp(y - Math.floor(y), 0, 1);
  for (let channel = 0; channel < 4; channel += 1) {
    const top =
      channelAt(source, x0, y0, channel) * (1 - fractionX) +
      channelAt(source, x1, y0, channel) * fractionX;
    const bottom =
      channelAt(source, x0, y1, channel) * (1 - fractionX) +
      channelAt(source, x1, y1, channel) * fractionX;
    target[targetOffset + channel] = Math.round(
      top * (1 - fractionY) + bottom * fractionY,
    );
  }
}

function channelAt(
  source: BgraRaster,
  x: number,
  y: number,
  channel: number,
): number {
  return source.bgra[(y * source.size.width + x) * 4 + channel] ?? 0;
}

function assertBgraRaster(raster: BgraRaster): void {
  if (
    !Number.isInteger(raster.size.width) ||
    !Number.isInteger(raster.size.height) ||
    raster.size.width <= 0 ||
    raster.size.height <= 0 ||
    raster.bgra.byteLength !== raster.size.width * raster.size.height * 4
  ) {
    throw new RangeError("BGRA raster dimensions are invalid");
  }
}

function transformPoint(transform: Transform, point: { x: number; y: number }) {
  return {
    x: transform[0] * point.x + transform[2] * point.y + transform[4],
    y: transform[1] * point.x + transform[3] * point.y + transform[5],
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
