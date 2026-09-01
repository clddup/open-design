import type {
  Point,
  VectorNetwork,
  VectorPathRun,
  VectorSegment,
  VectorSegmentReference,
  VectorVertex,
} from "@opendesign/design-contracts";
import {
  createVectorCornerProfile,
  type CornerProfileSegment,
} from "./vector-corner-profile.js";

const EPSILON = 1e-9;

export type VectorCornerRadiusProjectionResult =
  { ok: true; network: VectorNetwork } | { ok: false; message: string };

type DirectedSegment = {
  id: string;
  start: VectorVertex;
  end: VectorVertex;
  tangentStart?: Point;
  tangentEnd?: Point;
};

type RoundedCorner = {
  entry: VectorVertex;
  exit: VectorVertex;
  segments: VectorSegment[];
  vertices: VectorVertex[];
};

/**
 * Projects Figma-style circular corner radii into disposable cubic topology.
 * Authored vertex/segment IDs remain authoritative in the source network.
 */
export function projectVectorNetworkCornerRadii(
  network: VectorNetwork,
  fallbackCornerRadius = 0,
  cornerSmoothing = 0,
): VectorCornerRadiusProjectionResult {
  if (!Number.isFinite(fallbackCornerRadius) || fallbackCornerRadius < 0) {
    return { ok: false, message: "Vector corner radius must be non-negative" };
  }
  if (
    !Number.isFinite(cornerSmoothing) ||
    cornerSmoothing < 0 ||
    cornerSmoothing > 1
  ) {
    return {
      ok: false,
      message: "Vector corner smoothing must be between 0 and 1",
    };
  }
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  const usedIds = new Set([
    ...network.vertices.map((vertex) => vertex.id),
    ...network.segments.map((segment) => segment.id),
  ]);
  const projections = new Map<string, Map<string, RoundedCorner>>();

  for (const path of network.paths) {
    if (!path.closed) continue;
    const traversal = directedPath(path, vertices, segments);
    if (!traversal.ok) return traversal;
    const corners = roundedCorners(
      path,
      traversal.segments,
      fallbackCornerRadius,
      cornerSmoothing,
      usedIds,
    );
    if (corners.size > 0) projections.set(path.id, corners);
  }
  if (projections.size === 0) {
    return { ok: true, network: structuredClone(network) };
  }

  const outputVertices = new Map<string, VectorVertex>();
  const outputSegments = new Map<string, VectorSegment>();
  const outputPaths: VectorPathRun[] = [];
  for (const path of network.paths) {
    const corners = projections.get(path.id);
    if (!corners) {
      copyAuthoredPath(
        path,
        vertices,
        segments,
        outputVertices,
        outputSegments,
      );
      outputPaths.push(structuredClone(path));
      continue;
    }
    const traversal = directedPath(path, vertices, segments);
    if (!traversal.ok) return traversal;
    const references: VectorSegmentReference[] = [];
    for (const segment of traversal.segments) {
      const start = corners.get(segment.start.id)?.exit ?? segment.start;
      const end = corners.get(segment.end.id)?.entry ?? segment.end;
      addVertex(outputVertices, start);
      addVertex(outputVertices, end);
      outputSegments.set(
        segment.id,
        directedOutputSegment(segment, start.id, end.id),
      );
      references.push({ segmentId: segment.id, reversed: false });
      const corner = corners.get(segment.end.id);
      if (corner) {
        corner.vertices.forEach((vertex) => addVertex(outputVertices, vertex));
        for (const projectedSegment of corner.segments) {
          outputSegments.set(projectedSegment.id, projectedSegment);
          references.push({
            segmentId: projectedSegment.id,
            reversed: false,
          });
        }
      }
    }
    outputPaths.push({ ...structuredClone(path), segments: references });
  }

  return {
    ok: true,
    network: {
      vertices: [...outputVertices.values()],
      segments: [...outputSegments.values()],
      paths: outputPaths,
      regions: structuredClone(network.regions),
    },
  };
}

export function vectorNetworkHasCornerRadius(
  network: Pick<VectorNetwork, "vertices">,
  fallbackCornerRadius = 0,
): boolean {
  return (
    fallbackCornerRadius > 0 ||
    network.vertices.some((vertex) => (vertex.cornerRadius ?? 0) > 0)
  );
}

function roundedCorners(
  path: VectorPathRun,
  segments: readonly DirectedSegment[],
  fallbackCornerRadius: number,
  cornerSmoothing: number,
  usedIds: Set<string>,
): Map<string, RoundedCorner> {
  const corners = new Map<string, RoundedCorner>();
  for (let index = 0; index < segments.length; index += 1) {
    const previous = segments[index]!;
    const next = segments[(index + 1) % segments.length]!;
    const vertex = previous.end;
    const radius = vertex.cornerRadius ?? fallbackCornerRadius;
    if (
      radius <= 0 ||
      next.start.id !== vertex.id ||
      !isLine(previous) ||
      !isLine(next)
    ) {
      continue;
    }
    const corner = roundedCorner(
      path.id,
      vertex,
      previous.start,
      next.end,
      radius,
      cornerSmoothing,
      usedIds,
    );
    if (corner) corners.set(vertex.id, corner);
  }
  return corners;
}

