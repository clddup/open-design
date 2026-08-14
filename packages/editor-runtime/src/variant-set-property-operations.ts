import { resolveComponentInstance } from "@opendesign/component-service";
import {
  MAX_TRANSACTION_COMMANDS,
  type ComponentDefinition,
  type ComponentPropertyAssignment,
  type DesignDocument,
  type DesignOperation,
  type InstanceNode,
  type VariantProperties,
  type VariantSetDefinition,
} from "@opendesign/design-contracts";
import { planDissolveVariantSet } from "./variant-set-membership-operations.js";
import {
  failure,
  membershipContext,
  type MembershipContext,
} from "./variant-set-membership-support.js";
import type { VariantSetOperationPlan } from "./variant-set-operations.js";

type AssignmentTransform = (
  assignments: Record<string, ComponentPropertyAssignment>,
) => Record<string, ComponentPropertyAssignment>;

type MatrixMutation = {
  set: VariantSetDefinition;
  components: Map<string, ComponentDefinition>;
  assignmentTransform: AssignmentTransform;
};

export function planAddVariantProperty(
  document: DesignDocument,
  input: {
    pageId: string;
    variantSetId: string;
    propertyName: string;
    valuesByComponentId: Readonly<Record<string, string>>;
    index?: number;
    commandPrefix: string;
  },
): VariantSetOperationPlan {
  return planMatrixMutation(document, input, (context) => {
    const propertyName = normalizePropertyName(input.propertyName);
    if (!propertyName.ok) return propertyName;
    if (context.set.componentPropertyDefinitions[propertyName.value]) {
      return failure(
        "duplicate",
        `Variant property ${propertyName.value} already exists`,
      );
    }
    const index = input.index ?? context.set.propertyOrder.length;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index > context.set.propertyOrder.length
    ) {
      return failure("invalid", "Variant property index is out of range");
    }
    const values = completeMemberValues(context, input.valuesByComponentId);
    if (!values.ok) return values;
    const components = cloneMembers(context);
    for (const [componentId, value] of Object.entries(values.values)) {
      components.get(componentId)!.variantProperties[propertyName.value] =
        value;
    }
    const propertyOrder = [...context.set.propertyOrder];
    propertyOrder.splice(index, 0, propertyName.value);
    const defaultValue = components.get(context.set.defaultComponentId)!
      .variantProperties[propertyName.value]!;
    const set = {
      ...structuredClone(context.set),
      propertyOrder,
      componentPropertyDefinitions: {
        ...structuredClone(context.set.componentPropertyDefinitions),
        [propertyName.value]: {
          type: "VARIANT" as const,
          defaultValue,
          variantOptions: uniqueValuesInMemberOrder(
            context,
            components,
            propertyName.value,
          ),
        },
      },
    };
    return { set, components, assignmentTransform: identityAssignments };
  });
}

export function planRenameVariantProperty(
  document: DesignDocument,
  input: {
    pageId: string;
    variantSetId: string;
    propertyName: string;
    name: string;
    commandPrefix: string;
  },
): VariantSetOperationPlan {
  return planMatrixMutation(document, input, (context) => {
    const definition =
      context.set.componentPropertyDefinitions[input.propertyName];
    if (!definition) {
      return failure(
        "invalid",
        `Variant property ${input.propertyName} does not exist`,
      );
    }
    const nextName = normalizePropertyName(input.name);
    if (!nextName.ok) return nextName;
    if (nextName.value === input.propertyName) {
      return failure("invalid", "Variant property name is unchanged");
    }
    if (context.set.componentPropertyDefinitions[nextName.value]) {
      return failure(
        "duplicate",
        `Variant property ${nextName.value} already exists`,
      );
    }
    const components = cloneMembers(context);
    for (const component of components.values()) {
      const value = component.variantProperties[input.propertyName]!;
      delete component.variantProperties[input.propertyName];
      component.variantProperties[nextName.value] = value;
    }
    const definitions = structuredClone(
      context.set.componentPropertyDefinitions,
    );
    delete definitions[input.propertyName];
    definitions[nextName.value] = structuredClone(definition);
    return {
      set: {
        ...structuredClone(context.set),
        propertyOrder: context.set.propertyOrder.map((name) =>
          name === input.propertyName ? nextName.value : name,
        ),
        componentPropertyDefinitions: definitions,
      },
      components,
      assignmentTransform: (assignments) => {
        if (!Object.hasOwn(assignments, input.propertyName)) return assignments;
        const next = { ...assignments };
        next[nextName.value] = next[input.propertyName]!;
        delete next[input.propertyName];
        return next;
      },
    };
  });
}

