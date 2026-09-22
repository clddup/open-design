import type { DesignNode } from "@opendesign/design-contracts";

/** A painted section Frame is visible layout progress, not finished content. */
export function isVisibleDesignProgress(node: DesignNode): boolean {
  if (
    node.kind === "group" ||
    node.kind === "slice" ||
    node.kind === "instance" ||
    !node.visible ||
    node.opacity <= 0 ||
    node.size.width <= 0 ||
    node.size.height <= 0
  )
    return false;
  if (node.kind === "image") return true;
  if (node.kind === "text" && node.properties.content.trim().length === 0)
    return false;
  const visiblePaint = (paint: (typeof node.properties.fills)[number]) =>
    paint.visible !== false && paint.opacity > 0;
  return (
    node.properties.fills.some(visiblePaint) ||
    (node.properties.strokeWidth > 0 &&
      node.properties.strokes.some(visiblePaint))
  );
}

type DesignSubtreeNode = { childIds: readonly string[]; kind: string };

/**
 * The subtree below (not including) `rootId` holds at least one authored content
 * layer instead of only Frame/Group containers. Final delivery verification and
 * artboard recovery share this judgment; a painted layout Frame is visible
 * progress but is not a content layer.
 */
export function subtreeHasContentLayer(
  nodesById: ReadonlyMap<string, DesignSubtreeNode>,
  rootId: string,
): boolean {
  const pending = [...(nodesById.get(rootId)?.childIds ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) continue;
    if (node.kind !== "group" && node.kind !== "frame") return true;
    pending.push(...node.childIds);
  }
  return false;
}
