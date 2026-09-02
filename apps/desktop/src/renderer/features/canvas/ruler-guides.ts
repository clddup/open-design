import type {
  DesignDocument,
  DesignNode,
  Guide,
  Point,
  SelectionState,
  ViewportState,
} from "@opendesign/design-contracts";
import {
  documentToScreen,
  getWorldTransform,
  invertTransform,
  isEffectivelyLocked,
  planEditGuide,
  screenToDocument,
  transformPoint,
  type EditorRuntime,
} from "@opendesign/editor-runtime";

export const RULER_SIZE = 20;

export type RulerGuideOwner =
  | { type: "page"; pageId: string }
  | { type: "frame"; pageId: string; frameId: string };

export interface RulerGuideReference {
  guide: Guide;
  index: number;
  owner: RulerGuideOwner;
}

export interface RulerGuideEdit {
  duplicate: boolean;
  expectedRevision: number;
  source?: RulerGuideReference;
  target?: { guide: Guide; owner: RulerGuideOwner };
}

export type RulerGuideCommitResult =
  | { ok: true }
  | {
      ok: false;
      code: "invalid-target" | "locked" | "not-found" | "runtime" | "stale";
      message?: string;
    };

export interface RulerGuideSegment extends RulerGuideReference {
  end: Point;
  key: string;
  locked: boolean;
  start: Point;
}

export interface RulerTick {
  major: boolean;
  position: number;
  value: number;
}

export function commitRulerGuideEdit(
  runtime: EditorRuntime,
  edit: RulerGuideEdit,
  transactionId: string,
  label: string,
): RulerGuideCommitResult {
  const current = runtime.getSnapshot();
  if (current.document.revision !== edit.expectedRevision) {
    return { ok: false, code: "stale" };
  }
  const plan = planEditGuide(
    current.document,
    edit,
    `${transactionId}_command`,
  );
  if (!plan.ok) {
    return plan.code === "no-op"
      ? { ok: true }
      : { ok: false, code: plan.code, message: plan.message };
  }
  const result = runtime.apply({
    transactionId,
    documentId: current.document.documentId,
    baseRevision: current.document.revision,
    actor: { type: "user", id: "local-user" },
    label,
    commands: plan.commands,
  });
  return result.ok
    ? { ok: true }
    : { ok: false, code: "runtime", message: result.error.message };
}

export function selectionRulerRanges(
  document: DesignDocument,
  selection: SelectionState,
  viewport: ViewportState,
): { x: readonly [number, number]; y: readonly [number, number] } | null {
  if (selection.componentTarget || selection.nodeIds.length === 0) return null;
  const points = selection.nodeIds.flatMap((nodeId) => {
    const node = document.nodesById[nodeId];
    const world = getWorldTransform(document, nodeId);
    if (!node || !world) return [];
    return [
      { x: 0, y: 0 },
      { x: node.size.width, y: 0 },
      { x: node.size.width, y: node.size.height },
      { x: 0, y: node.size.height },
    ].map((point) => documentToScreen(transformPoint(point, world), viewport));
  });
  if (points.length === 0) return null;
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  return {
    x: [Math.min(...xs), Math.max(...xs)],
    y: [Math.min(...ys), Math.max(...ys)],
  };
}

export function collectRulerGuideSegments(
  document: DesignDocument,
  pageId: string,
  viewport: ViewportState,
): RulerGuideSegment[] {
  const page = document.pagesById[pageId];
  if (!page) return [];
  const pageSegments = (page.guides ?? []).flatMap((guide, index) => {
    const segment = pageGuideSegment(guide, viewport);
    return segmentIntersectsViewport(segment, viewport)
      ? [
          {
            ...segment,
            guide,
            index,
            key: `page:${pageId}:${index}`,
            locked: false,
            owner: { type: "page" as const, pageId },
          },
        ]
      : [];
  });
  const pageRootNodeIds = new Set(page.rootNodeIds);
  const frameSegments = Object.values(document.nodesById).flatMap((node) => {
    if (
      node.kind !== "frame" ||
      !node.properties.guides?.length ||
      !belongsToPage(document, pageRootNodeIds, node.id) ||
      !isEffectivelyVisible(document, node.id)
    ) {
      return [];
    }
    return (node.properties.guides ?? []).flatMap((guide, index) => {
      const segment = frameGuideSegment(document, node.id, guide, viewport);
      return segment && segmentIntersectsViewport(segment, viewport)
        ? [
            {
              ...segment,
              guide,
              index,
              key: `frame:${node.id}:${index}`,
              locked: isEffectivelyLocked(document, node.id),
              owner: { type: "frame" as const, pageId, frameId: node.id },
            },
          ]
        : [];
    });
  });
  return [...pageSegments, ...frameSegments];
}

function segmentIntersectsViewport(
  segment: { start: Point; end: Point },
  viewport: ViewportState,
): boolean {
  const overscan = 10;
  return (
    Math.max(segment.start.x, segment.end.x) >= -overscan &&
    Math.min(segment.start.x, segment.end.x) <= viewport.width + overscan &&
    Math.max(segment.start.y, segment.end.y) >= -overscan &&
    Math.min(segment.start.y, segment.end.y) <= viewport.height + overscan
  );
}

