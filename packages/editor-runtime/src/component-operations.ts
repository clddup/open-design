import {
  componentSourcePathKey,
  componentSourceNodeIds,
  resolveComponentInstance,
} from "@opendesign/component-service";
import type {
  ComponentOverridePatch,
  DesignDocument,
  DesignNode,
  DesignOperation,
  InstanceNode,
  Transform,
} from "@opendesign/design-contracts";

export type ComponentOperationFailureCode =
  | "duplicate"
  | "invalid"
  | "missing-component"
  | "missing-instance"
  | "missing-source-node"
  | "no-op";

export type ComponentOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      componentId: string;
      instanceId?: string;
      mainNodeId: string;
      selectionNodeIds: readonly string[];
    }
  | {
      ok: false;
      code: ComponentOperationFailureCode;
      message: string;
    };

export function planCreateComponent(
  document: DesignDocument,
  input: {
    componentId: string;
    nodeId: string;
    name: string;
    commandPrefix: string;
  },
): ComponentOperationPlan {
  if (document.componentsById[input.componentId]) {
    return failure(
      "duplicate",
      `Component ${input.componentId} already exists`,
    );
  }
  const node = document.nodesById[input.nodeId];
  if (!node)
    return failure(
      "missing-source-node",
      `Layer ${input.nodeId} does not exist`,
    );
  if (node.kind === "instance") {
    return failure(
      "invalid",
      "Create a component from a main layer, not an instance",
    );
  }
  if (!isContainer(node)) {
    return failure("invalid", "A component root must be a Frame or Group");
  }
  if (componentIdForAnySource(document, node.id)) {
    return failure("duplicate", "This layer already belongs to a component");
  }
  const name = input.name.trim();
  if (!name) return failure("invalid", "Component name cannot be empty");
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_put_component`,
        type: "put_component",
        component: {
          id: input.componentId,
          name,
          rootNodeId: node.id,
          componentPropertyOrder: [],
          componentPropertyDefinitions: {},
          variantProperties: {},
          extensions: {},
        },
      },
    ],
    componentId: input.componentId,
    mainNodeId: node.id,
    selectionNodeIds: [node.id],
  };
}

export function planCreateInstance(
  document: DesignDocument,
  input: {
    componentId: string;
    instanceId: string;
    name?: string;
    pageId: string;
    parentId: string | null;
    index: number;
    transform: Transform;
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const component = document.componentsById[input.componentId];
  if (!component) {
    return failure(
      "missing-component",
      `Component ${input.componentId} does not exist`,
    );
  }
  if (document.nodesById[input.instanceId]) {
    return failure("duplicate", `Layer ${input.instanceId} already exists`);
  }
  const root = document.nodesById[component.rootNodeId];
  if (!root) {
    return failure(
      "missing-source-node",
      `Component root ${component.rootNodeId} does not exist`,
    );
  }
  const instance: InstanceNode = {
    id: input.instanceId,
    name: input.name?.trim() || component.name,
    parentId: input.parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [...input.transform],
    size: { ...root.size },
    opacity: 1,
    extensions: {},
    kind: "instance",
    properties: {
      componentId: component.id,
      componentProperties: {},
      overrides: [],
    },
  };
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_insert_instance`,
        type: "insert_element",
        pageId: input.pageId,
        parentId: input.parentId,
        index: input.index,
        node: instance,
      },
    ],
    componentId: component.id,
    instanceId: instance.id,
    mainNodeId: component.rootNodeId,
    selectionNodeIds: [instance.id],
  };
}

