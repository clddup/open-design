import type { Rect } from "@opendesign/design-contracts";

export type SnapAxis = "x" | "y";
export type SnapAnchor = "start" | "center" | "end";
export type SnapTargetSource = "guide" | "object";

export interface SnapTarget {
  axis: SnapAxis;
  id: string;
  position: number;
  range: { end: number; start: number };
  source: SnapTargetSource;
}

export interface SnapGuideLine {
  axis: SnapAxis;
  position: number;
  range: { end: number; start: number };
  source: SnapTargetSource;
}

export interface SnapResolution {
  delta: { x: number; y: number };
  lines: readonly SnapGuideLine[];
  matches: readonly SnapMatch[];
}

export interface ResizeSnapResolution extends SnapResolution {
  bounds: Rect;
}

export interface SnapTargetIndex {
  x: readonly SnapTarget[];
  y: readonly SnapTarget[];
}

export interface SnapMatch {
  axis: SnapAxis;
  delta: number;
  selectionAnchor: SnapAnchor;
  source: SnapTargetSource | "pixel-grid";
  targetId: string;
  targetPosition: number;
}

export function createSnapTargetIndex(
  targets: readonly SnapTarget[],
): SnapTargetIndex {
  const compare = (left: SnapTarget, right: SnapTarget) =>
    left.position - right.position || left.id.localeCompare(right.id);
  return {
    x: targets.filter(({ axis }) => axis === "x").sort(compare),
    y: targets.filter(({ axis }) => axis === "y").sort(compare),
  };
}

export function resolveMoveSnapping(input: {
  pixelGrid: boolean;
  selection: Rect;
  targets: SnapTargetIndex;
  threshold: number;
}): SnapResolution {
  const x = resolveAxis("x", input);
  const y = resolveAxis("y", input);
  const matches = [x, y].flatMap((match) => (match ? [match] : []));
  return {
    delta: { x: x?.delta ?? 0, y: y?.delta ?? 0 },
    lines: matches.flatMap((match) => (match.line ? [match.line] : [])),
    matches: matches.map((match) => ({
      axis: match.axis,
      delta: match.delta,
      selectionAnchor: match.selectionAnchor,
      source: match.source,
      targetId: match.targetId,
      targetPosition: match.targetPosition,
    })),
  };
}

export function resolveResizeSnapping(input: {
  aroundCenter: boolean;
  horizontal: "start" | "end" | null;
  lockRatio: boolean;
  pixelGrid: boolean;
  selection: Rect;
  targets: SnapTargetIndex;
  threshold: number;
  vertical: "start" | "end" | null;
}): ResizeSnapResolution {
  const x = input.horizontal
    ? resolveResizeAxis("x", input.horizontal, input)
    : undefined;
  const y = input.vertical
    ? resolveResizeAxis("y", input.vertical, input)
    : undefined;
  if (input.lockRatio && (input.horizontal || input.vertical)) {
    return resolveRatioLockedResize(input, x, y);
  }
  const bounds = applyResizeDeltas(input.selection, {
    aroundCenter: input.aroundCenter,
    horizontal: input.horizontal,
    vertical: input.vertical,
    x: x?.delta ?? 0,
    y: y?.delta ?? 0,
  });
  if (bounds.width <= 0 || bounds.height <= 0) {
    return resizeResolution(input.selection, input.selection, []);
  }
  const matches = [x, y].flatMap((match) => (match ? [match] : []));
  return resizeResolution(input.selection, bounds, matches);
}

type ResolvedAxis = SnapMatch & { line?: SnapGuideLine };

function resolveResizeAxis(
  axis: SnapAxis,
  anchor: Exclude<SnapAnchor, "center">,
  input: {
    pixelGrid: boolean;
    selection: Rect;
    targets: SnapTargetIndex;
    threshold: number;
  },
): ResolvedAxis | undefined {
  const position = resizeAnchorPosition(axis, anchor, input.selection);
  const target = nearbyTargets(input.targets[axis], position, input.threshold)
    .map((candidate) => ({
      axis,
      delta: candidate.position - position,
      line: guideLine(axis, input.selection, candidate),
      selectionAnchor: anchor,
      source: candidate.source,
      targetId: candidate.id,
      targetPosition: candidate.position,
    }))
    .sort(compareMatches)[0];
  if (target) return target;
  if (!input.pixelGrid) return undefined;
  const targetPosition = Math.round(position);
  const delta = targetPosition - position;
  if (Math.abs(delta) > input.threshold) return undefined;
  return {
    axis,
    delta,
    selectionAnchor: anchor,
    source: "pixel-grid",
    targetId: `pixel:${targetPosition}`,
    targetPosition,
  };
}