export function resolveActiveGuideFrameId(
  document: DesignDocument,
  selection: SelectionState,
): string | undefined {
  if (selection.componentTarget || selection.nodeIds.length !== 1)
    return undefined;
  let node: DesignNode | undefined =
    document.nodesById[selection.nodeIds[0] ?? ""];
  const visited = new Set<string>();
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    if (node.kind === "frame") return node.id;
    node = node.parentId ? document.nodesById[node.parentId] : undefined;
  }
  return undefined;
}

export function guidePlacementAtScreenPoint(
  document: DesignDocument,
  pageId: string,
  viewport: ViewportState,
  axis: Guide["axis"],
  point: Point,
  frameId?: string,
): { guide: Guide; owner: RulerGuideOwner } {
  const documentPoint = screenToDocument(point, viewport);
  if (frameId) {
    const frame = document.nodesById[frameId];
    const world = getWorldTransform(document, frameId);
    const inverse = world ? invertTransform(world) : null;
    if (frame?.kind === "frame" && inverse) {
      const local = transformPoint(documentPoint, inverse);
      if (
        local.x >= 0 &&
        local.x <= frame.size.width &&
        local.y >= 0 &&
        local.y <= frame.size.height
      ) {
        return {
          guide: { axis, offset: axis === "X" ? local.x : local.y },
          owner: { type: "frame", pageId, frameId },
        };
      }
    }
  }
  return {
    guide: { axis, offset: axis === "X" ? documentPoint.x : documentPoint.y },
    owner: { type: "page", pageId },
  };
}

export function guideSegmentForPlacement(
  document: DesignDocument,
  owner: RulerGuideOwner,
  guide: Guide,
  viewport: ViewportState,
): { start: Point; end: Point } | null {
  return owner.type === "page"
    ? pageGuideSegment(guide, viewport)
    : frameGuideSegment(document, owner.frameId, guide, viewport);
}

export function rulerTicks(
  axis: Guide["axis"],
  viewport: ViewportState,
): RulerTick[] {
  const extent = axis === "X" ? viewport.width : viewport.height;
  const pan = axis === "X" ? viewport.panX : viewport.panY;
  const majorStep = majorDocumentStep(viewport.zoom);
  const minorStep = majorStep / 10;
  const first = Math.floor((0 - pan) / viewport.zoom / minorStep) * minorStep;
  const last = (extent - pan) / viewport.zoom;
  const ticks: RulerTick[] = [];
  for (
    let value = first, index = 0;
    value <= last && index < 500;
    value += minorStep, index += 1
  ) {
    const normalized = Math.round(value / minorStep) * minorStep;
    const major =
      Math.abs(normalized / majorStep - Math.round(normalized / majorStep)) <
      0.000_001;
    ticks.push({
      major,
      position: normalized * viewport.zoom + pan,
      value: normalized,
    });
  }
  return ticks;
}

export function guideOwnerKey(owner: RulerGuideOwner): string {
  return owner.type === "page"
    ? `page:${owner.pageId}`
    : `frame:${owner.frameId}`;
}

function pageGuideSegment(guide: Guide, viewport: ViewportState) {
  if (guide.axis === "X") {
    const x = guide.offset * viewport.zoom + viewport.panX;
    return { start: { x, y: RULER_SIZE }, end: { x, y: viewport.height } };
  }
  const y = guide.offset * viewport.zoom + viewport.panY;
  return { start: { x: RULER_SIZE, y }, end: { x: viewport.width, y } };
}

function frameGuideSegment(
  document: DesignDocument,
  frameId: string,
  guide: Guide,
  viewport: ViewportState,
): { start: Point; end: Point } | null {
  const frame = document.nodesById[frameId];
  const world = getWorldTransform(document, frameId);
  if (frame?.kind !== "frame" || !world) return null;
  const localStart =
    guide.axis === "X" ? { x: guide.offset, y: 0 } : { x: 0, y: guide.offset };
  const localEnd =
    guide.axis === "X"
      ? { x: guide.offset, y: frame.size.height }
      : { x: frame.size.width, y: guide.offset };
  return {
    start: documentToScreen(transformPoint(localStart, world), viewport),
    end: documentToScreen(transformPoint(localEnd, world), viewport),
  };
}

function majorDocumentStep(zoom: number): number {
  const desired = 80 / zoom;
  const power = 10 ** Math.floor(Math.log10(desired));
  const scaled = desired / power;
  const factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return factor * power;
}

function belongsToPage(
  document: DesignDocument,
  pageRootNodeIds: ReadonlySet<string>,
  nodeId: string,
): boolean {
  let node: DesignNode | undefined = document.nodesById[nodeId];
  const visited = new Set<string>();
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    if (node.parentId === null) return pageRootNodeIds.has(node.id);
    node = document.nodesById[node.parentId];
  }
  return false;
}

function isEffectivelyVisible(
  document: DesignDocument,
  nodeId: string,
): boolean {
  let node: DesignNode | undefined = document.nodesById[nodeId];
  const visited = new Set<string>();
  while (node && !visited.has(node.id)) {
    if (!node.visible) return false;
    visited.add(node.id);
    node = node.parentId ? document.nodesById[node.parentId] : undefined;
  }
  return true;
}
