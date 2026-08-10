import type {
  DesignDocument,
  DesignNode,
  Transform,
} from "@opendesign/design-contracts";
import { getLocalSelectionBounds, multiplyTransforms } from "./geometry.js";

export type GroupBoundsFailureCode =
  "invalid-target" | "not-found" | "visual-fidelity";

export type GroupBoundsNormalizationResult =
  | { ok: true; groupIds: string[] }
  | { ok: false; code: GroupBoundsFailureCode; message: string };

export function normalizeGroupAncestorsInPlace(
  document: DesignDocument,
  startNodeIds: readonly (string | null)[],
): GroupBoundsNormalizationResult {
  const groupIds = new Set<string>();
  for (const startNodeId of startNodeIds) {
    collectGroupAncestors(document, startNodeId).forEach((groupId) =>
      groupIds.add(groupId),
    );
  }
  const deepestFirst = [...groupIds].sort(
    (left, right) => nodeDepth(document, right) - nodeDepth(document, left),
  );
  for (const groupId of deepestFirst) {
    const result = normalizeGroupInPlace(document, groupId);
    if (!result.ok) return result;
  }
  return { ok: true, groupIds: deepestFirst };
}

function collectGroupAncestors(
  document: DesignDocument,
  startNodeId: string | null,
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  let node = startNodeId ? document.nodesById[startNodeId] : undefined;
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    if (node.kind === "group") result.push(node.id);
    node = node.parentId ? document.nodesById[node.parentId] : undefined;
  }
  return result;
}

function nodeDepth(document: DesignDocument, nodeId: string): number {
  let depth = 0;
  const visited = new Set<string>();
  let node = document.nodesById[nodeId];
  while (node?.parentId && !visited.has(node.id)) {
    visited.add(node.id);
    depth += 1;
    node = document.nodesById[node.parentId];
  }
  return depth;
}

function normalizeGroupInPlace(
  document: DesignDocument,
  groupId: string,
): GroupBoundsNormalizationResult {
  const group = document.nodesById[groupId];
  if (!group || group.kind !== "group") {
    return failure("not-found", `Group ${groupId} does not exist`);
  }
  const children = group.childIds.map((nodeId) => document.nodesById[nodeId]);
  if (children.length === 0) {
    return failure("invalid-target", `Group ${groupId} cannot be left empty`);
  }
  if (children.some((node) => !node)) {
    return failure("not-found", `Group ${groupId} has a missing child`);
  }
  const bounds = getLocalSelectionBounds(
    children.filter((node): node is DesignNode => node !== undefined),
  );
  if (!bounds) {
    return failure(
      "visual-fidelity",
      `Group ${groupId} children have invalid bounds`,
    );
  }
  const offset: Transform = [1, 0, 0, 1, bounds.x, bounds.y];
  const compensate: Transform = [1, 0, 0, 1, -bounds.x, -bounds.y];
  group.transform = multiplyTransforms(group.transform, offset);
  group.size = { width: bounds.width, height: bounds.height };
  for (const child of children) {
    if (child)
      child.transform = multiplyTransforms(compensate, child.transform);
  }
  return { ok: true, groupIds: [groupId] };
}

function failure(
  code: GroupBoundsFailureCode,
  message: string,
): GroupBoundsNormalizationResult {
  return { ok: false, code, message };
}
