import type {
  DesignDocument,
  DesignNode,
  Paint,
  Rect,
  Transform,
} from "@opendesign/design-contracts";
import {
  BOOLEAN_GEOMETRY_RESOLVER_VERSION,
  type BooleanGeometryResolution,
} from "@opendesign/geometry-service/boolean-resolver";
import type {
  SvgExportRequest,
  SvgResolvedBooleanPath,
} from "@opendesign/import-export-service";
import {
  getWorldTransform,
  multiplyTransforms,
  transformPoint,
} from "./geometry.js";

export const MAX_SVG_EXPORT_PADDING = 1_000_000;
export const MAX_SVG_EXPORT_TITLE_CHARACTERS = 512;

export interface SvgExportBooleanSnapshot {
  documentId: string;
  revision: number;
  resolution: BooleanGeometryResolution;
}

export interface SvgExportPlanInput {
  pageId: string;
  rootNodeIds: readonly string[];
  baseRevision: number;
  settings?: {
    includeLayerIds?: boolean;
    padding?: number;
    title?: string;
  };
  booleanSnapshot?: SvgExportBooleanSnapshot;
}

export type SvgExportPlanFailureCode =
  | "conflict"
  | "invalid-bounds"
  | "invalid-geometry"
  | "invalid-selection"
  | "invalid-settings"
  | "not-found"
  | "out-of-scope";

export type SvgExportPlan =
  | {
      ok: true;
      documentId: string;
      revision: number;
      pageId: string;
      rootNodeIds: string[];
      sourceBounds: Rect;
      request: SvgExportRequest;
    }
  | {
      ok: false;
      code: SvgExportPlanFailureCode;
      message: string;
    };

/**
 * Builds one origin-normalized SVG service request from explicit, stable
 * document targets. The caller may execute the pure request immediately or
 * discard it; no selection, file path, renderer object, or mutable export
 * state is captured by this planner.
 */
