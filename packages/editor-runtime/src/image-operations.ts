import type {
  DesignAsset,
  DesignDocument,
  DesignNode,
  DesignOperation,
  ImagePlacement,
} from "@opendesign/design-contracts";

export type ImageUpdateOperation =
  | {
      action: "set-placement";
      pageId: string;
      nodeId: string;
      placement: ImagePlacement;
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

function nodeReferencesAsset(node: DesignNode, assetId: string): boolean {
  if (node.kind === "image") return node.properties.assetId === assetId;
  if (
    node.kind !== "frame" &&
    node.kind !== "rectangle" &&
    node.kind !== "ellipse" &&
    node.kind !== "text" &&
    node.kind !== "path" &&
    node.kind !== "vector"
  ) {
    return false;
  }
  return [...node.properties.fills, ...node.properties.strokes].some(
    (paint) => paint.type === "image" && paint.assetId === assetId,
  );
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
