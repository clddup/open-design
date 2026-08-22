import type {
  ImageFilters,
  ImagePlacement,
  NormalizedPoint,
  Point,
  Size,
  Transform,
} from "@opendesign/design-contracts";
import { IMAGE_FILTER_KEYS } from "@opendesign/design-contracts";

export const IMAGE_SERVICE_CONTRACT_VERSION = 8 as const;

const FILTER_EPSILON = 0.000_001;

export function normalizeImageFilters(
  filters: ImageFilters | undefined,
): ImageFilters | undefined {
  if (!filters) return undefined;
  const normalized: ImageFilters = {};
  for (const key of IMAGE_FILTER_KEYS) {
    const value = filters[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value)) {
      throw new RangeError(`Image filter ${key} must be finite`);
    }
    const bounded = clamp(value, -1, 1);
    if (Math.abs(bounded) > FILTER_EPSILON) normalized[key] = bounded;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function imageFiltersAreNeutral(
  filters: ImageFilters | undefined,
): boolean {
  return normalizeImageFilters(filters) === undefined;
}

/**
 * Applies OpenDesign's deterministic sRGB image-adjustment projection in
 * place. Alpha is never changed. The public fields and ranges follow Figma's
 * ImageFilters shape; this implementation remains OpenDesign-owned so canvas,
 * capture, and raster export can share one backend-independent transform.
 */
export function applyImageFiltersToRgba(
  rgba: Uint8ClampedArray,
  filters: ImageFilters | undefined,
): void {
  if (rgba.length % 4 !== 0) {
    throw new RangeError("RGBA input length must be divisible by four");
  }
  const normalized = normalizeImageFilters(filters);
  if (!normalized) return;

  const exposure = normalized.exposure ?? 0;
  const contrast = normalized.contrast ?? 0;
  const saturation = normalized.saturation ?? 0;
  const temperature = normalized.temperature ?? 0;
  const tint = normalized.tint ?? 0;
  const highlights = normalized.highlights ?? 0;
  const shadows = normalized.shadows ?? 0;
  const exposureFactor = 2 ** exposure;
  const contrastFactor = 1 + contrast;

  for (let index = 0; index < rgba.length; index += 4) {
    let red = (rgba[index] ?? 0) / 255;
    let green = (rgba[index + 1] ?? 0) / 255;
    let blue = (rgba[index + 2] ?? 0) / 255;

    red = (red * exposureFactor - 0.5) * contrastFactor + 0.5;
    green = (green * exposureFactor - 0.5) * contrastFactor + 0.5;
    blue = (blue * exposureFactor - 0.5) * contrastFactor + 0.5;

    red += temperature * 0.12 + tint * 0.06;
    green -= tint * 0.12;
    blue += -temperature * 0.12 + tint * 0.06;

    const luminance = clamp(
      red * 0.2126 + green * 0.7152 + blue * 0.0722,
      0,
      1,
    );
    const saturationFactor = 1 + saturation;
    red = luminance + (red - luminance) * saturationFactor;
    green = luminance + (green - luminance) * saturationFactor;
    blue = luminance + (blue - luminance) * saturationFactor;

    const shadowWeight = (1 - luminance) ** 2;
    const highlightWeight = luminance ** 2;
    red = adjustTone(
      adjustTone(red, shadows, shadowWeight),
      highlights,
      highlightWeight,
    );
    green = adjustTone(
      adjustTone(green, shadows, shadowWeight),
      highlights,
      highlightWeight,
    );
    blue = adjustTone(
      adjustTone(blue, shadows, shadowWeight),
      highlights,
      highlightWeight,
    );

    rgba[index] = Math.round(clamp(red, 0, 1) * 255);
    rgba[index + 1] = Math.round(clamp(green, 0, 1) * 255);
    rgba[index + 2] = Math.round(clamp(blue, 0, 1) * 255);
  }
}

function adjustTone(channel: number, amount: number, weight: number): number {
  return amount >= 0
    ? channel + (1 - channel) * amount * weight
    : channel + channel * amount * weight;
}

export type ImageCropPlacement = Extract<ImagePlacement, { mode: "crop" }>;

export interface ImageCropSession {
  current: ImageCropPlacement;
  original: ImagePlacement;
  sourceSize: Size;
  targetSize: Size;
}

export type ResolvedImagePlacement =
  | { mode: "stretch" | "fit" }
  | {
      mode: "clip";
      offset: Point;
      scale: Point;
      rotation: number;
      effectiveFocalPoint: NormalizedPoint;
    };

export interface ResolveImagePlacementInput {
  placement: ImagePlacement;
  sourceSize: Size;
  targetSize: Size;
}

export interface ImageAreaSelection {
  points: readonly NormalizedPoint[];
}

export interface ImageExpansionInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ImageExpandHandle =
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left"
  | "top-left";

export interface ImageExpandSession {
  expansion: ImageExpansionInsets;
  targetSize: Size;
}

export interface ImageExpansionRasterGeometry {
  expandedSize: Size;
  outputSize: Size;
  sourceRect: { x: number; y: number; width: number; height: number };
}

export interface CreateImageAreaSelectionInput {
  placement: ImagePlacement;
  sourceSize: Size;
  targetPoints: readonly Point[];
  targetSize: Size;
}

const MAX_IMAGE_AREA_SELECTION_POINTS = 512;
const MIN_IMAGE_AREA_SELECTION_AREA = 0.000_001;
const MAX_IMAGE_EXPANSION_PER_EDGE = 2;
const MAX_IMAGE_EXPANSION_ASPECT_RATIO = 3;
const IMAGE_EXPANSION_SHORT_EDGE = 1_024;
const IMAGE_PROVIDER_MAX_EDGE = 3_840;
const IMAGE_PROVIDER_MIN_PIXELS = 655_360;
const IMAGE_UPSCALE_MAX_PIXELS = 3_686_400;
const IMAGE_UPSCALE_TARGET_FACTOR = 2;
const IMAGE_UPSCALE_MINIMUM_PIXEL_GAIN = 1.05;

/**
 * Converts a freeform lasso from Image-node local coordinates into normalized
 * source-image coordinates. The result remains stable across node transforms,
 * crop, rotation, and flips, so Main can rasterize an exact-size provider mask
 * without receiving viewport or engine state.
 */
export function createImageAreaSelection({
  placement,
  sourceSize,
  targetPoints,
  targetSize,
}: CreateImageAreaSelectionInput): ImageAreaSelection {
  assertPositiveSize(sourceSize, "sourceSize");
  assertPositiveSize(targetSize, "targetSize");
  if (targetPoints.length < 3) {
    throw new RangeError("Image area selection requires at least three points");
  }
  if (
    targetPoints.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    throw new RangeError("Image area selection points must be finite");
  }
  const sourceToTarget = imageSourceToTargetTransform({
    placement,
    sourceSize,
    targetSize,
  });
  const targetToSource = invertAffineTransform(sourceToTarget);
  const bounded = downsamplePolygon(
    targetPoints,
    MAX_IMAGE_AREA_SELECTION_POINTS,
  )
    .map((point) => transformAffinePoint(targetToSource, point))
    .map((point) => ({
      x: clamp(point.x / sourceSize.width, 0, 1),
      y: clamp(point.y / sourceSize.height, 0, 1),
    }));
  const points = deduplicateAdjacentPoints(bounded);
  if (
    points.length < 3 ||
    polygonArea(points) < MIN_IMAGE_AREA_SELECTION_AREA
  ) {
    throw new RangeError("Image area selection is too small");
  }
  return { points };
}

export function imageSourceToTargetTransform({
  placement,
  sourceSize,
  targetSize,
}: ResolveImagePlacementInput): Transform {
  assertPositiveSize(sourceSize, "sourceSize");
  assertPositiveSize(targetSize, "targetSize");
  if (placement.mode === "stretch") {
    return [
      targetSize.width / sourceSize.width,
      0,
      0,
      targetSize.height / sourceSize.height,
      0,
      0,
    ];
  }
  if (placement.mode === "fit") {
    const scale = Math.min(
      targetSize.width / sourceSize.width,
      targetSize.height / sourceSize.height,
    );
    return [
      scale,
      0,
      0,
      scale,
      (targetSize.width - sourceSize.width * scale) / 2,
      (targetSize.height - sourceSize.height * scale) / 2,
    ];
  }
  const resolved = resolveImagePlacement({ placement, sourceSize, targetSize });
  if (resolved.mode !== "clip") {
    throw new TypeError(
      "Image placement did not resolve to a source transform",
    );
  }
  const radians = (resolved.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    cosine * resolved.scale.x,
    sine * resolved.scale.x,
    -sine * resolved.scale.y,
    cosine * resolved.scale.y,
    resolved.offset.x,
    resolved.offset.y,
  ];
}

export function imageTargetToSourceTransform(
  input: ResolveImagePlacementInput,
): Transform {
  return invertAffineTransform(imageSourceToTargetTransform(input));
}

export function createImageExpandSession(targetSize: Size): ImageExpandSession {
  assertPositiveSize(targetSize, "targetSize");
  return {
    expansion: { top: 0, right: 0, bottom: 0, left: 0 },
    targetSize: structuredClone(targetSize),
  };
}

export function resizeImageExpand(
  session: ImageExpandSession,
  handle: ImageExpandHandle,
  point: Point,
): ImageExpandSession {
  assertPositiveSize(session.targetSize, "targetSize");
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("Image expansion point must be finite");
  }
  const { width, height } = session.targetSize;
  const next = { ...session.expansion };
  if (handle.includes("left")) {
    next.left = clamp(-point.x, 0, width * MAX_IMAGE_EXPANSION_PER_EDGE);
  }
  if (handle.includes("right")) {
    next.right = clamp(
      point.x - width,
      0,
      width * MAX_IMAGE_EXPANSION_PER_EDGE,
    );
  }
  if (handle.includes("top")) {
    next.top = clamp(-point.y, 0, height * MAX_IMAGE_EXPANSION_PER_EDGE);
  }
  if (handle.includes("bottom")) {
    next.bottom = clamp(
      point.y - height,
      0,
      height * MAX_IMAGE_EXPANSION_PER_EDGE,
    );
  }
  assertImageExpansionInsets(next, session.targetSize, false);
  return { ...session, expansion: next };
}

