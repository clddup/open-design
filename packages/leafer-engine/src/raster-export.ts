import type { DesignNode } from "@opendesign/design-contracts";
import {
  planRasterExportDimensions,
  RASTER_EXPORT_MAX_DIMENSION,
  RASTER_EXPORT_MAX_PIXELS,
  rasterExportMimeType,
  type RasterExportRequest,
} from "@opendesign/import-export-service/raster";
import type {
  LeaferFlattenRasterResult,
  LeaferRasterExportResult,
} from "./types.js";

interface RasterElementExportResult {
  data: unknown;
  error?: unknown;
  height?: unknown;
  width?: unknown;
}

export interface LeaferRasterElement {
  export(
    format: "jpg" | "jpeg" | "png" | "webp",
    options: Record<string, unknown>,
  ): Promise<RasterElementExportResult>;
  getBounds(
    boundsType: "render",
    coordinateType: "local",
  ): { height: number; width: number; x?: number; y?: number };
}

export async function exportLeaferRaster(
  leaf: LeaferRasterElement,
  request: RasterExportRequest,
  sourceKind: DesignNode["kind"] | undefined,
): Promise<LeaferRasterExportResult> {
  const bounds = leaf.getBounds("render", "local");
  const plan = planRasterExportDimensions(bounds, request.size);
  if (!plan.ok) throw new RangeError(`${plan.code}: ${plan.message}`);
  return exportPlannedRaster(leaf, request, sourceKind, plan.dimensions);
}

export async function exportLeaferFlattenRaster(
  leaf: LeaferRasterElement,
): Promise<LeaferFlattenRasterResult> {
  const rawBounds = leaf.getBounds("render", "local");
  const bounds = {
    x: finiteNumber(rawBounds.x) ?? 0,
    y: finiteNumber(rawBounds.y) ?? 0,
    width: rawBounds.width,
    height: rawBounds.height,
  };
  const request: RasterExportRequest = {
    version: 1,
    pageId: "flatten",
    rootNodeId: "flatten",
    format: "png",
    size: { mode: "scale", value: flattenRasterScale(bounds) },
    background: { mode: "transparent" },
    resampling: "smooth",
  };
  const plan = planRasterExportDimensions(bounds, request.size);
  if (!plan.ok) throw new RangeError(`${plan.code}: ${plan.message}`);
  const result = await exportPlannedRaster(
    leaf,
    request,
    undefined,
    plan.dimensions,
  );
  if (result.mimeType !== "image/png") {
    throw new Error("Flatten raster export did not return PNG bytes");
  }
  return { ...result, bounds, mimeType: "image/png" };
}

async function exportPlannedRaster(
  leaf: LeaferRasterElement,
  request: RasterExportRequest,
  sourceKind: DesignNode["kind"] | undefined,
  dimensions: { width: number; height: number; scale: number },
): Promise<LeaferRasterExportResult> {
  const exported = await leaf.export(
    request.format === "jpeg" ? "jpg" : request.format,
    {
      blob: true,
      pixelRatio: 1,
      scale: dimensions.scale,
      ...(sourceKind === "slice" ? { slice: true } : {}),
      smooth: request.resampling === "smooth",
      ...(request.quality === undefined ? {} : { quality: request.quality }),
      ...(request.background.mode === "color"
        ? { fill: request.background.color }
        : {}),
    },
  );
  if (exported.error) {
    throw exported.error instanceof Error
      ? exported.error
      : new Error("Leafer raster export failed");
  }
  if (!isBlobLike(exported.data)) {
    throw new Error("Leafer raster export did not return image bytes");
  }
  const width = finitePositiveInteger(exported.width);
  const height = finitePositiveInteger(exported.height);
  if (width === null || height === null) {
    throw new Error("Leafer raster export returned invalid dimensions");
  }
  if (width !== dimensions.width || height !== dimensions.height) {
    throw new Error(
      `Leafer raster export returned ${width}x${height}; expected ${dimensions.width}x${dimensions.height}`,
    );
  }
  return {
    bytes: new Uint8Array(await exported.data.arrayBuffer()),
    height,
    mimeType: rasterExportMimeType(request.format),
    width,
  };
}

function flattenRasterScale(bounds: { width: number; height: number }): number {
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new RangeError("Flatten raster bounds must be finite and positive");
  }
  const dimensionScale =
    RASTER_EXPORT_MAX_DIMENSION / Math.max(bounds.width, bounds.height);
  const pixelScale = Math.sqrt(
    RASTER_EXPORT_MAX_PIXELS / (bounds.width * bounds.height),
  );
  const scale = Math.min(2, dimensionScale, pixelScale);
  if (scale < 1) {
    throw new RangeError(
      "Flatten raster exceeds the lossless document-pixel export boundary",
    );
  }
  return scale;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isBlobLike(value: unknown): value is Blob {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

function finitePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}
