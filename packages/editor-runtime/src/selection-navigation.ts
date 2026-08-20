import type { DesignDocument } from "@opendesign/design-contracts";
import { isEffectivelyLocked } from "./layer-operations.js";

export type BooleanSelectionDirection =
  "enter" | "exit" | "next-operand" | "previous-operand";

export type LayerSelectionDirection =
  "enter" | "exit" | "next-sibling" | "previous-sibling";

export interface BooleanEditScope {
  booleanId: string;
  operandIds: readonly string[];
  readOnly: boolean;
  selectedOperandIds: readonly string[];
}

/**
 * Boolean edit scope is transient editor state derived from selection. It is
 * never persisted in DesignDocument and does not create another writable
 * scene. Only direct operands of one Boolean can share a scope.
 */
export function resolveBooleanEditScope(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): BooleanEditScope | null {
  if (nodeIds.length === 0 || !document.pagesById[pageId]) return null;
  const selected = [...new Set(nodeIds)];
  if (selected.length !== nodeIds.length) return null;
  const first = document.nodesById[selected[0] ?? ""];
  const booleanId = first?.parentId;
  if (!booleanId) return null;
  const parent = document.nodesById[booleanId];
  if (
    !parent ||
    parent.kind !== "boolean" ||
    !nodeBelongsToPage(document, pageId, parent.id)
  ) {
    return null;
  }
  const operands = new Set(parent.childIds);
  if (
    selected.some((nodeId) => {
      const node = document.nodesById[nodeId];
      return !node || node.parentId !== parent.id || !operands.has(node.id);
    })
  ) {
    return null;
  }
  return {
    booleanId: parent.id,
    operandIds: [...parent.childIds],
    readOnly:
      isEffectivelyLocked(document, parent.id) ||
      selected.some((nodeId) => isEffectivelyLocked(document, nodeId)),
    selectedOperandIds: selected,
  };
}

export function navigateBooleanSelection(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  direction: BooleanSelectionDirection,
): string | null {
  if (nodeIds.length !== 1) return null;
  const node = document.nodesById[nodeIds[0] ?? ""];
  if (!node || !nodeBelongsToPage(document, pageId, node.id)) return null;

  if (direction === "enter") {
    if (node.kind !== "boolean" || node.childIds.length < 2) return null;
    return (
      [...node.childIds]
        .reverse()
        .find((childId) => document.nodesById[childId]?.visible) ??
      node.childIds.at(-1) ??
      null
    );
  }

  const scope = resolveBooleanEditScope(document, pageId, nodeIds);
  if (!scope) return null;
  if (direction === "exit") return scope.booleanId;
  const index = scope.operandIds.indexOf(node.id);
  if (index < 0) return null;
  const offset = direction === "next-operand" ? 1 : -1;
  return scope.operandIds[index + offset] ?? null;
}

export function navigateLayerSelection(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  direction: LayerSelectionDirection,
): string | null {
  if (nodeIds.length !== 1) return null;
  const node = document.nodesById[nodeIds[0] ?? ""];
  if (!node || !nodeBelongsToPage(document, pageId, node.id)) return null;

  if (direction === "enter") {
    return (
      [...node.childIds]
        .reverse()
        .find((childId) => document.nodesById[childId]?.visible) ?? null
    );
  }
  if (direction === "exit") return node.parentId;

  const siblings = node.parentId
    ? document.nodesById[node.parentId]?.childIds
    : document.pagesById[pageId]?.rootNodeIds;
  if (!siblings) return null;
  const index = siblings.indexOf(node.id);
  if (index < 0) return null;
  const offset = direction === "next-sibling" ? 1 : -1;
  for (let candidateIndex = index + offset; ; candidateIndex += offset) {
    const candidateId = siblings[candidateIndex];
    if (!candidateId) return null;
    if (document.nodesById[candidateId]?.visible) return candidateId;
  }
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const roots = new Set(document.pagesById[pageId]?.rootNodeIds ?? []);
  let currentId: string | undefined = nodeId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    if (roots.has(currentId)) return true;
    visited.add(currentId);
    currentId = document.nodesById[currentId]?.parentId ?? undefined;
  }
  return false;
}
