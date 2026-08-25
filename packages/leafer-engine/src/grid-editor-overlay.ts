import {
  DEFAULT_AUTO_LAYOUT_FRAME_SIZING,
  DEFAULT_LAYOUT_SIZING,
  type DesignDocument,
  type GridTrack,
  type Transform,
} from "@opendesign/design-contracts";
import {
  GRID_AUTO_LAYOUT_CONTRACT_VERSION,
  solveGridAutoLayout,
} from "@opendesign/layout-service";
import {
  effectivelyLockedForEditorOverlay,
  hasTranslationOnlyTransform,
  supportsAxisAlignedEditorOverlay,
} from "./editor-overlay-support.js";
import { getVisibleWorldTransform } from "./scene-node-transform.js";

export const MAX_GRID_EDITOR_TRACK_CONTROLS = 512;

export type GridEditorAxis = "rows" | "columns";

export interface GridEditorTrackSpec {
  axis: GridEditorAxis;
  authoredTrack: GridTrack;
  center: number;
  end: number;
  id: string;
  index: number;
  label: string;
  resolvedSize: number;
  start: number;
}

export interface GridEditorInsertionSpec {
  axis: GridEditorAxis;
  coordinate: number;
  index: number;
}

export interface GridEditorOverlayPlan {
  columnInsertions: readonly GridEditorInsertionSpec[];
  columns: readonly GridEditorTrackSpec[];
  fingerprint: string;
  frameId: string;
  frameSize: { height: number; width: number };
  padding: { bottom: number; left: number; right: number; top: number };
  rowInsertions: readonly GridEditorInsertionSpec[];
  rows: readonly GridEditorTrackSpec[];
  transform: Transform;
}

export function createGridEditorOverlayPlan(
  document: DesignDocument,
  frameId: string | undefined,
): GridEditorOverlayPlan | null {
  const frame = frameId ? document.nodesById[frameId] : undefined;
  const grid =
    frame?.kind === "frame" ? frame.properties.autoLayout : undefined;
  if (
    frame?.kind !== "frame" ||
    !grid ||
    grid.mode !== "grid" ||
    grid.rows.length + grid.columns.length > MAX_GRID_EDITOR_TRACK_CONTROLS ||
    frame.size.width <= 0 ||
    frame.size.height <= 0 ||
    effectivelyLockedForEditorOverlay(document, frame.id)
  ) {
    return null;
  }
  const transform = getVisibleWorldTransform(document.nodesById, frame.id);
  if (!transform || !supportsAxisAlignedEditorOverlay(transform)) return null;

  const children = [];
  for (const childId of frame.childIds) {
    const child = document.nodesById[childId];
    if (!child || !hasTranslationOnlyTransform(child.transform)) return null;
    if (!child.visible || child.layoutPositioning === "absolute") continue;
    children.push({
      id: child.id,
      width: child.size.width,
      height: child.size.height,
      sizing: child.layoutSizing ?? DEFAULT_LAYOUT_SIZING,
      ...(child.layoutLimits ? { limits: child.layoutLimits } : {}),
      ...(child.gridPlacement ? { placement: child.gridPlacement } : {}),
    });
  }
  const resolution = solveGridAutoLayout({
    version: GRID_AUTO_LAYOUT_CONTRACT_VERSION,
    frame: frame.size,
    frameSizing: grid.sizing ?? DEFAULT_AUTO_LAYOUT_FRAME_SIZING,
    ...(frame.layoutLimits ? { frameLimits: frame.layoutLimits } : {}),
    padding: grid.padding,
    rowGap: grid.rowGap,
    columnGap: grid.columnGap,
    rows: grid.rows,
    columns: grid.columns,
    itemsPositioning: grid.itemsPositioning,
    ...(grid.autoTracks ? { autoTracks: grid.autoTracks } : {}),
    children,
  });
  if (!resolution.ok) return null;
  if (
    resolution.rowSizes.length + resolution.columnSizes.length >
    MAX_GRID_EDITOR_TRACK_CONTROLS
  ) {
    return null;
  }

  const rows = createTrackSpecs(
    frame.id,
    "rows",
    resolution.rowSizes,
    resolution.rows,
    grid.padding.top,
    grid.rowGap,
  );
  const columns = createTrackSpecs(
    frame.id,
    "columns",
    resolution.columnSizes,
    grid.columns,
    grid.padding.left,
    grid.columnGap,
  );
  const plan = {
    frameId: frame.id,
    frameSize: frame.size,
    padding: grid.padding,
    transform,
    rows,
    columns,
    rowInsertions: createInsertionSpecs("rows", rows),
    columnInsertions: createInsertionSpecs("columns", columns),
  };
  return { ...plan, fingerprint: JSON.stringify(plan) };
}

export function nearestGridInsertionIndex(
  plan: GridEditorOverlayPlan,
  axis: GridEditorAxis,
  coordinate: number,
): number {
  const insertions =
    axis === "rows" ? plan.rowInsertions : plan.columnInsertions;
  let nearest = insertions[0];
  for (const candidate of insertions.slice(1)) {
    if (
      !nearest ||
      Math.abs(candidate.coordinate - coordinate) <
        Math.abs(nearest.coordinate - coordinate)
    ) {
      nearest = candidate;
    }
  }
  return nearest?.index ?? 0;
}

export function gridTrackReorderChangesOrder(
  fromIndex: number,
  insertionIndex: number,
): boolean {
  return insertionIndex !== fromIndex && insertionIndex !== fromIndex + 1;
}

export function gridTrackSelectionReorderChangesOrder(
  fromIndices: readonly number[],
  insertionIndex: number,
  trackCount: number,
): boolean {
  const selected = new Set(fromIndices);
  if (
    selected.size === 0 ||
    insertionIndex < 0 ||
    insertionIndex > trackCount ||
    [...selected].some((index) => index < 0 || index >= trackCount)
  ) {
    return false;
  }
  const selectedIndices = [...selected].sort((left, right) => left - right);
  const remaining = Array.from(
    { length: trackCount },
    (_, index) => index,
  ).filter((index) => !selected.has(index));
  const insertionInRemaining = remaining.filter(
    (index) => index < insertionIndex,
  ).length;
  const nextOrder = [
    ...remaining.slice(0, insertionInRemaining),
    ...selectedIndices,
    ...remaining.slice(insertionInRemaining),
  ];
  return nextOrder.some((from, to) => from !== to);
}

function createTrackSpecs(
  frameId: string,
  axis: GridEditorAxis,
  sizes: readonly number[],
  tracks: readonly GridTrack[],
  origin: number,
  gap: number,
): GridEditorTrackSpec[] {
  let cursor = origin;
  return sizes.map((size, index) => {
    const start = cursor;
    const end = start + size;
    cursor = end + gap;
    return {
      axis,
      authoredTrack: tracks[index]!,
      center: (start + end) / 2,
      end,
      id: `${frameId}:${axis}:${index}`,
      index,
      label: String(index + 1),
      resolvedSize: size,
      start,
    };
  });
}

function createInsertionSpecs(
  axis: GridEditorAxis,
  tracks: readonly GridEditorTrackSpec[],
): GridEditorInsertionSpec[] {
  if (tracks.length === 0) return [];
  return Array.from({ length: tracks.length + 1 }, (_, index) => ({
    axis,
    coordinate:
      index === 0
        ? tracks[0]!.start
        : index === tracks.length
          ? tracks.at(-1)!.end
          : (tracks[index - 1]!.end + tracks[index]!.start) / 2,
    index,
  }));
}
