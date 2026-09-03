import type { Point, Rect } from "@opendesign/design-contracts";
import {
  nearestPointOnDirectedVectorCurve,
  type DirectedVectorCurve,
} from "./vector-segment-geometry.js";
import type { SnapAxis, SnapGuideLine } from "./snapping.js";

export interface VectorSnapPoint extends Point {
  excludedPathTargetIds?: readonly string[];
  id: string;
}

export interface VectorSnapPathTarget {
  bounds: Rect;
  curve: DirectedVectorCurve;
  id: string;
}

export interface VectorSnapTargetIndex {
  x: readonly VectorSnapPoint[];
  y: readonly VectorSnapPoint[];
}

export interface VectorAxisSnapMatch {
  axis: SnapAxis;
  delta: number;
  kind: "axis";
  movingPointId: string;
  source: "geometry" | "pixel-grid";
  targetPointId: string;
  targetPosition: number;
}

export interface VectorPathSnapMatch {
  delta: Point;
  distance: number;
  kind: "path";
  movingPointId: string;
  source: "geometry";
  t: number;
  targetPathId: string;
  targetPoint: Point;
}

export type VectorSnapMatch = VectorAxisSnapMatch | VectorPathSnapMatch;

export interface VectorSnapResolution {
  delta: Point;
  lines: readonly SnapGuideLine[];
  matches: readonly VectorSnapMatch[];
}

type ResolvedVectorAxis = VectorAxisSnapMatch & {
  movingPoint: VectorSnapPoint;
  targetPoint?: VectorSnapPoint;
};

export function createVectorSnapTargetIndex(
  points: readonly VectorSnapPoint[],
): VectorSnapTargetIndex {
  return {
    x: [...points].sort(pointComparator("x")),
    y: [...points].sort(pointComparator("y")),
  };
}

export function createVectorSnapPathTarget(
  id: string,
  curve: DirectedVectorCurve,
): VectorSnapPathTarget {
  const controlStart = add(curve.start, curve.tangentStart ?? { x: 0, y: 0 });
  const controlEnd = add(curve.end, curve.tangentEnd ?? { x: 0, y: 0 });
  const points = [curve.start, controlStart, controlEnd, curve.end];
  const x = points.map((point) => point.x);
  const y = points.map((point) => point.y);
  const minimumX = Math.min(...x);
  const minimumY = Math.min(...y);
  return {
    bounds: {
      height: Math.max(...y) - minimumY,
      width: Math.max(...x) - minimumX,
      x: minimumX,
      y: minimumY,
    },
    curve,
    id,
  };
}

export function resolveVectorPointSnapping(input: {
  movingPoints: readonly VectorSnapPoint[];
  paths?: readonly VectorSnapPathTarget[];
  pixelGrid: boolean;
  rawDelta: Point;
  targets: VectorSnapTargetIndex;
  threshold: number;
}): VectorSnapResolution {
  const x = resolveVectorAxis("x", input);
  const y = resolveVectorAxis("y", input);
  const matches = [x, y].flatMap((match) => (match ? [match] : []));
  if (!matches.some(({ source }) => source === "geometry")) {
    const path = resolveVectorPath(input);
    if (path) {
      return {
        delta: add(input.rawDelta, path.delta),
        lines: [
          {
            kind: "point",
            position: path.targetPoint,
            radius: Math.max(input.threshold * 0.6, 0.000_001),
            source: "geometry",
          },
        ],
        matches: [path],
      };
    }
  }
  const delta = {
    x: input.rawDelta.x + (x?.delta ?? 0),
    y: input.rawDelta.y + (y?.delta ?? 0),
  };
  return {
    delta,
    lines: matches.flatMap((match) => {
      const line = vectorGuideLine(match, delta, input.threshold);
      return line ? [line] : [];
    }),
    matches: matches.map(
      ({
        axis,
        delta: snapDelta,
        kind,
        movingPointId,
        source,
        targetPointId,
        targetPosition,
      }) => ({
        axis,
        delta: snapDelta,
        kind,
        movingPointId,
        source,
        targetPointId,
        targetPosition,
      }),
    ),
  };
}

function resolveVectorAxis(
  axis: SnapAxis,
  input: {
    movingPoints: readonly VectorSnapPoint[];
    pixelGrid: boolean;
    rawDelta: Point;
    targets: VectorSnapTargetIndex;
    threshold: number;
  },
): ResolvedVectorAxis | undefined {
  const rawAxisDelta = input.rawDelta[axis];
  const geometryMatch = input.movingPoints
    .flatMap((movingPoint) => {
      const position = movingPoint[axis] + rawAxisDelta;
      return nearbyVectorPoints(
        input.targets[axis],
        axis,
        position,
        input.threshold,
      ).map((targetPoint) => ({
        axis,
        delta: targetPoint[axis] - position,
        kind: "axis" as const,
        movingPoint,
        movingPointId: movingPoint.id,
        source: "geometry" as const,
        targetPoint,
        targetPointId: targetPoint.id,
        targetPosition: targetPoint[axis],
      }));
    })
    .sort(compareVectorMatches)[0];
  if (geometryMatch) return geometryMatch;
  if (!input.pixelGrid) return undefined;
  return resolveVectorPixelAxis(axis, input);
}

