export const LAYOUT_SERVICE_CONTRACT_VERSION = 1 as const;
export const AUTO_LAYOUT_SERVICE_CONTRACT_VERSION = 1 as const;

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
  children: Array<{ id: string; width: number; height: number }>;
};
export type LinearAutoLayoutResult =
  | {
      ok: true;
      placements: Array<{ id: string; x: number; y: number }>;
    }
  | { ok: false; code: "invalid-input"; message: string };

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
  const horizontal = request.direction === "horizontal";
  const mainStart = horizontal ? request.padding.left : request.padding.top;
  const mainEnd = horizontal ? request.padding.right : request.padding.bottom;
  const counterStart = horizontal ? request.padding.top : request.padding.left;
  const counterEnd = horizontal
    ? request.padding.bottom
    : request.padding.right;
  const frameMain = horizontal ? request.frame.width : request.frame.height;
  const frameCounter = horizontal ? request.frame.height : request.frame.width;
  const contentMain =
    request.children.reduce(
      (sum, child) => sum + (horizontal ? child.width : child.height),
      0,
    ) +
    request.gap * Math.max(0, request.children.length - 1);
  const mainFree = frameMain - mainStart - mainEnd - contentMain;
  let cursor = mainStart + alignmentOffset(request.primaryAlignment, mainFree);
  const placements = request.children.map((child) => {
    const childMain = horizontal ? child.width : child.height;
    const childCounter = horizontal ? child.height : child.width;
    const counterFree = frameCounter - counterStart - counterEnd - childCounter;
    const counter =
      counterStart + alignmentOffset(request.counterAlignment, counterFree);
    const placement = {
      id: child.id,
      x: horizontal ? cursor : counter,
      y: horizontal ? counter : cursor,
    };
    cursor += childMain + request.gap;
    return placement;
  });
  return { ok: true, placements };
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
    finitePositiveSize(request.frame) &&
    request.frame.width > 0 &&
    request.frame.height > 0 &&
    (request.direction === "horizontal" || request.direction === "vertical") &&
    finiteNonNegative(request.gap) &&
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
