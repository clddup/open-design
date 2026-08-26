import type {
  DesignDocument,
  DesignNode,
  Rect,
  Transform,
} from "@opendesign/design-contracts";
import {
  analyzeSmartSelection,
  type ArrangeAxis,
  type ArrangementItem,
  type TidyUpDimension,
} from "@opendesign/geometry-service";
import { effectivelyLockedForEditorOverlay } from "./editor-overlay-support.js";
import {
  getVisibleWorldTransform,
  transformPoint,
} from "./scene-node-transform.js";

export const MAX_SMART_SELECTION_ITEMS = 512;

export interface SmartSelectionGapHandleSpec {
  axis: ArrangeAxis;
  id: string;
  value: number;
  x: number;
  y: number;
}

export interface SmartSelectionRingSpec {
  id: string;
  nodeId: string;
  x: number;
  y: number;
}

export interface SmartSelectionOverlayPlan {
  bounds: Rect;
  dimension: TidyUpDimension;
  documentId: string;
  handles: readonly SmartSelectionGapHandleSpec[];
  items: readonly ArrangementItem[];
  nodeIds: readonly string[];
  pageId: string;
  revision: number;
  rings: readonly SmartSelectionRingSpec[];
}

export function createSmartSelectionOverlayPlan(
  document: DesignDocument,
  pageId: string,
  selectedNodeIds: readonly string[],
): SmartSelectionOverlayPlan | null {
  if (!document.pagesById[pageId]) return null;
  const uniqueSelectedNodeIds = [...new Set(selectedNodeIds)];
  const nodeIds = topLevelSelection(document, selectedNodeIds);
  if (
    nodeIds.length !== uniqueSelectedNodeIds.length ||
    nodeIds.length < 2 ||
    nodeIds.length > MAX_SMART_SELECTION_ITEMS
  ) {
    return null;
  }
  const items: ArrangementItem[] = [];
  for (const nodeId of nodeIds) {
    const node = document.nodesById[nodeId];
    if (
      !node ||
      !nodeBelongsToPage(document, pageId, nodeId) ||
      !node.visible ||
      effectivelyLockedForEditorOverlay(document, nodeId) ||
      isAutoLayoutFlowChild(document, node)
    ) {
      return null;
    }
    const bounds = nodeWorldBounds(document, node);
    if (!bounds) return null;
    items.push({ id: nodeId, bounds });
  }
  const analysis = analyzeSmartSelection(items);
  if (!analysis.ok) return null;
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const handles: SmartSelectionGapHandleSpec[] = [];
  if (analysis.horizontalSpacing !== undefined) {
    for (const [rowIndex, row] of analysis.rows.entries()) {
      handles.push(
        ...gapHandles(
          row,
          byId,
          "horizontal",
          analysis.horizontalSpacing,
          `row-${rowIndex}`,
        ),
      );
    }
  }
  if (analysis.verticalSpacing !== undefined) {
    for (const [columnIndex, column] of analysis.columns.entries()) {
      handles.push(
        ...gapHandles(
          column,
          byId,
          "vertical",
          analysis.verticalSpacing,
          `column-${columnIndex}`,
        ),
      );
    }
  }
  if (handles.length === 0) return null;
  const bounds = unionBounds(items.map((item) => item.bounds));
  return {
    bounds,
    dimension: analysis.dimension,
    documentId: document.documentId,
    handles,
    items,
    nodeIds: analysis.orderedIds,
    pageId,
    revision: document.revision,
    rings: items.map((item) => ({
      id: `smart-ring:${item.id}`,
      nodeId: item.id,
      x: item.bounds.x + item.bounds.width / 2,
      y: item.bounds.y + item.bounds.height / 2,
    })),
  };
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const page = document.pagesById[pageId];
  const visited = new Set<string>();
  let node = document.nodesById[nodeId];
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    if (node.parentId === null)
      return page?.rootNodeIds.includes(node.id) ?? false;
    node = document.nodesById[node.parentId];
  }
  return false;
}

