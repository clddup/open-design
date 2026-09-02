import type {
  DesignDocument,
  DesignOperation,
  Guide,
} from "@opendesign/design-contracts";
import {
  assertComponentSourcesRemain,
  assertIndex,
  assertPage,
  collectSubtreeIds,
  nodeNotFound,
} from "./command-document.js";
import { OperationError } from "./operation-error.js";

export function applyPageCommand(
  document: DesignDocument,
  command: DesignOperation,
): boolean {
  switch (command.type) {
    case "insert_page":
      insertPage(document, command);
      return true;
    case "update_page":
      updatePage(document, command);
      return true;
    case "move_page":
      movePage(document, command);
      return true;
    case "delete_page":
      deletePage(document, command);
      return true;
    default:
      return false;
  }
}

function insertPage(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "insert_page" }>,
): void {
  if (document.pagesById[command.page.id]) {
    throw new OperationError(
      command.commandId,
      "design.page.duplicate",
      `Page ${command.page.id} already exists`,
      "duplicate",
    );
  }
  assertPageName(command.page.name, command.commandId);
  assertIndex(document.pageOrder, command.index, command.commandId);
  const insertedNodeIds = new Set<string>();
  for (const node of command.nodes) {
    if (insertedNodeIds.has(node.id)) {
      throw new OperationError(
        command.commandId,
        "design.page.duplicate_child",
        `Page contains duplicate node ${node.id}`,
        "duplicate",
      );
    }
    if (document.nodesById[node.id]) {
      throw new OperationError(
        command.commandId,
        "design.node.duplicate",
        `Node ${node.id} already exists`,
        "duplicate",
      );
    }
    insertedNodeIds.add(node.id);
  }
  document.pagesById[command.page.id] = structuredClone(command.page);
  document.pageOrder.splice(command.index, 0, command.page.id);
  for (const node of command.nodes) {
    document.nodesById[node.id] = structuredClone(node);
  }
}

function updatePage(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "update_page" }>,
): void {
  const page = assertPage(document, command.pageId, command.commandId);
  let changed = false;
  if (command.name !== undefined) {
    assertPageName(command.name, command.commandId);
    if (page.name !== command.name) {
      page.name = command.name;
      changed = true;
    }
  }
  if (
    command.guides !== undefined &&
    !sameGuides(page.guides ?? [], command.guides)
  ) {
    page.guides = structuredClone(command.guides);
    changed = true;
  }
  if (!changed) {
    throw new OperationError(
      command.commandId,
      command.name !== undefined && command.guides === undefined
        ? "design.page.name_unchanged"
        : "design.page.update_unchanged",
      command.name !== undefined && command.guides === undefined
        ? "Page name is unchanged"
        : "Page properties are unchanged",
    );
  }
}

function sameGuides(left: readonly Guide[], right: readonly Guide[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (guide, index) =>
        guide.axis === right[index]?.axis &&
        guide.offset === right[index]?.offset,
    )
  );
}

function movePage(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "move_page" }>,
): void {
  assertPage(document, command.pageId, command.commandId);
  const previousIndex = document.pageOrder.indexOf(command.pageId);
  if (previousIndex < 0) {
    throw nodeNotFound(command.commandId, command.pageId);
  }
  if (previousIndex === command.index) {
    throw new OperationError(
      command.commandId,
      "design.page.position_unchanged",
      "Page position is unchanged",
    );
  }
  document.pageOrder.splice(previousIndex, 1);
  assertIndex(document.pageOrder, command.index, command.commandId);
  document.pageOrder.splice(command.index, 0, command.pageId);
}

function deletePage(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "delete_page" }>,
): void {
  const page = assertPage(document, command.pageId, command.commandId);
  if (document.pageOrder.length <= 1) {
    throw new OperationError(
      command.commandId,
      "design.page.last_page_delete_forbidden",
      "A Design File must contain at least one Page",
    );
  }
  const nodeIds = page.rootNodeIds.flatMap((nodeId) =>
    collectSubtreeIds(document, nodeId),
  );
  assertComponentSourcesRemain(document, new Set(nodeIds), command.commandId);
  document.pageOrder.splice(document.pageOrder.indexOf(command.pageId), 1);
  delete document.pagesById[command.pageId];
  for (const nodeId of nodeIds) delete document.nodesById[nodeId];
}

function assertPageName(name: string, commandId: string): void {
  if (name !== name.trim()) {
    throw new OperationError(
      commandId,
      "design.page.name_whitespace",
      "Page name must not start or end with whitespace",
    );
  }
  if (name.length === 0 || name.length > 256) {
    throw new OperationError(
      commandId,
      "design.page.name_length",
      "Page name must contain from 1 to 256 characters",
    );
  }
  if (/\p{Cc}/u.test(name)) {
    throw new OperationError(
      commandId,
      "design.page.name_control_character",
      "Page name cannot contain controls",
    );
  }
}
