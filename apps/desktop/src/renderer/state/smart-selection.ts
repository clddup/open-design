import type { LeaferSmartSelectionMarkState } from "@opendesign/leafer-engine";

export type SmartSelectionScope = {
  documentId: string;
  nodeIds: readonly string[];
  pageId: string;
  revision: number;
};

export function isCurrentSmartSelectionMarkState(
  state: LeaferSmartSelectionMarkState | null,
  scope: SmartSelectionScope,
): state is LeaferSmartSelectionMarkState {
  return Boolean(
    state &&
    state.documentId === scope.documentId &&
    state.pageId === scope.pageId &&
    state.revision === scope.revision &&
    sameNodeSet(state.nodeIds, scope.nodeIds),
  );
}

export function sameNodeSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(right);
  return values.size === left.length && left.every((id) => values.has(id));
}
