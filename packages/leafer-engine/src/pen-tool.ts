import type {
  Point,
  VectorNetwork,
  VectorPointMode,
} from "@opendesign/design-contracts";
import { serializeVectorNetwork } from "@opendesign/geometry-service/editable-vector";

export interface PenDraftVertex extends Point {
  handleMode: VectorPointMode;
  id: string;
  tangentIn?: Point;
  tangentOut?: Point;
}

export interface PenDraft {
  vertices: PenDraftVertex[];
}

const POINT_EPSILON = 0.000_001;
const HANDLE_EPSILON = 0.5;

export function createPenDraft(point: Point): PenDraft {
  return { vertices: [penVertex(0, point)] };
}

export function appendPenVertex(draft: PenDraft, point: Point): boolean {
  const previous = draft.vertices.at(-1);
  if (previous && pointDistance(previous, point) <= POINT_EPSILON) return false;
  draft.vertices.push(penVertex(draft.vertices.length, point));
  return true;
}

export function removeLastPenVertex(draft: PenDraft): boolean {
  return draft.vertices.pop() !== undefined;
}

export function setPenVertexHandle(
  draft: PenDraft,
  vertexIndex: number,
  outgoing: Point,
): void {
  const vertex = draft.vertices[vertexIndex];
  if (!vertex) return;
  if (Math.hypot(outgoing.x, outgoing.y) < HANDLE_EPSILON) {
    delete vertex.tangentIn;
    delete vertex.tangentOut;
    vertex.handleMode = "corner";
    return;
  }
  vertex.tangentIn = { x: -outgoing.x, y: -outgoing.y };
  vertex.tangentOut = { ...outgoing };
  vertex.handleMode = "mirrored";
}

export function penDraftToVectorNetwork(
  draft: PenDraft,
  closed: boolean,
): VectorNetwork | null {
  if (draft.vertices.length < 2) return null;
  const vertices = draft.vertices.map(({ handleMode, id, x, y }) => ({
    handleMode,
    id,
    x,
    y,
  }));
  const segments = draft.vertices.slice(1).map((vertex, index) => {
    const start = draft.vertices[index]!;
    return {
      id: `segment_${index + 1}`,
      startVertexId: start.id,
      endVertexId: vertex.id,
      ...(start.tangentOut ? { tangentStart: { ...start.tangentOut } } : {}),
      ...(vertex.tangentIn ? { tangentEnd: { ...vertex.tangentIn } } : {}),
    };
  });
  if (closed) {
    const start = draft.vertices.at(-1)!;
    const end = draft.vertices[0]!;
    segments.push({
      id: `segment_${segments.length + 1}`,
      startVertexId: start.id,
      endVertexId: end.id,
      ...(start.tangentOut ? { tangentStart: { ...start.tangentOut } } : {}),
      ...(end.tangentIn ? { tangentEnd: { ...end.tangentIn } } : {}),
    });
  }
  const pathId = "path_1";
  return {
    vertices,
    segments,
    paths: [
      {
        id: pathId,
        closed,
        segments: segments.map((segment) => ({
          segmentId: segment.id,
          reversed: false,
        })),
      },
    ],
    regions: closed
      ? [
          {
            id: "region_1",
            windingRule: "nonzero",
            loops: [{ pathId, reversed: false }],
          },
        ]
      : [],
  };
}

export function penDraftPreviewPath(
  draft: PenDraft,
  cursor: Point | undefined,
  closeCandidate: boolean,
): string | null {
  const preview: PenDraft = {
    vertices: draft.vertices.map((vertex) => ({
      ...vertex,
      ...(vertex.tangentIn ? { tangentIn: { ...vertex.tangentIn } } : {}),
      ...(vertex.tangentOut ? { tangentOut: { ...vertex.tangentOut } } : {}),
    })),
  };
  const closed = closeCandidate && preview.vertices.length >= 3;
  if (
    !closed &&
    cursor &&
    pointDistance(preview.vertices.at(-1)!, cursor) > POINT_EPSILON
  ) {
    appendPenVertex(preview, cursor);
  }
  const network = penDraftToVectorNetwork(preview, closed);
  if (!network) return null;
  const serialized = serializeVectorNetwork(network);
  return serialized.ok ? serialized.path : null;
}

export function penDraftHandlePath(draft: PenDraft): string | null {
  const parts: string[] = [];
  for (const vertex of draft.vertices) {
    if (vertex.tangentIn) {
      parts.push(
        `M ${number(vertex.x + vertex.tangentIn.x)} ${number(
          vertex.y + vertex.tangentIn.y,
        )} L ${number(vertex.x)} ${number(vertex.y)}`,
      );
    }
    if (vertex.tangentOut) {
      parts.push(
        `M ${number(vertex.x)} ${number(vertex.y)} L ${number(
          vertex.x + vertex.tangentOut.x,
        )} ${number(vertex.y + vertex.tangentOut.y)}`,
      );
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

function penVertex(index: number, point: Point): PenDraftVertex {
  return {
    handleMode: "corner",
    id: `vertex_${index + 1}`,
    x: point.x,
    y: point.y,
  };
}

function pointDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function number(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
