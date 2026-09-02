import type { Rect, Transform } from "@opendesign/design-contracts";
import type {
  SnapAxis,
  SnapGuideLine,
  SnapTarget,
  SnapTargetIndex,
  SnapTargetSource,
} from "./snapping.js";

const EPSILON = 0.000_001;

export interface OrientedResizeFrame {
  bounds: Rect;
  transform: Transform;
}

export interface OrientedResizeMatch {
  axis: SnapAxis;
  source: SnapTargetSource | "pixel-grid";
  targetId: string;
  targetPosition: number;
}

export interface OrientedResizeResolution {
  lines: readonly SnapGuideLine[];
  matches: readonly OrientedResizeMatch[];
  scaleX: number;
  scaleY: number;
}

interface ResizeGeometry {
  derivativeX: Point;
  derivativeY: Point;
  point: Point;
}

interface TargetOption extends OrientedResizeMatch {
  delta: number;
  range?: { end: number; start: number };
}

interface ResizeCandidate {
  correctionX: number;
  correctionY: number;
  matches: readonly TargetOption[];
  movement: number;
}

interface Point {
  x: number;
  y: number;
}

export function resolveOrientedResizeSnapping(input: {
  aroundCenter: boolean;
  frame: OrientedResizeFrame;
  horizontal: "start" | "end" | null;
  lockRatio: boolean;
  pixelGrid: boolean;
  scaleX: number;
  scaleY: number;
  targets: SnapTargetIndex;
  threshold: number;
  vertical: "start" | "end" | null;
}): OrientedResizeResolution {
  const original = emptyResolution(input.scaleX, input.scaleY);
  if (!validInput(input) || (!input.horizontal && !input.vertical)) {
    return original;
  }
  const geometry = resizeGeometry(input);
  if (!geometry) return original;
  const options = {
    x: targetOptions("x", geometry.point.x, input),
    y: targetOptions("y", geometry.point.y, input),
  };
  const candidates = input.lockRatio
    ? ratioCandidates(input, geometry, options)
    : freeResizeCandidates(input, geometry, options);
  const selected = candidates.sort(compareCandidates)[0];
  if (!selected) return original;
  return candidateResolution(input, geometry, selected);
}

function resizeGeometry(input: {
  aroundCenter: boolean;
  frame: OrientedResizeFrame;
  horizontal: "start" | "end" | null;
  scaleX: number;
  scaleY: number;
  vertical: "start" | "end" | null;
}): ResizeGeometry | null {
  const { bounds, transform } = input.frame;
  const handle = resizeHandle(bounds, input.horizontal, input.vertical);
  const origin = resizeOrigin(
    bounds,
    input.horizontal,
    input.vertical,
    input.aroundCenter,
  );
  const derivativeX = transformVector(
    { x: handle.x - origin.x, y: 0 },
    transform,
  );
  const derivativeY = transformVector(
    { x: 0, y: handle.y - origin.y },
    transform,
  );
  const point = transformPoint(
    {
      x: origin.x + (handle.x - origin.x) * input.scaleX,
      y: origin.y + (handle.y - origin.y) * input.scaleY,
    },
    transform,
  );
  return finitePoints([derivativeX, derivativeY, point])
    ? { derivativeX, derivativeY, point }
    : null;
}

function ratioCandidates(
  input: { scaleX: number; scaleY: number; threshold: number },
  geometry: ResizeGeometry,
  options: Record<SnapAxis, readonly TargetOption[]>,
): ResizeCandidate[] {
  const derivative = add(geometry.derivativeX, geometry.derivativeY);
  return [...options.x, ...options.y].flatMap((option) => {
    const coefficient = derivative[option.axis];
    if (Math.abs(coefficient) <= EPSILON) return [];
    const correction = option.delta / coefficient;
    return validCandidate(
      input,
      correction,
      correction,
      Math.abs(correction) * magnitude(derivative),
      [option],
    );
  });
}

function freeResizeCandidates(
  input: {
    horizontal: "start" | "end" | null;
    scaleX: number;
    scaleY: number;
    threshold: number;
    vertical: "start" | "end" | null;
  },
  geometry: ResizeGeometry,
  options: Record<SnapAxis, readonly TargetOption[]>,
): ResizeCandidate[] {
  const candidates = singleTargetCandidates(input, geometry, options);
  if (!input.horizontal || !input.vertical) return candidates;
  return [...candidates, ...pairedTargetCandidates(input, geometry, options)];
}

