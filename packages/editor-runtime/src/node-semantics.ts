import type { DesignNode } from "@opendesign/design-contracts";

export function isContainerNode(node: DesignNode): boolean {
  return (
    node.kind === "frame" ||
    node.kind === "slot" ||
    node.kind === "group" ||
    node.kind === "boolean" ||
    node.kind === "instance"
  );
}

export function isBooleanOperandNode(node: DesignNode): boolean {
  return (
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "polygon" ||
    node.kind === "star" ||
    node.kind === "text" ||
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
  );
}
