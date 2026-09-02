import type { Rect } from "@opendesign/design-contracts";
import {
  DIRECTIONAL_EPSILON,
  add,
  compareSnapCandidates,
  finitePoint,
  magnitude,
  matchSummary,
  pointOptions,
  project,
  scale,
  snapLine,
  transformPoint,
  transformVector,
  validFrame,
  validScale,
  validThreshold,
  type DirectionalPoint,
  type DirectionalResizeSnapResolution,
  type DirectionalSnapFrame,
  type DirectionalSnapOption,
  type DirectionalSnapTargetIndex,
} from "./directional-snapping-core.js";

interface ResizeGeometry {
  derivativeX: DirectionalPoint;
  derivativeY: DirectionalPoint;
  point: DirectionalPoint;
}

interface ResizeCandidate {
  correctionX: number;
  correctionY: number;
  matches: readonly DirectionalSnapOption[];
  movement: number;
}

interface ResizeInput {
  aroundCenter: boolean;
  frame: DirectionalSnapFrame;
  horizontal: "start" | "end" | null;
  lockRatio: boolean;
  primaryTargetIds: ReadonlySet<string>;
  scaleX: number;
  scaleY: number;
  targets: DirectionalSnapTargetIndex;
  threshold: number;
  vertical: "start" | "end" | null;
}

export function resolveDirectionalResizeSnapping(
  input: ResizeInput,
): DirectionalResizeSnapResolution {
  const original = emptyResizeResolution(input.scaleX, input.scaleY);
  if (!validResizeInput(input)) return original;
  const geometry = resizeGeometry(input);
  if (!geometry) return original;
  const options = pointOptions(geometry.point, input);
  const candidates = input.lockRatio
    ? ratioResizeCandidates(input, geometry, options)
    : freeResizeCandidates(input, geometry, options);
  const selected = candidates.sort(compareSnapCandidates)[0];
  return selected ? resizeResolution(input, geometry, selected) : original;
}

function validResizeInput(input: ResizeInput): boolean {
  return (
    validFrame(input.frame) &&
    validThreshold(input.threshold) &&
    validScale(input.scaleX) &&
    validScale(input.scaleY) &&
    Boolean(input.horizontal || input.vertical)
  );
}

function resizeGeometry(input: ResizeInput): ResizeGeometry | null {
  const handle = resizeHandle(
    input.frame.bounds,
    input.horizontal,
    input.vertical,
  );
  const origin = resizeOrigin(
    input.frame.bounds,
    input.horizontal,
    input.vertical,
    input.aroundCenter,
  );
  const derivativeX = transformVector(
    { x: handle.x - origin.x, y: 0 },
    input.frame.transform,
  );
  const derivativeY = transformVector(
    { x: 0, y: handle.y - origin.y },
    input.frame.transform,
  );
  const point = transformPoint(
    {
      x: origin.x + (handle.x - origin.x) * input.scaleX,
      y: origin.y + (handle.y - origin.y) * input.scaleY,
    },
    input.frame.transform,
  );
  return [derivativeX, derivativeY, point].every(finitePoint)
    ? { derivativeX, derivativeY, point }
    : null;
}

function ratioResizeCandidates(
  input: ResizeInput,
  geometry: ResizeGeometry,
  groups: readonly (readonly DirectionalSnapOption[])[],
): ResizeCandidate[] {
  const derivative = add(geometry.derivativeX, geometry.derivativeY);
  return groups.flat().flatMap((option) => {
    if (!option.primary) return [];
    const coefficient = project(derivative, option.target.normal);
    if (Math.abs(coefficient) <= DIRECTIONAL_EPSILON) return [];
    const correction = option.distance / coefficient;
    return validResizeCandidate(
      input,
      correction,
      correction,
      magnitude(scale(derivative, correction)),
      [option],
    );
  });
}

function freeResizeCandidates(
  input: ResizeInput,
  geometry: ResizeGeometry,
  groups: readonly (readonly DirectionalSnapOption[])[],
): ResizeCandidate[] {
  const activeX = input.horizontal ? geometry.derivativeX : { x: 0, y: 0 };
  const activeY = input.vertical ? geometry.derivativeY : { x: 0, y: 0 };
  const singles = groups
    .flat()
    .flatMap((option) =>
      singleResizeCandidate(input, activeX, activeY, option),
    );
  if (!input.horizontal || !input.vertical) return singles;
  return [...singles, ...pairedResizeCandidates(input, geometry, groups)];
}

function singleResizeCandidate(
  input: ResizeInput,
  activeX: DirectionalPoint,
  activeY: DirectionalPoint,
  option: DirectionalSnapOption,
): ResizeCandidate[] {
  if (!option.primary) return [];
  const coefficientX = project(activeX, option.target.normal);
  const coefficientY = project(activeY, option.target.normal);
  const denominator = coefficientX ** 2 + coefficientY ** 2;
  if (denominator <= DIRECTIONAL_EPSILON) return [];
  const correctionX = (option.distance * coefficientX) / denominator;
  const correctionY = (option.distance * coefficientY) / denominator;
  return validResizeCandidate(
    input,
    correctionX,
    correctionY,
    magnitude(add(scale(activeX, correctionX), scale(activeY, correctionY))),
    [option],
  );
}

