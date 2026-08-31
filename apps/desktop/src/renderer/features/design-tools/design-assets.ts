import {
  nodePaints,
  type DesignAsset,
  type DesignDocument,
  type DesignNode,
  type ImageAssetDerivationOperation,
} from "@opendesign/design-contracts";
import {
  indexImageAssetFamilies,
  nodeReferencesAsset,
} from "@opendesign/editor-runtime";
import type { MessageKey } from "@/shared/i18n/messages";
import type { DesignImageEditAction } from "@/shared/desktop-api";

export const DESIGN_ASSET_DRAG_MIME =
  "application/x-opendesign-image-asset-id" as const;

export const IMAGE_DERIVATION_OPERATION_LABEL_KEYS: Record<
  ImageAssetDerivationOperation,
  MessageKey
> = {
  replacement: "properties.imageSourceOperation.replacement",
  "remove-background": "properties.imageSourceOperation.remove-background",
  "replace-background": "properties.imageSourceOperation.replace-background",
  "erase-object": "properties.imageSourceOperation.erase-object",
  "isolate-object": "properties.imageSourceOperation.isolate-object",
  expand: "properties.imageSourceOperation.expand",
  upscale: "properties.imageSourceOperation.upscale",
  "prompt-edit": "properties.imageSourceOperation.prompt-edit",
  relight: "properties.imageSourceOperation.relight",
  "style-harmonize": "properties.imageSourceOperation.style-harmonize",
};

export const IMAGE_EDIT_PROGRESS_LABEL_KEYS: Record<
  DesignImageEditAction,
  MessageKey
> = {
  "remove-background": "properties.imageRemovingBackground",
  "replace-background": "properties.imageReplacingBackground",
  relight: "properties.imageChangingLighting",
  "prompt-edit": "properties.imageEditingWithPrompt",
  "erase-object": "canvas.imageAreaErasing",
  "isolate-object": "canvas.imageAreaIsolating",
  expand: "canvas.imageExpanding",
  upscale: "properties.imageBoostingResolution",
};

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
  derivationOperation: ImageAssetDerivationOperation | null;
  familyRootAssetId: string;
  familySize: number;
  familyPosition: number;
  familyReferenceCount: number;
  familyInUse: boolean;
  isFamilyRoot: boolean;
};

export function indexDesignImageAssets(
  document: DesignDocument,
): DesignAssetIndexEntry[] {
  const familiesByAssetId = indexImageAssetFamilies(document);
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
      const family = familiesByAssetId.get(assetId);
      const familyRootAssetId = family?.rootAssetIds[0] ?? assetId;
      const familyPosition = family?.assetIds.indexOf(assetId) ?? 0;
      const derivationOperation =
        family?.derivationIds
          .map(
            (derivationId) => document.imageAssetDerivationsById[derivationId],
          )
          .find((derivation) => derivation?.resultAssetId === assetId)
          ?.operation ?? null;
      const familyReferenceCount = (family?.assetIds ?? [assetId]).reduce(
        (count, candidateId) =>
          count +
          Object.values(document.nodesById).filter((node) =>
            nodeReferencesAsset(node, candidateId),
          ).length,
        0,
      );
      const familyAssetIds = family?.assetIds ?? [assetId];
      const familyInUse =
        familyReferenceCount > 0 ||
        [
          ...Object.values(document.stylesById),
          ...Object.values(document.libraryStylesById).map(
            (entry) => entry.style,
          ),
        ].some(
          (style) =>
            style.styleType === "PAINT" &&
            style.paints.some(
              (paint) =>
                paint.type === "image" &&
                familyAssetIds.includes(paint.assetId),
            ),
        );
      return {
        assetId,
        asset,
        name: asset?.name || assetId,
        previewDataUrl,
        references,
        referenceCount: references.length,
        status,
        derivationOperation,
        familyRootAssetId,
        familySize: family?.assetIds.length ?? 1,
        familyPosition,
        familyReferenceCount,
        familyInUse,
        isFamilyRoot: family?.rootAssetIds.includes(assetId) ?? true,
      };
    })
    .sort((left, right) => {
      const leftRootName =
        document.assetsById[left.familyRootAssetId]?.name ?? left.name;
      const rightRootName =
        document.assetsById[right.familyRootAssetId]?.name ?? right.name;
      return (
        leftRootName.localeCompare(rightRootName, undefined, {
          numeric: true,
          sensitivity: "base",
        }) ||
        left.familyPosition - right.familyPosition ||
        left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    });
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
  for (const paint of nodePaints(node)) {
    if (paint.type === "image") assetIds.push(paint.assetId);
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
