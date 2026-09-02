import type { Point, VectorNetwork } from "@opendesign/design-contracts";
import {
  serializeVectorNetwork,
  validateVectorNetwork,
} from "@opendesign/geometry-service/editable-vector";
import {
  connectVectorEndpoints,
  inferVectorPointMode,
  listVectorVertexHandles,
  type VectorEditFailureCode,
} from "@opendesign/geometry-service/vector-edit";
import {
  beginVectorPenAppend,
  beginVectorPenContour,
  createVectorPenContourStart,
  dragVectorPenContourStart,
  dragVectorPenPoint,
  finishVectorPenContourAtVertex,
  type VectorPenContourStart,
  type VectorPenPointEdit,
} from "./vector-pen-edit.js";

export interface PenDraft {
  activeVertexId: string | null;
  network: VectorNetwork;
  pendingStart?: VectorPenContourStart;
  sourceTangentOut?: Point;
}

export interface PenDraftAnchor extends Point {
  id: string;
}

export type PenDraftMutationResult =
  | { edit?: VectorPenPointEdit; ok: true }
  | { code: VectorEditFailureCode; message: string; ok: false };

const HANDLE_EPSILON = 0.5;

export function createPenDraft(point: Point): PenDraft {
  return {
    activeVertexId: null,
    network: emptyVectorNetwork(),
    pendingStart: createVectorPenContourStart(point),
  };
}

export function clonePenDraft(draft: PenDraft): PenDraft {
  return structuredClone(draft);
}

export function penDraftHasMaterial(draft: PenDraft): boolean {
  return draft.network.paths.length > 0;
}

export function penDraftAnchors(draft: PenDraft): PenDraftAnchor[] {
  return draft.network.vertices.map(({ id, x, y }) => ({ id, x, y }));
}

export function penDraftActivePoint(draft: PenDraft): Point | null {
  if (draft.pendingStart) return draft.pendingStart.point;
  if (!draft.activeVertexId) return null;
  return (
    draft.network.vertices.find(({ id }) => id === draft.activeVertexId) ?? null
  );
}

export function startPenPathAtVertex(
  draft: PenDraft,
  vertexId: string,
): boolean {
  if (!draft.network.vertices.some(({ id }) => id === vertexId)) return false;
  draft.activeVertexId = vertexId;
  delete draft.pendingStart;
  delete draft.sourceTangentOut;
  return true;
}

export function startIndependentPenPath(draft: PenDraft, point: Point): void {
  draft.activeVertexId = null;
  draft.pendingStart = createVectorPenContourStart(point);
  delete draft.sourceTangentOut;
}

export function dragPenPathStart(draft: PenDraft, pointer: Point): void {
  if (draft.pendingStart) {
    draft.pendingStart = dragVectorPenContourStart(draft.pendingStart, pointer);
    return;
  }
  const point = penDraftActivePoint(draft);
  if (!point) return;
  const tangent = { x: pointer.x - point.x, y: pointer.y - point.y };
  if (Math.hypot(tangent.x, tangent.y) < HANDLE_EPSILON) {
    delete draft.sourceTangentOut;
  } else {
    draft.sourceTangentOut = tangent;
  }
}

export function appendPenPoint(
  draft: PenDraft,
  point: Point,
): PenDraftMutationResult {
  const result = draft.pendingStart
    ? beginVectorPenContour(draft.network, draft.pendingStart, point)
    : draft.activeVertexId
      ? beginVectorPenAppend(
          draft.network,
          draft.activeVertexId,
          point,
          draft.sourceTangentOut,
        )
      : null;
  if (!result) return failure("no-op", "Pen path has no active start point");
  if (!result.ok) return result;
  draft.network = result.edit.network;
  draft.activeVertexId = result.edit.vertexId;
  delete draft.pendingStart;
  delete draft.sourceTangentOut;
  return { edit: result.edit, ok: true };
}

export function dragAppendedPenPoint(
  draft: PenDraft,
  edit: VectorPenPointEdit,
  pointer: Point,
): PenDraftMutationResult {
  const delta = {
    x: pointer.x - edit.point.x,
    y: pointer.y - edit.point.y,
  };
  if (Math.hypot(delta.x, delta.y) < HANDLE_EPSILON) {
    draft.network = edit.base;
    delete draft.sourceTangentOut;
    return { edit: { ...edit, network: edit.base }, ok: true };
  }
  const result = dragVectorPenPoint(edit, pointer);
  if (!result.ok) return result;
  draft.network = result.edit.network;
  draft.sourceTangentOut = delta;
  return { edit: result.edit, ok: true };
}

