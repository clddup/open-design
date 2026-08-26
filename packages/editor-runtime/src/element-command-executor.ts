import {
  DesignNodeSchema,
  schemaValidationIssues,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
} from "@opendesign/design-contracts";
import {
  assertComponentSourcesRemain,
  assertIndex,
  assertPage,
  collectSubtreeIds,
  escapeJsonPointer,
  locateNode,
  nodeNotFound,
  targetChildren,
} from "./command-document.js";
import { synchronizeComponentPropertyDefaults } from "./component-property-defaults.js";
import { applySlotStretchOnInsert } from "./component-slot-operations.js";
import { OperationError } from "./operation-error.js";
import { detachStyleReferencesForUpdate } from "./style-runtime.js";
import {
  finalizeTextNodePropertyUpdate,
  prepareInsertedTextNode,
  prepareTextNodePropertyUpdate,
  type TextCommandContext,
} from "./text-command-executor.js";

export function applyElementCommand(
  document: DesignDocument,
  command: DesignOperation,
  context: TextCommandContext,
): boolean {
  switch (command.type) {
    case "insert_element":
      insertElement(document, command, context);
      return true;
    case "update_properties":
      updateProperties(document, command, context);
      return true;
    case "move_element":
      moveElement(document, command);
      return true;
    case "delete_element":
      deleteElement(document, command);
      return true;
    case "replace_subtree":
      replaceSubtree(document, command, context);
      return true;
    default:
      return false;
  }
}

function insertElement(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "insert_element" }>,
  context: TextCommandContext,
): void {
  if (document.nodesById[command.node.id]) {
    throw new OperationError(
      command.commandId,
      `Node ${command.node.id} already exists`,
      "duplicate",
    );
  }
  assertPage(document, command.pageId, command.commandId);
  const target = targetChildren(
    document,
    command.pageId,
    command.parentId,
    command.commandId,
  );
  assertIndex(target, command.index, command.commandId);
  document.nodesById[command.node.id] = structuredClone(command.node);
  const inserted = document.nodesById[command.node.id];
  if (inserted && command.parentId) {
    applySlotStretchOnInsert(document, command.parentId, inserted);
  }
  if (inserted?.kind === "text") {
    prepareInsertedTextNode(inserted, command.commandId, context);
  }
  target.splice(command.index, 0, command.node.id);
}

function updateProperties(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "update_properties" }>,
  context: TextCommandContext,
): void {
  const node = document.nodesById[command.nodeId];
  if (!node) throw nodeNotFound(command.commandId, command.nodeId);
  detachStyleReferencesForUpdate(document, node, command);
  if (node.kind === "instance" && command.size !== undefined) {
    throw new OperationError(
      command.commandId,
      "Instance size follows its main component; resize the main component or detach the instance",
      "invalid",
      { path: `/nodesById/${escapeJsonPointer(node.id)}/size` },
    );
  }
  assertBooleanOperandUpdateAllowed(document, node, command);
  if (node.kind === "text") {
    if (
      command.properties &&
      (Object.hasOwn(command.properties, "runs") ||
        Object.hasOwn(command.properties, "paragraphRuns"))
    ) {
      throw new OperationError(
        command.commandId,
        "Text character and paragraph runs cannot be replaced through update_properties; use update_text_range_style or replace the complete Text node",
        "invalid",
        {
          path: `/nodesById/${escapeJsonPointer(node.id)}/properties/${
            Object.hasOwn(command.properties, "paragraphRuns")
              ? "paragraphRuns"
              : "runs"
          }`,
        },
      );
    }
    prepareTextNodePropertyUpdate(node, command);
  }
  const fields = [
    "name",
    "visible",
    "locked",
    "transform",
    "size",
    "opacity",
    "constraints",
    "layoutPositioning",
    "layoutSizing",
    "layoutLimits",
    "gridPlacement",
    "componentPropertyReferences",
    "blendMode",
    "effects",
    "maskMode",
    "exportSettings",
    "properties",
    "extensions",
  ] as const;
  for (const field of fields) {
    const value = command[field];
    if (value === undefined) continue;
    if (
      (field === "constraints" ||
        field === "layoutPositioning" ||
        field === "layoutSizing" ||
        field === "layoutLimits" ||
        field === "gridPlacement" ||
        field === "componentPropertyReferences") &&
      value === null
    ) {
      delete node[field];
      continue;
    }
    if (field === "properties" || field === "extensions") {
      Object.assign(node[field], structuredClone(value));
    } else {
      Object.assign(node, { [field]: structuredClone(value) });
    }
  }
  synchronizeComponentPropertyDefaults(document, node, command);
  if (node.kind === "text") {
    finalizeTextNodePropertyUpdate(node, command, context);
  }
  const schemaIssues = schemaValidationIssues(DesignNodeSchema, node);
  if (schemaIssues.length > 0) {
    const details = schemaIssues.slice(0, 128).map((issue) => ({
      path: `/nodesById/${escapeJsonPointer(node.id)}${issue.path}`,
      message: issue.message,
    }));
    const firstIssue = details[0];
    throw new OperationError(
      command.commandId,
      `Properties are invalid for ${node.kind} node ${node.id}: ${firstIssue?.message ?? "node does not match its kind"}`,
      "invalid",
      {
        ...(firstIssue ? { path: firstIssue.path } : {}),
        issues: details.map((issue) => ({
          code: "design.node_schema_invalid",
          commandId: command.commandId,
          path: issue.path,
          message: issue.message,
        })),
      },
    );
  }
}