export function setImageExpandAspectRatio(
  session: ImageExpandSession,
  ratio: number,
): ImageExpandSession {
  assertPositiveSize(session.targetSize, "targetSize");
  if (
    !Number.isFinite(ratio) ||
    ratio < 1 / MAX_IMAGE_EXPANSION_ASPECT_RATIO ||
    ratio > MAX_IMAGE_EXPANSION_ASPECT_RATIO
  ) {
    throw new RangeError("Image expansion aspect ratio is unsupported");
  }
  const { width, height } = session.targetSize;
  const currentRatio = width / height;
  const expansion: ImageExpansionInsets = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  if (Math.abs(currentRatio - ratio) < 0.000_001)
    return { ...session, expansion };
  if (ratio > currentRatio) {
    const extra = height * ratio - width;
    expansion.left = extra / 2;
    expansion.right = extra / 2;
  } else {
    const extra = width / ratio - height;
    expansion.top = extra / 2;
    expansion.bottom = extra / 2;
  }
  assertImageExpansionInsets(expansion, session.targetSize, true);
  return { ...session, expansion };
}

export function resolveImageExpansionRaster(input: {
  expansion: ImageExpansionInsets;
  targetSize: Size;
}): ImageExpansionRasterGeometry {
  assertPositiveSize(input.targetSize, "targetSize");
  assertImageExpansionInsets(input.expansion, input.targetSize, true);
  const expandedSize = {
    width:
      input.expansion.left + input.targetSize.width + input.expansion.right,
    height:
      input.expansion.top + input.targetSize.height + input.expansion.bottom,
  };
  const aspect = expandedSize.width / expandedSize.height;
  const outputSize =
    aspect >= 1
      ? {
          width: roundUpTo16(IMAGE_EXPANSION_SHORT_EDGE * aspect),
          height: IMAGE_EXPANSION_SHORT_EDGE,
        }
      : {
          width: IMAGE_EXPANSION_SHORT_EDGE,
          height: roundUpTo16(IMAGE_EXPANSION_SHORT_EDGE / aspect),
        };
  const left = Math.round(
    (input.expansion.left / expandedSize.width) * outputSize.width,
  );
  const top = Math.round(
    (input.expansion.top / expandedSize.height) * outputSize.height,
  );
  const right = Math.round(
    ((input.expansion.left + input.targetSize.width) / expandedSize.width) *
      outputSize.width,
  );
  const bottom = Math.round(
    ((input.expansion.top + input.targetSize.height) / expandedSize.height) *
      outputSize.height,
  );
  return {
    expandedSize,
    outputSize,
    sourceRect: {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    },
  };
}

