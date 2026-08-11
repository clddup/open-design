import type { Point, Rect } from "@opendesign/design-contracts";

export type ArrangeAxis = "horizontal" | "vertical";

export type AlignAction =
  | "align-left"
  | "align-horizontal-center"
  | "align-right"
  | "align-top"
  | "align-vertical-center"
  | "align-bottom";

export type ArrangementItem = {
  id: string;
  bounds: Rect;
};

export type ArrangementPlacement = {
  id: string;
  delta: Point;
  targetLeadingEdge: number;
};

export type ArrangementFailureCode =
  "ambiguous-anchors" | "insufficient-items" | "invalid-input" | "no-op";

export type ArrangementFailure = {
  ok: false;
  code: ArrangementFailureCode;
  message: string;
};

export type ArrangementPlan =
  | {
      ok: true;
      axis: ArrangeAxis;
      orderedIds: string[];
      placements: ArrangementPlacement[];
      resolvedSpacing?: number;
    }
  | ArrangementFailure;

export type TidyUpDimension = "horizontal" | "vertical" | "grid";

export type TidyUpPlacement = {
  id: string;
  delta: Point;
  target: Point;
};

export type TidyUpPlan =
  | {
      ok: true;
      dimension: TidyUpDimension;
      orderedIds: string[];
      placements: TidyUpPlacement[];
      horizontalSpacing?: number;
      verticalSpacing?: number;
    }
  | ArrangementFailure;

export type SpacingMeasurement =
  | {
      ok: true;
      axis: ArrangeAxis;
      gaps: number[];
      orderedIds: string[];
      uniform: boolean;
      value: number | null;
    }
  | ArrangementFailure;

type AxisItem = ArrangementItem & {
  center: number;
  end: number;
  extent: number;
  start: number;
};

type OverlapCluster = {
  items: ArrangementItem[];
  start: number;
  end: number;
};

const EPSILON = 1e-9;
export const MAX_ARRANGEMENT_SPACING = 1_000_000;

export function alignItems(
  items: readonly ArrangementItem[],
  action: AlignAction,
): ArrangementPlan {
  const validated = validateItems(items, 2);
  if (!validated.ok) return validated;
  const axis =
    action.includes("top") ||
    action.includes("vertical") ||
    action.includes("bottom")
      ? "vertical"
      : "horizontal";
  const projected = projectAxis(validated.items, axis);
  const minimum = Math.min(...projected.map((item) => item.start));
  const maximum = Math.max(...projected.map((item) => item.end));
  const center = (minimum + maximum) / 2;
  const placements = projected.map((item) => {
    const targetLeadingEdge =
      action === "align-left" || action === "align-top"
        ? minimum
        : action === "align-right" || action === "align-bottom"
          ? maximum - item.extent
          : center - item.extent / 2;
    return placement(item, axis, targetLeadingEdge);
  });
  return finalize(
    axis,
    projected.map((item) => item.id),
    placements,
  );
}

export function distributeItems(
  items: readonly ArrangementItem[],
  axis: ArrangeAxis,
): ArrangementPlan {
  const validated = validateItems(items, 3);
  if (!validated.ok) return validated;
  const projected = projectAxis(validated.items, axis);
  const leading = [...projected].sort(compareLeading)[0];
  const trailing = [...projected].sort(compareTrailing)[0];
  if (!leading || !trailing || leading.id === trailing.id) {
    return failure(
      "ambiguous-anchors",
      "Distribution requires distinct outermost layers on the selected axis",
    );
  }
  const interior = projected
    .filter((item) => item.id !== leading.id && item.id !== trailing.id)
    .sort(compareCenter);
  const ordered = [leading, ...interior, trailing];
  const totalExtent = ordered.reduce((sum, item) => sum + item.extent, 0);
  const resolvedSpacing =
    (trailing.end - leading.start - totalExtent) / (ordered.length - 1);
  let cursor = leading.start;
  const placements = ordered.map((item, index) => {
    const targetLeadingEdge =
      index === ordered.length - 1 ? trailing.end - item.extent : cursor;
    cursor = targetLeadingEdge + item.extent + resolvedSpacing;
    return placement(item, axis, targetLeadingEdge);
  });
  return finalize(
    axis,
    ordered.map((item) => item.id),
    placements,
    resolvedSpacing,
  );
}

