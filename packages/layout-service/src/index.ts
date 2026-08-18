import { solveHorizontalWrap } from "./wrap-layout.js";
export {
  GRID_AUTO_LAYOUT_CONTRACT_VERSION,
  solveGridAutoLayout,
  type GridAutoLayoutRequest,
  type GridAutoLayoutResult,
  type GridChildPlacement,
  type GridTrack,
} from "./grid-layout.js";

export const LAYOUT_SERVICE_CONTRACT_VERSION = 1 as const;
export const AUTO_LAYOUT_SERVICE_CONTRACT_VERSION = 8 as const;

export type HorizontalConstraint =
  "left" | "right" | "left-right" | "center" | "scale";

export type VerticalConstraint =
  "top" | "bottom" | "top-bottom" | "center" | "scale";

export type LayoutConstraints = {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
};

export type ConstraintRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ConstraintSize = { width: number; height: number };

export type ConstraintResizeRequest = {
  version: typeof LAYOUT_SERVICE_CONTRACT_VERSION;
  constraints: LayoutConstraints;
  child: ConstraintRect;
  previousParent: ConstraintSize;
  nextParent: ConstraintSize;
};

export type ConstraintResizeResult =
  | { ok: true; rect: ConstraintRect }
  | {
      ok: false;
      code: "invalid-input" | "zero-parent-size";
      message: string;
    };

export type AutoLayoutDirection = "horizontal" | "vertical";
export type AutoLayoutAlignment = "start" | "center" | "end";
export type AutoLayoutPrimaryAlignment = AutoLayoutAlignment | "space-between";
export type AutoLayoutFrameAxisSizing = "fixed" | "hug";
export type AutoLayoutChildAxisSizing = "fixed" | "fill";
export type AutoLayoutPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export type AutoLayoutLimits = {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
};
export type LinearAutoLayoutRequest = {
  version: typeof AUTO_LAYOUT_SERVICE_CONTRACT_VERSION;
  direction: AutoLayoutDirection;
  frame: ConstraintSize;
  padding: AutoLayoutPadding;
  gap: number;
  primaryAlignment: AutoLayoutPrimaryAlignment;
  counterAlignment: AutoLayoutAlignment;
  frameSizing: {
    horizontal: AutoLayoutFrameAxisSizing;
    vertical: AutoLayoutFrameAxisSizing;
  };
  frameLimits?: AutoLayoutLimits;
  wrap?: { mode: "wrap"; counterGap: number };
  children: Array<{
    id: string;
    positioning: "flow" | "absolute";
    width: number;
    height: number;
    sizing: {
      horizontal: AutoLayoutChildAxisSizing;
      vertical: AutoLayoutChildAxisSizing;
    };
    limits?: AutoLayoutLimits;
  }>;
};
export type LinearAutoLayoutResult =
  | {
      ok: true;
      frame: ConstraintSize;
      placements: Array<ConstraintRect & { id: string }>;
    }
  | {
      ok: false;
      code: "invalid-input" | "sizing-conflict";
      message: string;
    };

export const DEFAULT_LAYOUT_CONSTRAINTS: LayoutConstraints = Object.freeze({
  horizontal: "left",
  vertical: "top",
});

export function solveConstraints(
  request: ConstraintResizeRequest,
): ConstraintResizeResult {
  if (
    request.version !== LAYOUT_SERVICE_CONTRACT_VERSION ||
    !finitePositiveSize(request.previousParent) ||
    !finitePositiveSize(request.nextParent) ||
    !finiteRect(request.child) ||
    !isLayoutConstraints(request.constraints)
  ) {
    return failure("invalid-input", "Constraint resize input is invalid");
  }
  if (
    request.previousParent.width === 0 ||
    request.previousParent.height === 0
  ) {
    return failure(
      "zero-parent-size",
      "Constraints cannot resolve from a zero-sized parent axis",
    );
  }
  const horizontal = solveAxis(
    request.constraints.horizontal,
    request.child.x,
    request.child.width,
    request.previousParent.width,
    request.nextParent.width,
  );
  const vertical = solveAxis(
    request.constraints.vertical,
    request.child.y,
    request.child.height,
    request.previousParent.height,
    request.nextParent.height,
  );
  return {
    ok: true,
    rect: {
      x: horizontal.start,
      y: vertical.start,
      width: horizontal.extent,
      height: vertical.extent,
    },
  };
}