function singleTargetCandidates(
  input: {
    horizontal: "start" | "end" | null;
    scaleX: number;
    scaleY: number;
    threshold: number;
    vertical: "start" | "end" | null;
  },
  geometry: ResizeGeometry,
  options: Record<SnapAxis, readonly TargetOption[]>,
): ResizeCandidate[] {
  const activeX = input.horizontal ? geometry.derivativeX : { x: 0, y: 0 };
  const activeY = input.vertical ? geometry.derivativeY : { x: 0, y: 0 };
  return [...options.x, ...options.y].flatMap((option) => {
    const coefficients = {
      x: activeX[option.axis],
      y: activeY[option.axis],
    };
    const denominator = coefficients.x ** 2 + coefficients.y ** 2;
    if (denominator <= EPSILON) return [];
    const correctionX = (option.delta * coefficients.x) / denominator;
    const correctionY = (option.delta * coefficients.y) / denominator;
    const movement = magnitude(
      add(scale(activeX, correctionX), scale(activeY, correctionY)),
    );
    return validCandidate(input, correctionX, correctionY, movement, [option]);
  });
}

function pairedTargetCandidates(
  input: { scaleX: number; scaleY: number; threshold: number },
  geometry: ResizeGeometry,
  options: Record<SnapAxis, readonly TargetOption[]>,
): ResizeCandidate[] {
  const determinant =
    geometry.derivativeX.x * geometry.derivativeY.y -
    geometry.derivativeY.x * geometry.derivativeX.y;
  if (Math.abs(determinant) <= EPSILON) return [];
  return options.x.flatMap((x) =>
    options.y.flatMap((y) => {
      const correctionX =
        (x.delta * geometry.derivativeY.y - geometry.derivativeY.x * y.delta) /
        determinant;
      const correctionY =
        (geometry.derivativeX.x * y.delta - x.delta * geometry.derivativeX.y) /
        determinant;
      return validCandidate(
        input,
        correctionX,
        correctionY,
        Math.hypot(x.delta, y.delta),
        [x, y],
      );
    }),
  );
}

function validCandidate(
  input: { scaleX: number; scaleY: number; threshold: number },
  correctionX: number,
  correctionY: number,
  movement: number,
  matches: readonly TargetOption[],
): ResizeCandidate[] {
  const scaleX = input.scaleX + correctionX;
  const scaleY = input.scaleY + correctionY;
  if (
    ![scaleX, scaleY, movement].every(Number.isFinite) ||
    scaleX <= 0 ||
    scaleY <= 0 ||
    movement > input.threshold + EPSILON
  ) {
    return [];
  }
  return [{ correctionX, correctionY, matches, movement }];
}

function targetOptions(
  axis: SnapAxis,
  position: number,
  input: {
    pixelGrid: boolean;
    targets: SnapTargetIndex;
    threshold: number;
  },
): TargetOption[] {
  const targets = nearbyTargets(input.targets[axis], position, input.threshold);
  if (targets.length > 0) {
    return targets.map((target) => targetOption(axis, position, target));
  }
  if (!input.pixelGrid) return [];
  const targetPosition = Math.round(position);
  const delta = targetPosition - position;
  return Math.abs(delta) <= input.threshold
    ? [
        {
          axis,
          delta,
          source: "pixel-grid",
          targetId: `pixel:${targetPosition}`,
          targetPosition,
        },
      ]
    : [];
}

function nearbyTargets(
  targets: readonly SnapTarget[],
  position: number,
  threshold: number,
): SnapTarget[] {
  return targets.filter(
    (target) => Math.abs(target.position - position) <= threshold,
  );
}

function targetOption(
  axis: SnapAxis,
  position: number,
  target: SnapTarget,
): TargetOption {
  return {
    axis,
    delta: target.position - position,
    range: target.range,
    source: target.source,
    targetId: target.id,
    targetPosition: target.position,
  };
}

function candidateResolution(
  input: { scaleX: number; scaleY: number },
  geometry: ResizeGeometry,
  candidate: ResizeCandidate,
): OrientedResizeResolution {
  const point = add(
    geometry.point,
    add(
      scale(geometry.derivativeX, candidate.correctionX),
      scale(geometry.derivativeY, candidate.correctionY),
    ),
  );
  return {
    lines: candidate.matches.flatMap((match) => guideLine(match, point)),
    matches: candidate.matches.map(
      ({ axis, source, targetId, targetPosition }) => ({
        axis,
        source,
        targetId,
        targetPosition,
      }),
    ),
    scaleX: input.scaleX + candidate.correctionX,
    scaleY: input.scaleY + candidate.correctionY,
  };
}

