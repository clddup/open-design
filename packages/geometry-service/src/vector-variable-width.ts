import type {
  Point,
  VariableWidthPoint,
  VariableWidthStrokeProperties,
  VectorNetwork,
  VectorPathRun,
} from "@opendesign/design-contracts";
import { vectorNetworkHasBranches } from "@opendesign/design-contracts";
import { validateVectorNetwork } from "./editable-vector.js";
import {
  vectorCurveDerivative,
  vectorCurveLength,
  vectorCurveParameterAtLength,
  vectorCurvePoint,
  type StrokeTraversalSegment,
} from "./vector-curve-metrics.js";
import { projectVectorNetworkCornerRadii } from "./vector-corner-radius.js";
import { vectorPathTraversalSegments } from "./vector-stroke-appearance.js";
import {
  serializeVariableWidthOutline,
  type VariableWidthStrokeSample,
} from "./vector-variable-width-outline.js";

const EPSILON = 1e-7;
const FLATNESS_TOLERANCE = 0.1;
const MAX_TANGENT_TURN = Math.PI / 36;
const MAX_SUBDIVISION_DEPTH = 12;
const MAX_SAMPLES = 16_384;

export interface VariableWidthStrokeProjectionOptions {
  align: "center" | "inside" | "outside";
  cap: "butt" | "round" | "square";
  cornerRadius?: number;
  cornerSmoothing?: number;
  dashPattern?: readonly number[];
  join: "miter" | "round" | "bevel";
  strokeWidth: number;
}

export type VariableWidthStrokeProjectionResult =
  { ok: true; paths: readonly string[] } | { ok: false; message: string };

export interface VariableWidthPathLocation {
  pathId: string;
  point: Point;
  position: number;
  tangent: Point;
}

export function variableWidthProfileIsUniform(
  profile: VariableWidthStrokeProperties | undefined,
): boolean {
  return profile === undefined || profile.widthProfile === "UNIFORM";
}

/** Creates a disposable filled outline while the source profile stays editable. */
export function projectVariableWidthStrokePaths(
  network: VectorNetwork,
  profile: VariableWidthStrokeProperties,
  options: VariableWidthStrokeProjectionOptions,
): VariableWidthStrokeProjectionResult {
  const issue = projectionInputIssue(network, profile, options);
  if (issue) return { ok: false, message: issue };
  const rounded = projectVectorNetworkCornerRadii(
    network,
    options.cornerRadius ?? 0,
    options.cornerSmoothing ?? 0,
  );
  if (!rounded.ok) return rounded;
  const widthPoints = variableWidthProfilePoints(profile);
  const paths: string[] = [];
  let sampleCount = 0;
  for (const path of rounded.network.paths) {
    const projected = projectPath(
      rounded.network,
      path,
      widthPoints,
      options,
      MAX_SAMPLES - sampleCount,
    );
    if (!projected.ok) return projected;
    paths.push(projected.path);
    sampleCount += projected.sampleCount;
  }
  return paths.length > 0
    ? { ok: true, paths }
    : { ok: false, message: "Variable width stroke source is empty" };
}

function projectionInputIssue(
  network: VectorNetwork,
  profile: VariableWidthStrokeProperties,
  options: VariableWidthStrokeProjectionOptions,
): string | null {
  const topologyIssue = validateVectorNetwork(network)[0];
  if (topologyIssue) return topologyIssue.message;
  if (vectorNetworkHasBranches(network)) {
    return "Variable width strokes do not support branching Vector Networks";
  }
  if ((options.dashPattern?.length ?? 0) > 0) {
    return "Variable width strokes do not support dash patterns";
  }
  if (!Number.isFinite(options.strokeWidth) || options.strokeWidth <= 0) {
    return "Variable width stroke weight must be positive";
  }
  if (profile.widthProfile !== "CUSTOM") return null;
  for (let index = 1; index < profile.variableWidthPoints.length; index += 1) {
    if (
      profile.variableWidthPoints[index]!.position <=
      profile.variableWidthPoints[index - 1]!.position
    ) {
      return "Variable width point positions must be strictly increasing";
    }
  }
  return null;
}

export function variableWidthProfilePoints(
  profile: VariableWidthStrokeProperties,
): readonly VariableWidthPoint[] {
  if (profile.widthProfile === "CUSTOM") return profile.variableWidthPoints;
  switch (profile.widthProfile) {
    case "UNIFORM":
      return [point(0, 1), point(1, 1)];
    case "WEDGE":
      return [point(0, 1), point(1, 0)];
    case "TAPER":
      return [point(0, 1), point(1, 0.25)];
    case "QUARTER_TAPER":
      return [point(0, 0.25), point(0.25, 1), point(1, 0.25)];
    case "EYE":
      return [point(0, 0), point(0.5, 1), point(1, 0)];
    case "MIRRORED_TAPER":
      return [point(0, 0.25), point(0.5, 1), point(1, 0.25)];
  }
  return [point(0, 1), point(1, 1)];
}