export function planRemoveComponent(
  document: DesignDocument,
  input: { componentId: string; commandPrefix: string },
): ComponentOperationPlan {
  const component = document.componentsById[input.componentId];
  if (!component) {
    return failure(
      "missing-component",
      `Component ${input.componentId} does not exist`,
    );
  }
  if (component.variantSetId) {
    return failure(
      "invalid",
      `Component ${input.componentId} belongs to set ${component.variantSetId}; remove or dissolve the Component Set as one operation`,
    );
  }
  const referencingInstance = Object.values(document.nodesById).find(
    (node) =>
      node.kind === "instance" &&
      node.properties.componentId === input.componentId,
  );
  if (referencingInstance) {
    return failure(
      "invalid",
      `Detach or delete instance ${referencingInstance.id} before removing component ${input.componentId}`,
    );
  }
  const commands: DesignOperation[] = [];
  for (const definition of Object.values(
    component.componentPropertyDefinitions,
  )) {
    if (definition.type !== "SLOT") continue;
    const slot = document.nodesById[definition.defaultValue];
    if (slot?.kind !== "slot" || slot.properties.sourceSlotId !== null) {
      return failure(
        "invalid",
        `Component Slot ${definition.defaultValue} is unavailable`,
      );
    }
    const nodes: DesignNode[] = [];
    const visit = (nodeId: string): void => {
      const source = document.nodesById[nodeId];
      if (!source) return;
      if (source.id === slot.id && source.kind === "slot") {
        const { sourceSlotId: _sourceSlotId, ...properties } =
          source.properties;
        void _sourceSlotId;
        nodes.push({
          ...structuredClone(source),
          kind: "frame",
          properties: structuredClone(properties),
        });
      } else {
        nodes.push(structuredClone(source));
      }
      source.childIds.forEach(visit);
    };
    visit(slot.id);
    commands.push({
      commandId: `${input.commandPrefix}_convert_slot_${commands.length}`,
      type: "replace_subtree",
      rootNodeId: slot.id,
      nodes,
    });
  }
  for (const sourceNodeId of componentSourceNodeIds(document, component.id)) {
    const source = document.nodesById[sourceNodeId];
    if (!source?.componentPropertyReferences) continue;
    commands.push({
      commandId: `${input.commandPrefix}_unbind_property_${commands.length}`,
      type: "update_properties",
      nodeId: source.id,
      componentPropertyReferences: null,
    });
  }
  commands.push({
    commandId: `${input.commandPrefix}_delete_component`,
    type: "delete_component",
    componentId: component.id,
  });
  return {
    ok: true,
    commands,
    componentId: component.id,
    mainNodeId: component.rootNodeId,
    selectionNodeIds: [component.rootNodeId],
  };
}

