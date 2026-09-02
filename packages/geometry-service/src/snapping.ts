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

type ResolvedAxis = SnapMatch & { line?: SnapGuideLine };

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
