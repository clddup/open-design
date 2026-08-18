import type { DesignNode } from "@opendesign/design-contracts";

export function clearOrphanedFlowProperties(node: DesignNode): void {
  delete node.layoutPositioning;
  delete node.layoutSizing;
  delete node.gridPlacement;
  const ownFlow =
    node.kind === "frame" || node.kind === "slot"
      ? node.properties.autoLayout
      : undefined;
  if (!ownFlow || ownFlow.mode === "none") delete node.layoutLimits;
}

export function cleanReparentedLayoutProperties(
  node: DesignNode,
  targetParent: DesignNode | undefined,
): void {
  const targetUsesFlow =
    (targetParent?.kind === "frame" || targetParent?.kind === "slot") &&
    (targetParent.properties.autoLayout?.mode ?? "none") !== "none";
  if (
    (targetParent?.kind !== "frame" && targetParent?.kind !== "slot") ||
    (targetUsesFlow && node.layoutPositioning !== "absolute")
  ) {
    delete node.constraints;
  }
  if (!targetUsesFlow) clearOrphanedFlowProperties(node);
  else if (targetParent.properties.autoLayout?.mode !== "grid")
    delete node.gridPlacement;
}
