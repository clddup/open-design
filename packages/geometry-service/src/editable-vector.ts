import type {
  PathDataProperties,
  Point,
  Rect,
  VectorNetwork,
  VectorNetworkProperties,
  VectorPathRun,
  VectorSegment,
  VectorSegmentReference,
  VectorVertex,
} from "@opendesign/design-contracts";

export interface VectorNetworkIssue {
  path: string;
  message: string;
}

export type VectorNetworkResolution =
  | {
      ok: true;
      bounds: Rect;
      network: VectorNetwork;
      path: string;
    }
  | {
      ok: false;
      issues: readonly VectorNetworkIssue[];
    };

export type VectorRegionResolution =
  | { ok: true; path: string; regionId: string }
  | { ok: false; issues: readonly VectorNetworkIssue[] };

export function isVectorNetworkProperties(
  properties: PathDataProperties | VectorNetworkProperties,
): properties is VectorNetworkProperties {
  return "network" in properties;
}

export function resolvePathPropertiesData(
  properties: PathDataProperties | VectorNetworkProperties,
): string | null {
  if (!isVectorNetworkProperties(properties)) return properties.path;
  const result = serializeVectorNetwork(properties.network);
  return result.ok ? result.path : null;
}

/**
 * Vector Network paints apply to explicit closed regions, not to the implicit
 * straight-line closure that SVG/Canvas renderers otherwise invent for an
 * open subpath.
 */
export function vectorNetworkHasFillRegion(network: VectorNetwork): boolean {
  return network.regions.some((region) => region.loops.length > 0);
}

export function serializeVectorNetwork(
  network: VectorNetwork,
): VectorNetworkResolution {
  const loopDirections = regionLoopDirections(network);
  const issues = [
    ...validateVectorNetwork(network),
    ...renderTraversalIssues(network, loopDirections),
  ];
  if (issues.length > 0) return { ok: false, issues };
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  const parts: string[] = [];
  let bounds: MutableBounds | undefined;

  for (const path of network.paths) {
    const references = renderedPathReferences(path, loopDirections);
    const firstReference = references[0]!;
    const firstSegment = segments.get(firstReference.segmentId)!;
    const firstVertex = directedVertices(
      firstSegment,
      firstReference,
      vertices,
    ).start;
    parts.push(
      `M ${formatNumber(firstVertex.x)} ${formatNumber(firstVertex.y)}`,
    );
    includePoint((next) => (bounds = next), bounds, firstVertex);

    for (const reference of references) {
      const segment = segments.get(reference.segmentId)!;
      const directed = directedVertices(segment, reference, vertices);
      const tangentStart = reference.reversed
        ? segment.tangentEnd
        : segment.tangentStart;
      const tangentEnd = reference.reversed
        ? segment.tangentStart
        : segment.tangentEnd;
      if (meaningfulPoint(tangentStart) || meaningfulPoint(tangentEnd)) {
        const controlStart = addPoint(directed.start, tangentStart);
        const controlEnd = addPoint(directed.end, tangentEnd);
        parts.push(
          `C ${formatPoint(controlStart)} ${formatPoint(controlEnd)} ${formatPoint(directed.end)}`,
        );
        bounds = includeCubicBounds(
          bounds,
          directed.start,
          controlStart,
          controlEnd,
          directed.end,
        );
      } else {
        parts.push(`L ${formatPoint(directed.end)}`);
        includePoint((next) => (bounds = next), bounds, directed.end);
      }
    }
    if (path.closed) parts.push("Z");
  }

  const resolvedBounds = boundsToRect(bounds);
  return { ok: true, bounds: resolvedBounds, network, path: parts.join(" ") };
}

