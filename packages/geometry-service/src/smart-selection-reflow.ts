import {
  analyzeSmartSelection,
  type ArrangeAxis,
  type ArrangementFailure,
  type ArrangementItem,
  type SmartSelectionAnalysis,
  type TidyUpDimension,
  type TidyUpPlacement,
} from "./arrangement.js";

export type SmartSelectionReflowMutation =
  | { kind: "delete"; removedNodeIds: readonly string[] }
  | {
      duplicates: readonly { id: string; sourceId: string }[];
      kind: "duplicate";
    }
  | {
      kind: "resize";
      markedNodeIds: readonly string[];
      updatedItems: readonly ArrangementItem[];
    };

export type SmartSelectionReflowPlan =
  | {
      ok: true;
      dimension: TidyUpDimension;
      horizontalSpacing?: number;
      orderedIds: string[];
      placements: TidyUpPlacement[];
      verticalSpacing?: number;
    }
  | ArrangementFailure;

type Analysis = Extract<SmartSelectionAnalysis, { ok: true }>;

export function reflowSmartSelectionMutation(
  items: readonly ArrangementItem[],
  mutation: SmartSelectionReflowMutation,
): SmartSelectionReflowPlan {
  const analysis = analyzeSmartSelection(items);
  if (!analysis.ok) return analysis;
  const original = new Map(items.map((item) => [item.id, item] as const));
  const prepared = prepareItems(items, analysis, mutation);
  if (!prepared.ok) return prepared;
  return analysis.dimension === "grid"
    ? reflowGrid(analysis, original, prepared.items, mutation)
    : reflowLinear(analysis, original, prepared.items, mutation);
}

function prepareItems(
  source: readonly ArrangementItem[],
  analysis: Analysis,
  mutation: SmartSelectionReflowMutation,
):
  | { ok: true; items: ReadonlyMap<string, ArrangementItem> }
  | ArrangementFailure {
  const items = new Map(source.map((item) => [item.id, item] as const));
  if (mutation.kind === "delete") return prepareDelete(items, mutation);
  if (mutation.kind === "duplicate") return prepareDuplicate(items, mutation);
  return prepareResize(items, analysis, mutation);
}

function prepareDelete(
  items: Map<string, ArrangementItem>,
  mutation: Extract<SmartSelectionReflowMutation, { kind: "delete" }>,
) {
  const removed = uniqueKnownIds(mutation.removedNodeIds, items);
  if (!removed) return invalid("Smart selection delete targets are invalid");
  removed.forEach((id) => items.delete(id));
  return { ok: true as const, items };
}

function prepareDuplicate(
  items: Map<string, ArrangementItem>,
  mutation: Extract<SmartSelectionReflowMutation, { kind: "duplicate" }>,
) {
  const duplicateIds = new Set<string>();
  for (const duplicate of mutation.duplicates) {
    const source = items.get(duplicate.sourceId);
    if (!source || items.has(duplicate.id) || duplicateIds.has(duplicate.id)) {
      return invalid("Smart selection duplicate identities are invalid");
    }
    duplicateIds.add(duplicate.id);
    items.set(duplicate.id, { id: duplicate.id, bounds: { ...source.bounds } });
  }
  return duplicateIds.size > 0
    ? { ok: true as const, items }
    : invalid("Smart selection duplicate requires at least one layer");
}

function prepareResize(
  items: Map<string, ArrangementItem>,
  analysis: Analysis,
  mutation: Extract<SmartSelectionReflowMutation, { kind: "resize" }>,
) {
  const marked = uniqueKnownIds(mutation.markedNodeIds, items);
  if (!marked || marked.size !== mutation.updatedItems.length) {
    return invalid("Smart selection resize targets are invalid");
  }
  if (analysis.dimension === "grid" && marked.size !== 1) {
    return invalid("A grid Smart selection can resize one layer at a time");
  }
  if (
    mutation.updatedItems.some(
      (item) => !marked.has(item.id) || !validItem(item),
    )
  ) {
    return invalid("Smart selection resize bounds are invalid");
  }
  mutation.updatedItems.forEach((item) => items.set(item.id, item));
  return { ok: true as const, items };
}

function reflowLinear(
  analysis: Analysis,
  original: ReadonlyMap<string, ArrangementItem>,
  items: ReadonlyMap<string, ArrangementItem>,
  mutation: SmartSelectionReflowMutation,
): SmartSelectionReflowPlan {
  const axis = analysis.dimension as ArrangeAxis;
  const spacing =
    axis === "horizontal"
      ? analysis.horizontalSpacing
      : analysis.verticalSpacing;
  if (spacing === undefined)
    return invalid("Smart selection spacing is unavailable");
  const orderedIds = mutationOrder(analysis.orderedIds, mutation).filter((id) =>
    items.has(id),
  );
  const anchorId =
    mutation.kind === "resize"
      ? orderedIds.find((id) => mutation.markedNodeIds.includes(id))
      : orderedIds[0];
  const fixedStart =
    mutation.kind === "resize"
      ? undefined
      : Math.min(...[...original.values()].map((item) => start(item, axis)));
  const placements = placeLinear(
    orderedIds,
    items,
    axis,
    spacing,
    anchorId,
    fixedStart,
  );
  if (!placements) return invalid("Smart selection reflow order is incomplete");
  return {
    ok: true,
    dimension: axis,
    orderedIds,
    placements,
    ...(axis === "horizontal"
      ? { horizontalSpacing: spacing }
      : { verticalSpacing: spacing }),
  };
}

