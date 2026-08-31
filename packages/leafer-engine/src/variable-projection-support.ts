import {
  nodePaints,
  type DesignDocument,
  type DesignNode,
} from "@opendesign/design-contracts";

export function pageUsesVariables(
  document: DesignDocument,
  rootNodeIds: readonly string[],
): boolean {
  for (const nodeId of collectNodeIds(document, rootNodeIds)) {
    const node = document.nodesById[nodeId];
    if (!node) continue;
    if (node.boundVariables && Object.keys(node.boundVariables).length > 0) {
      return true;
    }
    if (nodeHasBoundPaint(node)) return true;
  }
  return false;
}

function collectNodeIds(
  document: DesignDocument,
  rootNodeIds: readonly string[],
): Set<string> {
  const ids = new Set<string>();
  const visit = (nodeId: string) => {
    if (ids.has(nodeId)) return;
    ids.add(nodeId);
    document.nodesById[nodeId]?.childIds.forEach(visit);
  };
  rootNodeIds.forEach(visit);
  return ids;
}

function nodeHasBoundPaint(node: DesignNode): boolean {
  return nodePaints(node).some(
    (paint) => paint.type === "solid" && Boolean(paint.boundVariables?.color),
  );
}
