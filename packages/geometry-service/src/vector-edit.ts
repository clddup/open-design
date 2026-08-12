import type {
  Point,
  VectorNetwork,
  VectorPathRun,
  VectorPointMode,
  VectorRegion,
  VectorSegment,
  VectorSegmentReference,
  VectorVertex,
} from "@opendesign/design-contracts";
import {
  serializeVectorNetwork,
  validateVectorNetwork,
  vectorNetworkHasBranches,
} from "./editable-vector.js";

export type VectorHandleSide = "start" | "end";

export interface VectorHandleReference {
  segmentId: string;
  side: VectorHandleSide;
}

export interface VectorVertexHandle extends VectorHandleReference {
  offset: Point;
  position: Point;
  vertexId: string;
}

export type VectorEditFailureCode =
  | "invalid-network"
  | "missing-handle"
  | "missing-path"
  | "missing-segment"
  | "missing-vertex"
  | "no-op"
  | "unsupported-topology";

export type VectorEditResult =
  | { ok: true; network: VectorNetwork }
  | { ok: false; code: VectorEditFailureCode; message: string };

export type VectorDeleteResult =
  | { ok: true; deleteNode: true }
  | { ok: true; deleteNode: false; network: VectorNetwork }
  | { ok: false; code: VectorEditFailureCode; message: string };

export type VectorCutLocation =
  | { kind: "vertex"; vertexId: string }
  | { kind: "segment"; segmentId: string; t: number };

export type VectorCutResult =
  | {
      ok: true;
      cutVertexIds: readonly [string, string];
      network: VectorNetwork;
      pathIds: readonly string[];
    }
  | { ok: false; code: VectorEditFailureCode; message: string };

export interface VectorLineCutIntersection {
  lineT: number;
  location: VectorCutLocation;
  pathId: string;
  point: Point;
}

export type VectorLineCutResult =
  | {
      ok: true;
      extractedNetwork: VectorNetwork;
      extractedPathIds: readonly string[];
      intersections: readonly VectorLineCutIntersection[];
      retainedNetwork: VectorNetwork;
      retainedPathIds: readonly string[];
    }
  | { ok: false; code: VectorEditFailureCode; message: string };

export interface VectorSegmentHit {
  distance: number;
  pathId: string;
  point: Point;
  segmentId: string;
  /** Parameter in the path run's directed traversal, not storage direction. */
  t: number;
}

interface ContourHandleReference extends VectorHandleReference {
  direction: "incoming" | "outgoing";
}

interface EditableContour {
  closed: boolean;
  pathId: string;
  references: readonly VectorSegmentReference[];
  vertexIds: readonly string[];
}

const HANDLE_EPSILON = 0.000_001;
const DEFAULT_HANDLE_RATIO = 1 / 3;
const LINE_CUT_ROOT_EPSILON = 0.000_000_1;
const LINE_CUT_SIDE_EPSILON = 0.000_001;

export function vectorNetworkEditability(
  network: VectorNetwork,
): { editable: true } | { editable: false; reason: string } {
  const issues = validateVectorNetwork(network);
  if (issues.length > 0) {
    return {
      editable: false,
      reason: issues.map((issue) => issue.message).join("; "),
    };
  }
  if (vectorNetworkHasBranches(network)) {
    return {
      editable: false,
      reason: "Branching vector networks require the branch editing slice",
    };
  }
  const owners = new Map<string, string>();
  for (const contour of uncheckedEditableContours(network)) {
    for (const vertexId of contour.vertexIds) {
      const owner = owners.get(vertexId);
      if (owner && owner !== contour.pathId) {
        return {
          editable: false,
          reason:
            "Connected path runs require the connect/disconnect editing slice",
        };
      }
      owners.set(vertexId, contour.pathId);
    }
  }
  if (network.paths.length === 0) {
    return {
      editable: false,
      reason: "An editable vector network requires at least one path run",
    };
  }
  return { editable: true };
}

export function findVectorPathIdForVertex(
  network: VectorNetwork,
  vertexId: string,
): string | undefined {
  if (!vectorNetworkEditability(network).editable) return undefined;
  return editableContours(network).find((contour) =>
    contour.vertexIds.includes(vertexId),
  )?.pathId;
}

export function listVectorVertexHandles(
  network: VectorNetwork,
  vertexId: string,
): VectorVertexHandle[] {
  const vertex = network.vertices.find(
    (candidate) => candidate.id === vertexId,
  );
  if (!vertex) return [];
  const result: VectorVertexHandle[] = [];
  for (const segment of network.segments) {
    if (
      segment.startVertexId === vertexId &&
      meaningful(segment.tangentStart)
    ) {
      result.push({
        segmentId: segment.id,
        side: "start",
        vertexId,
        offset: { ...segment.tangentStart! },
        position: add(vertex, segment.tangentStart!),
      });
    }
    if (segment.endVertexId === vertexId && meaningful(segment.tangentEnd)) {
      result.push({
        segmentId: segment.id,
        side: "end",
        vertexId,
        offset: { ...segment.tangentEnd! },
        position: add(vertex, segment.tangentEnd!),
      });
    }
  }
  return result;
}

export function inferVectorPointMode(
  network: VectorNetwork,
  vertexId: string,
): VectorPointMode {
  const vertex = network.vertices.find(
    (candidate) => candidate.id === vertexId,
  );
  if (vertex?.handleMode) return vertex.handleMode;
  const handles = listVectorVertexHandles(network, vertexId);
  if (handles.length === 0) return "corner";
  if (handles.length !== 2) return "independent";
  const [first, second] = handles;
  if (!first || !second || !oppositeDirection(first.offset, second.offset)) {
    return "independent";
  }
  const firstLength = length(first.offset);
  const secondLength = length(second.offset);
  const tolerance = Math.max(
    HANDLE_EPSILON,
    Math.max(firstLength, secondLength) * 0.001,
  );
  return Math.abs(firstLength - secondLength) <= tolerance
    ? "mirrored"
    : "smooth";
}

export function moveVectorVertices(
  network: VectorNetwork,
  vertexIds: readonly string[],
  delta: Point,
): VectorEditResult {
  const failure = editableFailure(network);
  if (failure) return failure;
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return invalidNetwork("Vector edit delta must be finite");
  }
  const selected = new Set(vertexIds);
  if (selected.size === 0)
    return missingVertex("No vector vertices are selected");
  if (
    [...selected].some(
      (vertexId) => !network.vertices.some((vertex) => vertex.id === vertexId),
    )
  ) {
    return missingVertex("A selected vector vertex does not exist");
  }
  const next = structuredClone(network);
  next.vertices = next.vertices.map((vertex) =>
    selected.has(vertex.id)
      ? { ...vertex, x: vertex.x + delta.x, y: vertex.y + delta.y }
      : vertex,
  );
  return validated(next);
}

/**
 * Returns the nearest point on any editable contour. Cubics use a deterministic
 * coarse search followed by interval refinement; the returned t follows the
 * path reference direction so it can be passed directly to cutVectorPath().
 */
export function nearestVectorSegmentPoint(
  network: VectorNetwork,
  point: Point,
): VectorSegmentHit | null {
  if (
    !vectorNetworkEditability(network).editable ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return null;
  }
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  let nearest: VectorSegmentHit | null = null;
  for (const path of network.paths) {
    for (const reference of path.segments) {
      const segment = segments.get(reference.segmentId)!;
      const curve = directedCurve(segment, reference, vertices);
      const candidate =
        meaningful(curve.tangentStart) || meaningful(curve.tangentEnd)
          ? nearestCubicPoint(curve, point)
          : nearestLinePoint(curve.start, curve.end, point);
      if (
        !nearest ||
        candidate.distance < nearest.distance - HANDLE_EPSILON ||
        (Math.abs(candidate.distance - nearest.distance) <= HANDLE_EPSILON &&
          (path.id < nearest.pathId ||
            (path.id === nearest.pathId && segment.id < nearest.segmentId)))
      ) {
        nearest = {
          ...candidate,
          pathId: path.id,
          segmentId: segment.id,
        };
      }
    }
  }
  return nearest;
}

/**
 * Creates a real topological break. The two returned endpoint IDs occupy the
 * same coordinate but are no longer connected, so subsequent edits can move
 * either side independently without introducing a visible gap at cut time.
 */
export function cutVectorPath(
  network: VectorNetwork,
  pathId: string,
  location: VectorCutLocation,
): VectorCutResult {
  const failure = editableFailure(network);
  if (failure) return failure;
  const contour = editableContour(network, pathId);
  if (!contour) {
    return missingPath(`Vector path ${pathId} does not exist`);
  }
  if (location.kind === "vertex") {
    return cutVectorPathAtVertex(network, contour, location.vertexId);
  }
  if (!Number.isFinite(location.t)) {
    return invalidNetwork("Vector cut parameter must be finite");
  }
  if (location.t < 0 || location.t > 1) {
    return invalidNetwork("Vector cut parameter must be between 0 and 1");
  }
  const referenceIndex = contour.references.findIndex(
    (reference) => reference.segmentId === location.segmentId,
  );
  if (referenceIndex < 0) {
    return missingSegment(
      `Vector segment ${location.segmentId} does not belong to path ${pathId}`,
    );
  }
  const directed = directedVertexIds(
    network.segments.find((segment) => segment.id === location.segmentId)!,
    contour.references[referenceIndex]!,
  );
  if (location.t <= HANDLE_EPSILON) {
    return cutVectorPathAtVertex(network, contour, directed.start);
  }
  if (location.t >= 1 - HANDLE_EPSILON) {
    return cutVectorPathAtVertex(network, contour, directed.end);
  }
  return cutVectorPathAtSegment(network, contour, referenceIndex, location.t);
}

