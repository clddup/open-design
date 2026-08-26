import {
  DEFAULT_AUTO_LAYOUT_FRAME_SIZING,
  DEFAULT_LAYOUT_SIZING,
  type DesignDocument,
  type GridChildPlacement,
  type GridTrack,
  type LayoutSizing,
  type Transform,
} from "@opendesign/design-contracts";
import {
  GRID_AUTO_LAYOUT_CONTRACT_VERSION,
  solveGridAutoLayout,
} from "@opendesign/layout-service";
import {
  effectivelyLockedForEditorOverlay,
  hasTranslationOnlyTransform,
  supportsOrientedEditorOverlay,
} from "./editor-overlay-support.js";
import { getVisibleWorldTransform } from "./scene-node-transform.js";

export const MAX_GRID_EDITOR_TRACK_CONTROLS = 512;
export const MAX_GRID_EDITOR_GUIDE_TRACKS = 1_024;
export const GRID_EDITOR_VIEWPORT_OVERSCAN = 64;

export type GridEditorAxis = "rows" | "columns";

export interface GridEditorTrackSpec {
  axis: GridEditorAxis;
  authoredTrack: GridTrack;
  center: number;
  end: number;
  editable: boolean;
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
  frameId: string;
  frameSize: { height: number; width: number };
  itemsPositioning: "manual" | "row-auto-flow";
  padding: { bottom: number; left: number; right: number; top: number };
  rowInsertions: readonly GridEditorInsertionSpec[];
  rows: readonly GridEditorTrackSpec[];
  transform: Transform;
}

export interface GridEditorCellSpec {
  column: number;
  height: number;
  row: number;
  width: number;
  x: number;
  y: number;
}

export interface GridEditorViewportProjection {
  controlColumns: readonly GridEditorTrackSpec[];
  controlRows: readonly GridEditorTrackSpec[];
  guideColumns: readonly GridEditorTrackSpec[];
  guideRows: readonly GridEditorTrackSpec[];
}

export function createGridEditorOverlayPlan(
  document: DesignDocument,
  frameId: string | undefined,
): GridEditorOverlayPlan | null {
  const frame = frameId ? document.nodesById[frameId] : undefined;
  const grid =
    frame?.kind === "frame" || frame?.kind === "slot"
      ? frame.properties.autoLayout
      : undefined;
  if (
    !frame ||
    (frame.kind !== "frame" && frame.kind !== "slot") ||
    !grid ||
    grid.mode !== "grid" ||
    frame.size.width <= 0 ||
    frame.size.height <= 0 ||
    effectivelyLockedForEditorOverlay(document, frame.id)
  ) {
    return null;
  }
  const transform = getVisibleWorldTransform(document.nodesById, frame.id);
  if (!transform || !supportsOrientedEditorOverlay(transform)) return null;

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
  const rows = createTrackSpecs(
    frame.id,
    "rows",
    resolution.rowSizes,
    resolution.rows,
    grid.padding.top,
    grid.rowGap,
    grid.autoTracks !== "rows",
  );
  const columns = createTrackSpecs(
    frame.id,
    "columns",
    resolution.columnSizes,
    grid.columns,
    grid.padding.left,
    grid.columnGap,
    true,
  );
  const plan = {
    frameId: frame.id,
    frameSize: frame.size,
    itemsPositioning: grid.itemsPositioning,
    padding: grid.padding,
    transform,
    rows,
    columns,
    rowInsertions: createInsertionSpecs("rows", rows),
    columnInsertions: createInsertionSpecs("columns", columns),
  };
  return plan;
}