function resolveRatioLockedResize(
  input: {
    aroundCenter: boolean;
    horizontal: "start" | "end" | null;
    selection: Rect;
    vertical: "start" | "end" | null;
  },
  x: ResolvedAxis | undefined,
  y: ResolvedAxis | undefined,
): ResizeSnapResolution {
  const selected = [x, y]
    .flatMap((match) => (match ? [match] : []))
    .sort(compareMatches)[0];
  if (!selected) return resizeResolution(input.selection, input.selection, []);
  const anchor = selected.axis === "x" ? input.horizontal : input.vertical;
  if (!anchor) return resizeResolution(input.selection, input.selection, []);
  const size =
    selected.axis === "x" ? input.selection.width : input.selection.height;
  const factor = input.aroundCenter ? 2 : 1;
  const sign = anchor === "start" ? -1 : 1;
  const scale = (size + sign * factor * selected.delta) / size;
  if (!Number.isFinite(scale) || scale <= 0) {
    return resizeResolution(input.selection, input.selection, []);
  }
  const bounds = scaleRectFromResizeAnchor(input.selection, scale, input);
  const matches = [selected];
  const secondary = selected.axis === "x" ? y : x;
  if (
    secondary &&
    Math.abs(
      resizeAnchorPosition(secondary.axis, secondary.selectionAnchor, bounds) -
        secondary.targetPosition,
    ) <= 0.000_001
  ) {
    matches.push(secondary);
  }
  return resizeResolution(input.selection, bounds, matches);
}

function applyResizeDeltas(
  selection: Rect,
  input: {
    aroundCenter: boolean;
    horizontal: "start" | "end" | null;
    vertical: "start" | "end" | null;
    x: number;
    y: number;
  },
): Rect {
  const bounds = { ...selection };
  applyResizeAxis(bounds, "x", input.horizontal, input.x, input.aroundCenter);
  applyResizeAxis(bounds, "y", input.vertical, input.y, input.aroundCenter);
  return bounds;
}

function applyResizeAxis(
  bounds: Rect,
  axis: SnapAxis,
  anchor: "start" | "end" | null,
  delta: number,
  aroundCenter: boolean,
): void {
  if (!anchor || delta === 0) return;
  const positionKey = axis === "x" ? "x" : "y";
  const sizeKey = axis === "x" ? "width" : "height";
  if (aroundCenter) {
    if (anchor === "start") bounds[positionKey] += delta;
    else bounds[positionKey] -= delta;
    bounds[sizeKey] += (anchor === "start" ? -2 : 2) * delta;
  } else if (anchor === "start") {
    bounds[positionKey] += delta;
    bounds[sizeKey] -= delta;
  } else {
    bounds[sizeKey] += delta;
  }
}

function scaleRectFromResizeAnchor(
  selection: Rect,
  scale: number,
  input: {
    aroundCenter: boolean;
    horizontal: "start" | "end" | null;
    vertical: "start" | "end" | null;
  },
): Rect {
  const originX = resizeScaleOrigin(
    selection.x,
    selection.width,
    input.horizontal,
    input.aroundCenter,
  );
  const originY = resizeScaleOrigin(
    selection.y,
    selection.height,
    input.vertical,
    input.aroundCenter,
  );
  return {
    x: originX + (selection.x - originX) * scale,
    y: originY + (selection.y - originY) * scale,
    width: selection.width * scale,
    height: selection.height * scale,
  };
}

function resizeScaleOrigin(
  start: number,
  size: number,
  anchor: "start" | "end" | null,
  aroundCenter: boolean,
): number {
  if (aroundCenter || !anchor) return start + size / 2;
  return anchor === "start" ? start + size : start;
}

function resizeResolution(
  selection: Rect,
  bounds: Rect,
  matches: readonly ResolvedAxis[],
): ResizeSnapResolution {
  const byAxis = new Map(matches.map((match) => [match.axis, match]));
  return {
    bounds,
    delta: {
      x: resizeEdgeDelta("x", selection, bounds, byAxis.get("x")),
      y: resizeEdgeDelta("y", selection, bounds, byAxis.get("y")),
    },
    lines: matches.flatMap((match) =>
      match.line
        ? [
            {
              ...match.line,
              range: resizeGuideRange(match.axis, bounds, match.line.range),
            },
          ]
        : [],
    ),
    matches: matches.map((match) => ({
      axis: match.axis,
      delta: match.delta,
      selectionAnchor: match.selectionAnchor,
      source: match.source,
      targetId: match.targetId,
      targetPosition: match.targetPosition,
    })),
  };
}