/**
 * Divides disjoint contours crossed by a finite line segment. Closed contours
 * require exactly two transverse crossings and receive real closing edges.
 * Open contours are split at every transverse crossing; traversal-order pieces
 * alternate between the retained and extracted networks without invented
 * connectors or fill regions. The piece containing each source contour's first
 * directed vertex always retains the source path ID.
 */
export function cutVectorNetworkByLine(
  network: VectorNetwork,
  start: Point,
  end: Point,
): VectorLineCutResult {
  const failure = editableFailure(network);
  if (failure) return failure;
  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  ) {
    return invalidNetwork("Vector line cut endpoints must be finite");
  }
  const cutLength = distance(start, end);
  if (!Number.isFinite(cutLength)) {
    return invalidNetwork("Vector line cut length must be finite");
  }
  if (cutLength <= HANDLE_EPSILON) {
    return noOp("Vector line cut requires two distinct points");
  }

  const affected: Array<{
    compoundRegion?: CompoundRegionCutContext;
    contour: EditableContour;
    intersections: readonly ContourLineCutIntersection[];
  }> = [];
  for (const contour of editableContours(network)) {
    const resolved = contourLineCutIntersections(network, contour, start, end);
    if (!resolved.ok) return resolved;
    if (resolved.intersections.length === 0) continue;
    if (contour.closed) {
      const sourceRegions = network.regions.filter((region) =>
        region.loops.some((loop) => loop.pathId === contour.pathId),
      );
      if (sourceRegions.length > 1) {
        return unsupportedTopology(
          `Drag Cut path ${contour.pathId} belongs to multiple fill regions`,
        );
      }
      let compoundRegion: CompoundRegionCutContext | undefined;
      const sourceRegion = sourceRegions[0];
      if (sourceRegion && sourceRegion.loops.length > 1) {
        const resolved = resolveCompoundRegionCut(
          network,
          sourceRegion,
          contour.pathId,
          start,
          end,
        );
        if (!resolved.ok) return resolved;
        compoundRegion = resolved.context;
      }
      if (resolved.intersections.length !== 2) {
        return unsupportedTopology(
          `Drag Cut currently requires exactly two crossing intersections per closed contour; ${contour.pathId} has ${resolved.intersections.length}`,
        );
      }
      affected.push({
        ...(compoundRegion ? { compoundRegion } : {}),
        contour,
        intersections: resolved.intersections,
      });
      continue;
    }
    affected.push({ contour, intersections: resolved.intersections });
  }
  if (affected.length === 0) {
    return noOp("Vector line cut does not cross a supported contour");
  }

  let divided = structuredClone(network);
  const extractedPathIds = new Set<string>();
  const intersections: VectorLineCutIntersection[] = [];
  for (const target of affected) {
    const result = target.contour.closed
      ? divideClosedContourByLine(
          divided,
          target.contour,
          target.intersections,
          start,
          end,
          target.compoundRegion,
        )
      : divideOpenContourByLine(divided, target.contour, target.intersections);
    if (!result.ok) return result;
    divided = result.network;
    for (const pathId of result.extractedPathIds) {
      extractedPathIds.add(pathId);
    }
    intersections.push(
      ...target.intersections.map((intersection) => ({
        lineT: intersection.lineT,
        location: intersection.location,
        pathId: target.contour.pathId,
        point: intersection.point,
      })),
    );
  }

  const retainedPathIds = divided.paths
    .map((path) => path.id)
    .filter((pathId) => !extractedPathIds.has(pathId));
  const extractedOrderedPathIds = divided.paths
    .map((path) => path.id)
    .filter((pathId) => extractedPathIds.has(pathId));
  const retainedNetwork = vectorNetworkSubset(divided, retainedPathIds);
  const extractedNetwork = vectorNetworkSubset(
    divided,
    extractedOrderedPathIds,
  );
  const retainedIssues = validateVectorNetwork(retainedNetwork);
  const extractedIssues = validateVectorNetwork(extractedNetwork);
  if (retainedIssues.length > 0 || extractedIssues.length > 0) {
    return invalidNetwork(
      [...retainedIssues, ...extractedIssues]
        .map((issue) => issue.message)
        .join("; "),
    );
  }
  return {
    ok: true,
    extractedNetwork,
    extractedPathIds: extractedOrderedPathIds,
    intersections: intersections.sort(
      (left, right) =>
        left.lineT - right.lineT || left.pathId.localeCompare(right.pathId),
    ),
    retainedNetwork,
    retainedPathIds,
  };
}

interface ContourLineCutIntersection extends VectorLineCutIntersection {
  pathParameter: number;
}

type ContourLineCutIntersectionResult =
  | { ok: true; intersections: readonly ContourLineCutIntersection[] }
  | { ok: false; code: VectorEditFailureCode; message: string };

type DivideClosedContourResult =
  | {
      ok: true;
      extractedPathIds: readonly string[];
      network: VectorNetwork;
    }
  | { ok: false; code: VectorEditFailureCode; message: string };

type DivideOpenContourResult =
  | {
      ok: true;
      extractedPathIds: readonly string[];
      network: VectorNetwork;
    }
  | { ok: false; code: VectorEditFailureCode; message: string };

type LineSide = -1 | 1;

interface CompoundRegionCutContext {
  holes: readonly {
    loop: VectorRegion["loops"][number];
    side: LineSide;
  }[];
  outerLoop: VectorRegion["loops"][number];
  regionId: string;
}

type CompoundRegionCutResolution =
  | { ok: true; context: CompoundRegionCutContext }
  | { ok: false; code: VectorEditFailureCode; message: string };

function contourLineCutIntersections(
  network: VectorNetwork,
  contour: EditableContour,
  lineStart: Point,
  lineEnd: Point,
): ContourLineCutIntersectionResult {
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  const candidates = new Map<string, ContourLineCutIntersection>();
  for (const [referenceIndex, reference] of contour.references.entries()) {
    const segment = segments.get(reference.segmentId)!;
    const curve = directedCurve(segment, reference, vertices);
    const roots = directedCurveLineRoots(curve, lineStart, lineEnd);
    if (!roots.ok) {
      return unsupportedTopology(
        `Drag Cut overlaps path ${contour.pathId} at segment ${segment.id}`,
      );
    }
    for (const rawT of roots.roots) {
      const t =
        rawT <= LINE_CUT_ROOT_EPSILON
          ? 0
          : rawT >= 1 - LINE_CUT_ROOT_EPSILON
            ? 1
            : rawT;
      const point = normalizePoint(editableCurvePoint(curve, t));
      const lineT = lineParameter(lineStart, lineEnd, point);
      if (lineT < -LINE_CUT_ROOT_EPSILON || lineT > 1 + LINE_CUT_ROOT_EPSILON) {
        continue;
      }
      const location: VectorCutLocation =
        t === 0
          ? { kind: "vertex", vertexId: curve.startVertexId }
          : t === 1
            ? { kind: "vertex", vertexId: curve.endVertexId }
            : { kind: "segment", segmentId: segment.id, t };
      const vertexIndex =
        location.kind === "vertex"
          ? contour.vertexIds.indexOf(location.vertexId)
          : -1;
      const pathParameter = vertexIndex >= 0 ? vertexIndex : referenceIndex + t;
      const key =
        location.kind === "vertex"
          ? `vertex:${location.vertexId}`
          : `segment:${location.segmentId}:${normalizeNumber(location.t)}`;
      candidates.set(key, {
        lineT: normalizeNumber(Math.max(0, Math.min(1, lineT))),
        location,
        pathId: contour.pathId,
        pathParameter,
        point,
      });
    }
  }

  const intersections: ContourLineCutIntersection[] = [];
  for (const candidate of [...candidates.values()].sort(
    (left, right) => left.pathParameter - right.pathParameter,
  )) {
    if (
      !contour.closed &&
      (candidate.pathParameter <= LINE_CUT_ROOT_EPSILON ||
        candidate.pathParameter >=
          contour.references.length - LINE_CUT_ROOT_EPSILON)
    ) {
      continue;
    }
    const crossing = contourCrossesLineAt(
      network,
      contour,
      candidate.pathParameter,
      lineStart,
      lineEnd,
    );
    if (crossing === "ambiguous") {
      return unsupportedTopology(
        `Drag Cut is tangent to or overlaps path ${contour.pathId} at an unresolved boundary`,
      );
    }
    if (crossing) intersections.push(candidate);
  }
  return { ok: true, intersections };
}

