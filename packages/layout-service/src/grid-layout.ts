export type GridTrack =
  | { type: "fixed"; value: number }
  | { type: "fill"; value: number }
  | { type: "hug" };

export const GRID_AUTO_LAYOUT_CONTRACT_VERSION = 2 as const;

export type GridChildPlacement = {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  horizontalAlign: "start" | "center" | "end" | "auto";
  verticalAlign: "start" | "center" | "end" | "auto";
};

type AxisSizing = "fixed" | "fill";
type FrameAxisSizing = "fixed" | "hug";
type Limits = {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
};

export type GridAutoLayoutRequest = {
  version: typeof GRID_AUTO_LAYOUT_CONTRACT_VERSION;
  frame: { width: number; height: number };
  frameSizing: { horizontal: FrameAxisSizing; vertical: FrameAxisSizing };
  frameLimits?: Limits;
  padding: { top: number; right: number; bottom: number; left: number };
  rowGap: number;
  columnGap: number;
  rows: GridTrack[];
  columns: GridTrack[];
  itemsPositioning: "manual" | "row-auto-flow";
  autoTracks?: "rows";
  children: Array<{
    id: string;
    width: number;
    height: number;
    sizing: { horizontal: AxisSizing; vertical: AxisSizing };
    limits?: Limits;
    placement?: GridChildPlacement;
  }>;
};

export type GridAutoLayoutResult =
  | {
      ok: true;
      frame: { width: number; height: number };
      placements: Array<{
        id: string;
        x: number;
        y: number;
        width: number;
        height: number;
        placement: GridChildPlacement;
      }>;
      rowSizes: number[];
      columnSizes: number[];
      rows: GridTrack[];
    }
  | {
      ok: false;
      code: "invalid-input" | "placement-conflict" | "sizing-conflict";
      message: string;
    };

export function solveGridAutoLayout(
  request: GridAutoLayoutRequest,
): GridAutoLayoutResult {
  if (!validRequest(request))
    return failure("invalid-input", "Grid Auto Layout input is invalid");
  if (
    (request.frameSizing.horizontal === "hug" &&
      request.columns.some(isFill)) ||
    (request.frameSizing.vertical === "hug" &&
      (request.rows.some(isFill) || request.autoTracks === "rows"))
  ) {
    return failure(
      "sizing-conflict",
      "A hugged Grid axis cannot contain Fill tracks",
    );
  }

  const effectiveRows = [...request.rows];
  const placements = resolvePlacements(request, effectiveRows);
  if (!placements.ok) return placements;
  const columnSizes = resolveTracks(
    request.columns,
    placements.value,
    "horizontal",
    request.frame.width,
    request.padding.left + request.padding.right,
    request.columnGap,
    request.frameSizing.horizontal,
  );
  const rowSizes = resolveTracks(
    effectiveRows,
    placements.value,
    "vertical",
    request.frame.height,
    request.padding.top + request.padding.bottom,
    request.rowGap,
    request.frameSizing.vertical,
  );
  const naturalWidth =
    request.padding.left +
    request.padding.right +
    sum(columnSizes) +
    request.columnGap * Math.max(0, columnSizes.length - 1);
  const naturalHeight =
    request.padding.top +
    request.padding.bottom +
    sum(rowSizes) +
    request.rowGap * Math.max(0, rowSizes.length - 1);
  const frame = {
    width: clampExtent(
      request.frameSizing.horizontal === "hug"
        ? naturalWidth
        : request.frame.width,
      request.frameLimits,
      "horizontal",
      request.padding.left + request.padding.right,
    ),
    height: clampExtent(
      request.frameSizing.vertical === "hug"
        ? naturalHeight
        : request.frame.height,
      request.frameLimits,
      "vertical",
      request.padding.top + request.padding.bottom,
    ),
  };

  return {
    ok: true,
    frame,
    rowSizes,
    columnSizes,
    rows: effectiveRows,
    placements: placements.value.map(({ child, placement }) => {
      const area = gridArea(
        placement,
        rowSizes,
        columnSizes,
        request.padding,
        request.rowGap,
        request.columnGap,
      );
      const width =
        child.sizing.horizontal === "fill"
          ? clampExtent(area.width, child.limits, "horizontal", 0)
          : clampExtent(child.width, child.limits, "horizontal", 0);
      const height =
        child.sizing.vertical === "fill"
          ? clampExtent(area.height, child.limits, "vertical", 0)
          : clampExtent(child.height, child.limits, "vertical", 0);
      return {
        id: child.id,
        placement,
        x: alignedStart(area.x, area.width, width, placement.horizontalAlign),
        y: alignedStart(area.y, area.height, height, placement.verticalAlign),
        width,
        height,
      };
    }),
  };
}

