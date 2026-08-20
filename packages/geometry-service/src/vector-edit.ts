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
 * Connects two real endpoints without introducing a branch. Endpoints on one
 * open contour close it; endpoints on two open contours add one connector and
 * merge both path runs while preserving the earlier path ID.
 */
export function connectVectorEndpoints(
  network: VectorNetwork,
  vertexIds: readonly [string, string],
): VectorEditResult {
  const failure = editableFailure(network);
  if (failure) return failure;
  const [firstVertexId, secondVertexId] = vertexIds;
  if (firstVertexId === secondVertexId) {
    return missingVertex("Vector Connect requires two distinct endpoints");
  }
  const first = endpointContour(network, firstVertexId);
  const second = endpointContour(network, secondVertexId);
  if (!first || !second) {
    return unsupportedTopology(
      "Vector Connect requires two endpoints from supported open contours",
    );
  }
  if (first.pathId === second.pathId) {
    return setVectorPathClosed(network, true, first.pathId);
  }

  const firstIndex = network.paths.findIndex(
    (path) => path.id === first.pathId,
  );
  const secondIndex = network.paths.findIndex(
    (path) => path.id === second.pathId,
  );
  const retained = firstIndex < secondIndex ? first : second;
  const appended = retained === first ? second : first;
  const retainedEndpointId =
    retained === first ? firstVertexId : secondVertexId;
  const appendedEndpointId =
    appended === first ? firstVertexId : secondVertexId;
  const retainedReferences = referencesWithEndpoint(
    retained,
    retainedEndpointId,
    "end",
  );
  const appendedReferences = referencesWithEndpoint(
    appended,
    appendedEndpointId,
    "start",
  );
  if (!retainedReferences || !appendedReferences) {
    return unsupportedTopology(
      "Vector Connect could not orient the selected contour endpoints",
    );
  }

  const next = structuredClone(network);
  const retainedVertex = network.vertices.find(
    (vertex) => vertex.id === retainedEndpointId,
  )!;
  const appendedVertex = network.vertices.find(
    (vertex) => vertex.id === appendedEndpointId,
  )!;
  const coincident =
    Math.abs(retainedVertex.x - appendedVertex.x) <= HANDLE_EPSILON &&
    Math.abs(retainedVertex.y - appendedVertex.y) <= HANDLE_EPSILON;
  let connectorReference: VectorSegmentReference[] = [];
  if (coincident) {
    next.segments = next.segments.map((segment) => ({
      ...segment,
      ...(segment.startVertexId === appendedEndpointId
        ? { startVertexId: retainedEndpointId }
        : {}),
      ...(segment.endVertexId === appendedEndpointId
        ? { endVertexId: retainedEndpointId }
        : {}),
    }));
    next.vertices = next.vertices.filter(
      (vertex) => vertex.id !== appendedEndpointId,
    );
  } else {
    const connector: VectorSegment = {
      id: nextSegmentId(new Set(next.segments.map((segment) => segment.id))),
      startVertexId: retainedEndpointId,
      endVertexId: appendedEndpointId,
    };
    mirrorEndpointHandleIntoClosingSegment(
      network,
      retainedEndpointId,
      "outgoing",
      connector,
    );
    mirrorEndpointHandleIntoClosingSegment(
      network,
      appendedEndpointId,
      "incoming",
      connector,
    );
    next.segments.push(connector);
    connectorReference = [{ segmentId: connector.id, reversed: false }];
  }
  const retainedPath = next.paths.find((path) => path.id === retained.pathId)!;
  retainedPath.closed = false;
  retainedPath.segments = [
    ...retainedReferences,
    ...connectorReference,
    ...appendedReferences,
  ];
  next.paths = next.paths.filter((path) => path.id !== appended.pathId);
  if (coincident) {
    const mergedVertex = next.vertices.find(
      (vertex) => vertex.id === retainedEndpointId,
    )!;
    delete mergedVertex.handleMode;
    mergedVertex.handleMode = inferVectorPointMode(next, retainedEndpointId);
  }
  return validated(next);
}

