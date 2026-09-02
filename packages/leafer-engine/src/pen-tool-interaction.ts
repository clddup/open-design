import type { Point } from "@opendesign/design-contracts";
import { constrainPointToOctant } from "./angle-constraint.js";
import {
  appendPenPoint,
  clonePenDraft,
  dragAppendedPenPoint,
  dragPenPathStart,
  finishPenPath,
  finishPenPathAtVertex,
  penDraftActivePoint,
  penDraftAnchors,
  penDraftHasMaterial,
  startIndependentPenPath,
  startPenPathAtVertex,
  type PenDraft,
  type PenDraftMutationResult,
} from "./pen-tool.js";
import type { VectorPenPointEdit } from "./vector-pen-edit.js";

export type PenToolDrag =
  | { edit: VectorPenPointEdit; kind: "point"; startClient: Point }
  | { kind: "start"; startClient: Point };

export interface PenInteractionSession {
  cursor: Point;
  draft: PenDraft;
  drag: PenToolDrag | null;
  history: PenDraft[];
  targetVertexId?: string;
}

export type PenEscapeAction = "cancel" | "commit" | "continue";

const MATRIX_EPSILON = 0.000_001;
const MIN_DRAW_DISTANCE = 4;
const PEN_ANCHOR_HIT_DISTANCE = 10;

export function startPenPath(
  session: PenInteractionSession,
  point: Point,
  targetVertexId: string | undefined,
  startClient: Point,
): boolean {
  session.history.push(clonePenDraft(session.draft));
  const started = targetVertexId
    ? startPenPathAtVertex(session.draft, targetVertexId)
    : (startIndependentPenPath(session.draft, point), true);
  if (!started) {
    session.history.pop();
    return false;
  }
  session.cursor = targetVertexId
    ? (pointForVertex(session.draft, targetVertexId) ?? point)
    : point;
  session.drag = { kind: "start", startClient };
  delete session.targetVertexId;
  return true;
}

export function appendPenPathPoint(
  session: PenInteractionSession,
  point: Point,
  startClient: Point,
  shiftKey: boolean,
  zoom: number,
): PenDraftMutationResult {
  const active = penDraftActivePoint(session.draft);
  if (!active) return failure("Pen path has no active point");
  const local = shiftKey ? constrainPointToOctant(active, point) : point;
  if (pointDistance(active, local) * normalizedZoom(zoom) < MIN_DRAW_DISTANCE) {
    return failure("New Pen point overlaps its active point");
  }
  session.history.push(clonePenDraft(session.draft));
  const result = appendPenPoint(session.draft, local);
  if (!result.ok || !result.edit) {
    session.history.pop();
    return result;
  }
  session.cursor = local;
  session.drag = { edit: result.edit, kind: "point", startClient };
  delete session.targetVertexId;
  return result;
}

export function finishPenPathOnTarget(
  session: PenInteractionSession,
  targetVertexId: string,
): PenDraftMutationResult {
  session.history.push(clonePenDraft(session.draft));
  const result = finishPenPathAtVertex(session.draft, targetVertexId);
  if (!result.ok) {
    session.history.pop();
    return result;
  }
  session.cursor =
    pointForVertex(session.draft, targetVertexId) ?? session.cursor;
  session.drag = null;
  delete session.targetVertexId;
  return result;
}

export function dragPenPointer(
  session: PenInteractionSession,
  point: Point,
  client: Point,
  shiftKey: boolean,
): PenDraftMutationResult | null {
  const drag = session.drag;
  if (!drag) return null;
  const anchor =
    drag.kind === "point"
      ? drag.edit.point
      : penDraftActivePoint(session.draft);
  if (!anchor) return null;
  const moved = pointDistance(drag.startClient, client) >= MIN_DRAW_DISTANCE;
  const local = !moved
    ? anchor
    : shiftKey
      ? constrainPointToOctant(anchor, point)
      : point;
  session.cursor = local;
  delete session.targetVertexId;
  if (drag.kind === "start") {
    dragPenPathStart(session.draft, local);
    return null;
  }
  return dragAppendedPenPoint(session.draft, drag.edit, local);
}

export function hoverPenPointer(
  session: PenInteractionSession,
  point: Point,
  shiftKey: boolean,
  zoom: number,
): void {
  const targetVertexId = targetPenVertexId(session, point, zoom);
  if (targetVertexId) {
    session.targetVertexId = targetVertexId;
    session.cursor = pointForVertex(session.draft, targetVertexId) ?? point;
    return;
  }
  delete session.targetVertexId;
  const active = penDraftActivePoint(session.draft);
  session.cursor =
    shiftKey && active ? constrainPointToOctant(active, point) : point;
}

export function escapePenPath(session: PenInteractionSession): PenEscapeAction {
  if (!penDraftActivePoint(session.draft)) return "commit";
  if (!penDraftHasMaterial(session.draft) && session.draft.pendingStart) {
    return "cancel";
  }
  session.history.push(clonePenDraft(session.draft));
  finishPenPath(session.draft);
  session.drag = null;
  delete session.targetVertexId;
  return "continue";
}

export function restorePreviousPenDraft(
  session: PenInteractionSession,
): boolean {
  const previous = session.history.pop();
  if (!previous) return false;
  session.draft = previous;
  session.drag = null;
  delete session.targetVertexId;
  session.cursor =
    penDraftActivePoint(previous) ??
    penDraftAnchors(previous).at(-1) ??
    session.cursor;
  return true;
}

export function targetPenVertexId(
  session: PenInteractionSession,
  point: Point,
  zoom: number,
): string | undefined {
  const activeVertexId = session.draft.activeVertexId;
  return penDraftAnchors(session.draft)
    .filter(({ id }) => id !== activeVertexId)
    .map((anchor) => ({
      distance: pointDistance(anchor, point) * normalizedZoom(zoom),
      id: anchor.id,
    }))
    .filter(({ distance }) => distance <= PEN_ANCHOR_HIT_DISTANCE)
    .sort((left, right) => left.distance - right.distance)[0]?.id;
}

export function syncPenHoverTarget(
  session: PenInteractionSession,
  point: Point,
  zoom: number,
): void {
  const targetVertexId = targetPenVertexId(session, point, zoom);
  if (targetVertexId) session.targetVertexId = targetVertexId;
  else delete session.targetVertexId;
}

function pointForVertex(draft: PenDraft, vertexId: string): Point | undefined {
  return draft.network.vertices.find(({ id }) => id === vertexId);
}

function normalizedZoom(value: number): number {
  return Math.max(MATRIX_EPSILON, Math.abs(value));
}

function pointDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function failure(
  message: string,
): Extract<PenDraftMutationResult, { ok: false }> {
  return { code: "no-op", message, ok: false };
}
