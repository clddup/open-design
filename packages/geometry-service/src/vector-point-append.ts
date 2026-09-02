import type {
  Point,
  VectorNetwork,
  VectorPathRun,
  VectorSegment,
  VectorSegmentReference,
  VectorVertex,
} from "@opendesign/design-contracts";
import { validateVectorNetwork } from "./editable-vector.js";
import {
  inferVectorPointMode,
  type VectorEditFailureCode,
} from "./vector-edit.js";

export type VectorPointAppendResult =
  | {
      ok: true;
      network: VectorNetwork;
      pathId: string;
      segmentId: string;
      vertexId: string;
    }
  | { ok: false; code: VectorEditFailureCode; message: string };

const POINT_EPSILON = 0.000_001;

/**
 * Adds one connected point from an existing vertex. An unambiguous open
 * endpoint extends its current path; any other source creates a real branch
 * path that shares the source vertex.
 */
export function appendVectorPoint(
  network: VectorNetwork,
  sourceVertexId: string,
  point: Point,
): VectorPointAppendResult {
  const failure = validateInput(network, sourceVertexId, point);
  if (failure) return failure;

  const next = structuredClone(network);
  const source = next.vertices.find(({ id }) => id === sourceVertexId)!;
  const vertexId = nextId(
    "vertex_edit",
    new Set(next.vertices.map(({ id }) => id)),
  );
  const segmentId = nextId(
    "segment_edit",
    new Set(next.segments.map(({ id }) => id)),
  );
  const vertex: VectorVertex = {
    id: vertexId,
    x: point.x,
    y: point.y,
    ...(source.strokeCap ? { strokeCap: source.strokeCap } : {}),
  };
  const endpoint = uniqueOpenEndpoint(next, sourceVertexId);
  const segment = endpoint
    ? extendOpenPath(next, endpoint, source, vertex, segmentId)
    : createBranchPath(next, source, vertex, segmentId);
  next.vertices.push(vertex);
  next.segments.push(segment);

  const issues = validateVectorNetwork(next);
  if (issues.length > 0) {
    return {
      ok: false,
      code: "invalid-network",
      message: issues.map(({ message }) => message).join("; "),
    };
  }
  const pathId = endpoint?.path.id ?? next.paths.at(-1)!.id;
  return { ok: true, network: next, pathId, segmentId, vertexId };
}

type OpenEndpoint = {
  at: "start" | "end";
  path: VectorPathRun;
};

function validateInput(
  network: VectorNetwork,
  sourceVertexId: string,
  point: Point,
): Extract<VectorPointAppendResult, { ok: false }> | null {
  const issues = validateVectorNetwork(network);
  if (issues.length > 0) {
    return {
      ok: false,
      code: "invalid-network",
      message: issues.map(({ message }) => message).join("; "),
    };
  }
  if (network.paths.length === 0) {
    return failure(
      "unsupported-topology",
      "Appending a Vector point requires at least one path",
    );
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return failure(
      "invalid-network",
      "Vector point coordinates must be finite",
    );
  }
  const source = network.vertices.find(({ id }) => id === sourceVertexId);
  if (!source) {
    return failure(
      "missing-vertex",
      `Vector vertex ${sourceVertexId} does not exist`,
    );
  }
  if (
    Math.abs(source.x - point.x) <= POINT_EPSILON &&
    Math.abs(source.y - point.y) <= POINT_EPSILON
  ) {
    return failure("no-op", "New Vector point overlaps its source vertex");
  }
  return null;
}

function uniqueOpenEndpoint(
  network: VectorNetwork,
  vertexId: string,
): OpenEndpoint | null {
  const segments = new Map(network.segments.map((item) => [item.id, item]));
  const matches = network.paths.flatMap((path): OpenEndpoint[] => {
    if (path.closed) return [];
    const first = path.segments[0];
    const last = path.segments.at(-1);
    if (!first || !last) return [];
    const start = directedVertexIds(
      segments.get(first.segmentId)!,
      first,
    ).start;
    const end = directedVertexIds(segments.get(last.segmentId)!, last).end;
    return [
      ...(start === vertexId ? [{ at: "start" as const, path }] : []),
      ...(end === vertexId ? [{ at: "end" as const, path }] : []),
    ];
  });
  return matches.length === 1 ? matches[0]! : null;
}

function extendOpenPath(
  network: VectorNetwork,
  endpoint: OpenEndpoint,
  source: VectorVertex,
  vertex: VectorVertex,
  segmentId: string,
): VectorSegment {
  const path = network.paths.find(({ id }) => id === endpoint.path.id)!;
  const segment: VectorSegment =
    endpoint.at === "end"
      ? { id: segmentId, startVertexId: source.id, endVertexId: vertex.id }
      : { id: segmentId, startVertexId: vertex.id, endVertexId: source.id };
  mirrorContinuousEndpointHandle(network, endpoint, source.id, segment);
  const reference = { segmentId, reversed: false };
  if (endpoint.at === "end") path.segments.push(reference);
  else path.segments.unshift(reference);
  if (source.strokeCap) delete source.strokeCap;
  return segment;
}

function createBranchPath(
  network: VectorNetwork,
  source: VectorVertex,
  vertex: VectorVertex,
  segmentId: string,
): VectorSegment {
  const pathId = nextId(
    "path_edit",
    new Set(network.paths.map(({ id }) => id)),
  );
  network.paths.push({
    id: pathId,
    closed: false,
    segments: [{ segmentId, reversed: false }],
  });
  source.handleMode = "independent";
  delete source.cornerRadius;
  return { id: segmentId, startVertexId: source.id, endVertexId: vertex.id };
}

function mirrorContinuousEndpointHandle(
  network: VectorNetwork,
  endpoint: OpenEndpoint,
  sourceVertexId: string,
  segment: VectorSegment,
): void {
  const mode = inferVectorPointMode(network, sourceVertexId);
  if (mode !== "smooth" && mode !== "mirrored") return;
  const reference =
    endpoint.at === "end"
      ? endpoint.path.segments.at(-1)
      : endpoint.path.segments[0];
  const sourceSegment = reference
    ? network.segments.find(({ id }) => id === reference.segmentId)
    : undefined;
  if (!reference || !sourceSegment) return;
  const handle =
    endpoint.at === "end"
      ? directedEndTangent(sourceSegment, reference)
      : directedStartTangent(sourceSegment, reference);
  if (!handle || Math.hypot(handle.x, handle.y) <= POINT_EPSILON) return;
  const mirrored = { x: -handle.x, y: -handle.y };
  if (endpoint.at === "end") segment.tangentStart = mirrored;
  else segment.tangentEnd = mirrored;
}

function directedStartTangent(
  segment: VectorSegment,
  reference: VectorSegmentReference,
): Point | undefined {
  return reference.reversed ? segment.tangentEnd : segment.tangentStart;
}

function directedEndTangent(
  segment: VectorSegment,
  reference: VectorSegmentReference,
): Point | undefined {
  return reference.reversed ? segment.tangentStart : segment.tangentEnd;
}

function directedVertexIds(
  segment: VectorSegment,
  reference: VectorSegmentReference,
): { start: string; end: string } {
  return reference.reversed
    ? { start: segment.endVertexId, end: segment.startVertexId }
    : { start: segment.startVertexId, end: segment.endVertexId };
}

function nextId(prefix: string, used: ReadonlySet<string>): string {
  let index = 1;
  while (used.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

function failure(
  code: VectorEditFailureCode,
  message: string,
): Extract<VectorPointAppendResult, { ok: false }> {
  return { ok: false, code, message };
}