function resolvePlacements(
  request: GridAutoLayoutRequest,
  rows: GridTrack[],
):
  | {
      ok: true;
      value: Array<{
        child: GridAutoLayoutRequest["children"][number];
        placement: GridChildPlacement;
      }>;
    }
  | Extract<GridAutoLayoutResult, { ok: false }> {
  const occupied = new Set<string>();
  const value: Array<{
    child: GridAutoLayoutRequest["children"][number];
    placement: GridChildPlacement;
  }> = [];
  for (const child of request.children) {
    let placement =
      request.itemsPositioning === "manual"
        ? child.placement
        : nextAutoPlacement(
            occupied,
            rows.length,
            request.columns.length,
            child.placement,
          );
    while (
      !placement &&
      request.autoTracks === "rows" &&
      request.itemsPositioning === "row-auto-flow" &&
      rows.length < 4_096
    ) {
      rows.push({ type: "fill", value: 1 });
      placement = nextAutoPlacement(
        occupied,
        rows.length,
        request.columns.length,
        child.placement,
      );
    }
    if (!placement) {
      return failure(
        "placement-conflict",
        `Grid child ${child.id} has no available explicit cell`,
      );
    }
    if (!placementFits(placement, rows.length, request.columns.length)) {
      return failure(
        "placement-conflict",
        `Grid child ${child.id} extends outside the declared tracks`,
      );
    }
    for (const cell of occupiedCells(placement)) {
      if (occupied.has(cell)) {
        return failure(
          "placement-conflict",
          `Grid child ${child.id} overlaps another child at ${cell}`,
        );
      }
    }
    for (const cell of occupiedCells(placement)) occupied.add(cell);
    value.push({ child, placement });
  }
  if (request.autoTracks === "rows") {
    const requiredRows = Math.max(
      1,
      ...value.map(({ placement }) => placement.row + placement.rowSpan),
    );
    rows.splice(requiredRows);
  }
  return { ok: true, value };
}

function nextAutoPlacement(
  occupied: ReadonlySet<string>,
  rowCount: number,
  columnCount: number,
  authored?: GridChildPlacement,
): GridChildPlacement | undefined {
  const rowSpan = authored?.rowSpan ?? 1;
  const columnSpan = authored?.columnSpan ?? 1;
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const candidate: GridChildPlacement = {
        row,
        column,
        rowSpan,
        columnSpan,
        horizontalAlign: authored?.horizontalAlign ?? "auto",
        verticalAlign: authored?.verticalAlign ?? "auto",
      };
      if (
        placementFits(candidate, rowCount, columnCount) &&
        occupiedCells(candidate).every((cell) => !occupied.has(cell))
      )
        return candidate;
    }
  }
  return undefined;
}

function resolveTracks(
  tracks: readonly GridTrack[],
  children: Array<{
    child: GridAutoLayoutRequest["children"][number];
    placement: GridChildPlacement;
  }>,
  axis: "horizontal" | "vertical",
  frameExtent: number,
  padding: number,
  gap: number,
  sizing: FrameAxisSizing,
): number[] {
  const sizes = tracks.map((track) =>
    track.type === "fixed" ? track.value : 0,
  );
  const gapTotal = gap * Math.max(0, tracks.length - 1);
  for (const { child, placement } of children) {
    const start = axis === "horizontal" ? placement.column : placement.row;
    const span =
      axis === "horizontal" ? placement.columnSpan : placement.rowSpan;
    const extent = clampExtent(
      axis === "horizontal" ? child.width : child.height,
      child.limits,
      axis,
      0,
    );
    const current = sum(sizes.slice(start, start + span)) + gap * (span - 1);
    const hugIndices = Array.from(
      { length: span },
      (_, index) => start + index,
    ).filter((index) => tracks[index]?.type === "hug");
    if (extent > current && hugIndices.length > 0) {
      const addition = (extent - current) / hugIndices.length;
      for (const index of hugIndices)
        sizes[index] = (sizes[index] ?? 0) + addition;
    }
  }
  if (sizing === "fixed") {
    const fillIndices = tracks.flatMap((track, index) =>
      track.type === "fill" ? [index] : [],
    );
    const fillWeight = sum(
      fillIndices.map(
        (index) => (tracks[index] as { type: "fill"; value: number }).value,
      ),
    );
    const remaining = Math.max(
      0,
      frameExtent - padding - gapTotal - sum(sizes),
    );
    for (const index of fillIndices) {
      const track = tracks[index] as { type: "fill"; value: number };
      sizes[index] = remaining * (track.value / fillWeight);
    }
  }
  return sizes;
}

