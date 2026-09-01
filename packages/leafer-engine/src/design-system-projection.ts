import type {
  DesignChangeSet,
  DesignDocument,
} from "@opendesign/design-contracts";
import { materializeSharedStyles } from "@opendesign/style-service";
import { materializeVariableBindings } from "@opendesign/variable-service";
import type { LeaferFidelityWarning } from "./types.js";
import { pageUsesVariables } from "./variable-projection-support.js";

export function materializeDesignSystems(
  document: DesignDocument,
  nodesById: DesignDocument["nodesById"],
): { document: DesignDocument; warnings: LeaferFidelityWarning[] } {
  const styleProjection = materializeSharedStyles({ ...document, nodesById });
  const variableProjection = materializeVariableBindings(
    styleProjection.document,
  );
  return {
    document: variableProjection.document,
    warnings: [
      ...styleProjection.issues.map((issue) => ({
        code: "style-resolution-failed" as const,
        message: issue.message,
        nodeId: issue.nodeId ?? "document",
      })),
      ...variableProjection.issues.map((issue) => ({
        code: "variable-resolution-failed" as const,
        message: issue.message,
        nodeId: issue.path.match(/^\/nodesById\/([^/]+)/)?.[1] ?? "document",
      })),
    ],
  };
}

export function pageUsesDesignSystems(
  document: DesignDocument,
  rootNodeIds: readonly string[],
): boolean {
  if (pageUsesVariables(document, rootNodeIds)) return true;
  const pending = [...rootNodeIds];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node) continue;
    if (
      node.fillStyleId ||
      node.strokeStyleId ||
      node.effectStyleId ||
      node.textStyleId ||
      node.gridStyleId
    ) {
      return true;
    }
    if (
      (node.kind === "path" || node.kind === "vector") &&
      "network" in node.properties &&
      node.properties.network.regions.some(
        (region) => region.fillStyleId !== undefined,
      )
    ) {
      return true;
    }
    pending.push(...node.childIds);
  }
  return false;
}

export function designSystemChangesRequireProjection(
  changes: DesignChangeSet,
): boolean {
  return (
    (changes.addedStyleIds?.length ?? 0) > 0 ||
    (changes.changedStyleIds?.length ?? 0) > 0 ||
    (changes.removedStyleIds?.length ?? 0) > 0
  );
}
