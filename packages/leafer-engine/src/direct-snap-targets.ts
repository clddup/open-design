import type {
  DesignDocument,
  DesignNode,
  Rect,
  Transform,
  ViewportState,
} from "@opendesign/design-contracts";
import type { SnapTarget } from "@opendesign/geometry-service/snapping";
import type { DirectionalSnapTarget } from "@opendesign/geometry-service/directional-snapping";
import { multiplyTransforms, transformPoint } from "./scene-node-transform.js";
import type { LeaferSnapSettings } from "./types.js";

export interface DirectSnapTargetInput {
  document: DesignDocument;
  excludedNodeIds: ReadonlySet<string>;
  nodeIds: readonly string[];
  pageId: string;
  rulerGuidesVisible: boolean;
  settings: LeaferSnapSettings;
  viewport: ViewportState;
}

export interface DirectSnapTargets {
  axisTargets: readonly SnapTarget[];
  directionalGuides: readonly DirectionalSnapTarget[];
}

export function buildDirectSnapTargets(
  input: DirectSnapTargetInput,
): DirectSnapTargets {
  const entries = visiblePageNodeEntries(input.document, input.pageId);
  const objectTargets = input.settings.objects
    ? entries.flatMap(({ node, worldTransform }) =>
        input.excludedNodeIds.has(node.id)
          ? []
          : targetsForObject(node, worldTransform),
      )
    : [];
  const guideTargets = input.rulerGuidesVisible
    ? targetsForGuides(
        input.document,
        input.pageId,
        input.nodeIds,
        input.viewport,
        new Map(
          entries.map(({ node, worldTransform }) => [node.id, worldTransform]),
        ),
      )
    : { axisTargets: [], directionalGuides: [] };
  return {
    axisTargets: [...guideTargets.axisTargets, ...objectTargets],
    directionalGuides: guideTargets.directionalGuides,
  };
}

export function snapThreshold(viewport: ViewportState): number {
  return 5 / Math.max(viewport.zoom, 0.000_001);
}

export function viewportDocumentBounds(viewport: ViewportState) {
  return {
    left: -viewport.panX / viewport.zoom,
    top: -viewport.panY / viewport.zoom,
    right: (viewport.width - viewport.panX) / viewport.zoom,
    bottom: (viewport.height - viewport.panY) / viewport.zoom,
  };
}

function targetsForObject(
  node: DesignNode,
  transform: Transform,
): SnapTarget[] {
  const bounds = transformedBounds(node, transform);
  if (!bounds) return [];
  return [
    axisTarget("x", `${node.id}:left`, bounds.x, bounds.y, bounds.height),
    axisTarget(
      "x",
      `${node.id}:center-x`,
      bounds.x + bounds.width / 2,
      bounds.y,
      bounds.height,
    ),
    axisTarget(
      "x",
      `${node.id}:right`,
      bounds.x + bounds.width,
      bounds.y,
      bounds.height,
    ),
    axisTarget("y", `${node.id}:top`, bounds.y, bounds.x, bounds.width),
    axisTarget(
      "y",
      `${node.id}:center-y`,
      bounds.y + bounds.height / 2,
      bounds.x,
      bounds.width,
    ),
    axisTarget(
      "y",
      `${node.id}:bottom`,
      bounds.y + bounds.height,
      bounds.x,
      bounds.width,
    ),
  ];
}

