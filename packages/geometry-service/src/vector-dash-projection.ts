import type { Point, VectorVertex } from "@opendesign/design-contracts";

const EPSILON = 1e-7;
const MAX_DASH_FRAGMENTS = 16_384;
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

export type DashBoundary = "dash" | "path" | "segment";

export type DashedStrokeFragment = StrokeTraversalSegment & {
  endBoundary: DashBoundary;
  sourceSegmentIndex: number;
  startBoundary: DashBoundary;
};

export type DashProjectionResult =
  | { ok: true; fragments: DashedStrokeFragment[] }
  | { ok: false; message: string };

export function projectDashedStrokeFragments(
  segments: readonly StrokeTraversalSegment[],
  dashPattern: readonly number[],
): DashProjectionResult {
  const pattern = normalizedDashPattern(dashPattern);
  if (!pattern) {
    return {
      ok: false,
      message: "Vector dash pattern must contain finite positive lengths",
    };
  }
  const cursor = new DashCursor(pattern);
  const fragments: DashedStrokeFragment[] = [];
  for (const [index, segment] of segments.entries()) {
    const result = dashSegment(segment, index, segments.length, cursor);
    if (!result.ok) return result;
    fragments.push(...result.fragments);
    if (fragments.length > MAX_DASH_FRAGMENTS) {
      return { ok: false, message: "Vector dash projection is too complex" };
    }
  }
  return fragments.length > 0
    ? { ok: true, fragments }
    : { ok: false, message: "Vector dash projection is empty" };
}

class DashCursor {
  #index = 0;
  #remaining: number;
  readonly pattern: readonly number[];

  constructor(pattern: readonly number[]) {
    this.pattern = pattern;
    this.#remaining = pattern[0]!;
  }

  get on(): boolean {
    return this.#index % 2 === 0;
  }

  get remaining(): number {
    return this.#remaining;
  }

  consume(length: number): boolean {
    this.#remaining -= length;
    if (this.#remaining > EPSILON) return false;
    this.#index = (this.#index + 1) % this.pattern.length;
    this.#remaining = this.pattern[this.#index]!;
    return true;
  }
}

function normalizedDashPattern(pattern: readonly number[]): number[] | null {
  if (
    pattern.length === 0 ||
    pattern.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    return null;
  }
  return pattern.length % 2 === 0 ? [...pattern] : [...pattern, ...pattern];
}

function dashSegment(
  segment: StrokeTraversalSegment,
  segmentIndex: number,
  segmentCount: number,
  cursor: DashCursor,
): DashProjectionResult {
  const length = curveLength(segment, 0, 1);
  if (length <= EPSILON) return { ok: true, fragments: [] };
  const fragments: DashedStrokeFragment[] = [];
  let traversed = 0;
  let startParameter = 0;
  let startsAtDashBoundary = false;
  while (length - traversed > EPSILON) {
    const step = Math.min(length - traversed, cursor.remaining);
    const endsDash = cursor.remaining - step <= EPSILON;
    const endsSegment = length - traversed - step <= EPSILON;
    const endParameter = endsSegment
      ? 1
      : parameterAtLength(segment, startParameter, step);
    if (cursor.on && step > EPSILON) {
      fragments.push(
        createFragment(segment, {
          endBoundary: endsDash
            ? "dash"
            : segmentIndex === segmentCount - 1
              ? "path"
              : "segment",
          endParameter,
          sourceSegmentIndex: segmentIndex,
          startBoundary: boundaryAtStart(
            startParameter,
            segmentIndex,
            startsAtDashBoundary,
          ),
          startParameter,
        }),
      );
    }
    const toggled = cursor.consume(step);
    traversed += step;
    startParameter = endParameter;
    startsAtDashBoundary = toggled;
  }
  return { ok: true, fragments };
}

function boundaryAtStart(
  parameter: number,
  segmentIndex: number,
  startsAtDashBoundary: boolean,
): DashBoundary {
  if (startsAtDashBoundary || parameter > EPSILON) return "dash";
  return segmentIndex === 0 ? "path" : "segment";
}

function createFragment(
  segment: StrokeTraversalSegment,
  input: {
    endBoundary: DashBoundary;
    endParameter: number;
    sourceSegmentIndex: number;
    startBoundary: DashBoundary;
    startParameter: number;
  },
): DashedStrokeFragment {
  const curve = subcurve(segment, input.startParameter, input.endParameter);
  return {
    ...curve,
    endBoundary: input.endBoundary,
    sourceSegmentIndex: input.sourceSegmentIndex,
    startBoundary: input.startBoundary,
  };
}

function parameterAtLength(
  segment: StrokeTraversalSegment,
  start: number,
  targetLength: number,
): number {
  let low = start;
  let high = 1;
  for (let index = 0; index < 28; index += 1) {
    const middle = (low + high) / 2;
    if (curveLength(segment, start, middle) < targetLength) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function curveLength(
  segment: StrokeTraversalSegment,
  start: number,
  end: number,
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
      (derivativeLength(segment, middle - offset) +
        derivativeLength(segment, middle + offset));
  }
  return half * sum;
}

function derivativeLength(
  segment: StrokeTraversalSegment,
  parameter: number,
): number {
  const derivative = cubicDerivative(segment, parameter);
  return Math.hypot(derivative.x, derivative.y);
}

function subcurve(
  segment: StrokeTraversalSegment,
  start: number,
  end: number,
): StrokeTraversalSegment {
  const startPoint = cubicPoint(segment, start);
  const endPoint = cubicPoint(segment, end);
  const scale = (end - start) / 3;
  const startDerivative = cubicDerivative(segment, start);
  const endDerivative = cubicDerivative(segment, end);
  const hasCurve = !!segment.controlStart || !!segment.controlEnd;
  return {
    start: endpointVertex(segment.start, startPoint, start <= EPSILON, "start"),
    end: endpointVertex(segment.end, endPoint, end >= 1 - EPSILON, "end"),
    ...(hasCurve
      ? {
          controlStart: add(startPoint, multiply(startDerivative, scale)),
          controlEnd: subtract(endPoint, multiply(endDerivative, scale)),
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
    : { id: `${authored.id}.__dash_${role}_${point.x}_${point.y}`, ...point };
}

function cubicPoint(segment: StrokeTraversalSegment, parameter: number): Point {
  if (!segment.controlStart && !segment.controlEnd) {
    return add(
      segment.start,
      multiply(subtract(segment.end, segment.start), parameter),
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

function cubicDerivative(
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

function add(left: Point, right: Point): Point {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}

function multiply(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
