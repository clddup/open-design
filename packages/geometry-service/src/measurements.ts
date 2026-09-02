import type { Point, Rect } from "@opendesign/design-contracts";

const EPSILON = 0.000_001;

export type DistanceMeasurementId =
  | "x-before"
  | "x-after"
  | "y-before"
  | "y-after"
  | `${"x" | "y"}-${"before" | "after"}:${string}`
  | `vector-${"x" | "y"}:${string}`;

export interface DistanceMeasurementSegment {
  axis: "x" | "y";
  end: Point;
  id: DistanceMeasurementId;
  start: Point;
  value: number;
}

/**
 * Measures axis-aligned object bounds using the same edge-to-edge semantics
 * exposed by Figma's canvas measurement guides.
 */
export function measureRectDistances(
  selection: Rect,
  target: Rect,
): readonly DistanceMeasurementSegment[] {
  if (!validRect(selection) || !validRect(target)) return [];
  if (contains(target, selection)) return containedDistances(selection, target);
  if (contains(selection, target)) return containedDistances(target, selection);

  const measurements: DistanceMeasurementSegment[] = [];
  const x = separatedAxisDistance("x", selection, target);
  const y = separatedAxisDistance("y", selection, target);
  if (x) measurements.push(x);
  if (y) measurements.push(y);
  return measurements;
}

/**
 * Measures from an axis-aligned ruler guide to the nearest edges of one
 * axis-aligned object bound. A guide inside the bound exposes both insets.
 */
export function measureGuideToRect(input: {
  axis: "x" | "y";
  crossPosition?: number;
  id: string;
  position: number;
  target: Rect;
}): readonly DistanceMeasurementSegment[] {
  if (!validRect(input.target) || !Number.isFinite(input.position)) return [];
  const targetStart = axisStart(input.axis, input.target);
  const targetEnd = targetStart + axisSize(input.axis, input.target);
  const defaultCross =
    axisStart(input.axis === "x" ? "y" : "x", input.target) +
    axisSize(input.axis === "x" ? "y" : "x", input.target) / 2;
  const cross = Number.isFinite(input.crossPosition)
    ? input.crossPosition!
    : defaultCross;
  if (input.position <= targetStart + EPSILON) {
    return compactSegments([
      guideSegment(input, "after", input.position, targetStart, cross),
    ]);
  }
  if (input.position >= targetEnd - EPSILON) {
    return compactSegments([
      guideSegment(input, "before", input.position, targetEnd, cross),
    ]);
  }
  return compactSegments([
    guideSegment(input, "before", input.position, targetStart, cross),
    guideSegment(input, "after", input.position, targetEnd, cross),
  ]);
}

/** Measures the horizontal and vertical deltas between two Vector anchors. */
export function measureVectorAnchorDistances(input: {
  source: Point;
  sourceId: string;
  target: Point;
  targetId: string;
}): readonly DistanceMeasurementSegment[] {
  if (!validPoint(input.source) || !validPoint(input.target)) return [];
  const corner = { x: input.target.x, y: input.source.y };
  const identity = `${input.sourceId}:${input.targetId}`;
  return compactSegments([
    segment("x", `vector-x:${identity}`, input.source, corner),
    segment("y", `vector-y:${identity}`, corner, input.target),
  ]);
}

export function formatDistanceMeasurement(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function containedDistances(inner: Rect, outer: Rect) {
  const centerX = inner.x + inner.width / 2;
  const centerY = inner.y + inner.height / 2;
  return [
    segment(
      "x",
      "x-before",
      { x: inner.x, y: centerY },
      { x: outer.x, y: centerY },
    ),
    segment(
      "x",
      "x-after",
      { x: inner.x + inner.width, y: centerY },
      { x: outer.x + outer.width, y: centerY },
    ),
    segment(
      "y",
      "y-before",
      { x: centerX, y: inner.y },
      { x: centerX, y: outer.y },
    ),
    segment(
      "y",
      "y-after",
      { x: centerX, y: inner.y + inner.height },
      { x: centerX, y: outer.y + outer.height },
    ),
  ].filter((item): item is DistanceMeasurementSegment => item !== null);
}

function separatedAxisDistance(
  axis: "x" | "y",
  selection: Rect,
  target: Rect,
): DistanceMeasurementSegment | null {
  const start = axisStart(axis, selection);
  const end = start + axisSize(axis, selection);
  const targetStart = axisStart(axis, target);
  const targetEnd = targetStart + axisSize(axis, target);
  const cross = crossAxisAnchor(axis, selection, target);
  if (end <= targetStart + EPSILON) {
    return axisSegment(axis, "after", end, targetStart, cross);
  }
  if (targetEnd <= start + EPSILON) {
    return axisSegment(axis, "before", start, targetEnd, cross);
  }
  return null;
}

function axisSegment(
  axis: "x" | "y",
  side: "before" | "after",
  start: number,
  end: number,
  cross: number,
): DistanceMeasurementSegment | null {
  return segment(
    axis,
    `${axis}-${side}`,
    axis === "x" ? { x: start, y: cross } : { x: cross, y: start },
    axis === "x" ? { x: end, y: cross } : { x: cross, y: end },
  );
}

function segment(
  axis: "x" | "y",
  id: DistanceMeasurementId,
  start: Point,
  end: Point,
): DistanceMeasurementSegment | null {
  const value = Math.abs(axis === "x" ? end.x - start.x : end.y - start.y);
  return value <= EPSILON ? null : { axis, end, id, start, value };
}

function guideSegment(
  input: { axis: "x" | "y"; id: string },
  side: "before" | "after",
  guidePosition: number,
  targetPosition: number,
  cross: number,
): DistanceMeasurementSegment | null {
  return segment(
    input.axis,
    `${input.axis}-${side}:${input.id}`,
    input.axis === "x"
      ? { x: guidePosition, y: cross }
      : { x: cross, y: guidePosition },
    input.axis === "x"
      ? { x: targetPosition, y: cross }
      : { x: cross, y: targetPosition },
  );
}

function compactSegments(
  segments: readonly (DistanceMeasurementSegment | null)[],
): DistanceMeasurementSegment[] {
  return segments.filter(
    (segment): segment is DistanceMeasurementSegment => segment !== null,
  );
}

function crossAxisAnchor(axis: "x" | "y", left: Rect, right: Rect): number {
  const leftStart = axisStart(axis === "x" ? "y" : "x", left);
  const leftEnd = leftStart + axisSize(axis === "x" ? "y" : "x", left);
  const rightStart = axisStart(axis === "x" ? "y" : "x", right);
  const rightEnd = rightStart + axisSize(axis === "x" ? "y" : "x", right);
  const overlapStart = Math.max(leftStart, rightStart);
  const overlapEnd = Math.min(leftEnd, rightEnd);
  if (overlapEnd >= overlapStart) return (overlapStart + overlapEnd) / 2;
  return leftEnd < rightStart
    ? (leftEnd + rightStart) / 2
    : (rightEnd + leftStart) / 2;
}

function axisStart(axis: "x" | "y", rect: Rect): number {
  return axis === "x" ? rect.x : rect.y;
}

function axisSize(axis: "x" | "y", rect: Rect): number {
  return axis === "x" ? rect.width : rect.height;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x + EPSILON &&
    outer.y <= inner.y + EPSILON &&
    outer.x + outer.width >= inner.x + inner.width - EPSILON &&
    outer.y + outer.height >= inner.y + inner.height - EPSILON
  );
}

function validRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function validPoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
