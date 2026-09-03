import type { Point, VectorVertex } from "@opendesign/design-contracts";

const EPSILON = 1e-7;
const GAUSS_ABSCISSAE = [
  0.0950125098376374, 0.281603550779259, 0.458016777657227, 0.617876244402644,
  0.755404408355003, 0.865631202387832, 0.944575023073233, 0.98940093499165,
] as const;
const GAUSS_WEIGHTS = [
  0.189450610455068, 0.182603415044924, 0.169156519395003, 0.149595988816577,
  0.124628971255534, 0.095158511682493, 0.062253523938648, 0.027152459411754,
] as const;

export type StrokeTraversalSegment = {
  controlEnd?: Point;
  controlStart?: Point;
  end: VectorVertex;
  start: VectorVertex;
};

export function vectorCurveLength(
  segment: StrokeTraversalSegment,
  start = 0,
  end = 1,
): number {
  if (!segment.controlStart && !segment.controlEnd) {
    return distance(segment.start, segment.end) * (end - start);
  }
  const middle = (start + end) / 2;
  const half = (end - start) / 2;
  let sum = 0;
  for (let index = 0; index < GAUSS_ABSCISSAE.length; index += 1) {
    const offset = half * GAUSS_ABSCISSAE[index]!;
    sum +=
      GAUSS_WEIGHTS[index]! *
      (magnitude(vectorCurveDerivative(segment, middle - offset)) +
        magnitude(vectorCurveDerivative(segment, middle + offset)));
  }
  return half * sum;
}

export function vectorCurveParameterAtLength(
  segment: StrokeTraversalSegment,
  start: number,
  targetLength: number,
): number {
  let low = start;
  let high = 1;
  for (let index = 0; index < 28; index += 1) {
    const middle = (low + high) / 2;
    if (vectorCurveLength(segment, start, middle) < targetLength) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function vectorCurvePoint(
  segment: StrokeTraversalSegment,
  parameter: number,
): Point {
  if (!segment.controlStart && !segment.controlEnd) {
    return add(
      segment.start,
      scale(subtract(segment.end, segment.start), parameter),
    );
  }
  const start = segment.start;
  const controlStart = segment.controlStart ?? start;
  const controlEnd = segment.controlEnd ?? segment.end;
  const end = segment.end;
  const inverse = 1 - parameter;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * parameter * controlStart.x +
      3 * inverse * parameter ** 2 * controlEnd.x +
      parameter ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * parameter * controlStart.y +
      3 * inverse * parameter ** 2 * controlEnd.y +
      parameter ** 3 * end.y,
  };
}

export function vectorCurveDerivative(
  segment: StrokeTraversalSegment,
  parameter: number,
): Point {
  if (!segment.controlStart && !segment.controlEnd) {
    return subtract(segment.end, segment.start);
  }
  const start = segment.start;
  const controlStart = segment.controlStart ?? start;
  const controlEnd = segment.controlEnd ?? segment.end;
  const end = segment.end;
  const inverse = 1 - parameter;
  return {
    x:
      3 * inverse ** 2 * (controlStart.x - start.x) +
      6 * inverse * parameter * (controlEnd.x - controlStart.x) +
      3 * parameter ** 2 * (end.x - controlEnd.x),
    y:
      3 * inverse ** 2 * (controlStart.y - start.y) +
      6 * inverse * parameter * (controlEnd.y - controlStart.y) +
      3 * parameter ** 2 * (end.y - controlEnd.y),
  };
}

export function vectorSubcurve(
  segment: StrokeTraversalSegment,
  start: number,
  end: number,
): StrokeTraversalSegment {
  const startPoint = vectorCurvePoint(segment, start);
  const endPoint = vectorCurvePoint(segment, end);
  const factor = (end - start) / 3;
  const startDerivative = vectorCurveDerivative(segment, start);
  const endDerivative = vectorCurveDerivative(segment, end);
  const hasCurve = !!segment.controlStart || !!segment.controlEnd;
  return {
    start: endpointVertex(segment.start, startPoint, start <= EPSILON, "start"),
    end: endpointVertex(segment.end, endPoint, end >= 1 - EPSILON, "end"),
    ...(hasCurve
      ? {
          controlStart: add(startPoint, scale(startDerivative, factor)),
          controlEnd: subtract(endPoint, scale(endDerivative, factor)),
        }
      : {}),
  };
}

function endpointVertex(
  authored: VectorVertex,
  point: Point,
  preserve: boolean,
  role: string,
): VectorVertex {
  return preserve
    ? authored
    : { id: `${authored.id}.__curve_${role}_${point.x}_${point.y}`, ...point };
}

function add(left: Point, right: Point): Point {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scale(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor };
}

function magnitude(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
