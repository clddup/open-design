import type {
  DesignDocument,
  DesignNode,
  Rect,
  Transform,
  ViewportState,
} from "@opendesign/design-contracts";
import {
  createSnapTargetIndex,
  resolveMoveSnapping,
  type SnapGuideLine,
  type SnapTarget,
  type SnapTargetIndex,
} from "@opendesign/geometry-service/snapping";
import { multiplyTransforms, transformPoint } from "./scene-node-transform.js";
import type { LeaferSnapSettings } from "./types.js";

interface MoveSnapSession {
  correction: { x: number; y: number };
  nodeIds: readonly string[];
  pageGuides: readonly SnapTarget[];
  pixelGrid: boolean;
  targets: SnapTargetIndex;
  threshold: number;
}

export interface DirectMoveSnapInput {
  document: DesignDocument;
  excludedNodeIds: ReadonlySet<string>;
  nodeIds: readonly string[];
  pageId: string;
  rulerGuidesVisible: boolean;
  settings: LeaferSnapSettings;
  viewport: ViewportState;
}

export class DirectMoveSnapController {
  readonly #onLines: (lines: readonly SnapGuideLine[]) => void;
  readonly #selectionBounds: (nodeIds: readonly string[]) => Rect | null;
  #session: MoveSnapSession | null = null;
  #suppressed = false;
  readonly #translate: (
    nodeIds: readonly string[],
    delta: { x: number; y: number },
  ) => boolean;

  constructor(options: {
    onLines: (lines: readonly SnapGuideLine[]) => void;
    selectionBounds: (nodeIds: readonly string[]) => Rect | null;
    translate: (
      nodeIds: readonly string[],
      delta: { x: number; y: number },
    ) => boolean;
  }) {
    this.#onLines = options.onLines;
    this.#selectionBounds = options.selectionBounds;
    this.#translate = options.translate;
  }

  begin(input: DirectMoveSnapInput): void {
    const targets = buildSnapTargets(input);
    this.#session = {
      correction: { x: 0, y: 0 },
      nodeIds: input.nodeIds,
      pageGuides: targets.filter(({ id }) => id.startsWith("page:")),
      pixelGrid: input.settings.pixelGrid,
      targets: createSnapTargetIndex(targets),
      threshold: 5 / Math.max(input.viewport.zoom, 0.000_001),
    };
    this.#onLines([]);
  }

  update(): void {
    const session = this.#session;
    if (!session) {
      this.#onLines([]);
      return;
    }
    // Leafer resolves every drag event from the drag start and compensates for
    // the element's current snapped position before emitting editor.move. The
    // current transform is therefore already the raw pointer result here.
    session.correction = { x: 0, y: 0 };
    this.#resolveCurrentRaw(session);
  }

  refresh(input: DirectMoveSnapInput): void {
    const session = this.#session;
    if (!session || !this.#removeCorrection(session)) {
      this.#onLines([]);
      return;
    }
    const targets = buildSnapTargets(input);
    session.nodeIds = input.nodeIds;
    session.pageGuides = targets.filter(({ id }) => id.startsWith("page:"));
    session.pixelGrid = input.settings.pixelGrid;
    session.targets = createSnapTargetIndex(targets);
    session.threshold = 5 / Math.max(input.viewport.zoom, 0.000_001);
    this.#resolveCurrentRaw(session);
  }

  syncViewport(viewport: ViewportState): void {
    const session = this.#session;
    if (!session) return;
    session.threshold = 5 / Math.max(viewport.zoom, 0.000_001);
    const view = viewportDocumentBounds(viewport);
    session.pageGuides.forEach((guide) => {
      guide.range =
        guide.axis === "x"
          ? { start: view.top, end: view.bottom }
          : { start: view.left, end: view.right };
    });
  }

  #resolveCurrentRaw(session: MoveSnapSession): void {
    const selection = this.#selectionBounds(session.nodeIds);
    if (!selection) {
      this.#onLines([]);
      return;
    }
    const resolution = resolveMoveSnapping({
      pixelGrid: session.pixelGrid,
      selection,
      targets: this.#suppressed ? { x: [], y: [] } : session.targets,
      threshold: session.threshold,
    });
    if (
      (resolution.delta.x !== 0 || resolution.delta.y !== 0) &&
      !this.#translate(session.nodeIds, resolution.delta)
    ) {
      this.#onLines([]);
      return;
    }
    session.correction = resolution.delta;
    this.#onLines(resolution.lines);
  }

  setSuppressed(suppressed: boolean): void {
    if (this.#suppressed === suppressed) return;
    this.#suppressed = suppressed;
    const session = this.#session;
    if (!session || !this.#removeCorrection(session)) {
      this.#onLines([]);
      return;
    }
    this.#resolveCurrentRaw(session);
  }

  finish(): void {
    this.#session = null;
    this.#onLines([]);
  }

  cancel(): void {
    this.#session = null;
    this.#onLines([]);
  }

  #removeCorrection(session: MoveSnapSession): boolean {
    const correction = session.correction;
    session.correction = { x: 0, y: 0 };
    if (correction.x === 0 && correction.y === 0) return true;
    return this.#translate(session.nodeIds, {
      x: -correction.x,
      y: -correction.y,
    });
  }
}

function buildSnapTargets(input: DirectMoveSnapInput): SnapTarget[] {
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
    : [];
  return [...guideTargets, ...objectTargets];
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
): SnapTarget[] {
  const page = document.pagesById[pageId];
  if (!page) return [];
  const view = viewportDocumentBounds(viewport);
  const pageTargets = (page.guides ?? []).map((guide, index) =>
    guide.axis === "X"
      ? guideTarget("x", `page:${index}`, guide.offset, view.top, view.bottom)
      : guideTarget("y", `page:${index}`, guide.offset, view.left, view.right),
  );
  const frameTargets = commonAncestorFrameIds(document, movingNodeIds).flatMap(
    (nodeId) => {
      const node = document.nodesById[nodeId];
      if (!node || node.kind !== "frame") return [];
      const transform = worldTransforms.get(nodeId);
      if (!transform) return [];
      return (node.properties.guides ?? []).flatMap((guide, index) => {
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
        return orthogonalGuideTarget(`${nodeId}:${index}`, start, end);
      });
    },
  );
  return [...pageTargets, ...frameTargets];
}

function viewportDocumentBounds(viewport: ViewportState) {
  return {
    left: -viewport.panX / viewport.zoom,
    top: -viewport.panY / viewport.zoom,
    right: (viewport.width - viewport.panX) / viewport.zoom,
    bottom: (viewport.height - viewport.panY) / viewport.zoom,
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

function orthogonalGuideTarget(
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
): SnapTarget[] {
  if (Math.abs(start.x - end.x) <= 0.000_001) {
    return [guideTarget("x", id, start.x, start.y, end.y)];
  }
  if (Math.abs(start.y - end.y) <= 0.000_001) {
    return [guideTarget("y", id, start.y, start.x, end.x)];
  }
  return [];
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