export function planReorderVariantProperties(
  document: DesignDocument,
  input: {
    pageId: string;
    variantSetId: string;
    propertyOrder: readonly string[];
    commandPrefix: string;
  },
): VariantSetOperationPlan {
  return planMatrixMutation(document, input, (context) => {
    if (arraysEqual(context.set.propertyOrder, input.propertyOrder)) {
      return failure("invalid", "Variant property order is unchanged");
    }
    if (!sameStringSet(context.set.propertyOrder, input.propertyOrder)) {
      return failure(
        "invalid",
        "Variant property order must contain every property exactly once",
      );
    }
    return {
      set: {
        ...structuredClone(context.set),
        propertyOrder: [...input.propertyOrder],
      },
      components: cloneMembers(context),
      assignmentTransform: identityAssignments,
    };
  });
}

export function planRemoveVariantProperty(
  document: DesignDocument,
  input: {
    pageId: string;
    variantSetId: string;
    propertyName: string;
    commandPrefix: string;
  },
): VariantSetOperationPlan {
  const context = membershipContext(document, input.pageId, input.variantSetId);
  if (!context.ok) return context;
  if (!context.set.componentPropertyDefinitions[input.propertyName]) {
    return failure(
      "invalid",
      `Variant property ${input.propertyName} does not exist`,
    );
  }
  if (context.set.propertyOrder.length === 1) {
    return planDissolveVariantSet(document, input);
  }
  return planMatrixMutation(document, input, (current) => {
    const components = cloneMembers(current);
    for (const component of components.values()) {
      delete component.variantProperties[input.propertyName];
    }
    const definitions = structuredClone(
      current.set.componentPropertyDefinitions,
    );
    delete definitions[input.propertyName];
    const set = {
      ...structuredClone(current.set),
      propertyOrder: current.set.propertyOrder.filter(
        (name) => name !== input.propertyName,
      ),
      componentPropertyDefinitions: definitions,
    };
    return {
      set,
      components,
      assignmentTransform: (assignments) => {
        if (!Object.hasOwn(assignments, input.propertyName)) return assignments;
        const next = { ...assignments };
        delete next[input.propertyName];
        return next;
      },
    };
  });
}

export function planRenameVariantValue(
  document: DesignDocument,
  input: {
    pageId: string;
    variantSetId: string;
    propertyName: string;
    value: string;
    name: string;
    commandPrefix: string;
  },
): VariantSetOperationPlan {
  return planMatrixMutation(document, input, (context) => {
    const definition =
      context.set.componentPropertyDefinitions[input.propertyName];
    if (!definition?.variantOptions.includes(input.value)) {
      return failure(
        "invalid",
        `Variant value ${input.value} does not exist on ${input.propertyName}`,
      );
    }
    const nextValue = normalizeValue(input.name, input.propertyName);
    if (!nextValue.ok) return nextValue;
    if (nextValue.value === input.value) {
      return failure("invalid", "Variant value is unchanged");
    }
    const components = cloneMembers(context);
    for (const component of components.values()) {
      if (component.variantProperties[input.propertyName] === input.value) {
        component.variantProperties[input.propertyName] = nextValue.value;
      }
    }
    const options = definition.variantOptions
      .map((value) => (value === input.value ? nextValue.value : value))
      .filter((value, index, values) => values.indexOf(value) === index);
    const defaultValue = components.get(context.set.defaultComponentId)!
      .variantProperties[input.propertyName]!;
    return {
      set: {
        ...structuredClone(context.set),
        componentPropertyDefinitions: {
          ...structuredClone(context.set.componentPropertyDefinitions),
          [input.propertyName]: {
            ...structuredClone(definition),
            defaultValue,
            variantOptions: options,
          },
        },
      },
      components,
      assignmentTransform: (assignments) =>
        assignments[input.propertyName] === input.value
          ? { ...assignments, [input.propertyName]: nextValue.value }
          : assignments,
    };
  });
}

