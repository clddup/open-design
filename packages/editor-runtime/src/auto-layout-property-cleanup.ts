import type { DesignNode } from "@opendesign/design-contracts";

export function clearOrphanedFlowProperties(node: DesignNode): void {
  delete node.layoutPositioning;
  delete node.layoutSizing;
  const ownFlow =
    node.kind === "frame" ? node.properties.autoLayout : undefined;
  if (!ownFlow || ownFlow.mode === "none") delete node.layoutLimits;
}

export function cleanReparentedLayoutProperties(
  node: DesignNode,
  targetParent: DesignNode | undefined,
): void {
  const targetUsesFlow =
    targetParent?.kind === "frame" &&
    (targetParent.properties.autoLayout?.mode ?? "none") !== "none";
  if (
    targetParent?.kind !== "frame" ||
    (targetUsesFlow && node.layoutPositioning !== "absolute")
  ) {
    delete node.constraints;
  }
  if (!targetUsesFlow) clearOrphanedFlowProperties(node);
}