function resolveCompoundRegionCut(
  network: VectorNetwork,
  region: VectorRegion,
  cutPathId: string,
  lineStart: Point,
  lineEnd: Point,
): CompoundRegionCutResolution {
  const outerLoop = compoundRegionOuterLoop(network, region);
  if (!outerLoop) {
    return unsupportedTopology(
      `Compound region ${region.id} does not have one unambiguous outer loop`,
    );
  }
  if (outerLoop.pathId !== cutPathId) {
    return unsupportedTopology(
      `Drag Cut through compound hole ${cutPathId} requires crossed-hole boundary stitching`,
    );
  }

  const holes: Array<CompoundRegionCutContext["holes"][number]> = [];
  for (const loop of region.loops) {
    const owners = network.regions.filter((candidate) =>
      candidate.loops.some((item) => item.pathId === loop.pathId),
    );
    if (owners.length !== 1) {
      return unsupportedTopology(
        `Compound loop ${loop.pathId} must belong to exactly one fill region`,
      );
    }
    if (loop.pathId === outerLoop.pathId) continue;
    const side = strictContourSideOfLine(
      network,
      loop.pathId,
      lineStart,
      lineEnd,
    );
    if (side === null) {
      return unsupportedTopology(
        `Drag Cut through or touching compound hole ${loop.pathId} requires crossed-hole boundary stitching`,
      );
    }
    holes.push({ loop: structuredClone(loop), side });
  }
  return {
    ok: true,
    context: {
      holes,
      outerLoop: structuredClone(outerLoop),
      regionId: region.id,
    },
  };
}

function compoundRegionOuterLoop(
  network: VectorNetwork,
  region: VectorRegion,
): VectorRegion["loops"][number] | null {
  const bounds = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (const loop of region.loops) {
    const serialized = serializeVectorNetwork(
      vectorNetworkSubset(network, [loop.pathId]),
    );
    if (!serialized.ok) return null;
    bounds.set(loop.pathId, serialized.bounds);
  }
  const candidates = region.loops.filter((candidate) => {
    const outer = bounds.get(candidate.pathId)!;
    return region.loops.every((loop) =>
      boundsContain(outer, bounds.get(loop.pathId)!),
    );
  });
  return candidates.length === 1 ? candidates[0]! : null;
}

function boundsContain(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    outer.x <= inner.x + HANDLE_EPSILON &&
    outer.y <= inner.y + HANDLE_EPSILON &&
    outer.x + outer.width >= inner.x + inner.width - HANDLE_EPSILON &&
    outer.y + outer.height >= inner.y + inner.height - HANDLE_EPSILON
  );
}

function strictContourSideOfLine(
  network: VectorNetwork,
  pathId: string,
  lineStart: Point,
  lineEnd: Point,
): LineSide | null {
  const contour = editableContour(network, pathId);
  if (!contour) return null;
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  let positive = true;
  let negative = true;
  for (const reference of contour.references) {
    const curve = directedCurve(
      segments.get(reference.segmentId)!,
      reference,
      vertices,
    );
    const points = [
      curve.start,
      add(curve.start, curve.tangentStart ?? { x: 0, y: 0 }),
      add(curve.end, curve.tangentEnd ?? { x: 0, y: 0 }),
      curve.end,
    ];
    for (const point of points) {
      const side = signedLineDistance(lineStart, lineEnd, point);
      positive &&= side > LINE_CUT_SIDE_EPSILON;
      negative &&= side < -LINE_CUT_SIDE_EPSILON;
    }
  }
  return positive ? 1 : negative ? -1 : null;
}

function dividedClosedContourSide(
  network: VectorNetwork,
  pathId: string,
  lineStart: Point,
  lineEnd: Point,
): LineSide | null {
  const contour = editableContour(network, pathId);
  if (!contour) return null;
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  let resolved: LineSide | undefined;
  for (const reference of contour.references) {
    const curve = directedCurve(
      segments.get(reference.segmentId)!,
      reference,
      vertices,
    );
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const distanceFromLine = signedLineDistance(
        lineStart,
        lineEnd,
        editableCurvePoint(curve, t),
      );
      if (Math.abs(distanceFromLine) <= LINE_CUT_SIDE_EPSILON) continue;
      const side: LineSide = distanceFromLine > 0 ? 1 : -1;
      if (resolved !== undefined && resolved !== side) return null;
      resolved = side;
    }
  }
  return resolved ?? null;
}

function divideClosedContourByLine(
  network: VectorNetwork,
  sourceContour: EditableContour,
  intersections: readonly ContourLineCutIntersection[],
  lineStart: Point,
  lineEnd: Point,
  compoundRegion?: CompoundRegionCutContext,
): DivideClosedContourResult {
  const [earlier, later] = intersections;
  if (!earlier || !later) {
    return unsupportedTopology("Drag Cut requires two ordered intersections");
  }
  const sourceRegion = network.regions.find((region) =>
    region.loops.some((loop) => loop.pathId === sourceContour.pathId),
  );
  const firstCut = cutVectorPath(network, sourceContour.pathId, later.location);
  if (!firstCut.ok) return firstCut;

  let earlierLocation = earlier.location;
  if (
    earlier.location.kind === "segment" &&
    later.location.kind === "segment" &&
    earlier.location.segmentId === later.location.segmentId
  ) {
    if (later.location.t <= LINE_CUT_ROOT_EPSILON) {
      return unsupportedTopology(
        "Drag Cut could not remap two intersections on one segment",
      );
    }
    earlierLocation = {
      kind: "segment",
      segmentId: earlier.location.segmentId,
      t: earlier.location.t / later.location.t,
    };
  }
  const secondCut = cutVectorPath(
    firstCut.network,
    sourceContour.pathId,
    earlierLocation,
  );
  if (!secondCut.ok) return secondCut;
  if (secondCut.pathIds.length !== 2) {
    return unsupportedTopology(
      `Drag Cut did not produce two open pieces for ${sourceContour.pathId}`,
    );
  }

  let closed = secondCut.network;
  for (const pathId of secondCut.pathIds) {
    const result = setVectorPathClosed(closed, true, pathId);
    if (!result.ok) return result;
    closed = result.network;
  }

  const sourceStartVertexId = sourceContour.vertexIds[0]!;
  const containingStart = secondCut.pathIds.filter((pathId) =>
    vectorPathContainsVertex(closed, pathId, sourceStartVertexId),
  );
  if (containingStart.length !== 1) {
    return unsupportedTopology(
      `Drag Cut could not preserve the stable start of ${sourceContour.pathId}`,
    );
  }
  let retainedPathId = containingStart[0]!;
  let extractedPathId = secondCut.pathIds.find(
    (pathId) => pathId !== retainedPathId,
  )!;
  if (retainedPathId !== sourceContour.pathId) {
    swapVectorPathIds(closed, sourceContour.pathId, retainedPathId);
    extractedPathId = retainedPathId;
    retainedPathId = sourceContour.pathId;
  }

  if (!sourceRegion) {
    closed.regions = closed.regions.filter(
      (region) =>
        !region.loops.some(
          (loop) =>
            loop.pathId === retainedPathId || loop.pathId === extractedPathId,
        ),
    );
  } else {
    const retainedRegion = closed.regions.find((region) =>
      region.loops.some((loop) => loop.pathId === retainedPathId),
    );
    const extractedRegion = closed.regions.find((region) =>
      region.loops.some((loop) => loop.pathId === extractedPathId),
    );
    if (!retainedRegion || !extractedRegion) {
      return invalidNetwork(
        `Drag Cut could not restore regions for ${sourceContour.pathId}`,
      );
    }
    const sourceLoopReversed =
      compoundRegion?.outerLoop.reversed ??
      sourceRegion.loops.find((loop) => loop.pathId === sourceContour.pathId)
        ?.reversed ??
      false;
    for (const region of [retainedRegion, extractedRegion]) {
      region.windingRule = sourceRegion.windingRule;
      region.loops[0]!.reversed = sourceLoopReversed;
    }
    if (retainedRegion.id !== sourceRegion.id) {
      const conflict = closed.regions.find(
        (region) => region.id === sourceRegion.id,
      );
      if (conflict) conflict.id = retainedRegion.id;
      retainedRegion.id = sourceRegion.id;
    }

    const extractedPathIds = [extractedPathId];
    if (compoundRegion) {
      const retainedSide = dividedClosedContourSide(
        closed,
        retainedPathId,
        lineStart,
        lineEnd,
      );
      const extractedSide = dividedClosedContourSide(
        closed,
        extractedPathId,
        lineStart,
        lineEnd,
      );
      if (
        retainedSide === null ||
        extractedSide === null ||
        retainedSide === extractedSide
      ) {
        return unsupportedTopology(
          `Drag Cut could not classify divided sides for compound region ${compoundRegion.regionId}`,
        );
      }
      for (const hole of compoundRegion.holes) {
        const targetRegion: VectorRegion =
          hole.side === retainedSide ? retainedRegion : extractedRegion;
        targetRegion.loops.push(structuredClone(hole.loop));
        if (targetRegion === extractedRegion) {
          extractedPathIds.push(hole.loop.pathId);
        }
      }
    }

    return { ok: true, extractedPathIds, network: closed };
  }

  return { ok: true, extractedPathIds: [extractedPathId], network: closed };
}