export function createGridEditorViewportProjection(
  plan: GridEditorOverlayPlan,
  viewport: {
    height: number;
    transform: Transform;
    width: number;
  },
  pinned?: { axis: GridEditorAxis; index: number },
): GridEditorViewportProjection {
  const bounds = frameLocalViewportBounds(viewport);
  if (!bounds) return emptyViewportProjection();
  const scaleX = Math.hypot(viewport.transform[0], viewport.transform[1]);
  const scaleY = Math.hypot(viewport.transform[2], viewport.transform[3]);
  const visibleColumns = tracksIntersecting(
    plan.columns,
    bounds.left,
    bounds.right,
  );
  const visibleRows = tracksIntersecting(plan.rows, bounds.top, bounds.bottom);
  const controlColumns = spacedTracks(visibleColumns, scaleX, 18);
  const controlRows = spacedTracks(visibleRows, scaleY, 18);
  const guideColumns = spacedTracks(visibleColumns, scaleX, 2);
  const guideRows = spacedTracks(visibleRows, scaleY, 2);
  const controlBudgets = axisBudgets(
    controlColumns.length,
    controlRows.length,
    MAX_GRID_EDITOR_TRACK_CONTROLS,
  );
  if (pinned?.axis === "columns" && controlBudgets.columns === 0) {
    controlBudgets.columns = 1;
    controlBudgets.rows = Math.max(0, controlBudgets.rows - 1);
  } else if (pinned?.axis === "rows" && controlBudgets.rows === 0) {
    controlBudgets.rows = 1;
    controlBudgets.columns = Math.max(0, controlBudgets.columns - 1);
  }
  const guideBudgets = axisBudgets(
    guideColumns.length,
    guideRows.length,
    MAX_GRID_EDITOR_GUIDE_TRACKS,
  );
  return {
    controlColumns: pinTrack(
      sampledTracks(controlColumns, controlBudgets.columns),
      pinned?.axis === "columns" ? plan.columns[pinned.index] : undefined,
      controlBudgets.columns,
    ),
    controlRows: pinTrack(
      sampledTracks(controlRows, controlBudgets.rows),
      pinned?.axis === "rows" ? plan.rows[pinned.index] : undefined,
      controlBudgets.rows,
    ),
    guideColumns: sampledTracks(guideColumns, guideBudgets.columns),
    guideRows: sampledTracks(guideRows, guideBudgets.rows),
  };
}

function frameLocalViewportBounds(viewport: {
  height: number;
  transform: Transform;
  width: number;
}): { bottom: number; left: number; right: number; top: number } | null {
  const [a, b, c, d, e, f] = viewport.transform;
  const determinant = a * d - b * c;
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !Number.isFinite(determinant) ||
    Math.abs(determinant) <= Number.EPSILON
  ) {
    return null;
  }
  const inverse: Transform = [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
  const overscan = GRID_EDITOR_VIEWPORT_OVERSCAN;
  const points = [
    { x: -overscan, y: -overscan },
    { x: viewport.width + overscan, y: -overscan },
    { x: viewport.width + overscan, y: viewport.height + overscan },
    { x: -overscan, y: viewport.height + overscan },
  ].map(({ x, y }) => ({
    x: inverse[0] * x + inverse[2] * y + inverse[4],
    y: inverse[1] * x + inverse[3] * y + inverse[5],
  }));
  return {
    bottom: Math.max(...points.map((point) => point.y)),
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
  };
}

function tracksIntersecting(
  tracks: readonly GridEditorTrackSpec[],
  minimum: number,
  maximum: number,
): GridEditorTrackSpec[] {
  if (tracks.length === 0 || maximum < minimum) return [];
  let low = 0;
  let high = tracks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (tracks[middle]!.end < minimum) low = middle + 1;
    else high = middle;
  }
  const visible: GridEditorTrackSpec[] = [];
  for (let index = low; index < tracks.length; index += 1) {
    const track = tracks[index]!;
    if (track.start > maximum) break;
    visible.push(track);
  }
  return visible;
}

function spacedTracks(
  tracks: readonly GridEditorTrackSpec[],
  screenScale: number,
  minimumScreenDistance: number,
): GridEditorTrackSpec[] {
  if (tracks.length <= 1) return [...tracks];
  const scale = Math.max(0.000_001, screenScale);
  const minimumDistance = minimumScreenDistance / scale;
  const result: GridEditorTrackSpec[] = [];
  let lastCoordinate = Number.NEGATIVE_INFINITY;
  for (const track of tracks) {
    if (track.center - lastCoordinate < minimumDistance) continue;
    result.push(track);
    lastCoordinate = track.center;
  }
  const last = tracks.at(-1)!;
  if (result.at(-1)?.id !== last.id) result.push(last);
  return result;
}

function axisBudgets(
  columns: number,
  rows: number,
  total: number,
): { columns: number; rows: number } {
  if (columns === 0) return { columns: 0, rows: total };
  if (rows === 0) return { columns: total, rows: 0 };
  const columnBudget = Math.max(
    1,
    Math.min(total - 1, Math.round((total * columns) / (columns + rows))),
  );
  return { columns: columnBudget, rows: total - columnBudget };
}

function sampledTracks(
  tracks: readonly GridEditorTrackSpec[],
  budget: number,
): GridEditorTrackSpec[] {
  if (tracks.length <= budget) return [...tracks];
  if (budget <= 0) return [];
  if (budget === 1) return [tracks[0]!];
  const sampled: GridEditorTrackSpec[] = [];
  for (let index = 0; index < budget; index += 1) {
    const sourceIndex = Math.round(
      (index * (tracks.length - 1)) / (budget - 1),
    );
    const track = tracks[sourceIndex]!;
    if (sampled.at(-1)?.id !== track.id) sampled.push(track);
  }
  return sampled;
}