export function setItemSpacing(
  items: readonly ArrangementItem[],
  axis: ArrangeAxis,
  spacing: number,
): ArrangementPlan {
  const validated = validateItems(items, 2);
  if (!validated.ok) return validated;
  if (
    !Number.isFinite(spacing) ||
    Math.abs(spacing) > MAX_ARRANGEMENT_SPACING
  ) {
    return failure(
      "invalid-input",
      `Spacing must be finite and within ±${MAX_ARRANGEMENT_SPACING}`,
    );
  }
  const ordered = projectAxis(validated.items, axis).sort(compareLeading);
  let cursor = ordered[0]?.start ?? 0;
  const placements = ordered.map((item) => {
    const targetLeadingEdge = cursor;
    cursor = targetLeadingEdge + item.extent + spacing;
    return placement(item, axis, targetLeadingEdge);
  });
  return finalize(
    axis,
    ordered.map((item) => item.id),
    placements,
    spacing,
  );
}

export function measureItemSpacing(
  items: readonly ArrangementItem[],
  axis: ArrangeAxis,
): SpacingMeasurement {
  const validated = validateItems(items, 2);
  if (!validated.ok) return validated;
  const ordered = projectAxis(validated.items, axis).sort(compareLeading);
  const gaps = ordered.slice(1).map((item, index) => {
    const previous = ordered[index];
    return previous ? item.start - previous.end : 0;
  });
  const uniform = gaps.every((gap) => nearlyEqual(gap, gaps[0] ?? gap));
  return {
    ok: true,
    axis,
    gaps,
    orderedIds: ordered.map((item) => item.id),
    uniform,
    value: uniform ? (gaps[0] ?? null) : repeatedMode(gaps),
  };
}

/**
 * Produces a Figma-style Tidy up placement without mutating document state.
 * One-dimensional selections only change their arrangement axis. A proven
 * two-dimensional selection is placed into top-left-aligned row/column cells.
 */