export function planSvgExportRequest(
  document: DesignDocument,
  input: SvgExportPlanInput,
): SvgExportPlan {
  if (input.baseRevision !== document.revision) {
    return failure(
      "conflict",
      `SVG export expected revision ${input.baseRevision}, current revision is ${document.revision}`,
    );
  }
  const page = document.pagesById[input.pageId];
  if (!page) return failure("not-found", `Page ${input.pageId} does not exist`);

  const settings = validateSettings(input.settings);
  if (!settings.ok) return settings;
  if (input.rootNodeIds.length === 0) {
    return failure(
      "invalid-selection",
      "SVG export requires at least one explicit root layer",
    );
  }
  const selected = new Set(input.rootNodeIds);
  if (selected.size !== input.rootNodeIds.length) {
    return failure(
      "invalid-selection",
      "SVG export root layer IDs must be unique",
    );
  }
  for (const nodeId of selected) {
    if (!document.nodesById[nodeId]) {
      return failure("not-found", `SVG export root ${nodeId} does not exist`);
    }
    if (!nodeBelongsToPage(document, input.pageId, nodeId)) {
      return failure(
        "out-of-scope",
        `SVG export root ${nodeId} is outside Page ${input.pageId}`,
      );
    }
    const selectedAncestor = firstSelectedAncestor(document, nodeId, selected);
    if (selectedAncestor) {
      return failure(
        "invalid-selection",
        `SVG export root ${nodeId} is already contained by selected root ${selectedAncestor}`,
      );
    }
  }

  const pageOrder = pagePaintOrder(document, input.pageId);
  const rootNodeIds = [...selected].sort(
    (left, right) =>
      (pageOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (pageOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
  const booleanNodeIds = collectRenderedBooleanNodeIds(document, rootNodeIds);
  const resolvedBooleanPaths = resolveBooleanSnapshot(
    document,
    input.pageId,
    booleanNodeIds,
    input.booleanSnapshot,
  );
  if (!resolvedBooleanPaths.ok) return resolvedBooleanPaths;

  const boundsContext: ExportBoundsContext = {
    document,
    resolvedBooleanPaths: resolvedBooleanPaths.paths,
    selectedFrameRoots: new Set(
      rootNodeIds.filter(
        (nodeId) => document.nodesById[nodeId]?.kind === "frame",
      ),
    ),
  };
  const sourceBounds = unionRects(
    rootNodeIds
      .map((nodeId) => renderedNodeBounds(boundsContext, nodeId))
      .filter((bounds): bounds is Rect => bounds !== null),
  );
  if (!sourceBounds || !isFinitePositiveRect(sourceBounds)) {
    return failure(
      "invalid-bounds",
      "SVG export selection does not have finite positive drawable bounds",
    );
  }

  const viewport: Rect = {
    x: 0,
    y: 0,
    width: sourceBounds.width + settings.padding * 2,
    height: sourceBounds.height + settings.padding * 2,
  };
  if (!isFinitePositiveRect(viewport)) {
    return failure(
      "invalid-bounds",
      "SVG export viewport exceeds finite supported dimensions",
    );
  }
  const normalizeToViewport: Transform = [
    1,
    0,
    0,
    1,
    -sourceBounds.x + settings.padding,
    -sourceBounds.y + settings.padding,
  ];
  const rootTransformEntries: Array<[string, Transform]> = [];
  for (const nodeId of rootNodeIds) {
    const world = getWorldTransform(document, nodeId);
    if (!world) {
      return failure(
        "invalid-bounds",
        `SVG export root ${nodeId} has an invalid world transform`,
      );
    }
    rootTransformEntries.push([
      nodeId,
      multiplyTransforms(normalizeToViewport, world),
    ]);
  }
  const rootTransformOverrides = Object.fromEntries(rootTransformEntries);

  const request: SvgExportRequest = {
    document,
    rootNodeIds,
    viewport,
    rootTransformOverrides,
    ...(settings.includeLayerIds ? { includeLayerIds: true } : {}),
    ...(settings.title === undefined ? {} : { title: settings.title }),
    ...(Object.keys(resolvedBooleanPaths.paths).length === 0
      ? {}
      : { resolvedBooleanPaths: resolvedBooleanPaths.paths }),
  };
  return {
    ok: true,
    documentId: document.documentId,
    revision: document.revision,
    pageId: input.pageId,
    rootNodeIds,
    sourceBounds,
    request,
  };
}

type ValidatedSettings =
  | {
      ok: true;
      includeLayerIds: boolean;
      padding: number;
      title?: string;
    }
  | Extract<SvgExportPlan, { ok: false }>;

function validateSettings(
  settings: SvgExportPlanInput["settings"],
): ValidatedSettings {
  const padding = settings?.padding ?? 0;
  if (
    !Number.isFinite(padding) ||
    padding < 0 ||
    padding > MAX_SVG_EXPORT_PADDING
  ) {
    return failure(
      "invalid-settings",
      `SVG export padding must be between 0 and ${MAX_SVG_EXPORT_PADDING}`,
    );
  }
  const title = settings?.title?.trim();
  if (title && title.length > MAX_SVG_EXPORT_TITLE_CHARACTERS) {
    return failure(
      "invalid-settings",
      `SVG export title exceeds ${MAX_SVG_EXPORT_TITLE_CHARACTERS} characters`,
    );
  }
  return {
    ok: true,
    includeLayerIds: settings?.includeLayerIds === true,
    padding,
    ...(title ? { title } : {}),
  };
}

type ResolvedBooleanPlan =
  | { ok: true; paths: Readonly<Record<string, SvgResolvedBooleanPath>> }
  | Extract<SvgExportPlan, { ok: false }>;

function resolveBooleanSnapshot(
  document: DesignDocument,
  pageId: string,
  booleanNodeIds: readonly string[],
  snapshot: SvgExportBooleanSnapshot | undefined,
): ResolvedBooleanPlan {
  if (booleanNodeIds.length === 0) return { ok: true, paths: {} };
  if (!snapshot) {
    return failure(
      "invalid-geometry",
      "SVG export selection contains Boolean layers but has no resolved geometry snapshot",
    );
  }
  if (
    snapshot.documentId !== document.documentId ||
    snapshot.revision !== document.revision ||
    snapshot.resolution.pageId !== pageId
  ) {
    return failure(
      "conflict",
      "SVG Boolean geometry snapshot does not match the current document, revision, and Page",
    );
  }
  if (
    snapshot.resolution.resolverVersion !== BOOLEAN_GEOMETRY_RESOLVER_VERSION
  ) {
    return failure(
      "invalid-geometry",
      `SVG Boolean geometry resolver version ${String(snapshot.resolution.resolverVersion)} is not supported`,
    );
  }
  const required = new Set(booleanNodeIds);
  const blockingIssue = snapshot.resolution.issues.find(
    (issue) => issue.nodeId === pageId || required.has(issue.nodeId),
  );
  if (blockingIssue) {
    return failure(
      "invalid-geometry",
      `SVG Boolean geometry failed for ${blockingIssue.nodeId}: ${blockingIssue.message}`,
    );
  }
  const pathEntries: Array<[string, SvgResolvedBooleanPath]> = [];
  for (const nodeId of booleanNodeIds) {
    const result = snapshot.resolution.resultsByNodeId.get(nodeId);
    if (!result || (!result.empty && result.path.length === 0)) {
      return failure(
        "invalid-geometry",
        `SVG Boolean geometry result ${nodeId} is missing`,
      );
    }
    pathEntries.push([
      nodeId,
      {
        bounds: result.bounds ? { ...result.bounds } : null,
        empty: result.empty,
        fillRule: result.fillRule,
        path: result.path,
        provider: result.provider,
        providerVersion: result.providerVersion,
      },
    ]);
  }
  return { ok: true, paths: Object.fromEntries(pathEntries) };
}

function collectRenderedBooleanNodeIds(
  document: DesignDocument,
  rootNodeIds: readonly string[],
): string[] {
  const ids: string[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node) return;
    if (node.kind === "boolean") {
      ids.push(node.id);
      return;
    }
    if (node.kind === "frame" || node.kind === "group") {
      node.childIds.forEach(visit);
    }
  };
  rootNodeIds.forEach(visit);
  return ids;
}

interface ExportBoundsContext {
  document: DesignDocument;
  resolvedBooleanPaths: Readonly<Record<string, SvgResolvedBooleanPath>>;
  selectedFrameRoots: ReadonlySet<string>;
}

function renderedNodeBounds(
  context: ExportBoundsContext,
  nodeId: string,
): Rect | null {
  const node = context.document.nodesById[nodeId];
  if (!node) return null;
  if (node.kind === "group") {
    return unionRects(
      node.childIds
        .map((childId) => renderedNodeBounds(context, childId))
        .filter((bounds): bounds is Rect => bounds !== null),
    );
  }
  const ownBounds = drawableNodeBounds(context, node);
  if (node.kind !== "frame" || context.selectedFrameRoots.has(node.id)) {
    return ownBounds;
  }
  return unionRects([
    ...(ownBounds ? [ownBounds] : []),
    ...node.childIds
      .map((childId) => renderedNodeBounds(context, childId))
      .filter((bounds): bounds is Rect => bounds !== null),
  ]);
}

function drawableNodeBounds(
  context: ExportBoundsContext,
  node: DesignNode,
): Rect | null {
  const world = getWorldTransform(context.document, node.id);
  if (!world) return null;
  const localBounds =
    node.kind === "boolean"
      ? context.resolvedBooleanPaths[node.id]?.bounds
      : { x: 0, y: 0, width: node.size.width, height: node.size.height };
  if (!localBounds) return null;
  const bounds = transformRect(localBounds, world);
  const stroke = strokeOutset(node, world);
  return {
    x: bounds.x - stroke.x,
    y: bounds.y - stroke.y,
    width: bounds.width + stroke.x * 2,
    height: bounds.height + stroke.y * 2,
  };
}

function strokeOutset(
  node: DesignNode,
  transform: Transform,
): { x: number; y: number } {
  const shape = shapeProperties(node);
  if (!shape || shape.strokeWidth <= 0 || !shape.strokes.some(isVisiblePaint)) {
    return { x: 0, y: 0 };
  }
  // SVG 1.1 strokes are centered. The service currently emits the standard
  // miter limit, so reserve its worst-case local extension to avoid clipping.
  const joinFactor =
    shape.strokeJoin === "round" || shape.strokeJoin === "bevel" ? 1 : 4;
  const radius = (shape.strokeWidth / 2) * joinFactor;
  return {
    x: radius * Math.hypot(transform[0], transform[2]),
    y: radius * Math.hypot(transform[1], transform[3]),
  };
}

function shapeProperties(node: DesignNode):
  | {
      strokes: readonly Paint[];
      strokeWidth: number;
      strokeJoin?: "miter" | "round" | "bevel";
    }
  | undefined {
  if (
    node.kind === "frame" ||
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "line" ||
    node.kind === "text" ||
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
  ) {
    return node.properties;
  }
  return undefined;
}

function isVisiblePaint(paint: Paint): boolean {
  return paint.visible !== false && paint.opacity > 0;
}

function transformRect(rect: Rect, transform: Transform): Rect {
  const corners = [
    transformPoint({ x: rect.x, y: rect.y }, transform),
    transformPoint({ x: rect.x + rect.width, y: rect.y }, transform),
    transformPoint({ x: rect.x, y: rect.y + rect.height }, transform),
    transformPoint(
      { x: rect.x + rect.width, y: rect.y + rect.height },
      transform,
    ),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function pagePaintOrder(
  document: DesignDocument,
  pageId: string,
): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  let sequence = 0;
  const visit = (nodeId: string): void => {
    if (order.has(nodeId)) return;
    order.set(nodeId, sequence++);
    document.nodesById[nodeId]?.childIds.forEach(visit);
  };
  document.pagesById[pageId]?.rootNodeIds.forEach(visit);
  return order;
}

function firstSelectedAncestor(
  document: DesignDocument,
  nodeId: string,
  selected: ReadonlySet<string>,
): string | undefined {
  const visited = new Set<string>();
  let parentId = document.nodesById[nodeId]?.parentId ?? null;
  while (parentId && !visited.has(parentId)) {
    if (selected.has(parentId)) return parentId;
    visited.add(parentId);
    parentId = document.nodesById[parentId]?.parentId ?? null;
  }
  return undefined;
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  targetNodeId: string,
): boolean {
  const pending = [...(document.pagesById[pageId]?.rootNodeIds ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    if (nodeId === targetNodeId) return true;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (node) pending.push(...node.childIds);
  }
  return false;
}

function isFinitePositiveRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function failure(
  code: SvgExportPlanFailureCode,
  message: string,
): Extract<SvgExportPlan, { ok: false }> {
  return { ok: false, code, message };
}
