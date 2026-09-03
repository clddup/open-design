import type {
  Point,
  VectorSegment,
  VectorSegmentReference,
  VectorVertex,
} from "@opendesign/design-contracts";

export interface DirectedVectorCurve {
  end: Point;
  endVertexId: string;
  start: Point;
  startVertexId: string;
  tangentEnd?: Point;
  tangentStart?: Point;
}

export interface DirectedVectorCurveSplit {
  first: Pick<DirectedVectorCurve, "tangentStart" | "tangentEnd">;
  point: Point;
  second: Pick<DirectedVectorCurve, "tangentStart" | "tangentEnd">;
}

export interface DirectedVectorCurvePointHit {
  distance: number;
  point: Point;
  t: number;
}

export function directedVectorCurve(
  segment: VectorSegment,
  reference: VectorSegmentReference,
  vertices: ReadonlyMap<string, VectorVertex>,
): DirectedVectorCurve {
  const startVertexId = reference.reversed
    ? segment.endVertexId
    : segment.startVertexId;
  const endVertexId = reference.reversed
    ? segment.startVertexId
    : segment.endVertexId;
  return {
    start: vertices.get(startVertexId)!,
    startVertexId,
    end: vertices.get(endVertexId)!,
    endVertexId,
    ...(reference.reversed
      ? {
          ...(segment.tangentEnd
            ? { tangentStart: { ...segment.tangentEnd } }
            : {}),
          ...(segment.tangentStart
            ? { tangentEnd: { ...segment.tangentStart } }
            : {}),
        }
      : {
          ...(segment.tangentStart
            ? { tangentStart: { ...segment.tangentStart } }
            : {}),
          ...(segment.tangentEnd
            ? { tangentEnd: { ...segment.tangentEnd } }
            : {}),
        }),
  };
}

export function splitDirectedVectorCurve(
  curve: DirectedVectorCurve,
  t: number,
): DirectedVectorCurveSplit {
  if (!meaningful(curve.tangentStart) && !meaningful(curve.tangentEnd)) {
    return {
      first: {},
      point: normalizePoint(lerp(curve.start, curve.end, t)),
      second: {},
    };
  }
  const controlStart = add(curve.start, curve.tangentStart ?? { x: 0, y: 0 });
  const controlEnd = add(curve.end, curve.tangentEnd ?? { x: 0, y: 0 });
  const q0 = lerp(curve.start, controlStart, t);
  const q1 = lerp(controlStart, controlEnd, t);
  const q2 = lerp(controlEnd, curve.end, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const point = normalizePoint(lerp(r0, r1, t));
  return {
    first: {
      tangentStart: normalizePoint(subtract(q0, curve.start)),
      tangentEnd: normalizePoint(subtract(r0, point)),
    },
    point,
    second: {
      tangentStart: normalizePoint(subtract(r1, point)),
      tangentEnd: normalizePoint(subtract(q2, curve.end)),
    },
  };
}

export function pointOnDirectedVectorCurve(
  curve: DirectedVectorCurve,
  t: number,
): Point {
  if (!meaningful(curve.tangentStart) && !meaningful(curve.tangentEnd)) {
    return lerp(curve.start, curve.end, t);
  }
  const controlStart = add(curve.start, curve.tangentStart ?? { x: 0, y: 0 });
  const controlEnd = add(curve.end, curve.tangentEnd ?? { x: 0, y: 0 });
  const mt = 1 - t;
  return {
    x:
      mt ** 3 * curve.start.x +
      3 * mt ** 2 * t * controlStart.x +
      3 * mt * t ** 2 * controlEnd.x +
      t ** 3 * curve.end.x,
    y:
      mt ** 3 * curve.start.y +
      3 * mt ** 2 * t * controlStart.y +
      3 * mt * t ** 2 * controlEnd.y +
      t ** 3 * curve.end.y,
  };
}

export function nearestPointOnDirectedVectorCurve(
  curve: DirectedVectorCurve,
  point: Point,
): DirectedVectorCurvePointHit {
  if (!meaningful(curve.tangentStart) && !meaningful(curve.tangentEnd)) {
    return nearestLinePoint(curve.start, curve.end, point);
  }
  const sampleCount = 32;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= sampleCount; index += 1) {
    const candidate = squaredDistance(
      pointOnDirectedVectorCurve(curve, index / sampleCount),
      point,
    );
    if (candidate < bestDistance) {
      bestDistance = candidate;
      bestIndex = index;
    }
  }
  let left = Math.max(0, (bestIndex - 1) / sampleCount);
  let right = Math.min(1, (bestIndex + 1) / sampleCount);
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const first = left + (right - left) / 3;
    const second = right - (right - left) / 3;
    if (
      squaredDistance(pointOnDirectedVectorCurve(curve, first), point) <=
      squaredDistance(pointOnDirectedVectorCurve(curve, second), point)
    ) {
      right = second;
    } else {
      left = first;
    }
  }
  const t = normalizeNumber((left + right) / 2);
  const nearest = normalizePoint(pointOnDirectedVectorCurve(curve, t));
  return { distance: distance(nearest, point), point: nearest, t };
}

export function storedSegmentFromDirectedVectorCurve(
  id: string,
  startVertexId: string,
  endVertexId: string,
  curve: Pick<DirectedVectorCurve, "tangentStart" | "tangentEnd">,
  reversed: boolean,
): VectorSegment {
  const tangentStart = meaningful(curve.tangentStart)
    ? normalizePoint(curve.tangentStart!)
    : undefined;
  const tangentEnd = meaningful(curve.tangentEnd)
    ? normalizePoint(curve.tangentEnd!)
    : undefined;
  if (!reversed) {
    return {
      id,
      startVertexId,
      endVertexId,
      ...(tangentStart ? { tangentStart } : {}),
      ...(tangentEnd ? { tangentEnd } : {}),
    };
  }
  return {
    id,
    startVertexId: endVertexId,
    endVertexId: startVertexId,
    ...(tangentEnd ? { tangentStart: tangentEnd } : {}),
    ...(tangentStart ? { tangentEnd: tangentStart } : {}),
  };
}

function meaningful(point: Point | undefined): boolean {
  return Boolean(point && Math.hypot(point.x, point.y) > 0.000_001);
}

function add(left: Point, right: Point): Point {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}

function lerp(start: Point, end: Point, t: number): Point {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function nearestLinePoint(
  start: Point,
  end: Point,
  point: Point,
): DirectedVectorCurvePointHit {
  const delta = subtract(end, start);
  const denominator = delta.x * delta.x + delta.y * delta.y;
  const t =
    denominator <= 0.000_001
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * delta.x + (point.y - start.y) * delta.y) /
              denominator,
          ),
        );
  const nearest = normalizePoint(lerp(start, end, t));
  return { distance: distance(nearest, point), point: nearest, t };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function squaredDistance(left: Point, right: Point): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function normalizePoint(point: Point): Point {
  return { x: normalizeNumber(point.x), y: normalizeNumber(point.y) };
}

function normalizeNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
