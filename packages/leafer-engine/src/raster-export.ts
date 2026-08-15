import type { DesignNode } from "@opendesign/design-contracts";
import {
  planRasterExportDimensions,
  rasterExportMimeType,
  type RasterExportRequest,
} from "@opendesign/import-export-service/raster";
import type { LeaferRasterExportResult } from "./types.js";

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
  ): { height: number; width: number };
}

export async function exportLeaferRaster(
  leaf: LeaferRasterElement,
  request: RasterExportRequest,
  sourceKind: DesignNode["kind"] | undefined,
): Promise<LeaferRasterExportResult> {
  const bounds = leaf.getBounds("render", "local");
  const plan = planRasterExportDimensions(bounds, request.size);
  if (!plan.ok) throw new RangeError(`${plan.code}: ${plan.message}`);
  const exported = await leaf.export(
    request.format === "jpeg" ? "jpg" : request.format,
    {
      blob: true,
      pixelRatio: 1,
      scale: plan.dimensions.scale,
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
  if (width !== plan.dimensions.width || height !== plan.dimensions.height) {
    throw new Error(
      `Leafer raster export returned ${width}x${height}; expected ${plan.dimensions.width}x${plan.dimensions.height}`,
    );
  }
  return {
    bytes: new Uint8Array(await exported.data.arrayBuffer()),
    height,
    mimeType: rasterExportMimeType(request.format),
    width,
  };
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
