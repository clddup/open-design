import type {
  DesignDocument,
  DesignOperation,
} from "@opendesign/design-contracts";
import { nodeNotFound } from "./command-document.js";
import { OperationError } from "./operation-error.js";

export function applyComponentSourceCommand(
  document: DesignDocument,
  command: DesignOperation,
): boolean {
  switch (command.type) {
    case "put_component":
      putComponent(document, command);
      return true;
    case "delete_component":
      deleteComponent(document, command);
      return true;
    case "put_library_component_source":
      putLibraryComponentSource(document, command);
      return true;
    case "delete_library_component_source":
      deleteLibraryComponentSource(document, command);
      return true;
    case "put_library_variant_set_source":
      putLibraryVariantSetSource(document, command);
      return true;
    case "delete_library_variant_set_source":
      deleteLibraryVariantSetSource(document, command);
      return true;
    default:
      return false;
  }
}

function putComponent(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "put_component" }>,
): void {
  const existing = document.componentsById[command.component.id];
  if (existing && existing.rootNodeId !== command.component.rootNodeId) {
    throw new OperationError(
      command.commandId,
      "design.component.id_conflict",
      `Component ${command.component.id} is already bound to ${existing.rootNodeId}`,
      "duplicate",
    );
  }
  document.componentsById[command.component.id] = structuredClone(
    command.component,
  );
}

function deleteComponent(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "delete_component" }>,
): void {
  if (!document.componentsById[command.componentId]) {
    throw nodeNotFound(command.commandId, command.componentId);
  }
  const referencingInstance = Object.values(document.nodesById).find(
    (node) =>
      node.kind === "instance" &&
      node.properties.componentId === command.componentId,
  );
  if (referencingInstance) {
    throw new OperationError(
      command.commandId,
      "design.component.in_use",
      `Component ${command.componentId} is still referenced by instance ${referencingInstance.id}`,
    );
  }
  delete document.componentsById[command.componentId];
}

function putLibraryComponentSource(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "put_library_component_source" }>,
): void {
  const componentId = command.source.component.id;
  if (document.componentsById[componentId]) {
    throw new OperationError(
      command.commandId,
      "design.library_component.conflicts_local",
      `Library component ${componentId} conflicts with a local component`,
      "duplicate",
    );
  }
  const existing = document.libraryComponentsById[componentId];
  if (existing) {
    assertStableLibraryIdentity(
      command.commandId,
      existing.source,
      command.source.source,
      "sourceComponentId",
      componentId,
    );
  }
  document.libraryComponentsById[componentId] = structuredClone(command.source);
}

function deleteLibraryComponentSource(
  document: DesignDocument,
  command: Extract<
    DesignOperation,
    { type: "delete_library_component_source" }
  >,
): void {
  if (!document.libraryComponentsById[command.componentId]) {
    throw nodeNotFound(command.commandId, command.componentId);
  }
  const persistentInstance = Object.values(document.nodesById).find(
    (node) =>
      node.kind === "instance" &&
      node.properties.componentId === command.componentId,
  );
  if (persistentInstance) {
    throw new OperationError(
      command.commandId,
      "design.library_component.in_use_by_instance",
      `Library component ${command.componentId} is still referenced by instance ${persistentInstance.id}`,
    );
  }
  const dependentSource = Object.values(document.libraryComponentsById).find(
    (source) =>
      source.component.id !== command.componentId &&
      source.dependencyComponentIds.includes(command.componentId),
  );
  if (dependentSource) {
    throw new OperationError(
      command.commandId,
      "design.library_component.dependency_in_use",
      `Library component ${command.componentId} is still required by ${dependentSource.component.id}`,
    );
  }
  const definitionReference = allComponentDefinitions(document).find(
    (component) =>
      component.id !== command.componentId &&
      Object.values(component.componentPropertyDefinitions).some(
        (definition) =>
          (definition.type === "INSTANCE_SWAP" &&
            definition.defaultValue === command.componentId) ||
          ((definition.type === "INSTANCE_SWAP" ||
            definition.type === "SLOT") &&
            definition.preferredValues?.some(
              (preferred) =>
                preferred.type === "COMPONENT" &&
                preferred.key === command.componentId,
            )),
      ),
  );
  if (definitionReference) {
    throw new OperationError(
      command.commandId,
      "design.library_component.definition_in_use",
      `Library component ${command.componentId} is still referenced by component ${definitionReference.id}`,
    );
  }
  const variantSet = Object.values(document.libraryVariantSetsById).find(
    (source) =>
      document.libraryComponentsById[command.componentId]?.component
        .variantSetId === source.variantSet.id,
  );
  if (variantSet) {
    throw new OperationError(
      command.commandId,
      "design.library_component.variant_member_in_use",
      `Library component ${command.componentId} is still a member of variant set ${variantSet.variantSet.id}`,
    );
  }
  delete document.libraryComponentsById[command.componentId];
}