function gapHandles(
  ids: readonly string[],
  byId: ReadonlyMap<string, ArrangementItem>,
  axis: ArrangeAxis,
  value: number,
  scope: string,
): SmartSelectionGapHandleSpec[] {
  const handles: SmartSelectionGapHandleSpec[] = [];
  ids.slice(1).forEach((id, index) => {
    const previous = byId.get(ids[index]!);
    const current = byId.get(id);
    if (!previous || !current) return;
    if (axis === "horizontal") {
      const overlapStart = Math.max(previous.bounds.y, current.bounds.y);
      const overlapEnd = Math.min(
        previous.bounds.y + previous.bounds.height,
        current.bounds.y + current.bounds.height,
      );
      handles.push({
        axis,
        id: `smart-gap:${axis}:${scope}:${index}`,
        value,
        x: (previous.bounds.x + previous.bounds.width + current.bounds.x) / 2,
        y: (overlapStart + overlapEnd) / 2,
      });
      return;
    }
    const overlapStart = Math.max(previous.bounds.x, current.bounds.x);
    const overlapEnd = Math.min(
      previous.bounds.x + previous.bounds.width,
      current.bounds.x + current.bounds.width,
    );
    handles.push({
      axis,
      id: `smart-gap:${axis}:${scope}:${index}`,
      value,
      x: (overlapStart + overlapEnd) / 2,
      y: (previous.bounds.y + previous.bounds.height + current.bounds.y) / 2,
    });
  });
  return handles;
}

function nodeWorldBounds(
  document: DesignDocument,
  node: DesignNode,
): Rect | null {
  const transform = getVisibleWorldTransform(document.nodesById, node.id);
  if (!transform) return null;
  const points = [
    transformPoint({ x: 0, y: 0 }, transform),
    transformPoint({ x: node.size.width, y: 0 }, transform),
    transformPoint({ x: 0, y: node.size.height }, transform),
    transformPoint({ x: node.size.width, y: node.size.height }, transform),
  ];
  if (points.some((point) => !Number.isFinite(point.x + point.y))) return null;
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function unionBounds(bounds: readonly Rect[]): Rect {
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function topLevelSelection(
  document: DesignDocument,
  nodeIds: readonly string[],
): string[] {
  const selected = new Set(nodeIds);
  return [...selected].filter((nodeId) => {
    let parentId = document.nodesById[nodeId]?.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = document.nodesById[parentId]?.parentId ?? null;
    }
    return true;
  });
}

function isAutoLayoutFlowChild(
  document: DesignDocument,
  node: DesignNode,
): boolean {
  if (!node.parentId || node.layoutPositioning === "absolute") return false;
  const parent = document.nodesById[node.parentId];
  const autoLayout =
    parent?.kind === "frame" || parent?.kind === "slot"
      ? parent.properties.autoLayout
      : undefined;
  return autoLayout !== undefined && autoLayout.mode !== "none";
}

export function documentDeltaToNodeParent(
  document: DesignDocument,
  nodeId: string,
  delta: { x: number; y: number },
): { x: number; y: number } | null {
  const parentId = document.nodesById[nodeId]?.parentId;
  if (!parentId) return delta;
  const transform = getVisibleWorldTransform(document.nodesById, parentId);
  const inverse = transform ? inverseLinear(transform) : null;
  return inverse
    ? {
        x: inverse[0] * delta.x + inverse[2] * delta.y,
        y: inverse[1] * delta.x + inverse[3] * delta.y,
      }
    : null;
}

function inverseLinear(transform: Transform): Transform | null {
  const [a, b, c, d] = transform;
  const determinant = a * d - b * c;
  if (
    !Number.isFinite(determinant) ||
    Math.abs(determinant) <= Number.EPSILON
  ) {
    return null;
  }
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    0,
    0,
  ];
}
