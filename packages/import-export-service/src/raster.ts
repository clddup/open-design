import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { Type, type Static } from "@opendesign/design-contracts";

export const RASTER_EXPORT_VERSION = 1 as const;
export const RASTER_EXPORT_MAX_DIMENSION = 16_384;
export const RASTER_EXPORT_MAX_PIXELS = 100_000_000;
export const RASTER_EXPORT_MAX_ENCODED_BYTES = 256 * 1024 * 1024;

export const RasterExportFormatSchema = Type.Union([
  Type.Literal("png"),
  Type.Literal("jpeg"),
  Type.Literal("webp"),
]);
export type RasterExportFormat = Static<typeof RasterExportFormatSchema>;
export type RasterExportMimeType = "image/png" | "image/jpeg" | "image/webp";
export type RasterExportResampling = "smooth" | "pixelated";

export const RasterExportSizeSchema = Type.Union([
  Type.Object(
    {
      mode: Type.Literal("scale"),
      value: Type.Number({ exclusiveMinimum: 0, maximum: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("width"),
      value: Type.Integer({
        minimum: 1,
        maximum: RASTER_EXPORT_MAX_DIMENSION,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("height"),
      value: Type.Integer({
        minimum: 1,
        maximum: RASTER_EXPORT_MAX_DIMENSION,
      }),
    },
    { additionalProperties: false },
  ),
]);
export type RasterExportSize = Static<typeof RasterExportSizeSchema>;

export const RasterExportBackgroundSchema = Type.Union([
  Type.Object(
    { mode: Type.Literal("transparent") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("color"),
      color: Type.String({ pattern: "^#[\\da-fA-F]{6}$" }),
    },
    { additionalProperties: false },
  ),
]);
export type RasterExportBackground = Static<
  typeof RasterExportBackgroundSchema
>;

const RasterExportIdSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});

export const RasterExportRequestSchema = Type.Object(
  {
    version: Type.Literal(RASTER_EXPORT_VERSION),
    pageId: RasterExportIdSchema,
    rootNodeId: RasterExportIdSchema,
    format: RasterExportFormatSchema,
    size: RasterExportSizeSchema,
    background: RasterExportBackgroundSchema,
    quality: Type.Optional(Type.Number({ minimum: 0.01, maximum: 1 })),
    resampling: Type.Union([Type.Literal("smooth"), Type.Literal("pixelated")]),
  },
  { additionalProperties: false },
);
export type RasterExportRequest = Static<typeof RasterExportRequestSchema>;

export const RasterExportRequestContract = defineContract<RasterExportRequest>({
  schema: RasterExportRequestSchema,
  code: "raster_export.request_structure_invalid",
  subject: "raster export request",
  refine: rasterExportRequestDomainIssues,
  clone: false,
});

const RasterExportSizeContract = defineContract<RasterExportSize>({
  schema: RasterExportSizeSchema,
  code: "raster_export.size_structure_invalid",
  subject: "raster export size",
  clone: false,
});

const RasterExportFormatContract = defineContract<RasterExportFormat>({
  schema: RasterExportFormatSchema,
  code: "raster_export.format_structure_invalid",
  subject: "raster export format",
  clone: false,
});

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
  if (!RasterExportSizeContract.parse(size).ok) {
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
  // Leafer 2.2.9 allocates the export surface with integer truncation. Keep
  // planning aligned with the pinned renderer so fractional render bounds do
  // not pass preflight and then fail the exact-dimension check.
  const width = Math.max(1, Math.floor(source.width * scale));
  const height = Math.max(1, Math.floor(source.height * scale));
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
  return RasterExportRequestContract.parse(value).ok;
}

export function isRasterExportFormat(
  value: unknown,
): value is RasterExportFormat {
  return RasterExportFormatContract.parse(value).ok;
}

export function rasterExportMimeType(
  format: RasterExportFormat,
): RasterExportMimeType {
  return `image/${format}` as RasterExportMimeType;
}

export function rasterExportExtension(format: RasterExportFormat): string {
  return format === "jpeg" ? ".jpg" : `.${format}`;
}

function rasterExportRequestDomainIssues(
  request: RasterExportRequest,
): ValidationIssue[] {
  if (request.format === "png" && request.quality !== undefined) {
    return [
      requestIssue(
        "/quality",
        "PNG export does not accept a lossy quality setting",
        "omit quality",
        request.quality,
      ),
    ];
  }
  if (request.format === "jpeg" && request.background.mode !== "color") {
    return [
      requestIssue(
        "/background/mode",
        "JPEG export requires an explicit opaque background color",
        "color",
        request.background.mode,
      ),
    ];
  }
  return [];
}

function requestIssue(
  path: string,
  message: string,
  expected: string,
  actual: string | number,
): ValidationIssue {
  return {
    code: "raster_export.request_domain_invalid",
    path,
    message,
    expected,
    actual,
    recovery: "Correct the reported export option and retry once.",
  };
}

function failure(
  code: Extract<RasterExportPlan, { ok: false }>["code"],
  message: string,
): Extract<RasterExportPlan, { ok: false }> {
  return { ok: false, code, message };
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
