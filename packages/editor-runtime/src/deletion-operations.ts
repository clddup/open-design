import {
  MAX_TRANSACTION_COMMANDS,
  type ComponentDefinition,
  type ComponentPropertyReferences,
  type DesignDocument,
  type DesignOperation,
} from "@opendesign/design-contracts";
import {
  componentSourceNodeIds,
  resolveComponentInstance,
} from "@opendesign/component-service";
import { planDetachComponentInstance } from "./component-operations.js";
import { canDeleteNodes } from "./layer-operations.js";

export type DeleteNodesFailureCode =
  "invalid-selection" | "invalid-reference" | "operation-limit";

export type DeleteNodesPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      rootNodeIds: readonly string[];
    }
  | {
      ok: false;
      code: DeleteNodesFailureCode;
      message: string;
    };

type ReferenceCleanupPlan =
  | { ok: true; commands: DesignOperation[] }
  | {
      ok: false;
      code: Exclude<DeleteNodesFailureCode, "invalid-selection">;
      message: string;
    };

export function planDeleteNodes(
  document: DesignDocument,
  input: { nodeIds: readonly string[]; commandPrefix: string },
): DeleteNodesPlan {
  if (!canDeleteNodes(document, input.nodeIds)) {
    return failure(
      "invalid-selection",
      "The selected layers cannot be deleted from their current hierarchy",
    );
  }
  const rootNodeIds = topLevelNodeIds(document, input.nodeIds);
  const deletedNodeIds = collectSubtrees(document, rootNodeIds);
  const cleanup = planReferenceCleanup(
    document,
    deletedNodeIds,
    input.commandPrefix,
  );
  if (!cleanup.ok) return cleanup;
  const commands: DesignOperation[] = [
    ...cleanup.commands,
    ...rootNodeIds.map((nodeId, index): DesignOperation => ({
      commandId: `${input.commandPrefix}_delete_root_${index}`,
      type: "delete_element",
      nodeId,
    })),
  ];
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Deleting these layers requires ${commands.length} commands, exceeding the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return { ok: true, commands, rootNodeIds };
}

export function planPageDeletionReferenceCleanup(
  document: DesignDocument,
  pageId: string,
  commandPrefix: string,
): ReferenceCleanupPlan {
  const page = document.pagesById[pageId];
  if (!page) {
    return failure("invalid-reference", `Page ${pageId} does not exist`);
  }
  return planReferenceCleanup(
    document,
    collectSubtrees(document, page.rootNodeIds),
    commandPrefix,
  );
}

