import type {
  Point,
  Rect,
  Transform,
  VectorNetwork,
} from "@opendesign/design-contracts";
import { transformPoint } from "./scene-node-transform.js";

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

export interface VectorDocumentSelectionTarget {
  network: VectorNetwork;
  vertexIds: readonly string[];
  worldTransform: Transform;
}

export function vectorDocumentSelectionBounds(
  targets: readonly VectorDocumentSelectionTarget[],
): Rect | null {
  const points: Point[] = [];
  for (const target of targets) {
    const selected = new Set(target.vertexIds);
    if (selected.size !== target.vertexIds.length || selected.size === 0) {
      return null;
    }
    const vertices = target.network.vertices.filter((vertex) =>
      selected.has(vertex.id),
    );
    if (vertices.length !== selected.size) return null;
    points.push(
      ...vertices.map((vertex) =>
        transformPoint(vertex, target.worldTransform),
      ),
    );
  }
  if (
    points.length < 2 ||
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    return null;
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function translateVectorSelectionTransform(
  transform: Transform,
  offset: Point,
): Transform {
  const [a, b, c, d, e, f] = transform;
  return [a, b, c, d, e + offset.x, f + offset.y];
}

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

export function vectorSegmentsInPolygon(
  network: VectorNetwork,
  polygon: readonly Point[],
  tolerance: number,
): string[] {
  if (polygon.length < 3 || !Number.isFinite(tolerance) || tolerance <= 0) {
    return [];
  }
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  return network.segments
    .filter((segment) => {
      const start = vertices.get(segment.startVertexId);
      const end = vertices.get(segment.endVertexId);
      if (!start || !end) return false;
      const controlStart = segment.tangentStart
        ? add(start, segment.tangentStart)
        : start;
      const controlEnd = segment.tangentEnd
        ? add(end, segment.tangentEnd)
        : end;
      const points = flattenCubic(
        start,
        controlStart,
        controlEnd,
        end,
        tolerance,
      );
      return (
        points.every((point) => pointInPolygon(point, polygon)) &&
        !polylineCrossesPolygon(points, polygon)
      );
    })
    .map((segment) => segment.id);
}

export function vectorSegmentSelectionPath(
  network: VectorNetwork,
  segmentIds: readonly string[],
): string {
  const selected = new Set(segmentIds);
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  return network.segments
    .filter((segment) => selected.has(segment.id))
    .flatMap((segment) => {
      const start = vertices.get(segment.startVertexId);
      const end = vertices.get(segment.endVertexId);
      if (!start || !end) return [];
      const controlStart = segment.tangentStart
        ? add(start, segment.tangentStart)
        : start;
      const controlEnd = segment.tangentEnd
        ? add(end, segment.tangentEnd)
        : end;
      const curved = segment.tangentStart || segment.tangentEnd;
      return [
        curved
          ? `M ${format(start.x)} ${format(start.y)} C ${format(controlStart.x)} ${format(controlStart.y)} ${format(controlEnd.x)} ${format(controlEnd.y)} ${format(end.x)} ${format(end.y)}`
          : `M ${format(start.x)} ${format(start.y)} L ${format(end.x)} ${format(end.y)}`,
      ];
    })
    .join(" ");
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

function add(left: Point, right: Point): Point {
  return { x: left.x + right.x, y: left.y + right.y };
}

function flattenCubic(
  start: Point,
  controlStart: Point,
  controlEnd: Point,
  end: Point,
  tolerance: number,
  depth = 0,
): Point[] {
  if (
    depth >= 10 ||
    Math.max(
      pointLineDistance(controlStart, start, end),
      pointLineDistance(controlEnd, start, end),
    ) <= tolerance
  ) {
    return [start, end];
  }
  const a = midpoint(start, controlStart);
  const b = midpoint(controlStart, controlEnd);
  const c = midpoint(controlEnd, end);
  const d = midpoint(a, b);
  const e = midpoint(b, c);
  const center = midpoint(d, e);
  const left = flattenCubic(start, a, d, center, tolerance, depth + 1);
  const right = flattenCubic(center, e, c, end, tolerance, depth + 1);
  return [...left.slice(0, -1), ...right];
}

function pointLineDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= MIN_AXIS)
    return Math.hypot(point.x - start.x, point.y - start.y);
  return (
    Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) /
    length
  );
}

function midpoint(left: Point, right: Point): Point {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function polylineCrossesPolygon(
  line: readonly Point[],
  polygon: readonly Point[],
): boolean {
  for (let lineIndex = 1; lineIndex < line.length; lineIndex += 1) {
    const lineStart = line[lineIndex - 1]!;
    const lineEnd = line[lineIndex]!;
    for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
      const edgeStart = polygon[edgeIndex]!;
      const edgeEnd = polygon[(edgeIndex + 1) % polygon.length]!;
      if (segmentsProperlyCross(lineStart, lineEnd, edgeStart, edgeEnd)) {
        return true;
      }
    }
  }
  return false;
}

function segmentsProperlyCross(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -MIN_AXIS && cdA * cdB < -MIN_AXIS;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function format(value: number): string {
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  return Number(normalized.toFixed(6)).toString();
}
