import type { DesignNode } from "@opendesign/design-contracts";

export function isVisibleDesignMaterial(node: DesignNode): boolean {
  if (
    node.kind === "group" ||
    node.kind === "frame" ||
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