/** Creates a true topological break at one non-endpoint vertex. */
export function disconnectVectorVertex(
  network: VectorNetwork,
  pathId: string,
  vertexId: string,
): VectorCutResult {
  return cutVectorPath(network, pathId, { kind: "vertex", vertexId });
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
 * Divides disjoint contours crossed by a finite line segment. Closed fill
 * regions are partitioned at every transverse crossing and rebuilt as
 * continuous editable loops with real cut connectors. Open contours split at
 * every transverse crossing; traversal-order pieces alternate between the
 * retained and extracted networks without connectors or fill regions. The
 * result containing each source outer contour's first directed vertex retains
 * the source path and region IDs.
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

  const sourceContours = editableContours(network);
  const intersectionsByPath = new Map<
    string,
    readonly ContourLineCutIntersection[]
  >();
  for (const contour of sourceContours) {
    const resolved = contourLineCutIntersections(network, contour, start, end);
    if (!resolved.ok) return resolved;
    intersectionsByPath.set(contour.pathId, resolved.intersections);
  }
  if ([...intersectionsByPath.values()].every((items) => items.length === 0)) {
    return noOp("Vector line cut does not cross a supported contour");
  }

  let divided = structuredClone(network);
  const extractedPathIds = new Set<string>();
  const intersections: VectorLineCutIntersection[] = [];
  const handledRegions = new Set<string>();
  const handledClosedPaths = new Set<string>();
  for (const sourceContour of sourceContours) {
    const sourceIntersections =
      intersectionsByPath.get(sourceContour.pathId) ?? [];
    if (!sourceContour.closed || sourceIntersections.length === 0) continue;
    const sourceRegions = network.regions.filter((region) =>
      region.loops.some((loop) => loop.pathId === sourceContour.pathId),
    );
    if (sourceRegions.length > 1) {
      return unsupportedTopology(
        `Drag Cut path ${sourceContour.pathId} belongs to multiple fill regions`,
      );
    }
    const sourceRegion = sourceRegions[0];
    if (sourceRegion) {
      if (handledRegions.has(sourceRegion.id)) continue;
      handledRegions.add(sourceRegion.id);
      for (const loop of sourceRegion.loops) {
        const owners = network.regions.filter((region) =>
          region.loops.some((item) => item.pathId === loop.pathId),
        );
        if (owners.length !== 1) {
          return unsupportedTopology(
            `Compound loop ${loop.pathId} must belong to exactly one fill region`,
          );
        }
        handledClosedPaths.add(loop.pathId);
      }
    } else {
      handledClosedPaths.add(sourceContour.pathId);
    }
    const result = divideClosedRegionByLine(
      divided,
      sourceRegion,
      sourceRegion?.loops.map((loop) => loop.pathId) ?? [sourceContour.pathId],
      intersectionsByPath,
      start,
      end,
    );
    if (!result.ok) return result;
    divided = result.network;
    for (const pathId of result.extractedPathIds) {
      extractedPathIds.add(pathId);
    }
    intersections.push(
      ...result.intersections.map((intersection) => ({
        lineT: intersection.lineT,
        location: intersection.location,
        pathId: intersection.pathId,
        point: intersection.point,
      })),
    );
  }

  for (const sourceContour of sourceContours) {
    const sourceIntersections =
      intersectionsByPath.get(sourceContour.pathId) ?? [];
    if (
      sourceContour.closed ||
      handledClosedPaths.has(sourceContour.pathId) ||
      sourceIntersections.length === 0
    ) {
      continue;
    }
    const currentContour = editableContour(divided, sourceContour.pathId);
    if (!currentContour) {
      return unsupportedTopology(
        `Drag Cut lost open path ${sourceContour.pathId} during partition`,
      );
    }
    const result = divideOpenContourByLine(
      divided,
      currentContour,
      sourceIntersections,
    );
    if (!result.ok) return result;
    divided = result.network;
    for (const pathId of result.extractedPathIds) {
      extractedPathIds.add(pathId);
    }
    intersections.push(...sourceIntersections);
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
      intersections: readonly ContourLineCutIntersection[];
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

function divideClosedRegionByLine(
  network: VectorNetwork,
  sourceRegion: VectorRegion | undefined,
  pathIds: readonly string[],
  intersectionsByPath: ReadonlyMap<
    string,
    readonly ContourLineCutIntersection[]
  >,
  lineStart: Point,
  lineEnd: Point,
): DivideClosedContourResult {
  const outerLoop = sourceRegion
    ? compoundRegionOuterLoop(network, sourceRegion)
    : { pathId: pathIds[0]!, reversed: false };
  if (!outerLoop) {
    return unsupportedTopology(
      `Compound region ${sourceRegion?.id ?? ""} does not have one unambiguous outer loop`,
    );
  }
  const allIntersections = pathIds
    .flatMap((pathId) => intersectionsByPath.get(pathId) ?? [])
    .sort((left, right) => left.lineT - right.lineT);
  if (allIntersections.length === 0) {
    return noOp("Closed region is not crossed by the Cut line");
  }
  if (allIntersections.length % 2 !== 0) {
    return unsupportedTopology(
      `Closed region Cut requires an even number of transverse crossings; received ${allIntersections.length}`,
    );
  }
  const outerIntersections = intersectionsByPath.get(outerLoop.pathId) ?? [];
  if (outerIntersections.length === 0) {
    return unsupportedTopology(
      `Drag Cut through compound hole requires the outer boundary ${outerLoop.pathId} to be crossed`,
    );
  }
  const stableOuterStartVertexId = editableContour(network, outerLoop.pathId)
    ?.vertexIds[0];
  if (!stableOuterStartVertexId) {
    return unsupportedTopology(
      `Drag Cut could not resolve the stable outer start of ${outerLoop.pathId}`,
    );
  }

  let partitioned = network;
  const arcPathIds: string[] = [];
  const uncutLoops: VectorRegion["loops"] = [];
  const endpointToCrossing = new Map<string, ContourLineCutIntersection>();
  for (const pathId of pathIds) {
    const sourceIntersections = intersectionsByPath.get(pathId) ?? [];
    const sourceContour = editableContour(partitioned, pathId);
    if (!sourceContour) {
      return unsupportedTopology(`Closed region path ${pathId} is unavailable`);
    }
    if (sourceIntersections.length === 0) {
      const loop = sourceRegion?.loops.find((item) => item.pathId === pathId);
      if (loop) uncutLoops.push(structuredClone(loop));
      continue;
    }
    const partition = partitionClosedContourAtIntersections(
      partitioned,
      sourceContour,
      sourceIntersections,
    );
    if (!partition.ok) return partition;
    partitioned = partition.network;
    arcPathIds.push(...partition.pathIds);
    for (const endpoint of partition.endpoints) {
      endpointToCrossing.set(endpoint.vertexId, endpoint.intersection);
    }
  }

  const usedSegmentIds = new Set(
    partitioned.segments.map((segment) => segment.id),
  );
  for (let index = 0; index < allIntersections.length; index += 2) {
    const first = allIntersections[index]!;
    const second = allIntersections[index + 1]!;
    const firstEndpoints = crossingEndpointIds(endpointToCrossing, first);
    const secondEndpoints = crossingEndpointIds(endpointToCrossing, second);
    if (firstEndpoints.length !== 2 || secondEndpoints.length !== 2) {
      return unsupportedTopology(
        "Closed region Cut could not resolve two boundary endpoints per crossing",
      );
    }
    const firstBySide = crossingEndpointsBySide(
      partitioned,
      firstEndpoints,
      lineStart,
      lineEnd,
    );
    const secondBySide = crossingEndpointsBySide(
      partitioned,
      secondEndpoints,
      lineStart,
      lineEnd,
    );
    if (!firstBySide || !secondBySide) {
      return unsupportedTopology(
        "Closed region Cut could not classify boundary arcs on both sides of the cut line",
      );
    }
    for (const side of [-1, 1] as const) {
      const segmentId = nextSegmentId(usedSegmentIds);
      usedSegmentIds.add(segmentId);
      partitioned.segments.push({
        id: segmentId,
        startVertexId: firstBySide[side],
        endVertexId: secondBySide[side],
      });
    }
  }

  const rebuilt = rebuildClosedPartitionPaths(
    partitioned,
    arcPathIds,
    sourceRegion,
    outerLoop,
    stableOuterStartVertexId,
    uncutLoops,
    lineStart,
    lineEnd,
  );
  if (!rebuilt.ok) return rebuilt;
  return {
    ok: true,
    extractedPathIds: rebuilt.extractedPathIds,
    intersections: allIntersections,
    network: rebuilt.network,
  };
}

type ClosedContourPartitionResult =
  | {
      ok: true;
      endpoints: readonly {
        intersection: ContourLineCutIntersection;
        vertexId: string;
      }[];
      network: VectorNetwork;
      pathIds: readonly string[];
    }
  | { ok: false; code: VectorEditFailureCode; message: string };

function partitionClosedContourAtIntersections(
  network: VectorNetwork,
  sourceContour: EditableContour,
  intersections: readonly ContourLineCutIntersection[],
): ClosedContourPartitionResult {
  let divided = network;
  const createdPathIds = new Set<string>();
  const upperParameterBySegment = new Map<string, number>();
  const endpoints: Array<{
    intersection: ContourLineCutIntersection;
    vertexId: string;
  }> = [];
  for (const intersection of [...intersections].reverse()) {
    let location = intersection.location;
    if (location.kind === "segment") {
      const upper = upperParameterBySegment.get(location.segmentId) ?? 1;
      if (upper <= LINE_CUT_ROOT_EPSILON) {
        return unsupportedTopology(
          `Drag Cut could not remap intersections on segment ${location.segmentId}`,
        );
      }
      const originalT = location.t;
      location = {
        kind: "segment",
        segmentId: location.segmentId,
        t: originalT / upper,
      };
      upperParameterBySegment.set(location.segmentId, originalT);
    }
    const cut = cutVectorPath(divided, sourceContour.pathId, location);
    if (!cut.ok) return cut;
    for (const vertexId of cut.cutVertexIds) {
      endpoints.push({ intersection, vertexId });
    }
    for (const pathId of cut.pathIds) {
      if (pathId !== sourceContour.pathId) createdPathIds.add(pathId);
    }
    divided = cut.network;
  }
  const pathIds = divided.paths
    .map((path) => path.id)
    .filter(
      (pathId) => pathId === sourceContour.pathId || createdPathIds.has(pathId),
    );
  if (pathIds.length !== intersections.length) {
    return unsupportedTopology(
      `Drag Cut produced an unstable closed-path partition for ${sourceContour.pathId}`,
    );
  }
  return { ok: true, endpoints, network: divided, pathIds };
}

function crossingEndpointIds(
  endpointToCrossing: ReadonlyMap<string, ContourLineCutIntersection>,
  intersection: ContourLineCutIntersection,
): string[] {
  return [...endpointToCrossing]
    .filter(([, candidate]) => sameLineCutIntersection(candidate, intersection))
    .map(([vertexId]) => vertexId)
    .sort();
}

function crossingEndpointsBySide(
  network: VectorNetwork,
  vertexIds: readonly string[],
  lineStart: Point,
  lineEnd: Point,
): Record<LineSide, string> | null {
  const result: Partial<Record<LineSide, string>> = {};
  for (const vertexId of vertexIds) {
    const side = openEndpointInteriorSide(
      network,
      vertexId,
      lineStart,
      lineEnd,
    );
    if (side === null || result[side] !== undefined) return null;
    result[side] = vertexId;
  }
  const negative = result[-1];
  const positive = result[1];
  return negative && positive ? { [-1]: negative, [1]: positive } : null;
}

function openEndpointInteriorSide(
  network: VectorNetwork,
  vertexId: string,
  lineStart: Point,
  lineEnd: Point,
): LineSide | null {
  const contour = uncheckedEditableContours(network).find(
    (candidate) =>
      !candidate.closed &&
      (candidate.vertexIds[0] === vertexId ||
        candidate.vertexIds.at(-1) === vertexId),
  );
  if (!contour) return null;
  const atStart = contour.vertexIds[0] === vertexId;
  for (const offset of [0.000_01, 0.000_1, 0.001, 0.01, 0.1]) {
    const parameter = atStart ? offset : contour.references.length - offset;
    const distanceFromLine = signedLineDistance(
      lineStart,
      lineEnd,
      contourPointAt(network, contour, parameter),
    );
    if (Math.abs(distanceFromLine) > LINE_CUT_SIDE_EPSILON) {
      return distanceFromLine > 0 ? 1 : -1;
    }
  }
  return null;
}

function sameLineCutIntersection(
  left: ContourLineCutIntersection,
  right: ContourLineCutIntersection,
): boolean {
  return (
    left.pathId === right.pathId &&
    Math.abs(left.pathParameter - right.pathParameter) <=
      LINE_CUT_ROOT_EPSILON &&
    Math.abs(left.lineT - right.lineT) <= LINE_CUT_ROOT_EPSILON
  );
}

type RebuiltClosedPartitionResult =
  | {
      ok: true;
      extractedPathIds: readonly string[];
      network: VectorNetwork;
    }
  | { ok: false; code: VectorEditFailureCode; message: string };

function rebuildClosedPartitionPaths(
  network: VectorNetwork,
  arcPathIds: readonly string[],
  sourceRegion: VectorRegion | undefined,
  outerLoop: VectorRegion["loops"][number],
  stableOuterStartVertexId: string,
  uncutLoops: readonly VectorRegion["loops"][number][],
  lineStart: Point,
  lineEnd: Point,
): RebuiltClosedPartitionResult {
  const next = structuredClone(network);
  const arcPaths = new Map(
    next.paths
      .filter((path) => arcPathIds.includes(path.id))
      .map((path) => [path.id, path]),
  );
  const segmentsById = new Map(
    next.segments.map((segment) => [segment.id, segment]),
  );
  const connectorSegments = next.segments.filter(
    (segment) => !pathOwnsSegment(next, segment.id),
  );
  const adjacency = new Map<
    string,
    Array<{
      reference?: VectorSegmentReference;
      segmentId: string;
      sourcePathId?: string;
      to: string;
    }>
  >();
  for (const path of arcPaths.values()) {
    const first = path.segments[0]!;
    const last = path.segments.at(-1)!;
    const start = directedVertexIds(
      segmentsById.get(first.segmentId)!,
      first,
    ).start;
    const end = directedVertexIds(segmentsById.get(last.segmentId)!, last).end;
    addPartitionEdge(adjacency, start, {
      segmentId: path.id,
      sourcePathId: path.id,
      to: end,
    });
    addPartitionEdge(adjacency, end, {
      segmentId: path.id,
      sourcePathId: path.id,
      to: start,
    });
  }
  for (const segment of connectorSegments) {
    addPartitionEdge(adjacency, segment.startVertexId, {
      reference: { segmentId: segment.id, reversed: false },
      segmentId: segment.id,
      to: segment.endVertexId,
    });
    addPartitionEdge(adjacency, segment.endVertexId, {
      reference: { segmentId: segment.id, reversed: true },
      segmentId: segment.id,
      to: segment.startVertexId,
    });
  }

  const unusedPathIds = new Set(arcPathIds);
  const unusedConnectorIds = new Set(
    connectorSegments.map((segment) => segment.id),
  );
  const loops: Array<{
    references: VectorSegmentReference[];
  }> = [];
  while (unusedPathIds.size > 0) {
    const seedPathId = [...unusedPathIds][0]!;
    const seed = arcPaths.get(seedPathId)!;
    const seedFirst = seed.segments[0]!;
    const seedStart = directedVertexIds(
      segmentsById.get(seedFirst.segmentId)!,
      seedFirst,
    ).start;
    const references: VectorSegmentReference[] = [];
    let current = seedStart;
    let guard = 0;
    while (guard < arcPathIds.length + connectorSegments.length + 1) {
      guard += 1;
      const candidates = adjacency.get(current) ?? [];
      const edge = candidates.find((candidate) =>
        candidate.sourcePathId
          ? unusedPathIds.has(candidate.sourcePathId)
          : unusedConnectorIds.has(candidate.segmentId),
      );
      if (!edge) {
        return unsupportedTopology(
          "Drag Cut could not rebuild a continuous closed partition loop",
        );
      }
      if (edge.sourcePathId) {
        const path = arcPaths.get(edge.sourcePathId)!;
        const first = path.segments[0]!;
        const firstStart = directedVertexIds(
          segmentsById.get(first.segmentId)!,
          first,
        ).start;
        references.push(
          ...(firstStart === current
            ? path.segments.map((reference) => ({ ...reference }))
            : [...path.segments].reverse().map((reference) => ({
                segmentId: reference.segmentId,
                reversed: !reference.reversed,
              }))),
        );
        unusedPathIds.delete(edge.sourcePathId);
      } else {
        if (!edge.reference) {
          return unsupportedTopology(
            "Drag Cut connector edge is missing its traversal reference",
          );
        }
        references.push({ ...edge.reference });
        unusedConnectorIds.delete(edge.segmentId);
      }
      current = edge.to;
      if (current === seedStart) break;
    }
    if (current !== seedStart) {
      return unsupportedTopology("Drag Cut partition loop did not close");
    }
    loops.push({ references });
  }
  if (unusedConnectorIds.size > 0) {
    return unsupportedTopology(
      "Drag Cut left connector edges outside the rebuilt closed partition loops",
    );
  }

  const retainedIndex = loops.findIndex((loop) =>
    loopContainsVertex(next, loop.references, stableOuterStartVertexId),
  );
  if (retainedIndex < 0) {
    return unsupportedTopology(
      `Drag Cut could not preserve the stable outer start of ${outerLoop.pathId}`,
    );
  }

  const removedPathIds = new Set(arcPathIds);
  next.paths = next.paths.filter((path) => !removedPathIds.has(path.id));
  if (sourceRegion) {
    next.regions = next.regions.filter(
      (region) => region.id !== sourceRegion.id,
    );
  }
  const usedPathIds = new Set(next.paths.map((path) => path.id));
  const usedRegionIds = new Set(next.regions.map((region) => region.id));
  const rebuiltPathIds: string[] = [];
  const rebuiltRegionIds: string[] = [];
  for (const [index, loop] of loops.entries()) {
    const pathId =
      index === retainedIndex ? outerLoop.pathId : nextPathId(usedPathIds);
    usedPathIds.add(pathId);
    rebuiltPathIds.push(pathId);
    next.paths.push({ id: pathId, closed: true, segments: loop.references });
    if (sourceRegion) {
      const regionId =
        index === retainedIndex ? sourceRegion.id : nextRegionId(usedRegionIds);
      usedRegionIds.add(regionId);
      rebuiltRegionIds.push(regionId);
      next.regions.push({
        id: regionId,
        windingRule: sourceRegion.windingRule,
        loops: [{ pathId, reversed: outerLoop.reversed }],
      });
    }
  }
  const retainedSide = partitionLoopSide(
    next,
    rebuiltPathIds[retainedIndex]!,
    lineStart,
    lineEnd,
  );
  if (retainedSide === null) {
    return unsupportedTopology("Drag Cut could not classify retained side");
  }
  const extractedPathIds = rebuiltPathIds.filter((pathId) => {
    const side = partitionLoopSide(next, pathId, lineStart, lineEnd);
    return side !== null && side !== retainedSide;
  });
  if (extractedPathIds.length === 0) {
    return noOp("Drag Cut did not extract a closed region component");
  }
  if (sourceRegion && uncutLoops.length > 0) {
    const regionByPathId = new Map(
      rebuiltPathIds.map((pathId, index) => [
        pathId,
        next.regions.find((region) => region.id === rebuiltRegionIds[index]),
      ]),
    );
    for (const loop of uncutLoops) {
      const point = representativePathPoint(next, loop.pathId);
      const ownerPathId = point
        ? rebuiltPathIds.find((pathId) =>
            closedPathContainsPoint(next, pathId, point),
          )
        : undefined;
      const owner = ownerPathId ? regionByPathId.get(ownerPathId) : undefined;
      if (!owner) {
        return unsupportedTopology(
          `Drag Cut could not assign uncut compound loop ${loop.pathId} to one divided region`,
        );
      }
      owner.loops.push(structuredClone(loop));
      if (extractedPathIds.includes(ownerPathId!)) {
        extractedPathIds.push(loop.pathId);
      }
    }
  }
  const affectedPathIds = new Set([
    ...rebuiltPathIds,
    ...uncutLoops.map((loop) => loop.pathId),
  ]);
  const pathsById = new Map(next.paths.map((path) => [path.id, path]));
  const orderedAffectedPathIds = rebuiltPathIds.flatMap((pathId, index) => [
    pathId,
    ...(next.regions
      .find((region) => region.id === rebuiltRegionIds[index])
      ?.loops.filter((loop) => loop.pathId !== pathId)
      .map((loop) => loop.pathId) ?? []),
  ]);
  next.paths = [
    ...next.paths.filter((path) => !affectedPathIds.has(path.id)),
    ...orderedAffectedPathIds.map((pathId) => pathsById.get(pathId)!),
  ];
  return { ok: true, extractedPathIds, network: next };
}

function addPartitionEdge(
  adjacency: Map<
    string,
    Array<{
      reference?: VectorSegmentReference;
      segmentId: string;
      sourcePathId?: string;
      to: string;
    }>
  >,
  from: string,
  edge: {
    reference?: VectorSegmentReference;
    segmentId: string;
    sourcePathId?: string;
    to: string;
  },
): void {
  adjacency.set(from, [...(adjacency.get(from) ?? []), { ...edge }]);
}

function pathOwnsSegment(network: VectorNetwork, segmentId: string): boolean {
  return network.paths.some((path) =>
    path.segments.some((reference) => reference.segmentId === segmentId),
  );
}

function loopContainsVertex(
  network: VectorNetwork,
  references: readonly VectorSegmentReference[],
  vertexId: string,
): boolean {
  const segmentIds = new Set(
    references.map((reference) => reference.segmentId),
  );
  return network.segments.some(
    (segment) =>
      segmentIds.has(segment.id) &&
      (segment.startVertexId === vertexId || segment.endVertexId === vertexId),
  );
}

function representativePathPoint(
  network: VectorNetwork,
  pathId: string,
): Point | null {
  const path = network.paths.find((candidate) => candidate.id === pathId);
  const reference = path?.segments[0];
  const segment = reference
    ? network.segments.find((candidate) => candidate.id === reference.segmentId)
    : undefined;
  if (!reference || !segment) return null;
  const vertexId = directedVertexIds(segment, reference).start;
  const vertex = network.vertices.find(
    (candidate) => candidate.id === vertexId,
  );
  return vertex ? { x: vertex.x, y: vertex.y } : null;
}

function closedPathContainsPoint(
  network: VectorNetwork,
  pathId: string,
  point: Point,
): boolean {
  const contour = editableContour(network, pathId);
  if (!contour?.closed) return false;
  const points: Point[] = [];
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  const vertices = new Map(
    network.vertices.map((vertex) => [vertex.id, vertex]),
  );
  for (const reference of contour.references) {
    const curve = directedCurve(
      segments.get(reference.segmentId)!,
      reference,
      vertices,
    );
    if (points.length === 0) points.push(curve.start);
    const subdivisions =
      meaningful(curve.tangentStart) || meaningful(curve.tangentEnd) ? 24 : 1;
    for (let index = 1; index <= subdivisions; index += 1) {
      points.push(editableCurvePoint(curve, index / subdivisions));
    }
  }
  let inside = false;
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index++
  ) {
    const currentPoint = points[index]!;
    const previousPoint = points[previous]!;
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function partitionLoopSide(
  network: VectorNetwork,
  pathId: string,
  lineStart: Point,
  lineEnd: Point,
): LineSide | null {
  const contour = editableContour(network, pathId);
  if (!contour) return null;
  for (
    let parameter = 0;
    parameter < contour.references.length;
    parameter += 0.25
  ) {
    const value = signedLineDistance(
      lineStart,
      lineEnd,
      contourPointAt(network, contour, parameter),
    );
    if (Math.abs(value) > LINE_CUT_SIDE_EPSILON) return value > 0 ? 1 : -1;
  }
  return null;
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

function endpointContour(
  network: VectorNetwork,
  vertexId: string,
): EditableContour | null {
  return (
    editableContours(network).find(
      (contour) =>
        !contour.closed &&
        (contour.vertexIds[0] === vertexId ||
          contour.vertexIds.at(-1) === vertexId),
    ) ?? null
  );
}

function referencesWithEndpoint(
  contour: EditableContour,
  vertexId: string,
  position: "start" | "end",
): VectorSegmentReference[] | null {
  const atStart = contour.vertexIds[0] === vertexId;
  const atEnd = contour.vertexIds.at(-1) === vertexId;
  if (!atStart && !atEnd) return null;
  const alreadyOriented = position === "start" ? atStart : atEnd;
  return alreadyOriented
    ? contour.references.map((reference) => ({ ...reference }))
    : [...contour.references].reverse().map((reference) => ({
        segmentId: reference.segmentId,
        reversed: !reference.reversed,
      }));
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
