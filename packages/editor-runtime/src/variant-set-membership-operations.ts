import {
  MAX_TRANSACTION_COMMANDS,
  type ComponentDefinition,
  type DesignDocument,
  type DesignOperation,
  type Transform,
} from "@opendesign/design-contracts";
import {
  getLocalSelectionBounds,
  getWorldTransform,
  IDENTITY_TRANSFORM,
  invertTransform,
  multiplyTransforms,
} from "./geometry.js";
import type { VariantSetOperationPlan } from "./variant-set-operations.js";
import {
  cloneComponentSubtree,
  failure,
  geometryCommands,
  membershipContext,
  normalizeMemberProperties,
  normalizeSetGeometry,
  nodeBelongsToPage,
  reconcileInstancesForRemovedMembers,
  sameCombination,
  siblingIndex,
  success,
  updateSetDefinition,
  withoutVariantMembership,
  isEffectivelyLocked,
} from "./variant-set-membership-support.js";

export function planAddComponentToVariantSet(
  document: DesignDocument,
  input: {
    pageId: string;
    variantSetId: string;
    componentId: string;
    variantProperties: Readonly<Record<string, string>>;
    commandPrefix: string;
    padding?: number;
  },
): VariantSetOperationPlan {
  const context = membershipContext(document, input.pageId, input.variantSetId);
  if (!context.ok) return context;
  const component = document.componentsById[input.componentId];
  if (!component)
    return failure(
      "missing-component",
      `Component ${input.componentId} does not exist`,
    );
  if (component.variantSetId)
    return failure(
      "invalid",
      `Component ${component.id} already belongs to set ${component.variantSetId}`,
    );
  const root = document.nodesById[component.rootNodeId];
  if (!root || (root.kind !== "frame" && root.kind !== "group")) {
    return failure(
      "missing-component",
      `Component root ${component.rootNodeId} is unavailable`,
    );
  }
  if (!nodeBelongsToPage(document, input.pageId, root.id)) {
    return failure(
      "invalid",
      `Component ${component.id} is outside Page ${input.pageId}`,
    );
  }
  if (
    isEffectivelyLocked(document, root.id) ||
    isEffectivelyLocked(document, context.root.id)
  ) {
    return failure("locked", "The Component or Component Set is locked");
  }
  const properties = normalizeMemberProperties(
    context.set,
    input.variantProperties,
  );
  if (!properties.ok) return properties;
  if (
    context.members.some((member) =>
      sameCombination(member.component.variantProperties, properties.value),
    )
  ) {
    return failure(
      "duplicate",
      "Every Variant must have a unique property combination",
    );
  }
  const setWorld = getWorldTransform(document, context.root.id);
  const componentWorld = getWorldTransform(document, root.id);
  const worldToSet = setWorld ? invertTransform(setWorld) : null;
  if (!componentWorld || !worldToSet)
    return failure("invalid", "Component geometry cannot be preserved");
  const localById = new Map(
    context.members.map(({ root }) => [
      root.id,
      [...root.transform] as Transform,
    ]),
  );
  localById.set(root.id, multiplyTransforms(worldToSet, componentWorld));
  const normalized = normalizeSetGeometry(
    document,
    context.root,
    localById,
    input.padding ?? 40,
  );
  if (!normalized.ok) return normalized;
  const components = [
    ...context.members.map(({ component }) => component),
    component,
  ];
  const nextSet = updateSetDefinition(
    context.set,
    components,
    new Map([[component.id, properties.value]]),
    normalized.transforms,
  );
  const commands: DesignOperation[] = geometryCommands(
    context.root,
    normalized,
    input.commandPrefix,
  );
  commands.push(
    {
      commandId: `${input.commandPrefix}_move_member`,
      type: "move_element",
      nodeId: root.id,
      pageId: input.pageId,
      parentId: context.root.id,
      index: context.root.childIds.length,
    },
    {
      commandId: `${input.commandPrefix}_put_component`,
      type: "put_component",
      component: {
        ...structuredClone(component),
        variantSetId: context.set.id,
        variantProperties: properties.value,
      },
    },
    {
      commandId: `${input.commandPrefix}_put_set`,
      type: "put_variant_set",
      variantSet: nextSet,
    },
  );
  if (commands.length > MAX_TRANSACTION_COMMANDS)
    return failure(
      "operation-limit",
      "Adding this Variant exceeds the transaction command limit",
    );
  return success(nextSet, components, commands, [root.id], component.id);
}

