import type { Point, Rect, Transform } from "@opendesign/design-contracts";

export type VectorResizeHandle =
  | "north-west"
  | "north"
  | "north-east"
  | "east"
  | "south-east"
  | "south"
  | "south-west"
  | "west";

const MIN_AXIS = 0.000_001;

export function pointInPolygon(
  point: Point,
  polygon: readonly Point[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const current = polygon[index]!;
    const prior = polygon[previous]!;
    if (pointOnSegment(point, prior, current)) return true;
    const crosses =
      current.y > point.y !== prior.y > point.y &&
      point.x <
        ((prior.x - current.x) * (point.y - current.y)) /
          (prior.y - current.y) +
          current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function vectorSelectionResizeTransform(
  bounds: Rect,
  handle: VectorResizeHandle,
  point: Point,
  options: { fromCenter: boolean; proportional: boolean },
): Transform {
  const west = handle.includes("west");
  const east = handle.includes("east");
  const north = handle.includes("north");
  const south = handle.includes("south");
  const horizontal = west || east;
  const vertical = north || south;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const horizontalAnchor = options.fromCenter
    ? centerX
    : west
      ? bounds.x + bounds.width
      : bounds.x;
  const verticalAnchor = options.fromCenter
    ? centerY
    : north
      ? bounds.y + bounds.height
      : bounds.y;
  const sourceX = west ? bounds.x : bounds.x + bounds.width;
  const sourceY = north ? bounds.y : bounds.y + bounds.height;
  let scaleX =
    horizontal && Math.abs(sourceX - horizontalAnchor) > MIN_AXIS
      ? (point.x - horizontalAnchor) / (sourceX - horizontalAnchor)
      : 1;
  let scaleY =
    vertical && Math.abs(sourceY - verticalAnchor) > MIN_AXIS
      ? (point.y - verticalAnchor) / (sourceY - verticalAnchor)
      : 1;

  if (options.proportional) {
    const candidate =
      horizontal && vertical
        ? Math.abs(scaleX - 1) >= Math.abs(scaleY - 1)
          ? scaleX
          : scaleY
        : horizontal
          ? scaleX
          : scaleY;
    scaleX = candidate;
    scaleY = candidate;
  }

  const anchorX = horizontal ? horizontalAnchor : centerX;
  const anchorY = vertical ? verticalAnchor : centerY;
  return [
    scaleX,
    0,
    0,
    scaleY,
    cleanZero(anchorX * (1 - scaleX)),
    cleanZero(anchorY * (1 - scaleY)),
  ];
}

export function vectorSelectionRotationTransform(
  bounds: Rect,
  start: Point,
  current: Point,
  snapToFifteenDegrees: boolean,
): Transform {
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const currentAngle = Math.atan2(current.y - center.y, current.x - center.x);
  let angle = currentAngle - startAngle;
  if (snapToFifteenDegrees) {
    const step = Math.PI / 12;
    angle = Math.round(angle / step) * step;
  }
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    cosine,
    sine,
    -sine,
    cosine,
    center.x - cosine * center.x + sine * center.y,
    center.y - sine * center.x - cosine * center.y,
  ];
}

export function vectorLassoPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  return `${points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${format(point.x)} ${format(point.y)}`,
    )
    .join(" ")} Z`;
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared <= MIN_AXIS ** 2) {
    return Math.hypot(point.x - start.x, point.y - start.y) <= MIN_AXIS;
  }
  const cross =
    (point.x - start.x) * (end.y - start.y) -
    (point.y - start.y) * (end.x - start.x);
  if (Math.abs(cross) > MIN_AXIS) return false;
  const dot =
    (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y);
  if (dot < -MIN_AXIS) return false;
  return dot <= lengthSquared + MIN_AXIS;
}

function cleanZero(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

function format(value: number): string {
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  return Number(normalized.toFixed(6)).toString();
}
