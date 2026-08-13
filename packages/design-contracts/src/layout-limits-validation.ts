import type { DesignDocument, DesignOperation } from "./index.js";
import { isValidLayoutLimits } from "./layout.js";

export function designDocumentHasValidLayoutLimits(
  document: DesignDocument,
): boolean {
  return Object.values(document.nodesById).every((node) =>
    isValidLayoutLimits(node.layoutLimits),
  );
}

export function designOperationHasValidLayoutLimits(
  operation: DesignOperation,
): boolean {
  if (operation.type === "insert_element")
    return isValidLayoutLimits(operation.node.layoutLimits);
  if (operation.type === "replace_subtree")
    return operation.nodes.every((node) =>
      isValidLayoutLimits(node.layoutLimits),
    );
  if (operation.type === "update_properties")
    return (
      operation.layoutLimits === null ||
      isValidLayoutLimits(operation.layoutLimits)
    );
  return true;
}
