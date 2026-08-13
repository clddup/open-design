import type { DesignNode } from "@opendesign/design-contracts";

export function clearOrphanedFlowProperties(node: DesignNode): void {
  delete node.layoutSizing;
  const ownFlow =
    node.kind === "frame" ? node.properties.autoLayout : undefined;
  if (!ownFlow || ownFlow.mode === "none") delete node.layoutLimits;
}