export function planReorderVariantValues(
  document: DesignDocument,
  input: {
    pageId: string;
    variantSetId: string;
    propertyName: string;
    values: readonly string[];
    commandPrefix: string;
  },
): VariantSetOperationPlan {
  return planMatrixMutation(document, input, (context) => {
    const definition =
      context.set.componentPropertyDefinitions[input.propertyName];
    if (!definition) {
      return failure(
        "invalid",
        `Variant property ${input.propertyName} does not exist`,
      );
    }
    if (arraysEqual(definition.variantOptions, input.values)) {
      return failure("invalid", "Variant value order is unchanged");
    }
    if (!sameStringSet(definition.variantOptions, input.values)) {
      return failure(
        "invalid",
        "Variant value order must contain every value exactly once",
      );
    }
    return {
      set: {
        ...structuredClone(context.set),
        componentPropertyDefinitions: {
          ...structuredClone(context.set.componentPropertyDefinitions),
          [input.propertyName]: {
            ...structuredClone(definition),
            variantOptions: [...input.values],
          },
        },
      },
      components: cloneMembers(context),
      assignmentTransform: identityAssignments,
    };
  });
}

export function planSetVariantProperties(
  document: DesignDocument,
  input: {
    pageId: string;
    variantSetId: string;
    componentId: string;
    variantProperties: Readonly<Record<string, string>>;
    commandPrefix: string;
  },
): VariantSetOperationPlan {
  return planMatrixMutation(document, input, (context) => {
    const component = context.members.find(
      (member) => member.component.id === input.componentId,
    )?.component;
    if (!component) {
      return failure(
        "invalid",
        `Variant ${input.componentId} is not a member of ${context.set.id}`,
      );
    }
    if (
      !sameStringSet(
        context.set.propertyOrder,
        Object.keys(input.variantProperties),
      )
    ) {
      return failure(
        "invalid",
        "Variant values must include every property exactly once",
      );
    }
    const nextProperties: VariantProperties = {};
    for (const propertyName of context.set.propertyOrder) {
      const value = normalizeValue(
        input.variantProperties[propertyName] ?? "",
        propertyName,
      );
      if (!value.ok) return value;
      nextProperties[propertyName] = value.value;
    }
    if (sameProperties(component.variantProperties, nextProperties)) {
      return failure("invalid", "Variant values are unchanged");
    }
    const components = cloneMembers(context);
    components.get(component.id)!.variantProperties = nextProperties;
    const definitions = rebuildDefinitions(context, components);
    return {
      set: {
        ...structuredClone(context.set),
        componentPropertyDefinitions: definitions,
      },
      components,
      assignmentTransform: identityAssignments,
    };
  });
}

function planMatrixMutation(
  document: DesignDocument,
  input: { pageId: string; variantSetId: string; commandPrefix: string },
  mutate: (
    context: MembershipContext,
  ) => MatrixMutation | Extract<VariantSetOperationPlan, { ok: false }>,
): VariantSetOperationPlan {
  const context = membershipContext(document, input.pageId, input.variantSetId);
  if (!context.ok) return context;
  const beforeInstances = resolveSetInstances(document, context);
  if (!beforeInstances.ok) return beforeInstances;
  const mutation = mutate(context);
  if (isFailure(mutation)) return mutation;
  synchronizeMemberNames(mutation.set, mutation.components);
  const combinationIssue = uniqueCombinationIssue(
    mutation.set,
    mutation.components,
  );
  if (combinationIssue) return failure("duplicate", combinationIssue);

  const projected = structuredClone(document);
  projected.variantSetsById[mutation.set.id] = structuredClone(mutation.set);
  for (const component of mutation.components.values()) {
    projected.componentsById[component.id] = structuredClone(component);
  }
  const commands: DesignOperation[] = [];
  for (const component of mutation.components.values()) {
    const before = document.componentsById[component.id];
    if (JSON.stringify(before) === JSON.stringify(component)) continue;
    commands.push({
      commandId: `${input.commandPrefix}_put_component_${commands.length}`,
      type: "put_component",
      component,
    });
    const root = document.nodesById[component.rootNodeId];
    if (root && root.name !== component.name) {
      commands.push({
        commandId: `${input.commandPrefix}_rename_root_${commands.length}`,
        type: "update_properties",
        nodeId: root.id,
        name: component.name,
      });
    }
  }
  commands.push({
    commandId: `${input.commandPrefix}_put_set`,
    type: "put_variant_set",
    variantSet: mutation.set,
  });
  const instanceCommands = reconcileMatrixInstances(
    projected,
    context,
    beforeInstances.instances,
    mutation.assignmentTransform,
    input.commandPrefix,
  );
  if (!instanceCommands.ok) return instanceCommands;
  commands.push(...instanceCommands.commands);
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      "Editing this Variant matrix exceeds the transaction command limit",
    );
  }
  const selected = mutation.components.get(mutation.set.defaultComponentId)!;
  return {
    ok: true,
    commands,
    componentId: selected.id,
    mainNodeId: selected.rootNodeId,
    variantSetId: mutation.set.id,
    rootNodeId: mutation.set.rootNodeId,
    componentIds: [...mutation.components.keys()],
    defaultComponentId: mutation.set.defaultComponentId,
    selectionNodeIds: [mutation.set.rootNodeId],
  };
}