function divideOpenContourByLine(
  network: VectorNetwork,
  sourceContour: EditableContour,
  intersections: readonly ContourLineCutIntersection[],
): DivideOpenContourResult {
  if (sourceContour.closed || intersections.length === 0) {
    return unsupportedTopology(
      `Drag Cut requires crossings on open path ${sourceContour.pathId}`,
    );
  }
  let divided = network;
  const createdPathIds = new Set<string>();
  const upperParameterBySegment = new Map<string, number>();
  for (const intersection of [...intersections].reverse()) {
    let location = intersection.location;
    if (location.kind === "segment") {
      const segmentId = location.segmentId;
      const originalT = location.t;
      const upper = upperParameterBySegment.get(segmentId) ?? 1;
      if (upper <= LINE_CUT_ROOT_EPSILON) {
        return unsupportedTopology(
          `Drag Cut could not remap intersections on segment ${segmentId}`,
        );
      }
      location = {
        kind: "segment",
        segmentId,
        t: originalT / upper,
      };
      upperParameterBySegment.set(segmentId, originalT);
    }
    const cut = cutVectorPath(divided, sourceContour.pathId, location);
    if (!cut.ok) return cut;
    const createdPathId = cut.pathIds.find(
      (pathId) => pathId !== sourceContour.pathId,
    );
    if (!createdPathId) {
      return unsupportedTopology(
        `Drag Cut did not produce a new open piece for ${sourceContour.pathId}`,
      );
    }
    createdPathIds.add(createdPathId);
    divided = cut.network;
  }

  const orderedPieceIds = divided.paths
    .map((path) => path.id)
    .filter(
      (pathId) => pathId === sourceContour.pathId || createdPathIds.has(pathId),
    );
  if (orderedPieceIds.length !== intersections.length + 1) {
    return unsupportedTopology(
      `Drag Cut produced an unstable open-path partition for ${sourceContour.pathId}`,
    );
  }
  const extractedPathIds = orderedPieceIds.filter(
    (_pathId, index) => index % 2 === 1,
  );
  if (extractedPathIds.length === 0) {
    return noOp(
      `Drag Cut did not extract a piece from ${sourceContour.pathId}`,
    );
  }
  return { ok: true, extractedPathIds, network: divided };
}

function directedCurveLineRoots(
  curve: DirectedCurve,
  lineStart: Point,
  lineEnd: Point,
): { ok: true; roots: readonly number[] } | { ok: false } {
  const controlStart = add(curve.start, curve.tangentStart ?? { x: 0, y: 0 });
  const controlEnd = add(curve.end, curve.tangentEnd ?? { x: 0, y: 0 });
  const sides = [curve.start, controlStart, controlEnd, curve.end].map(
    (point) => signedLineDistance(lineStart, lineEnd, point),
  );
  const cubic = meaningful(curve.tangentStart) || meaningful(curve.tangentEnd);
  if (
    (cubic ? sides : [sides[0]!, sides[3]!]).every(
      (value) => Math.abs(value) <= LINE_CUT_SIDE_EPSILON,
    )
  ) {
    return { ok: false };
  }
  const roots = cubic
    ? realPolynomialRoots(
        -sides[0]! + 3 * sides[1]! - 3 * sides[2]! + sides[3]!,
        3 * sides[0]! - 6 * sides[1]! + 3 * sides[2]!,
        -3 * sides[0]! + 3 * sides[1]!,
        sides[0]!,
      )
    : Math.abs(sides[0]! - sides[3]!) <= LINE_CUT_SIDE_EPSILON
      ? []
      : [sides[0]! / (sides[0]! - sides[3]!)];
  if (Math.abs(sides[0]!) <= LINE_CUT_SIDE_EPSILON) roots.push(0);
  if (Math.abs(sides[3]!) <= LINE_CUT_SIDE_EPSILON) roots.push(1);
  return {
    ok: true,
    roots: dedupeNumbers(
      roots.filter(
        (root) =>
          Number.isFinite(root) &&
          root >= -LINE_CUT_ROOT_EPSILON &&
          root <= 1 + LINE_CUT_ROOT_EPSILON,
      ),
    ).map((root) => Math.max(0, Math.min(1, root))),
  };
}

function contourCrossesLineAt(
  network: VectorNetwork,
  contour: EditableContour,
  pathParameter: number,
  lineStart: Point,
  lineEnd: Point,
): boolean | "ambiguous" {
  for (const delta of [0.000_01, 0.000_1, 0.001, 0.01]) {
    const before = signedLineDistance(
      lineStart,
      lineEnd,
      contourPointAt(network, contour, pathParameter - delta),
    );
    const after = signedLineDistance(
      lineStart,
      lineEnd,
      contourPointAt(network, contour, pathParameter + delta),
    );
    if (
      Math.abs(before) > LINE_CUT_SIDE_EPSILON &&
      Math.abs(after) > LINE_CUT_SIDE_EPSILON
    ) {
      return before < 0 !== after < 0;
    }
  }
  return "ambiguous";
}

function contourPointAt(
  network: VectorNetwork,
  contour: EditableContour,
  rawParameter: number,
): Point {
  const count = contour.references.length;
  const parameter = contour.closed
    ? ((rawParameter % count) + count) % count
    : Math.max(0, Math.min(count, rawParameter));
  const index = Math.min(count - 1, Math.floor(parameter));
  const t =
    index === count - 1 ? Math.min(1, parameter - index) : parameter - index;
  const reference = contour.references[index]!;
  const segment = network.segments.find(
    (candidate) => candidate.id === reference.segmentId,
  )!;
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  return editableCurvePoint(directedCurve(segment, reference, vertices), t);
}

function editableCurvePoint(curve: DirectedCurve, t: number): Point {
  return meaningful(curve.tangentStart) || meaningful(curve.tangentEnd)
    ? directedCurvePoint(curve, t)
    : lerp(curve.start, curve.end, t);
}

function lineParameter(start: Point, end: Point, point: Point): number {
  const delta = subtract(end, start);
  const denominator = delta.x * delta.x + delta.y * delta.y;
  return denominator <= HANDLE_EPSILON
    ? 0
    : ((point.x - start.x) * delta.x + (point.y - start.y) * delta.y) /
        denominator;
}

function signedLineDistance(start: Point, end: Point, point: Point): number {
  const delta = subtract(end, start);
  const magnitude = Math.hypot(delta.x, delta.y);
  return magnitude <= HANDLE_EPSILON
    ? 0
    : (delta.x * (point.y - start.y) - delta.y * (point.x - start.x)) /
        magnitude;
}

function realPolynomialRoots(
  cubic: number,
  quadratic: number,
  linear: number,
  constant: number,
): number[] {
  if (Math.abs(cubic) <= LINE_CUT_ROOT_EPSILON) {
    if (Math.abs(quadratic) <= LINE_CUT_ROOT_EPSILON) {
      return Math.abs(linear) <= LINE_CUT_ROOT_EPSILON
        ? []
        : [-constant / linear];
    }
    const discriminant = linear * linear - 4 * quadratic * constant;
    if (discriminant < -LINE_CUT_ROOT_EPSILON) return [];
    if (Math.abs(discriminant) <= LINE_CUT_ROOT_EPSILON) {
      return [-linear / (2 * quadratic)];
    }
    const root = Math.sqrt(Math.max(0, discriminant));
    return [
      (-linear - root) / (2 * quadratic),
      (-linear + root) / (2 * quadratic),
    ];
  }
  const a = quadratic / cubic;
  const b = linear / cubic;
  const c = constant / cubic;
  const p = b - (a * a) / 3;
  const q = (2 * a * a * a) / 27 - (a * b) / 3 + c;
  const discriminant = (q * q) / 4 + (p * p * p) / 27;
  const offset = a / 3;
  if (discriminant > LINE_CUT_ROOT_EPSILON) {
    const root = Math.sqrt(discriminant);
    return [Math.cbrt(-q / 2 + root) + Math.cbrt(-q / 2 - root) - offset];
  }
  if (Math.abs(discriminant) <= LINE_CUT_ROOT_EPSILON) {
    const root = Math.cbrt(-q / 2);
    return [2 * root - offset, -root - offset];
  }
  const radius = 2 * Math.sqrt(-p / 3);
  const angle = Math.acos(
    Math.max(-1, Math.min(1, -q / 2 / Math.sqrt(-(p * p * p) / 27))),
  );
  return [0, 1, 2].map(
    (index) => radius * Math.cos((angle + index * 2 * Math.PI) / 3) - offset,
  );
}

function dedupeNumbers(values: readonly number[]): number[] {
  const result: number[] = [];
  for (const value of [...values].sort((left, right) => left - right)) {
    if (
      result.length === 0 ||
      Math.abs(value - result[result.length - 1]!) > LINE_CUT_ROOT_EPSILON
    ) {
      result.push(value);
    }
  }
  return result;
}

function vectorPathContainsVertex(
  network: VectorNetwork,
  pathId: string,
  vertexId: string,
): boolean {
  const path = pathById(network, pathId);
  if (!path) return false;
  const segmentIds = new Set(
    path.segments.map((reference) => reference.segmentId),
  );
  return network.segments.some(
    (segment) =>
      segmentIds.has(segment.id) &&
      (segment.startVertexId === vertexId || segment.endVertexId === vertexId),
  );
}

function swapVectorPathIds(
  network: VectorNetwork,
  firstId: string,
  secondId: string,
): void {
  const first = pathById(network, firstId)!;
  const second = pathById(network, secondId)!;
  first.id = secondId;
  second.id = firstId;
  for (const region of network.regions) {
    for (const loop of region.loops) {
      if (loop.pathId === firstId) loop.pathId = secondId;
      else if (loop.pathId === secondId) loop.pathId = firstId;
    }
  }
}

