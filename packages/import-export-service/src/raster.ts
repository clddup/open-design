export const RASTER_EXPORT_VERSION = 1 as const;
export const RASTER_EXPORT_MAX_DIMENSION = 16_384;
export const RASTER_EXPORT_MAX_PIXELS = 100_000_000;
export const RASTER_EXPORT_MAX_ENCODED_BYTES = 256 * 1024 * 1024;

export type RasterExportFormat = "png" | "jpeg" | "webp";
export type RasterExportMimeType = "image/png" | "image/jpeg" | "image/webp";
export type RasterExportResampling = "smooth" | "pixelated";

export type RasterExportSize =
  | { mode: "scale"; value: 1 | 2 | 3 }
  | { mode: "width"; value: number }
  | { mode: "height"; value: number };

export type RasterExportBackground =
  { mode: "transparent" } | { mode: "color"; color: string };

export interface RasterExportRequest {
  version: typeof RASTER_EXPORT_VERSION;
  pageId: string;
  rootNodeId: string;
  format: RasterExportFormat;
  size: RasterExportSize;
  background: RasterExportBackground;
  quality?: number;
  resampling: RasterExportResampling;
}

export interface RasterExportDimensions {
  width: number;
  height: number;
  scale: number;
}

export type RasterExportPlan =
  | { ok: true; dimensions: RasterExportDimensions }
  | {
      ok: false;
      code: "invalid-source" | "invalid-size" | "size-budget-exceeded";
      message: string;
    };

export function planRasterExportDimensions(
  source: { width: number; height: number },
  size: RasterExportSize,
): RasterExportPlan {
  if (!finitePositive(source.width) || !finitePositive(source.height)) {
    return failure(
      "invalid-source",
      "Raster export source must have finite positive dimensions",
    );
  }
  if (!isRasterExportSize(size)) {
    return failure("invalid-size", "Raster export size is invalid");
  }
  const scale =
    size.mode === "scale"
      ? size.value
      : size.mode === "width"
        ? size.value / source.width
        : size.value / source.height;
  if (!finitePositive(scale)) {
    return failure("invalid-size", "Raster export scale is invalid");
  }
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  if (
    width > RASTER_EXPORT_MAX_DIMENSION ||
    height > RASTER_EXPORT_MAX_DIMENSION ||
    width * height > RASTER_EXPORT_MAX_PIXELS
  ) {
    return failure(
      "size-budget-exceeded",
      `Raster export exceeds ${RASTER_EXPORT_MAX_DIMENSION}px or ${RASTER_EXPORT_MAX_PIXELS} pixels`,
    );
  }
  return { ok: true, dimensions: { width, height, scale } };
}

export function isRasterExportRequest(
  value: unknown,
): value is RasterExportRequest {
  if (!record(value)) return false;
  return (
    value.version === RASTER_EXPORT_VERSION &&
    safeId(value.pageId) &&
    safeId(value.rootNodeId) &&
    isRasterExportFormat(value.format) &&
    isRasterExportSize(value.size) &&
    isRasterExportBackground(value.background) &&
    (value.quality === undefined ||
      (finite(value.quality) && value.quality >= 0.01 && value.quality <= 1)) &&
    (value.format !== "png" || value.quality === undefined) &&
    (value.format !== "jpeg" || value.background.mode === "color") &&
    (value.resampling === "smooth" || value.resampling === "pixelated") &&
    exactKeys(value, [
      "version",
      "pageId",
      "rootNodeId",
      "format",
      "size",
      "background",
      "quality",
      "resampling",
    ])
  );
}

export function isRasterExportFormat(
  value: unknown,
): value is RasterExportFormat {
  return value === "png" || value === "jpeg" || value === "webp";
}

export function rasterExportMimeType(
  format: RasterExportFormat,
): RasterExportMimeType {
  return `image/${format}` as RasterExportMimeType;
}

export function rasterExportExtension(format: RasterExportFormat): string {
  return format === "jpeg" ? ".jpg" : `.${format}`;
}

function isRasterExportSize(value: unknown): value is RasterExportSize {
  if (!record(value) || !exactKeys(value, ["mode", "value"])) return false;
  if (value.mode === "scale") {
    return value.value === 1 || value.value === 2 || value.value === 3;
  }
  return (
    (value.mode === "width" || value.mode === "height") &&
    Number.isInteger(value.value) &&
    Number(value.value) >= 1 &&
    Number(value.value) <= RASTER_EXPORT_MAX_DIMENSION
  );
}

function isRasterExportBackground(
  value: unknown,
): value is RasterExportBackground {
  if (!record(value)) return false;
  if (value.mode === "transparent") {
    return exactKeys(value, ["mode"]);
  }
  return (
    value.mode === "color" &&
    typeof value.color === "string" &&
    /^#[\da-f]{6}$/i.test(value.color) &&
    exactKeys(value, ["mode", "color"])
  );
}

function failure(
  code: Extract<RasterExportPlan, { ok: false }>["code"],
  message: string,
): Extract<RasterExportPlan, { ok: false }> {
  return { ok: false, code, message };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePositive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function safeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return (
    Object.keys(value).every((key) => allowed.includes(key)) &&
    allowed.filter((key) => key !== "quality").every((key) => key in value)
  );
}