export function planSetComponentOverride(
  document: DesignDocument,
  input: {
    instanceId: string;
    sourcePath: readonly string[];
    patch: ComponentOverridePatch;
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const instance = document.nodesById[input.instanceId];
  if (!instance || instance.kind !== "instance") {
    return failure(
      "missing-instance",
      `Instance ${input.instanceId} does not exist`,
    );
  }
  const resolution = resolveComponentInstance(document, instance.id);
  if (!resolution.ok) {
    return failure(
      "invalid",
      resolution.issues[0]?.message ?? "Instance cannot be resolved",
    );
  }
  const key = componentSourcePathKey(input.sourcePath);
  if (!resolution.sourcePaths.has(key)) {
    return failure(
      "missing-source-node",
      `Override target ${input.sourcePath.join(" / ")} does not exist`,
    );
  }
  const existing = instance.properties.overrides.find(
    (override) => componentSourcePathKey(override.sourcePath) === key,
  );
  const mergedPatch: ComponentOverridePatch = {
    ...structuredClone(existing?.patch ?? {}),
    ...structuredClone(input.patch),
    ...(existing?.patch.properties || input.patch.properties
      ? {
          properties: {
            ...(existing?.patch.properties ?? {}),
            ...(input.patch.properties ?? {}),
          },
        }
      : {}),
  };
  const next = instance.properties.overrides.filter(
    (override) => componentSourcePathKey(override.sourcePath) !== key,
  );
  next.push({ sourcePath: [...input.sourcePath], patch: mergedPatch });
  next.sort((left, right) =>
    componentSourcePathKey(left.sourcePath).localeCompare(
      componentSourcePathKey(right.sourcePath),
    ),
  );
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_set_override`,
        type: "update_properties",
        nodeId: instance.id,
        properties: { overrides: next },
      },
    ],
    componentId: instance.properties.componentId,
    instanceId: instance.id,
    mainNodeId:
      document.componentsById[instance.properties.componentId]?.rootNodeId ??
      "",
    selectionNodeIds: [instance.id],
  };
}

export function planResetComponentOverrides(
  document: DesignDocument,
  input: {
    instanceId: string;
    sourcePath?: readonly string[];
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const instance = document.nodesById[input.instanceId];
  if (!instance || instance.kind !== "instance") {
    return failure(
      "missing-instance",
      `Instance ${input.instanceId} does not exist`,
    );
  }
  const next = input.sourcePath
    ? instance.properties.overrides.filter(
        (override) =>
          componentSourcePathKey(override.sourcePath) !==
          componentSourcePathKey(input.sourcePath!),
      )
    : [];
  const slotOverrideIds = input.sourcePath ? [] : [...instance.childIds];
  if (
    next.length === instance.properties.overrides.length &&
    slotOverrideIds.length === 0
  ) {
    return failure("no-op", "No matching component override exists");
  }
  const commands: DesignOperation[] = slotOverrideIds.map((nodeId, index) => ({
    commandId: `${input.commandPrefix}_reset_slot_${index}`,
    type: "delete_element",
    nodeId,
  }));
  if (next.length !== instance.properties.overrides.length) {
    commands.push({
      commandId: `${input.commandPrefix}_reset_override`,
      type: "update_properties",
      nodeId: instance.id,
      properties: { overrides: next },
    });
  }
  return {
    ok: true,
    commands,
    componentId: instance.properties.componentId,
    instanceId: instance.id,
    mainNodeId:
      document.componentsById[instance.properties.componentId]?.rootNodeId ??
      "",
    selectionNodeIds: [instance.id],
  };
}

export function planDetachComponentInstance(
  document: DesignDocument,
  input: { instanceId: string; commandPrefix: string },
): ComponentOperationPlan {
  const instance = document.nodesById[input.instanceId];
  if (!instance || instance.kind !== "instance") {
    return failure(
      "missing-instance",
      `Instance ${input.instanceId} does not exist`,
    );
  }
  const resolution = resolveComponentInstance(document, instance.id);
  if (!resolution.ok) {
    return failure(
      "invalid",
      resolution.issues[0]?.message ?? "Instance cannot be resolved",
    );
  }
  const idByProjection = new Map(
    resolution.nodes.map((resolved, index) => [
      resolved.projectionId,
      index === 0 ? instance.id : `${instance.id}_detached_${index}`,
    ]),
  );
  const nodes = resolution.nodes.map((resolved) => {
    let clone = structuredClone(resolved.node);
    if (clone.kind === "slot") {
      const { sourceSlotId: _sourceSlotId, ...properties } = clone.properties;
      void _sourceSlotId;
      clone = {
        ...clone,
        kind: "frame",
        properties,
      };
    }
    delete clone.componentPropertyReferences;
    clone.id = idByProjection.get(resolved.projectionId)!;
    clone.parentId = resolved.parentProjectionId
      ? (idByProjection.get(resolved.parentProjectionId) ?? instance.parentId)
      : instance.parentId;
    clone.childIds = resolved.node.childIds.map(
      (childId) => idByProjection.get(childId) ?? childId,
    );
    return clone;
  });
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_detach_instance`,
        type: "replace_subtree",
        rootNodeId: instance.id,
        nodes,
      },
    ],
    componentId: instance.properties.componentId,
    instanceId: instance.id,
    mainNodeId:
      document.componentsById[instance.properties.componentId]?.rootNodeId ??
      "",
    selectionNodeIds: [instance.id],
  };
}

export function componentMainNodeId(
  document: DesignDocument,
  instanceId: string,
): string | null {
  const instance = document.nodesById[instanceId];
  if (!instance || instance.kind !== "instance") return null;
  return (
    document.componentsById[instance.properties.componentId]?.rootNodeId ?? null
  );
}

function componentIdForAnySource(
  document: DesignDocument,
  nodeId: string,
): string | null {
  for (const componentId of Object.keys(document.componentsById)) {
    if (componentSourceNodeIds(document, componentId).has(nodeId))
      return componentId;
  }
  return null;
}

function isContainer(node: DesignNode): boolean {
  return node.kind === "frame" || node.kind === "group";
}

function failure(
  code: ComponentOperationFailureCode,
  message: string,
): ComponentOperationPlan {
  return { ok: false, code, message };
}