function vectorNetworkSubset(
  network: VectorNetwork,
  pathIds: readonly string[],
): VectorNetwork {
  const includedPaths = new Set(pathIds);
  const paths = network.paths
    .filter((path) => includedPaths.has(path.id))
    .map((path) => structuredClone(path));
  const segmentIds = new Set(
    paths.flatMap((path) =>
      path.segments.map((reference) => reference.segmentId),
    ),
  );
  const segments = network.segments
    .filter((segment) => segmentIds.has(segment.id))
    .map((segment) => structuredClone(segment));
  const vertexIds = new Set(
    segments.flatMap((segment) => [segment.startVertexId, segment.endVertexId]),
  );
  return {
    vertices: network.vertices
      .filter((vertex) => vertexIds.has(vertex.id))
      .map((vertex) => structuredClone(vertex)),
    segments,
    paths,
    regions: network.regions
      .filter((region) =>
        region.loops.every((loop) => includedPaths.has(loop.pathId)),
      )
      .map((region) => structuredClone(region)),
  };
}

/**
 * Opens or closes one explicit non-branching contour. Single-contour callers
 * may omit pathId; multi-contour callers must name the target path run.
 */
export function setVectorPathClosed(
  network: VectorNetwork,
  closed: boolean,
  pathId?: string,
): VectorEditResult {
  const failure = editableFailure(network);
  if (failure) return failure;
  const resolved = resolveTargetContour(network, pathId);
  if (!resolved.ok) return resolved;
  const contour = resolved.contour;
  if (contour.closed === closed) {
    return noOp(
      `Vector path ${contour.pathId} is already ${closed ? "closed" : "open"}`,
    );
  }
  if (closed && !contourCanFormClosedRegion(network, contour)) {
    return unsupportedTopology(
      "A closed vector contour requires three vertices or a non-linear Bézier arc",
    );
  }

  const next = structuredClone(network);
  const path = next.paths.find((candidate) => candidate.id === contour.pathId)!;
  if (closed) {
    const firstVertexId = contour.vertexIds[0]!;
    const lastVertexId = contour.vertexIds.at(-1)!;
    const closingSegmentId = nextSegmentId(
      new Set(next.segments.map((segment) => segment.id)),
    );
    const closingSegment: VectorSegment = {
      id: closingSegmentId,
      startVertexId: lastVertexId,
      endVertexId: firstVertexId,
    };
    mirrorEndpointHandleIntoClosingSegment(
      network,
      lastVertexId,
      "outgoing",
      closingSegment,
    );
    mirrorEndpointHandleIntoClosingSegment(
      network,
      firstVertexId,
      "incoming",
      closingSegment,
    );
    next.segments.push(closingSegment);
    path.segments.push({ segmentId: closingSegmentId, reversed: false });
    path.closed = true;
    next.regions.push({
      id: nextRegionId(new Set(next.regions.map((region) => region.id))),
      windingRule: "nonzero",
      loops: [{ pathId: path.id, reversed: false }],
    });
    return validated(next);
  }

  const closingReference = path.segments.at(-1)!;
  path.segments = path.segments.slice(0, -1);
  path.closed = false;
  next.segments = next.segments.filter(
    (segment) => segment.id !== closingReference.segmentId,
  );
  next.regions = next.regions.filter(
    (region) => !region.loops.some((loop) => loop.pathId === path.id),
  );
  return validated(next);
}

/**
 * Reverses traversal without replacing any geometry IDs. Region loop
 * direction is toggled with the path so the effective winding remains
 * visually equivalent for nonzero fills.
 */
export function reverseVectorPath(
  network: VectorNetwork,
  pathId?: string,
): VectorEditResult {
  const failure = editableFailure(network);
  if (failure) return failure;
  const resolved = resolveTargetContour(network, pathId);
  if (!resolved.ok) return resolved;
  const contour = resolved.contour;
  const next = structuredClone(network);
  const path = next.paths.find((candidate) => candidate.id === contour.pathId)!;
  path.segments = [...path.segments].reverse().map((reference) => ({
    segmentId: reference.segmentId,
    reversed: !reference.reversed,
  }));
  next.regions = next.regions.map((region) => ({
    ...region,
    loops: region.loops.map((loop) =>
      loop.pathId === path.id ? { ...loop, reversed: !loop.reversed } : loop,
    ),
  }));
  return validated(next);
}

export function setVectorPointMode(
  network: VectorNetwork,
  vertexIds: readonly string[],
  mode: VectorPointMode,
): VectorEditResult {
  const failure = editableFailure(network);
  if (failure) return failure;
  const selected = new Set(vertexIds);
  if (selected.size === 0)
    return missingVertex("No vector vertices are selected");
  const next = structuredClone(network);
  for (const vertexId of selected) {
    const vertex = next.vertices.find((candidate) => candidate.id === vertexId);
    if (!vertex)
      return missingVertex(`Vector vertex ${vertexId} does not exist`);
    const references = contourHandles(next, vertexId);
    if (!references) return unsupportedTopology();
    const defaults = defaultHandles(next, vertexId, references);
    if (mode === "corner") {
      references.forEach((reference) => setHandle(next, reference, undefined));
      vertex.handleMode = mode;
      continue;
    }

    const incoming = references.find(
      (reference) => reference.direction === "incoming",
    );
    const outgoing = references.find(
      (reference) => reference.direction === "outgoing",
    );
    const currentIncoming = incoming ? readHandle(next, incoming) : undefined;
    const currentOutgoing = outgoing ? readHandle(next, outgoing) : undefined;
    if (mode === "independent") {
      if (incoming && !meaningful(currentIncoming)) {
        setHandle(next, incoming, defaults.incoming);
      }
      if (outgoing && !meaningful(currentOutgoing)) {
        setHandle(next, outgoing, defaults.outgoing);
      }
      vertex.handleMode = mode;
      continue;
    }

    const direction = preferredOutgoingDirection(
      currentIncoming,
      currentOutgoing,
      defaults.incoming,
      defaults.outgoing,
    );
    const incomingLength = preferredLength(
      currentIncoming,
      defaults.incoming,
      40,
    );
    const outgoingLength = preferredLength(
      currentOutgoing,
      defaults.outgoing,
      40,
    );
    if (mode === "mirrored") {
      const lengths = [incomingLength, outgoingLength].filter(
        (value) => value > HANDLE_EPSILON,
      );
      const sharedLength = lengths.length
        ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length
        : 40;
      if (incoming) setHandle(next, incoming, scale(direction, -sharedLength));
      if (outgoing) setHandle(next, outgoing, scale(direction, sharedLength));
    } else {
      if (incoming)
        setHandle(next, incoming, scale(direction, -incomingLength));
      if (outgoing) setHandle(next, outgoing, scale(direction, outgoingLength));
    }
    vertex.handleMode = mode;
  }
  return validated(next);
}

export function moveVectorHandle(
  network: VectorNetwork,
  reference: VectorHandleReference,
  offset: Point,
): VectorEditResult {
  const failure = editableFailure(network);
  if (failure) return failure;
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
    return invalidNetwork("Vector handle offset must be finite");
  }
  const next = structuredClone(network);
  const segment = next.segments.find(
    (candidate) => candidate.id === reference.segmentId,
  );
  if (!segment)
    return missingHandle(
      `Vector segment ${reference.segmentId} does not exist`,
    );
  const vertexId =
    reference.side === "start" ? segment.startVertexId : segment.endVertexId;
  const vertex = next.vertices.find((candidate) => candidate.id === vertexId);
  if (!vertex) return missingVertex(`Vector vertex ${vertexId} does not exist`);
  const references = contourHandles(next, vertexId);
  if (!references) return unsupportedTopology();
  const selected = references.find(
    (candidate) =>
      candidate.segmentId === reference.segmentId &&
      candidate.side === reference.side,
  );
  if (!selected)
    return missingHandle(
      "The handle is not attached to the selected contour vertex",
    );
  const opposite = references.find(
    (candidate) => candidate.direction !== selected.direction,
  );
  const mode = inferVectorPointMode(next, vertexId);
  setHandle(next, selected, offset);
  if (opposite && (mode === "mirrored" || mode === "smooth")) {
    const selectedLength = length(offset);
    const direction =
      selectedLength > HANDLE_EPSILON
        ? { x: offset.x / selectedLength, y: offset.y / selectedLength }
        : { x: 1, y: 0 };
    const oppositeLength =
      mode === "mirrored"
        ? selectedLength
        : preferredLength(
            readHandle(next, opposite),
            undefined,
            selectedLength,
          );
    setHandle(next, opposite, scale(direction, -oppositeLength));
  }
  vertex.handleMode = mode === "corner" ? "independent" : mode;
  return validated(next);
}