export function tidyUpItems(items: readonly ArrangementItem[]): TidyUpPlan {
  const validated = validateItems(items, 3);
  if (!validated.ok) return validated;
  const rowClusters = clusterByOverlap(validated.items, "vertical");
  if (!rowClusters.ok) return rowClusters;
  const columnClusters = clusterByOverlap(validated.items, "horizontal");
  if (!columnClusters.ok) return columnClusters;

  if (rowClusters.clusters.length === 1 && columnClusters.clusters.length > 1) {
    return tidyOneDimension(validated.items, "horizontal");
  }
  if (columnClusters.clusters.length === 1 && rowClusters.clusters.length > 1) {
    return tidyOneDimension(validated.items, "vertical");
  }
  if (
    rowClusters.clusters.length === 1 &&
    columnClusters.clusters.length === 1
  ) {
    const horizontalSpread = centerSpread(validated.items, "horizontal");
    const verticalSpread = centerSpread(validated.items, "vertical");
    if (nearlyEqual(horizontalSpread, verticalSpread)) {
      return failure(
        "ambiguous-anchors",
        "Tidy up cannot infer a stable row or column from fully overlapping layers",
      );
    }
    return tidyOneDimension(
      validated.items,
      horizontalSpread > verticalSpread ? "horizontal" : "vertical",
    );
  }

  const rows = sortClusters(rowClusters.clusters);
  const columns = sortClusters(columnClusters.clusters);
  const rowIndex = clusterIndex(rows);
  const columnIndex = clusterIndex(columns);
  const occupiedCells = new Set<string>();
  for (const item of validated.items) {
    const row = rowIndex.get(item.id);
    const column = columnIndex.get(item.id);
    if (row === undefined || column === undefined) {
      return failure(
        "invalid-input",
        `Layer ${item.id} could not be assigned to a Tidy up cell`,
      );
    }
    const key = `${row}:${column}`;
    if (occupiedCells.has(key)) {
      return failure(
        "ambiguous-anchors",
        "Tidy up requires at most one layer in each inferred grid cell",
      );
    }
    occupiedCells.add(key);
  }
  if (
    !rows.some((cluster) => cluster.items.length > 1) ||
    !columns.some((cluster) => cluster.items.length > 1)
  ) {
    return failure(
      "ambiguous-anchors",
      "Tidy up requires overlapping row and column relationships for a two-dimensional selection",
    );
  }

  const horizontalGaps = rows.flatMap((row) =>
    adjacentGaps(row.items, "horizontal"),
  );
  const verticalGaps = columns.flatMap((column) =>
    adjacentGaps(column.items, "vertical"),
  );
  const horizontalSpacing = commonGap(horizontalGaps);
  const verticalSpacing = commonGap(verticalGaps);
  if (horizontalSpacing === null || verticalSpacing === null) {
    return failure(
      "ambiguous-anchors",
      "Tidy up could not infer spacing on both grid axes",
    );
  }

  const left = Math.min(...validated.items.map((item) => item.bounds.x));
  const top = Math.min(...validated.items.map((item) => item.bounds.y));
  const columnWidths = columns.map((column) =>
    Math.max(...column.items.map((item) => item.bounds.width)),
  );
  const rowHeights = rows.map((row) =>
    Math.max(...row.items.map((item) => item.bounds.height)),
  );
  const columnTargets = cumulativeTargets(
    left,
    columnWidths,
    horizontalSpacing,
  );
  const rowTargets = cumulativeTargets(top, rowHeights, verticalSpacing);
  const ordered = [...validated.items].sort((leftItem, rightItem) => {
    const leftRow = rowIndex.get(leftItem.id) ?? 0;
    const rightRow = rowIndex.get(rightItem.id) ?? 0;
    const leftColumn = columnIndex.get(leftItem.id) ?? 0;
    const rightColumn = columnIndex.get(rightItem.id) ?? 0;
    return (
      leftRow - rightRow ||
      leftColumn - rightColumn ||
      compareId(leftItem.id, rightItem.id)
    );
  });
  return finalizeTidy(
    "grid",
    ordered.map((item) => item.id),
    ordered.map((item) => {
      const target = {
        x: columnTargets[columnIndex.get(item.id) ?? 0] ?? item.bounds.x,
        y: rowTargets[rowIndex.get(item.id) ?? 0] ?? item.bounds.y,
      };
      return {
        id: item.id,
        target,
        delta: {
          x: target.x - item.bounds.x,
          y: target.y - item.bounds.y,
        },
      };
    }),
    horizontalSpacing,
    verticalSpacing,
  );
}

function validateItems(
  items: readonly ArrangementItem[],
  minimum: number,
): { ok: true; items: ArrangementItem[] } | ArrangementFailure {
  if (items.length < minimum) {
    return failure(
      "insufficient-items",
      `Arrangement requires at least ${minimum} layers`,
    );
  }
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) {
      return failure(
        "invalid-input",
        "Arrangement layer IDs must be non-empty and unique",
      );
    }
    ids.add(item.id);
    const { x, y, width, height } = item.bounds;
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      !Number.isFinite(x + width) ||
      !Number.isFinite(y + height) ||
      width < 0 ||
      height < 0
    ) {
      return failure(
        "invalid-input",
        `Layer ${item.id} has invalid arrangement bounds`,
      );
    }
  }
  return { ok: true, items: [...items] };
}

function projectAxis(
  items: readonly ArrangementItem[],
  axis: ArrangeAxis,
): AxisItem[] {
  return items.map((item) => {
    const start = axis === "horizontal" ? item.bounds.x : item.bounds.y;
    const extent =
      axis === "horizontal" ? item.bounds.width : item.bounds.height;
    return {
      ...item,
      start,
      extent,
      end: start + extent,
      center: start + extent / 2,
    };
  });
}

