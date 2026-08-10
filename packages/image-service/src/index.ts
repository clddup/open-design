import type {
  ImagePlacement,
  NormalizedPoint,
  Point,
  Size,
} from "@opendesign/design-contracts";

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
