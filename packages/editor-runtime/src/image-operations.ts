import type {
  DesignAsset,
  DesignDocument,
  DesignNode,
  DesignOperation,
  ImageFilters,
  ImagePlacement,
  ImageNode,
  JsonObject,
  Point,
} from "@opendesign/design-contracts";
import { MAX_TRANSACTION_COMMANDS } from "@opendesign/design-contracts";
import { normalizeImageFilters } from "@opendesign/image-service";
import {
  getWorldTransform,
  invertTransform,
  transformPoint,
} from "./geometry.js";

export type ImageUpdateOperation =
  | {
      action: "set-placement";
      pageId: string;
      nodeId: string;
      placement: ImagePlacement;
    }
  | {
      action: "set-filters";
      pageId: string;
      nodeId: string;
      filters: ImageFilters;
    }
  | {
      action: "replace-source";
      pageId: string;
      nodeId: string;
      asset: DesignAsset;
      placement?: ImagePlacement;
    };

export type ImageUpdateFailureCode =
  "invalid-asset" | "invalid-kind" | "no-op" | "not-found" | "out-of-scope";

export type ImageUpdatePlan =
  | {
      ok: true;
      commands: DesignOperation[];
      nodeId: string;
      previousAssetId: string;
      nextAssetId: string;
      deletedAssetId?: string;
    }
  | {
      ok: false;
      code: ImageUpdateFailureCode;
      message: string;
    };

export type ImageAssetOperationFailureCode =
  | "invalid-asset"
  | "locked"
  | "no-op"
  | "not-found"
  | "out-of-scope"
  | "too-many-references";

export type ImageAssetOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      assetId: string;
      nodeId?: string;
      pageId?: string;
    }
  | {
      ok: false;
      code: ImageAssetOperationFailureCode;
      message: string;
    };

export type PlaceImageAssetOperation = {
  pageId: string;
  assetId: string;
  nodeId: string;
  documentPoint: Point;
};

/**
 * Plans one explicit, atomic Image-node update against the authoritative
 * document. The caller supplies stable Page/node IDs; selection is never read.
 */
export function planImageNodeUpdate(
  document: DesignDocument,
  operation: ImageUpdateOperation,
  commandPrefix = "update_image",
): ImageUpdatePlan {
  const page = document.pagesById[operation.pageId];
  if (!page) {
    return {
      ok: false,
      code: "not-found",
      message: `Page ${operation.pageId} does not exist`,
    };
  }
  const node = document.nodesById[operation.nodeId];
  if (!node) {
    return {
      ok: false,
      code: "not-found",
      message: `Node ${operation.nodeId} does not exist`,
    };
  }
  if (!nodeBelongsToPage(document, operation.pageId, operation.nodeId)) {
    return {
      ok: false,
      code: "out-of-scope",
      message: `Node ${operation.nodeId} is outside Page ${operation.pageId}`,
    };
  }
  if (node.kind !== "image") {
    return {
      ok: false,
      code: "invalid-kind",
      message: `Node ${operation.nodeId} is not an Image node`,
    };
  }

  const previousAssetId = node.properties.assetId;
  if (operation.action === "set-placement") {
    if (samePlacement(node.properties.placement, operation.placement)) {
      return {
        ok: false,
        code: "no-op",
        message: `Image node ${operation.nodeId} already uses that placement`,
      };
    }
    return {
      ok: true,
      commands: [
        {
          commandId: `${commandPrefix}_node`,
          type: "update_properties",
          nodeId: operation.nodeId,
          properties: { placement: operation.placement },
        },
      ],
      nodeId: operation.nodeId,
      previousAssetId,
      nextAssetId: previousAssetId,
    };
  }

  if (operation.action === "set-filters") {
    const filters = normalizeImageFilters(operation.filters) ?? {};
    const currentFilters = normalizeImageFilters(node.properties.filters) ?? {};
    if (JSON.stringify(filters) === JSON.stringify(currentFilters)) {
      return {
        ok: false,
        code: "no-op",
        message: `Image node ${operation.nodeId} already uses those filters`,
      };
    }
    return {
      ok: true,
      commands: [
        {
          commandId: `${commandPrefix}_node`,
          type: "update_properties",
          nodeId: operation.nodeId,
          properties: { filters },
        },
      ],
      nodeId: operation.nodeId,
      previousAssetId,
      nextAssetId: previousAssetId,
    };
  }

  if (operation.asset.kind !== "image") {
    return {
      ok: false,
      code: "invalid-asset",
      message: `Asset ${operation.asset.id} is not an image`,
    };
  }
  const placementChanged =
    operation.placement !== undefined &&
    !samePlacement(node.properties.placement, operation.placement);
  if (operation.asset.id === previousAssetId && !placementChanged) {
    return {
      ok: false,
      code: "no-op",
      message: `Image node ${operation.nodeId} already uses asset ${operation.asset.id}`,
    };
  }

  const commands: DesignOperation[] = [];
  if (
    operation.asset.id !== previousAssetId &&
    document.assetsById[operation.asset.id] === undefined
  ) {
    commands.push({
      commandId: `${commandPrefix}_asset`,
      type: "put_asset",
      asset: operation.asset,
    });
  }
  commands.push({
    commandId: `${commandPrefix}_node`,
    type: "update_properties",
    nodeId: operation.nodeId,
    properties: {
      assetId: operation.asset.id,
      ...(operation.placement === undefined
        ? {}
        : { placement: operation.placement }),
    },
  });

  let deletedAssetId: string | undefined;
  if (
    operation.asset.id !== previousAssetId &&
    document.assetsById[previousAssetId] !== undefined &&
    !assetReferencedOutsideNode(document, previousAssetId, operation.nodeId)
  ) {
    deletedAssetId = previousAssetId;
    commands.push({
      commandId: `${commandPrefix}_cleanup`,
      type: "delete_asset",
      assetId: previousAssetId,
    });
  }

  return {
    ok: true,
    commands,
    nodeId: operation.nodeId,
    previousAssetId,
    nextAssetId: operation.asset.id,
    ...(deletedAssetId === undefined ? {} : { deletedAssetId }),
  };
}