export function imageExpansionIsEmpty(
  expansion: ImageExpansionInsets,
): boolean {
  return (
    expansion.top <= 0.000_001 &&
    expansion.right <= 0.000_001 &&
    expansion.bottom <= 0.000_001 &&
    expansion.left <= 0.000_001
  );
}

/**
 * Resolves one trusted super-resolution target for the current source bitmap.
 * The preferred result is 2x on each axis. Very small sources grow enough to
 * reach the provider floor, while large sources use the largest meaningful
 * size that stays inside GPT Image 2 and the current embedded-result budget.
 */
export function resolveImageUpscaleSize(sourceSize: Size): Size {
  assertPositivePixelSize(sourceSize, "sourceSize");
  const sourceAspect = Math.max(
    sourceSize.width / sourceSize.height,
    sourceSize.height / sourceSize.width,
  );
  if (sourceAspect > MAX_IMAGE_EXPANSION_ASPECT_RATIO + 0.000_001) {
    throw new RangeError("Image upscale source aspect ratio exceeds 3:1");
  }
  const sourcePixels = sourceSize.width * sourceSize.height;
  const maximumScale = Math.min(
    IMAGE_PROVIDER_MAX_EDGE / sourceSize.width,
    IMAGE_PROVIDER_MAX_EDGE / sourceSize.height,
    Math.sqrt(IMAGE_UPSCALE_MAX_PIXELS / sourcePixels),
  );
  const minimumScale = Math.sqrt(IMAGE_PROVIDER_MIN_PIXELS / sourcePixels);
  if (
    !Number.isFinite(maximumScale) ||
    maximumScale <= 1 ||
    minimumScale > maximumScale + 0.000_001
  ) {
    throw new RangeError(
      "Image source has no larger supported upscale resolution",
    );
  }
  const scale = Math.min(
    maximumScale,
    Math.max(IMAGE_UPSCALE_TARGET_FACTOR, minimumScale),
  );
  let width = Math.min(
    IMAGE_PROVIDER_MAX_EDGE,
    roundUpTo16(sourceSize.width * scale),
  );
  let height = Math.min(
    IMAGE_PROVIDER_MAX_EDGE,
    roundUpTo16(sourceSize.height * scale),
  );
  while (width * height > IMAGE_UPSCALE_MAX_PIXELS) {
    if (width / sourceSize.width >= height / sourceSize.height) width -= 16;
    else height -= 16;
  }
  const targetPixels = width * height;
  if (
    width <= 0 ||
    height <= 0 ||
    targetPixels < IMAGE_PROVIDER_MIN_PIXELS ||
    targetPixels < sourcePixels * IMAGE_UPSCALE_MINIMUM_PIXEL_GAIN
  ) {
    throw new RangeError(
      "Image source has no meaningful supported upscale resolution",
    );
  }
  const targetAspect = Math.max(width / height, height / width);
  if (targetAspect > MAX_IMAGE_EXPANSION_ASPECT_RATIO + 0.000_001) {
    throw new RangeError("Image upscale target aspect ratio exceeds 3:1");
  }
  return { width, height };
}

