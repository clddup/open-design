import { autoGap, clampLayoutExtent, resolveFrameExtent } from "./index.js";
import type {
  AutoLayoutAlignment,
  ConstraintRect,
  ConstraintSize,
  LinearAutoLayoutRequest,
  LinearAutoLayoutResult,
} from "./index.js";

type WrapRequest = LinearAutoLayoutRequest & {
  direction: "horizontal";
  wrap: NonNullable<LinearAutoLayoutRequest["wrap"]>;
};

type ResolvedRow = {
  children: WrapRequest["children"];
  height: number;
  width: number;
};

export function solveHorizontalWrap(
  request: WrapRequest,
): LinearAutoLayoutResult {
  if (request.frameSizing.horizontal !== "fixed") {
    return conflict("A wrapped Auto Layout Frame requires fixed width");
  }
  if (
    request.children.some(
      (child) =>
        child.sizing.horizontal === "fill" || child.sizing.vertical === "fill",
    )
  ) {
    return conflict("Wrapped Auto Layout v1 does not support Fill children");
  }
  const children = request.children.map((child) => ({
    ...child,
    width: clampLayoutExtent(child.width, child.limits, "horizontal"),
    height: clampLayoutExtent(child.height, child.limits, "vertical"),
  }));
  const frameWidth = resolveFrameExtent(
    request.frame.width,
    request.frameLimits,
    "horizontal",
    request.padding.left + request.padding.right,
  );
  const innerWidth = Math.max(
    0,
    frameWidth - request.padding.left - request.padding.right,
  );
  const packedGap =
    request.primaryAlignment === "space-between" ? 0 : request.gap;
  const rows = wrapRows(children, innerWidth, packedGap);
  const rowHeightTotal = rows.reduce((sum, row) => sum + row.height, 0);
  const autoCounterGap =
    request.wrap.counterAxisAlignContent === "space-between";
  const contentHeight =
    rowHeightTotal +
    (autoCounterGap ? 0 : request.wrap.counterGap) *
      Math.max(0, rows.length - 1);
  const frame: ConstraintSize = {
    width: frameWidth,
    height: resolveFrameExtent(
      request.frameSizing.vertical === "hug"
        ? request.padding.top + contentHeight + request.padding.bottom
        : request.frame.height,
      request.frameLimits,
      "vertical",
      request.padding.top + request.padding.bottom,
    ),
  };
  const blockFree =
    frame.height - request.padding.top - request.padding.bottom - contentHeight;
  const resolvedCounterGap = autoCounterGap
    ? request.frameSizing.vertical === "fixed"
      ? autoGap(blockFree, rows.length)
      : 0
    : request.wrap.counterGap;
  let rowY =
    request.padding.top +
    (autoCounterGap ? 0 : alignmentOffset(request.counterAlignment, blockFree));
  const placements: Array<ConstraintRect & { id: string }> = [];
  for (const row of rows) {
    const rowGap =
      request.primaryAlignment === "space-between"
        ? autoGap(innerWidth - row.width, row.children.length)
        : packedGap;
    const rowContentWidth =
      request.primaryAlignment === "space-between"
        ? row.width + rowGap * Math.max(0, row.children.length - 1)
        : row.width;
    const rowFree = innerWidth - rowContentWidth;
    let childX =
      request.padding.left +
      (request.primaryAlignment === "space-between"
        ? 0
        : alignmentOffset(request.primaryAlignment, rowFree));
    for (const child of row.children) {
      placements.push({
        id: child.id,
        x: childX,
        y:
          rowY +
          alignmentOffset(request.counterAlignment, row.height - child.height),
        width: child.width,
        height: child.height,
      });
      childX += child.width + rowGap;
    }
    rowY += row.height + resolvedCounterGap;
  }
  return { ok: true, frame, placements };
}

function wrapRows(
  children: WrapRequest["children"],
  availableWidth: number,
  gap: number,
): ResolvedRow[] {
  const rows: ResolvedRow[] = [];
  for (const child of children) {
    let row = rows.at(-1);
    const nextWidth = row ? row.width + gap + child.width : child.width;
    if (row && nextWidth > availableWidth) row = undefined;
    if (!row) {
      rows.push({
        children: [child],
        width: child.width,
        height: child.height,
      });
      continue;
    }
    row.children.push(child);
    row.width = nextWidth;
    row.height = Math.max(row.height, child.height);
  }
  return rows;
}

function alignmentOffset(
  alignment: AutoLayoutAlignment,
  available: number,
): number {
  if (alignment === "center") return available / 2;
  if (alignment === "end") return available;
  return 0;
}

function conflict(message: string): LinearAutoLayoutResult {
  return { ok: false, code: "sizing-conflict", message };
}
