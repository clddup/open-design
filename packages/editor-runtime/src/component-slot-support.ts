import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";

export function hasSlotAncestor(
  document: DesignDocument,
  node: DesignNode,
): boolean {
  const visited = new Set<string>();
  let parentId = node.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = document.nodesById[parentId];
    if (!parent) return false;
    if (parent.kind === "slot") return true;
    parentId = parent.parentId;
  }
  return false;
}

export function hasSlotDescendant(
  document: DesignDocument,
  node: DesignNode,
): boolean {
  const pending = [...node.childIds];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const child = document.nodesById[nodeId];
    if (child?.kind === "slot") return true;
    if (child) pending.push(...child.childIds);
  }
  return false;
}