function moveElement(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "move_element" }>,
): void {
  const node = document.nodesById[command.nodeId];
  if (!node) throw nodeNotFound(command.commandId, command.nodeId);
  assertPage(document, command.pageId, command.commandId);
  const oldLocation = locateNode(document, command.nodeId);
  if (!oldLocation) throw nodeNotFound(command.commandId, command.nodeId);
  const oldChildren = targetChildren(
    document,
    oldLocation.pageId,
    oldLocation.parentId,
    command.commandId,
  );
  oldChildren.splice(oldLocation.index, 1);
  const target = targetChildren(
    document,
    command.pageId,
    command.parentId,
    command.commandId,
  );
  assertIndex(target, command.index, command.commandId);
  target.splice(command.index, 0, command.nodeId);
  node.parentId = command.parentId;
}

function deleteElement(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "delete_element" }>,
): void {
  const node = document.nodesById[command.nodeId];
  const location = locateNode(document, command.nodeId);
  if (!node || !location) {
    throw nodeNotFound(command.commandId, command.nodeId);
  }
  const deletedIds = new Set(collectSubtreeIds(document, command.nodeId));
  assertComponentSourcesRemain(document, deletedIds, command.commandId);
  const source = targetChildren(
    document,
    location.pageId,
    location.parentId,
    command.commandId,
  );
  source.splice(location.index, 1);
  for (const nodeId of deletedIds) delete document.nodesById[nodeId];
}

function replaceSubtree(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "replace_subtree" }>,
  context: TextCommandContext,
): void {
  const current = document.nodesById[command.rootNodeId];
  if (!current) throw nodeNotFound(command.commandId, command.rootNodeId);
  const replacement = new Map(command.nodes.map((node) => [node.id, node]));
  const root = replacement.get(command.rootNodeId)!;
  if (root.parentId !== current.parentId) {
    throw new OperationError(
      command.commandId,
      "Replacement root must preserve its parent",
    );
  }
  const oldIds = new Set(collectSubtreeIds(document, command.rootNodeId));
  const removedIds = new Set(
    [...oldIds].filter((nodeId) => !replacement.has(nodeId)),
  );
  assertComponentSourcesRemain(document, removedIds, command.commandId);
  for (const node of command.nodes) {
    if (!oldIds.has(node.id) && document.nodesById[node.id]) {
      throw new OperationError(
        command.commandId,
        `Node ${node.id} already exists outside the replaced subtree`,
        "duplicate",
      );
    }
  }
  for (const nodeId of oldIds) delete document.nodesById[nodeId];
  for (const node of command.nodes) {
    document.nodesById[node.id] = structuredClone(node);
  }
  for (const node of command.nodes) {
    const replacementNode = document.nodesById[node.id];
    if (replacementNode?.kind !== "text") continue;
    prepareInsertedTextNode(replacementNode, command.commandId, context);
  }
}

function assertBooleanOperandUpdateAllowed(
  document: DesignDocument,
  node: DesignNode,
  command: Extract<DesignOperation, { type: "update_properties" }>,
): void {
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  if (parent?.kind !== "boolean") return;
  if (
    command.opacity !== undefined ||
    command.blendMode !== undefined ||
    command.effects !== undefined ||
    command.maskMode !== undefined
  ) {
    throw new OperationError(
      command.commandId,
      "Boolean operand appearance is controlled by its Boolean parent",
    );
  }
  const properties = command.properties;
  if (!properties) return;
  const appearanceFields = [
    "fills",
    "strokes",
    "strokeWidth",
    "strokeAlign",
    "strokeCap",
    "strokeJoin",
    "dashPattern",
  ];
  if (appearanceFields.some((field) => Object.hasOwn(properties, field))) {
    throw new OperationError(
      command.commandId,
      "Boolean operand fill and stroke are controlled by its Boolean parent",
    );
  }
}
