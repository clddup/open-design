import type { DesignDocument } from "@opendesign/design-contracts";
import type { DocumentInvariantIssue } from "./layout-document-invariants.js";
import { jsonPointerToken, ownValue } from "./document-map-utils.js";

export function validateImageAssetDerivationInvariants(
  document: DesignDocument,
): DocumentInvariantIssue[] {
  const issues: DocumentInvariantIssue[] = [];
  const orderedIds = new Set(document.imageAssetDerivationOrder);
  for (const [
    index,
    derivationId,
  ] of document.imageAssetDerivationOrder.entries()) {
    if (!ownValue(document.imageAssetDerivationsById, derivationId)) {
      issues.push({
        path: `/imageAssetDerivationOrder/${index}`,
        message: `image asset derivation ${derivationId} does not exist`,
      });
    }
  }

  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const [derivationId, derivation] of Object.entries(
    document.imageAssetDerivationsById,
  )) {
    const path = `/imageAssetDerivationsById/${jsonPointerToken(derivationId)}`;
    if (derivation.id !== derivationId) {
      issues.push({
        path: `${path}/id`,
        message: "image asset derivation id must match its map key",
      });
    }
    if (!orderedIds.has(derivationId)) {
      issues.push({
        path,
        message:
          "image asset derivation must be present in imageAssetDerivationOrder",
      });
    }
    if (derivation.sourceAssetId === derivation.resultAssetId) {
      issues.push({
        path: `${path}/resultAssetId`,
        message: "image asset derivation cannot derive an asset from itself",
      });
    }
    for (const [field, assetId] of [
      ["sourceAssetId", derivation.sourceAssetId],
      ["resultAssetId", derivation.resultAssetId],
      ...(derivation.maskAssetId === undefined
        ? []
        : [["maskAssetId", derivation.maskAssetId]]),
      ...derivation.referenceAssetIds.map((assetId, index) => [
        `referenceAssetIds/${index}`,
        assetId,
      ]),
    ] as const) {
      const asset = ownValue(document.assetsById, assetId);
      if (!asset || asset.kind !== "image") {
        issues.push({
          path: `${path}/${field}`,
          message: `image asset ${assetId} does not exist`,
        });
      }
    }
    if (
      derivation.maskAssetId === derivation.resultAssetId ||
      derivation.referenceAssetIds.includes(derivation.resultAssetId)
    ) {
      issues.push({
        path,
        message: "an image derivation result cannot also be one of its inputs",
      });
    }
    const results = outgoing.get(derivation.sourceAssetId) ?? [];
    results.push(derivation.resultAssetId);
    outgoing.set(derivation.sourceAssetId, results);
    incomingCount.set(
      derivation.resultAssetId,
      (incomingCount.get(derivation.resultAssetId) ?? 0) + 1,
    );
    incomingCount.set(
      derivation.sourceAssetId,
      incomingCount.get(derivation.sourceAssetId) ?? 0,
    );
  }

  const pendingAssetIds = [...incomingCount.entries()].flatMap(
    ([assetId, count]) => (count === 0 ? [assetId] : []),
  );
  let visitedAssetCount = 0;
  while (pendingAssetIds.length > 0) {
    const sourceAssetId = pendingAssetIds.pop();
    if (!sourceAssetId) continue;
    visitedAssetCount += 1;
    for (const resultAssetId of outgoing.get(sourceAssetId) ?? []) {
      const nextCount = (incomingCount.get(resultAssetId) ?? 0) - 1;
      incomingCount.set(resultAssetId, nextCount);
      if (nextCount === 0) pendingAssetIds.push(resultAssetId);
    }
  }
  if (visitedAssetCount < incomingCount.size) {
    issues.push({
      path: "/imageAssetDerivationsById",
      message: "image asset derivations must form an acyclic graph",
    });
  }
  return issues;
}