/** Serializes one explicit fill region without inventing geometry. */
export function serializeVectorRegion(
  network: VectorNetwork,
  regionId: string,
): VectorRegionResolution {
  const issues = validateVectorNetwork(network);
  if (issues.length > 0) return { ok: false, issues };
  const region = network.regions.find((candidate) => candidate.id === regionId);
  if (!region) {
    return {
      ok: false,
      issues: [
        { path: "/regions", message: `region ${regionId} does not exist` },
      ],
    };
  }
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  const paths = new Map(network.paths.map((path) => [path.id, path]));
  const parts: string[] = [];
  for (const loop of region.loops) {
    const path = paths.get(loop.pathId)!;
    const references = loop.reversed
      ? [...path.segments].reverse().map((reference) => ({
          segmentId: reference.segmentId,
          reversed: !reference.reversed,
        }))
      : path.segments;
    const first = segments.get(references[0]!.segmentId)!;
    const firstVertex = directedVertices(first, references[0]!, vertices).start;
    parts.push(`M ${formatPoint(firstVertex)}`);
    for (const reference of references) {
      const segment = segments.get(reference.segmentId)!;
      const directed = directedVertices(segment, reference, vertices);
      const tangentStart = reference.reversed
        ? segment.tangentEnd
        : segment.tangentStart;
      const tangentEnd = reference.reversed
        ? segment.tangentStart
        : segment.tangentEnd;
      if (meaningfulPoint(tangentStart) || meaningfulPoint(tangentEnd)) {
        parts.push(
          `C ${formatPoint(addPoint(directed.start, tangentStart))} ${formatPoint(addPoint(directed.end, tangentEnd))} ${formatPoint(directed.end)}`,
        );
      } else {
        parts.push(`L ${formatPoint(directed.end)}`);
      }
    }
    parts.push("Z");
  }
  return { ok: true, path: parts.join(" "), regionId };
}

function renderTraversalIssues(
  network: VectorNetwork,
  directions: ReadonlyMap<string, ReadonlySet<boolean>>,
): VectorNetworkIssue[] {
  const issues: VectorNetworkIssue[] = [];
  for (const [pathId, values] of directions) {
    if (values.size > 1) {
      issues.push({
        path: `/paths/${network.paths.findIndex((path) => path.id === pathId)}`,
        message: `path ${pathId} has conflicting region loop directions that cannot share one rendered path`,
      });
    }
  }
  return issues;
}

function renderedPathReferences(
  path: VectorPathRun,
  loopDirections: ReadonlyMap<string, ReadonlySet<boolean>>,
): readonly VectorSegmentReference[] {
  const directions = loopDirections.get(path.id);
  if (!directions?.has(true)) return path.segments;
  return [...path.segments].reverse().map((reference) => ({
    segmentId: reference.segmentId,
    reversed: !reference.reversed,
  }));
}

function regionLoopDirections(
  network: VectorNetwork,
): Map<string, Set<boolean>> {
  const result = new Map<string, Set<boolean>>();
  for (const region of network.regions) {
    for (const loop of region.loops) {
      const directions = result.get(loop.pathId) ?? new Set<boolean>();
      directions.add(loop.reversed);
      result.set(loop.pathId, directions);
    }
  }
  return result;
}

export function normalizeVectorNetwork(
  network: VectorNetwork,
): VectorNetworkResolution & { offset?: Point } {
  const serialized = serializeVectorNetwork(network);
  if (!serialized.ok) return serialized;
  const offset = { x: serialized.bounds.x, y: serialized.bounds.y };
  const normalized: VectorNetwork = {
    ...structuredClone(network),
    vertices: network.vertices.map((vertex) => ({
      ...vertex,
      x: normalizeNumber(vertex.x - offset.x),
      y: normalizeNumber(vertex.y - offset.y),
    })),
  };
  const result = serializeVectorNetwork(normalized);
  return result.ok ? { ...result, offset } : result;
}

