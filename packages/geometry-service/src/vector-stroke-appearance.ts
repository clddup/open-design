import type {
  Point,
  VectorNetwork,
  VectorPathRun,
  VectorSegment,
  VectorVertex,
  VectorVertexStrokeCap,
  VectorVertexStrokeJoin,
} from "@opendesign/design-contracts";
import type { VectorStrokeCap, VectorStrokeJoin } from "./vector-path.js";
import { projectVectorNetworkCornerRadii } from "./vector-corner-radius.js";
import {
  projectDashedStrokeFragments,
  type DashedStrokeFragment,
  type StrokeTraversalSegment,
} from "./vector-dash-projection.js";

export interface VectorStrokeAppearanceFallback {
  strokeCap?: VectorVertexStrokeCap;
  strokeJoin?: VectorVertexStrokeJoin;
}

export interface EffectiveVectorVertexStrokeAppearance {
  cap: VectorStrokeCap;
  join: VectorStrokeJoin;
}

export interface ProjectedVectorStrokePath extends EffectiveVectorVertexStrokeAppearance {
  path: string;
  role: "segment" | "join" | "cap";
}

export type VectorStrokePathProjectionResult =
  | { ok: true; paths: ProjectedVectorStrokePath[] }
  | { ok: false; message: string };

export function resolveVectorVertexStrokeAppearance(
  vertex: Pick<VectorVertex, "strokeCap" | "strokeJoin">,
  fallback: VectorStrokeAppearanceFallback,
): EffectiveVectorVertexStrokeAppearance {
  const cap = vertex.strokeCap ?? fallback.strokeCap ?? "none";
  return {
    cap: cap === "none" ? "butt" : cap,
    join: vertex.strokeJoin ?? fallback.strokeJoin ?? "miter",
  };
}

export function vectorNetworkHasVertexStrokeOverrides(
  network: Pick<VectorNetwork, "vertices">,
): boolean {
  return network.vertices.some(
    (vertex) =>
      vertex.strokeCap !== undefined || vertex.strokeJoin !== undefined,
  );
}

export function projectVectorNetworkStrokePaths(
  network: VectorNetwork,
  fallback: VectorStrokeAppearanceFallback,
  strokeWidth: number,
  cornerRadius = 0,
  cornerSmoothing = 0,
  dashPattern: readonly number[] = [],
): VectorStrokePathProjectionResult {
  const rounded = projectVectorNetworkCornerRadii(
    network,
    cornerRadius,
    cornerSmoothing,
  );
  if (!rounded.ok) return rounded;
  const renderedNetwork = rounded.network;
  const paths: ProjectedVectorStrokePath[] = [];
  for (const path of renderedNetwork.paths) {
    const traversal = vectorPathTraversalSegments(renderedNetwork, path);
    if (!traversal.ok) return traversal;
    if (dashPattern.length > 0) {
      const dashed = dashedPathProjections(
        traversal.segments,
        path.closed,
        fallback,
        strokeWidth,
        dashPattern,
      );
      if (!dashed.ok) return dashed;
      paths.push(...dashed.paths);
      continue;
    }
    paths.push(
      ...traversal.segments.map((segment) => ({
        path: segmentPath(segment),
        cap: "butt" as const,
        join: "miter" as const,
        role: "segment" as const,
      })),
    );
    paths.push(...joinProjections(traversal.segments, path.closed, fallback));
    if (!path.closed && traversal.segments.length > 0) {
      paths.push(...capProjections(traversal.segments, fallback, strokeWidth));
    }
  }
  return paths.length > 0
    ? { ok: true, paths }
    : { ok: false, message: "Vector stroke source is empty" };
}

type TraversalSegment = StrokeTraversalSegment;

function dashedPathProjections(
  segments: readonly TraversalSegment[],
  closed: boolean,
  fallback: VectorStrokeAppearanceFallback,
  strokeWidth: number,
  dashPattern: readonly number[],
): VectorStrokePathProjectionResult {
  const projected = projectDashedStrokeFragments(segments, dashPattern);
  if (!projected.ok) return projected;
  const fragments = projected.fragments;
  const paths = fragments.map(segmentProjection);
  paths.push(...dashedJoinProjections(fragments, closed, fallback));
  paths.push(...dashedCapProjections(fragments, closed, fallback, strokeWidth));
  return { ok: true, paths };
}

