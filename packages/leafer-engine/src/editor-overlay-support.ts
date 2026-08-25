import type {
  DesignDocument,
  DesignNode,
  Transform,
} from "@opendesign/design-contracts";

const MATRIX_EPSILON = 0.000_001;

export function effectivelyLockedForEditorOverlay(
  document: DesignDocument,
  nodeId: string,
): boolean {
  const visited = new Set<string>();
  let current: DesignNode | undefined = document.nodesById[nodeId];
  while (current && !visited.has(current.id)) {
    if (current.locked) return true;
    visited.add(current.id);
    current = current.parentId
      ? document.nodesById[current.parentId]
      : undefined;
  }
  return false;
}

export function supportsAxisAlignedEditorOverlay(
  transform: Transform,
): boolean {
  return (
    Math.abs(transform[1]) <= MATRIX_EPSILON &&
    Math.abs(transform[2]) <= MATRIX_EPSILON &&
    transform[0] > MATRIX_EPSILON &&
    transform[3] > MATRIX_EPSILON
  );
}

export function hasTranslationOnlyTransform(transform: Transform): boolean {
  return (
    transform[0] === 1 &&
    transform[1] === 0 &&
    transform[2] === 0 &&
    transform[3] === 1
  );
}