/**
 * Places an existing document image asset at a document-space point. The
 * deepest visible Frame under the point becomes the parent. A locked Frame or
 * locked ancestor rejects the operation instead of silently placing at root.
 */
export function planPlaceImageAsset(
  document: DesignDocument,
  operation: PlaceImageAssetOperation,
  commandPrefix = "place_image_asset",
): ImageAssetOperationPlan {
  const page = document.pagesById[operation.pageId];
  if (!page) {
    return failure("not-found", `Page ${operation.pageId} does not exist`);
  }
  const asset = document.assetsById[operation.assetId];
  if (!asset) {
    return failure("not-found", `Asset ${operation.assetId} does not exist`);
  }
  if (asset.kind !== "image") {
    return failure(
      "invalid-asset",
      `Asset ${operation.assetId} is not an image`,
    );
  }
  if (document.nodesById[operation.nodeId]) {
    return failure("invalid-asset", `Node ${operation.nodeId} already exists`);
  }

  const target = resolveImageDropTarget(
    document,
    operation.pageId,
    operation.documentPoint,
  );
  if (!target.ok) return target;
  const size = fittedImageSize(asset.size);
  const localCenter = target.localPoint;
  const node: ImageNode = {
    id: operation.nodeId,
    kind: "image",
    name: asset.name,
    parentId: target.parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [
      1,
      0,
      0,
      1,
      localCenter.x - size.width / 2,
      localCenter.y - size.height / 2,
    ],
    size,
    opacity: 1,
    exportSettings: [],
    properties: {
      assetId: asset.id,
      placement: { mode: "fit" },
      altText: asset.name,
      cornerRadius: 0,
    },
    extensions: {},
  };
  return {
    ok: true,
    assetId: asset.id,
    nodeId: node.id,
    pageId: operation.pageId,
    commands: [
      {
        commandId: `${commandPrefix}_node`,
        type: "insert_element",
        pageId: operation.pageId,
        parentId: target.parentId,
        index: target.index,
        node,
      },
    ],
  };
}

/** Replaces/relinks every supported reference without changing placement. */
export function planReplaceImageAsset(
  document: DesignDocument,
  assetId: string,
  replacement: DesignAsset,
  commandPrefix = "replace_image_asset",
): ImageAssetOperationPlan {
  const previous = document.assetsById[assetId];
  const references = Object.values(document.nodesById).filter((node) =>
    nodeReferencesAsset(node, assetId),
  );
  if (!previous && references.length === 0) {
    return failure("not-found", `Asset ${assetId} does not exist`);
  }
  if (previous && previous.kind !== "image") {
    return failure("invalid-asset", `Asset ${assetId} is not an image`);
  }
  if (replacement.kind !== "image") {
    return failure("invalid-asset", `Asset ${replacement.id} is not an image`);
  }
  const existingReplacement = document.assetsById[replacement.id];
  if (existingReplacement && existingReplacement.kind !== "image") {
    return failure(
      "invalid-asset",
      `Existing asset ${replacement.id} is not an image`,
    );
  }
  if (replacement.id === assetId) {
    return failure("no-op", `Asset ${assetId} already uses that source`);
  }
  const commandCount =
    references.length +
    (document.assetsById[replacement.id] ? 0 : 1) +
    (previous ? 1 : 0);
  if (commandCount > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "too-many-references",
      `Asset ${assetId} has too many references for one transaction`,
    );
  }

  const commands: DesignOperation[] = [];
  if (!document.assetsById[replacement.id]) {
    commands.push({
      commandId: `${commandPrefix}_asset`,
      type: "put_asset",
      asset: replacement,
    });
  }
  for (const [index, node] of references.entries()) {
    commands.push({
      commandId: `${commandPrefix}_reference_${index}`,
      type: "update_properties",
      nodeId: node.id,
      properties: replacementProperties(node, assetId, replacement.id),
    });
  }
  if (previous) {
    commands.push({
      commandId: `${commandPrefix}_cleanup`,
      type: "delete_asset",
      assetId,
    });
  }
  return {
    ok: true,
    assetId: replacement.id,
    commands,
  };
}