export function solveLinearAutoLayout(
  request: LinearAutoLayoutRequest,
): LinearAutoLayoutResult {
  if (!validLinearAutoLayoutRequest(request)) {
    return {
      ok: false,
      code: "invalid-input",
      message: "Linear Auto Layout input is invalid",
    };
  }
  const flowChildren = request.children.filter(
    (child) => child.positioning === "flow",
  );
  if (request.wrap) {
    return solveHorizontalWrap({
      ...request,
      direction: "horizontal",
      wrap: request.wrap,
      children: flowChildren,
    });
  }
  const horizontalHug = request.frameSizing.horizontal === "hug";
  const verticalHug = request.frameSizing.vertical === "hug";
  if (
    (horizontalHug &&
      flowChildren.some((child) => child.sizing.horizontal === "fill")) ||
    (verticalHug &&
      flowChildren.some((child) => child.sizing.vertical === "fill"))
  ) {
    return {
      ok: false,
      code: "sizing-conflict",
      message: "A hugged Auto Layout axis cannot contain a fill child",
    };
  }
  const limitedChildren = flowChildren.map((child) => ({
    ...child,
    width:
      child.sizing.horizontal === "fixed"
        ? clampLayoutExtent(child.width, child.limits, "horizontal")
        : child.width,
    height:
      child.sizing.vertical === "fixed"
        ? clampLayoutExtent(child.height, child.limits, "vertical")
        : child.height,
  }));
  const packedGap =
    request.primaryAlignment === "space-between" ? 0 : request.gap;
  const frame = {
    width: resolveFrameExtent(
      horizontalHug
        ? huggedExtent(
            limitedChildren.map((child) => child.width),
            request.direction === "horizontal",
            packedGap,
            request.padding.left + request.padding.right,
          )
        : request.frame.width,
      request.frameLimits,
      "horizontal",
      request.padding.left + request.padding.right,
    ),
    height: resolveFrameExtent(
      verticalHug
        ? huggedExtent(
            limitedChildren.map((child) => child.height),
            request.direction === "vertical",
            packedGap,
            request.padding.top + request.padding.bottom,
          )
        : request.frame.height,
      request.frameLimits,
      "vertical",
      request.padding.top + request.padding.bottom,
    ),
  };
  const horizontal = request.direction === "horizontal";
  const mainStart = horizontal ? request.padding.left : request.padding.top;
  const mainEnd = horizontal ? request.padding.right : request.padding.bottom;
  const counterStart = horizontal ? request.padding.top : request.padding.left;
  const counterEnd = horizontal
    ? request.padding.bottom
    : request.padding.right;
  const frameMain = horizontal ? frame.width : frame.height;
  const frameCounter = horizontal ? frame.height : frame.width;
  const fillChildren = limitedChildren.filter((child) =>
    horizontal
      ? child.sizing.horizontal === "fill"
      : child.sizing.vertical === "fill",
  );
  const fixedMain = limitedChildren.reduce((sum, child) => {
    const fill = horizontal
      ? child.sizing.horizontal === "fill"
      : child.sizing.vertical === "fill";
    return sum + (fill ? 0 : horizontal ? child.width : child.height);
  }, 0);
  const packedGapTotal = packedGap * Math.max(0, flowChildren.length - 1);
  const fillExtents = distributeBoundedFill(
    Math.max(0, frameMain - mainStart - mainEnd - fixedMain - packedGapTotal),
    fillChildren.map((child) => ({
      id: child.id,
      ...(child.limits ? { limits: child.limits } : {}),
    })),
    horizontal ? "horizontal" : "vertical",
  );
  const resolvedChildren = limitedChildren.map((child) => ({
    ...child,
    width:
      child.sizing.horizontal === "fill"
        ? horizontal
          ? (fillExtents.get(child.id) ?? 0)
          : clampLayoutExtent(
              Math.max(
                0,
                frame.width - request.padding.left - request.padding.right,
              ),
              child.limits,
              "horizontal",
            )
        : child.width,
    height:
      child.sizing.vertical === "fill"
        ? horizontal
          ? clampLayoutExtent(
              Math.max(
                0,
                frame.height - request.padding.top - request.padding.bottom,
              ),
              child.limits,
              "vertical",
            )
          : (fillExtents.get(child.id) ?? 0)
        : child.height,
  }));
  const childMainTotal = resolvedChildren.reduce(
    (sum, child) => sum + (horizontal ? child.width : child.height),
    0,
  );
  const resolvedGap =
    request.primaryAlignment === "space-between"
      ? autoGap(
          frameMain - mainStart - mainEnd - childMainTotal,
          resolvedChildren.length,
        )
      : packedGap;
  const contentMain =
    childMainTotal + resolvedGap * Math.max(0, resolvedChildren.length - 1);
  const mainFree = frameMain - mainStart - mainEnd - contentMain;
  let cursor =
    mainStart +
    (request.primaryAlignment === "space-between"
      ? 0
      : alignmentOffset(request.primaryAlignment, mainFree));
  const placements = resolvedChildren.map((child) => {
    const childMain = horizontal ? child.width : child.height;
    const childCounter = horizontal ? child.height : child.width;
    const counterFree = frameCounter - counterStart - counterEnd - childCounter;
    const counter =
      counterStart + alignmentOffset(request.counterAlignment, counterFree);
    const placement = {
      id: child.id,
      width: child.width,
      height: child.height,
      x: horizontal ? cursor : counter,
      y: horizontal ? counter : cursor,
    };
    cursor += childMain + resolvedGap;
    return placement;
  });
  return { ok: true, frame, placements };
}