function tidyOneDimension(
  items: readonly ArrangementItem[],
  axis: ArrangeAxis,
): TidyUpPlan {
  const ordered = projectAxis(items, axis).sort(compareLeading);
  const spacing = commonGap(
    ordered.slice(1).map((item, index) => {
      const previous = ordered[index];
      return previous ? item.start - previous.end : 0;
    }),
  );
  if (spacing === null) {
    return failure(
      "ambiguous-anchors",
      "Tidy up could not infer layer spacing",
    );
  }
  let cursor = ordered[0]?.start ?? 0;
  const placements = ordered.map((item) => {
    const target =
      axis === "horizontal"
        ? { x: cursor, y: item.bounds.y }
        : { x: item.bounds.x, y: cursor };
    cursor += item.extent + spacing;
    return {
      id: item.id,
      target,
      delta: {
        x: target.x - item.bounds.x,
        y: target.y - item.bounds.y,
      },
    };
  });
  return finalizeTidy(
    axis,
    ordered.map((item) => item.id),
    placements,
    axis === "horizontal" ? spacing : undefined,
    axis === "vertical" ? spacing : undefined,
  );
}

function clusterByOverlap(
  items: readonly ArrangementItem[],
  axis: ArrangeAxis,
): { ok: true; clusters: OverlapCluster[] } | ArrangementFailure {
  const projected = projectAxis(items, axis);
  const connected = new Map<string, Set<string>>(
    projected.map((item) => [item.id, new Set([item.id])]),
  );
  for (let leftIndex = 0; leftIndex < projected.length; leftIndex += 1) {
    const left = projected[leftIndex];
    if (!left) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < projected.length;
      rightIndex += 1
    ) {
      const right = projected[rightIndex];
      if (!right || !intervalsOverlap(left, right)) continue;
      connected.get(left.id)?.add(right.id);
      connected.get(right.id)?.add(left.id);
    }
  }
  const byId = new Map(projected.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const clusters: OverlapCluster[] = [];
  for (const item of projected.sort(compareLeading)) {
    if (visited.has(item.id)) continue;
    const pending = [item.id];
    const members: AxisItem[] = [];
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const member = byId.get(id);
      if (member) members.push(member);
      for (const adjacent of connected.get(id) ?? []) {
        if (!visited.has(adjacent)) pending.push(adjacent);
      }
    }
    for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
      const left = members[leftIndex];
      if (!left) continue;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < members.length;
        rightIndex += 1
      ) {
        const right = members[rightIndex];
        if (right && !intervalsOverlap(left, right)) {
          return failure(
            "ambiguous-anchors",
            "A layer spans multiple inferred Tidy up rows or columns",
          );
        }
      }
    }
    clusters.push({
      items: members.map((member) => ({
        id: member.id,
        bounds: member.bounds,
      })),
      start: Math.min(...members.map((member) => member.start)),
      end: Math.max(...members.map((member) => member.end)),
    });
  }
  return { ok: true, clusters };
}

function intervalsOverlap(left: AxisItem, right: AxisItem): boolean {
  const overlap =
    Math.min(left.end, right.end) - Math.max(left.start, right.start);
  if (overlap > EPSILON) return true;
  if (left.extent <= EPSILON && right.extent <= EPSILON) {
    return nearlyEqual(left.start, right.start);
  }
  if (left.extent <= EPSILON) {
    return (
      left.start > right.start + EPSILON && left.start < right.end - EPSILON
    );
  }
  if (right.extent <= EPSILON) {
    return (
      right.start > left.start + EPSILON && right.start < left.end - EPSILON
    );
  }
  return false;
}

function sortClusters(clusters: readonly OverlapCluster[]): OverlapCluster[] {
  return [...clusters].sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      compareId(left.items[0]?.id ?? "", right.items[0]?.id ?? ""),
  );
}

function clusterIndex(
  clusters: readonly OverlapCluster[],
): Map<string, number> {
  const result = new Map<string, number>();
  clusters.forEach((cluster, index) => {
    cluster.items.forEach((item) => result.set(item.id, index));
  });
  return result;
}

function adjacentGaps(
  items: readonly ArrangementItem[],
  axis: ArrangeAxis,
): number[] {
  const ordered = projectAxis(items, axis).sort(compareLeading);
  return ordered.slice(1).map((item, index) => {
    const previous = ordered[index];
    return previous ? item.start - previous.end : 0;
  });
}

