import type {
  DesignDocument,
  DesignOperation,
  Paint,
} from "@opendesign/design-contracts";
import {
  variableCollectionDefinitions,
  variableDefinitions,
} from "@opendesign/variable-service";
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
        | "set_variable_binding"
        | "put_library_variable_collection_source"
        | "delete_library_variable_collection_source"
        | "put_library_variable_source"
        | "delete_library_variable_source";
    }
  >,
): void {
  switch (command.type) {
    case "put_variable_collection": {
      if (document.libraryVariableCollectionsById[command.collection.id]) {
        throw new OperationError(
          command.commandId,
          `Collection ${command.collection.id} conflicts with a Library Collection`,
          "duplicate",
        );
      }
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
      if (document.libraryVariablesById[command.variable.id]) {
        throw new OperationError(
          command.commandId,
          `Variable ${command.variable.id} conflicts with a Library Variable`,
          "duplicate",
        );
      }
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
    case "put_library_variable_collection_source": {
      const collectionId = command.source.collection.id;
      if (document.variableCollectionsById[collectionId]) {
        throw new OperationError(
          command.commandId,
          `Library Collection ${collectionId} conflicts with a local Collection`,
          "duplicate",
        );
      }
      const current = document.libraryVariableCollectionsById[collectionId];
      if (current && !sameCollectionIdentity(current, command.source)) {
        throw new OperationError(
          command.commandId,
          `Library Collection ${collectionId} cannot change source identity`,
          "invalid",
        );
      }
      const duplicateKey = variableCollectionDefinitions(document).find(
        (collection) =>
          collection.id !== collectionId &&
          collection.key === command.source.collection.key,
      );
      if (duplicateKey) {
        throw new OperationError(
          command.commandId,
          `Collection key ${command.source.collection.key} is already used by ${duplicateKey.id}`,
          "duplicate",
        );
      }
      document.libraryVariableCollectionsById[collectionId] = structuredClone(
        command.source,
      );
      return;
    }
    case "delete_library_variable_collection_source": {
      if (!document.libraryVariableCollectionsById[command.collectionId]) {
        throw notFound(
          command.commandId,
          "Library Collection",
          command.collectionId,
        );
      }
      if (
        variableDefinitions(document).some(
          (variable) => variable.variableCollectionId === command.collectionId,
        )
      ) {
        throw new OperationError(
          command.commandId,
          `Library Collection ${command.collectionId} still owns Variables`,
          "invalid",
        );
      }
      delete document.libraryVariableCollectionsById[command.collectionId];
      return;
    }
    case "put_library_variable_source": {
      const variableId = command.source.variable.id;
      if (document.variablesById[variableId]) {
        throw new OperationError(
          command.commandId,
          `Library Variable ${variableId} conflicts with a local Variable`,
          "duplicate",
        );
      }
      const collection =
        document.libraryVariableCollectionsById[
          command.source.variable.variableCollectionId
        ];
      if (
        !collection ||
        !sameReleaseIdentity(collection.source, command.source.source)
      ) {
        throw new OperationError(
          command.commandId,
          `Library Variable ${variableId} requires its Collection from the same release`,
          "invalid",
        );
      }
      const current = document.libraryVariablesById[variableId];
      if (current && !sameVariableIdentity(current, command.source)) {
        throw new OperationError(
          command.commandId,
          `Library Variable ${variableId} cannot change source identity`,
          "invalid",
        );
      }
      if (
        current &&
        current.variable.resolvedType !== command.source.variable.resolvedType
      ) {
        throw new OperationError(
          command.commandId,
          "A Library Variable cannot change type after import",
          "invalid",
        );
      }
      const duplicateKey = variableDefinitions(document).find(
        (variable) =>
          variable.id !== variableId &&
          variable.key === command.source.variable.key,
      );
      if (duplicateKey) {
        throw new OperationError(
          command.commandId,
          `Variable key ${command.source.variable.key} is already used by ${duplicateKey.id}`,
          "duplicate",
        );
      }
      document.libraryVariablesById[variableId] = structuredClone(
        command.source,
      );
      return;
    }
    case "delete_library_variable_source": {
      if (!document.libraryVariablesById[command.variableId]) {
        throw notFound(
          command.commandId,
          "Library Variable",
          command.variableId,
        );
      }
      if (libraryVariableIsReferenced(document, command.variableId)) {
        throw new OperationError(
          command.commandId,
          `Library Variable ${command.variableId} is still referenced`,
          "invalid",
        );
      }
      delete document.libraryVariablesById[command.variableId];
      return;
    }
  }
}

function sameCollectionIdentity(
  current: DesignDocument["libraryVariableCollectionsById"][string],
  next: DesignDocument["libraryVariableCollectionsById"][string],
): boolean {
  return (
    current.source.sourceVariableCollectionId ===
      next.source.sourceVariableCollectionId &&
    sameReleaseIdentity(current.source, next.source, false)
  );
}

function sameVariableIdentity(
  current: DesignDocument["libraryVariablesById"][string],
  next: DesignDocument["libraryVariablesById"][string],
): boolean {
  return (
    current.source.sourceVariableId === next.source.sourceVariableId &&
    sameReleaseIdentity(current.source, next.source, false)
  );
}

function sameReleaseIdentity(
  current: {
    libraryId: string;
    releaseId: string;
    sourceProjectId: string;
    sourceDesignFileId: string;
    sourceDocumentId: string;
  },
  next: {
    libraryId: string;
    releaseId: string;
    sourceProjectId: string;
    sourceDesignFileId: string;
    sourceDocumentId: string;
  },
  includeRelease = true,
): boolean {
  return (
    current.libraryId === next.libraryId &&
    (!includeRelease || current.releaseId === next.releaseId) &&
    current.sourceProjectId === next.sourceProjectId &&
    current.sourceDesignFileId === next.sourceDesignFileId &&
    current.sourceDocumentId === next.sourceDocumentId
  );
}

function libraryVariableIsReferenced(
  document: DesignDocument,
  variableId: string,
): boolean {
  if (
    variableDefinitions(document).some(
      (variable) =>
        variable.id !== variableId &&
        Object.values(variable.valuesByMode).some(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            "type" in value &&
            value.type === "VARIABLE_ALIAS" &&
            value.id === variableId,
        ),
    )
  ) {
    return true;
  }
  return Object.values(document.nodesById).some((node) => {
    if (
      Object.values(node.boundVariables ?? {}).some(
        (alias) => alias.id === variableId,
      )
    ) {
      return true;
    }
    const paints = nodePaints(node, "fills") ?? [];
    const strokes = nodePaints(node, "strokes") ?? [];
    return [...paints, ...strokes].some(
      (paint) =>
        paint.type === "solid" &&
        paint.boundVariables?.color?.id === variableId,
    );
  });
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
