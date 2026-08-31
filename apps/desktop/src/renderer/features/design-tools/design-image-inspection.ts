import {
  nodePaints,
  type DesignDocument,
  type DesignNode,
} from "@opendesign/design-contracts";
import { indexImageAssetFamilies } from "@opendesign/editor-runtime";
import {
  DesignImageInspectionContract,
  type DesignImageInspection,
} from "@/shared/design-image-inspection-contract";

const MAX_INSPECTED_STAGED_IMAGE_ASSETS = 64;
const MAX_INSPECTED_IMAGE_DERIVATIONS = 64;
const MAX_EXPANDED_IMAGE_ASSETS = MAX_INSPECTED_IMAGE_DERIVATIONS * 2;

export function createScopedImageInspection(
  document: DesignDocument,
  nodesById: Readonly<Record<string, DesignNode>>,
): DesignImageInspection {
  const assetIds = collectScopedAssetIds(nodesById);
  addStagedAssetIds(document, assetIds);
  expandAssetFamilies(document, assetIds);

  const matchingDerivations = document.imageAssetDerivationOrder.flatMap(
    (derivationId) => {
      const derivation = document.imageAssetDerivationsById[derivationId];
      return derivation &&
        (assetIds.has(derivation.sourceAssetId) ||
          assetIds.has(derivation.resultAssetId))
        ? [derivation]
        : [];
    },
  );
  const inspectedDerivations = matchingDerivations.slice(
    0,
    MAX_INSPECTED_IMAGE_DERIVATIONS,
  );
  for (const derivation of inspectedDerivations) {
    assetIds.add(derivation.sourceAssetId);
    assetIds.add(derivation.resultAssetId);
    if (derivation.maskAssetId) assetIds.add(derivation.maskAssetId);
    derivation.referenceAssetIds.forEach((assetId) => assetIds.add(assetId));
  }

  const inspection = {
    assetsById: projectAssets(document, assetIds),
    imageAssetDerivations: inspectedDerivations.map((derivation) => ({
      id: derivation.id,
      sourceAssetId: derivation.sourceAssetId,
      resultAssetId: derivation.resultAssetId,
      operation: derivation.operation,
      ...(derivation.maskAssetId === undefined
        ? {}
        : { maskAssetId: derivation.maskAssetId }),
      referenceAssetIds: [...derivation.referenceAssetIds],
      promptPresent: derivation.prompt !== undefined,
    })),
    imageAssetDerivationsTruncated:
      matchingDerivations.length > MAX_INSPECTED_IMAGE_DERIVATIONS,
  } satisfies DesignImageInspection;
  const parsed = DesignImageInspectionContract.parse(inspection);
  if (!parsed.ok) {
    const first = parsed.issues[0];
    throw new Error(
      `Invalid image inspection projection at ${first?.path ?? "/"}: ${first?.message ?? "unknown contract failure"}`,
    );
  }
  return parsed.value;
}

function collectScopedAssetIds(
  nodesById: Readonly<Record<string, DesignNode>>,
): Set<string> {
  const assetIds = new Set<string>();
  for (const node of Object.values(nodesById)) {
    if (node.kind === "image") assetIds.add(node.properties.assetId);
    for (const paint of nodePaints(node)) {
      if (paint.type === "image") assetIds.add(paint.assetId);
    }
  }
  return assetIds;
}

function addStagedAssetIds(
  document: DesignDocument,
  assetIds: Set<string>,
): void {
  Object.values(document.assetsById)
    .filter(
      (asset) =>
        asset.kind === "image" &&
        asset.extensions.generatedBy === "opendesign-agent",
    )
    .slice(-MAX_INSPECTED_STAGED_IMAGE_ASSETS)
    .forEach((asset) => assetIds.add(asset.id));
}

function expandAssetFamilies(
  document: DesignDocument,
  assetIds: Set<string>,
): void {
  if (assetIds.size >= MAX_EXPANDED_IMAGE_ASSETS) return;
  const familiesByAssetId = indexImageAssetFamilies(document);
  for (const seedAssetId of [...assetIds]) {
    const family = familiesByAssetId.get(seedAssetId);
    if (!family) continue;
    for (const assetId of family.assetIds) {
      assetIds.add(assetId);
      if (assetIds.size >= MAX_EXPANDED_IMAGE_ASSETS) return;
    }
  }
}

function projectAssets(
  document: DesignDocument,
  assetIds: ReadonlySet<string>,
): DesignImageInspection["assetsById"] {
  return Object.fromEntries(
    [...assetIds].flatMap((assetId) => {
      const asset = document.assetsById[assetId];
      if (!asset || asset.kind !== "image") return [];
      return [
        [
          assetId,
          {
            id: asset.id,
            kind: asset.kind,
            name: asset.name,
            mimeType: asset.mimeType,
            sourceType: asset.source.type,
            ...(asset.size === undefined
              ? {}
              : { size: structuredClone(asset.size) }),
            extensionKeys: inspectedExtensionKeys(asset.extensions),
            ...(asset.extensions.generatedBy === "opendesign-agent"
              ? {
                  availability: "design-file" as const,
                  generated: true as const,
                  ...(typeof asset.extensions.designRole === "string"
                    ? { designRole: asset.extensions.designRole }
                    : {}),
                }
              : {}),
          },
        ],
      ] as const;
    }),
  );
}

function inspectedExtensionKeys(
  extensions: DesignDocument["assetsById"][string]["extensions"],
): string[] {
  const keys = Object.keys(extensions);
  if (keys.length <= 1_024) return keys;
  const required = ["generatedBy", "designRole"].filter((key) =>
    Object.hasOwn(extensions, key),
  );
  return [...required, ...keys.filter((key) => !required.includes(key))].slice(
    0,
    1_024,
  );
}
