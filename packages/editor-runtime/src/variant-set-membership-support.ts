import { resolveComponentInstance } from "@opendesign/component-service";
import {
  type ComponentDefinition,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
  type FrameNode,
  type Transform,
  type VariantProperties,
  type VariantPropertyDefinitions,
  type VariantSetDefinition,
} from "@opendesign/design-contracts";
import { getLocalSelectionBounds, multiplyTransforms } from "./geometry.js";
import type {
  VariantSetOperationPlan,
  VariantSetOperationFailureCode,
} from "./variant-set-operations.js";

export type MembershipContext = {
  ok: true;
  set: VariantSetDefinition;
  root: FrameNode;
  members: Array<{ component: ComponentDefinition; root: DesignNode }>;
};

export function membershipContext(
  document: DesignDocument,
  pageId: string,
  variantSetId: string,
): MembershipContext | Extract<VariantSetOperationPlan, { ok: false }> {
  if (!document.pagesById[pageId])
    return failure("invalid", `Page ${pageId} does not exist`);
  const set = document.variantSetsById[variantSetId];
  if (!set)
    return failure("invalid", `Component set ${variantSetId} does not exist`);
  const root = document.nodesById[set.rootNodeId];
  if (!root || root.kind !== "frame")
    return failure(
      "invalid",
      `Component set root ${set.rootNodeId} is unavailable`,
    );
  if (!nodeBelongsToPage(document, pageId, root.id))
    return failure(
      "invalid",
      `Component set ${set.id} is outside Page ${pageId}`,
    );
  if (isEffectivelyLocked(document, root.id))
    return failure("locked", `Component set ${set.id} is locked`);
  const members = root.childIds.flatMap((rootNodeId) => {
    const component = Object.values(document.componentsById).find(
      (candidate) =>
        candidate.variantSetId === set.id &&
        candidate.rootNodeId === rootNodeId,
    );
    const memberRoot = document.nodesById[rootNodeId];
    return component && memberRoot ? [{ component, root: memberRoot }] : [];
  });
  if (members.length !== root.childIds.length || members.length === 0)
    return failure(
      "invalid",
      `Component set ${set.id} has an invalid member hierarchy`,
    );
  return { ok: true, set, root, members };
}

export function normalizeMemberProperties(
  set: VariantSetDefinition,
  input: Readonly<Record<string, string>>,
):
  | { ok: true; value: VariantProperties }
  | Extract<VariantSetOperationPlan, { ok: false }> {
  const names = [...set.propertyOrder];
  if (Object.keys(input).sort().join("\u0000") !== names.join("\u0000"))
    return failure(
      "invalid",
      "Every Variant must define the Component Set's complete property collection",
    );
  const value: VariantProperties = {};
  for (const name of names) {
    const candidate = input[name]?.trim() ?? "";
    if (!candidate || candidate.length > 256 || /\p{Cc}/u.test(candidate))
      return failure(
        "invalid",
        `Variant value for ${name} must contain 1 to 256 non-control characters`,
      );
    value[name] = candidate;
  }
  return { ok: true, value };
}

export function sameCombination(
  left: VariantProperties,
  right: VariantProperties,
): boolean {
  const names = Object.keys(left).sort();
  return (
    names.length === Object.keys(right).length &&
    names.every((name) => left[name] === right[name])
  );
}

export function normalizeSetGeometry(
  document: DesignDocument,
  root: FrameNode,
  localById: ReadonlyMap<string, Transform>,
  padding: number,
  extraRoot?: DesignNode,
):
  | {
      ok: true;
      rootTransform: Transform;
      size: { width: number; height: number };
      transforms: Map<string, Transform>;
    }
  | Extract<VariantSetOperationPlan, { ok: false }> {
  if (!Number.isFinite(padding) || padding < 0 || padding > 1_024)
    return failure("invalid", "Component set padding must be from 0 to 1024");
  const nodes = [...localById].flatMap(([nodeId, transform]) => {
    const node =
      nodeId === extraRoot?.id ? extraRoot : document.nodesById[nodeId];
    return node ? [{ ...node, transform }] : [];
  });
  if (nodes.length !== localById.size)
    return failure("invalid", "Component set member geometry is unavailable");
  const bounds = getLocalSelectionBounds(nodes);
  if (!bounds)
    return failure("invalid", "Component set member bounds are unavailable");
  const deltaX = bounds.x - padding;
  const deltaY = bounds.y - padding;
  const rootTransform = multiplyTransforms(root.transform, [
    1,
    0,
    0,
    1,
    deltaX,
    deltaY,
  ]);
  const toNormalized: Transform = [1, 0, 0, 1, -deltaX, -deltaY];
  return {
    ok: true,
    rootTransform,
    size: {
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
    },
    transforms: new Map(
      [...localById].map(([id, transform]) => [
        id,
        multiplyTransforms(toNormalized, transform),
      ]),
    ),
  };
}