function huggedExtent(
  extents: readonly number[],
  flowAxis: boolean,
  gap: number,
  padding: number,
): number {
  if (extents.length === 0) return padding;
  return flowAxis
    ? padding +
        extents.reduce((sum, extent) => sum + extent, 0) +
        gap * (extents.length - 1)
    : padding + Math.max(...extents);
}

export function autoGap(available: number, childCount: number): number {
  return childCount > 1 ? Math.max(0, available) / (childCount - 1) : 0;
}

export function clampLayoutExtent(
  extent: number,
  limits: AutoLayoutLimits | undefined,
  axis: "horizontal" | "vertical",
): number {
  const minimum = axis === "horizontal" ? limits?.minWidth : limits?.minHeight;
  const maximum = axis === "horizontal" ? limits?.maxWidth : limits?.maxHeight;
  return Math.min(maximum ?? Infinity, Math.max(minimum ?? 0, extent));
}

export function resolveFrameExtent(
  extent: number,
  limits: AutoLayoutLimits | undefined,
  axis: "horizontal" | "vertical",
  paddingMinimum: number,
): number {
  return Math.max(paddingMinimum, clampLayoutExtent(extent, limits, axis));
}

function distributeBoundedFill(
  available: number,
  children: Array<{ id: string; limits?: AutoLayoutLimits }>,
  axis: "horizontal" | "vertical",
): Map<string, number> {
  const result = new Map<string, number>();
  const pending = children.map((child) => {
    const minimum =
      axis === "horizontal" ? child.limits?.minWidth : child.limits?.minHeight;
    const maximum =
      axis === "horizontal" ? child.limits?.maxWidth : child.limits?.maxHeight;
    return {
      id: child.id,
      minimum: minimum ?? 0,
      maximum: maximum ?? Infinity,
    };
  });
  let remaining = available;
  while (pending.length > 0) {
    const share = remaining / pending.length;
    const upperBounded = pending.filter((child) => child.maximum < share);
    if (upperBounded.length > 0) {
      for (const child of upperBounded) {
        result.set(child.id, child.maximum);
        remaining -= child.maximum;
        pending.splice(pending.indexOf(child), 1);
      }
      continue;
    }
    const lowerBounded = pending.filter((child) => child.minimum > share);
    if (lowerBounded.length > 0) {
      for (const child of lowerBounded) {
        result.set(child.id, child.minimum);
        remaining -= child.minimum;
        pending.splice(pending.indexOf(child), 1);
      }
      continue;
    }
    for (const child of pending) result.set(child.id, Math.max(0, share));
    break;
  }
  return result;
}

