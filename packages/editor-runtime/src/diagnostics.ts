import {
  isFrameLikeNode,
  type DesignDocument,
  type DesignNode,
  type Effect,
  type Paint,
  type Rect,
} from "@opendesign/design-contracts";
import { resolvePathPropertiesData } from "@opendesign/geometry-service/editable-vector";
import { getNodeBounds } from "./geometry.js";

export const DESIGN_DIAGNOSTIC_REPORT_VERSION = 1 as const;

export type DesignDiagnosticSeverity = "error" | "warning";

export type DesignDiagnosticCode =
  | "empty-path"
  | "empty-text"
  | "fragmented-root"
  | "invisible-node"
  | "missing-asset"
  | "no-visible-paint"
  | "non-finite-bounds"
  | "outside-clipping-bounds"
  | "unsupported-image-source";

export interface DesignDiagnostic {
  code: DesignDiagnosticCode;
  message: string;
  nodeId?: string;
  pageId: string;
  relatedNodeIds?: string[];
  severity: DesignDiagnosticSeverity;
}

export interface DesignFeatureSummary {
  blends: number;
  blurs: number;
  glows: number;
  gradients: number;
  images: number;
  masks: number;
  paths: number;
  text: number;
}

export interface DesignDiagnosticReport {
  version: typeof DESIGN_DIAGNOSTIC_REPORT_VERSION;
  documentId: string;
  revision: number;
  pageIds: string[];
  checkedNodeCount: number;
  errorCount: number;
  warningCount: number;
  features: DesignFeatureSummary;
  items: DesignDiagnostic[];
}

const FRAGMENTED_ROOT_THRESHOLD = 4;

export function diagnoseDesignPages(
  document: DesignDocument,
  pageIds: readonly string[] = document.pageOrder,
): DesignDiagnosticReport {
  const items: DesignDiagnostic[] = [];
  const features = emptyFeatureSummary();
  const checkedNodeIds = new Set<string>();

  for (const pageId of pageIds) {
    const page = document.pagesById[pageId];
    if (!page) {
      throw new Error(`Design diagnostic Page not found: ${pageId}`);
    }
    const rootFragments = page.rootNodeIds.filter((nodeId) => {
      const node = document.nodesById[nodeId];
      return (
        node &&
        node.kind !== "frame" &&
        node.kind !== "group" &&
        node.kind !== "boolean"
      );
    });
    if (rootFragments.length >= FRAGMENTED_ROOT_THRESHOLD) {
      items.push({
        code: "fragmented-root",
        severity: "warning",
        pageId,
        relatedNodeIds: rootFragments.slice(0, 32),
        message: `Page ${pageId} has ${rootFragments.length} ungrouped root layers; composite artwork should use a named Frame, Group, or Boolean`,
      });
    }

    const pending = [...page.rootNodeIds].reverse();
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (!nodeId || checkedNodeIds.has(nodeId)) continue;
      const node = document.nodesById[nodeId];
      if (!node) continue;
      checkedNodeIds.add(nodeId);
      pending.push(...[...node.childIds].reverse());
      countFeatures(node, features);
      diagnoseNode(document, pageId, node, items);
    }
  }

  return {
    version: DESIGN_DIAGNOSTIC_REPORT_VERSION,
    documentId: document.documentId,
    revision: document.revision,
    pageIds: [...pageIds],
    checkedNodeCount: checkedNodeIds.size,
    errorCount: items.filter((item) => item.severity === "error").length,
    warningCount: items.filter((item) => item.severity === "warning").length,
    features,
    items,
  };
}

function diagnoseNode(
  document: DesignDocument,
  pageId: string,
  node: DesignNode,
  items: DesignDiagnostic[],
): void {
  const bounds = getNodeBounds(document, node.id);
  if (!hasFiniteGeometry(node) || !bounds || !isFiniteRect(bounds)) {
    items.push({
      code: "non-finite-bounds",
      severity: "error",
      pageId,
      nodeId: node.id,
      message: `Node ${node.id} has non-finite geometry or world bounds`,
    });
  } else {
    const clippingContainer = nearestClippingContainer(document, node);
    if (clippingContainer) {
      const clippingBounds = getNodeBounds(document, clippingContainer.id);
      if (
        clippingBounds &&
        isFiniteRect(clippingBounds) &&
        !rectsIntersect(bounds, clippingBounds)
      ) {
        items.push({
          code: "outside-clipping-bounds",
          severity: "warning",
          pageId,
          nodeId: node.id,
          relatedNodeIds: [clippingContainer.id],
          message: `Node ${node.id} is fully outside clipping container ${clippingContainer.id}`,
        });
      }
    }
  }

  if (!node.visible) {
    items.push({
      code: "invisible-node",
      severity: "warning",
      pageId,
      nodeId: node.id,
      message: `Node ${node.id} is hidden`,
    });
  } else if (node.opacity <= 0) {
    items.push({
      code: "invisible-node",
      severity: "warning",
      pageId,
      nodeId: node.id,
      message: `Node ${node.id} has zero opacity`,
    });
  } else if (hasNoDrawableSize(node)) {
    items.push({
      code: "invisible-node",
      severity: "warning",
      pageId,
      nodeId: node.id,
      message: `Node ${node.id} has zero drawable size`,
    });
  }

  if (
    (node.kind === "path" || node.kind === "vector") &&
    (resolvePathPropertiesData(node.properties)?.trim().length ?? 0) === 0
  ) {
    items.push({
      code: "empty-path",
      severity: "error",
      pageId,
      nodeId: node.id,
      message: `Path node ${node.id} has no drawable path commands`,
    });
  }
  if (node.kind === "text" && node.properties.content.trim().length === 0) {
    items.push({
      code: "empty-text",
      severity: "warning",
      pageId,
      nodeId: node.id,
      message: `Text node ${node.id} has no visible content`,
    });
  }

  if (node.kind === "image") {
    diagnoseAsset(document, pageId, node.id, node.properties.assetId, items);
  }
  for (const paint of nodePaints(node)) {
    if (paint.type === "image") {
      diagnoseAsset(document, pageId, node.id, paint.assetId, items);
    }
  }

  if (isDrawableShape(node) && !hasVisibleAppearance(node)) {
    items.push({
      code: "no-visible-paint",
      severity: "warning",
      pageId,
      nodeId: node.id,
      message: `Node ${node.id} has no visible fill, stroke, or effect`,
    });
  }
}