export function geometryCommands(
  root: FrameNode,
  normalized: Extract<ReturnType<typeof normalizeSetGeometry>, { ok: true }>,
  prefix: string,
  excluded = new Set<string>(),
): DesignOperation[] {
  const commands: DesignOperation[] = [];
  for (const [nodeId, transform] of normalized.transforms) {
    if (excluded.has(nodeId)) continue;
    commands.push({
      commandId: `${prefix}_member_geometry_${commands.length}`,
      type: "update_properties",
      nodeId,
      transform,
    });
  }
  commands.push({
    commandId: `${prefix}_set_geometry`,
    type: "update_properties",
    nodeId: root.id,
    transform: normalized.rootTransform,
    size: normalized.size,
  });
  return commands;
}

export function updateSetDefinition(
  set: VariantSetDefinition,
  components: readonly ComponentDefinition[],
  overrides: ReadonlyMap<string, VariantProperties>,
  transforms: ReadonlyMap<string, Transform>,
): VariantSetDefinition {
  const spatial = [...components].sort((left, right) => {
    const leftTransform = transforms.get(left.rootNodeId)!;
    const rightTransform = transforms.get(right.rootNodeId)!;
    return (
      leftTransform[5] - rightTransform[5] ||
      leftTransform[4] - rightTransform[4] ||
      left.id.localeCompare(right.id)
    );
  });
  const defaultComponent = spatial[0]!;
  const propertiesFor = (component: ComponentDefinition) =>
    overrides.get(component.id) ?? component.variantProperties;
  const definitions: VariantPropertyDefinitions = Object.fromEntries(
    set.propertyOrder.map((name) => {
      const values = spatial
        .map((component) => propertiesFor(component)[name]!)
        .filter((value, index, all) => all.indexOf(value) === index);
      return [
        name,
        {
          type: "VARIANT" as const,
          defaultValue: propertiesFor(defaultComponent)[name]!,
          variantOptions: values,
        },
      ];
    }),
  );
  return {
    ...structuredClone(set),
    defaultComponentId: defaultComponent.id,
    componentPropertyDefinitions: definitions,
  };
}

export function withoutVariantMembership(
  component: ComponentDefinition,
): ComponentDefinition {
  const clone = structuredClone(component);
  delete clone.variantSetId;
  clone.variantProperties = {};
  return clone;
}

export function siblingIndex(
  document: DesignDocument,
  pageId: string,
  node: DesignNode,
): number {
  const siblings = node.parentId
    ? document.nodesById[node.parentId]?.childIds
    : document.pagesById[pageId]?.rootNodeIds;
  return Math.max(0, siblings?.indexOf(node.id) ?? 0);
}

export function cloneComponentSubtree(
  document: DesignDocument,
  sourceRootId: string,
  rootNodeId: string,
  prefix: string,
):
  | {
      ok: true;
      root: DesignNode;
      commands: DesignOperation[];
      idMap: ReadonlyMap<string, string>;
    }
  | Extract<VariantSetOperationPlan, { ok: false }> {
  const sourceRoot = document.nodesById[sourceRootId];
  if (!sourceRoot)
    return failure(
      "missing-component",
      `Component root ${sourceRootId} is unavailable`,
    );
  const idMap = new Map<string, string>([[sourceRootId, rootNodeId]]);
  let sequence = 0;
  const collect = (nodeId: string) => {
    const node = document.nodesById[nodeId];
    if (!node) return false;
    for (const childId of node.childIds) {
      const nextId = `${rootNodeId}__${++sequence}`;
      if (document.nodesById[nextId]) return false;
      idMap.set(childId, nextId);
      if (!collect(childId)) return false;
    }
    return true;
  };
  if (!collect(sourceRootId))
    return failure("duplicate", "A generated Variant layer ID already exists");
  const commands: DesignOperation[] = [];
  const emit = (sourceId: string, index: number) => {
    const source = document.nodesById[sourceId]!;
    const clone = structuredClone(source);
    clone.id = idMap.get(sourceId)!;
    clone.name =
      sourceId === sourceRootId ? `${source.name} copy`.trim() : source.name;
    clone.parentId =
      sourceId === sourceRootId
        ? sourceRoot.parentId
        : idMap.get(source.parentId!)!;
    clone.childIds = [];
    commands.push({
      commandId: `${prefix}_insert_clone_${commands.length}`,
      type: "insert_element",
      pageId: pageIdForNode(document, sourceRootId)!,
      parentId: clone.parentId,
      index:
        sourceId === sourceRootId
          ? (document.nodesById[sourceRoot.parentId ?? ""]?.childIds.length ??
            0)
          : index,
      node: clone,
    });
    source.childIds.forEach(emit);
  };
  emit(sourceRootId, 0);
  return {
    ok: true,
    root: { ...structuredClone(sourceRoot), id: rootNodeId },
    commands,
    idMap,
  };
}