function resolveSetInstances(
  document: DesignDocument,
  context: MembershipContext,
):
  | {
      ok: true;
      instances: Array<{
        node: InstanceNode;
        resolvedComponentId: string;
      }>;
    }
  | Extract<VariantSetOperationPlan, { ok: false }> {
  const memberIds = new Set(
    context.members.map(({ component }) => component.id),
  );
  const instances = [];
  for (const node of Object.values(document.nodesById)) {
    if (node.kind !== "instance" || !memberIds.has(node.properties.componentId))
      continue;
    const resolution = resolveComponentInstance(document, node.id);
    if (!resolution.ok) {
      return failure(
        "invalid",
        resolution.issues[0]?.message ?? `Instance ${node.id} cannot resolve`,
      );
    }
    instances.push({ node, resolvedComponentId: resolution.componentId });
  }
  return { ok: true, instances };
}

function reconcileMatrixInstances(
  projected: DesignDocument,
  context: MembershipContext,
  instances: readonly {
    node: InstanceNode;
    resolvedComponentId: string;
  }[],
  transform: AssignmentTransform,
  prefix: string,
):
  | { ok: true; commands: DesignOperation[] }
  | Extract<VariantSetOperationPlan, { ok: false }> {
  const commands: DesignOperation[] = [];
  for (const { node, resolvedComponentId } of instances) {
    let assignments = transform(
      structuredClone(node.properties.componentProperties),
    );
    const shell = structuredClone(node);
    shell.properties.componentProperties = assignments;
    projected.nodesById[node.id] = shell;
    let resolution = resolveComponentInstance(projected, node.id);
    if (!resolution.ok || resolution.componentId !== resolvedComponentId) {
      const resolvedComponent = projected.componentsById[resolvedComponentId];
      if (!resolvedComponent?.variantSetId) {
        return failure(
          "invalid",
          `Resolved Variant ${resolvedComponentId} is unavailable after matrix edit`,
        );
      }
      const ordinaryAssignments = Object.fromEntries(
        Object.entries(assignments).filter(
          ([name]) => !context.set.componentPropertyDefinitions[name],
        ),
      );
      assignments = {
        ...ordinaryAssignments,
        ...structuredClone(resolvedComponent.variantProperties),
      };
      shell.properties.componentProperties = assignments;
      projected.nodesById[node.id] = shell;
      resolution = resolveComponentInstance(projected, node.id);
      if (!resolution.ok || resolution.componentId !== resolvedComponentId) {
        return failure(
          "invalid",
          resolution.ok
            ? `Instance ${node.id} no longer resolves to ${resolvedComponentId}`
            : (resolution.issues[0]?.message ??
                `Instance ${node.id} cannot resolve after matrix edit`),
        );
      }
    }
    if (
      JSON.stringify(assignments) ===
      JSON.stringify(node.properties.componentProperties)
    ) {
      continue;
    }
    commands.push({
      commandId: `${prefix}_reconcile_instance_${commands.length}`,
      type: "update_properties",
      nodeId: node.id,
      properties: { componentProperties: assignments },
    });
  }
  return { ok: true, commands };
}

