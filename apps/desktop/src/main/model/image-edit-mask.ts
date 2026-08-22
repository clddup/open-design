import type { NormalizedPoint } from "@opendesign/design-contracts";
import { deflateSync, inflateSync } from "node:zlib";

export const MAX_IMAGE_EDIT_MASK_PIXELS = 32 * 1024 * 1024;

export function createImageEditMaskPng(input: {
  width: number;
  height: number;
  points: readonly NormalizedPoint[];
}): Uint8Array {
  const { width, height, points } = input;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_IMAGE_EDIT_MASK_PIXELS
  ) {
    throw new RangeError(
      "Image edit mask dimensions exceed the supported limit",
    );
  }
  assertSelectionPoints(points);
  const stride = width * 4 + 1;
  const scanlines = Buffer.allocUnsafe(stride * height);
  let transparentPixels = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const selected = pointInPolygon(
        { x: (x + 0.5) / width, y: (y + 0.5) / height },
        points,
      );
      const offset = row + 1 + x * 4;
      scanlines[offset] = 255;
      scanlines[offset + 1] = 255;
      scanlines[offset + 2] = 255;
      scanlines[offset + 3] = selected ? 0 : 255;
      if (selected) transparentPixels += 1;
    }
  }
  if (transparentPixels === 0) {
    throw new RangeError(
      "Image edit selection does not cover any source pixels",
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function inspectImageEditMaskPng(value: Uint8Array): {
  height: number;
  transparentPixels: number;
  width: number;
} {
  const bytes = Buffer.from(value);
  if (
    bytes.byteLength < 45 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    throw new TypeError("Image edit mask is not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  const compressed: Buffer[] = [];
  while (offset + 12 <= bytes.byteLength) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const next = dataStart + length + 4;
    if (next > bytes.byteLength)
      throw new TypeError("Malformed image edit mask");
    if (type === "IHDR") {
      if (
        length !== 13 ||
        bytes[dataStart + 8] !== 8 ||
        bytes[dataStart + 9] !== 6
      ) {
        throw new TypeError("Image edit mask must be an 8-bit RGBA PNG");
      }
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
    } else if (type === "IDAT") {
      compressed.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = next;
  }
  if (width <= 0 || height <= 0 || compressed.length === 0) {
    throw new TypeError("Malformed image edit mask");
  }
  const scanlines = inflateSync(Buffer.concat(compressed));
  const stride = width * 4 + 1;
  if (scanlines.byteLength !== stride * height) {
    throw new TypeError("Malformed image edit mask pixels");
  }
  let transparentPixels = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    if (scanlines[row] !== 0) {
      throw new TypeError("Unsupported image edit mask filter");
    }
    for (let x = 0; x < width; x += 1) {
      if (scanlines[row + 1 + x * 4 + 3] === 0) transparentPixels += 1;
    }
  }
  return { width, height, transparentPixels };
}

function assertSelectionPoints(points: readonly NormalizedPoint[]): void {
  if (
    points.length < 3 ||
    points.length > 512 ||
    points.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1,
    )
  ) {
    throw new RangeError("Image edit selection polygon is invalid");
  }
}

function pointInPolygon(
  point: NormalizedPoint,
  polygon: readonly NormalizedPoint[],
): boolean {
  let inside = false;
  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const crosses =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.allocUnsafe(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([typeBytes, data])),
    8 + data.byteLength,
  );
  return chunk;
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
