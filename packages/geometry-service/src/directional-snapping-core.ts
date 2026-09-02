import type { Rect, Transform } from "@opendesign/design-contracts";
import type {
  SnapGuideLine,
  SnapTarget,
  SnapTargetSource,
} from "./snapping.js";

export const DIRECTIONAL_EPSILON = 0.000_001;

export interface DirectionalPoint {
  x: number;
  y: number;
}

export interface DirectionalSnapFrame {
  bounds: Rect;
  transform: Transform;
}

export interface DirectionalSnapTarget {
  end: DirectionalPoint;
  id: string;
  source: SnapTargetSource;
  start: DirectionalPoint;
}

export interface IndexedDirectionalTarget extends DirectionalSnapTarget {
  normal: DirectionalPoint;
  offset: number;
  tangent: DirectionalPoint;
}

export interface DirectionalTargetGroup {
  normal: DirectionalPoint;
  tangent: DirectionalPoint;
  targets: readonly IndexedDirectionalTarget[];
}

export interface DirectionalSnapTargetIndex {
  groups: readonly DirectionalTargetGroup[];
}

export interface DirectionalSnapMatch {
  source: SnapTargetSource;
  targetId: string;
}

export interface DirectionalMoveSnapResolution {
  delta: DirectionalPoint;
  lines: readonly SnapGuideLine[];
  matches: readonly DirectionalSnapMatch[];
}

export interface DirectionalResizeSnapResolution {
  lines: readonly SnapGuideLine[];
  matches: readonly DirectionalSnapMatch[];
  scaleX: number;
  scaleY: number;
}

export interface DirectionalSnapOption {
  anchor: DirectionalPoint;
  distance: number;
  primary: boolean;
  target: IndexedDirectionalTarget;
}

export function directionalTargetFromAxis(
  target: SnapTarget,
): DirectionalSnapTarget {
  return target.axis === "x"
    ? {
        end: { x: target.position, y: target.range.end },
        id: target.id,
        source: target.source,
        start: { x: target.position, y: target.range.start },
      }
    : {
        end: { x: target.range.end, y: target.position },
        id: target.id,
        source: target.source,
        start: { x: target.range.start, y: target.position },
      };
}

export function createDirectionalSnapTargetIndex(
  targets: readonly DirectionalSnapTarget[],
): DirectionalSnapTargetIndex {
  const groups = new Map<string, IndexedDirectionalTarget[]>();
  targets.forEach((target) => {
    const indexed = indexTarget(target);
    if (!indexed) return;
    const key = normalKey(indexed.normal);
    const entries = groups.get(key) ?? [];
    entries.push(indexed);
    groups.set(key, entries);
  });
  return {
    groups: [...groups.values()]
      .map((entries) => ({
        normal: entries[0]!.normal,
        tangent: entries[0]!.tangent,
        targets: entries.sort(
          (left, right) =>
            left.offset - right.offset || left.id.localeCompare(right.id),
        ),
      }))
      .sort((left, right) =>
        normalKey(left.normal).localeCompare(normalKey(right.normal)),
      ),
  };
}

export function moveOptions(input: {
  frame: DirectionalSnapFrame;
  primaryTargetIds: ReadonlySet<string>;
  targets: DirectionalSnapTargetIndex;
  threshold: number;
}): DirectionalSnapOption[][] {
  const corners = frameCorners(input.frame);
  const center = transformPoint(
    rectCenter(input.frame.bounds),
    input.frame.transform,
  );
  return input.targets.groups.map((group) => {
    const sorted = [...corners].sort(
      (left, right) =>
        project(left, group.normal) - project(right, group.normal),
    );
    return [sorted[0]!, center, sorted.at(-1)!].flatMap((anchor) =>
      nearbyOptions(group, anchor, input),
    );
  });
}

export function pointOptions(
  point: DirectionalPoint,
  input: {
    primaryTargetIds: ReadonlySet<string>;
    targets: DirectionalSnapTargetIndex;
    threshold: number;
  },
): DirectionalSnapOption[][] {
  return input.targets.groups.map((group) =>
    nearbyOptions(group, point, input),
  );
}

function nearbyOptions(
  group: DirectionalTargetGroup,
  anchor: DirectionalPoint,
  input: { primaryTargetIds: ReadonlySet<string>; threshold: number },
): DirectionalSnapOption[] {
  const position = project(anchor, group.normal);
  const nearby = nearbyTargets(group.targets, position, input.threshold).map(
    (target) => ({
      anchor,
      distance: target.offset - position,
      primary: input.primaryTargetIds.has(target.id),
      target,
    }),
  );
  return [
    bestOption(nearby.filter(({ primary }) => primary)),
    bestOption(nearby.filter(({ primary }) => !primary)),
  ].flatMap((option) => (option ? [option] : []));
}

function bestOption(
  options: readonly DirectionalSnapOption[],
): DirectionalSnapOption | undefined {
  return [...options].sort(compareOptions)[0];
}

function compareOptions(
  left: DirectionalSnapOption,
  right: DirectionalSnapOption,
): number {
  return (
    sourcePriority(left.target.source) - sourcePriority(right.target.source) ||
    Math.abs(left.distance) - Math.abs(right.distance) ||
    left.target.id.localeCompare(right.target.id)
  );
}