function segmentProjection(
  segment: DashedStrokeFragment,
): ProjectedVectorStrokePath {
  return {
    path: segmentPath(segment),
    cap: "butt",
    join: "miter",
    role: "segment",
  };
}

function dashedJoinProjections(
  fragments: readonly DashedStrokeFragment[],
  closed: boolean,
  fallback: VectorStrokeAppearanceFallback,
): ProjectedVectorStrokePath[] {
  const joins: ProjectedVectorStrokePath[] = [];
  for (let index = 0; index < fragments.length - 1; index += 1) {
    const previous = fragments[index]!;
    const next = fragments[index + 1]!;
    if (
      previous.endBoundary !== "segment" ||
      next.startBoundary !== "segment"
    ) {
      continue;
    }
    joins.push(joinProjection(previous, next, fallback));
  }
  const first = fragments[0];
  const last = fragments.at(-1);
  if (closed && first && last && dashedSeamIsContinuous(first, last)) {
    joins.push(joinProjection(last, first, fallback));
  }
  return joins;
}

function joinProjection(
  previous: TraversalSegment,
  next: TraversalSegment,
  fallback: VectorStrokeAppearanceFallback,
): ProjectedVectorStrokePath {
  return {
    path: joinedSegmentPath(previous, next),
    cap: "butt",
    join: resolveVectorVertexStrokeAppearance(previous.end, fallback).join,
    role: "join",
  };
}

function dashedCapProjections(
  fragments: readonly DashedStrokeFragment[],
  closed: boolean,
  fallback: VectorStrokeAppearanceFallback,
  strokeWidth: number,
): ProjectedVectorStrokePath[] {
  const caps: ProjectedVectorStrokePath[] = [];
  const first = fragments[0];
  const last = fragments.at(-1);
  const seamContinuous =
    closed && first !== undefined && last !== undefined
      ? dashedSeamIsContinuous(first, last)
      : false;
  for (const fragment of fragments) {
    const start = dashedBoundaryCap(
      fragment,
      "start",
      closed,
      seamContinuous,
      fallback,
      strokeWidth,
    );
    const end = dashedBoundaryCap(
      fragment,
      "end",
      closed,
      seamContinuous,
      fallback,
      strokeWidth,
    );
    if (start) caps.push(start);
    if (end) caps.push(end);
  }
  return caps;
}

function dashedBoundaryCap(
  fragment: DashedStrokeFragment,
  edge: "start" | "end",
  closed: boolean,
  seamContinuous: boolean,
  fallback: VectorStrokeAppearanceFallback,
  strokeWidth: number,
): ProjectedVectorStrokePath | null {
  const boundary =
    edge === "start" ? fragment.startBoundary : fragment.endBoundary;
  if (boundary === "segment" || (boundary === "path" && seamContinuous)) {
    return null;
  }
  const point = edge === "start" ? fragment.start : fragment.end;
  const inward = edge === "start" ? inwardStart(fragment) : inwardEnd(fragment);
  return boundary === "dash" || closed
    ? globalCapProjection(point, inward, fallback, strokeWidth)
    : capProjection(point, inward, fallback, strokeWidth);
}

function dashedSeamIsContinuous(
  first: DashedStrokeFragment,
  last: DashedStrokeFragment,
): boolean {
  return first.startBoundary === "path" && last.endBoundary === "path";
}

function globalCapProjection(
  point: Point,
  inward: Point,
  fallback: VectorStrokeAppearanceFallback,
  strokeWidth: number,
): ProjectedVectorStrokePath {
  return capProjection(
    { id: "__dash_cap", ...point },
    inward,
    fallback,
    strokeWidth,
  );
}