function resolveVectorPixelAxis(
  axis: SnapAxis,
  input: {
    movingPoints: readonly VectorSnapPoint[];
    rawDelta: Point;
    threshold: number;
  },
): ResolvedVectorAxis | undefined {
  return input.movingPoints
    .map((movingPoint) => {
      const position = movingPoint[axis] + input.rawDelta[axis];
      const targetPosition = Math.round(position);
      return {
        axis,
        delta: targetPosition - position,
        kind: "axis" as const,
        movingPoint,
        movingPointId: movingPoint.id,
        source: "pixel-grid" as const,
        targetPointId: `pixel:${targetPosition}`,
        targetPosition,
      };
    })
    .filter(({ delta }) => Math.abs(delta) <= input.threshold)
    .sort(compareVectorMatches)[0];
}

function resolveVectorPath(input: {
  movingPoints: readonly VectorSnapPoint[];
  paths?: readonly VectorSnapPathTarget[];
  rawDelta: Point;
  threshold: number;
}): VectorPathSnapMatch | undefined {
  return input.movingPoints
    .flatMap((movingPoint) => {
      const point = add(movingPoint, input.rawDelta);
      const excluded = new Set(movingPoint.excludedPathTargetIds ?? []);
      return (input.paths ?? []).flatMap((target) => {
        if (
          excluded.has(target.id) ||
          !pointWithinBounds(point, target.bounds, input.threshold)
        ) {
          return [];
        }
        const hit = nearestPointOnDirectedVectorCurve(target.curve, point);
        return hit.distance <= input.threshold
          ? [
              {
                delta: subtract(hit.point, point),
                distance: hit.distance,
                kind: "path" as const,
                movingPointId: movingPoint.id,
                source: "geometry" as const,
                t: hit.t,
                targetPathId: target.id,
                targetPoint: hit.point,
              },
            ]
          : [];
      });
    })
    .sort(comparePathMatches)[0];
}

function pointWithinBounds(point: Point, bounds: Rect, threshold: number) {
  return (
    point.x >= bounds.x - threshold &&
    point.x <= bounds.x + bounds.width + threshold &&
    point.y >= bounds.y - threshold &&
    point.y <= bounds.y + bounds.height + threshold
  );
}

function comparePathMatches(
  left: VectorPathSnapMatch,
  right: VectorPathSnapMatch,
): number {
  return (
    left.distance - right.distance ||
    left.movingPointId.localeCompare(right.movingPointId) ||
    left.targetPathId.localeCompare(right.targetPathId) ||
    left.t - right.t
  );
}

function nearbyVectorPoints(
  points: readonly VectorSnapPoint[],
  axis: SnapAxis,
  position: number,
  threshold: number,
): readonly VectorSnapPoint[] {
  const minimum = position - threshold;
  const maximum = position + threshold;
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle]![axis] < minimum) low = middle + 1;
    else high = middle;
  }
  const matches: VectorSnapPoint[] = [];
  for (let index = low; index < points.length; index += 1) {
    const point = points[index]!;
    if (point[axis] > maximum) break;
    matches.push(point);
  }
  return matches;
}

function vectorGuideLine(
  match: ResolvedVectorAxis,
  delta: Point,
  threshold: number,
): SnapGuideLine | null {
  if (!match.targetPoint) return null;
  const crossAxis = match.axis === "x" ? "y" : "x";
  const movingPosition = match.movingPoint[crossAxis] + delta[crossAxis];
  const targetPosition = match.targetPoint[crossAxis];
  const range = visibleGuideRange(movingPosition, targetPosition, threshold);
  return {
    axis: match.axis,
    position: match.targetPosition,
    range,
    source: "geometry",
  };
}

function visibleGuideRange(
  movingPosition: number,
  targetPosition: number,
  threshold: number,
): { end: number; start: number } {
  const start = Math.min(movingPosition, targetPosition);
  const end = Math.max(movingPosition, targetPosition);
  return end - start > 0.000_001
    ? { start, end }
    : { start: start - threshold, end: end + threshold };
}

function compareVectorMatches(
  left: ResolvedVectorAxis,
  right: ResolvedVectorAxis,
): number {
  return (
    Math.abs(left.delta) - Math.abs(right.delta) ||
    left.movingPointId.localeCompare(right.movingPointId) ||
    left.targetPointId.localeCompare(right.targetPointId) ||
    left.targetPosition - right.targetPosition
  );
}

function pointComparator(axis: SnapAxis) {
  return (left: VectorSnapPoint, right: VectorSnapPoint) =>
    left[axis] - right[axis] || left.id.localeCompare(right.id);
}

function add(left: Point, right: Point): Point {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}
