import { resolveComponentInstance } from "@opendesign/component-service";
import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  InstanceSwapPreferredValue,
  SlotSettings,
} from "@opendesign/design-contracts";
import type { ComponentOperationPlan } from "./component-operations.js";

export function applySlotStretchOnInsert(
  document: DesignDocument,
  parentId: string,
  inserted: DesignNode,
): void {
  const parent = document.nodesById[parentId];
  if (parent?.kind !== "slot" || inserted.layoutPositioning === "absolute")
    return;
  const sourceSlotId = parent.properties.sourceSlotId ?? parent.id;
  const definition = Object.values(document.componentsById)
    .flatMap((component) =>
      Object.values(component.componentPropertyDefinitions),
    )
    .find(
      (candidate) =>
        candidate.type === "SLOT" && candidate.defaultValue === sourceSlotId,
    );
  if (
    definition?.type !== "SLOT" ||
    !definition.slotSettings?.stretchChildOnInsert
  )
    return;
  const mode = parent.properties.autoLayout?.mode;
  if (mode !== "horizontal" && mode !== "vertical") return;
  inserted.layoutSizing = {
    horizontal:
      mode === "vertical"
        ? "fill"
        : (inserted.layoutSizing?.horizontal ?? "fixed"),
    vertical:
      mode === "horizontal"
        ? "fill"
        : (inserted.layoutSizing?.vertical ?? "fixed"),
  };
  if (
    inserted.kind === "text" &&
    ((inserted.properties.textResize === "auto-width" &&
      (inserted.layoutSizing.horizontal === "fill" ||
        inserted.layoutSizing.vertical === "fill")) ||
      (inserted.properties.textResize === "auto-height" &&
        inserted.layoutSizing.vertical === "fill"))
  ) {
    inserted.properties = {
      ...inserted.properties,
      textResize: "fixed",
      textWrap: "word",
    };
  }
}

export function replaceSlotContainerKindCommand(
  document: DesignDocument,
  root: Extract<DesignNode, { kind: "frame" | "slot" }>,
  kind: "frame" | "slot",
  commandId: string,
): Extract<DesignOperation, { type: "replace_subtree" }> {
  const nodes: DesignNode[] = [];
  const visit = (nodeId: string): void => {
    const node = document.nodesById[nodeId];
    if (!node) return;
    if (node.id === root.id) {
      if (kind === "slot" && node.kind === "frame") {
        const { layoutGuides: _layoutGuides, ...properties } = node.properties;
        void _layoutGuides;
        nodes.push({
          ...structuredClone(node),
          kind: "slot",
          properties: { ...structuredClone(properties), sourceSlotId: null },
        });
      } else if (kind === "frame" && node.kind === "slot") {
        const { sourceSlotId: _sourceSlotId, ...properties } = node.properties;
        void _sourceSlotId;
        nodes.push({
          ...structuredClone(node),
          kind: "frame",
          properties: structuredClone(properties),
        });
      }
    } else {
      nodes.push(structuredClone(node));
    }
    node.childIds.forEach(visit);
  };
  visit(root.id);
  return {
    commandId,
    type: "replace_subtree",
    rootNodeId: root.id,
    nodes,
  };
}

export function hasSlotAncestor(
  document: DesignDocument,
  node: DesignNode,
): boolean {
  const visited = new Set<string>();
  let parentId = node.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = document.nodesById[parentId];
    if (parent?.kind === "slot") return true;
    parentId = parent?.parentId ?? null;
  }
  return false;
}

export function hasSlotDescendant(
  document: DesignDocument,
  node: DesignNode,
): boolean {
  const pending = [...node.childIds];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const child = document.nodesById[nodeId];
    if (child?.kind === "slot") return true;
    if (child) pending.push(...child.childIds);
  }
  return false;
}

