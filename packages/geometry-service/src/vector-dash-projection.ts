import {
  vectorCurveLength,
  vectorCurveParameterAtLength,
  vectorSubcurve,
  type StrokeTraversalSegment,
} from "./vector-curve-metrics.js";

const EPSILON = 1e-7;
const MAX_DASH_FRAGMENTS = 16_384;
export type { StrokeTraversalSegment } from "./vector-curve-metrics.js";

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
  const length = vectorCurveLength(segment);
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
      : vectorCurveParameterAtLength(segment, startParameter, step);
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
  const curve = vectorSubcurve(
    segment,
    input.startParameter,
    input.endParameter,
  );
  return {
    ...curve,
    endBoundary: input.endBoundary,
    sourceSegmentIndex: input.sourceSegmentIndex,
    startBoundary: input.startBoundary,
  };
}
