import type {
  DesignDocument,
  DesignNode,
  Guide,
  Point,
  Rect,
  SelectionState,
  ViewportState,
} from "@opendesign/design-contracts";
import {
  getWorldTransform,
  screenToDocument,
  transformPoint,
} from "@opendesign/editor-runtime";
import {
  measureGuideToRect,
  type DistanceMeasurementSegment,
} from "@opendesign/geometry-service/measurements";
import { nodeDocumentBounds, type RulerGuideOwner } from "./ruler-guides";

export type RulerGuideDistanceMeasurement = DistanceMeasurementSegment;

export function collectRulerGuideDistanceMeasurements(
  document: DesignDocument,
  pageId: string,
  selection: SelectionState,
  placement: { guide: Guide; owner: RulerGuideOwner },
  screenPoint: Point,
  viewport: ViewportState,
): RulerGuideDistanceMeasurement[] {
  const frameId = resolveTopLevelSelectedFrameId(document, pageId, selection);
  if (!frameId) return [];
  const frame = document.nodesById[frameId];
  const frameBounds = nodeDocumentBounds(document, frameId);
  const frameWorld = getWorldTransform(document, frameId);
  const axis = placement.guide.axis === "X" ? "x" : "y";
  const guidePosition = guideDocumentPosition(document, placement, axis);
  if (
    frame?.kind !== "frame" ||
    !frameBounds ||
    !axisAligned(frameWorld) ||
    guidePosition === null
  ) {
    return [];
  }
  const documentPoint = screenToDocument(screenPoint, viewport);
  const crossPosition = axis === "x" ? documentPoint.y : documentPoint.x;
  const frameMeasurements = measureGuideToRect({
    axis,
    crossPosition: clampToCrossBounds(axis, crossPosition, frameBounds),
    id: `frame:${frameId}`,
    position: guidePosition,
    target: frameBounds,
  });
  if (!positionInside(axis, guidePosition, frameBounds)) {
    return [...frameMeasurements];
  }
  const objectMeasurements = nearestGuideObjects(
    document,
    frame,
    axis,
    guidePosition,
    crossPosition,
  ).flatMap(({ bounds, nodeId }) =>
    measureGuideToRect({
      axis,
      id: `node:${nodeId}`,
      position: guidePosition,
      target: bounds,
    }),
  );
  return [...frameMeasurements, ...objectMeasurements];
}

function axisAligned(transform: ReturnType<typeof getWorldTransform>): boolean {
  return Boolean(
    transform &&
    Math.abs(transform[1]) <= 0.000_001 &&
    Math.abs(transform[2]) <= 0.000_001,
  );
}

function resolveTopLevelSelectedFrameId(
  document: DesignDocument,
  pageId: string,
  selection: SelectionState,
): string | undefined {
  if (selection.componentTarget || selection.nodeIds.length !== 1) {
    return undefined;
  }
  const nodeId = selection.nodeIds[0];
  const node = nodeId ? document.nodesById[nodeId] : undefined;
  return node?.kind === "frame" &&
    node.parentId === null &&
    document.pagesById[pageId]?.rootNodeIds.includes(node.id)
    ? node.id
    : undefined;
}

function guideDocumentPosition(
  document: DesignDocument,
  placement: { guide: Guide; owner: RulerGuideOwner },
  axis: "x" | "y",
): number | null {
  if (placement.owner.type === "page") return placement.guide.offset;
  const world = getWorldTransform(document, placement.owner.frameId);
  if (
    !world ||
    Math.abs(world[1]) > 0.000_001 ||
    Math.abs(world[2]) > 0.000_001
  ) {
    return null;
  }
  const point = transformPoint(
    placement.guide.axis === "X"
      ? { x: placement.guide.offset, y: 0 }
      : { x: 0, y: placement.guide.offset },
    world,
  );
  return axis === "x" ? point.x : point.y;
}

function nearestGuideObjects(
  document: DesignDocument,
  frame: Extract<DesignNode, { kind: "frame" }>,
  axis: "x" | "y",
  guidePosition: number,
  crossPosition: number,
): { bounds: Rect; nodeId: string }[] {
  const candidates = frame.childIds.flatMap((nodeId) => {
    const node = document.nodesById[nodeId];
    const world = getWorldTransform(document, nodeId);
    const bounds =
      node?.visible && axisAligned(world)
        ? nodeDocumentBounds(document, nodeId)
        : null;
    return bounds && positionInside(crossAxis(axis), crossPosition, bounds)
      ? [{ bounds, nodeId }]
      : [];
  });
  const before = nearestBy(candidates, (bounds) => {
    const end = axisEnd(axis, bounds);
    return end < guidePosition ? guidePosition - end : null;
  });
  const after = nearestBy(candidates, (bounds) => {
    const start = axisStart(axis, bounds);
    return start > guidePosition ? start - guidePosition : null;
  });
  const containing = [...candidates]
    .reverse()
    .find(({ bounds }) => positionInside(axis, guidePosition, bounds));
  const unique = new Map<string, { bounds: Rect; nodeId: string }>();
  for (const candidate of [before, containing, after]) {
    if (candidate) unique.set(candidate.nodeId, candidate);
  }
  return [...unique.values()];
}

function nearestBy(
  candidates: readonly { bounds: Rect; nodeId: string }[],
  distance: (bounds: Rect) => number | null,
) {
  let nearest: { bounds: Rect; nodeId: string } | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const value = distance(candidate.bounds);
    if (value !== null && value < nearestDistance) {
      nearest = candidate;
      nearestDistance = value;
    }
  }
  return nearest;
}

function clampToCrossBounds(
  axis: "x" | "y",
  value: number,
  bounds: Rect,
): number {
  const cross = crossAxis(axis);
  return Math.min(
    Math.max(value, axisStart(cross, bounds)),
    axisEnd(cross, bounds),
  );
}

function positionInside(axis: "x" | "y", value: number, bounds: Rect) {
  return value > axisStart(axis, bounds) && value < axisEnd(axis, bounds);
}

function crossAxis(axis: "x" | "y"): "x" | "y" {
  return axis === "x" ? "y" : "x";
}

function axisStart(axis: "x" | "y", bounds: Rect): number {
  return axis === "x" ? bounds.x : bounds.y;
}

function axisEnd(axis: "x" | "y", bounds: Rect): number {
  return (
    axisStart(axis, bounds) + (axis === "x" ? bounds.width : bounds.height)
  );
}