export function variableWidthPathLocation(
  network: VectorNetwork,
  pathId: string,
  position: number,
): VariableWidthPathLocation | null {
  const path = network.paths.find((candidate) => candidate.id === pathId);
  if (!path || !Number.isFinite(position)) return null;
  const traversal = vectorPathTraversalSegments(network, path);
  if (!traversal.ok || traversal.segments.length === 0) return null;
  const lengths = traversal.segments.map((segment) =>
    vectorCurveLength(segment),
  );
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  if (totalLength <= EPSILON) return null;
  const normalizedPosition = Math.min(1, Math.max(0, position));
  const targetLength = normalizedPosition * totalLength;
  let traversed = 0;
  for (const [index, segment] of traversal.segments.entries()) {
    const length = lengths[index]!;
    const isLast = index === traversal.segments.length - 1;
    if (targetLength <= traversed + length || isLast) {
      const parameter = vectorCurveParameterAtLength(
        segment,
        0,
        Math.min(length, Math.max(0, targetLength - traversed)),
      );
      return {
        pathId,
        point: vectorCurvePoint(segment, parameter),
        position: normalizedPosition,
        tangent: normalizedTangent(segment, parameter),
      };
    }
    traversed += length;
  }
  return null;
}

export function variableWidthHitPosition(
  network: VectorNetwork,
  pathId: string,
  segmentId: string,
  parameter: number,
): VariableWidthPathLocation | null {
  const path = network.paths.find((candidate) => candidate.id === pathId);
  if (!path || !Number.isFinite(parameter)) return null;
  const traversal = vectorPathTraversalSegments(network, path);
  if (!traversal.ok) return null;
  const lengths = traversal.segments.map((segment) =>
    vectorCurveLength(segment),
  );
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  if (totalLength <= EPSILON) return null;
  const referenceIndex = path.segments.findIndex(
    (reference) => reference.segmentId === segmentId,
  );
  const segment = traversal.segments[referenceIndex];
  if (!segment) return null;
  const normalizedParameter = Math.min(1, Math.max(0, parameter));
  const traversed = lengths
    .slice(0, referenceIndex)
    .reduce((sum, length) => sum + length, 0);
  return {
    pathId,
    point: vectorCurvePoint(segment, normalizedParameter),
    position:
      (traversed + vectorCurveLength(segment, 0, normalizedParameter)) /
      totalLength,
    tangent: normalizedTangent(segment, normalizedParameter),
  };
}

function point(position: number, width: number): VariableWidthPoint {
  return { position, width };
}

type PathProjection =
  | { ok: true; path: string; sampleCount: number }
  | { ok: false; message: string };

function projectPath(
  network: VectorNetwork,
  path: VectorPathRun,
  widthPoints: readonly VariableWidthPoint[],
  options: VariableWidthStrokeProjectionOptions,
  sampleBudget: number,
): PathProjection {
  const traversal = vectorPathTraversalSegments(network, path);
  if (!traversal.ok) return traversal;
  const lengths = traversal.segments.map((segment) =>
    vectorCurveLength(segment),
  );
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  if (totalLength <= EPSILON) {
    return {
      ok: false,
      message: `Vector path ${path.id} has no measurable length`,
    };
  }
  const orientation = path.closed
    ? centerlineSignedArea(traversal.segments)
    : 0;
  const samples: VariableWidthStrokeSample[] = [];
  const joins: Array<{
    previous: VariableWidthStrokeSample;
    next: VariableWidthStrokeSample;
  }> = [];
  let traversed = 0;
  for (const [index, segment] of traversal.segments.entries()) {
    const parameters = segmentParameters(
      segment,
      traversed,
      lengths[index]!,
      totalLength,
      widthPoints,
    );
    const segmentSamples = parameters.map((parameter) =>
      strokeSample(
        segment,
        parameter,
        (traversed + vectorCurveLength(segment, 0, parameter)) / totalLength,
        widthPoints,
        options,
        path.closed,
        orientation,
      ),
    );
    if (samples.length + segmentSamples.length > sampleBudget) {
      return {
        ok: false,
        message: "Variable width stroke exceeds its geometry budget",
      };
    }
    const previous = samples.at(-1);
    const next = segmentSamples[0];
    if (previous && next) joins.push({ previous, next });
    samples.push(...segmentSamples);
    traversed += lengths[index]!;
  }
  if (path.closed && samples.length > 1) {
    joins.push({ previous: samples.at(-1)!, next: samples[0]! });
  }
  return {
    ok: true,
    path: serializeVariableWidthOutline(samples, joins, path.closed, options),
    sampleCount: samples.length,
  };
}