export function planDuplicateVariant(
  document: DesignDocument,
  input: {
    pageId: string;
    variantSetId: string;
    sourceComponentId: string;
    componentId: string;
    rootNodeId: string;
    name?: string;
    variantProperties: Readonly<Record<string, string>>;
    commandPrefix: string;
    gap?: number;
    padding?: number;
  },
): VariantSetOperationPlan {
  const context = membershipContext(document, input.pageId, input.variantSetId);
  if (!context.ok) return context;
  if (document.componentsById[input.componentId])
    return failure(
      "duplicate",
      `Component ${input.componentId} already exists`,
    );
  if (document.nodesById[input.rootNodeId])
    return failure("duplicate", `Layer ${input.rootNodeId} already exists`);
  const source = context.members.find(
    ({ component }) => component.id === input.sourceComponentId,
  );
  if (!source)
    return failure(
      "missing-component",
      `Variant ${input.sourceComponentId} is not a member of ${context.set.id}`,
    );
  const properties = normalizeMemberProperties(
    context.set,
    input.variantProperties,
  );
  if (!properties.ok) return properties;
  if (
    context.members.some((member) =>
      sameCombination(member.component.variantProperties, properties.value),
    )
  ) {
    return failure(
      "duplicate",
      "Every Variant must have a unique property combination",
    );
  }
  const cloned = cloneComponentSubtree(
    document,
    source.root.id,
    input.rootNodeId,
    input.commandPrefix,
  );
  if (!cloned.ok) return cloned;
  const bounds = getLocalSelectionBounds(
    context.members.map(({ root }) => root),
  );
  if (!bounds)
    return failure("invalid", "Component set bounds are unavailable");
  const gap = input.gap ?? 32;
  const sourceTransform: Transform = [...source.root.transform];
  sourceTransform[4] = bounds.x + bounds.width + gap;
  const localById = new Map(
    context.members.map(({ root }) => [
      root.id,
      [...root.transform] as Transform,
    ]),
  );
  localById.set(input.rootNodeId, sourceTransform);
  const normalized = normalizeSetGeometry(
    document,
    context.root,
    localById,
    input.padding ?? 40,
    cloned.root,
  );
  if (!normalized.ok) return normalized;
  const component: ComponentDefinition = {
    ...structuredClone(source.component),
    id: input.componentId,
    name: input.name?.trim() || `${source.component.name} copy`,
    rootNodeId: input.rootNodeId,
    variantProperties: properties.value,
  };
  component.componentPropertyDefinitions = Object.fromEntries(
    Object.entries(component.componentPropertyDefinitions).map(
      ([propertyName, definition]) => [
        propertyName,
        definition.type === "SLOT"
          ? {
              ...definition,
              defaultValue:
                cloned.idMap.get(definition.defaultValue) ??
                definition.defaultValue,
            }
          : definition,
      ],
    ),
  );
  const components = [
    ...context.members.map(({ component }) => component),
    component,
  ];
  const nextSet = updateSetDefinition(
    context.set,
    components,
    new Map([[component.id, properties.value]]),
    normalized.transforms,
  );
  const commands = cloned.commands;
  const cloneRoot = commands.find(
    (command) =>
      command.type === "insert_element" && command.node.id === input.rootNodeId,
  );
  if (cloneRoot?.type === "insert_element")
    cloneRoot.node.transform = normalized.transforms.get(input.rootNodeId)!;
  commands.push(
    ...geometryCommands(
      context.root,
      normalized,
      input.commandPrefix,
      new Set([input.rootNodeId]),
    ),
  );
  commands.push(
    {
      commandId: `${input.commandPrefix}_put_component`,
      type: "put_component",
      component,
    },
    {
      commandId: `${input.commandPrefix}_put_set`,
      type: "put_variant_set",
      variantSet: nextSet,
    },
  );
  if (commands.length > MAX_TRANSACTION_COMMANDS)
    return failure(
      "operation-limit",
      "Duplicating this Variant exceeds the transaction command limit",
    );
  return success(
    nextSet,
    components,
    commands,
    [input.rootNodeId],
    component.id,
  );
}

