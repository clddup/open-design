import type { Point, VectorNetwork } from "@opendesign/design-contracts";
import { validateVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import { appendVectorPoint } from "@opendesign/geometry-service/vector-point-append";
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

interface VectorPenDragHandle {
  direction: -1 | 1;
  reference: VectorHandleReference;
}

export type VectorPenPointResult =
  | { edit: VectorPenPointEdit; ok: true }
  | { code: VectorEditFailureCode; message: string; ok: false };

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
): VectorPenPointResult {
  const result = appendVectorPoint(network, sourceVertexId, point);
  if (!result.ok) return result;
  const segment = result.network.segments.find(
    ({ id }) => id === result.segmentId,
  )!;
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
