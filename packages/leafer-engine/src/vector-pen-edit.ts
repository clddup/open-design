import type { Point, VectorNetwork } from "@opendesign/design-contracts";
import { validateVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import {
  appendVectorContour,
  appendVectorPoint,
} from "@opendesign/geometry-service/vector-point-append";
import { insertVectorPoint } from "@opendesign/geometry-service/vector-point-insert";
import type {
  VectorEditFailureCode,
  VectorHandleReference,
  VectorSegmentHit,
} from "@opendesign/geometry-service/vector-edit";

export interface VectorPenPointEdit {
  base: VectorNetwork;
  handles: readonly VectorPenDragHandle[];
  network: VectorNetwork;
  point: Point;
  vertexId: string;
}

export interface VectorPenContourStart {
  point: Point;
  tangentOut?: Point;
}

interface VectorPenDragHandle {
  direction: -1 | 1;
  reference: VectorHandleReference;
}

export type VectorPenPointResult =
  | { edit: VectorPenPointEdit; ok: true }
  | { code: VectorEditFailureCode; message: string; ok: false };

const HANDLE_EPSILON = 0.5;

export function createVectorPenContourStart(
  point: Point,
): VectorPenContourStart {
  return { point: { ...point } };
}

export function dragVectorPenContourStart(
  start: VectorPenContourStart,
  pointer: Point,
): VectorPenContourStart {
  const tangentOut = {
    x: pointer.x - start.point.x,
    y: pointer.y - start.point.y,
  };
  return Math.hypot(tangentOut.x, tangentOut.y) < HANDLE_EPSILON
    ? { point: { ...start.point } }
    : { point: { ...start.point }, tangentOut };
}

export function beginVectorPenContour(
  network: VectorNetwork,
  start: VectorPenContourStart,
  end: Point,
): VectorPenPointResult {
  const result = appendVectorContour(network, start.point, end);
  if (!result.ok) return result;
  const base = result.network;
  const segment = base.segments.find(({ id }) => id === result.segmentId)!;
  const startVertex = base.vertices.find(
    ({ id }) => id === result.startVertexId,
  )!;
  if (start.tangentOut) {
    startVertex.handleMode = "mirrored";
    segment.tangentStart = { ...start.tangentOut };
  }
  const issues = validateVectorNetwork(base);
  if (issues.length > 0) {
    return {
      code: "invalid-network",
      message: issues.map(({ message }) => message).join("; "),
      ok: false,
    };
  }
  return {
    edit: {
      base,
      handles: [
        {
          direction: -1,
          reference: { segmentId: segment.id, side: "end" },
        },
      ],
      network: base,
      point: base.vertices.find(({ id }) => id === result.endVertexId)!,
      vertexId: result.endVertexId,
    },
    ok: true,
  };
}

export function finishVectorPenContourAtVertex(
  network: VectorNetwork,
  start: VectorPenContourStart,
  targetVertexId: string,
): VectorPenPointResult {
  const result = appendVectorPoint(network, targetVertexId, start.point);
  if (!result.ok) return result;
  const base = result.network;
  const segment = base.segments.find(({ id }) => id === result.segmentId)!;
  applyContourStartHandle(base, result.vertexId, segment, start.tangentOut);
  const issues = validateVectorNetwork(base);
  if (issues.length > 0) {
    return {
      code: "invalid-network",
      message: issues.map(({ message }) => message).join("; "),
      ok: false,
    };
  }
  return {
    edit: {
      base,
      handles: [],
      network: base,
      point: base.vertices.find(({ id }) => id === result.vertexId)!,
      vertexId: result.vertexId,
    },
    ok: true,
  };
}

export function beginVectorPenInsert(
  network: VectorNetwork,
  hit: VectorSegmentHit,
): VectorPenPointResult {
  const result = insertVectorPoint(network, hit.pathId, hit.segmentId, hit.t);
  if (!result.ok) return result;
  return {
    edit: {
      base: result.network,
      handles: [
        { direction: -1, reference: result.incomingHandle },
        { direction: 1, reference: result.outgoingHandle },
      ],
      network: result.network,
      point: result.network.vertices.find(({ id }) => id === result.vertexId)!,
      vertexId: result.vertexId,
    },
    ok: true,
  };
}

export function beginVectorPenAppend(
  network: VectorNetwork,
  sourceVertexId: string,
  point: Point,
  sourceTangentOut?: Point,
): VectorPenPointResult {
  const result = appendVectorPoint(network, sourceVertexId, point);
  if (!result.ok) return result;
  const segment = result.network.segments.find(
    ({ id }) => id === result.segmentId,
  )!;
  applySourceHandle(result.network, sourceVertexId, segment, sourceTangentOut);
  const issues = validateVectorNetwork(result.network);
  if (issues.length > 0) {
    return {
      code: "invalid-network",
      message: issues.map(({ message }) => message).join("; "),
      ok: false,
    };
  }
  const reference: VectorHandleReference =
    segment.startVertexId === result.vertexId
      ? { segmentId: segment.id, side: "start" }
      : { segmentId: segment.id, side: "end" };
  return {
    edit: {
      base: result.network,
      handles: [{ direction: -1, reference }],
      network: result.network,
      point: result.network.vertices.find(({ id }) => id === result.vertexId)!,
      vertexId: result.vertexId,
    },
    ok: true,
  };
}

function applySourceHandle(
  network: VectorNetwork,
  vertexId: string,
  segment: VectorNetwork["segments"][number],
  tangent: Point | undefined,
): void {
  if (!tangent) return;
  const vertex = network.vertices.find(({ id }) => id === vertexId)!;
  vertex.handleMode = "mirrored";
  if (segment.startVertexId === vertexId) segment.tangentStart = { ...tangent };
  else segment.tangentEnd = { ...tangent };
}

export function dragVectorPenPoint(
  edit: VectorPenPointEdit,
  pointer: Point,
): VectorPenPointResult {
  const delta = { x: pointer.x - edit.point.x, y: pointer.y - edit.point.y };
  const network = structuredClone(edit.base);
  const vertex = network.vertices.find(({ id }) => id === edit.vertexId);
  if (!vertex) {
    return {
      code: "missing-vertex",
      message: `Vector vertex ${edit.vertexId} does not exist`,
      ok: false,
    };
  }
  for (const handle of edit.handles) {
    setHandle(network, handle.reference, {
      x: delta.x * handle.direction,
      y: delta.y * handle.direction,
    });
  }
  vertex.handleMode = "mirrored";
  delete vertex.cornerRadius;
  const issues = validateVectorNetwork(network);
  if (issues.length > 0) {
    return {
      code: "invalid-network",
      message: issues.map(({ message }) => message).join("; "),
      ok: false,
    };
  }
  return { edit: { ...edit, network }, ok: true };
}

function setHandle(
  network: VectorNetwork,
  reference: VectorHandleReference,
  offset: Point,
): void {
  const segment = network.segments.find(
    ({ id }) => id === reference.segmentId,
  )!;
  if (reference.side === "start") segment.tangentStart = offset;
  else segment.tangentEnd = offset;
}

function applyContourStartHandle(
  network: VectorNetwork,
  vertexId: string,
  segment: VectorNetwork["segments"][number],
  tangent: Point | undefined,
): void {
  if (!tangent) return;
  const vertex = network.vertices.find(({ id }) => id === vertexId)!;
  vertex.handleMode = "mirrored";
  if (segment.startVertexId === vertexId) segment.tangentStart = { ...tangent };
  else segment.tangentEnd = { ...tangent };
}