export function snapLine(
  match: DirectionalSnapOption,
  point: DirectionalPoint,
): SnapGuideLine {
  const target = match.target;
  const tangentPositions = [
    project(target.start, target.tangent),
    project(target.end, target.tangent),
    project(point, target.tangent),
  ];
  const start = pointOnLine(target, Math.min(...tangentPositions));
  const end = pointOnLine(target, Math.max(...tangentPositions));
  if (Math.abs(start.x - end.x) <= DIRECTIONAL_EPSILON) {
    return {
      axis: "x",
      position: (start.x + end.x) / 2,
      range: { start: Math.min(start.y, end.y), end: Math.max(start.y, end.y) },
      source: target.source,
    };
  }
  if (Math.abs(start.y - end.y) <= DIRECTIONAL_EPSILON) {
    return {
      axis: "y",
      position: (start.y + end.y) / 2,
      range: { start: Math.min(start.x, end.x), end: Math.max(start.x, end.x) },
      source: target.source,
    };
  }
  return { kind: "segment", start, end, source: target.source };
}

function pointOnLine(
  target: IndexedDirectionalTarget,
  tangentPosition: number,
): DirectionalPoint {
  return add(
    scale(target.normal, target.offset),
    scale(target.tangent, tangentPosition),
  );
}

export function matchSummary(
  option: DirectionalSnapOption,
): DirectionalSnapMatch {
  return { source: option.target.source, targetId: option.target.id };
}

export function compareSnapCandidates(
  left: { matches: readonly DirectionalSnapOption[]; movement: number },
  right: { matches: readonly DirectionalSnapOption[]; movement: number },
): number {
  return (
    right.matches.length - left.matches.length ||
    candidatePriority(left.matches) - candidatePriority(right.matches) ||
    left.movement - right.movement ||
    candidateId(left.matches).localeCompare(candidateId(right.matches))
  );
}

function candidatePriority(matches: readonly DirectionalSnapOption[]): number {
  return matches.reduce(
    (total, match) => total + sourcePriority(match.target.source),
    0,
  );
}

export function sourcePriority(source: SnapTargetSource): number {
  return source === "guide" ? 0 : source === "geometry" ? 1 : 2;
}

function candidateId(matches: readonly DirectionalSnapOption[]): string {
  return matches
    .map(({ target }) => target.id)
    .sort()
    .join("|");
}

function indexTarget(
  target: DirectionalSnapTarget,
): IndexedDirectionalTarget | null {
  const direction = subtract(target.end, target.start);
  const length = magnitude(direction);
  if (
    !finitePoint(target.start) ||
    !finitePoint(target.end) ||
    !Number.isFinite(length) ||
    length <= DIRECTIONAL_EPSILON
  ) {
    return null;
  }
  let tangent = scale(direction, 1 / length);
  let normal = { x: -tangent.y, y: tangent.x };
  if (
    normal.x < -DIRECTIONAL_EPSILON ||
    (Math.abs(normal.x) <= DIRECTIONAL_EPSILON && normal.y < 0)
  ) {
    normal = scale(normal, -1);
    tangent = scale(tangent, -1);
  }
  return {
    ...target,
    normal,
    offset: project(target.start, normal),
    tangent,
  };
}

function nearbyTargets(
  targets: readonly IndexedDirectionalTarget[],
  position: number,
  threshold: number,
): readonly IndexedDirectionalTarget[] {
  const minimum = position - threshold;
  const maximum = position + threshold;
  let low = 0;
  let high = targets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (targets[middle]!.offset < minimum) low = middle + 1;
    else high = middle;
  }
  const matches: IndexedDirectionalTarget[] = [];
  for (let index = low; index < targets.length; index += 1) {
    const target = targets[index]!;
    if (target.offset > maximum) break;
    matches.push(target);
  }
  return matches;
}

function frameCorners(frame: DirectionalSnapFrame): DirectionalPoint[] {
  const { bounds, transform } = frame;
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => transformPoint(point, transform));
}

function rectCenter(bounds: Rect): DirectionalPoint {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export function validFrame(frame: DirectionalSnapFrame): boolean {
  const [a, b, c, d] = frame.transform;
  return (
    [
      ...frame.transform,
      frame.bounds.x,
      frame.bounds.y,
      frame.bounds.width,
      frame.bounds.height,
    ].every(Number.isFinite) &&
    frame.bounds.width > 0 &&
    frame.bounds.height > 0 &&
    Math.abs(a * d - b * c) > DIRECTIONAL_EPSILON
  );
}

export function validThreshold(threshold: number): boolean {
  return Number.isFinite(threshold) && threshold >= 0;
}

export function validScale(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalKey(normal: DirectionalPoint): string {
  return `${Math.round(normal.x / DIRECTIONAL_EPSILON)}:${Math.round(normal.y / DIRECTIONAL_EPSILON)}`;
}

export function transformPoint(
  point: DirectionalPoint,
  transform: Transform,
): DirectionalPoint {
  return {
    x: transform[0] * point.x + transform[2] * point.y + transform[4],
    y: transform[1] * point.x + transform[3] * point.y + transform[5],
  };
}

export function transformVector(
  point: DirectionalPoint,
  transform: Transform,
): DirectionalPoint {
  return {
    x: transform[0] * point.x + transform[2] * point.y,
    y: transform[1] * point.x + transform[3] * point.y,
  };
}

export function project(
  point: DirectionalPoint,
  axis: DirectionalPoint,
): number {
  return point.x * axis.x + point.y * axis.y;
}

export function cross(left: DirectionalPoint, right: DirectionalPoint): number {
  return left.x * right.y - left.y * right.x;
}

export function add(
  left: DirectionalPoint,
  right: DirectionalPoint,
): DirectionalPoint {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(
  left: DirectionalPoint,
  right: DirectionalPoint,
): DirectionalPoint {
  return { x: left.x - right.x, y: left.y - right.y };
}

export function scale(
  point: DirectionalPoint,
  factor: number,
): DirectionalPoint {
  return { x: point.x * factor, y: point.y * factor };
}

export function magnitude(point: DirectionalPoint): number {
  return Math.hypot(point.x, point.y);
}

export function finitePoint(point: DirectionalPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