export function validateVectorNetwork(
  network: VectorNetwork,
): VectorNetworkIssue[] {
  const issues: VectorNetworkIssue[] = [];
  const vertices = uniqueMap(network.vertices, "vertices", issues);
  const segments = uniqueMap(network.segments, "segments", issues);
  const paths = uniqueMap(network.paths, "paths", issues);
  uniqueMap(network.regions, "regions", issues);
  const incidentVertices = new Set<string>();

  network.vertices.forEach((vertex, index) => {
    validateFinitePoint(vertex, `/vertices/${index}`, issues);
  });

  network.segments.forEach((segment, index) => {
    if (segment.tangentStart) {
      validateFinitePoint(
        segment.tangentStart,
        `/segments/${index}/tangentStart`,
        issues,
      );
    }
    if (segment.tangentEnd) {
      validateFinitePoint(
        segment.tangentEnd,
        `/segments/${index}/tangentEnd`,
        issues,
      );
    }
    if (!vertices.has(segment.startVertexId)) {
      issues.push({
        path: `/segments/${index}/startVertexId`,
        message: `vertex ${segment.startVertexId} does not exist`,
      });
    }
    if (!vertices.has(segment.endVertexId)) {
      issues.push({
        path: `/segments/${index}/endVertexId`,
        message: `vertex ${segment.endVertexId} does not exist`,
      });
    }
    if (segment.startVertexId === segment.endVertexId) {
      issues.push({
        path: `/segments/${index}`,
        message: "a vector segment must connect two distinct vertices",
      });
    }
    incidentVertices.add(segment.startVertexId);
    incidentVertices.add(segment.endVertexId);
  });

  const referencedSegments = new Map<string, string>();
  network.paths.forEach((path, pathIndex) => {
    validatePathRun(
      path,
      pathIndex,
      vertices,
      segments,
      referencedSegments,
      issues,
    );
  });
  network.segments.forEach((segment, index) => {
    if (!referencedSegments.has(segment.id)) {
      issues.push({
        path: `/segments/${index}`,
        message: `segment ${segment.id} is not owned by a path run`,
      });
    }
  });
  network.vertices.forEach((vertex, index) => {
    if (!incidentVertices.has(vertex.id)) {
      issues.push({
        path: `/vertices/${index}`,
        message: `vertex ${vertex.id} is not connected to a segment`,
      });
    }
  });

  network.regions.forEach((region, regionIndex) => {
    const seenPaths = new Set<string>();
    region.loops.forEach((loop, loopIndex) => {
      const path = paths.get(loop.pathId);
      if (!path) {
        issues.push({
          path: `/regions/${regionIndex}/loops/${loopIndex}/pathId`,
          message: `path ${loop.pathId} does not exist`,
        });
      } else if (!path.closed) {
        issues.push({
          path: `/regions/${regionIndex}/loops/${loopIndex}/pathId`,
          message: `region loops require a closed path, received ${loop.pathId}`,
        });
      }
      if (seenPaths.has(loop.pathId)) {
        issues.push({
          path: `/regions/${regionIndex}/loops/${loopIndex}/pathId`,
          message: `path ${loop.pathId} is duplicated in the region`,
        });
      }
      seenPaths.add(loop.pathId);
    });
  });
  return issues;
}

function validateFinitePoint(
  point: Point,
  path: string,
  issues: VectorNetworkIssue[],
): void {
  if (!Number.isFinite(point.x)) {
    issues.push({ path: `${path}/x`, message: "coordinate must be finite" });
  }
  if (!Number.isFinite(point.y)) {
    issues.push({ path: `${path}/y`, message: "coordinate must be finite" });
  }
}

export function vectorNetworkHasBranches(network: VectorNetwork): boolean {
  const degrees = new Map<string, number>();
  for (const segment of network.segments) {
    degrees.set(
      segment.startVertexId,
      (degrees.get(segment.startVertexId) ?? 0) + 1,
    );
    degrees.set(
      segment.endVertexId,
      (degrees.get(segment.endVertexId) ?? 0) + 1,
    );
  }
  return [...degrees.values()].some((degree) => degree > 2);
}

function validatePathRun(
  path: VectorPathRun,
  pathIndex: number,
  vertices: ReadonlyMap<string, VectorVertex>,
  segments: ReadonlyMap<string, VectorSegment>,
  referencedSegments: Map<string, string>,
  issues: VectorNetworkIssue[],
): void {
  let firstVertexId: string | undefined;
  let previousEndVertexId: string | undefined;
  path.segments.forEach((reference, referenceIndex) => {
    const segment = segments.get(reference.segmentId);
    if (!segment) {
      issues.push({
        path: `/paths/${pathIndex}/segments/${referenceIndex}/segmentId`,
        message: `segment ${reference.segmentId} does not exist`,
      });
      return;
    }
    const owner = referencedSegments.get(segment.id);
    if (owner !== undefined) {
      issues.push({
        path: `/paths/${pathIndex}/segments/${referenceIndex}/segmentId`,
        message: `segment ${segment.id} is already owned by ${owner}`,
      });
    } else {
      referencedSegments.set(segment.id, `path ${path.id}`);
    }
    const directed = directedVertexIds(segment, reference);
    firstVertexId ??= directed.start;
    if (
      previousEndVertexId !== undefined &&
      previousEndVertexId !== directed.start
    ) {
      issues.push({
        path: `/paths/${pathIndex}/segments/${referenceIndex}`,
        message: `path ${path.id} is not contiguous at vertex ${directed.start}`,
      });
    }
    previousEndVertexId = directed.end;
  });
  if (
    path.closed &&
    firstVertexId !== undefined &&
    previousEndVertexId !== firstVertexId
  ) {
    issues.push({
      path: `/paths/${pathIndex}/closed`,
      message: `closed path ${path.id} does not return to its first vertex`,
    });
  }
  if (!path.closed && firstVertexId === previousEndVertexId) {
    issues.push({
      path: `/paths/${pathIndex}/closed`,
      message: `open path ${path.id} returns to its first vertex`,
    });
  }
  if (firstVertexId && !vertices.has(firstVertexId)) {
    issues.push({
      path: `/paths/${pathIndex}`,
      message: `path ${path.id} starts at a missing vertex`,
    });
  }
}

