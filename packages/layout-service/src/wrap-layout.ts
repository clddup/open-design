import { autoGap, clampLayoutExtent, resolveFrameExtent } from "./index.js";
import { distributeBoundedFill } from "./fill-distribution.js";
import {
  baselineItemOffset,
  resolveBaselineMetrics,
} from "./baseline-alignment.js";
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
    request.frameSizing.vertical === "hug" &&
    request.children.some((child) => child.sizing.vertical === "fill")
  ) {
    return conflict("A hugged Auto Layout axis cannot contain a fill child");
  }
  const children = request.children.map((child) => ({
    ...child,
    width:
      child.sizing.horizontal === "fill"
        ? minimumExtent(child.limits?.minWidth, child.limits?.maxWidth)
        : clampLayoutExtent(child.width, child.limits, "horizontal"),
    height:
      child.sizing.vertical === "fill"
        ? minimumExtent(child.limits?.minHeight, child.limits?.maxHeight)
        : clampLayoutExtent(child.height, child.limits, "vertical"),
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
  const baselineAligned = request.counterAlignment === "baseline";
  const rows = wrapRows(children, innerWidth, packedGap, baselineAligned).map(
    (row) => resolveRowMainAxis(row, innerWidth, packedGap, baselineAligned),
  );
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
  const stretchRows =
    !autoCounterGap &&
    request.frameSizing.vertical === "fixed" &&
    children.length > 0 &&
    children.every((child) => child.sizing.vertical === "fill");
  if (stretchRows) {
    const stretch = Math.max(0, blockFree) / Math.max(1, rows.length);
    for (const row of rows) row.height += stretch;
  }
  const resolvedCounterGap = autoCounterGap
    ? request.frameSizing.vertical === "fixed"
      ? autoGap(blockFree, rows.length)
      : 0
    : request.wrap.counterGap;
  let rowY =
    request.padding.top +
    (autoCounterGap || stretchRows || baselineAligned
      ? 0
      : alignmentOffset(
          request.counterAlignment as AutoLayoutAlignment,
          blockFree,
        ));
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
    const rowBaseline = baselineAligned
      ? resolveBaselineMetrics(
          row.children.map((item) => ({
            ...(item.baseline === undefined ? {} : { baseline: item.baseline }),
            height: item.height,
            stretch: item.sizing.vertical === "fill",
          })),
        )
      : undefined;
    for (const child of row.children) {
      const childHeight =
        child.sizing.vertical === "fill"
          ? clampLayoutExtent(row.height, child.limits, "vertical")
          : child.height;
      placements.push({
        id: child.id,
        x: childX,
        y: rowBaseline
          ? rowY +
            baselineItemOffset(
              {
                ...(child.baseline === undefined
                  ? {}
                  : { baseline: child.baseline }),
                height: childHeight,
                stretch: child.sizing.vertical === "fill",
              },
              rowBaseline,
            )
          : rowY +
            alignmentOffset(
              request.counterAlignment as AutoLayoutAlignment,
              row.height - childHeight,
            ),
        width: child.width,
        height: childHeight,
      });
      childX += child.width + rowGap;
    }
    rowY += row.height + resolvedCounterGap;
  }
  return { ok: true, frame, placements };
}

function resolveRowMainAxis(
  row: ResolvedRow,
  innerWidth: number,
  gap: number,
  baselineAligned: boolean,
): ResolvedRow {
  const fillChildren = row.children.filter(
    (child) => child.sizing.horizontal === "fill",
  );
  const fixedWidth = row.children.reduce(
    (sum, child) =>
      sum + (child.sizing.horizontal === "fill" ? 0 : child.width),
    0,
  );
  const gapTotal = gap * Math.max(0, row.children.length - 1);
  const fillWidths = distributeBoundedFill(
    Math.max(0, innerWidth - fixedWidth - gapTotal),
    fillChildren.map((child) => ({
      id: child.id,
      ...(child.limits ? { limits: child.limits } : {}),
    })),
    "horizontal",
  );
  const children = row.children.map((child) => ({
    ...child,
    width:
      child.sizing.horizontal === "fill"
        ? (fillWidths.get(child.id) ?? child.width)
        : child.width,
  }));
  return {
    children,
    height: baselineAligned
      ? resolveBaselineMetrics(
          children.map((child) => ({
            ...(child.baseline === undefined
              ? {}
              : { baseline: child.baseline }),
            height: child.height,
            stretch: child.sizing.vertical === "fill",
          })),
        ).extent
      : Math.max(0, ...children.map((child) => child.height)),
    width: children.reduce((sum, child) => sum + child.width, 0) + gapTotal,
  };
}

function wrapRows(
  children: WrapRequest["children"],
  availableWidth: number,
  gap: number,
  baselineAligned: boolean,
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
        height: rowHeight([child], baselineAligned),
      });
      continue;
    }
    row.children.push(child);
    row.width = nextWidth;
    row.height = rowHeight(row.children, baselineAligned);
  }
  return rows;
}

function rowHeight(
  children: WrapRequest["children"],
  baselineAligned: boolean,
): number {
  return baselineAligned
    ? resolveBaselineMetrics(
        children.map((child) => ({
          ...(child.baseline === undefined ? {} : { baseline: child.baseline }),
          height: child.height,
          stretch: child.sizing.vertical === "fill",
        })),
      ).extent
    : Math.max(0, ...children.map((child) => child.height));
}

function alignmentOffset(
  alignment: AutoLayoutAlignment,
  available: number,
): number {
  if (alignment === "center") return available / 2;
  if (alignment === "end") return available;
  return 0;
}

function minimumExtent(
  minimum: number | undefined,
  maximum: number | undefined,
): number {
  return Math.min(maximum ?? Infinity, minimum ?? 0);
}

function conflict(message: string): LinearAutoLayoutResult {
  return { ok: false, code: "sizing-conflict", message };
}
