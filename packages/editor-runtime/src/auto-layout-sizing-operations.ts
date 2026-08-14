import {
  DEFAULT_AUTO_LAYOUT_FRAME_SIZING,
  DEFAULT_LAYOUT_SIZING,
  type DesignDocument,
  type DesignNode,
  type LayoutSizing,
} from "@opendesign/design-contracts";
import type { AutoLayoutOperationPlan } from "./auto-layout-operations.js";

export function planSetNodeLayoutSizing(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  sizing: LayoutSizing,
  commandPrefix: string,
): AutoLayoutOperationPlan {
  const node = document.nodesById[nodeId];
  if (!node) return failure("not-found", `Layer ${nodeId} does not exist`);
  if (!nodeBelongsToPage(document, pageId, nodeId))
    return failure(
      "invalid-target",
      `Layer ${nodeId} is not on Page ${pageId}`,
    );
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  const flow =
    parent?.kind === "frame" || parent?.kind === "slot"
      ? parent.properties.autoLayout
      : undefined;
  if (!flow || flow.mode === "none")
    return failure(
      "invalid-target",
      "Auto Layout sizing requires a direct child of an Auto Layout Frame",
    );
  if (parent?.kind !== "frame" && parent?.kind !== "slot")
    return failure("invalid-target", "Auto Layout parent Frame is unavailable");
  if (isEffectivelyLocked(document, nodeId))
    return failure("locked", "Locked layers cannot change Auto Layout sizing");
  if (
    (node.kind === "group" || node.kind === "boolean") &&
    (sizing.horizontal === "fill" || sizing.vertical === "fill")
  )
    return failure(
      "visual-fidelity",
      `${node.kind} bounds follow their contents and cannot fill an Auto Layout axis`,
    );
  if (
    node.kind === "text" &&
    ((node.properties.textResize === "auto-width" &&
      (sizing.horizontal === "fill" || sizing.vertical === "fill")) ||
      (node.properties.textResize === "auto-height" &&
        sizing.vertical === "fill"))
  )
    return failure(
      "visual-fidelity",
      `Text ${node.properties.textResize} sizing conflicts with the requested fill axis`,
    );
  const frameSizing = flow.sizing ?? DEFAULT_AUTO_LAYOUT_FRAME_SIZING;
  if (
    node.visible &&
    flow.mode === "horizontal" &&
    flow.wrap &&
    (sizing.horizontal === "fill" || sizing.vertical === "fill")
  )
    return failure(
      "visual-fidelity",
      `Wrapped Auto Layout v1 does not support Fill child ${nodeId}`,
    );
  if (
    node.visible &&
    ((frameSizing.horizontal === "hug" && sizing.horizontal === "fill") ||
      (frameSizing.vertical === "hug" && sizing.vertical === "fill"))
  )
    return failure(
      "visual-fidelity",
      `Layer ${nodeId} cannot fill an axis hugged by Frame ${parent.id}`,
    );
  const current = node.layoutSizing ?? DEFAULT_LAYOUT_SIZING;
  if (
    current.horizontal === sizing.horizontal &&
    current.vertical === sizing.vertical
  )
    return failure("no-op", "Layer already uses the requested layout sizing");
  return {
    ok: true,
    commands: [
      {
        commandId: `${commandPrefix}_sizing`,
        type: "update_properties",
        nodeId,
        layoutSizing:
          sizing.horizontal === "fixed" && sizing.vertical === "fixed"
            ? null
            : sizing,
      },
    ],
    frameId: parent.id,
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
