import {
  isValidLayoutLimits,
  type DesignDocument,
  type DesignNode,
  type LayoutLimits,
} from "@opendesign/design-contracts";
import type { AutoLayoutOperationPlan } from "./auto-layout-operations.js";

export function planSetNodeLayoutLimits(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  limits: LayoutLimits | null,
  commandPrefix: string,
): AutoLayoutOperationPlan {
  const node = document.nodesById[nodeId];
  if (!node) return failure("not-found", `Layer ${nodeId} does not exist`);
  if (!nodeBelongsToPage(document, pageId, nodeId)) {
    return failure(
      "invalid-target",
      `Layer ${nodeId} is not on Page ${pageId}`,
    );
  }
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  const parentFlow =
    parent?.kind === "frame" || parent?.kind === "slot"
      ? parent.properties.autoLayout
      : undefined;
  const ownFlow =
    node.kind === "frame" || node.kind === "slot"
      ? node.properties.autoLayout
      : undefined;
  const isFlowChild = parentFlow !== undefined && parentFlow.mode !== "none";
  const isFlowFrame = ownFlow !== undefined && ownFlow.mode !== "none";
  if (!isFlowChild && !isFlowFrame) {
    return failure(
      "invalid-target",
      "Layout limits require an Auto Layout Frame or a direct child participating in Auto Layout",
    );
  }
  if (isEffectivelyLocked(document, nodeId)) {
    return failure("locked", "Locked layers cannot change layout limits");
  }
  if (limits !== null && !isValidLayoutLimits(limits)) {
    return failure(
      "invalid-target",
      "Layout limits must be non-negative, non-empty, and each minimum must not exceed its maximum",
    );
  }
  if (JSON.stringify(node.layoutLimits ?? null) === JSON.stringify(limits)) {
    return failure("no-op", "Layer already uses the requested layout limits");
  }
  return {
    ok: true,
    commands: [
      {
        commandId: `${commandPrefix}_limits`,
        type: "update_properties",
        nodeId,
        layoutLimits: limits,
      },
    ],
    frameId: isFlowFrame ? node.id : (parent?.id ?? node.id),
    nodeIds: [nodeId],
  };
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const roots = new Set(document.pagesById[pageId]?.rootNodeIds ?? []);
  const visited = new Set<string>();
  let current: DesignNode | undefined = document.nodesById[nodeId];
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parentId === null) return roots.has(current.id);
    current = document.nodesById[current.parentId];
  }
  return false;
}

function isEffectivelyLocked(
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

function failure(
  code: Extract<AutoLayoutOperationPlan, { ok: false }>["code"],
  message: string,
): AutoLayoutOperationPlan {
  return { ok: false, code, message };
}
