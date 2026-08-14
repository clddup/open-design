import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";

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
    (paint) => paint.type === "solid" && Boolean(paint.boundVariables?.color),
  );
}