function pairedResizeCandidates(
  input: ResizeInput,
  geometry: ResizeGeometry,
  groups: readonly (readonly DirectionalSnapOption[])[],
): ResizeCandidate[] {
  const pairs: ResizeCandidate[] = [];
  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < groups.length;
      rightIndex += 1
    ) {
      for (const left of groups[leftIndex] ?? []) {
        for (const right of groups[rightIndex] ?? []) {
          if (!left.primary && !right.primary) continue;
          pairs.push(...pairedResizeCandidate(input, geometry, left, right));
        }
      }
    }
  }
  return pairs;
}

function pairedResizeCandidate(
  input: ResizeInput,
  geometry: ResizeGeometry,
  left: DirectionalSnapOption,
  right: DirectionalSnapOption,
): ResizeCandidate[] {
  const coefficients = resizeCoefficients(geometry, left, right);
  const determinant =
    coefficients.leftX * coefficients.rightY -
    coefficients.leftY * coefficients.rightX;
  if (Math.abs(determinant) <= DIRECTIONAL_EPSILON) return [];
  const correctionX =
    (left.distance * coefficients.rightY -
      coefficients.leftY * right.distance) /
    determinant;
  const correctionY =
    (coefficients.leftX * right.distance -
      left.distance * coefficients.rightX) /
    determinant;
  const movement = magnitude(
    add(
      scale(geometry.derivativeX, correctionX),
      scale(geometry.derivativeY, correctionY),
    ),
  );
  return validResizeCandidate(input, correctionX, correctionY, movement, [
    left,
    right,
  ]);
}

function resizeCoefficients(
  geometry: ResizeGeometry,
  left: DirectionalSnapOption,
  right: DirectionalSnapOption,
) {
  return {
    leftX: project(geometry.derivativeX, left.target.normal),
    leftY: project(geometry.derivativeY, left.target.normal),
    rightX: project(geometry.derivativeX, right.target.normal),
    rightY: project(geometry.derivativeY, right.target.normal),
  };
}

function validResizeCandidate(
  input: ResizeInput,
  correctionX: number,
  correctionY: number,
  movement: number,
  matches: readonly DirectionalSnapOption[],
): ResizeCandidate[] {
  const scaleX = input.scaleX + correctionX;
  const scaleY = input.scaleY + correctionY;
  return [scaleX, scaleY, movement].every(Number.isFinite) &&
    scaleX > 0 &&
    scaleY > 0 &&
    movement <= input.threshold + DIRECTIONAL_EPSILON
    ? [{ correctionX, correctionY, matches, movement }]
    : [];
}

function resizeResolution(
  input: ResizeInput,
  geometry: ResizeGeometry,
  candidate: ResizeCandidate,
): DirectionalResizeSnapResolution {
  const point = add(
    geometry.point,
    add(
      scale(geometry.derivativeX, candidate.correctionX),
      scale(geometry.derivativeY, candidate.correctionY),
    ),
  );
  return {
    lines: candidate.matches.map((match) => snapLine(match, point)),
    matches: candidate.matches.map(matchSummary),
    scaleX: input.scaleX + candidate.correctionX,
    scaleY: input.scaleY + candidate.correctionY,
  };
}

function resizeHandle(
  bounds: Rect,
  horizontal: "start" | "end" | null,
  vertical: "start" | "end" | null,
): DirectionalPoint {
  return {
    x: axisPosition(bounds.x, bounds.width, horizontal),
    y: axisPosition(bounds.y, bounds.height, vertical),
  };
}

function resizeOrigin(
  bounds: Rect,
  horizontal: "start" | "end" | null,
  vertical: "start" | "end" | null,
  aroundCenter: boolean,
): DirectionalPoint {
  return {
    x: originPosition(bounds.x, bounds.width, horizontal, aroundCenter),
    y: originPosition(bounds.y, bounds.height, vertical, aroundCenter),
  };
}

function axisPosition(
  start: number,
  size: number,
  edge: "start" | "end" | null,
): number {
  return edge === "start"
    ? start
    : edge === "end"
      ? start + size
      : start + size / 2;
}

function originPosition(
  start: number,
  size: number,
  edge: "start" | "end" | null,
  aroundCenter: boolean,
): number {
  if (aroundCenter || !edge) return start + size / 2;
  return edge === "start" ? start + size : start;
}

function emptyResizeResolution(
  scaleX: number,
  scaleY: number,
): DirectionalResizeSnapResolution {
  return { lines: [], matches: [], scaleX, scaleY };
}