function targetsForGuides(
  document: DesignDocument,
  pageId: string,
  movingNodeIds: readonly string[],
  viewport: ViewportState,
  worldTransforms: ReadonlyMap<string, Transform>,
): DirectSnapTargets {
  const page = document.pagesById[pageId];
  if (!page) return { axisTargets: [], directionalGuides: [] };
  const view = viewportDocumentBounds(viewport);
  const pageTargets = (page.guides ?? []).map((guide, index) =>
    guide.axis === "X"
      ? guideTarget("x", `page:${index}`, guide.offset, view.top, view.bottom)
      : guideTarget("y", `page:${index}`, guide.offset, view.left, view.right),
  );
  const frameTargets = commonAncestorFrameIds(document, movingNodeIds).map(
    (nodeId): DirectSnapTargets => {
      const node = document.nodesById[nodeId];
      if (!node || node.kind !== "frame") {
        return { axisTargets: [], directionalGuides: [] };
      }
      const transform = worldTransforms.get(nodeId);
      if (!transform) return { axisTargets: [], directionalGuides: [] };
      const targets = (node.properties.guides ?? []).map((guide, index) => {
        const start = transformPoint(
          guide.axis === "X"
            ? { x: guide.offset, y: 0 }
            : { x: 0, y: guide.offset },
          transform,
        );
        const end = transformPoint(
          guide.axis === "X"
            ? { x: guide.offset, y: node.size.height }
            : { x: node.size.width, y: guide.offset },
          transform,
        );
        return frameGuideTarget(`${nodeId}:${index}`, start, end);
      });
      return {
        axisTargets: targets.flatMap(({ axisTarget }) =>
          axisTarget ? [axisTarget] : [],
        ),
        directionalGuides: targets.flatMap(({ directionalTarget }) =>
          directionalTarget ? [directionalTarget] : [],
        ),
      };
    },
  );
  return {
    axisTargets: [
      ...pageTargets,
      ...frameTargets.flatMap(({ axisTargets }) => axisTargets),
    ],
    directionalGuides: frameTargets.flatMap(
      ({ directionalGuides }) => directionalGuides,
    ),
  };
}

function commonAncestorFrameIds(
  document: DesignDocument,
  nodeIds: readonly string[],
): string[] {
  const ancestorLists = nodeIds.map((nodeId) =>
    ancestorFrameIds(document, nodeId),
  );
  const first = ancestorLists[0] ?? [];
  return first.filter((frameId) =>
    ancestorLists.slice(1).every((ids) => ids.includes(frameId)),
  );
}

function ancestorFrameIds(document: DesignDocument, nodeId: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  let parentId = document.nodesById[nodeId]?.parentId ?? null;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = document.nodesById[parentId];
    if (!parent) break;
    if (parent.kind === "frame") result.push(parent.id);
    parentId = parent.parentId;
  }
  return result;
}

function frameGuideTarget(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): {
  axisTarget?: SnapTarget;
  directionalTarget?: DirectionalSnapTarget;
} {
  if (Math.abs(start.x - end.x) <= 0.000_001) {
    return { axisTarget: guideTarget("x", id, start.x, start.y, end.y) };
  }
  if (Math.abs(start.y - end.y) <= 0.000_001) {
    return { axisTarget: guideTarget("y", id, start.y, start.x, end.x) };
  }
  return {
    directionalTarget: { end, id, source: "guide", start },
  };
}

function axisTarget(
  axis: "x" | "y",
  id: string,
  position: number,
  rangeStart: number,
  rangeSize: number,
): SnapTarget {
  return {
    axis,
    id,
    position,
    range: { start: rangeStart, end: rangeStart + rangeSize },
    source: "object",
  };
}

function guideTarget(
  axis: "x" | "y",
  id: string,
  position: number,
  rangeStart: number,
  rangeEnd: number,
): SnapTarget {
  return {
    axis,
    id,
    position,
    range: {
      start: Math.min(rangeStart, rangeEnd),
      end: Math.max(rangeStart, rangeEnd),
    },
    source: "guide",
  };
}

function transformedBounds(
  node: DesignNode,
  transform: Transform,
): Rect | null {
  const corners = [
    transformPoint({ x: 0, y: 0 }, transform),
    transformPoint({ x: node.size.width, y: 0 }, transform),
    transformPoint({ x: 0, y: node.size.height }, transform),
    transformPoint({ x: node.size.width, y: node.size.height }, transform),
  ];
  const values = corners.flatMap(({ x, y }) => [x, y]);
  if (!values.every(Number.isFinite)) return null;
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

function visiblePageNodeEntries(
  document: DesignDocument,
  pageId: string,
): Array<{ node: DesignNode; worldTransform: Transform }> {
  const pending = (document.pagesById[pageId]?.rootNodeIds ?? []).map(
    (nodeId) => ({ nodeId, parentTransform: [1, 0, 0, 1, 0, 0] as Transform }),
  );
  const visited = new Set<string>();
  const result: Array<{ node: DesignNode; worldTransform: Transform }> = [];
  for (let index = 0; index < pending.length; index += 1) {
    const { nodeId, parentTransform } = pending[index]!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node || !node.visible) continue;
    const worldTransform = multiplyTransforms(parentTransform, node.transform);
    result.push({ node, worldTransform });
    pending.push(
      ...node.childIds.map((childId) => ({
        nodeId: childId,
        parentTransform: worldTransform,
      })),
    );
  }
  return result;
}