export function planRemoveVariantFromSet(
  document: DesignDocument,
  input: {
    pageId: string;
    variantSetId: string;
    componentId: string;
    commandPrefix: string;
    padding?: number;
  },
): VariantSetOperationPlan {
  const context = membershipContext(document, input.pageId, input.variantSetId);
  if (!context.ok) return context;
  const removed = context.members.find(
    ({ component }) => component.id === input.componentId,
  );
  if (!removed)
    return failure(
      "missing-component",
      `Variant ${input.componentId} is not a member of ${context.set.id}`,
    );
  if (context.members.length === 1)
    return planDissolveVariantSet(document, input);
  const remaining = context.members.filter(
    ({ component }) => component.id !== input.componentId,
  );
  const localById = new Map(
    remaining.map(({ root }) => [root.id, [...root.transform] as Transform]),
  );
  const normalized = normalizeSetGeometry(
    document,
    context.root,
    localById,
    input.padding ?? 40,
  );
  if (!normalized.ok) return normalized;
  const nextSet = updateSetDefinition(
    context.set,
    remaining.map(({ component }) => component),
    new Map(),
    normalized.transforms,
  );
  const parentWorld = context.root.parentId
    ? getWorldTransform(document, context.root.parentId)
    : IDENTITY_TRANSFORM;
  const removedWorld = getWorldTransform(document, removed.root.id);
  const worldToParent = parentWorld ? invertTransform(parentWorld) : null;
  if (!removedWorld || !worldToParent)
    return failure("invalid", "Variant geometry cannot be preserved");
  const reconciled = reconcileInstancesForRemovedMembers(
    document,
    context.set,
    new Set([removed.component.id]),
    input.commandPrefix,
  );
  if (!reconciled.ok) return reconciled;
  const commands = reconciled.commands;
  commands.push(
    ...geometryCommands(context.root, normalized, input.commandPrefix),
  );
  commands.push(
    {
      commandId: `${input.commandPrefix}_extract_transform`,
      type: "update_properties",
      nodeId: removed.root.id,
      transform: multiplyTransforms(worldToParent, removedWorld),
      ...(removed.root.constraints ? { constraints: null } : {}),
      ...(removed.root.layoutPositioning ? { layoutPositioning: null } : {}),
    },
    {
      commandId: `${input.commandPrefix}_extract_move`,
      type: "move_element",
      nodeId: removed.root.id,
      pageId: input.pageId,
      parentId: context.root.parentId,
      index: siblingIndex(document, input.pageId, context.root) + 1,
    },
    {
      commandId: `${input.commandPrefix}_put_component`,
      type: "put_component",
      component: withoutVariantMembership(removed.component),
    },
    {
      commandId: `${input.commandPrefix}_put_set`,
      type: "put_variant_set",
      variantSet: nextSet,
    },
  );
  if (commands.length > MAX_TRANSACTION_COMMANDS)
    return failure(
      "operation-limit",
      "Removing this Variant exceeds the transaction command limit",
    );
  return success(
    nextSet,
    remaining.map(({ component }) => component),
    commands,
    [removed.root.id],
    removed.component.id,
  );
}

