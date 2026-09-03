import type { Point } from "@opendesign/design-contracts";
import type { VariableWidthStrokeProjectionOptions } from "./vector-variable-width.js";

const EPSILON = 1e-7;
const ROUND_STEPS_PER_HALF_TURN = 16;

export type VariableWidthStrokeSample = {
  center: Point;
  left: Point;
  leftOffset: number;
  right: Point;
  rightOffset: number;
  tangent: Point;
};

export function serializeVariableWidthOutline(
  samples: readonly VariableWidthStrokeSample[],
  joins: readonly {
    previous: VariableWidthStrokeSample;
    next: VariableWidthStrokeSample;
  }[],
  closed: boolean,
  options: VariableWidthStrokeProjectionOptions,
): string {
  if (samples.length < 2) return "";
  const left = samples.map((sample) => sample.left);
  const right = samples.map((sample) => sample.right);
  if (!closed && options.cap === "square") {
    applySquareCaps(left, right, samples);
  }
  const commands = closed
    ? [polygonPath(left), polygonPath([...right].reverse())]
    : [openOutlinePath(left, right, samples, options.cap)];
  for (const join of joins) {
    const patch = joinPatch(join.previous, join.next, options.join);
    if (patch) commands.push(patch);
  }
  return commands.filter(Boolean).join(" ");
}

function openOutlinePath(
  left: readonly Point[],
  right: readonly Point[],
  samples: readonly VariableWidthStrokeSample[],
  cap: VariableWidthStrokeProjectionOptions["cap"],
): string {
  const commands = [move(left[0]!), ...left.slice(1).map(line)];
  if (cap === "round") {
    commands.push(
      ...arcLines(samples.at(-1)!.center, left.at(-1)!, right.at(-1)!, -1),
    );
  } else {
    commands.push(line(right.at(-1)!));
  }
  commands.push(...[...right].reverse().slice(1).map(line));
  if (cap === "round") {
    commands.push(...arcLines(samples[0]!.center, right[0]!, left[0]!, -1));
  }
  commands.push("Z");
  return commands.join(" ");
}

function joinPatch(
  previous: VariableWidthStrokeSample,
  next: VariableWidthStrokeSample,
  join: VariableWidthStrokeProjectionOptions["join"],
): string | null {
  if (join === "bevel") return null;
  const turn = cross(previous.tangent, next.tangent);
  if (Math.abs(turn) <= EPSILON) return null;
  const outerPrevious = turn > 0 ? previous.right : previous.left;
  const outerNext = turn > 0 ? next.right : next.left;
  if (join === "round") {
    const arc = arcLines(
      previous.center,
      outerPrevious,
      outerNext,
      Math.sign(turn),
    );
    return [move(previous.center), line(outerPrevious), ...arc, "Z"].join(" ");
  }
  const intersection = lineIntersection(
    outerPrevious,
    previous.tangent,
    outerNext,
    next.tangent,
  );
  const limit = maximumOffset(previous, next) * 4;
  return intersection && distance(intersection, previous.center) <= limit
    ? polygonPath([outerPrevious, intersection, outerNext])
    : null;
}

function maximumOffset(
  previous: VariableWidthStrokeSample,
  next: VariableWidthStrokeSample,
): number {
  return Math.max(
    Math.abs(previous.leftOffset),
    Math.abs(previous.rightOffset),
    Math.abs(next.leftOffset),
    Math.abs(next.rightOffset),
  );
}

function applySquareCaps(
  left: Point[],
  right: Point[],
  samples: readonly VariableWidthStrokeSample[],
): void {
  const first = samples[0]!;
  const last = samples.at(-1)!;
  const firstExtension = Math.max(
    Math.abs(first.leftOffset),
    Math.abs(first.rightOffset),
  );
  const lastExtension = Math.max(
    Math.abs(last.leftOffset),
    Math.abs(last.rightOffset),
  );
  left[0] = add(left[0]!, scale(first.tangent, -firstExtension));
  right[0] = add(right[0]!, scale(first.tangent, -firstExtension));
  left[left.length - 1] = add(left.at(-1)!, scale(last.tangent, lastExtension));
  right[right.length - 1] = add(
    right.at(-1)!,
    scale(last.tangent, lastExtension),
  );
}

function arcLines(
  center: Point,
  start: Point,
  end: Point,
  direction: number,
): string[] {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let sweep = Math.atan2(end.y - center.y, end.x - center.x) - startAngle;
  if (direction > 0 && sweep < 0) sweep += Math.PI * 2;
  if (direction < 0 && sweep > 0) sweep -= Math.PI * 2;
  const radius = distance(center, start);
  const steps = Math.max(
    1,
    Math.ceil((Math.abs(sweep) / Math.PI) * ROUND_STEPS_PER_HALF_TURN),
  );
  return Array.from({ length: steps }, (_, index) => {
    const angle = startAngle + (sweep * (index + 1)) / steps;
    return line({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  });
}

function lineIntersection(
  originA: Point,
  vectorA: Point,
  originB: Point,
  vectorB: Point,
): Point | null {
  const denominator = cross(vectorA, vectorB);
  if (Math.abs(denominator) <= EPSILON) return null;
  return add(
    originA,
    scale(vectorA, cross(subtract(originB, originA), vectorB) / denominator),
  );
}

function polygonPath(points: readonly Point[]): string {
  return points.length < 3
    ? ""
    : [move(points[0]!), ...points.slice(1).map(line), "Z"].join(" ");
}

function move(point: Point): string {
  return `M ${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

function line(point: Point): string {
  return `L ${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function add(left: Point, right: Point): Point {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scale(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor };
}

function cross(left: Point, right: Point): number {
  return left.x * right.y - left.y * right.x;
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