function putLibraryVariantSetSource(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "put_library_variant_set_source" }>,
): void {
  const variantSetId = command.source.variantSet.id;
  if (document.variantSetsById[variantSetId]) {
    throw new OperationError(
      command.commandId,
      "design.library_variant_set.conflicts_local",
      `Library variant set ${variantSetId} conflicts with a local variant set`,
      "duplicate",
    );
  }
  const existing = document.libraryVariantSetsById[variantSetId];
  if (existing) {
    assertStableLibraryIdentity(
      command.commandId,
      existing.source,
      command.source.source,
      "sourceVariantSetId",
      variantSetId,
    );
  }
  document.libraryVariantSetsById[variantSetId] = structuredClone(
    command.source,
  );
}

function deleteLibraryVariantSetSource(
  document: DesignDocument,
  command: Extract<
    DesignOperation,
    { type: "delete_library_variant_set_source" }
  >,
): void {
  if (!document.libraryVariantSetsById[command.variantSetId]) {
    throw nodeNotFound(command.commandId, command.variantSetId);
  }
  const member = allComponentDefinitions(document).find(
    (component) => component.variantSetId === command.variantSetId,
  );
  if (member) {
    throw new OperationError(
      command.commandId,
      "design.library_variant_set.member_in_use",
      `Library variant set ${command.variantSetId} is still referenced by component ${member.id}`,
    );
  }
  const preferredBy = allComponentDefinitions(document).find((component) =>
    Object.values(component.componentPropertyDefinitions).some(
      (definition) =>
        (definition.type === "INSTANCE_SWAP" || definition.type === "SLOT") &&
        definition.preferredValues?.some(
          (preferred) =>
            preferred.type === "COMPONENT_SET" &&
            preferred.key === command.variantSetId,
        ),
    ),
  );
  if (preferredBy) {
    throw new OperationError(
      command.commandId,
      "design.library_variant_set.preferred_in_use",
      `Library variant set ${command.variantSetId} is still preferred by component ${preferredBy.id}`,
    );
  }
  delete document.libraryVariantSetsById[command.variantSetId];
}

function assertStableLibraryIdentity(
  commandId: string,
  existing: Record<string, string>,
  replacement: Record<string, string>,
  sourceEntityField: "sourceComponentId" | "sourceVariantSetId",
  entityId: string,
): void {
  const stableFields = [
    "libraryId",
    "sourceProjectId",
    "sourceDesignFileId",
    "sourceDocumentId",
    sourceEntityField,
  ] as const;
  const changed = stableFields.find(
    (field) => existing[field] !== replacement[field],
  );
  if (!changed) return;
  throw new OperationError(
    commandId,
    "design.library_source.identity_changed",
    `Library source identity for ${entityId} cannot change ${changed}; import it under a new stable id`,
    "invalid",
  );
}

function allComponentDefinitions(document: DesignDocument) {
  return [
    ...Object.values(document.componentsById),
    ...Object.values(document.libraryComponentsById).map(
      (source) => source.component,
    ),
  ];
}