function hasNoDrawableSize(node: DesignNode): boolean {
  if (node.kind === "group") return false;
  if (node.kind === "line" || node.kind === "path" || node.kind === "vector") {
    return node.size.width <= 0 && node.size.height <= 0;
  }
  return node.size.width <= 0 || node.size.height <= 0;
}

function diagnoseAsset(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  assetId: string,
  items: DesignDiagnostic[],
): void {
  const asset = document.assetsById[assetId];
  if (!asset || asset.kind !== "image" || asset.source.value.length === 0) {
    items.push({
      code: "missing-asset",
      severity: "error",
      pageId,
      nodeId,
      message: `Node ${nodeId} references missing image asset ${assetId}`,
    });
    return;
  }
  if (asset.source.type !== "data") {
    items.push({
      code: "unsupported-image-source",
      severity: "warning",
      pageId,
      nodeId,
      message: `Image asset ${assetId} uses ${asset.source.type} source data that the production canvas cannot render directly`,
    });
  }
}

function countFeatures(node: DesignNode, summary: DesignFeatureSummary): void {
  if (
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
  ) {
    summary.paths += 1;
  }
  if (node.kind === "image") summary.images += 1;
  if (node.kind === "text") summary.text += 1;
  if (node.blendMode && node.blendMode !== "normal") summary.blends += 1;
  if (node.maskMode && node.maskMode !== "none") summary.masks += 1;
  for (const paint of nodePaints(node)) {
    if (
      paint.type === "linear-gradient" ||
      paint.type === "radial-gradient" ||
      paint.type === "angular-gradient"
    ) {
      summary.gradients += 1;
    }
    if (paint.type === "image") summary.images += 1;
  }
  for (const effect of node.effects ?? []) {
    if (effect.type === "outer-glow" || effect.type === "inner-glow") {
      summary.glows += 1;
    }
    if (effect.type === "layer-blur" || effect.type === "background-blur") {
      summary.blurs += 1;
    }
  }
}

function nodePaints(node: DesignNode): readonly Paint[] {
  if (
    isFrameLikeNode(node) ||
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "line" ||
    node.kind === "polygon" ||
    node.kind === "star" ||
    node.kind === "text" ||
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
  ) {
    return [...node.properties.fills, ...node.properties.strokes];
  }
  return [];
}

function hasVisibleAppearance(node: DesignNode): boolean {
  if (node.kind === "image") return true;
  if (
    node.kind !== "rectangle" &&
    node.kind !== "ellipse" &&
    node.kind !== "line" &&
    node.kind !== "polygon" &&
    node.kind !== "star" &&
    node.kind !== "text" &&
    node.kind !== "path" &&
    node.kind !== "vector" &&
    node.kind !== "boolean"
  ) {
    return true;
  }
  const visibleFill = node.properties.fills.some(hasVisiblePaint);
  const visibleStroke =
    node.properties.strokeWidth > 0 &&
    node.properties.strokes.some(hasVisiblePaint);
  return (
    visibleFill || visibleStroke || (node.effects ?? []).some(hasVisibleEffect)
  );
}

function hasVisiblePaint(paint: Paint): boolean {
  return paint.visible !== false && paint.opacity > 0;
}

function hasVisibleEffect(effect: Effect): boolean {
  if (effect.visible === false) return false;
  if (effect.type === "grayscale") return effect.amount > 0;
  if (effect.type === "layer-blur" || effect.type === "background-blur") {
    return effect.radius > 0;
  }
  if (effect.type === "outer-glow" || effect.type === "inner-glow") {
    return effect.opacity > 0 && (effect.radius > 0 || effect.spread !== 0);
  }
  return effect.opacity > 0 && (effect.blur > 0 || effect.spread !== 0);
}

function isDrawableShape(node: DesignNode): boolean {
  return (
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "line" ||
    node.kind === "polygon" ||
    node.kind === "star" ||
    node.kind === "text" ||
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
  );
}

function hasFiniteGeometry(node: DesignNode): boolean {
  return (
    node.transform.every(Number.isFinite) &&
    Number.isFinite(node.size.width) &&
    Number.isFinite(node.size.height) &&
    Number.isFinite(node.opacity)
  );
}

function isFiniteRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

function nearestClippingContainer(
  document: DesignDocument,
  node: DesignNode,
): import("@opendesign/design-contracts").FrameLikeNode | undefined {
  const seen = new Set<string>();
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = document.nodesById[parentId];
    if (!parent) return undefined;
    if (isFrameLikeNode(parent) && parent.properties.clipsContent) {
      return parent;
    }
    parentId = parent.parentId;
  }
  return undefined;
}

function rectsIntersect(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function emptyFeatureSummary(): DesignFeatureSummary {
  return {
    blends: 0,
    blurs: 0,
    glows: 0,
    gradients: 0,
    images: 0,
    masks: 0,
    paths: 0,
    text: 0,
  };
}