function pinTrack(
  tracks: readonly GridEditorTrackSpec[],
  pinned: GridEditorTrackSpec | undefined,
  budget: number,
): GridEditorTrackSpec[] {
  if (!pinned || tracks.some((track) => track.id === pinned.id)) {
    return [...tracks];
  }
  const result = [...tracks];
  if (result.length >= budget) result.pop();
  return [...result, pinned].sort((left, right) => left.index - right.index);
}

function emptyViewportProjection(): GridEditorViewportProjection {
  return {
    controlColumns: [],
    controlRows: [],
    guideColumns: [],
    guideRows: [],
  };
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

export function nearestGridCell(
  plan: GridEditorOverlayPlan,
  point: { x: number; y: number },
): GridEditorCellSpec | null {
  const row = nearestTrack(plan.rows, point.y);
  const column = nearestTrack(plan.columns, point.x);
  if (!row || !column) return null;
  return {
    column: column.index,
    height: row.resolvedSize,
    row: row.index,
    width: column.resolvedSize,
    x: column.start,
    y: row.start,
  };
}

export function gridAreaForPlacement(
  plan: GridEditorOverlayPlan,
  placement: Pick<
    GridChildPlacement,
    "row" | "column" | "rowSpan" | "columnSpan"
  >,
): GridEditorCellSpec | null {
  const firstRow = plan.rows[placement.row];
  const lastRow = plan.rows[placement.row + placement.rowSpan - 1];
  const firstColumn = plan.columns[placement.column];
  const lastColumn = plan.columns[placement.column + placement.columnSpan - 1];
  if (!firstRow || !lastRow || !firstColumn || !lastColumn) return null;
  return {
    column: placement.column,
    height: lastRow.end - firstRow.start,
    row: placement.row,
    width: lastColumn.end - firstColumn.start,
    x: firstColumn.start,
    y: firstRow.start,
  };
}

export function gridChildSpanTargetFromBounds(
  plan: GridEditorOverlayPlan,
  placement: GridChildPlacement,
  sizing: LayoutSizing,
  before: { x: number; y: number; width: number; height: number },
  next: { x: number; y: number; width: number; height: number },
): Pick<
  GridChildPlacement,
  "row" | "column" | "rowSpan" | "columnSpan"
> | null {
  let row = placement.row;
  let column = placement.column;
  let rowEnd = placement.row + placement.rowSpan;
  let columnEnd = placement.column + placement.columnSpan;
  if (sizing.horizontal === "fill") {
    if (!nearlyEqual(before.x, next.x)) {
      column = nearestBoundaryIndex(plan.columns, next.x, "start");
    }
    if (!nearlyEqual(before.x + before.width, next.x + next.width)) {
      columnEnd = nearestBoundaryIndex(
        plan.columns,
        next.x + next.width,
        "end",
      );
    }
  }
  if (sizing.vertical === "fill") {
    if (!nearlyEqual(before.y, next.y)) {
      row = nearestBoundaryIndex(plan.rows, next.y, "start");
    }
    if (!nearlyEqual(before.y + before.height, next.y + next.height)) {
      rowEnd = nearestBoundaryIndex(plan.rows, next.y + next.height, "end");
    }
  }
  if (
    row < 0 ||
    column < 0 ||
    rowEnd <= row ||
    columnEnd <= column ||
    rowEnd > plan.rows.length ||
    columnEnd > plan.columns.length
  ) {
    return null;
  }
  if (
    plan.itemsPositioning === "row-auto-flow" &&
    (row !== placement.row || column !== placement.column)
  ) {
    return null;
  }
  return {
    row,
    column,
    rowSpan: rowEnd - row,
    columnSpan: columnEnd - column,
  };
}

function nearestBoundaryIndex(
  tracks: readonly GridEditorTrackSpec[],
  coordinate: number,
  edge: "start" | "end",
): number {
  const boundaries = tracks.map((track, index) => ({
    coordinate: edge === "start" ? track.start : track.end,
    index: edge === "start" ? index : index + 1,
  }));
  let nearest = boundaries[0]!;
  for (const candidate of boundaries.slice(1)) {
    if (
      Math.abs(candidate.coordinate - coordinate) <
      Math.abs(nearest.coordinate - coordinate)
    ) {
      nearest = candidate;
    }
  }
  return nearest.index;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.5;
}

function nearestTrack(
  tracks: readonly GridEditorTrackSpec[],
  coordinate: number,
): GridEditorTrackSpec | undefined {
  let nearest = tracks[0];
  for (const candidate of tracks.slice(1)) {
    if (
      !nearest ||
      Math.abs(candidate.center - coordinate) <
        Math.abs(nearest.center - coordinate)
    ) {
      nearest = candidate;
    }
  }
  return nearest;
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
  editable: boolean,
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
      editable,
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
