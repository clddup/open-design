import type {
  DesignDocument,
  DesignOperation,
  Paint,
} from "@opendesign/design-contracts";
import { OperationError } from "./operation-error.js";

export function applyVariableOperation(
  document: DesignDocument,
  command: Extract<
    DesignOperation,
    {
      type:
        | "put_variable_collection"
        | "delete_variable_collection"
        | "move_variable_collection"
        | "put_variable"
        | "delete_variable"
        | "set_explicit_variable_modes"
        | "set_variable_binding";
    }
  >,
): void {
  switch (command.type) {
    case "put_variable_collection": {
      const exists = Boolean(
        document.variableCollectionsById[command.collection.id],
      );
      document.variableCollectionsById[command.collection.id] = structuredClone(
        command.collection,
      );
      if (!exists) document.variableCollectionOrder.push(command.collection.id);
      return;
    }
    case "delete_variable_collection":
      if (!document.variableCollectionsById[command.collectionId]) {
        throw notFound(command.commandId, "Collection", command.collectionId);
      }
      if (
        Object.values(document.variablesById).some(
          (variable) => variable.variableCollectionId === command.collectionId,
        )
      ) {
        throw new OperationError(
          command.commandId,
          `Collection ${command.collectionId} still owns variables`,
        );
      }
      delete document.variableCollectionsById[command.collectionId];
      document.variableCollectionOrder.splice(
        document.variableCollectionOrder.indexOf(command.collectionId),
        1,
      );
      return;
    case "move_variable_collection": {
      const from = document.variableCollectionOrder.indexOf(
        command.collectionId,
      );
      if (from < 0) {
        throw notFound(command.commandId, "Collection", command.collectionId);
      }
      if (
        command.index < 0 ||
        command.index >= document.variableCollectionOrder.length
      ) {
        throw new OperationError(
          command.commandId,
          "Collection index is out of range",
        );
      }
      document.variableCollectionOrder.splice(from, 1);
      document.variableCollectionOrder.splice(
        command.index,
        0,
        command.collectionId,
      );
      return;
    }
    case "put_variable":
      document.variablesById[command.variable.id] = structuredClone(
        command.variable,
      );
      return;
    case "delete_variable":
      if (!document.variablesById[command.variableId]) {
        throw notFound(command.commandId, "Variable", command.variableId);
      }
      delete document.variablesById[command.variableId];
      return;
    case "set_explicit_variable_modes": {
      const target =
        command.target.kind === "page"
          ? document.pagesById[command.target.id]
          : document.nodesById[command.target.id];
      if (!target) {
        throw notFound(
          command.commandId,
          command.target.kind === "page" ? "Page" : "Node",
          command.target.id,
        );
      }
      if (Object.keys(command.explicitVariableModes).length === 0) {
        delete target.explicitVariableModes;
      } else {
        target.explicitVariableModes = structuredClone(
          command.explicitVariableModes,
        );
      }
      return;
    }
    case "set_variable_binding":
      setVariableBinding(document, command);
      return;
  }
}

function setVariableBinding(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "set_variable_binding" }>,
): void {
  const node = document.nodesById[command.target.nodeId];
  if (!node) throw notFound(command.commandId, "Node", command.target.nodeId);
  if (command.target.kind === "node") {
    if (command.target.field === "characters" && node.kind !== "text") {
      throw new OperationError(
        command.commandId,
        "characters variable binding requires a Text node",
      );
    }
    const next = { ...(node.boundVariables ?? {}) };
    if (command.variable) next[command.target.field] = command.variable;
    else delete next[command.target.field];
    if (Object.keys(next).length === 0) delete node.boundVariables;
    else node.boundVariables = next;
    return;
  }
  const paints = nodePaints(node, command.target.paintField);
  const paint = paints?.[command.target.paintIndex];
  if (!paint) {
    throw new OperationError(
      command.commandId,
      `${command.target.paintField} paint ${command.target.paintIndex} does not exist`,
      "not-found",
    );
  }
  if (paint.type !== "solid") {
    throw new OperationError(
      command.commandId,
      "Only SolidPaint color supports Variables v1",
    );
  }
  if (command.variable) {
    paint.boundVariables = { color: command.variable };
  } else {
    delete paint.boundVariables;
  }
}

function nodePaints(
  node: DesignDocument["nodesById"][string],
  field: "fills" | "strokes",
): Paint[] | undefined {
  if (
    node.kind === "frame" ||
    node.kind === "slot" ||
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "line" ||
    node.kind === "polygon" ||
    node.kind === "star" ||
    node.kind === "text" ||
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
  ) {
    return node.properties[field];
  }
  return undefined;
}

function notFound(commandId: string, kind: string, id: string): OperationError {
  return new OperationError(
    commandId,
    `${kind} ${id} does not exist`,
    "not-found",
  );
}
