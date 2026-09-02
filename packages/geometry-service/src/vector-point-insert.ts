import type {
  VectorNetwork,
  VectorSegmentReference,
  VectorVertex,
} from "@opendesign/design-contracts";
import { validateVectorNetwork } from "./editable-vector.js";
import type {
  VectorEditFailureCode,
  VectorHandleReference,
} from "./vector-edit.js";
import {
  directedVectorCurve,
  splitDirectedVectorCurve,
  storedSegmentFromDirectedVectorCurve,
} from "./vector-segment-geometry.js";

export type VectorPointInsertResult =
  | {
      incomingHandle: VectorHandleReference;
      network: VectorNetwork;
      ok: true;
      outgoingHandle: VectorHandleReference;
      pathId: string;
      segmentIds: readonly [string, string];
      vertexId: string;
    }
  | { code: VectorEditFailureCode; message: string; ok: false };

const PARAMETER_EPSILON = 0.000_001;

/** Splits one directed path segment without changing its rendered curve. */
export function insertVectorPoint(
  network: VectorNetwork,
  pathId: string,
  segmentId: string,
  t: number,
): VectorPointInsertResult {
  const failure = validateInput(network, pathId, segmentId, t);
  if (failure) return failure;

  const next = structuredClone(network);
  const path = next.paths.find(({ id }) => id === pathId)!;
  const referenceIndex = path.segments.findIndex(
    (reference) => reference.segmentId === segmentId,
  );
  const reference = path.segments[referenceIndex]!;
  const segmentIndex = next.segments.findIndex(({ id }) => id === segmentId);
  const segment = next.segments[segmentIndex]!;
  const vertices = new Map(next.vertices.map((vertex) => [vertex.id, vertex]));
  const curve = directedVectorCurve(segment, reference, vertices);
  const split = splitDirectedVectorCurve(curve, t);
  const vertexId = nextId(
    "vertex_pen",
    new Set(next.vertices.map(({ id }) => id)),
  );
  const newSegmentId = nextId(
    "segment_pen",
    new Set(next.segments.map(({ id }) => id)),
  );
  const vertex: VectorVertex = { id: vertexId, ...split.point };
  const first = storedSegmentFromDirectedVectorCurve(
    segment.id,
    curve.startVertexId,
    vertexId,
    split.first,
    reference.reversed,
  );
  const second = storedSegmentFromDirectedVectorCurve(
    newSegmentId,
    vertexId,
    curve.endVertexId,
    split.second,
    reference.reversed,
  );
  next.vertices.push(vertex);
  next.segments.splice(segmentIndex, 1, first, second);
  const secondReference: VectorSegmentReference = {
    segmentId: newSegmentId,
    reversed: reference.reversed,
  };
  path.segments.splice(referenceIndex, 1, { ...reference }, secondReference);

  const issues = validateVectorNetwork(next);
  if (issues.length > 0) return invalid(issues.map(({ message }) => message));
  return {
    incomingHandle: handleAtDirectedEnd(reference),
    network: next,
    ok: true,
    outgoingHandle: handleAtDirectedStart(secondReference),
    pathId,
    segmentIds: [segment.id, newSegmentId],
    vertexId,
  };
}

function validateInput(
  network: VectorNetwork,
  pathId: string,
  segmentId: string,
  t: number,
): Extract<VectorPointInsertResult, { ok: false }> | null {
  const issues = validateVectorNetwork(network);
  if (issues.length > 0) return invalid(issues.map(({ message }) => message));
  if (!Number.isFinite(t))
    return invalid(["Vector point parameter must be finite"]);
  if (t <= PARAMETER_EPSILON || t >= 1 - PARAMETER_EPSILON) {
    return failure(
      "no-op",
      "Vector point must be inserted inside a segment, not on an endpoint",
    );
  }
  const path = network.paths.find(({ id }) => id === pathId);
  if (!path)
    return failure("missing-path", `Vector path ${pathId} does not exist`);
  if (!path.segments.some((reference) => reference.segmentId === segmentId)) {
    return failure(
      "missing-segment",
      `Vector segment ${segmentId} does not belong to path ${pathId}`,
    );
  }
  return null;
}

function handleAtDirectedStart(
  reference: VectorSegmentReference,
): VectorHandleReference {
  return {
    segmentId: reference.segmentId,
    side: reference.reversed ? "end" : "start",
  };
}

function handleAtDirectedEnd(
  reference: VectorSegmentReference,
): VectorHandleReference {
  return {
    segmentId: reference.segmentId,
    side: reference.reversed ? "start" : "end",
  };
}

function nextId(prefix: string, used: ReadonlySet<string>): string {
  for (let index = 1; index <= used.size + 1; index += 1) {
    const candidate = `${prefix}_${index}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate ${prefix} ID`);
}

function invalid(
  messages: readonly string[],
): Extract<VectorPointInsertResult, { ok: false }> {
  return { code: "invalid-network", message: messages.join("; "), ok: false };
}

function failure(
  code: VectorEditFailureCode,
  message: string,
): Extract<VectorPointInsertResult, { ok: false }> {
  return { code, message, ok: false };
}
