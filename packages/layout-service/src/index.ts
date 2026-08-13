export const LAYOUT_SERVICE_CONTRACT_VERSION = 1 as const;

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