function uniqueMap<T extends { id: string }>(
  values: readonly T[],
  name: string,
  issues: VectorNetworkIssue[],
): Map<string, T> {
  const result = new Map<string, T>();
  values.forEach((value, index) => {
    if (result.has(value.id)) {
      issues.push({
        path: `/${name}/${index}/id`,
        message: `${name.slice(0, -1)} id ${value.id} is duplicated`,
      });
    } else {
      result.set(value.id, value);
    }
  });
  return result;
}

function directedVertices(
  segment: VectorSegment,
  reference: VectorSegmentReference,
  vertices: ReadonlyMap<string, VectorVertex>,
): { start: VectorVertex; end: VectorVertex } {
  const ids = directedVertexIds(segment, reference);
  return { start: vertices.get(ids.start)!, end: vertices.get(ids.end)! };
}

function directedVertexIds(
  segment: VectorSegment,
  reference: VectorSegmentReference,
): { start: string; end: string } {
  return reference.reversed
    ? { start: segment.endVertexId, end: segment.startVertexId }
    : { start: segment.startVertexId, end: segment.endVertexId };
}

function addPoint(point: Point, tangent: Point | undefined): Point {
  return tangent ? { x: point.x + tangent.x, y: point.y + tangent.y } : point;
}

function meaningfulPoint(point: Point | undefined): boolean {
  return !!point && (Math.abs(point.x) > 1e-9 || Math.abs(point.y) > 1e-9);
}

interface MutableBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

function includePoint(
  update: (bounds: MutableBounds) => void,
  bounds: MutableBounds | undefined,
  point: Point,
): void {
  update(
    bounds
      ? {
          maxX: Math.max(bounds.maxX, point.x),
          maxY: Math.max(bounds.maxY, point.y),
          minX: Math.min(bounds.minX, point.x),
          minY: Math.min(bounds.minY, point.y),
        }
      : { maxX: point.x, maxY: point.y, minX: point.x, minY: point.y },
  );
}

function includeCubicBounds(
  source: MutableBounds | undefined,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
): MutableBounds {
  let bounds = source;
  const points = [p0, p3];
  for (const t of new Set([
    ...cubicExtrema(p0.x, p1.x, p2.x, p3.x),
    ...cubicExtrema(p0.y, p1.y, p2.y, p3.y),
  ])) {
    points.push(cubicPoint(p0, p1, p2, p3, t));
  }
  for (const point of points)
    includePoint((next) => (bounds = next), bounds, point);
  return bounds!;
}

function cubicExtrema(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return [];
    const t = -c / b;
    return t > 0 && t < 1 ? [t] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter(
    (t) => t > 0 && t < 1,
  );
}

function cubicPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const mt = 1 - t;
  return {
    x:
      mt ** 3 * p0.x +
      3 * mt ** 2 * t * p1.x +
      3 * mt * t ** 2 * p2.x +
      t ** 3 * p3.x,
    y:
      mt ** 3 * p0.y +
      3 * mt ** 2 * t * p1.y +
      3 * mt * t ** 2 * p2.y +
      t ** 3 * p3.y,
  };
}

function boundsToRect(bounds: MutableBounds | undefined): Rect {
  if (!bounds) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: normalizeNumber(bounds.minX),
    y: normalizeNumber(bounds.minY),
    width: normalizeNumber(bounds.maxX - bounds.minX),
    height: normalizeNumber(bounds.maxY - bounds.minY),
  };
}

function formatPoint(point: Point): string {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

function formatNumber(value: number): string {
  return String(normalizeNumber(value));
}

function normalizeNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