function commonGap(gaps: readonly number[]): number | null {
  if (gaps.length === 0) return null;
  let best = gaps[0] ?? null;
  let bestCount = 0;
  for (const candidate of gaps) {
    const count = gaps.filter((gap) => nearlyEqual(gap, candidate)).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function centerSpread(
  items: readonly ArrangementItem[],
  axis: ArrangeAxis,
): number {
  const centers = projectAxis(items, axis).map((item) => item.center);
  return Math.max(...centers) - Math.min(...centers);
}

function cumulativeTargets(
  leading: number,
  extents: readonly number[],
  spacing: number,
): number[] {
  const targets: number[] = [];
  let cursor = leading;
  for (const extent of extents) {
    targets.push(cursor);
    cursor += extent + spacing;
  }
  return targets;
}

function finalizeTidy(
  dimension: TidyUpDimension,
  orderedIds: string[],
  placements: TidyUpPlacement[],
  horizontalSpacing?: number,
  verticalSpacing?: number,
): TidyUpPlan {
  if (
    [horizontalSpacing, verticalSpacing]
      .filter((value): value is number => value !== undefined)
      .some((value) => !Number.isFinite(value)) ||
    placements.some(
      ({ delta, target }) =>
        !Number.isFinite(delta.x) ||
        !Number.isFinite(delta.y) ||
        !Number.isFinite(target.x) ||
        !Number.isFinite(target.y),
    )
  ) {
    return failure(
      "invalid-input",
      "Tidy up exceeds the finite geometry range",
    );
  }
  if (
    placements.every(
      ({ delta }) => nearlyEqual(delta.x, 0) && nearlyEqual(delta.y, 0),
    )
  ) {
    return failure("no-op", "Layers already match the inferred Tidy up layout");
  }
  return {
    ok: true,
    dimension,
    orderedIds,
    placements,
    ...(horizontalSpacing === undefined ? {} : { horizontalSpacing }),
    ...(verticalSpacing === undefined ? {} : { verticalSpacing }),
  };
}

function placement(
  item: AxisItem,
  axis: ArrangeAxis,
  targetLeadingEdge: number,
): ArrangementPlacement {
  const offset = targetLeadingEdge - item.start;
  return {
    id: item.id,
    delta: axis === "horizontal" ? { x: offset, y: 0 } : { x: 0, y: offset },
    targetLeadingEdge,
  };
}

function finalize(
  axis: ArrangeAxis,
  orderedIds: string[],
  placements: ArrangementPlacement[],
  resolvedSpacing?: number,
): ArrangementPlan {
  if (
    (resolvedSpacing !== undefined && !Number.isFinite(resolvedSpacing)) ||
    placements.some(
      ({ delta, targetLeadingEdge }) =>
        !Number.isFinite(delta.x) ||
        !Number.isFinite(delta.y) ||
        !Number.isFinite(targetLeadingEdge),
    )
  ) {
    return failure(
      "invalid-input",
      "Arrangement exceeds the finite geometry range",
    );
  }
  if (
    placements.every(
      ({ delta }) => nearlyEqual(delta.x, 0) && nearlyEqual(delta.y, 0),
    )
  ) {
    return failure("no-op", "Layers already match the requested arrangement");
  }
  return {
    ok: true,
    axis,
    orderedIds,
    placements,
    ...(resolvedSpacing === undefined ? {} : { resolvedSpacing }),
  };
}

function compareLeading(left: AxisItem, right: AxisItem): number {
  return (
    left.start - right.start ||
    left.center - right.center ||
    left.end - right.end ||
    compareId(left.id, right.id)
  );
}

function compareTrailing(left: AxisItem, right: AxisItem): number {
  return (
    right.end - left.end ||
    right.center - left.center ||
    right.start - left.start ||
    compareId(left.id, right.id)
  );
}

function compareCenter(left: AxisItem, right: AxisItem): number {
  return (
    left.center - right.center ||
    left.start - right.start ||
    left.end - right.end ||
    compareId(left.id, right.id)
  );
}

function repeatedMode(values: readonly number[]): number | null {
  let bestValue: number | null = null;
  let bestCount = 1;
  for (const candidate of values) {
    const count = values.filter((value) =>
      nearlyEqual(value, candidate),
    ).length;
    if (count > bestCount) {
      bestCount = count;
      bestValue = candidate;
    }
  }
  return bestValue;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function failure(
  code: ArrangementFailureCode,
  message: string,
): ArrangementFailure {
  return { ok: false, code, message };
}