export function planDeleteImageAsset(
  document: DesignDocument,
  assetId: string,
  commandPrefix = "delete_image_asset",
): ImageAssetOperationPlan {
  const asset = document.assetsById[assetId];
  if (!asset) return failure("not-found", `Asset ${assetId} does not exist`);
  if (asset.kind !== "image") {
    return failure("invalid-asset", `Asset ${assetId} is not an image`);
  }
  const reference = Object.values(document.nodesById).find((node) =>
    nodeReferencesAsset(node, assetId),
  );
  if (reference) {
    return failure(
      "out-of-scope",
      `Asset ${assetId} is still referenced by node ${reference.id}`,
    );
  }
  return {
    ok: true,
    assetId,
    commands: [
      {
        commandId: `${commandPrefix}_asset`,
        type: "delete_asset",
        assetId,
      },
    ],
  };
}

function samePlacement(left: ImagePlacement, right: ImagePlacement): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assetReferencedOutsideNode(
  document: DesignDocument,
  assetId: string,
  excludedNodeId: string,
): boolean {
  return Object.values(document.nodesById).some(
    (node) => node.id !== excludedNodeId && nodeReferencesAsset(node, assetId),
  );
}

export function nodeReferencesAsset(
  node: DesignNode,
  assetId: string,
): boolean {
  if (node.kind === "image") return node.properties.assetId === assetId;
  if (
    node.kind !== "frame" &&
    node.kind !== "slot" &&
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
    return false;
  }
  return [...node.properties.fills, ...node.properties.strokes].some(
    (paint) => paint.type === "image" && paint.assetId === assetId,
  );
}

function replacementProperties(
  node: DesignNode,
  previousAssetId: string,
  nextAssetId: string,
): JsonObject {
  if (node.kind === "image") return { assetId: nextAssetId };
  if (!hasPaints(node)) return {};
  const replace = (paint: (typeof node.properties.fills)[number]) =>
    paint.type === "image" && paint.assetId === previousAssetId
      ? { ...paint, assetId: nextAssetId }
      : paint;
  return {
    fills: node.properties.fills.map(replace),
    strokes: node.properties.strokes.map(replace),
  };
}

function hasPaints(
  node: DesignNode,
): node is Exclude<
  DesignNode,
  { kind: "group" | "image" | "instance" | "slice" }
> {
  return (
    node.kind !== "group" &&
    node.kind !== "image" &&
    node.kind !== "instance" &&
    node.kind !== "slice"
  );
}

function fittedImageSize(size: DesignAsset["size"]): {
  width: number;
  height: number;
} {
  const width = size?.width && size.width > 0 ? size.width : 320;
  const height = size?.height && size.height > 0 ? size.height : 240;
  const scale = Math.min(1, 320 / width, 240 / height);
  return {
    width: Math.max(1, width * scale),
    height: Math.max(1, height * scale),
  };
}

function resolveImageDropTarget(
  document: DesignDocument,
  pageId: string,
  documentPoint: Point,
):
  | {
      ok: true;
      parentId: string | null;
      index: number;
      localPoint: Point;
    }
  | Extract<ImageAssetOperationPlan, { ok: false }> {
  const page = document.pagesById[pageId];
  if (!page) return failure("not-found", `Page ${pageId} does not exist`);
  let best:
    | {
        node: DesignNode;
        depth: number;
        effectiveLocked: boolean;
        localPoint: Point;
      }
    | undefined;
  const visited = new Set<string>();
  const visit = (
    nodeId: string,
    depth: number,
    inheritedLocked: boolean,
    inheritedVisible: boolean,
  ) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node) return;
    const effectiveLocked = inheritedLocked || node.locked;
    const effectiveVisible = inheritedVisible && node.visible;
    const transform = getWorldTransform(document, node.id);
    const inverse = transform ? invertTransform(transform) : null;
    const localPoint = inverse
      ? transformPoint(documentPoint, inverse)
      : undefined;
    if (
      effectiveVisible &&
      node.kind === "frame" &&
      localPoint &&
      localPoint.x >= 0 &&
      localPoint.y >= 0 &&
      localPoint.x <= node.size.width &&
      localPoint.y <= node.size.height &&
      (!best || depth >= best.depth)
    ) {
      best = { node, depth, effectiveLocked, localPoint };
    }
    for (const childId of node.childIds) {
      visit(childId, depth + 1, effectiveLocked, effectiveVisible);
    }
  };
  for (const rootId of page.rootNodeIds) visit(rootId, 0, false, true);
  if (!best) {
    return {
      ok: true,
      parentId: null,
      index: page.rootNodeIds.length,
      localPoint: documentPoint,
    };
  }
  if (best.effectiveLocked) {
    return failure(
      "locked",
      `Frame ${best.node.id} or one of its ancestors is locked`,
    );
  }
  return {
    ok: true,
    parentId: best.node.id,
    index: best.node.childIds.length,
    localPoint: best.localPoint,
  };
}

function failure(
  code: ImageAssetOperationFailureCode,
  message: string,
): Extract<ImageAssetOperationPlan, { ok: false }> {
  return { ok: false, code, message };
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