export function reconcileInstancesForRemovedMembers(
  document: DesignDocument,
  set: VariantSetDefinition,
  removedComponentIds: ReadonlySet<string>,
  prefix: string,
  dissolve = false,
):
  | { ok: true; commands: DesignOperation[] }
  | Extract<VariantSetOperationPlan, { ok: false }> {
  const memberIds = new Set(
    Object.values(document.componentsById)
      .filter((component) => component.variantSetId === set.id)
      .map((component) => component.id),
  );
  const propertyNames = new Set(Object.keys(set.componentPropertyDefinitions));
  const commands: DesignOperation[] = [];
  for (const node of Object.values(document.nodesById)) {
    if (node.kind !== "instance" || !memberIds.has(node.properties.componentId))
      continue;
    const resolution = resolveComponentInstance(document, node.id);
    if (!resolution.ok)
      return failure(
        "invalid",
        resolution.issues[0]?.message ??
          `Instance ${node.id} cannot be resolved`,
      );
    const selectedRemoved = removedComponentIds.has(resolution.componentId);
    if (
      !dissolve &&
      !selectedRemoved &&
      !removedComponentIds.has(node.properties.componentId)
    )
      continue;
    const componentProperties = Object.fromEntries(
      Object.entries(node.properties.componentProperties).filter(
        ([name]) => !(dissolve || selectedRemoved) || !propertyNames.has(name),
      ),
    );
    commands.push({
      commandId: `${prefix}_reconcile_instance_${commands.length}`,
      type: "update_properties",
      nodeId: node.id,
      properties: {
        componentId: resolution.componentId,
        componentProperties,
      },
    });
  }
  return { ok: true, commands };
}

function pageIdForNode(
  document: DesignDocument,
  nodeId: string,
): string | undefined {
  return document.pageOrder.find((pageId) =>
    nodeBelongsToPage(document, pageId, nodeId),
  );
}

export function success(
  set: VariantSetDefinition,
  components: readonly ComponentDefinition[],
  commands: DesignOperation[],
  selectionNodeIds: readonly string[],
  primaryComponentId?: string,
): Extract<VariantSetOperationPlan, { ok: true }> {
  const component =
    components.find((candidate) => candidate.id === primaryComponentId) ??
    components.find((candidate) => candidate.id === set.defaultComponentId) ??
    components[0]!;
  return {
    ok: true,
    commands,
    componentId: component.id,
    mainNodeId: component.rootNodeId,
    variantSetId: set.id,
    rootNodeId: set.rootNodeId,
    componentIds: components.map((candidate) => candidate.id),
    defaultComponentId: set.defaultComponentId,
    selectionNodeIds,
  };
}

export function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const visited = new Set<string>();
  let node: DesignNode | undefined = document.nodesById[nodeId];
  while (node) {
    if (visited.has(node.id)) return false;
    visited.add(node.id);
    if (node.parentId === null) {
      return document.pagesById[pageId]?.rootNodeIds.includes(node.id) ?? false;
    }
    node = document.nodesById[node.parentId];
  }
  return false;
}

export function isEffectivelyLocked(
  document: DesignDocument,
  nodeId: string,
): boolean {
  const visited = new Set<string>();
  let node: DesignNode | undefined = document.nodesById[nodeId];
  while (node) {
    if (visited.has(node.id) || node.locked) return true;
    visited.add(node.id);
    node = node.parentId ? document.nodesById[node.parentId] : undefined;
  }
  return false;
}

export function failure(
  code: VariantSetOperationFailureCode,
  message: string,
): Extract<VariantSetOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