export function planDissolveVariantSet(
  document: DesignDocument,
  input: { pageId: string; variantSetId: string; commandPrefix: string },
): VariantSetOperationPlan {
  const context = membershipContext(document, input.pageId, input.variantSetId);
  if (!context.ok) return context;
  const parent = context.root.parentId
    ? document.nodesById[context.root.parentId]
    : undefined;
  if (
    parent?.kind === "frame" &&
    (parent.properties.autoLayout?.mode ?? "none") !== "none"
  ) {
    return failure(
      "invalid",
      "Dissolving into an Auto Layout parent cannot preserve member geometry",
    );
  }
  const parentWorld = context.root.parentId
    ? getWorldTransform(document, context.root.parentId)
    : IDENTITY_TRANSFORM;
  const worldToParent = parentWorld ? invertTransform(parentWorld) : null;
  if (!worldToParent)
    return failure("invalid", "Component Set geometry cannot be preserved");
  const reconciled = reconcileInstancesForRemovedMembers(
    document,
    context.set,
    new Set(context.members.map(({ component }) => component.id)),
    input.commandPrefix,
    true,
  );
  if (!reconciled.ok) return reconciled;
  const commands = reconciled.commands;
  const changedComponents = new Map<string, ComponentDefinition>();
  for (const component of Object.values(document.componentsById)) {
    const clean =
      component.variantSetId === context.set.id
        ? withoutVariantMembership(component)
        : structuredClone(component);
    const definitions = Object.fromEntries(
      Object.entries(clean.componentPropertyDefinitions).map(
        ([name, definition]) => [
          name,
          definition.type === "INSTANCE_SWAP" &&
          definition.preferredValues?.some(
            (value) =>
              value.type === "COMPONENT_SET" && value.key === context.set.id,
          )
            ? {
                ...definition,
                preferredValues: definition.preferredValues.filter(
                  (value) =>
                    !(
                      value.type === "COMPONENT_SET" &&
                      value.key === context.set.id
                    ),
                ),
              }
            : definition,
        ],
      ),
    );
    if (
      JSON.stringify(definitions) !==
        JSON.stringify(component.componentPropertyDefinitions) ||
      component.variantSetId === context.set.id
    ) {
      changedComponents.set(component.id, {
        ...clean,
        componentPropertyDefinitions: definitions,
      });
    }
  }
  const setIndex = siblingIndex(document, input.pageId, context.root);
  for (const [index, member] of context.members.entries()) {
    const world = getWorldTransform(document, member.root.id);
    if (!world)
      return failure(
        "invalid",
        `Variant ${member.component.id} geometry cannot be preserved`,
      );
    commands.push(
      {
        commandId: `${input.commandPrefix}_member_transform_${index}`,
        type: "update_properties",
        nodeId: member.root.id,
        transform: multiplyTransforms(worldToParent, world),
        ...(member.root.constraints ? { constraints: null } : {}),
        ...(member.root.layoutPositioning ? { layoutPositioning: null } : {}),
      },
      {
        commandId: `${input.commandPrefix}_member_move_${index}`,
        type: "move_element",
        nodeId: member.root.id,
        pageId: input.pageId,
        parentId: context.root.parentId,
        index: setIndex + index,
      },
    );
  }
  for (const [index, component] of [...changedComponents.values()].entries())
    commands.push({
      commandId: `${input.commandPrefix}_put_component_${index}`,
      type: "put_component",
      component,
    });
  commands.push(
    {
      commandId: `${input.commandPrefix}_delete_set`,
      type: "delete_variant_set",
      variantSetId: context.set.id,
    },
    {
      commandId: `${input.commandPrefix}_delete_root`,
      type: "delete_element",
      nodeId: context.root.id,
    },
  );
  if (commands.length > MAX_TRANSACTION_COMMANDS)
    return failure(
      "operation-limit",
      "Dissolving this Component Set exceeds the transaction command limit",
    );
  return success(
    context.set,
    context.members.map(({ component }) => component),
    commands,
    context.members.map(({ root }) => root.id),
  );
}