export function resolveImagePlacement({
  placement,
  sourceSize,
  targetSize,
}: ResolveImagePlacementInput): ResolvedImagePlacement {
  assertPositiveSize(sourceSize, "sourceSize");
  assertPositiveSize(targetSize, "targetSize");
  if (placement.mode === "stretch" || placement.mode === "fit") {
    return { mode: placement.mode };
  }

  const crop =
    placement.mode === "fill"
      ? {
          focalPoint: placement.focalPoint,
          zoom: 1,
          rotation: 0,
          flipHorizontal: false,
          flipVertical: false,
        }
      : placement;
  const rotation = normalizeRotation(crop.rotation);
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const requiredWidth =
    Math.abs(targetSize.width * cosine) + Math.abs(targetSize.height * sine);
  const requiredHeight =
    Math.abs(targetSize.width * sine) + Math.abs(targetSize.height * cosine);
  const baseScale = Math.max(
    requiredWidth / sourceSize.width,
    requiredHeight / sourceSize.height,
  );
  const magnitude = baseScale * crop.zoom;
  const scale = {
    x: magnitude * (crop.flipHorizontal ? -1 : 1),
    y: magnitude * (crop.flipVertical ? -1 : 1),
  };
  const effectiveFocalPoint = constrainFocalPoint(
    crop.focalPoint,
    sourceSize,
    targetSize,
    cosine,
    sine,
    scale,
  );
  const focalX = effectiveFocalPoint.x * sourceSize.width;
  const focalY = effectiveFocalPoint.y * sourceSize.height;
  const a = cosine * scale.x;
  const b = sine * scale.x;
  const c = -sine * scale.y;
  const d = cosine * scale.y;

  return {
    mode: "clip",
    scale,
    rotation,
    effectiveFocalPoint,
    offset: {
      x: targetSize.width / 2 - a * focalX - c * focalY,
      y: targetSize.height / 2 - b * focalX - d * focalY,
    },
  };
}