function guideLine(match: TargetOption, point: Point): SnapGuideLine[] {
  if (!match.range || match.source === "pixel-grid") return [];
  const crossPosition = match.axis === "x" ? point.y : point.x;
  return [
    {
      axis: match.axis,
      position: match.targetPosition,
      range: {
        start: Math.min(crossPosition, match.range.start),
        end: Math.max(crossPosition, match.range.end),
      },
      source: match.source,
    },
  ];
}

function compareCandidates(
  left: ResizeCandidate,
  right: ResizeCandidate,
): number {
  return (
    candidatePriority(left) - candidatePriority(right) ||
    right.matches.length - left.matches.length ||
    left.movement - right.movement ||
    candidateId(left).localeCompare(candidateId(right))
  );
}

function candidatePriority(candidate: ResizeCandidate): number {
  return candidate.matches.reduce(
    (total, match) => total + sourcePriority(match.source),
    0,
  );
}

function sourcePriority(source: OrientedResizeMatch["source"]): number {
  return source === "guide"
    ? 0
    : source === "geometry"
      ? 1
      : source === "object"
        ? 2
        : 3;
}

function candidateId(candidate: ResizeCandidate): string {
  return candidate.matches.map(({ targetId }) => targetId).join("|");
}

function resizeHandle(
  bounds: Rect,
  horizontal: "start" | "end" | null,
  vertical: "start" | "end" | null,
): Point {
  return {
    x: axisPosition(bounds.x, bounds.width, horizontal),
    y: axisPosition(bounds.y, bounds.height, vertical),
  };
}

function resizeOrigin(
  bounds: Rect,
  horizontal: "start" | "end" | null,
  vertical: "start" | "end" | null,
  aroundCenter: boolean,
): Point {
  return {
    x: originPosition(bounds.x, bounds.width, horizontal, aroundCenter),
    y: originPosition(bounds.y, bounds.height, vertical, aroundCenter),
  };
}

function axisPosition(
  start: number,
  size: number,
  edge: "start" | "end" | null,
): number {
  return edge === "start"
    ? start
    : edge === "end"
      ? start + size
      : start + size / 2;
}

function originPosition(
  start: number,
  size: number,
  edge: "start" | "end" | null,
  aroundCenter: boolean,
): number {
  if (aroundCenter || !edge) return start + size / 2;
  return edge === "start" ? start + size : start;
}

function transformPoint(point: Point, transform: Transform): Point {
  return {
    x: transform[0] * point.x + transform[2] * point.y + transform[4],
    y: transform[1] * point.x + transform[3] * point.y + transform[5],
  };
}

function transformVector(point: Point, transform: Transform): Point {
  return {
    x: transform[0] * point.x + transform[2] * point.y,
    y: transform[1] * point.x + transform[3] * point.y,
  };
}

function validInput(input: {
  frame: OrientedResizeFrame;
  scaleX: number;
  scaleY: number;
  threshold: number;
}): boolean {
  const values = [
    ...input.frame.transform,
    input.frame.bounds.x,
    input.frame.bounds.y,
    input.frame.bounds.width,
    input.frame.bounds.height,
    input.scaleX,
    input.scaleY,
    input.threshold,
  ];
  const [a, b, c, d] = input.frame.transform;
  return (
    values.every(Number.isFinite) &&
    input.frame.bounds.width > 0 &&
    input.frame.bounds.height > 0 &&
    input.scaleX > 0 &&
    input.scaleY > 0 &&
    input.threshold >= 0 &&
    Math.abs(a * d - b * c) > EPSILON
  );
}

function finitePoints(points: readonly Point[]): boolean {
  return points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
}

function emptyResolution(
  scaleX: number,
  scaleY: number,
): OrientedResizeResolution {
  return { lines: [], matches: [], scaleX, scaleY };
}

function add(left: Point, right: Point): Point {
  return { x: left.x + right.x, y: left.y + right.y };
}

function scale(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor };
}

function magnitude(point: Point): number {
  return Math.hypot(point.x, point.y);
}
