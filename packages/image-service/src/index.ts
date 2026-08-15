import type {
  ImagePlacement,
  NormalizedPoint,
  Point,
  Size,
  Transform,
} from "@opendesign/design-contracts";

export const IMAGE_SERVICE_CONTRACT_VERSION = 2 as const;

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

function normalizeRotation(value: number): number {
  const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