export function createImageCropSession(input: {
  placement: ImagePlacement;
  sourceSize: Size;
  targetSize: Size;
}): ImageCropSession {
  assertPositiveSize(input.sourceSize, "sourceSize");
  assertPositiveSize(input.targetSize, "targetSize");
  const crop: ImageCropPlacement =
    input.placement.mode === "crop"
      ? structuredClone(input.placement)
      : {
          mode: "crop",
          focalPoint:
            input.placement.mode === "fill"
              ? structuredClone(input.placement.focalPoint)
              : { x: 0.5, y: 0.5 },
          zoom: 1,
          rotation: 0,
          flipHorizontal: false,
          flipVertical: false,
        };
  return {
    current: canonicalCropPlacement(crop, input.sourceSize, input.targetSize),
    original: structuredClone(input.placement),
    sourceSize: structuredClone(input.sourceSize),
    targetSize: structuredClone(input.targetSize),
  };
}

export function moveImageCrop(
  session: ImageCropSession,
  delta: Point,
): ImageCropSession {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new RangeError("Image crop delta must be finite");
  }
  const resolved = requireClipPlacement(session);
  const [a, b, c, d] = cropLinearTransform(resolved);
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 0.000_000_001) {
    throw new RangeError("Image crop transform is not invertible");
  }
  const target = {
    x: session.targetSize.width / 2 - (resolved.offset.x + delta.x),
    y: session.targetSize.height / 2 - (resolved.offset.y + delta.y),
  };
  const focalPoint = {
    x: (d * target.x - c * target.y) / determinant / session.sourceSize.width,
    y: (-b * target.x + a * target.y) / determinant / session.sourceSize.height,
  };
  return {
    ...session,
    current: canonicalCropPlacement(
      { ...session.current, focalPoint },
      session.sourceSize,
      session.targetSize,
    ),
  };
}