export function finishPenPathAtVertex(
  draft: PenDraft,
  targetVertexId: string,
): PenDraftMutationResult {
  if (draft.pendingStart) {
    const result = finishVectorPenContourAtVertex(
      draft.network,
      draft.pendingStart,
      targetVertexId,
    );
    if (!result.ok) return result;
    draft.network = result.edit.network;
    finishPenPath(draft);
    return { ok: true };
  }
  const sourceVertexId = draft.activeVertexId;
  if (!sourceVertexId || sourceVertexId === targetVertexId) {
    return failure("no-op", "Pen path cannot finish on its active endpoint");
  }
  const beforeSegmentIds = new Set(draft.network.segments.map(({ id }) => id));
  const result = connectVectorEndpoints(draft.network, [
    sourceVertexId,
    targetVertexId,
  ]);
  if (!result.ok) return result;
  if (draft.sourceTangentOut) {
    applySourceTangent(
      result.network,
      beforeSegmentIds,
      sourceVertexId,
      draft.sourceTangentOut,
    );
  }
  const issues = validateVectorNetwork(result.network);
  if (issues.length > 0) {
    return failure(
      "invalid-network",
      issues.map(({ message }) => message).join("; "),
    );
  }
  draft.network = result.network;
  finishPenPath(draft);
  return { ok: true };
}

export function finishPenPath(draft: PenDraft): void {
  draft.activeVertexId = null;
  delete draft.pendingStart;
  delete draft.sourceTangentOut;
}

export function penDraftPreviewPath(
  draft: PenDraft,
  cursor: Point | undefined,
  targetVertexId: string | undefined,
): string | null {
  const preview = clonePenDraft(draft);
  if (targetVertexId && (preview.pendingStart || preview.activeVertexId)) {
    finishPenPathAtVertex(preview, targetVertexId);
  } else if (cursor && (preview.pendingStart || preview.activeVertexId)) {
    appendPenPoint(preview, cursor);
  }
  if (!penDraftHasMaterial(preview)) return null;
  const serialized = serializeVectorNetwork(preview.network);
  return serialized.ok ? serialized.path : null;
}

export function penDraftHandlePath(draft: PenDraft): string | null {
  const parts = draft.network.vertices.flatMap((vertex) =>
    listVectorVertexHandles(draft.network, vertex.id).map(
      ({ position }) =>
        `M ${number(vertex.x)} ${number(vertex.y)} L ${number(position.x)} ${number(position.y)}`,
    ),
  );
  const start = penDraftActivePoint(draft);
  const tangent = draft.pendingStart?.tangentOut ?? draft.sourceTangentOut;
  if (start && tangent) {
    parts.push(
      `M ${number(start.x - tangent.x)} ${number(start.y - tangent.y)} L ${number(start.x + tangent.x)} ${number(start.y + tangent.y)}`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

export function penDraftHasFillRegion(draft: PenDraft): boolean {
  return draft.network.regions.length > 0;
}

export function penDraftPreviewHasFillRegion(
  draft: PenDraft,
  targetVertexId: string | undefined,
): boolean {
  if (penDraftHasFillRegion(draft)) return true;
  if (!targetVertexId) return false;
  const preview = clonePenDraft(draft);
  const result = finishPenPathAtVertex(preview, targetVertexId);
  return result.ok && penDraftHasFillRegion(preview);
}

function emptyVectorNetwork(): VectorNetwork {
  return { paths: [], regions: [], segments: [], vertices: [] };
}

function applySourceTangent(
  network: VectorNetwork,
  beforeSegmentIds: ReadonlySet<string>,
  sourceVertexId: string,
  tangent: Point,
): void {
  const segment = network.segments.find(({ id }) => !beforeSegmentIds.has(id));
  if (!segment) return;
  if (segment.startVertexId === sourceVertexId) {
    segment.tangentStart = { ...tangent };
  } else if (segment.endVertexId === sourceVertexId) {
    segment.tangentEnd = { ...tangent };
  } else {
    return;
  }
  const vertex = network.vertices.find(({ id }) => id === sourceVertexId);
  if (vertex) vertex.handleMode = inferVectorPointMode(network, sourceVertexId);
}

function failure(
  code: VectorEditFailureCode,
  message: string,
): Extract<PenDraftMutationResult, { ok: false }> {
  return { code, message, ok: false };
}

function number(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