function segmentParameters(
  segment: StrokeTraversalSegment,
  traversed: number,
  segmentLength: number,
  totalLength: number,
  widthPoints: readonly VariableWidthPoint[],
): number[] {
  const parameters = new Set<number>([0, 1]);
  appendAdaptiveParameters(segment, 0, 1, 0, parameters);
  const start = traversed / totalLength;
  const end = (traversed + segmentLength) / totalLength;
  for (const widthPoint of widthPoints) {
    if (
      widthPoint.position <= start + EPSILON ||
      widthPoint.position >= end - EPSILON
    ) {
      continue;
    }
    parameters.add(
      vectorCurveParameterAtLength(
        segment,
        0,
        widthPoint.position * totalLength - traversed,
      ),
    );
  }
  return [...parameters].sort((left, right) => left - right);
}

function appendAdaptiveParameters(
  segment: StrokeTraversalSegment,
  start: number,
  end: number,
  depth: number,
  output: Set<number>,
): void {
  if (
    depth >= MAX_SUBDIVISION_DEPTH ||
    curveIntervalIsFlat(segment, start, end)
  ) {
    return;
  }
  const middle = (start + end) / 2;
  output.add(middle);
  appendAdaptiveParameters(segment, start, middle, depth + 1, output);
  appendAdaptiveParameters(segment, middle, end, depth + 1, output);
}

function curveIntervalIsFlat(
  segment: StrokeTraversalSegment,
  start: number,
  end: number,
): boolean {
  const a = vectorCurvePoint(segment, start);
  const b = vectorCurvePoint(segment, end);
  const span = end - start;
  const candidates = [
    vectorCurvePoint(segment, start + span / 4),
    vectorCurvePoint(segment, start + span / 2),
    vectorCurvePoint(segment, start + (span * 3) / 4),
  ];
  const flatness = Math.max(
    ...candidates.map((candidate) => pointLineDistance(candidate, a, b)),
  );
  const tangentTurn = angleBetween(
    vectorCurveDerivative(segment, start),
    vectorCurveDerivative(segment, end),
  );
  return flatness <= FLATNESS_TOLERANCE && tangentTurn <= MAX_TANGENT_TURN;
}

function strokeSample(
  segment: StrokeTraversalSegment,
  parameter: number,
  position: number,
  widthPoints: readonly VariableWidthPoint[],
  options: VariableWidthStrokeProjectionOptions,
  closed: boolean,
  orientation: number,
): VariableWidthStrokeSample {
  const center = vectorCurvePoint(segment, parameter);
  const tangent = normalizedTangent(segment, parameter);
  const normal = { x: -tangent.y, y: tangent.x };
  const width = options.strokeWidth * widthAt(widthPoints, position);
  const [leftOffset, rightOffset] = strokeOffsets(
    width,
    closed ? options.align : "center",
    orientation,
  );
  return {
    center,
    tangent,
    leftOffset,
    rightOffset,
    left: add(center, scale(normal, leftOffset)),
    right: add(center, scale(normal, rightOffset)),
  };
}

function strokeOffsets(
  width: number,
  align: VariableWidthStrokeProjectionOptions["align"],
  orientation: number,
): [number, number] {
  if (align === "center") return [width / 2, -width / 2];
  const interiorOnRight = orientation < 0;
  if (align === "inside") {
    return interiorOnRight ? [0, -width] : [width, 0];
  }
  return interiorOnRight ? [width, 0] : [0, -width];
}

function widthAt(
  points: readonly VariableWidthPoint[],
  position: number,
): number {
  const first = points[0]!;
  if (position <= first.position) return first.width;
  const last = points.at(-1)!;
  if (position >= last.position) return last.width;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index]!;
    if (position > right.position) continue;
    const left = points[index - 1]!;
    const progress =
      (position - left.position) / (right.position - left.position);
    return left.width + (right.width - left.width) * progress;
  }
  return last.width;
}

function centerlineSignedArea(
  segments: readonly StrokeTraversalSegment[],
): number {
  const points = segments.flatMap((segment) => [
    vectorCurvePoint(segment, 0),
    vectorCurvePoint(segment, 0.5),
  ]);
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function normalizedTangent(
  segment: StrokeTraversalSegment,
  parameter: number,
): Point {
  let tangent = vectorCurveDerivative(segment, parameter);
  if (magnitude(tangent) <= EPSILON) {
    const before = vectorCurvePoint(segment, Math.max(0, parameter - 1e-4));
    const after = vectorCurvePoint(segment, Math.min(1, parameter + 1e-4));
    tangent = subtract(after, before);
  }
  const length = magnitude(tangent);
  return length <= EPSILON ? { x: 1, y: 0 } : scale(tangent, 1 / length);
}

function pointLineDistance(point: Point, start: Point, end: Point): number {
  const span = subtract(end, start);
  const length = magnitude(span);
  return length <= EPSILON
    ? distance(point, start)
    : Math.abs(cross(subtract(point, start), span)) / length;
}

function angleBetween(left: Point, right: Point): number {
  const denominator = magnitude(left) * magnitude(right);
  if (denominator <= EPSILON) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot(left, right) / denominator)));
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

function dot(left: Point, right: Point): number {
  return left.x * right.x + left.y * right.y;
}

function magnitude(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function distance(left: Point, right: Point): number {
  return magnitude(subtract(left, right));
}