export function planCreateComponentSlotOverride(
  document: DesignDocument,
  input: {
    instanceId: string;
    propertyName: string;
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const context = slotContext(document, input.instanceId, input.propertyName);
  if (!context.ok) return context;
  if (context.override)
    return failure("no-op", "Slot contents are already overridden");
  const cloned = cloneSlotSubtree(
    document,
    context.source.id,
    context.instance.id,
    input.commandPrefix,
    false,
  );
  if (!cloned.ok) return cloned;
  return success(
    context,
    insertionCommands(
      document,
      context.pageId,
      cloned.nodes,
      input.commandPrefix,
    ),
  );
}

export function planClearComponentSlot(
  document: DesignDocument,
  input: {
    instanceId: string;
    propertyName: string;
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const context = slotContext(document, input.instanceId, input.propertyName);
  if (!context.ok) return context;
  if (context.override && context.override.childIds.length === 0) {
    return failure("no-op", "Slot contents are already empty");
  }
  const cloned = cloneSlotSubtree(
    document,
    context.source.id,
    context.instance.id,
    input.commandPrefix,
    true,
  );
  if (!cloned.ok) return cloned;
  const commands: DesignOperation[] = context.override
    ? [
        {
          commandId: `${input.commandPrefix}_delete_previous_override`,
          type: "delete_element",
          nodeId: context.override.id,
        },
      ]
    : [];
  commands.push(
    ...insertionCommands(
      document,
      context.pageId,
      cloned.nodes,
      input.commandPrefix,
      context.override
        ? context.instance.childIds.indexOf(context.override.id)
        : undefined,
    ),
  );
  return success(context, commands);
}

export function planResetComponentSlot(
  document: DesignDocument,
  input: {
    instanceId: string;
    propertyName: string;
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const context = slotContext(document, input.instanceId, input.propertyName);
  if (!context.ok) return context;
  if (!context.override)
    return failure("no-op", "Slot already uses its default contents");
  return success(context, [
    {
      commandId: `${input.commandPrefix}_reset_slot`,
      type: "delete_element",
      nodeId: context.override.id,
    },
  ]);
}

export function planSetComponentSlotSettings(
  document: DesignDocument,
  input: {
    componentId: string;
    propertyName: string;
    settings: SlotSettings;
    preferredValues?: readonly InstanceSwapPreferredValue[];
    description?: string;
    commandPrefix: string;
  },
): ComponentOperationPlan {
  const component = document.componentsById[input.componentId];
  const definition =
    component?.componentPropertyDefinitions[input.propertyName];
  if (!component || definition?.type !== "SLOT") {
    return failure(
      "missing-component",
      `SLOT property ${input.propertyName} does not exist`,
    );
  }
  if (
    input.settings.minChildren != null &&
    input.settings.maxChildren != null &&
    input.settings.minChildren > input.settings.maxChildren
  ) {
    return failure(
      "invalid",
      "Slot minimum children must not exceed maximum children",
    );
  }
  const preferred = normalizePreferred(document, input.preferredValues);
  if (!preferred.ok) return preferred;
  const next = structuredClone(component);
  next.componentPropertyDefinitions[input.propertyName] = {
    type: "SLOT",
    defaultValue: definition.defaultValue,
    ...(preferred.values.length ? { preferredValues: preferred.values } : {}),
    ...(input.description?.trim()
      ? { description: input.description.trim() }
      : {}),
    slotSettings: structuredClone(input.settings),
  };
  if (JSON.stringify(next) === JSON.stringify(component)) {
    return failure("no-op", "Slot settings are unchanged");
  }
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_set_slot_settings`,
        type: "put_component",
        component: next,
      },
    ],
    componentId: component.id,
    mainNodeId: component.rootNodeId,
    selectionNodeIds: [definition.defaultValue],
  };
}

type SlotContext = Extract<ReturnType<typeof slotContext>, { ok: true }>;

function slotContext(
  document: DesignDocument,
  instanceId: string,
  propertyName: string,
):
  | {
      ok: true;
      componentId: string;
      componentRootNodeId: string;
      instance: Extract<DesignNode, { kind: "instance" }>;
      override?: Extract<DesignNode, { kind: "slot" }>;
      pageId: string;
      source: Extract<DesignNode, { kind: "slot" }>;
    }
  | Extract<ComponentOperationPlan, { ok: false }> {
  const instance = document.nodesById[instanceId];
  if (!instance || instance.kind !== "instance") {
    return failure("missing-instance", `Instance ${instanceId} does not exist`);
  }
  const resolution = resolveComponentInstance(document, instance.id);
  if (!resolution.ok) {
    return failure(
      "invalid",
      resolution.issues[0]?.message ?? "Instance cannot be resolved",
    );
  }
  const slot = resolution.slots.find(
    (candidate) => candidate.propertyName === propertyName,
  );
  if (!slot) {
    return failure(
      "missing-component",
      `SLOT property ${propertyName} does not exist on this Instance`,
    );
  }
  const source = document.nodesById[slot.sourceSlotNodeId];
  const component = document.componentsById[resolution.componentId];
  const pageId = pageContainingNode(document, instance.id);
  if (!component || source?.kind !== "slot" || !pageId) {
    return failure(
      "missing-source-node",
      `Slot source ${slot.sourceSlotNodeId} is unavailable`,
    );
  }
  const override = instance.childIds
    .map((childId) => document.nodesById[childId])
    .find(
      (node): node is Extract<DesignNode, { kind: "slot" }> =>
        node?.kind === "slot" && node.properties.sourceSlotId === source.id,
    );
  return {
    ok: true,
    componentId: component.id,
    componentRootNodeId: component.rootNodeId,
    instance,
    ...(override ? { override } : {}),
    pageId,
    source,
  };
}

function cloneSlotSubtree(
  document: DesignDocument,
  sourceSlotId: string,
  instanceId: string,
  idPrefix: string,
  clear: boolean,
):
  | { ok: true; nodes: DesignNode[] }
  | Extract<ComponentOperationPlan, { ok: false }> {
  const source = document.nodesById[sourceSlotId];
  if (source?.kind !== "slot") {
    return failure(
      "missing-source-node",
      `Slot ${sourceSlotId} does not exist`,
    );
  }
  const ids = new Map<string, string>();
  const sourceIds: string[] = [];
  const collect = (nodeId: string): void => {
    const node = document.nodesById[nodeId];
    if (!node) return;
    sourceIds.push(nodeId);
    if (!clear) node.childIds.forEach(collect);
  };
  collect(source.id);
  for (const [index, sourceId] of sourceIds.entries()) {
    let candidate = `${idPrefix}_slot_${index}`;
    let suffix = 0;
    while (
      document.nodesById[candidate] ||
      [...ids.values()].includes(candidate)
    ) {
      suffix += 1;
      candidate = `${idPrefix}_slot_${index}_${suffix}`;
    }
    ids.set(sourceId, candidate);
  }
  const nodes = sourceIds.map((sourceId): DesignNode => {
    const node = document.nodesById[sourceId]!;
    const clone = structuredClone(node);
    clone.id = ids.get(sourceId)!;
    clone.parentId =
      sourceId === source.id ? instanceId : ids.get(node.parentId!)!;
    clone.childIds = [];
    if (sourceId === source.id && clone.kind === "slot") {
      clone.properties.sourceSlotId = source.id;
    }
    return clone;
  });
  return { ok: true, nodes };
}

function insertionCommands(
  document: DesignDocument,
  pageId: string,
  nodes: readonly DesignNode[],
  commandPrefix: string,
  rootIndex?: number,
): DesignOperation[] {
  const pendingChildren = new Map<string, number>();
  return nodes.map((node, index) => {
    const parentKey = node.parentId ?? `page:${pageId}`;
    const pending = pendingChildren.get(parentKey) ?? 0;
    pendingChildren.set(parentKey, pending + 1);
    const existing = node.parentId
      ? (document.nodesById[node.parentId]?.childIds.length ?? 0)
      : (document.pagesById[pageId]?.rootNodeIds.length ?? 0);
    return {
      commandId: `${commandPrefix}_insert_slot_node_${index}`,
      type: "insert_element" as const,
      pageId,
      parentId: node.parentId,
      index: index === 0 ? (rootIndex ?? existing) : existing + pending,
      node,
    };
  });
}

function pageContainingNode(
  document: DesignDocument,
  nodeId: string,
): string | null {
  let current = document.nodesById[nodeId];
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    current = document.nodesById[current.parentId];
  }
  if (!current) return null;
  return (
    document.pageOrder.find((pageId) =>
      document.pagesById[pageId]?.rootNodeIds.includes(current.id),
    ) ?? null
  );
}

function normalizePreferred(
  document: DesignDocument,
  values: readonly InstanceSwapPreferredValue[] | undefined,
):
  | { ok: true; values: InstanceSwapPreferredValue[] }
  | Extract<ComponentOperationPlan, { ok: false }> {
  const result = new Map<string, InstanceSwapPreferredValue>();
  for (const value of values ?? []) {
    const exists =
      value.type === "COMPONENT"
        ? document.componentsById[value.key]
        : document.variantSetsById[value.key];
    if (!exists)
      return failure(
        "invalid",
        `Preferred ${value.type} ${value.key} does not exist`,
      );
    result.set(`${value.type}:${value.key}`, structuredClone(value));
  }
  return { ok: true, values: [...result.values()] };
}

function success(
  context: SlotContext,
  commands: DesignOperation[],
): ComponentOperationPlan {
  return {
    ok: true,
    commands,
    componentId: context.componentId,
    instanceId: context.instance.id,
    mainNodeId: context.componentRootNodeId,
    selectionNodeIds: [context.instance.id],
  };
}

function failure(
  code: Extract<ComponentOperationPlan, { ok: false }>["code"],
  message: string,
): Extract<ComponentOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