export function deleteVectorVertices(
  network: VectorNetwork,
  vertexIds: readonly string[],
): VectorDeleteResult {
  const failure = editableFailure(network);
  if (failure) return failure;
  const selected = new Set(vertexIds);
  if (selected.size === 0)
    return missingVertex("No vector vertices are selected");
  const available = new Set(network.vertices.map((vertex) => vertex.id));
  if ([...selected].some((vertexId) => !available.has(vertexId))) {
    return missingVertex(
      "A selected vector vertex does not exist in the editable network",
    );
  }
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  const usedIds = new Set(network.segments.map((segment) => segment.id));
  const retainedPaths: VectorPathRun[] = [];
  const retainedSegments = new Map<string, VectorSegment>();
  const modifiedVertexIds = new Set<string>();
  const deletedPathIds = new Set<string>();

  for (const contour of editableContours(network)) {
    const changed = contour.vertexIds.some((vertexId) =>
      selected.has(vertexId),
    );
    if (!changed) {
      retainedPaths.push(structuredClone(pathById(network, contour.pathId)!));
      for (const reference of contour.references) {
        retainedSegments.set(
          reference.segmentId,
          structuredClone(segments.get(reference.segmentId)!),
        );
      }
      continue;
    }
    const remaining = contour.vertexIds.filter(
      (vertexId) => !selected.has(vertexId),
    );
    if (remaining.length < (contour.closed ? 3 : 2)) {
      deletedPathIds.add(contour.pathId);
      continue;
    }
    const references: VectorSegmentReference[] = [];
    const edgeCount = contour.closed ? remaining.length : remaining.length - 1;
    for (let index = 0; index < edgeCount; index += 1) {
      const startVertexId = remaining[index]!;
      const endVertexId = remaining[(index + 1) % remaining.length]!;
      const original = originalDirectedEdge(
        network,
        contour,
        startVertexId,
        endVertexId,
      );
      if (original) {
        references.push({ ...original.reference });
        retainedSegments.set(
          original.reference.segmentId,
          structuredClone(segments.get(original.reference.segmentId)!),
        );
      } else {
        const id = nextSegmentId(usedIds);
        usedIds.add(id);
        retainedSegments.set(id, { id, startVertexId, endVertexId });
        references.push({ segmentId: id, reversed: false });
      }
    }
    remaining.forEach((vertexId) => modifiedVertexIds.add(vertexId));
    retainedPaths.push({
      ...structuredClone(pathById(network, contour.pathId)!),
      segments: references,
    });
  }

  if (retainedPaths.length === 0) return { ok: true, deleteNode: true };
  const retainedVertexIds = new Set<string>();
  for (const segment of retainedSegments.values()) {
    retainedVertexIds.add(segment.startVertexId);
    retainedVertexIds.add(segment.endVertexId);
  }
  const next: VectorNetwork = {
    vertices: network.vertices
      .filter((vertex) => retainedVertexIds.has(vertex.id))
      .map((vertex) => {
        const nextVertex = structuredClone(vertex);
        if (modifiedVertexIds.has(vertex.id)) delete nextVertex.handleMode;
        return nextVertex;
      }),
    segments: retainedPaths.flatMap((path) =>
      path.segments.map((reference) =>
        retainedSegments.get(reference.segmentId)!,
      ),
    ),
    paths: retainedPaths,
    regions: network.regions
      .filter(
        (region) =>
          !region.loops.some((loop) => deletedPathIds.has(loop.pathId)),
      )
      .map((region) => structuredClone(region)),
  };
  next.vertices = next.vertices.map((vertex) =>
    modifiedVertexIds.has(vertex.id)
      ? { ...vertex, handleMode: inferVectorPointMode(next, vertex.id) }
      : vertex,
  );
  const result = validated(next);
  return result.ok
    ? { ok: true, deleteNode: false, network: result.network }
    : result;
}

function editableFailure(
  network: VectorNetwork,
): Extract<VectorEditResult, { ok: false }> | null {
  const editability = vectorNetworkEditability(network);
  if (editability.editable) return null;
  const issues = validateVectorNetwork(network);
  return issues.length
    ? invalidNetwork(editability.reason)
    : { ok: false, code: "unsupported-topology", message: editability.reason };
}

function editableContours(network: VectorNetwork): EditableContour[] {
  if (!vectorNetworkEditability(network).editable) return [];
  return uncheckedEditableContours(network);
}

function uncheckedEditableContours(network: VectorNetwork): EditableContour[] {
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  return network.paths.map((path) => {
    const vertexIds: string[] = [];
    for (const [index, reference] of path.segments.entries()) {
      const segment = segments.get(reference.segmentId)!;
      const directed = directedVertexIds(segment, reference);
      if (index === 0) vertexIds.push(directed.start);
      vertexIds.push(directed.end);
    }
    if (path.closed) vertexIds.pop();
    return {
      closed: path.closed,
      pathId: path.id,
      references: path.segments,
      vertexIds,
    };
  });
}

function editableContour(
  network: VectorNetwork,
  pathId: string,
): EditableContour | null {
  return (
    editableContours(network).find((contour) => contour.pathId === pathId) ??
    null
  );
}

function resolveTargetContour(
  network: VectorNetwork,
  pathId: string | undefined,
):
  | { ok: true; contour: EditableContour }
  | Extract<VectorEditResult, { ok: false }> {
  if (!pathId && network.paths.length !== 1) {
    return unsupportedTopology(
      "An explicit pathId is required for a multi-contour vector network",
    );
  }
  const resolvedPathId = pathId ?? network.paths[0]?.id;
  const contour = resolvedPathId
    ? editableContour(network, resolvedPathId)
    : null;
  return contour
    ? { ok: true, contour }
    : missingPath(`Vector path ${resolvedPathId ?? ""} does not exist`);
}

function contourHandles(
  network: VectorNetwork,
  vertexId: string,
): ContourHandleReference[] | null {
  const contour = editableContours(network).find((candidate) =>
    candidate.vertexIds.includes(vertexId),
  );
  if (!contour) return null;
  const index = contour.vertexIds.indexOf(vertexId);
  if (index < 0) return [];
  const result: ContourHandleReference[] = [];
  const incomingIndex =
    index - 1 >= 0
      ? index - 1
      : contour.closed
        ? contour.references.length - 1
        : -1;
  if (incomingIndex >= 0) {
    const reference = contour.references[incomingIndex]!;
    result.push({
      ...handleAtDirectedEnd(reference),
      direction: "incoming",
    });
  }
  if (index < contour.references.length) {
    const reference = contour.references[index]!;
    result.push({
      ...handleAtDirectedStart(reference),
      direction: "outgoing",
    });
  }
  return result;
}

function defaultHandles(
  network: VectorNetwork,
  vertexId: string,
  references: readonly ContourHandleReference[],
): { incoming?: Point; outgoing?: Point } {
  const contour = editableContours(network).find((candidate) =>
    candidate.vertexIds.includes(vertexId),
  )!;
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const index = contour.vertexIds.indexOf(vertexId);
  const current = vertices.get(vertexId)!;
  const previousId =
    index > 0
      ? contour.vertexIds[index - 1]
      : contour.closed
        ? contour.vertexIds.at(-1)
        : undefined;
  const nextId =
    index + 1 < contour.vertexIds.length
      ? contour.vertexIds[index + 1]
      : contour.closed
        ? contour.vertexIds[0]
        : undefined;
  const previous = previousId ? vertices.get(previousId) : undefined;
  const next = nextId ? vertices.get(nextId) : undefined;
  let direction: Point | undefined;
  if (previous && next)
    direction = unit({ x: next.x - previous.x, y: next.y - previous.y });
  else if (next)
    direction = unit({ x: next.x - current.x, y: next.y - current.y });
  else if (previous)
    direction = unit({ x: current.x - previous.x, y: current.y - previous.y });
  direction ??= { x: 1, y: 0 };
  return {
    ...(references.some((reference) => reference.direction === "incoming") &&
    previous
      ? {
          incoming: scale(
            direction,
            -distance(current, previous) * DEFAULT_HANDLE_RATIO,
          ),
        }
      : {}),
    ...(references.some((reference) => reference.direction === "outgoing") &&
    next
      ? {
          outgoing: scale(
            direction,
            distance(current, next) * DEFAULT_HANDLE_RATIO,
          ),
        }
      : {}),
  };
}

function contourCanFormClosedRegion(
  network: VectorNetwork,
  contour: EditableContour,
): boolean {
  if (contour.vertexIds.length >= 3) return true;
  if (contour.vertexIds.length < 2) return false;
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  return contour.references.some((reference) => {
    const curve = directedCurve(
      segments.get(reference.segmentId)!,
      reference,
      vertices,
    );
    const chord = subtract(curve.end, curve.start);
    const controlStart = add(curve.start, curve.tangentStart ?? { x: 0, y: 0 });
    const controlEnd = add(curve.end, curve.tangentEnd ?? { x: 0, y: 0 });
    return [controlStart, controlEnd].some((control) => {
      const relative = subtract(control, curve.start);
      return (
        Math.abs(chord.x * relative.y - chord.y * relative.x) > HANDLE_EPSILON
      );
    });
  });
}

