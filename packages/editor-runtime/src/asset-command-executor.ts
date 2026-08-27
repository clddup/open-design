import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
} from "@opendesign/design-contracts";
import { nodeNotFound } from "./command-document.js";
import { OperationError } from "./operation-error.js";

export function applyAssetCommand(
  document: DesignDocument,
  command: DesignOperation,
): boolean {
  switch (command.type) {
    case "put_asset":
      putAsset(document, command);
      return true;
    case "delete_asset":
      deleteAsset(document, command);
      return true;
    case "put_image_asset_derivation":
      putImageAssetDerivation(document, command);
      return true;
    case "delete_image_asset_derivation":
      deleteImageAssetDerivation(document, command);
      return true;
    default:
      return false;
  }
}

function putAsset(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "put_asset" }>,
): void {
  document.assetsById[command.asset.id] = structuredClone(command.asset);
}

function deleteAsset(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "delete_asset" }>,
): void {
  if (!document.assetsById[command.assetId]) {
    throw nodeNotFound(command.commandId, command.assetId);
  }
  const referencingNode = Object.values(document.nodesById).find((node) =>
    nodeAssetIds(node).includes(command.assetId),
  );
  if (referencingNode) {
    throw new OperationError(
      command.commandId,
      "design.asset.in_use_by_node",
      `Asset ${command.assetId} is still referenced by node ${referencingNode.id}`,
    );
  }
  const referencingStyle = [
    ...Object.values(document.stylesById),
    ...Object.values(document.libraryStylesById).map((entry) => entry.style),
  ].find(
    (style) =>
      style.styleType === "PAINT" &&
      style.paints.some(
        (paint) => paint.type === "image" && paint.assetId === command.assetId,
      ),
  );
  if (referencingStyle) {
    throw new OperationError(
      command.commandId,
      "design.asset.in_use_by_style",
      `Asset ${command.assetId} is still referenced by Style ${referencingStyle.id}`,
    );
  }
  const referencingDerivation = Object.values(
    document.imageAssetDerivationsById,
  ).find(
    (derivation) =>
      derivation.sourceAssetId === command.assetId ||
      derivation.resultAssetId === command.assetId ||
      derivation.maskAssetId === command.assetId ||
      derivation.referenceAssetIds.includes(command.assetId),
  );
  if (referencingDerivation) {
    throw new OperationError(
      command.commandId,
      "design.asset.in_use_by_derivation",
      `Asset ${command.assetId} is still referenced by image derivation ${referencingDerivation.id}`,
    );
  }
  delete document.assetsById[command.assetId];
}

function putImageAssetDerivation(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "put_image_asset_derivation" }>,
): void {
  const derivation = command.derivation;
  for (const assetId of [
    derivation.sourceAssetId,
    derivation.resultAssetId,
    ...(derivation.maskAssetId === undefined ? [] : [derivation.maskAssetId]),
    ...derivation.referenceAssetIds,
  ]) {
    const asset = document.assetsById[assetId];
    if (!asset || asset.kind !== "image") {
      throw new OperationError(
        command.commandId,
        "design.asset.derivation_asset_missing",
        `Image derivation ${derivation.id} references missing image asset ${assetId}`,
      );
    }
  }
  if (!document.imageAssetDerivationsById[derivation.id]) {
    document.imageAssetDerivationOrder.push(derivation.id);
  }
  document.imageAssetDerivationsById[derivation.id] =
    structuredClone(derivation);
}

function deleteImageAssetDerivation(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "delete_image_asset_derivation" }>,
): void {
  if (!document.imageAssetDerivationsById[command.derivationId]) {
    throw nodeNotFound(command.commandId, command.derivationId);
  }
  delete document.imageAssetDerivationsById[command.derivationId];
  document.imageAssetDerivationOrder =
    document.imageAssetDerivationOrder.filter(
      (derivationId) => derivationId !== command.derivationId,
    );
}

function nodeAssetIds(node: DesignNode): string[] {
  const ids: string[] = [];
  if (node.kind === "image") ids.push(node.properties.assetId);
  if (
    node.kind === "frame" ||
    node.kind === "slot" ||
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
    for (const paint of [
      ...node.properties.fills,
      ...node.properties.strokes,
      ...(node.kind === "text"
        ? (node.properties.runs ?? []).flatMap((run) => run.style.fills)
        : []),
    ]) {
      if (paint.type === "image") ids.push(paint.assetId);
    }
  }
  return ids;
}