function resizeEdgeDelta(
  axis: SnapAxis,
  before: Rect,
  after: Rect,
  match: ResolvedAxis | undefined,
): number {
  if (!match) return 0;
  return (
    resizeAnchorPosition(axis, match.selectionAnchor, after) -
    resizeAnchorPosition(axis, match.selectionAnchor, before)
  );
}

function resizeGuideRange(
  axis: SnapAxis,
  selection: Rect,
  target: { start: number; end: number },
) {
  const selectionStart = axis === "x" ? selection.y : selection.x;
  const selectionSize = axis === "x" ? selection.height : selection.width;
  return {
    start: Math.min(selectionStart, target.start),
    end: Math.max(selectionStart + selectionSize, target.end),
  };
}

function resizeAnchorPosition(
  axis: SnapAxis,
  anchor: SnapAnchor,
  selection: Rect,
): number {
  const start = axis === "x" ? selection.x : selection.y;
  const size = axis === "x" ? selection.width : selection.height;
  return anchor === "start"
    ? start
    : anchor === "center"
      ? start + size / 2
      : start + size;
}

function resolveAxis(
  axis: SnapAxis,
  input: {
    pixelGrid: boolean;
    selection: Rect;
    targets: SnapTargetIndex;
    threshold: number;
  },
): ResolvedAxis | undefined {
  const anchors = selectionAnchors(axis, input.selection);
  const targetMatches = anchors
    .flatMap(({ anchor, position }) =>
      nearbyTargets(input.targets[axis], position, input.threshold).map(
        (target) => ({
          axis,
          delta: target.position - position,
          line: guideLine(axis, input.selection, target),
          selectionAnchor: anchor,
          source: target.source,
          targetId: target.id,
          targetPosition: target.position,
        }),
      ),
    )
    .sort(compareMatches)[0];
  if (targetMatches) return targetMatches;
  if (!input.pixelGrid) return undefined;

  const start = anchors[0]!;
  const targetPosition = Math.round(start.position);
  const delta = targetPosition - start.position;
  if (Math.abs(delta) > input.threshold) return undefined;
  return {
    axis,
    delta,
    selectionAnchor: "start",
    source: "pixel-grid",
    targetId: `pixel:${targetPosition}`,
    targetPosition,
  };
}

function nearbyTargets(
  targets: readonly SnapTarget[],
  position: number,
  threshold: number,
): readonly SnapTarget[] {
  const minimum = position - threshold;
  const maximum = position + threshold;
  let low = 0;
  let high = targets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (targets[middle]!.position < minimum) low = middle + 1;
    else high = middle;
  }
  const matches: SnapTarget[] = [];
  for (let index = low; index < targets.length; index += 1) {
    const target = targets[index]!;
    if (target.position > maximum) break;
    matches.push(target);
  }
  return matches;
}

function selectionAnchors(
  axis: SnapAxis,
  selection: Rect,
): readonly { anchor: SnapAnchor; position: number }[] {
  const start = axis === "x" ? selection.x : selection.y;
  const size = axis === "x" ? selection.width : selection.height;
  return [
    { anchor: "start", position: start },
    { anchor: "center", position: start + size / 2 },
    { anchor: "end", position: start + size },
  ];
}

function guideLine(
  axis: SnapAxis,
  selection: Rect,
  target: SnapTarget,
): SnapGuideLine {
  const selectionStart = axis === "x" ? selection.y : selection.x;
  const selectionSize = axis === "x" ? selection.height : selection.width;
  return {
    axis,
    position: target.position,
    range: {
      start: Math.min(selectionStart, target.range.start),
      end: Math.max(selectionStart + selectionSize, target.range.end),
    },
    source: target.source,
  };
}

function compareMatches(left: ResolvedAxis, right: ResolvedAxis): number {
  return (
    sourcePriority(left.source) - sourcePriority(right.source) ||
    Math.abs(left.delta) - Math.abs(right.delta) ||
    anchorPriority(left.selectionAnchor) -
      anchorPriority(right.selectionAnchor) ||
    left.targetId.localeCompare(right.targetId) ||
    left.targetPosition - right.targetPosition
  );
}

function sourcePriority(source: SnapMatch["source"]): number {
  return source === "guide" ? 0 : source === "object" ? 1 : 2;
}

function anchorPriority(anchor: SnapAnchor): number {
  return anchor === "start" ? 0 : anchor === "center" ? 1 : 2;
}
