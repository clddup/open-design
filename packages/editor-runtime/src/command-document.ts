import type { DesignDocument, DesignPage } from "@opendesign/design-contracts";
import { OperationError } from "./operation-error.js";

export interface NodeLocation {
  pageId: string;
  parentId: string | null;
  index: number;
}

export function targetChildren(
  document: DesignDocument,
  pageId: string,
  parentId: string | null,
  commandId: string,
): string[] {
  if (parentId === null) {
    return assertPage(document, pageId, commandId).rootNodeIds;
  }
  const parent = document.nodesById[parentId];
  if (!parent) throw nodeNotFound(commandId, parentId);
  if (
    parent.kind !== "frame" &&
    parent.kind !== "slot" &&
    parent.kind !== "group" &&
    parent.kind !== "boolean" &&
    parent.kind !== "instance"
  ) {
    throw new OperationError(
      commandId,
      `${parent.kind} nodes cannot contain children`,
    );
  }
  const location = locateNode(document, parentId);
  if (!location || location.pageId !== pageId) {
    throw new OperationError(
      commandId,
      `Parent ${parentId} is not on ${pageId}`,
    );
  }
  return parent.childIds;
}

export function assertPage(
  document: DesignDocument,
  pageId: string,
  commandId: string,
): DesignPage {
  const page = document.pagesById[pageId];
  if (!page) {
    throw new OperationError(
      commandId,
      `Page ${pageId} does not exist`,
      "not-found",
    );
  }
  return page;
}

export function assertIndex(
  children: readonly string[],
  index: number,
  commandId: string,
): void {
  if (index > children.length) {
    throw new OperationError(
      commandId,
      `Index ${index} exceeds child count ${children.length}`,
    );
  }
}

export function locateNode(
  document: DesignDocument,
  nodeId: string,
): NodeLocation | undefined {
  const visit = (
    pageId: string,
    parentId: string | null,
    childIds: readonly string[],
  ): NodeLocation | undefined => {
    const index = childIds.indexOf(nodeId);
    if (index >= 0) return { pageId, parentId, index };
    for (const childId of childIds) {
      const child = document.nodesById[childId];
      if (!child) continue;
      const found = visit(pageId, childId, child.childIds);
      if (found) return found;
    }
    return undefined;
  };
  for (const pageId of document.pageOrder) {
    const page = document.pagesById[pageId];
    if (!page) continue;
    const found = visit(pageId, null, page.rootNodeIds);
    if (found) return found;
  }
  return undefined;
}

export function collectSubtreeIds(
  document: DesignDocument,
  rootNodeId: string,
): string[] {
  const ids: string[] = [];
  const visit = (nodeId: string): void => {
    const node = document.nodesById[nodeId];
    if (!node) return;
    ids.push(nodeId);
    for (const childId of node.childIds) visit(childId);
  };
  visit(rootNodeId);
  return ids;
}

export function assertComponentSourcesRemain(
  document: DesignDocument,
  removedNodeIds: ReadonlySet<string>,
  commandId: string,
): void {
  if (removedNodeIds.size === 0) return;
  for (const component of Object.values(document.componentsById)) {
    if (!removedNodeIds.has(component.rootNodeId)) continue;
    throw new OperationError(
      commandId,
      `Component ${component.id} must be deleted or detached from its instances before removing main ${component.rootNodeId}`,
      "invalid",
      {
        path: `/componentsById/${escapeJsonPointer(component.id)}/rootNodeId`,
      },
    );
  }
}

export function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function nodeNotFound(
  commandId: string,
  nodeId: string,
): OperationError {
  return new OperationError(
    commandId,
    `Node ${nodeId} does not exist`,
    "not-found",
  );
}
