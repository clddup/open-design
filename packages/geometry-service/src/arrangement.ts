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
