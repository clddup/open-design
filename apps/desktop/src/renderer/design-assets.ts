import type {
  DesignAsset,
  DesignDocument,
  DesignNode,
} from "@opendesign/design-contracts";
import { nodeReferencesAsset } from "@opendesign/editor-runtime";

export const DESIGN_ASSET_DRAG_MIME =
  "application/x-opendesign-image-asset-id" as const;

export type AssetActionResult =
  { ok: true; message?: string } | { ok: false; error: string };

const PREVIEW_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_PREVIEW_SOURCE_CHARACTERS = 24_000_000;

export type DesignAssetStatus = "ready" | "unavailable" | "missing";

export type DesignAssetReference = {
  nodeId: string;
  pageId: string | null;
  kind: "image-node" | "image-paint";
};

export type DesignAssetIndexEntry = {
  assetId: string;
  asset: DesignAsset | null;
  name: string;
  previewDataUrl: string | null;
  references: readonly DesignAssetReference[];
  referenceCount: number;
  status: DesignAssetStatus;
};

export function indexDesignImageAssets(
  document: DesignDocument,
): DesignAssetIndexEntry[] {
  const pageIdsByNodeId = pageIdsByNode(document);
  const referencedAssetIds = new Set<string>();
  for (const node of Object.values(document.nodesById)) {
    for (const assetId of assetIdsForNode(node))
      referencedAssetIds.add(assetId);
  }
  const imageAssets = Object.values(document.assetsById)
    .filter((asset) => asset.kind === "image")
    .map((asset) => asset.id);
  const assetIds = new Set([...imageAssets, ...referencedAssetIds]);

  return [...assetIds]
    .map((assetId): DesignAssetIndexEntry => {
      const asset = document.assetsById[assetId] ?? null;
      const references = Object.values(document.nodesById)
        .filter((node) => nodeReferencesAsset(node, assetId))
        .map((node) => ({
          nodeId: node.id,
          pageId: pageIdsByNodeId.get(node.id) ?? null,
          kind:
            node.kind === "image" && node.properties.assetId === assetId
              ? ("image-node" as const)
              : ("image-paint" as const),
        }));
      const previewDataUrl = assetPreviewDataUrl(asset);
      const status: DesignAssetStatus = !asset
        ? "missing"
        : previewDataUrl
          ? "ready"
          : "unavailable";
      return {
        assetId,
        asset,
        name: asset?.name || assetId,
        previewDataUrl,
        references,
        referenceCount: references.length,
        status,
      };
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

export function filterDesignImageAssets(
  entries: readonly DesignAssetIndexEntry[],
  query: string,
): DesignAssetIndexEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...entries];
  return entries.filter((entry) =>
    `${entry.name}\n${entry.assetId}\n${entry.asset?.mimeType ?? ""}`
      .toLocaleLowerCase()
      .includes(normalized),
  );
}

export function assetPreviewDataUrl(asset: DesignAsset | null): string | null {
  if (
    !asset ||
    asset.kind !== "image" ||
    asset.source.type !== "data" ||
    !PREVIEW_MIME_TYPES.has(asset.mimeType) ||
    asset.source.value.length === 0 ||
    asset.source.value.length > MAX_PREVIEW_SOURCE_CHARACTERS
  ) {
    return null;
  }
  if (asset.source.value.startsWith("data:")) {
    return new RegExp(
      `^data:${escapeRegex(asset.mimeType)};base64,[A-Za-z0-9+/]*={0,2}$`,
    ).test(asset.source.value)
      ? asset.source.value
      : null;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.source.value)) return null;
  return `data:${asset.mimeType};base64,${asset.source.value}`;
}

function assetIdsForNode(node: DesignNode): string[] {
  const assetIds: string[] = [];
  if (node.kind === "image") assetIds.push(node.properties.assetId);
  if (
    node.kind !== "group" &&
    node.kind !== "image" &&
    node.kind !== "instance"
  ) {
    for (const paint of [
      ...node.properties.fills,
      ...node.properties.strokes,
    ]) {
      if (paint.type === "image") assetIds.push(paint.assetId);
    }
  }
  return [...new Set(assetIds)];
}

function pageIdsByNode(document: DesignDocument): Map<string, string> {
  const result = new Map<string, string>();
  for (const pageId of document.pageOrder) {
    const page = document.pagesById[pageId];
    if (!page) continue;
    const pending = [...page.rootNodeIds];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (!nodeId || visited.has(nodeId)) continue;
      visited.add(nodeId);
      result.set(nodeId, pageId);
      const node = document.nodesById[nodeId];
      if (node) pending.push(...node.childIds);
    }
  }
  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
