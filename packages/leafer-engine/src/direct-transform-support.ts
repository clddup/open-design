import type {
  DirectGridChildMoveSession,
  DirectGridChildSpanSession,
} from "./direct-grid-transform-session.js";
import type { DirectTransformElementState } from "./direct-transform-element-state.js";
import type { LeaferElementSpec, LeaferSceneProjection } from "./mapping.js";
import type { LeaferEngineSyncInput, LeaferOperationKind } from "./types.js";

export interface LeaferBeforeScaleData {
  drag?: unknown;
  origin: unknown;
  scaleX: number;
  scaleY: number;
  target: unknown;
}

export interface DirectTransformSession {
  before: Map<string, DirectTransformElementState>;
  changed: boolean;
  documentId: string;
  kind: LeaferOperationKind;
  pageId: string;
  revision: number;
  selectionNodeIds: string[];
  gridChildMove?: DirectGridChildMoveSession;
  gridChildSpan?: DirectGridChildSpanSession;
}

export interface DirectTransformProjectionSync {
  changedNodeIds: ReadonlySet<string>;
  input: LeaferEngineSyncInput;
  projection: LeaferSceneProjection;
  projectionContinuityLost: boolean;
}

export function directOperationKind(editor: {
  moving: boolean;
  resizing: boolean;
  rotating: boolean;
  skewing: boolean;
}): LeaferOperationKind {
  if (editor.resizing) return "resize";
  if (editor.rotating) return "rotate";
  if (editor.skewing) return "skew";
  if (editor.moving) return "move";
  return "transform";
}

export function isLockedSpec(spec: LeaferElementSpec | undefined): boolean {
  const metadata = spec?.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignLocked === true
  );
}

export function isCenterOrigin(
  origin: unknown,
  bounds: { height: number; width: number; x: number; y: number } | undefined,
): boolean {
  if (!bounds || !isPoint(origin)) return false;
  return (
    Math.abs(origin.x - (bounds.x + bounds.width / 2)) <= 0.000_001 &&
    Math.abs(origin.y - (bounds.y + bounds.height / 2)) <= 0.000_001
  );
}

export function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== "object" || value === null) return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === "number" && typeof point.y === "number";
}
