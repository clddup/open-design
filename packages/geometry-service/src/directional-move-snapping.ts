import {
  DIRECTIONAL_EPSILON,
  add,
  compareSnapCandidates,
  cross,
  finitePoint,
  magnitude,
  matchSummary,
  moveOptions,
  scale,
  snapLine,
  validFrame,
  validThreshold,
  type DirectionalMoveSnapResolution,
  type DirectionalPoint,
  type DirectionalSnapFrame,
  type DirectionalSnapOption,
  type DirectionalSnapTargetIndex,
} from "./directional-snapping-core.js";

interface MoveCandidate {
  delta: DirectionalPoint;
  matches: readonly DirectionalSnapOption[];
  movement: number;
}

export function resolveDirectionalMoveSnapping(input: {
  frame: DirectionalSnapFrame;
  primaryTargetIds: ReadonlySet<string>;
  targets: DirectionalSnapTargetIndex;
  threshold: number;
}): DirectionalMoveSnapResolution {
  const original = emptyMoveResolution();
  if (!validFrame(input.frame) || !validThreshold(input.threshold)) {
    return original;
  }
  const candidates = moveCandidates(moveOptions(input), input.threshold);
  const selected = candidates.sort(compareSnapCandidates)[0];
  return selected ? moveResolution(selected) : original;
}

function moveCandidates(
  groups: readonly (readonly DirectionalSnapOption[])[],
  threshold: number,
): MoveCandidate[] {
  const singles = groups
    .flat()
    .flatMap((option) =>
      option.primary
        ? validMoveCandidate(
            scale(option.target.normal, option.distance),
            [option],
            threshold,
          )
        : [],
    );
  const pairs: MoveCandidate[] = [];
  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < groups.length;
      rightIndex += 1
    ) {
      for (const left of groups[leftIndex] ?? []) {
        for (const right of groups[rightIndex] ?? []) {
          if (!left.primary && !right.primary) continue;
          pairs.push(...pairedMoveCandidate(left, right, threshold));
        }
      }
    }
  }
  return [...singles, ...pairs];
}

function pairedMoveCandidate(
  left: DirectionalSnapOption,
  right: DirectionalSnapOption,
  threshold: number,
): MoveCandidate[] {
  const determinant = cross(left.target.normal, right.target.normal);
  if (Math.abs(determinant) <= DIRECTIONAL_EPSILON) return [];
  const delta = {
    x:
      (left.distance * right.target.normal.y -
        left.target.normal.y * right.distance) /
      determinant,
    y:
      (left.target.normal.x * right.distance -
        left.distance * right.target.normal.x) /
      determinant,
  };
  return validMoveCandidate(delta, [left, right], threshold);
}

function validMoveCandidate(
  delta: DirectionalPoint,
  matches: readonly DirectionalSnapOption[],
  threshold: number,
): MoveCandidate[] {
  const movement = magnitude(delta);
  return finitePoint(delta) && movement <= threshold + DIRECTIONAL_EPSILON
    ? [{ delta, matches, movement }]
    : [];
}

function moveResolution(
  candidate: MoveCandidate,
): DirectionalMoveSnapResolution {
  return {
    delta: candidate.delta,
    lines: candidate.matches.map((match) =>
      snapLine(match, add(match.anchor, candidate.delta)),
    ),
    matches: candidate.matches.map(matchSummary),
  };
}

function emptyMoveResolution(): DirectionalMoveSnapResolution {
  return { delta: { x: 0, y: 0 }, lines: [], matches: [] };
}