function cutVectorPathAtVertex(
  network: VectorNetwork,
  contour: EditableContour,
  vertexId: string,
): VectorCutResult {
  const vertexIndex = contour.vertexIds.indexOf(vertexId);
  if (vertexIndex < 0) {
    return missingVertex(
      `Vector vertex ${vertexId} does not belong to path ${contour.pathId}`,
    );
  }
  if (
    !contour.closed &&
    (vertexIndex === 0 || vertexIndex === contour.vertexIds.length - 1)
  ) {
    return noOp(`Vector vertex ${vertexId} is already an open endpoint`);
  }

  const next = structuredClone(network);
  const path = pathById(next, contour.pathId)!;
  const sourceVertex = next.vertices.find((vertex) => vertex.id === vertexId)!;
  const duplicateId = nextVertexId(
    new Set(next.vertices.map((vertex) => vertex.id)),
  );
  const duplicate: VectorVertex = {
    ...structuredClone(sourceVertex),
    id: duplicateId,
  };
  delete duplicate.handleMode;
  delete sourceVertex.handleMode;
  const sourceIndex = next.vertices.findIndex(
    (vertex) => vertex.id === vertexId,
  );
  next.vertices.splice(sourceIndex + 1, 0, duplicate);

  if (contour.closed) {
    const incomingIndex =
      (vertexIndex - 1 + contour.references.length) % contour.references.length;
    const incoming = path.segments[incomingIndex]!;
    const segment = next.segments.find(
      (candidate) => candidate.id === incoming.segmentId,
    )!;
    setDirectedEndVertexId(segment, incoming, duplicateId);
    path.segments = [
      ...path.segments.slice(vertexIndex),
      ...path.segments.slice(0, vertexIndex),
    ];
    path.closed = false;
    next.regions = removePathRegions(next.regions, path.id);
    setEndpointPointModes(next, [vertexId, duplicateId]);
    return validatedCut(next, [vertexId, duplicateId], [path.id]);
  }

  const outgoing = path.segments[vertexIndex]!;
  const outgoingSegment = next.segments.find(
    (candidate) => candidate.id === outgoing.segmentId,
  )!;
  setDirectedStartVertexId(outgoingSegment, outgoing, duplicateId);
  const newPathId = nextPathId(new Set(next.paths.map((item) => item.id)));
  const newPath: VectorPathRun = {
    id: newPathId,
    closed: false,
    segments: path.segments.slice(vertexIndex),
  };
  path.segments = path.segments.slice(0, vertexIndex);
  const pathIndex = next.paths.findIndex((item) => item.id === path.id);
  next.paths.splice(pathIndex + 1, 0, newPath);
  setEndpointPointModes(next, [vertexId, duplicateId]);
  return validatedCut(next, [vertexId, duplicateId], [path.id, newPathId]);
}

function cutVectorPathAtSegment(
  network: VectorNetwork,
  contour: EditableContour,
  referenceIndex: number,
  t: number,
): VectorCutResult {
  const next = structuredClone(network);
  const path = pathById(next, contour.pathId)!;
  const reference = path.segments[referenceIndex]!;
  const segmentIndex = next.segments.findIndex(
    (segment) => segment.id === reference.segmentId,
  );
  const segment = next.segments[segmentIndex]!;
  const vertices = new Map(next.vertices.map((vertex) => [vertex.id, vertex]));
  const curve = directedCurve(segment, reference, vertices);
  const split = splitDirectedCurve(curve, t);

  const usedVertexIds = new Set(next.vertices.map((vertex) => vertex.id));
  const firstCutVertexId = nextVertexId(usedVertexIds);
  usedVertexIds.add(firstCutVertexId);
  const secondCutVertexId = nextVertexId(usedVertexIds);
  const firstCutVertex: VectorVertex = {
    id: firstCutVertexId,
    ...split.point,
  };
  const secondCutVertex: VectorVertex = {
    id: secondCutVertexId,
    ...split.point,
  };
  next.vertices.push(firstCutVertex, secondCutVertex);

  const newSegmentId = nextSegmentId(
    new Set(next.segments.map((item) => item.id)),
  );
  const firstSegment = storedSegmentFromDirectedCurve(
    segment.id,
    curve.startVertexId,
    firstCutVertexId,
    split.first,
    reference.reversed,
  );
  const secondSegment = storedSegmentFromDirectedCurve(
    newSegmentId,
    secondCutVertexId,
    curve.endVertexId,
    split.second,
    reference.reversed,
  );
  next.segments.splice(segmentIndex, 1, firstSegment, secondSegment);
  const firstReference: VectorSegmentReference = {
    segmentId: segment.id,
    reversed: reference.reversed,
  };
  const secondReference: VectorSegmentReference = {
    segmentId: newSegmentId,
    reversed: reference.reversed,
  };
  const prefix = path.segments.slice(0, referenceIndex);
  const suffix = path.segments.slice(referenceIndex + 1);
  let pathIds: string[];
  if (contour.closed) {
    path.segments = [secondReference, ...suffix, ...prefix, firstReference];
    path.closed = false;
    next.regions = removePathRegions(next.regions, path.id);
    pathIds = [path.id];
  } else {
    path.segments = [...prefix, firstReference];
    const newPathId = nextPathId(new Set(next.paths.map((item) => item.id)));
    const newPath: VectorPathRun = {
      id: newPathId,
      closed: false,
      segments: [secondReference, ...suffix],
    };
    const pathIndex = next.paths.findIndex((item) => item.id === path.id);
    next.paths.splice(pathIndex + 1, 0, newPath);
    pathIds = [path.id, newPathId];
  }
  setEndpointPointModes(next, [firstCutVertexId, secondCutVertexId]);
  return validatedCut(next, [firstCutVertexId, secondCutVertexId], pathIds);
}

interface DirectedCurve {
  end: Point;
  endVertexId: string;
  start: Point;
  startVertexId: string;
  tangentEnd?: Point;
  tangentStart?: Point;
}

function directedCurve(
  segment: VectorSegment,
  reference: VectorSegmentReference,
  vertices: ReadonlyMap<string, VectorVertex>,
): DirectedCurve {
  const ids = directedVertexIds(segment, reference);
  return {
    start: vertices.get(ids.start)!,
    startVertexId: ids.start,
    end: vertices.get(ids.end)!,
    endVertexId: ids.end,
    ...(reference.reversed
      ? {
          ...(segment.tangentEnd
            ? { tangentStart: { ...segment.tangentEnd } }
            : {}),
          ...(segment.tangentStart
            ? { tangentEnd: { ...segment.tangentStart } }
            : {}),
        }
      : {
          ...(segment.tangentStart
            ? { tangentStart: { ...segment.tangentStart } }
            : {}),
          ...(segment.tangentEnd
            ? { tangentEnd: { ...segment.tangentEnd } }
            : {}),
        }),
  };
}

function splitDirectedCurve(
  curve: DirectedCurve,
  t: number,
): {
  first: Pick<DirectedCurve, "tangentStart" | "tangentEnd">;
  point: Point;
  second: Pick<DirectedCurve, "tangentStart" | "tangentEnd">;
} {
  if (!meaningful(curve.tangentStart) && !meaningful(curve.tangentEnd)) {
    return {
      first: {},
      point: normalizePoint(lerp(curve.start, curve.end, t)),
      second: {},
    };
  }
  const controlStart = add(curve.start, curve.tangentStart ?? { x: 0, y: 0 });
  const controlEnd = add(curve.end, curve.tangentEnd ?? { x: 0, y: 0 });
  const q0 = lerp(curve.start, controlStart, t);
  const q1 = lerp(controlStart, controlEnd, t);
  const q2 = lerp(controlEnd, curve.end, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const point = normalizePoint(lerp(r0, r1, t));
  return {
    first: {
      tangentStart: normalizePoint(subtract(q0, curve.start)),
      tangentEnd: normalizePoint(subtract(r0, point)),
    },
    point,
    second: {
      tangentStart: normalizePoint(subtract(r1, point)),
      tangentEnd: normalizePoint(subtract(q2, curve.end)),
    },
  };
}

function storedSegmentFromDirectedCurve(
  id: string,
  startVertexId: string,
  endVertexId: string,
  curve: Pick<DirectedCurve, "tangentStart" | "tangentEnd">,
  reversed: boolean,
): VectorSegment {
  const tangentStart = meaningful(curve.tangentStart)
    ? normalizePoint(curve.tangentStart!)
    : undefined;
  const tangentEnd = meaningful(curve.tangentEnd)
    ? normalizePoint(curve.tangentEnd!)
    : undefined;
  if (!reversed) {
    return {
      id,
      startVertexId,
      endVertexId,
      ...(tangentStart ? { tangentStart } : {}),
      ...(tangentEnd ? { tangentEnd } : {}),
    };
  }
  return {
    id,
    startVertexId: endVertexId,
    endVertexId: startVertexId,
    ...(tangentEnd ? { tangentStart: tangentEnd } : {}),
    ...(tangentStart ? { tangentEnd: tangentStart } : {}),
  };
}

function nearestLinePoint(
  start: Point,
  end: Point,
  point: Point,
): Pick<VectorSegmentHit, "distance" | "point" | "t"> {
  const delta = subtract(end, start);
  const denominator = delta.x * delta.x + delta.y * delta.y;
  const t =
    denominator <= HANDLE_EPSILON
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * delta.x + (point.y - start.y) * delta.y) /
              denominator,
          ),
        );
  const nearest = normalizePoint(lerp(start, end, t));
  return { distance: distance(nearest, point), point: nearest, t };
}

function nearestCubicPoint(
  curve: DirectedCurve,
  point: Point,
): Pick<VectorSegmentHit, "distance" | "point" | "t"> {
  const sampleCount = 32;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= sampleCount; index += 1) {
    const sample = directedCurvePoint(curve, index / sampleCount);
    const candidate = squaredDistance(sample, point);
    if (candidate < bestDistance) {
      bestDistance = candidate;
      bestIndex = index;
    }
  }
  let left = Math.max(0, (bestIndex - 1) / sampleCount);
  let right = Math.min(1, (bestIndex + 1) / sampleCount);
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const first = left + (right - left) / 3;
    const second = right - (right - left) / 3;
    if (
      squaredDistance(directedCurvePoint(curve, first), point) <=
      squaredDistance(directedCurvePoint(curve, second), point)
    ) {
      right = second;
    } else {
      left = first;
    }
  }
  const t = normalizeNumber((left + right) / 2);
  const nearest = normalizePoint(directedCurvePoint(curve, t));
  return { distance: distance(nearest, point), point: nearest, t };
}