function rebuildDefinitions(
  context: MembershipContext,
  components: ReadonlyMap<string, ComponentDefinition>,
): VariantSetDefinition["componentPropertyDefinitions"] {
  return Object.fromEntries(
    context.set.propertyOrder.map((propertyName) => {
      const existing = context.set.componentPropertyDefinitions[propertyName]!;
      return [
        propertyName,
        {
          ...structuredClone(existing),
          defaultValue: components.get(context.set.defaultComponentId)!
            .variantProperties[propertyName]!,
          variantOptions: mergeValueOrder(
            existing.variantOptions,
            uniqueValuesInMemberOrder(context, components, propertyName),
          ),
        },
      ];
    }),
  );
}

function uniqueCombinationIssue(
  set: VariantSetDefinition,
  components: ReadonlyMap<string, ComponentDefinition>,
): string | null {
  const combinations = new Set<string>();
  for (const component of components.values()) {
    const combination = set.propertyOrder
      .map((name) => component.variantProperties[name])
      .join("\u0000");
    if (combinations.has(combination)) {
      return "Every Variant must have a unique property combination";
    }
    combinations.add(combination);
  }
  return null;
}

function completeMemberValues(
  context: MembershipContext,
  input: Readonly<Record<string, string>>,
):
  | { ok: true; values: Record<string, string> }
  | Extract<VariantSetOperationPlan, { ok: false }> {
  const componentIds = context.members.map(({ component }) => component.id);
  if (!sameStringSet(componentIds, Object.keys(input))) {
    return failure(
      "invalid",
      "New Variant property values must describe every member exactly once",
    );
  }
  const values: Record<string, string> = {};
  for (const componentId of componentIds) {
    const value = normalizeValue(input[componentId] ?? "", "new property");
    if (!value.ok) return value;
    values[componentId] = value.value;
  }
  return { ok: true, values };
}

function cloneMembers(
  context: MembershipContext,
): Map<string, ComponentDefinition> {
  return new Map(
    context.members.map(({ component }) => [
      component.id,
      structuredClone(component),
    ]),
  );
}

function uniqueValuesInMemberOrder(
  context: MembershipContext,
  components: ReadonlyMap<string, ComponentDefinition>,
  propertyName: string,
): string[] {
  return context.members
    .map(
      ({ component }) =>
        components.get(component.id)!.variantProperties[propertyName]!,
    )
    .filter((value, index, values) => values.indexOf(value) === index);
}

function mergeValueOrder(
  current: readonly string[],
  used: readonly string[],
): string[] {
  return [
    ...current.filter((value) => used.includes(value)),
    ...used.filter((value) => !current.includes(value)),
  ];
}

function normalizePropertyName(
  value: string,
):
  | { ok: true; value: string }
  | Extract<VariantSetOperationPlan, { ok: false }> {
  const name = value.trim();
  if (
    !name ||
    name.length > 256 ||
    name.includes("#") ||
    /\p{Cc}/u.test(name)
  ) {
    return failure(
      "invalid",
      "Variant property names must be 1 to 256 non-control characters without #",
    );
  }
  return { ok: true, value: name };
}

function normalizeValue(
  value: string,
  propertyName: string,
):
  | { ok: true; value: string }
  | Extract<VariantSetOperationPlan, { ok: false }> {
  const next = value.trim();
  if (!next || next.length > 256 || /\p{Cc}/u.test(next)) {
    return failure(
      "invalid",
      `Variant value for ${propertyName} must contain 1 to 256 non-control characters`,
    );
  }
  return { ok: true, value: next };
}

function identityAssignments(
  assignments: Record<string, ComponentPropertyAssignment>,
): Record<string, ComponentPropertyAssignment> {
  return assignments;
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameProperties(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([name, value]) => right[name] === value)
  );
}

function synchronizeMemberNames(
  set: VariantSetDefinition,
  components: Map<string, ComponentDefinition>,
): void {
  for (const component of components.values()) {
    component.name = set.propertyOrder
      .map(
        (propertyName) =>
          `${propertyName}=${component.variantProperties[propertyName]}`,
      )
      .join(", ");
  }
}

function isFailure(
  value: MatrixMutation | Extract<VariantSetOperationPlan, { ok: false }>,
): value is Extract<VariantSetOperationPlan, { ok: false }> {
  return "ok" in value && value.ok === false;
}
