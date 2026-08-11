import type {
  Point,
  VectorNetwork,
  VectorPointMode,
  VectorSegment,
  VectorSegmentReference,
} from "@opendesign/design-contracts";
import {
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
  | "missing-vertex"
  | "unsupported-topology";

export type VectorEditResult =
  | { ok: true; network: VectorNetwork }
  | { ok: false; code: VectorEditFailureCode; message: string };

export type VectorDeleteResult =
  | { ok: true; deleteNode: true }
  | { ok: true; deleteNode: false; network: VectorNetwork }
  | { ok: false; code: VectorEditFailureCode; message: string };

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
  if (network.paths.length !== 1) {
    return {
      editable: false,
      reason: "This editing slice supports one contour at a time",
    };
  }
  if (vectorNetworkHasBranches(network)) {
    return {
      editable: false,
      reason: "Branching vector networks require the branch editing slice",
    };
  }
  return { editable: true };
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
  const contour = editableContour(network);
  if (!contour) return unsupportedTopology();
  const selected = new Set(vertexIds);
  if (selected.size === 0)
    return missingVertex("No vector vertices are selected");
  if ([...selected].some((vertexId) => !contour.vertexIds.includes(vertexId))) {
    return missingVertex(
      "A selected vector vertex does not exist in the editable contour",
    );
  }
  const remaining = contour.vertexIds.filter(
    (vertexId) => !selected.has(vertexId),
  );
  if (remaining.length < (contour.closed ? 3 : 2))
    return { ok: true, deleteNode: true };

  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  const retainedReferences: VectorSegmentReference[] = [];
  const retainedSegments: VectorSegment[] = [];
  const usedIds = new Set(network.segments.map((segment) => segment.id));
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
      retainedReferences.push({ ...original.reference });
      retainedSegments.push(
        structuredClone(segments.get(original.reference.segmentId)!),
      );
      continue;
    }
    const id = nextSegmentId(usedIds);
    usedIds.add(id);
    retainedSegments.push({ id, startVertexId, endVertexId });
    retainedReferences.push({ segmentId: id, reversed: false });
  }

  const next: VectorNetwork = {
    vertices: network.vertices
      .filter((vertex) => remaining.includes(vertex.id))
      .map((vertex) => {
        const nextVertex = structuredClone(vertex);
        delete nextVertex.handleMode;
        return nextVertex;
      }),
    segments: retainedSegments,
    paths: [
      {
        ...structuredClone(network.paths[0]!),
        segments: retainedReferences,
      },
    ],
    regions: structuredClone(network.regions),
  };
  next.vertices = next.vertices.map((vertex) => ({
    ...vertex,
    handleMode: inferVectorPointMode(next, vertex.id),
  }));
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

function editableContour(network: VectorNetwork): EditableContour | null {
  if (!vectorNetworkEditability(network).editable) return null;
  const path = network.paths[0]!;
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
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
}

function contourHandles(
  network: VectorNetwork,
  vertexId: string,
): ContourHandleReference[] | null {
  const contour = editableContour(network);
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
  const contour = editableContour(network)!;
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

function missingHandle(
  message: string,
): Extract<VectorEditResult, { ok: false }> {
  return { ok: false, code: "missing-handle", message };
}

function unsupportedTopology(): Extract<VectorEditResult, { ok: false }> {
  return {
    ok: false,
    code: "unsupported-topology",
    message: "This editing slice supports one non-branching contour",
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

function normalizePoint(point: Point): Point {
  return { x: normalizeNumber(point.x), y: normalizeNumber(point.y) };
}

function normalizeNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
