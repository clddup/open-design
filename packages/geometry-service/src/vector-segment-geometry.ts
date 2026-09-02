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

function normalizePoint(point: Point): Point {
  return { x: normalizeNumber(point.x), y: normalizeNumber(point.y) };
}

function normalizeNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