export function setImageCropZoom(
  session: ImageCropSession,
  zoom: number,
): ImageCropSession {
  if (!Number.isFinite(zoom)) {
    throw new RangeError("Image crop zoom must be finite");
  }
  return {
    ...session,
    current: canonicalCropPlacement(
      { ...session.current, zoom: clamp(zoom, 1, 64) },
      session.sourceSize,
      session.targetSize,
    ),
  };
}

export function resetImageCrop(session: ImageCropSession): ImageCropSession {
  return {
    ...session,
    current: canonicalCropPlacement(
      {
        mode: "crop",
        focalPoint: { x: 0.5, y: 0.5 },
        zoom: 1,
        rotation: 0,
        flipHorizontal: false,
        flipVertical: false,
      },
      session.sourceSize,
      session.targetSize,
    ),
  };
}

export function imageCropSourceTransform(session: ImageCropSession): Transform {
  const resolved = requireClipPlacement(session);
  const [a, b, c, d] = cropLinearTransform(resolved);
  return [a, b, c, d, resolved.offset.x, resolved.offset.y];
}

function canonicalCropPlacement(
  placement: ImageCropPlacement,
  sourceSize: Size,
  targetSize: Size,
): ImageCropPlacement {
  const resolved = resolveImagePlacement({
    placement: {
      ...placement,
      zoom: clamp(placement.zoom, 1, 64),
      rotation: normalizeRotation(placement.rotation),
    },
    sourceSize,
    targetSize,
  });
  if (resolved.mode !== "clip") {
    throw new Error("Crop placement did not resolve to clip geometry");
  }
  return {
    ...placement,
    focalPoint: structuredClone(resolved.effectiveFocalPoint),
    zoom: clamp(placement.zoom, 1, 64),
    rotation: resolved.rotation,
  };
}

function requireClipPlacement(
  session: ImageCropSession,
): Extract<ResolvedImagePlacement, { mode: "clip" }> {
  const resolved = resolveImagePlacement({
    placement: session.current,
    sourceSize: session.sourceSize,
    targetSize: session.targetSize,
  });
  if (resolved.mode !== "clip") {
    throw new Error("Image crop session requires clip placement");
  }
  return resolved;
}

function cropLinearTransform(
  placement: Extract<ResolvedImagePlacement, { mode: "clip" }>,
): readonly [number, number, number, number] {
  const radians = (placement.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    cosine * placement.scale.x,
    sine * placement.scale.x,
    -sine * placement.scale.y,
    cosine * placement.scale.y,
  ];
}

function constrainFocalPoint(
  requested: NormalizedPoint,
  sourceSize: Size,
  targetSize: Size,
  cosine: number,
  sine: number,
  scale: Point,
): NormalizedPoint {
  const sourceOffsets = [
    [-targetSize.width / 2, -targetSize.height / 2],
    [targetSize.width / 2, -targetSize.height / 2],
    [targetSize.width / 2, targetSize.height / 2],
    [-targetSize.width / 2, targetSize.height / 2],
  ].map(([x = 0, y = 0]) => ({
    x: (cosine * x + sine * y) / scale.x,
    y: (-sine * x + cosine * y) / scale.y,
  }));
  const xValues = sourceOffsets.map(({ x }) => x);
  const yValues = sourceOffsets.map(({ y }) => y);
  const minimumX = -Math.min(...xValues) / sourceSize.width;
  const maximumX = 1 - Math.max(...xValues) / sourceSize.width;
  const minimumY = -Math.min(...yValues) / sourceSize.height;
  const maximumY = 1 - Math.max(...yValues) / sourceSize.height;
  return {
    x: clamp(
      requested.x,
      Math.min(minimumX, maximumX),
      Math.max(minimumX, maximumX),
    ),
    y: clamp(
      requested.y,
      Math.min(minimumY, maximumY),
      Math.max(minimumY, maximumY),
    ),
  };
}

