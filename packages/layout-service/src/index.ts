import { solveHorizontalWrap } from "./wrap-layout.js";

export const LAYOUT_SERVICE_CONTRACT_VERSION = 1 as const;
export const AUTO_LAYOUT_SERVICE_CONTRACT_VERSION = 3 as const;

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
export type AutoLayoutFrameAxisSizing = "fixed" | "hug";
export type AutoLayoutChildAxisSizing = "fixed" | "fill";
export type AutoLayoutPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export type LinearAutoLayoutRequest = {
  version: typeof AUTO_LAYOUT_SERVICE_CONTRACT_VERSION;
  direction: AutoLayoutDirection;
  frame: ConstraintSize;
  padding: AutoLayoutPadding;
  gap: number;
  primaryAlignment: AutoLayoutAlignment;
  counterAlignment: AutoLayoutAlignment;
  frameSizing: {
    horizontal: AutoLayoutFrameAxisSizing;
    vertical: AutoLayoutFrameAxisSizing;
  };
  wrap?: { mode: "wrap"; counterGap: number };
  children: Array<{
    id: string;
    width: number;
    height: number;
    sizing: {
      horizontal: AutoLayoutChildAxisSizing;
      vertical: AutoLayoutChildAxisSizing;
    };
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
  if (request.wrap) {
    return solveHorizontalWrap({
      ...request,
      direction: "horizontal",
      wrap: request.wrap,
    });
  }
  const horizontalHug = request.frameSizing.horizontal === "hug";
  const verticalHug = request.frameSizing.vertical === "hug";
  if (
    (horizontalHug &&
      request.children.some((child) => child.sizing.horizontal === "fill")) ||
    (verticalHug &&
      request.children.some((child) => child.sizing.vertical === "fill"))
  ) {
    return {
      ok: false,
      code: "sizing-conflict",
      message: "A hugged Auto Layout axis cannot contain a fill child",
    };
  }
  const frame = {
    width: horizontalHug
      ? huggedExtent(
          request.children.map((child) => child.width),
          request.direction === "horizontal",
          request.gap,
          request.padding.left + request.padding.right,
        )
      : request.frame.width,
    height: verticalHug
      ? huggedExtent(
          request.children.map((child) => child.height),
          request.direction === "vertical",
          request.gap,
          request.padding.top + request.padding.bottom,
        )
      : request.frame.height,
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
  const mainFillCount = request.children.filter((child) =>
    horizontal
      ? child.sizing.horizontal === "fill"
      : child.sizing.vertical === "fill",
  ).length;
  const fixedMain = request.children.reduce((sum, child) => {
    const fill = horizontal
      ? child.sizing.horizontal === "fill"
      : child.sizing.vertical === "fill";
    return sum + (fill ? 0 : horizontal ? child.width : child.height);
  }, 0);
  const gapTotal = request.gap * Math.max(0, request.children.length - 1);
  const fillMain =
    mainFillCount === 0
      ? 0
      : Math.max(0, frameMain - mainStart - mainEnd - fixedMain - gapTotal) /
        mainFillCount;
  const resolvedChildren = request.children.map((child) => ({
    ...child,
    width:
      child.sizing.horizontal === "fill"
        ? horizontal
          ? fillMain
          : Math.max(
              0,
              frame.width - request.padding.left - request.padding.right,
            )
        : child.width,
    height:
      child.sizing.vertical === "fill"
        ? horizontal
          ? Math.max(
              0,
              frame.height - request.padding.top - request.padding.bottom,
            )
          : fillMain
        : child.height,
  }));
  const contentMain =
    resolvedChildren.reduce(
      (sum, child) => sum + (horizontal ? child.width : child.height),
      0,
    ) + gapTotal;
  const mainFree = frameMain - mainStart - mainEnd - contentMain;
  let cursor = mainStart + alignmentOffset(request.primaryAlignment, mainFree);
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
    cursor += childMain + request.gap;
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
    [request.primaryAlignment, request.counterAlignment].every((value) =>
      ["start", "center", "end"].includes(value),
    ) &&
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
      if (
        ![child.sizing.horizontal, child.sizing.vertical].every(
          (value) => value === "fixed" || value === "fill",
        )
      ) {
        return false;
      }
      ids.add(child.id);
      return true;
    })
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