function reflowGrid(
  analysis: Analysis,
  original: ReadonlyMap<string, ArrangementItem>,
  items: ReadonlyMap<string, ArrangementItem>,
  mutation: SmartSelectionReflowMutation,
): SmartSelectionReflowPlan {
  const horizontalSpacing = analysis.horizontalSpacing;
  const verticalSpacing = analysis.verticalSpacing;
  if (horizontalSpacing === undefined || verticalSpacing === undefined) {
    return invalid("Grid Smart selection spacing is unavailable");
  }
  const columns = prepareGridColumns(analysis, original, items, mutation);
  const horizontal = placeGridColumns(
    columns,
    original,
    items,
    mutation,
    horizontalSpacing,
  );
  if (!horizontal)
    return invalid("Grid Smart selection columns are incomplete");
  const vertical = columns.flatMap((column) =>
    placeGridColumn(column, original, items, mutation, verticalSpacing),
  );
  if (vertical.some((placement) => placement === null)) {
    return invalid("Grid Smart selection rows are incomplete");
  }
  const placements = mergePlacements(
    items,
    columns,
    horizontal,
    vertical.flatMap((placement) => placement ?? []),
  );
  return {
    ok: true,
    dimension: "grid",
    horizontalSpacing,
    orderedIds: columns.flatMap((column) => column.ids),
    placements,
    verticalSpacing,
  };
}

type GridColumn = {
  ids: string[];
  originalIds: readonly string[];
};

function prepareGridColumns(
  analysis: Analysis,
  original: ReadonlyMap<string, ArrangementItem>,
  items: ReadonlyMap<string, ArrangementItem>,
  mutation: SmartSelectionReflowMutation,
): GridColumn[] {
  return analysis.columns
    .map((originalIds) => ({
      ids: mutationOrder(originalIds, mutation).filter((id) => items.has(id)),
      originalIds,
    }))
    .filter(
      (column) =>
        column.ids.length > 0 &&
        column.originalIds.some((id) => original.has(id)),
    );
}

function placeGridColumns(
  columns: readonly GridColumn[],
  original: ReadonlyMap<string, ArrangementItem>,
  items: ReadonlyMap<string, ArrangementItem>,
  mutation: SmartSelectionReflowMutation,
  spacing: number,
): TidyUpPlacement[] | null {
  const columnItems = new Map<string, ArrangementItem>();
  for (const [index, column] of columns.entries()) {
    const members = column.ids.map((id) => items.get(id));
    if (members.some((item) => !item)) return null;
    const resolved = members.filter((item): item is ArrangementItem =>
      Boolean(item),
    );
    columnItems.set(columnId(index), {
      id: columnId(index),
      bounds: {
        x: columnLeading(column, resolved, mutation),
        y: 0,
        width: Math.max(...resolved.map((item) => item.bounds.width)),
        height: 0,
      },
    });
  }
  const ids = columns.map((_, index) => columnId(index));
  const anchorId = resizedGridColumnId(columns, mutation);
  const fixedStart =
    mutation.kind === "resize"
      ? undefined
      : minimumStart(original, "horizontal");
  return placeLinear(
    ids,
    columnItems,
    "horizontal",
    spacing,
    anchorId,
    fixedStart,
  );
}

function placeGridColumn(
  column: GridColumn,
  original: ReadonlyMap<string, ArrangementItem>,
  items: ReadonlyMap<string, ArrangementItem>,
  mutation: SmartSelectionReflowMutation,
  spacing: number,
): TidyUpPlacement[] | null {
  const anchorId =
    mutation.kind === "resize"
      ? column.ids.find((id) => mutation.markedNodeIds.includes(id))
      : column.ids[0];
  const fixedStart =
    mutation.kind === "resize"
      ? undefined
      : minimumStartForIds(column.originalIds, original, "vertical");
  return placeLinear(
    column.ids,
    items,
    "vertical",
    spacing,
    anchorId,
    fixedStart,
  );
}

function mergePlacements(
  items: ReadonlyMap<string, ArrangementItem>,
  gridColumns: readonly GridColumn[],
  columns: readonly TidyUpPlacement[],
  vertical: readonly TidyUpPlacement[],
): TidyUpPlacement[] {
  const xByColumn = new Map(
    columns.map((placement) => [placement.id, placement.target.x]),
  );
  const xByNode = new Map<string, number>();
  gridColumns.forEach((column, index) => {
    const x = xByColumn.get(columnId(index));
    if (x !== undefined) column.ids.forEach((id) => xByNode.set(id, x));
  });
  return vertical.map((placement) => {
    const item = items.get(placement.id)!;
    return placementFromTarget(
      item,
      xByNode.get(placement.id) ?? item.bounds.x,
      placement.target.y,
    );
  });
}