function assertPositiveSize(size: Size, name: string): void {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new RangeError(`${name} must have positive finite dimensions`);
  }
}

function assertPositivePixelSize(size: Size, name: string): void {
  assertPositiveSize(size, name);
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height)) {
    throw new RangeError(`${name} must have integer pixel dimensions`);
  }
}

function assertImageExpansionInsets(
  expansion: ImageExpansionInsets,
  targetSize: Size,
  requireMaterialExpansion: boolean,
): void {
  const values = [
    expansion.top,
    expansion.right,
    expansion.bottom,
    expansion.left,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError(
      "Image expansion insets must be finite and non-negative",
    );
  }
  if (
    expansion.left > targetSize.width * MAX_IMAGE_EXPANSION_PER_EDGE ||
    expansion.right > targetSize.width * MAX_IMAGE_EXPANSION_PER_EDGE ||
    expansion.top > targetSize.height * MAX_IMAGE_EXPANSION_PER_EDGE ||
    expansion.bottom > targetSize.height * MAX_IMAGE_EXPANSION_PER_EDGE
  ) {
    throw new RangeError(
      "Image expansion exceeds the supported per-edge limit",
    );
  }
  if (requireMaterialExpansion && imageExpansionIsEmpty(expansion)) {
    throw new RangeError("Image expansion must extend at least one edge");
  }
  const width = expansion.left + targetSize.width + expansion.right;
  const height = expansion.top + targetSize.height + expansion.bottom;
  const aspect = Math.max(width / height, height / width);
  if (aspect > MAX_IMAGE_EXPANSION_ASPECT_RATIO + 0.000_001) {
    throw new RangeError("Expanded image aspect ratio exceeds 3:1");
  }
}

function roundUpTo16(value: number): number {
  return Math.ceil(value / 16) * 16;
}

function normalizeRotation(value: number): number {
  const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function invertAffineTransform(transform: Transform): Transform {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 0.000_000_001) {
    throw new RangeError("Image source transform is not invertible");
  }
  return [
    canonicalZero(d / determinant),
    canonicalZero(-b / determinant),
    canonicalZero(-c / determinant),
    canonicalZero(a / determinant),
    canonicalZero((c * f - d * e) / determinant),
    canonicalZero((b * e - a * f) / determinant),
  ];
}

function canonicalZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function transformAffinePoint(transform: Transform, point: Point): Point {
  return {
    x: transform[0] * point.x + transform[2] * point.y + transform[4],
    y: transform[1] * point.x + transform[3] * point.y + transform[5],
  };
}

function downsamplePolygon(
  points: readonly Point[],
  maximum: number,
): readonly Point[] {
  if (points.length <= maximum) return points;
  return Array.from({ length: maximum }, (_, index) => {
    const sourceIndex = Math.min(
      points.length - 1,
      Math.floor((index * points.length) / maximum),
    );
    return points[sourceIndex]!;
  });
}

function deduplicateAdjacentPoints(
  points: readonly NormalizedPoint[],
): NormalizedPoint[] {
  const result: NormalizedPoint[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (
      previous &&
      Math.abs(previous.x - point.x) < 0.000_001 &&
      Math.abs(previous.y - point.y) < 0.000_001
    ) {
      continue;
    }
    result.push(point);
  }
  const first = result[0];
  const last = result.at(-1);
  if (
    first &&
    last &&
    result.length > 3 &&
    Math.abs(first.x - last.x) < 0.000_001 &&
    Math.abs(first.y - last.y) < 0.000_001
  ) {
    result.pop();
  }
  return result;
}

function polygonArea(points: readonly NormalizedPoint[]): number {
  let signed = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    signed += current.x * next.y - next.x * current.y;
  }
  return Math.abs(signed) / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