function directedCurvePoint(curve: DirectedCurve, t: number): Point {
  const controlStart = add(curve.start, curve.tangentStart ?? { x: 0, y: 0 });
  const controlEnd = add(curve.end, curve.tangentEnd ?? { x: 0, y: 0 });
  const mt = 1 - t;
  return {
    x:
      mt ** 3 * curve.start.x +
      3 * mt ** 2 * t * controlStart.x +
      3 * mt * t ** 2 * controlEnd.x +
      t ** 3 * curve.end.x,
    y:
      mt ** 3 * curve.start.y +
      3 * mt ** 2 * t * controlStart.y +
      3 * mt * t ** 2 * controlEnd.y +
      t ** 3 * curve.end.y,
  };
}

function setDirectedStartVertexId(
  segment: VectorSegment,
  reference: VectorSegmentReference,
  vertexId: string,
): void {
  if (reference.reversed) segment.endVertexId = vertexId;
  else segment.startVertexId = vertexId;
}

function setDirectedEndVertexId(
  segment: VectorSegment,
  reference: VectorSegmentReference,
  vertexId: string,
): void {
  if (reference.reversed) segment.startVertexId = vertexId;
  else segment.endVertexId = vertexId;
}

function setEndpointPointModes(
  network: VectorNetwork,
  vertexIds: readonly string[],
): void {
  for (const vertexId of vertexIds) {
    const vertex = network.vertices.find(
      (candidate) => candidate.id === vertexId,
    );
    if (!vertex) continue;
    delete vertex.handleMode;
  }
  for (const vertexId of vertexIds) {
    const vertex = network.vertices.find(
      (candidate) => candidate.id === vertexId,
    );
    if (vertex) vertex.handleMode = inferVectorPointMode(network, vertexId);
  }
}

function removePathRegions(
  regions: VectorNetwork["regions"],
  pathId: string,
): VectorNetwork["regions"] {
  return regions.filter(
    (region) => !region.loops.some((loop) => loop.pathId === pathId),
  );
}

function pathById(
  network: VectorNetwork,
  pathId: string,
): VectorPathRun | undefined {
  return network.paths.find((path) => path.id === pathId);
}

function originalDirectedEdge(
  network: VectorNetwork,
  contour: EditableContour,
  startVertexId: string,
  endVertexId: string,
): { reference: VectorSegmentReference } | null {
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  for (const reference of contour.references) {
    const segment = segments.get(reference.segmentId)!;
    const directed = directedVertexIds(segment, reference);
    if (directed.start === startVertexId && directed.end === endVertexId) {
      return { reference };
    }
  }
  return null;
}

function handleAtDirectedStart(
  reference: VectorSegmentReference,
): VectorHandleReference {
  return {
    segmentId: reference.segmentId,
    side: reference.reversed ? "end" : "start",
  };
}

function handleAtDirectedEnd(
  reference: VectorSegmentReference,
): VectorHandleReference {
  return {
    segmentId: reference.segmentId,
    side: reference.reversed ? "start" : "end",
  };
}

function readHandle(
  network: VectorNetwork,
  reference: VectorHandleReference,
): Point | undefined {
  const segment = network.segments.find(
    (candidate) => candidate.id === reference.segmentId,
  );
  return reference.side === "start"
    ? segment?.tangentStart
    : segment?.tangentEnd;
}

function setHandle(
  network: VectorNetwork,
  reference: VectorHandleReference,
  offset: Point | undefined,
): void {
  const segment = network.segments.find(
    (candidate) => candidate.id === reference.segmentId,
  );
  if (!segment) return;
  if (reference.side === "start") {
    if (offset) segment.tangentStart = normalizePoint(offset);
    else delete segment.tangentStart;
  } else if (offset) segment.tangentEnd = normalizePoint(offset);
  else delete segment.tangentEnd;
}

function preferredOutgoingDirection(
  incoming: Point | undefined,
  outgoing: Point | undefined,
  defaultIncoming: Point | undefined,
  defaultOutgoing: Point | undefined,
): Point {
  return (
    unit(outgoing) ??
    negateUnit(incoming) ??
    unit(defaultOutgoing) ??
    negateUnit(defaultIncoming) ?? { x: 1, y: 0 }
  );
}

function preferredLength(
  current: Point | undefined,
  fallback: Point | undefined,
  finalFallback: number,
): number {
  const currentLength = current ? length(current) : 0;
  if (currentLength > HANDLE_EPSILON) return currentLength;
  const fallbackLength = fallback ? length(fallback) : 0;
  return fallbackLength > HANDLE_EPSILON ? fallbackLength : finalFallback;
}

function nextSegmentId(usedIds: ReadonlySet<string>): string {
  let index = 1;
  while (usedIds.has(`segment_edit_${index}`)) index += 1;
  return `segment_edit_${index}`;
}

function nextVertexId(usedIds: ReadonlySet<string>): string {
  let index = 1;
  while (usedIds.has(`vertex_edit_${index}`)) index += 1;
  return `vertex_edit_${index}`;
}

function nextPathId(usedIds: ReadonlySet<string>): string {
  let index = 1;
  while (usedIds.has(`path_edit_${index}`)) index += 1;
  return `path_edit_${index}`;
}

function nextRegionId(usedIds: ReadonlySet<string>): string {
  let index = 1;
  while (usedIds.has(`region_edit_${index}`)) index += 1;
  return `region_edit_${index}`;
}

function mirrorEndpointHandleIntoClosingSegment(
  network: VectorNetwork,
  vertexId: string,
  direction: "incoming" | "outgoing",
  closingSegment: VectorSegment,
): void {
  const mode = inferVectorPointMode(network, vertexId);
  if (mode !== "smooth" && mode !== "mirrored") return;
  const reference = contourHandles(network, vertexId)?.find(
    (candidate) => candidate.direction !== direction,
  );
  const existing = reference ? readHandle(network, reference) : undefined;
  if (!meaningful(existing)) return;
  const mirrored = scale(existing!, -1);
  if (direction === "outgoing") closingSegment.tangentStart = mirrored;
  else closingSegment.tangentEnd = mirrored;
}

function directedVertexIds(
  segment: VectorSegment,
  reference: VectorSegmentReference,
): { start: string; end: string } {
  return reference.reversed
    ? { start: segment.endVertexId, end: segment.startVertexId }
    : { start: segment.startVertexId, end: segment.endVertexId };
}

function validated(network: VectorNetwork): VectorEditResult {
  const issues = validateVectorNetwork(network);
  return issues.length === 0
    ? { ok: true, network }
    : invalidNetwork(issues.map((issue) => issue.message).join("; "));
}

function validatedCut(
  network: VectorNetwork,
  cutVertexIds: readonly [string, string],
  pathIds: readonly string[],
): VectorCutResult {
  const issues = validateVectorNetwork(network);
  return issues.length === 0
    ? { ok: true, network, cutVertexIds, pathIds }
    : invalidNetwork(issues.map((issue) => issue.message).join("; "));
}

function invalidNetwork(
  message: string,
): Extract<VectorEditResult, { ok: false }> {
  return { ok: false, code: "invalid-network", message };
}

function missingVertex(
  message: string,
): Extract<VectorEditResult, { ok: false }> {
  return { ok: false, code: "missing-vertex", message };
}

function missingPath(
  message: string,
): Extract<VectorEditResult, { ok: false }> {
  return { ok: false, code: "missing-path", message };
}

function missingSegment(
  message: string,
): Extract<VectorEditResult, { ok: false }> {
  return { ok: false, code: "missing-segment", message };
}

function missingHandle(
  message: string,
): Extract<VectorEditResult, { ok: false }> {
  return { ok: false, code: "missing-handle", message };
}

function noOp(message: string): Extract<VectorEditResult, { ok: false }> {
  return { ok: false, code: "no-op", message };
}

function unsupportedTopology(
  message = "This editing slice supports disjoint non-branching contours",
): Extract<VectorEditResult, { ok: false }> {
  return {
    ok: false,
    code: "unsupported-topology",
    message,
  };
}

function meaningful(point: Point | undefined): boolean {
  return !!point && length(point) > HANDLE_EPSILON;
}

function oppositeDirection(left: Point, right: Point): boolean {
  const leftLength = length(left);
  const rightLength = length(right);
  if (leftLength <= HANDLE_EPSILON || rightLength <= HANDLE_EPSILON)
    return false;
  const cross = Math.abs(left.x * right.y - left.y * right.x);
  const tolerance = leftLength * rightLength * 0.001;
  return cross <= tolerance && left.x * right.x + left.y * right.y < 0;
}

function add(left: Point, right: Point): Point {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}

function lerp(start: Point, end: Point, t: number): Point {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function scale(point: Point, factor: number): Point {
  return normalizePoint({ x: point.x * factor, y: point.y * factor });
}

function unit(point: Point | undefined): Point | undefined {
  if (!point) return undefined;
  const value = length(point);
  return value <= HANDLE_EPSILON
    ? undefined
    : { x: point.x / value, y: point.y / value };
}

function negateUnit(point: Point | undefined): Point | undefined {
  const value = unit(point);
  return value ? { x: -value.x, y: -value.y } : undefined;
}

function length(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function squaredDistance(left: Point, right: Point): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function normalizePoint(point: Point): Point {
  return { x: normalizeNumber(point.x), y: normalizeNumber(point.y) };
}

function normalizeNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