function columnLeading(
  column: GridColumn,
  items: readonly ArrangementItem[],
  mutation: SmartSelectionReflowMutation,
): number {
  if (mutation.kind === "resize") {
    const markedId = column.ids.find((id) =>
      mutation.markedNodeIds.includes(id),
    );
    const marked = items.find((item) => item.id === markedId);
    if (marked) return marked.bounds.x;
  }
  return Math.min(...items.map((item) => item.bounds.x));
}

function resizedGridColumnId(
  columns: readonly GridColumn[],
  mutation: SmartSelectionReflowMutation,
): string | undefined {
  if (mutation.kind !== "resize") return undefined;
  const index = columns.findIndex((column) =>
    column.ids.some((id) => mutation.markedNodeIds.includes(id)),
  );
  return index < 0 ? undefined : columnId(index);
}

function columnId(index: number): string {
  return `__smart_column_${index}`;
}

function mutationOrder(
  orderedIds: readonly string[],
  mutation: SmartSelectionReflowMutation,
): string[] {
  if (mutation.kind === "delete") {
    const removed = new Set(mutation.removedNodeIds);
    return orderedIds.filter((id) => !removed.has(id));
  }
  if (mutation.kind === "resize") return [...orderedIds];
  const duplicates = new Map(
    mutation.duplicates.map((item) => [item.sourceId, item.id]),
  );
  return orderedIds.flatMap((id) => [
    id,
    ...(duplicates.has(id) ? [duplicates.get(id)!] : []),
  ]);
}

function placeLinear(
  orderedIds: readonly string[],
  items: ReadonlyMap<string, ArrangementItem>,
  axis: ArrangeAxis,
  spacing: number,
  anchorId: string | undefined,
  fixedStart?: number,
): TidyUpPlacement[] | null {
  if (orderedIds.length === 0) return [];
  const anchorIndex = Math.max(
    0,
    orderedIds.indexOf(anchorId ?? orderedIds[0]!),
  );
  const starts = new Array<number>(orderedIds.length);
  const anchor = items.get(orderedIds[anchorIndex]!);
  if (!anchor) return null;
  starts[anchorIndex] = fixedStart ?? start(anchor, axis);
  for (let index = anchorIndex + 1; index < orderedIds.length; index += 1) {
    const previous = items.get(orderedIds[index - 1]!);
    if (!previous) return null;
    starts[index] = starts[index - 1]! + extent(previous, axis) + spacing;
  }
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const item = items.get(orderedIds[index]!);
    if (!item) return null;
    starts[index] = starts[index + 1]! - extent(item, axis) - spacing;
  }
  return orderedIds.map((id, index) =>
    placement(items.get(id)!, axis, starts[index]!),
  );
}

function uniqueKnownIds(
  ids: readonly string[],
  items: ReadonlyMap<string, ArrangementItem>,
): Set<string> | null {
  const unique = new Set(ids);
  return unique.size > 0 &&
    unique.size === ids.length &&
    ids.every((id) => items.has(id))
    ? unique
    : null;
}

function validItem(item: ArrangementItem): boolean {
  const { x, y, width, height } = item.bounds;
  return (
    item.id.length > 0 &&
    [x, y, width, height, x + width, y + height].every(Number.isFinite) &&
    width >= 0 &&
    height >= 0
  );
}

function start(item: ArrangementItem, axis: ArrangeAxis): number {
  return axis === "horizontal" ? item.bounds.x : item.bounds.y;
}

function extent(item: ArrangementItem, axis: ArrangeAxis): number {
  return axis === "horizontal" ? item.bounds.width : item.bounds.height;
}

function placement(
  item: ArrangementItem,
  axis: ArrangeAxis,
  leading: number,
): TidyUpPlacement {
  const target =
    axis === "horizontal"
      ? { x: leading, y: item.bounds.y }
      : { x: item.bounds.x, y: leading };
  return {
    id: item.id,
    target,
    delta: { x: target.x - item.bounds.x, y: target.y - item.bounds.y },
  };
}

function placementFromTarget(
  item: ArrangementItem,
  x: number,
  y: number,
): TidyUpPlacement {
  return {
    id: item.id,
    target: { x, y },
    delta: { x: x - item.bounds.x, y: y - item.bounds.y },
  };
}

function minimumStart(
  items: ReadonlyMap<string, ArrangementItem>,
  axis: ArrangeAxis,
): number | undefined {
  const values = [...items.values()].map((item) => start(item, axis));
  return values.length > 0 ? Math.min(...values) : undefined;
}

function minimumStartForIds(
  ids: readonly string[],
  items: ReadonlyMap<string, ArrangementItem>,
  axis: ArrangeAxis,
): number | undefined {
  const values = ids.flatMap((id) => {
    const item = items.get(id);
    return item ? [start(item, axis)] : [];
  });
  return values.length > 0 ? Math.min(...values) : undefined;
}

function invalid(message: string): ArrangementFailure {
  return { ok: false, code: "invalid-input", message };
}