function gridArea(
  placement: GridChildPlacement,
  rows: readonly number[],
  columns: readonly number[],
  padding: GridAutoLayoutRequest["padding"],
  rowGap: number,
  columnGap: number,
) {
  return {
    x:
      padding.left +
      sum(columns.slice(0, placement.column)) +
      columnGap * placement.column,
    y: padding.top + sum(rows.slice(0, placement.row)) + rowGap * placement.row,
    width:
      sum(
        columns.slice(
          placement.column,
          placement.column + placement.columnSpan,
        ),
      ) +
      columnGap * (placement.columnSpan - 1),
    height:
      sum(rows.slice(placement.row, placement.row + placement.rowSpan)) +
      rowGap * (placement.rowSpan - 1),
  };
}

function alignedStart(
  start: number,
  available: number,
  extent: number,
  alignment: GridChildPlacement["horizontalAlign"],
): number {
  if (alignment === "center") return start + (available - extent) / 2;
  if (alignment === "end") return start + available - extent;
  return start;
}

function placementFits(
  value: GridChildPlacement,
  rows: number,
  columns: number,
): boolean {
  return (
    value.row + value.rowSpan <= rows &&
    value.column + value.columnSpan <= columns
  );
}

function occupiedCells(value: GridChildPlacement): string[] {
  const cells: string[] = [];
  for (let row = value.row; row < value.row + value.rowSpan; row += 1)
    for (
      let column = value.column;
      column < value.column + value.columnSpan;
      column += 1
    )
      cells.push(`${row}:${column}`);
  return cells;
}

function validRequest(value: GridAutoLayoutRequest): boolean {
  return (
    value.version === GRID_AUTO_LAYOUT_CONTRACT_VERSION &&
    positiveSize(value.frame) &&
    finiteNonNegative(value.rowGap) &&
    finiteNonNegative(value.columnGap) &&
    value.rows.length > 0 &&
    value.rows.length <= 4_096 &&
    value.columns.length > 0 &&
    value.columns.length <= 4_096 &&
    value.rows.every(validTrack) &&
    value.columns.every(validTrack) &&
    (value.autoTracks === undefined ||
      (value.autoTracks === "rows" &&
        value.itemsPositioning === "row-auto-flow")) &&
    Object.values(value.padding).every(finiteNonNegative) &&
    value.children.every(
      (child) =>
        child.id.length > 0 &&
        positiveSize(child) &&
        (value.itemsPositioning === "row-auto-flow" ||
          child.placement !== undefined),
    )
  );
}

function validTrack(track: GridTrack): boolean {
  return (
    track.type === "hug" ||
    (finiteNonNegative(track.value) &&
      (track.type !== "fill" || track.value > 0))
  );
}

function isFill(
  track: GridTrack,
): track is Extract<GridTrack, { type: "fill" }> {
  return track.type === "fill";
}

function positiveSize(value: { width: number; height: number }): boolean {
  return finiteNonNegative(value.width) && finiteNonNegative(value.height);
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function clampExtent(
  value: number,
  limits: Limits | undefined,
  axis: "horizontal" | "vertical",
  minimum: number,
): number {
  const min = axis === "horizontal" ? limits?.minWidth : limits?.minHeight;
  const max = axis === "horizontal" ? limits?.maxWidth : limits?.maxHeight;
  return Math.max(
    minimum,
    min ?? 0,
    Math.min(value, max ?? Number.POSITIVE_INFINITY),
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function failure(
  code: Extract<GridAutoLayoutResult, { ok: false }>["code"],
  message: string,
): Extract<GridAutoLayoutResult, { ok: false }> {
  return { ok: false, code, message };
}