function roundedCorner(
  pathId: string,
  vertex: VectorVertex,
  previous: Point,
  next: Point,
  radius: number,
  smoothing: number,
  usedIds: Set<string>,
): RoundedCorner | null {
  const profile = createVectorCornerProfile(
    vertex,
    previous,
    next,
    radius,
    smoothing,
  );
  if (!profile) return null;
  const vertices = new Map<string, VectorVertex>();
  const vertexForPoint = (point: Point, role: string) => {
    const key = `${stableNumber(point.x)},${stableNumber(point.y)}`;
    const existing = vertices.get(key);
    if (existing) return existing;
    const created = projectedVertex(
      `${vertex.id}.__corner_${role}_${pathId}`,
      point,
      usedIds,
    );
    vertices.set(key, created);
    return created;
  };
  const entry = vertexForPoint(profile.entry, "entry");
  const exit = vertexForPoint(profile.exit, "exit");
  const segments = profile.segments.map((segment) =>
    profileSegment(
      pathId,
      vertex.id,
      segment,
      vertexForPoint(segment.start, segmentStartRole(segment)),
      vertexForPoint(segment.end, segmentEndRole(segment)),
      usedIds,
    ),
  );
  return {
    entry,
    exit,
    vertices: [...vertices.values()],
    segments,
  };
}

function profileSegment(
  pathId: string,
  vertexId: string,
  profile: CornerProfileSegment,
  start: VectorVertex,
  end: VectorVertex,
  usedIds: Set<string>,
): VectorSegment {
  const role =
    profile.role === "circular" ? "segment" : profile.role.replace("-", "_");
  return cubicSegment(
    uniqueId(`${vertexId}.__corner_${role}_${pathId}`, usedIds),
    start,
    end,
    profile.controlStart,
    profile.controlEnd,
  );
}

function segmentStartRole(segment: CornerProfileSegment): string {
  if (segment.role === "arc") return "circle_start";
  return segment.role === "ramp-out" ? "circle_end" : "entry";
}

function segmentEndRole(segment: CornerProfileSegment): string {
  if (segment.role === "ramp-in") return "circle_start";
  if (segment.role === "arc") return "circle_end";
  return "exit";
}

function cubicSegment(
  id: string,
  start: VectorVertex,
  end: VectorVertex,
  controlStart: Point,
  controlEnd: Point,
): VectorSegment {
  return {
    id,
    startVertexId: start.id,
    endVertexId: end.id,
    tangentStart: stablePoint(subtract(controlStart, start)),
    tangentEnd: stablePoint(subtract(controlEnd, end)),
  };
}

function projectedVertex(
  id: string,
  point: Point,
  usedIds: Set<string>,
): VectorVertex {
  return {
    id: uniqueId(id, usedIds),
    x: stableNumber(point.x),
    y: stableNumber(point.y),
    handleMode: "smooth",
  };
}

function directedPath(
  path: VectorPathRun,
  vertices: ReadonlyMap<string, VectorVertex>,
  segments: ReadonlyMap<string, VectorSegment>,
): { ok: true; segments: DirectedSegment[] } | { ok: false; message: string } {
  const result: DirectedSegment[] = [];
  for (const reference of path.segments) {
    const segment = segments.get(reference.segmentId);
    if (!segment) {
      return {
        ok: false,
        message: `Vector segment ${reference.segmentId} is missing`,
      };
    }
    const start = vertices.get(
      reference.reversed ? segment.endVertexId : segment.startVertexId,
    );
    const end = vertices.get(
      reference.reversed ? segment.startVertexId : segment.endVertexId,
    );
    if (!start || !end) {
      return { ok: false, message: "Vector segment endpoint is missing" };
    }
    const tangentStart = reference.reversed
      ? segment.tangentEnd
      : segment.tangentStart;
    const tangentEnd = reference.reversed
      ? segment.tangentStart
      : segment.tangentEnd;
    result.push({
      id: segment.id,
      start,
      end,
      ...(tangentStart ? { tangentStart: { ...tangentStart } } : {}),
      ...(tangentEnd ? { tangentEnd: { ...tangentEnd } } : {}),
    });
  }
  return { ok: true, segments: result };
}

function directedOutputSegment(
  segment: DirectedSegment,
  startVertexId: string,
  endVertexId: string,
): VectorSegment {
  return {
    id: segment.id,
    startVertexId,
    endVertexId,
    ...(segment.tangentStart
      ? { tangentStart: { ...segment.tangentStart } }
      : {}),
    ...(segment.tangentEnd ? { tangentEnd: { ...segment.tangentEnd } } : {}),
  };
}

function copyAuthoredPath(
  path: VectorPathRun,
  vertices: ReadonlyMap<string, VectorVertex>,
  segments: ReadonlyMap<string, VectorSegment>,
  outputVertices: Map<string, VectorVertex>,
  outputSegments: Map<string, VectorSegment>,
): void {
  for (const reference of path.segments) {
    const segment = segments.get(reference.segmentId);
    if (!segment) continue;
    outputSegments.set(segment.id, structuredClone(segment));
    const start = vertices.get(segment.startVertexId);
    const end = vertices.get(segment.endVertexId);
    if (start) addVertex(outputVertices, start);
    if (end) addVertex(outputVertices, end);
  }
}

function addVertex(target: Map<string, VectorVertex>, vertex: VectorVertex) {
  if (!target.has(vertex.id)) target.set(vertex.id, structuredClone(vertex));
}

function isLine(segment: DirectedSegment): boolean {
  return !meaningful(segment.tangentStart) && !meaningful(segment.tangentEnd);
}

function meaningful(point: Point | undefined): boolean {
  return (
    !!point && (Math.abs(point.x) > EPSILON || Math.abs(point.y) > EPSILON)
  );
}

function uniqueId(base: string, usedIds: Set<string>): string {
  let candidate = base;
  let suffix = 1;
  while (usedIds.has(candidate)) candidate = `${base}_${suffix++}`;
  usedIds.add(candidate);
  return candidate;
}

function subtract(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}

function stablePoint(point: Point): Point {
  return { x: stableNumber(point.x), y: stableNumber(point.y) };
}

function stableNumber(value: number): number {
  return Math.abs(value) <= EPSILON ? 0 : Number(value.toFixed(12));
}