function planReferenceCleanup(
  document: DesignDocument,
  deletedNodeIds: ReadonlySet<string>,
  commandPrefix: string,
): ReferenceCleanupPlan {
  const affectedComponentIds = new Set(
    Object.values(document.componentsById)
      .filter((component) => deletedNodeIds.has(component.rootNodeId))
      .map((component) => component.id),
  );
  if (affectedComponentIds.size === 0) return { ok: true, commands: [] };

  const affectedVariantSetIds = new Set(
    Object.values(document.variantSetsById)
      .filter((set) => deletedNodeIds.has(set.rootNodeId))
      .map((set) => set.id),
  );
  for (const componentId of affectedComponentIds) {
    const component = document.componentsById[componentId];
    if (
      component?.variantSetId &&
      !affectedVariantSetIds.has(component.variantSetId)
    ) {
      return failure(
        "invalid-reference",
        `Variant ${component.id} must be removed through its Component Set`,
      );
    }
  }
  for (const setId of affectedVariantSetIds) {
    const survivingMember = Object.values(document.componentsById).find(
      (component) =>
        component.variantSetId === setId &&
        !affectedComponentIds.has(component.id),
    );
    if (survivingMember) {
      return failure(
        "invalid-reference",
        `Component Set ${setId} cannot be deleted without all of its variants`,
      );
    }
  }

  const affectedSourceNodeIds = new Set<string>();
  for (const componentId of affectedComponentIds) {
    for (const nodeId of componentSourceNodeIds(document, componentId)) {
      affectedSourceNodeIds.add(nodeId);
    }
  }

  const detachCandidates = new Set<string>();
  for (const node of Object.values(document.nodesById)) {
    if (node.kind !== "instance") continue;
    const resolution = resolveComponentInstance(document, node.id);
    if (!resolution.ok) {
      return failure(
        "invalid-reference",
        resolution.issues[0]?.message ??
          `Instance ${node.id} cannot be resolved before deletion`,
      );
    }
    if (
      affectedComponentIds.has(node.properties.componentId) ||
      affectedComponentIds.has(resolution.componentId) ||
      resolution.nodes.some((resolved) =>
        affectedSourceNodeIds.has(resolved.sourceNodeId),
      )
    ) {
      detachCandidates.add(node.id);
    }
  }

  const detachRootIds = topLevelWithinSet(document, detachCandidates);
  const detachedOriginalNodeIds = collectSubtrees(document, detachRootIds);
  const reservedNodeIds = new Set<string>();
  const commands: DesignOperation[] = [];
  for (const [index, instanceId] of detachRootIds.entries()) {
    const detached = planDetachComponentInstance(document, {
      instanceId,
      commandPrefix: `${commandPrefix}_preserve_instance_${index}`,
      reservedNodeIds,
    });
    if (!detached.ok) {
      return failure("invalid-reference", detached.message);
    }
    commands.push(...detached.commands);
    for (const command of detached.commands) {
      if (command.type !== "replace_subtree") continue;
      command.nodes.forEach((node) => reservedNodeIds.add(node.id));
    }
  }

  const removedPropertiesByComponentId = new Map<string, ReadonlySet<string>>();
  const nextComponentsById = new Map<string, ComponentDefinition>();
  for (const component of Object.values(document.componentsById)) {
    if (affectedComponentIds.has(component.id)) continue;
    const next = structuredClone(component);
    const removedProperties = new Set<string>();
    let changed = false;
    for (const [propertyName, definition] of Object.entries(
      next.componentPropertyDefinitions,
    )) {
      if (
        definition.type === "INSTANCE_SWAP" &&
        affectedComponentIds.has(definition.defaultValue)
      ) {
        delete next.componentPropertyDefinitions[propertyName];
        removedProperties.add(propertyName);
        changed = true;
        continue;
      }
      if (
        (definition.type === "INSTANCE_SWAP" || definition.type === "SLOT") &&
        definition.preferredValues
      ) {
        const preferredValues = definition.preferredValues.filter(
          (preferred) =>
            !(
              (preferred.type === "COMPONENT" &&
                affectedComponentIds.has(preferred.key)) ||
              (preferred.type === "COMPONENT_SET" &&
                affectedVariantSetIds.has(preferred.key))
            ),
        );
        if (preferredValues.length !== definition.preferredValues.length) {
          definition.preferredValues = preferredValues;
          changed = true;
        }
      }
    }
    if (removedProperties.size > 0) {
      next.componentPropertyOrder = next.componentPropertyOrder.filter(
        (propertyName) => !removedProperties.has(propertyName),
      );
      removedPropertiesByComponentId.set(component.id, removedProperties);
    }
    if (changed) nextComponentsById.set(component.id, next);
  }

  for (const [
    componentId,
    removedProperties,
  ] of removedPropertiesByComponentId) {
    for (const sourceNodeId of componentSourceNodeIds(document, componentId)) {
      if (
        deletedNodeIds.has(sourceNodeId) ||
        detachedOriginalNodeIds.has(sourceNodeId)
      ) {
        continue;
      }
      const source = document.nodesById[sourceNodeId];
      if (!source?.componentPropertyReferences) continue;
      const references = Object.fromEntries(
        Object.entries(source.componentPropertyReferences).filter(
          ([, propertyName]) => !removedProperties.has(propertyName),
        ),
      ) as ComponentPropertyReferences;
      if (
        Object.keys(references).length ===
        Object.keys(source.componentPropertyReferences).length
      ) {
        continue;
      }
      commands.push({
        commandId: `${commandPrefix}_unbind_deleted_property_${commands.length}`,
        type: "update_properties",
        nodeId: source.id,
        componentPropertyReferences:
          Object.keys(references).length > 0 ? references : null,
      });
    }
  }

  for (const node of Object.values(document.nodesById)) {
    if (
      node.kind !== "instance" ||
      deletedNodeIds.has(node.id) ||
      detachedOriginalNodeIds.has(node.id) ||
      affectedComponentIds.has(node.properties.componentId)
    ) {
      continue;
    }
    const removedProperties =
      removedPropertiesByComponentId.get(node.properties.componentId) ??
      new Set<string>();
    const nextComponent =
      nextComponentsById.get(node.properties.componentId) ??
      document.componentsById[node.properties.componentId];
    const nextAssignments = { ...node.properties.componentProperties };
    let changed = false;
    for (const [propertyName, value] of Object.entries(nextAssignments)) {
      const definition =
        nextComponent?.componentPropertyDefinitions[propertyName];
      if (
        removedProperties.has(propertyName) ||
        (definition?.type === "INSTANCE_SWAP" &&
          typeof value === "string" &&
          affectedComponentIds.has(value))
      ) {
        delete nextAssignments[propertyName];
        changed = true;
      }
    }
    if (changed) {
      commands.push({
        commandId: `${commandPrefix}_reset_deleted_assignment_${commands.length}`,
        type: "update_properties",
        nodeId: node.id,
        properties: { componentProperties: nextAssignments },
      });
    }
  }

  for (const component of [...nextComponentsById.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    commands.push({
      commandId: `${commandPrefix}_update_component_${commands.length}`,
      type: "put_component",
      component,
    });
  }
  for (const componentId of [...affectedComponentIds].sort()) {
    commands.push({
      commandId: `${commandPrefix}_delete_component_${commands.length}`,
      type: "delete_component",
      componentId,
    });
  }
  for (const variantSetId of [...affectedVariantSetIds].sort()) {
    commands.push({
      commandId: `${commandPrefix}_delete_component_set_${commands.length}`,
      type: "delete_variant_set",
      variantSetId,
    });
  }
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Preserving component references requires ${commands.length} commands, exceeding the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return { ok: true, commands };
}

function collectSubtrees(
  document: DesignDocument,
  rootNodeIds: Iterable<string>,
): ReadonlySet<string> {
  const result = new Set<string>();
  const visit = (nodeId: string): void => {
    if (result.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;
    result.add(nodeId);
    node.childIds.forEach(visit);
  };
  for (const rootNodeId of rootNodeIds) visit(rootNodeId);
  return result;
}

function topLevelNodeIds(
  document: DesignDocument,
  nodeIds: readonly string[],
): string[] {
  return topLevelWithinSet(document, new Set(nodeIds));
}

function topLevelWithinSet(
  document: DesignDocument,
  nodeIds: ReadonlySet<string>,
): string[] {
  return [...nodeIds]
    .filter((nodeId) => {
      let parentId = document.nodesById[nodeId]?.parentId ?? null;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        if (nodeIds.has(parentId)) return false;
        visited.add(parentId);
        parentId = document.nodesById[parentId]?.parentId ?? null;
      }
      return true;
    })
    .sort((left, right) => left.localeCompare(right));
}

function failure<TCode extends DeleteNodesFailureCode>(
  code: TCode,
  message: string,
): { ok: false; code: TCode; message: string } {
  return { ok: false, code, message };
}
