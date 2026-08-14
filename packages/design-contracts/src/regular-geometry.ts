import type { NormalizedPoint, Point, Rect, Size } from "./index.js";

export function resolveLineEndpointPoint(
  size: Size,
  endpoint: NormalizedPoint,
): Point {
  return { x: size.width * endpoint.x, y: size.height * endpoint.y };
}

export function normalizeLineEndpoints(
  start: Point,
  end: Point,
): {
  bounds: Rect;
  start: NormalizedPoint;
  end: NormalizedPoint;
} {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  const normalize = (point: Point): NormalizedPoint => ({
    x: width === 0 ? 0.5 : (point.x - x) / width,
    y: height === 0 ? 0.5 : (point.y - y) / height,
  });
  return {
    bounds: { x, y, width, height },
    start: normalize(start),
    end: normalize(end),
  };
}

export function resolveRegularPolygonPoints(
  size: Size,
  pointCount: number,
): Point[] {
  assertRegularPointCount(pointCount);
  const centerX = size.width / 2;
  const centerY = size.height / 2;
  return Array.from({ length: pointCount }, (_, index) => {
    const angle = (index * Math.PI * 2) / pointCount - Math.PI / 2;
    return {
      x: centerX + centerX * Math.cos(angle),
      y: centerY + centerY * Math.sin(angle),
    };
  });
}

export function resolveStarPoints(
  size: Size,
  pointCount: number,
  innerRadius: number,
): Point[] {
  assertRegularPointCount(pointCount);
  if (!Number.isFinite(innerRadius) || innerRadius < 0 || innerRadius > 1) {
    throw new RangeError("Star innerRadius must be between 0 and 1");
  }
  const centerX = size.width / 2;
  const centerY = size.height / 2;
  return Array.from({ length: pointCount * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? 1 : innerRadius;
    const angle = (index * Math.PI) / pointCount - Math.PI / 2;
    return {
      x: centerX + centerX * radius * Math.cos(angle),
      y: centerY + centerY * radius * Math.sin(angle),
    };
  });
}

function assertRegularPointCount(pointCount: number): void {
  if (!Number.isInteger(pointCount) || pointCount < 3 || pointCount > 60) {
    throw new RangeError("Polygon and Star pointCount must be from 3 to 60");
  }
}
