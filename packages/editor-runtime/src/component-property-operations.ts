import {
  componentSourceNodeIds,
  resolveComponentInstance,
} from "@opendesign/component-service";
import type {
  ComponentPropertyAssignment,
  ComponentPropertyDefinition,
  ComponentPropertyReferences,
  ComponentPropertyType,
  ComponentDefinition,
  DesignDocument,
  DesignNode,
  DesignOperation,
  InstanceSwapPreferredValue,
  SlotSettings,
  VariantPropertyDefinition,
} from "@opendesign/design-contracts";
import type { ComponentOperationPlan } from "./component-operations.js";
import { replaceSlotContainerKindCommand } from "./component-slot-operations.js";
import {
  hasSlotAncestor,
  hasSlotDescendant,
} from "./component-slot-support.js";

export type ComponentPropertyReferenceField =
  "visible" | "characters" | "mainComponent";

export function figmaComponentPropertyName(
  name: string,
  propertyId: string,
): string | null {
  const label = name.trim();
  const suffix = propertyId.trim();
  if (
    !label ||
    label.length > 256 ||
    !suffix ||
    suffix.length > 256 ||
    /[\p{Cc}]/u.test(label) ||
    /[\p{Cc}#]/u.test(suffix)
  ) {
    return null;
  }
  return `${label}#${suffix}`;
}

export function planAddComponentProperty(
  document: DesignDocument,
  input: {
    componentId: string;
    propertyId: string;
    name: string;
    type: ComponentPropertyType;
    sourceNodeId: string;
    preferredValues?: readonly InstanceSwapPreferredValue[];
    slotSettings?: SlotSettings;
    description?: string;
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const component = document.componentsById[input.componentId];
  if (!component)
    return failure(
      "missing-component",
      `Component ${input.componentId} does not exist`,
    );
  const propertyName = figmaComponentPropertyName(input.name, input.propertyId);
  if (!propertyName)
    return failure("invalid", "Component property name or ID is invalid");
  if (component.componentPropertyDefinitions[propertyName]) {
    return failure(
      "duplicate",
      `Component property ${propertyName} already exists`,
    );
  }
  const source = document.nodesById[input.sourceNodeId];
  if (
    !source ||
    !componentSourceNodeIds(document, component.id).has(source.id)
  ) {
    return failure(
      "missing-source-node",
      `Component source layer ${input.sourceNodeId} does not exist`,
    );
  }
  if (source.id === component.rootNodeId) {
    return failure(
      "invalid",
      "Figma component properties must bind a sublayer, not the component root",
    );
  }
  if (
    input.type === "SLOT" &&
    (hasSlotAncestor(document, source) || hasSlotDescendant(document, source))
  ) {
    return failure(
      "invalid",
      "A Slot cannot contain another Slot; compose nested flexible content through a component Instance instead",
    );
  }
  const binding = bindingForType(input.type, source);
  if (!binding.ok) return failure("invalid", binding.message);
  if (binding.field && source.componentPropertyReferences?.[binding.field]) {
    return failure(
      "duplicate",
      `${binding.field} is already bound to a component property`,
    );
  }
  const preferredValues = normalizePreferredValues(
    document,
    input.type,
    input.preferredValues,
  );
  if (!preferredValues.ok) return failure("invalid", preferredValues.message);
  const definition: ComponentPropertyDefinition =
    input.type === "BOOLEAN"
      ? { type: "BOOLEAN", defaultValue: source.visible }
      : input.type === "TEXT" && source.kind === "text"
        ? { type: "TEXT", defaultValue: source.properties.content }
        : input.type === "INSTANCE_SWAP"
          ? {
              type: "INSTANCE_SWAP",
              defaultValue:
                source.kind === "instance" ? source.properties.componentId : "",
              ...(preferredValues.values.length > 0
                ? { preferredValues: preferredValues.values }
                : {}),
            }
          : source.kind === "frame"
            ? {
                type: "SLOT",
                defaultValue: source.id,
                ...(preferredValues.values.length > 0
                  ? { preferredValues: preferredValues.values }
                  : {}),
                ...(input.description?.trim()
                  ? { description: input.description.trim() }
                  : {}),
                ...(input.slotSettings
                  ? { slotSettings: structuredClone(input.slotSettings) }
                  : {}),
              }
            : { type: "SLOT", defaultValue: "" };
  const nextComponent = structuredClone(component);
  nextComponent.componentPropertyDefinitions[propertyName] = definition;
  nextComponent.componentPropertyOrder.push(propertyName);
  const commands: DesignOperation[] = [];
  if (input.type === "SLOT" && source.kind === "frame") {
    commands.push(
      replaceSlotContainerKindCommand(
        document,
        source,
        "slot",
        `${input.commandPrefix}_convert_frame_to_slot`,
      ),
    );
  }
  commands.push({
    commandId: `${input.commandPrefix}_put_property_definition`,
    type: "put_component",
    component: nextComponent,
  });
  if (binding.field) {
    const references: ComponentPropertyReferences = {
      ...(source.componentPropertyReferences ?? {}),
      [binding.field]: propertyName,
    };
    commands.push({
      commandId: `${input.commandPrefix}_bind_property_reference`,
      type: "update_properties",
      nodeId: source.id,
      componentPropertyReferences: references,
    });
  }
  return success(component.id, component.rootNodeId, source.id, commands);
}

export function planRenameComponentProperty(
  document: DesignDocument,
  input: {
    componentId: string;
    propertyName: string;
    name: string;
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const component = document.componentsById[input.componentId];
  const definition =
    component?.componentPropertyDefinitions[input.propertyName];
  if (!component || !definition)
    return failure(
      "missing-component",
      `Component property ${input.propertyName} does not exist`,
    );
  const suffix = input.propertyName.slice(
    input.propertyName.lastIndexOf("#") + 1,
  );
  const nextPropertyName = figmaComponentPropertyName(input.name, suffix);
  if (!nextPropertyName)
    return failure("invalid", "Component property name is invalid");
  if (nextPropertyName === input.propertyName)
    return failure("no-op", "Component property name is unchanged");
  if (component.componentPropertyDefinitions[nextPropertyName]) {
    return failure(
      "duplicate",
      `Component property ${nextPropertyName} already exists`,
    );
  }
  const commands: DesignOperation[] = [];
  appendReferenceRenameCommands(
    document,
    component.id,
    input.propertyName,
    nextPropertyName,
    input.commandPrefix,
    commands,
  );
  appendAssignmentRenameCommands(
    document,
    component.id,
    input.propertyName,
    nextPropertyName,
    input.commandPrefix,
    commands,
  );
  const nextComponent = structuredClone(component);
  delete nextComponent.componentPropertyDefinitions[input.propertyName];
  nextComponent.componentPropertyDefinitions[nextPropertyName] = definition;
  nextComponent.componentPropertyOrder =
    nextComponent.componentPropertyOrder.map((name) =>
      name === input.propertyName ? nextPropertyName : name,
    );
  commands.push({
    commandId: `${input.commandPrefix}_rename_property_definition`,
    type: "put_component",
    component: nextComponent,
  });
  return success(
    component.id,
    component.rootNodeId,
    component.rootNodeId,
    commands,
  );
}

export function planRemoveComponentProperty(
  document: DesignDocument,
  input: {
    componentId: string;
    propertyName: string;
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const component = document.componentsById[input.componentId];
  const definition =
    component?.componentPropertyDefinitions[input.propertyName];
  if (!component || !definition) {
    return failure(
      "missing-component",
      `Component property ${input.propertyName} does not exist`,
    );
  }
  const commands: DesignOperation[] = [];
  if (definition.type === "SLOT") {
    const source = document.nodesById[definition.defaultValue];
    if (source?.kind !== "slot" || source.properties.sourceSlotId !== null) {
      return failure(
        "invalid",
        `Slot ${definition.defaultValue} is unavailable`,
      );
    }
    for (const instance of Object.values(document.nodesById)) {
      if (instance.kind !== "instance") continue;
      for (const childId of instance.childIds) {
        const child = document.nodesById[childId];
        if (
          child?.kind === "slot" &&
          child.properties.sourceSlotId === source.id
        ) {
          commands.push({
            commandId: `${input.commandPrefix}_delete_slot_override_${commands.length}`,
            type: "delete_element",
            nodeId: child.id,
          });
        }
      }
    }
    commands.push(
      replaceSlotContainerKindCommand(
        document,
        source,
        "frame",
        `${input.commandPrefix}_convert_slot_to_frame`,
      ),
    );
  }
  for (const sourceNodeId of componentSourceNodeIds(document, component.id)) {
    const source = document.nodesById[sourceNodeId];
    if (!source?.componentPropertyReferences) continue;
    const references = Object.fromEntries(
      Object.entries(source.componentPropertyReferences).filter(
        ([, propertyName]) => propertyName !== input.propertyName,
      ),
    ) as ComponentPropertyReferences;
    if (
      Object.keys(references).length ===
      Object.keys(source.componentPropertyReferences).length
    ) {
      continue;
    }
    commands.push({
      commandId: `${input.commandPrefix}_unbind_${commands.length}`,
      type: "update_properties",
      nodeId: source.id,
      componentPropertyReferences:
        Object.keys(references).length > 0 ? references : null,
    });
  }
  for (const instance of directComponentInstances(document, component.id)) {
    if (!(input.propertyName in instance.properties.componentProperties))
      continue;
    const next = { ...instance.properties.componentProperties };
    delete next[input.propertyName];
    commands.push({
      commandId: `${input.commandPrefix}_reset_instance_${instance.id}`,
      type: "update_properties",
      nodeId: instance.id,
      properties: { componentProperties: next },
    });
  }
  const nextComponent = structuredClone(component);
  delete nextComponent.componentPropertyDefinitions[input.propertyName];
  nextComponent.componentPropertyOrder =
    nextComponent.componentPropertyOrder.filter(
      (name) => name !== input.propertyName,
    );
  commands.push({
    commandId: `${input.commandPrefix}_delete_property_definition`,
    type: "put_component",
    component: nextComponent,
  });
  return success(
    component.id,
    component.rootNodeId,
    component.rootNodeId,
    commands,
  );
}

export function planSetComponentPropertyValue(
  document: DesignDocument,
  input: {
    instanceId: string;
    propertyName: string;
    value: ComponentPropertyAssignment;
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
  const component = document.componentsById[instance.properties.componentId];
  const definition = component
    ? effectivePropertyDefinition(document, component, input.propertyName)
    : undefined;
  if (!component || !definition) {
    return failure(
      "missing-component",
      `Component property ${input.propertyName} does not exist`,
    );
  }
  if (definition.type === "SLOT") {
    return failure(
      "invalid",
      `SLOT property ${input.propertyName} is edited through Slot contents`,
    );
  }
  if (!valueMatchesDefinition(definition, input.value)) {
    return failure(
      "invalid",
      `Component property ${input.propertyName} requires ${definition.type}`,
    );
  }
  if (
    definition.type === "VARIANT" &&
    (typeof input.value !== "string" ||
      !definition.variantOptions.includes(input.value))
  ) {
    return failure(
      "invalid",
      `Variant property ${input.propertyName} requires one of: ${definition.variantOptions.join(", ")}`,
    );
  }
  if (
    definition.type === "INSTANCE_SWAP" &&
    typeof input.value === "string" &&
    !document.componentsById[input.value]
  ) {
    return failure(
      "missing-component",
      `Swap component ${input.value} does not exist`,
    );
  }
  const next = { ...instance.properties.componentProperties };
  const implicitValue =
    definition.type === "VARIANT"
      ? (component.variantProperties[input.propertyName] ??
        definition.defaultValue)
      : definition.defaultValue;
  if (input.value === implicitValue) delete next[input.propertyName];
  else next[input.propertyName] = input.value;
  if (
    JSON.stringify(next) ===
    JSON.stringify(instance.properties.componentProperties)
  ) {
    return failure("no-op", "Component property value is unchanged");
  }
  const commands: DesignOperation[] = [
    {
      commandId: `${input.commandPrefix}_set_component_property`,
      type: "update_properties",
      nodeId: instance.id,
      properties: { componentProperties: next },
    },
  ];
  const candidate = structuredClone(document);
  candidate.nodesById[instance.id] = {
    ...structuredClone(instance),
    properties: {
      ...structuredClone(instance.properties),
      componentProperties: next,
    },
  };
  if (definition.type === "VARIANT" && instance.childIds.length > 0) {
    const beforeResolution = resolveComponentInstance(document, instance.id);
    const candidateShell = candidate.nodesById[instance.id];
    if (!beforeResolution.ok || candidateShell?.kind !== "instance") {
      return failure("invalid", "Current Slot overrides cannot be resolved");
    }
    candidateShell.childIds = [];
    const targetWithoutOverrides = resolveComponentInstance(
      candidate,
      instance.id,
    );
    candidateShell.childIds = [...instance.childIds];
    if (!targetWithoutOverrides.ok) {
      return failure(
        "invalid",
        targetWithoutOverrides.issues[0]?.message ??
          "Target Variant cannot be resolved",
      );
    }
    for (const childId of instance.childIds) {
      const slotOverride = candidate.nodesById[childId];
      if (
        slotOverride?.kind !== "slot" ||
        slotOverride.properties.sourceSlotId === null
      )
        continue;
      const previousSlot = beforeResolution.slots.find(
        (slot) =>
          slot.sourceSlotNodeId === slotOverride.properties.sourceSlotId,
      );
      const targetSlot = previousSlot
        ? targetWithoutOverrides.slots.find(
            (slot) => slot.propertyName === previousSlot.propertyName,
          )
        : undefined;
      if (!targetSlot) {
        return failure(
          "invalid",
          `Target Variant does not expose matching Slot ${previousSlot?.propertyName ?? slotOverride.properties.sourceSlotId}`,
        );
      }
      slotOverride.properties.sourceSlotId = targetSlot.sourceSlotNodeId;
      commands.push({
        commandId: `${input.commandPrefix}_migrate_slot_${commands.length}`,
        type: "update_properties",
        nodeId: slotOverride.id,
        properties: { sourceSlotId: targetSlot.sourceSlotNodeId },
      });
    }
  }
  const resolution = resolveComponentInstance(candidate, instance.id);
  if (!resolution.ok) {
    return failure(
      "invalid",
      resolution.issues[0]?.message ?? "Component property cannot be resolved",
    );
  }
  return success(
    component.id,
    component.rootNodeId,
    instance.id,
    commands,
    instance.id,
  );
}

export function planResetComponentPropertyValue(
  document: DesignDocument,
  input: {
    instanceId: string;
    propertyName?: string;
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
  const component = document.componentsById[instance.properties.componentId];
  if (!component)
    return failure(
      "missing-component",
      `Component ${instance.properties.componentId} does not exist`,
    );
  const next = { ...instance.properties.componentProperties };
  if (input.propertyName) {
    const definition = effectivePropertyDefinition(
      document,
      component,
      input.propertyName,
    );
    if (!definition) {
      return failure(
        "missing-component",
        `Component property ${input.propertyName} does not exist`,
      );
    }
    if (definition.type === "SLOT") {
      return failure(
        "invalid",
        `Reset SLOT property ${input.propertyName} with the Slot reset action`,
      );
    }
    if (definition.type === "VARIANT") {
      return planSetComponentPropertyValue(document, {
        instanceId: instance.id,
        propertyName: input.propertyName,
        value:
          component.variantProperties[input.propertyName] ??
          definition.defaultValue,
        commandPrefix: input.commandPrefix,
      });
    }
    delete next[input.propertyName];
  } else {
    for (const propertyName of Object.keys(next)) delete next[propertyName];
  }
  if (
    Object.keys(next).length ===
    Object.keys(instance.properties.componentProperties).length
  ) {
    return failure("no-op", "No component property assignment exists");
  }
  return success(
    component.id,
    component.rootNodeId,
    instance.id,
    [
      {
        commandId: `${input.commandPrefix}_reset_component_property`,
        type: "update_properties",
        nodeId: instance.id,
        properties: { componentProperties: next },
      },
    ],
    instance.id,
  );
}

function bindingForType(
  type: ComponentPropertyType,
  source: DesignNode,
):
  | { ok: true; field?: ComponentPropertyReferenceField }
  | { ok: false; message: string } {
  if (type === "BOOLEAN") return { ok: true, field: "visible" };
  if (type === "TEXT") {
    return source.kind === "text"
      ? { ok: true, field: "characters" }
      : { ok: false, message: "TEXT properties require a Text sublayer" };
  }
  if (type === "SLOT") {
    if (source.kind !== "frame") {
      return { ok: false, message: "SLOT properties require a Frame sublayer" };
    }
    if (source.properties.layoutGuides?.length) {
      return {
        ok: false,
        message: "Frames with layout guides cannot be converted to Slots",
      };
    }
    return { ok: true };
  }
  return source.kind === "instance"
    ? { ok: true, field: "mainComponent" }
    : {
        ok: false,
        message: "INSTANCE_SWAP properties require a nested Instance sublayer",
      };
}

function normalizePreferredValues(
  document: DesignDocument,
  type: ComponentPropertyType,
  values: readonly InstanceSwapPreferredValue[] | undefined,
):
  | { ok: true; values: InstanceSwapPreferredValue[] }
  | { ok: false; message: string } {
  if (
    type !== "INSTANCE_SWAP" &&
    type !== "SLOT" &&
    values &&
    values.length > 0
  ) {
    return {
      ok: false,
      message:
        "preferredValues are only valid for INSTANCE_SWAP or SLOT properties",
    };
  }
  const unique = new Map<string, InstanceSwapPreferredValue>();
  for (const value of values ?? []) {
    if (
      (value.type === "COMPONENT" && !document.componentsById[value.key]) ||
      (value.type === "COMPONENT_SET" && !document.variantSetsById[value.key])
    ) {
      return {
        ok: false,
        message: `Preferred ${value.type} ${value.key} does not exist`,
      };
    }
    unique.set(`${value.type}:${value.key}`, structuredClone(value));
  }
  return { ok: true, values: [...unique.values()] };
}

function appendReferenceRenameCommands(
  document: DesignDocument,
  componentId: string,
  previousName: string,
  nextName: string,
  commandPrefix: string,
  commands: DesignOperation[],
): void {
  for (const sourceNodeId of componentSourceNodeIds(document, componentId)) {
    const source = document.nodesById[sourceNodeId];
    if (!source?.componentPropertyReferences) continue;
    const references = Object.fromEntries(
      Object.entries(source.componentPropertyReferences).map(
        ([field, value]) => [field, value === previousName ? nextName : value],
      ),
    ) as ComponentPropertyReferences;
    if (
      JSON.stringify(references) ===
      JSON.stringify(source.componentPropertyReferences)
    )
      continue;
    commands.push({
      commandId: `${commandPrefix}_rename_reference_${commands.length}`,
      type: "update_properties",
      nodeId: source.id,
      componentPropertyReferences: references,
    });
  }
}

function appendAssignmentRenameCommands(
  document: DesignDocument,
  componentId: string,
  previousName: string,
  nextName: string,
  commandPrefix: string,
  commands: DesignOperation[],
): void {
  for (const instance of directComponentInstances(document, componentId)) {
    if (!(previousName in instance.properties.componentProperties)) continue;
    const next = { ...instance.properties.componentProperties };
    next[nextName] = next[previousName]!;
    delete next[previousName];
    commands.push({
      commandId: `${commandPrefix}_rename_assignment_${instance.id}`,
      type: "update_properties",
      nodeId: instance.id,
      properties: { componentProperties: next },
    });
  }
}

function directComponentInstances(
  document: DesignDocument,
  componentId: string,
) {
  return Object.values(document.nodesById).filter(
    (node): node is Extract<DesignNode, { kind: "instance" }> =>
      node.kind === "instance" && node.properties.componentId === componentId,
  );
}

function valueMatchesDefinition(
  definition: ComponentPropertyDefinition | VariantPropertyDefinition,
  value: ComponentPropertyAssignment,
): boolean {
  return definition.type === "BOOLEAN"
    ? typeof value === "boolean"
    : typeof value === "string";
}

function effectivePropertyDefinition(
  document: DesignDocument,
  component: ComponentDefinition,
  propertyName: string,
): ComponentPropertyDefinition | VariantPropertyDefinition | undefined {
  const ordinary = component.componentPropertyDefinitions[propertyName];
  if (ordinary) return ordinary;
  if (!component.variantSetId) return undefined;
  return document.variantSetsById[component.variantSetId]
    ?.componentPropertyDefinitions[propertyName];
}

function success(
  componentId: string,
  mainNodeId: string,
  selectionNodeId: string,
  commands: DesignOperation[],
  instanceId?: string,
): ComponentOperationPlan {
  return {
    ok: true,
    commands,
    componentId,
    ...(instanceId ? { instanceId } : {}),
    mainNodeId,
    selectionNodeIds: [selectionNodeId],
  };
}

function failure(
  code:
    | "duplicate"
    | "invalid"
    | "missing-component"
    | "missing-instance"
    | "missing-source-node"
    | "no-op",
  message: string,
): ComponentOperationPlan {
  return { ok: false, code, message };
}