export function vectorPathTraversalSegments(
  network: VectorNetwork,
  path: VectorPathRun,
): { ok: true; segments: TraversalSegment[] } | { ok: false; message: string } {
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  const result: TraversalSegment[] = [];
  for (const reference of path.segments) {
    const segment = segments.get(reference.segmentId);
    if (!segment) {
      return {
        ok: false,
        message: `Vector segment ${reference.segmentId} is missing`,
      };
    }
    const start = vertices.get(
      reference.reversed ? segment.endVertexId : segment.startVertexId,
    );
    const end = vertices.get(
      reference.reversed ? segment.startVertexId : segment.endVertexId,
    );
    if (!start || !end) {
      return { ok: false, message: "Vector segment endpoint is missing" };
    }
    result.push({
      start,
      end,
      ...controlPoints(segment, reference.reversed, start, end),
    });
  }
  return { ok: true, segments: result };
}

function controlPoints(
  segment: VectorSegment,
  reversed: boolean,
  start: Point,
  end: Point,
): Pick<TraversalSegment, "controlStart" | "controlEnd"> {
  const startOffset = reversed ? segment.tangentEnd : segment.tangentStart;
  const endOffset = reversed ? segment.tangentStart : segment.tangentEnd;
  return {
    ...(startOffset ? { controlStart: add(start, startOffset) } : {}),
    ...(endOffset ? { controlEnd: add(end, endOffset) } : {}),
  };
}

function joinProjections(
  segments: readonly TraversalSegment[],
  closed: boolean,
  fallback: VectorStrokeAppearanceFallback,
): ProjectedVectorStrokePath[] {
  const result: ProjectedVectorStrokePath[] = [];
  const count = closed ? segments.length : Math.max(segments.length - 1, 0);
  for (let index = 0; index < count; index += 1) {
    const previous = segments[index]!;
    const next = segments[(index + 1) % segments.length]!;
    result.push({
      path: joinedSegmentPath(previous, next),
      cap: "butt",
      join: resolveVectorVertexStrokeAppearance(previous.end, fallback).join,
      role: "join",
    });
  }
  return result;
}

function capProjections(
  segments: readonly TraversalSegment[],
  fallback: VectorStrokeAppearanceFallback,
  strokeWidth: number,
): ProjectedVectorStrokePath[] {
  const first = segments[0]!;
  const last = segments.at(-1)!;
  return [
    capProjection(first.start, inwardStart(first), fallback, strokeWidth),
    capProjection(last.end, inwardEnd(last), fallback, strokeWidth),
  ];
}

function capProjection(
  vertex: VectorVertex,
  inward: Point,
  fallback: VectorStrokeAppearanceFallback,
  strokeWidth: number,
): ProjectedVectorStrokePath {
  const length = Math.max(strokeWidth, 0.001);
  const inner = add(vertex, scale(normalize(inward), length));
  return {
    path: `M${pointData(vertex)}L${pointData(inner)}`,
    ...resolveVectorVertexStrokeAppearance(vertex, fallback),
    role: "cap",
  };
}

function segmentPath(segment: TraversalSegment): string {
  return `M${pointData(segment.start)}${segmentCommand(segment)}`;
}

function joinedSegmentPath(
  previous: TraversalSegment,
  next: TraversalSegment,
): string {
  return `M${pointData(previous.start)}${segmentCommand(previous)}${segmentCommand(next)}`;
}

function segmentCommand(segment: TraversalSegment): string {
  return segment.controlStart || segment.controlEnd
    ? `C${pointData(segment.controlStart ?? segment.start)} ${pointData(segment.controlEnd ?? segment.end)} ${pointData(segment.end)}`
    : `L${pointData(segment.end)}`;
}

function inwardStart(segment: TraversalSegment): Point {
  return subtract(segment.controlStart ?? segment.end, segment.start);
}

function inwardEnd(segment: TraversalSegment): Point {
  return subtract(segment.controlEnd ?? segment.start, segment.end);
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

function normalize(point: Point): Point {
  const length = Math.hypot(point.x, point.y);
  return length <= 1e-9
    ? { x: 1, y: 0 }
    : { x: point.x / length, y: point.y / length };
}

function pointData(point: Point): string {
  return `${point.x} ${point.y}`;
}