export function isLayoutConstraints(
  value: unknown,
): value is LayoutConstraints {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    ["left", "right", "left-right", "center", "scale"].includes(
      String(record.horizontal),
    ) &&
    ["top", "bottom", "top-bottom", "center", "scale"].includes(
      String(record.vertical),
    ) &&
    Object.keys(record).every((key) => ["horizontal", "vertical"].includes(key))
  );
}

function solveAxis(
  constraint: HorizontalConstraint | VerticalConstraint,
  start: number,
  extent: number,
  previousParent: number,
  nextParent: number,
): { start: number; extent: number } {
  const delta = nextParent - previousParent;
  if (constraint === "right" || constraint === "bottom") {
    return { start: start + delta, extent };
  }
  if (constraint === "left-right" || constraint === "top-bottom") {
    return { start, extent: Math.max(0, extent + delta) };
  }
  if (constraint === "center") {
    return { start: start + delta / 2, extent };
  }
  if (constraint === "scale") {
    const ratio = nextParent / previousParent;
    return { start: start * ratio, extent: extent * ratio };
  }
  return { start, extent };
}

function finitePositiveSize(value: ConstraintSize): boolean {
  return (
    Number.isFinite(value.width) &&
    value.width >= 0 &&
    Number.isFinite(value.height) &&
    value.height >= 0
  );
}

function validLinearAutoLayoutRequest(
  request: LinearAutoLayoutRequest,
): boolean {
  const ids = new Set<string>();
  return (
    request.version === AUTO_LAYOUT_SERVICE_CONTRACT_VERSION &&
    finiteNonNegative(request.frame.width) &&
    finiteNonNegative(request.frame.height) &&
    (request.direction === "horizontal" || request.direction === "vertical") &&
    [request.frameSizing.horizontal, request.frameSizing.vertical].every(
      (value) => value === "fixed" || value === "hug",
    ) &&
    finiteNonNegative(request.gap) &&
    (request.wrap === undefined ||
      (request.direction === "horizontal" &&
        request.wrap.mode === "wrap" &&
        finiteNonNegative(request.wrap.counterGap))) &&
    Object.values(request.padding).every(finiteNonNegative) &&
    ["start", "center", "end", "space-between"].includes(
      request.primaryAlignment,
    ) &&
    ["start", "center", "end"].includes(request.counterAlignment) &&
    request.children.every((child) => {
      if (
        typeof child.id !== "string" ||
        child.id.length === 0 ||
        ids.has(child.id) ||
        !finiteNonNegative(child.width) ||
        !finiteNonNegative(child.height)
      ) {
        return false;
      }
      if (child.positioning !== "flow" && child.positioning !== "absolute")
        return false;
      if (!validLimits(child.limits)) return false;
      if (
        ![child.sizing.horizontal, child.sizing.vertical].every(
          (value) => value === "fixed" || value === "fill",
        )
      ) {
        return false;
      }
      ids.add(child.id);
      return true;
    }) &&
    validLimits(request.frameLimits)
  );
}

function validLimits(limits: AutoLayoutLimits | undefined): boolean {
  if (limits === undefined) return true;
  const values = Object.values(limits);
  return (
    values.length > 0 &&
    values.every(finiteNonNegative) &&
    (limits.minWidth === undefined ||
      limits.maxWidth === undefined ||
      limits.minWidth <= limits.maxWidth) &&
    (limits.minHeight === undefined ||
      limits.maxHeight === undefined ||
      limits.minHeight <= limits.maxHeight)
  );
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000;
}

function alignmentOffset(
  alignment: AutoLayoutAlignment,
  available: number,
): number {
  if (alignment === "center") return available / 2;
  if (alignment === "end") return available;
  return 0;
}

function finiteRect(value: ConstraintRect): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    value.width >= 0 &&
    Number.isFinite(value.height) &&
    value.height >= 0
  );
}

function failure(
  code: Extract<ConstraintResizeResult, { ok: false }>["code"],
  message: string,
): ConstraintResizeResult {
  return { ok: false, code, message };
}
