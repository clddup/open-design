import type {
  VariableWidthPoint,
  VariableWidthStrokeProperties,
} from "@opendesign/design-contracts";
import { variableWidthProfilePoints } from "./vector-variable-width.js";

const POSITION_EPSILON = 0.000_01;

export interface VariableWidthPointInsertion {
  index: number;
  profile: Extract<VariableWidthStrokeProperties, { widthProfile: "CUSTOM" }>;
}

export function insertVariableWidthPoint(
  profile: VariableWidthStrokeProperties,
  position: number,
): VariableWidthPointInsertion | null {
  if (!Number.isFinite(position)) return null;
  const points = variableWidthProfilePoints(profile).map((point) => ({
    ...point,
  }));
  const nextPosition = Math.min(1, Math.max(0, position));
  const existingIndex = points.findIndex(
    (point) => Math.abs(point.position - nextPosition) <= POSITION_EPSILON,
  );
  if (existingIndex >= 0) {
    return { index: existingIndex, profile: customProfile(points) };
  }
  const index = points.findIndex((point) => point.position > nextPosition);
  const insertionIndex = index < 0 ? points.length : index;
  points.splice(insertionIndex, 0, {
    position: nextPosition,
    width: widthAt(points, nextPosition),
  });
  return { index: insertionIndex, profile: customProfile(points) };
}

export function updateVariableWidthPoints(
  profile: Extract<VariableWidthStrokeProperties, { widthProfile: "CUSTOM" }>,
  selectedIndexes: readonly number[],
  anchorIndex: number,
  nextAnchor: VariableWidthPoint,
): typeof profile | null {
  const selected = normalizedIndexes(
    selectedIndexes,
    profile.variableWidthPoints,
  );
  if (
    !selected.includes(anchorIndex) ||
    !Number.isFinite(nextAnchor.position) ||
    !Number.isFinite(nextAnchor.width)
  ) {
    return null;
  }
  const points = profile.variableWidthPoints.map((point) => ({ ...point }));
  const anchor = points[anchorIndex]!;
  const positionDelta = constrainedPositionDelta(
    points,
    new Set(selected),
    nextAnchor.position - anchor.position,
  );
  const widthDelta = nextAnchor.width - anchor.width;
  for (const index of selected) {
    const point = points[index]!;
    point.position += positionDelta;
    point.width = Math.max(0, point.width + widthDelta);
  }
  return customProfile(points);
}

export function deleteVariableWidthPoints(
  profile: Extract<VariableWidthStrokeProperties, { widthProfile: "CUSTOM" }>,
  selectedIndexes: readonly number[],
): typeof profile | null {
  const selected = new Set(
    normalizedIndexes(selectedIndexes, profile.variableWidthPoints),
  );
  if (selected.size === 0) return null;
  const points = profile.variableWidthPoints.filter(
    (_, index) => !selected.has(index),
  );
  return points.length >= 2 ? customProfile(points) : null;
}

function constrainedPositionDelta(
  points: readonly VariableWidthPoint[],
  selected: ReadonlySet<number>,
  requested: number,
): number {
  let minimum = Number.NEGATIVE_INFINITY;
  let maximum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    if (!selected.has(index)) continue;
    const point = points[index]!;
    const previous = previousUnselected(points, selected, index);
    const next = nextUnselected(points, selected, index);
    minimum = Math.max(
      minimum,
      (previous?.position ?? -POSITION_EPSILON) +
        POSITION_EPSILON -
        point.position,
    );
    maximum = Math.min(
      maximum,
      (next?.position ?? 1 + POSITION_EPSILON) -
        POSITION_EPSILON -
        point.position,
    );
  }
  return Math.min(maximum, Math.max(minimum, requested));
}

function previousUnselected(
  points: readonly VariableWidthPoint[],
  selected: ReadonlySet<number>,
  index: number,
): VariableWidthPoint | undefined {
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (!selected.has(candidate)) return points[candidate];
  }
  return undefined;
}

function nextUnselected(
  points: readonly VariableWidthPoint[],
  selected: ReadonlySet<number>,
  index: number,
): VariableWidthPoint | undefined {
  for (let candidate = index + 1; candidate < points.length; candidate += 1) {
    if (!selected.has(candidate)) return points[candidate];
  }
  return undefined;
}

function normalizedIndexes(
  indexes: readonly number[],
  points: readonly VariableWidthPoint[],
): number[] {
  return [...new Set(indexes)]
    .filter((index) => Number.isInteger(index) && points[index] !== undefined)
    .sort((left, right) => left - right);
}

function customProfile(
  points: readonly VariableWidthPoint[],
): Extract<VariableWidthStrokeProperties, { widthProfile: "CUSTOM" }> {
  return {
    widthProfile: "CUSTOM",
    variableWidthPoints: points.map((point) => ({ ...point })),
  };
}

function widthAt(
  points: readonly VariableWidthPoint[],
  position: number,
): number {
  const rightIndex = points.findIndex((point) => point.position > position);
  if (rightIndex <= 0) return points[Math.max(0, rightIndex)]?.width ?? 1;
  if (rightIndex < 0) return points.at(-1)?.width ?? 1;
  const left = points[rightIndex - 1]!;
  const right = points[rightIndex]!;
  const progress =
    (position - left.position) / (right.position - left.position);
  return left.width + (right.width - left.width) * progress;
}
