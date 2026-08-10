import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  Transform,
} from "@opendesign/design-contracts";
import { MAX_TRANSACTION_COMMANDS } from "@opendesign/design-contracts";
import {
  getWorldTransform,
  IDENTITY_TRANSFORM,
  invertTransform,
  multiplyTransforms,
  transformPoint,
} from "./geometry.js";

export type LayerOperationFailureCode =
  | "invalid-selection"
  | "invalid-target"
  | "locked"
  | "mixed-parent"
  | "not-found"
  | "operation-limit"
  | "visual-fidelity";

export type LayerOrderAction =
  "bring-forward" | "bring-to-front" | "send-backward" | "send-to-back";

export type LayerOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      selectionNodeIds: string[];
      warnings?: string[];
    }
  | {
      ok: false;
      code: LayerOperationFailureCode;
      message: string;
    };

type LayerOperationFailure = Extract<LayerOperationPlan, { ok: false }>;

export function planGroupNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  options: { groupId: string; name: string; commandPrefix: string },
): LayerOperationPlan {
  if (document.nodesById[options.groupId]) {
    return failure(
      "invalid-selection",
      `Node ${options.groupId} already exists`,
    );
  }
  const eligibility = analyzeGroupSelection(document, pageId, nodeIds);
  if (!eligibility.ok) return eligibility;
  const { bounds, ordered, parentId, siblings } = eligibility;
  if (1 + ordered.length * 2 > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Grouping ${ordered.length} layers exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  const groupTransform: Transform = [1, 0, 0, 1, bounds.x, bounds.y];
  const toGroupLocal: Transform = [1, 0, 0, 1, -bounds.x, -bounds.y];
  const group: DesignNode = {
    id: options.groupId,
    kind: "group",
    name: options.name,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: groupTransform,
    size: { width: bounds.width, height: bounds.height },
    opacity: 1,
    properties: {},
    extensions: {},
  };
  const commands: DesignOperation[] = [
    {
      commandId: `${options.commandPrefix}_insert`,
      type: "insert_element",
      pageId,
      parentId,
      index: Math.min(...ordered.map((nodeId) => siblings.indexOf(nodeId))),
      node: group,
    },
  ];
  for (const [index, nodeId] of ordered.entries()) {
    const node = document.nodesById[nodeId]!;
    commands.push(
      {
        commandId: `${options.commandPrefix}_transform_${index}`,
        type: "update_properties",
        nodeId,
        transform: multiplyTransforms(toGroupLocal, node.transform),
      },
      {
        commandId: `${options.commandPrefix}_move_${index}`,
        type: "move_element",
        nodeId,
        pageId,
        parentId: options.groupId,
        index,
      },
    );
  }
  return { ok: true, commands, selectionNodeIds: [options.groupId] };
}

export function planUngroupNode(
  document: DesignDocument,
  pageId: string,
  groupId: string,
  commandPrefix: string,
): LayerOperationPlan {
  const eligibility = analyzeUngroupSelection(document, pageId, groupId);
  if (!eligibility.ok) return eligibility;
  const { group, groupIndex } = eligibility;
  if (1 + group.childIds.length * 2 > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Ungrouping ${group.childIds.length} layers exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  const commands: DesignOperation[] = [];
  for (const [index, nodeId] of group.childIds.entries()) {
    const child = document.nodesById[nodeId];
    if (!child) {
      return failure("not-found", `Group child ${nodeId} does not exist`);
    }
    commands.push(
      {
        commandId: `${commandPrefix}_transform_${index}`,
        type: "update_properties",
        nodeId,
        transform: multiplyTransforms(group.transform, child.transform),
      },
      {
        commandId: `${commandPrefix}_move_${index}`,
        type: "move_element",
        nodeId,
        pageId,
        parentId: group.parentId,
        index: groupIndex + index,
      },
    );
  }
  commands.push({
    commandId: `${commandPrefix}_delete`,
    type: "delete_element",
    nodeId: group.id,
  });
  return { ok: true, commands, selectionNodeIds: [...group.childIds] };
}

export function canGroupNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): boolean {
  const eligibility = analyzeGroupSelection(document, pageId, nodeIds);
  return (
    eligibility.ok &&
    1 + eligibility.ordered.length * 2 <= MAX_TRANSACTION_COMMANDS
  );
}

export function canUngroupNode(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): boolean {
  if (nodeIds.length !== 1) return false;
  const eligibility = analyzeUngroupSelection(document, pageId, nodeIds[0]!);
  return (
    eligibility.ok &&
    1 + eligibility.group.childIds.length * 2 <= MAX_TRANSACTION_COMMANDS
  );
}

export function planReorderNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  action: LayerOrderAction,
  commandPrefix: string,
): LayerOperationPlan {
  const eligibility = analyzeReorderSelection(document, pageId, nodeIds);
  if (!eligibility.ok) return eligibility;
  const { ordered, siblings } = eligibility;
  const selected = new Set(ordered);
  const working = [...siblings];
  const moves: Array<{ nodeId: string; index: number }> = [];
  const move = (nodeId: string, index: number) => {
    const currentIndex = working.indexOf(nodeId);
    if (currentIndex < 0 || currentIndex === index) return;
    working.splice(currentIndex, 1);
    working.splice(index, 0, nodeId);
    moves.push({ nodeId, index });
  };

  if (action === "bring-forward") {
    for (let index = working.length - 2; index >= 0; index -= 1) {
      const nodeId = working[index];
      const nextNodeId = working[index + 1];
      if (
        nodeId &&
        nextNodeId &&
        selected.has(nodeId) &&
        !selected.has(nextNodeId)
      ) {
        move(nodeId, index + 1);
      }
    }
  } else if (action === "send-backward") {
    for (let index = 1; index < working.length; index += 1) {
      const nodeId = working[index];
      const previousNodeId = working[index - 1];
      if (
        nodeId &&
        previousNodeId &&
        selected.has(nodeId) &&
        !selected.has(previousNodeId)
      ) {
        move(nodeId, index - 1);
      }
    }
  } else if (action === "bring-to-front") {
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const nodeId = ordered[index];
      if (nodeId) move(nodeId, working.length - ordered.length + index);
    }
  } else {
    for (const [index, nodeId] of ordered.entries()) move(nodeId, index);
  }

  if (moves.length === 0) {
    return failure(
      "invalid-selection",
      `Selected layers cannot move ${layerOrderDirection(action)}`,
    );
  }
  if (moves.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Reordering ${ordered.length} layers exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return {
    ok: true,
    commands: moves.map(({ nodeId, index }, moveIndex) => ({
      commandId: `${commandPrefix}_move_${moveIndex}`,
      type: "move_element",
      nodeId,
      pageId,
      parentId: eligibility.parentId,
      index,
    })),
    selectionNodeIds: ordered,
  };
}

export function canReorderNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  action: LayerOrderAction,
): boolean {
  return planReorderNodes(
    document,
    pageId,
    nodeIds,
    action,
    "reorder_eligibility",
  ).ok;
}

export function planReparentNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  options: {
    parentId: string | null;
    index: number;
    commandPrefix: string;
  },
): LayerOperationPlan {
  const selection = analyzeReorderSelection(document, pageId, nodeIds);
  if (!selection.ok) return selection;
  const {
    ordered,
    parentId: sourceParentId,
    siblings: sourceSiblings,
  } = selection;
  const targetParent = options.parentId
    ? document.nodesById[options.parentId]
    : undefined;
  if (options.parentId && !targetParent) {
    return failure(
      "not-found",
      `Target parent ${options.parentId} does not exist`,
    );
  }
  if (
    targetParent &&
    targetParent.kind !== "frame" &&
    targetParent.kind !== "group"
  ) {
    return failure(
      "invalid-target",
      "Layers can only be moved to the Page root, a Frame, or a Group",
    );
  }
  if (targetParent && !nodeBelongsToPage(document, pageId, targetParent.id)) {
    return failure(
      "invalid-target",
      "The target parent does not belong to the target Page hierarchy",
    );
  }
  if (targetParent && isEffectivelyLocked(document, targetParent.id)) {
    return failure("locked", "Layers cannot be moved into a locked container");
  }
  if (
    options.parentId &&
    ordered.some(
      (nodeId) =>
        nodeId === options.parentId ||
        nodeContains(document, nodeId, options.parentId!),
    )
  ) {
    return failure(
      "invalid-target",
      "A layer cannot be moved into itself or one of its descendants",
    );
  }

  const targetSiblings = childIds(document, pageId, options.parentId);
  if (!targetSiblings) {
    return failure("invalid-target", "Target hierarchy is unavailable");
  }
  const selected = new Set(ordered);
  const targetWithoutSelection = targetSiblings.filter(
    (nodeId) => !selected.has(nodeId),
  );
  if (
    !Number.isInteger(options.index) ||
    options.index < 0 ||
    options.index > targetWithoutSelection.length
  ) {
    return failure(
      "invalid-target",
      `Target index ${options.index} is outside the final parent range 0..${targetWithoutSelection.length}`,
    );
  }
  if (
    sourceParentId !== options.parentId &&
    sourceParentId &&
    document.nodesById[sourceParentId]?.kind === "group" &&
    sourceSiblings.every((nodeId) => selected.has(nodeId))
  ) {
    return failure(
      "invalid-target",
      "Moving these layers would leave their source Group empty; move or ungroup the Group instead",
    );
  }

  const targetOrder = [
    ...targetWithoutSelection.slice(0, options.index),
    ...ordered,
    ...targetWithoutSelection.slice(options.index),
  ];
  if (
    sourceParentId === options.parentId &&
    arraysEqual(sourceSiblings, targetOrder)
  ) {
    return failure(
      "invalid-selection",
      "Selected layers are already at the requested hierarchy position",
    );
  }

  const projected = structuredClone(document);
  const selectedWorldTransforms = new Map<string, Transform>();
  for (const nodeId of ordered) {
    const world = getWorldTransform(document, nodeId);
    if (!world) {
      return failure(
        "visual-fidelity",
        `Layer ${nodeId} has an invalid world transform`,
      );
    }
    selectedWorldTransforms.set(nodeId, world);
  }
  const targetParentWorld = options.parentId
    ? getWorldTransform(document, options.parentId)
    : IDENTITY_TRANSFORM;
  const worldToTarget = targetParentWorld
    ? invertTransform(targetParentWorld)
    : null;
  if (!worldToTarget) {
    return failure(
      "visual-fidelity",
      "The target container transform is not invertible, so world geometry cannot be preserved",
    );
  }

  const projectedSourceSiblings = mutableChildIds(
    projected,
    pageId,
    sourceParentId,
  );
  if (!projectedSourceSiblings) {
    return failure("invalid-target", "Source hierarchy is unavailable");
  }
  projectedSourceSiblings.splice(
    0,
    projectedSourceSiblings.length,
    ...projectedSourceSiblings.filter((nodeId) => !selected.has(nodeId)),
  );
  const projectedTargetSiblings = mutableChildIds(
    projected,
    pageId,
    options.parentId,
  );
  if (!projectedTargetSiblings) {
    return failure("invalid-target", "Target hierarchy is unavailable");
  }
  if (sourceParentId === options.parentId) {
    projectedTargetSiblings.splice(
      0,
      projectedTargetSiblings.length,
      ...targetOrder,
    );
  } else {
    projectedTargetSiblings.splice(options.index, 0, ...ordered);
  }
  for (const nodeId of ordered) {
    const node = projected.nodesById[nodeId];
    const world = selectedWorldTransforms.get(nodeId);
    if (!node || !world) {
      return failure("not-found", `Layer ${nodeId} does not exist`);
    }
    node.parentId = options.parentId;
    if (sourceParentId !== options.parentId) {
      node.transform = multiplyTransforms(worldToTarget, world);
    }
  }

  if (sourceParentId !== options.parentId) {
    const affectedGroups = new Set([
      ...groupAncestorIds(document, sourceParentId),
      ...groupAncestorIds(projected, options.parentId),
    ]);
    const deepestFirst = [...affectedGroups].sort(
      (left, right) => nodeDepth(projected, right) - nodeDepth(projected, left),
    );
    for (const groupId of deepestFirst) {
      const normalized = normalizeGroupInPlace(projected, groupId);
      if (!normalized.ok) return normalized;
    }
  }

  const updates: DesignOperation[] = [];
  for (const nodeId of Object.keys(projected.nodesById)) {
    const before = document.nodesById[nodeId];
    const after = projected.nodesById[nodeId];
    if (!before || !after) continue;
    const transformChanged = !arraysEqual(before.transform, after.transform);
    const sizeChanged =
      before.size.width !== after.size.width ||
      before.size.height !== after.size.height;
    if (!transformChanged && !sizeChanged) continue;
    updates.push({
      commandId: `${options.commandPrefix}_update_${updates.length}`,
      type: "update_properties",
      nodeId,
      ...(transformChanged ? { transform: after.transform } : {}),
      ...(sizeChanged ? { size: after.size } : {}),
    });
  }
  const moves =
    sourceParentId === options.parentId
      ? planBlockMoves(
          sourceSiblings,
          targetOrder,
          ordered,
          pageId,
          options.parentId,
          options.commandPrefix,
        )
      : ordered.map((nodeId, index): DesignOperation => ({
          commandId: `${options.commandPrefix}_move_${index}`,
          type: "move_element",
          nodeId,
          pageId,
          parentId: options.parentId,
          index: options.index + index,
        }));
  if (!moves) {
    return failure(
      "invalid-target",
      "The requested sibling insertion order could not be planned",
    );
  }
  const commands = [...updates, ...moves];
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Moving these layers requires ${commands.length} commands, exceeding the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  const warnings = inheritedVisualContextChanged(
    document,
    sourceParentId,
    options.parentId,
  )
    ? [
        "Reparenting changes inherited clipping or container appearance; inspect the rendered canvas after applying",
      ]
    : [];
  return {
    ok: true,
    commands,
    selectionNodeIds: ordered,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

type GroupSelectionAnalysis =
  | {
      ok: true;
      bounds: { x: number; y: number; width: number; height: number };
      ordered: string[];
      parentId: string | null;
      siblings: readonly string[];
    }
  | LayerOperationFailure;

type ReorderSelectionAnalysis =
  | {
      ok: true;
      ordered: string[];
      parentId: string | null;
      siblings: readonly string[];
    }
  | LayerOperationFailure;

function analyzeReorderSelection(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): ReorderSelectionAnalysis {
  if (!document.pagesById[pageId]) {
    return failure("not-found", `Page ${pageId} does not exist`);
  }
  const uniqueNodeIds = [...new Set(nodeIds)];
  if (uniqueNodeIds.some((nodeId) => !document.nodesById[nodeId])) {
    return failure("not-found", "One or more selected layers do not exist");
  }
  const selected = topLevelSelection(document, uniqueNodeIds);
  if (selected.length === 0) {
    return failure(
      "invalid-selection",
      "Reordering requires at least one layer",
    );
  }
  if (selected.some((nodeId) => !nodeBelongsToPage(document, pageId, nodeId))) {
    return failure(
      "invalid-selection",
      "Selected layers do not belong to the target page hierarchy",
    );
  }
  const nodes = selected.map((nodeId) => document.nodesById[nodeId]!);
  const parentId = nodes[0]?.parentId ?? null;
  if (nodes.some((node) => node.parentId !== parentId)) {
    return failure(
      "mixed-parent",
      "Selected layers must share the same parent before reordering",
    );
  }
  if (nodes.some((node) => isEffectivelyLocked(document, node.id))) {
    return failure("locked", "Locked layers cannot be reordered");
  }
  const siblings = childIds(document, pageId, parentId);
  if (!siblings || selected.some((nodeId) => !siblings.includes(nodeId))) {
    return failure(
      "invalid-selection",
      "Selected layers do not belong to the target page hierarchy",
    );
  }
  return {
    ok: true,
    ordered: [...selected].sort(
      (left, right) => siblings.indexOf(left) - siblings.indexOf(right),
    ),
    parentId,
    siblings,
  };
}

function analyzeGroupSelection(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): GroupSelectionAnalysis {
  if (!document.pagesById[pageId]) {
    return failure("not-found", `Page ${pageId} does not exist`);
  }
  const uniqueNodeIds = [...new Set(nodeIds)];
  if (uniqueNodeIds.some((nodeId) => !document.nodesById[nodeId])) {
    return failure("not-found", "One or more selected layers do not exist");
  }
  const selected = topLevelSelection(document, uniqueNodeIds);
  if (selected.length < 2) {
    return failure(
      "invalid-selection",
      "Grouping requires at least two layers",
    );
  }
  if (selected.some((nodeId) => !nodeBelongsToPage(document, pageId, nodeId))) {
    return failure(
      "invalid-selection",
      "Selected layers do not belong to the target page hierarchy",
    );
  }
  const nodes = selected.map((nodeId) => document.nodesById[nodeId]!);
  const parentId = nodes[0]?.parentId ?? null;
  if (nodes.some((node) => node.parentId !== parentId)) {
    return failure(
      "mixed-parent",
      "Selected layers must share the same parent before grouping",
    );
  }
  if (nodes.some((node) => isEffectivelyLocked(document, node.id))) {
    return failure("locked", "Locked layers cannot be grouped");
  }
  const siblings = childIds(document, pageId, parentId);
  if (!siblings || selected.some((nodeId) => !siblings.includes(nodeId))) {
    return failure(
      "invalid-selection",
      "Selected layers do not belong to the target page hierarchy",
    );
  }
  const ordered = [...selected].sort(
    (left, right) => siblings.indexOf(left) - siblings.indexOf(right),
  );
  const bounds = localSelectionBounds(
    ordered.map((nodeId) => document.nodesById[nodeId]!),
  );
  if (!bounds) {
    return failure("invalid-selection", "Selected layers have invalid bounds");
  }
  return { ok: true, bounds, ordered, parentId, siblings };
}

type UngroupSelectionAnalysis =
  | { ok: true; group: DesignNode & { kind: "group" }; groupIndex: number }
  | LayerOperationFailure;

function analyzeUngroupSelection(
  document: DesignDocument,
  pageId: string,
  groupId: string,
): UngroupSelectionAnalysis {
  if (!document.pagesById[pageId]) {
    return failure("not-found", `Page ${pageId} does not exist`);
  }
  const group = document.nodesById[groupId];
  if (!group) return failure("not-found", `Group ${groupId} does not exist`);
  if (group.kind !== "group" || group.childIds.length === 0) {
    return failure(
      "invalid-selection",
      "Ungrouping requires one non-empty Group",
    );
  }
  if (!nodeBelongsToPage(document, pageId, group.id)) {
    return failure(
      "invalid-selection",
      "The Group does not belong to the target page hierarchy",
    );
  }
  if (
    group.childIds.some(
      (nodeId) => document.nodesById[nodeId]?.parentId !== group.id,
    )
  ) {
    return failure("not-found", "One or more Group children do not exist");
  }
  if (
    isEffectivelyLocked(document, group.id) ||
    group.childIds.some((nodeId) => isEffectivelyLocked(document, nodeId))
  ) {
    return failure("locked", "Locked groups or children cannot be ungrouped");
  }
  if (!hasNeutralGroupAppearance(group)) {
    return failure(
      "visual-fidelity",
      "This Group has visibility, opacity, blend, effect, or mask properties that cannot yet be preserved when ungrouping",
    );
  }
  const siblings = childIds(document, pageId, group.parentId);
  const groupIndex = siblings?.indexOf(group.id) ?? -1;
  if (!siblings || groupIndex < 0) {
    return failure(
      "invalid-selection",
      "The Group does not belong to the target page hierarchy",
    );
  }
  return { ok: true, group, groupIndex };
}

function topLevelSelection(
  document: DesignDocument,
  nodeIds: readonly string[],
): string[] {
  const selected = new Set(nodeIds);
  return [...selected].filter((nodeId) => {
    const node = document.nodesById[nodeId];
    if (!node) return false;
    const visited = new Set<string>();
    let parentId = node.parentId;
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = document.nodesById[parentId]?.parentId ?? null;
    }
    return true;
  });
}

function childIds(
  document: DesignDocument,
  pageId: string,
  parentId: string | null,
): readonly string[] | undefined {
  if (parentId) return document.nodesById[parentId]?.childIds;
  return document.pagesById[pageId]?.rootNodeIds;
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const page = document.pagesById[pageId];
  const visited = new Set<string>();
  let node = document.nodesById[nodeId];
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    if (node.parentId === null)
      return page?.rootNodeIds.includes(node.id) ?? false;
    node = document.nodesById[node.parentId];
  }
  return false;
}

function nodeContains(
  document: DesignDocument,
  rootNodeId: string,
  candidateNodeId: string,
): boolean {
  const pending = [...(document.nodesById[rootNodeId]?.childIds ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    if (nodeId === candidateNodeId) return true;
    visited.add(nodeId);
    pending.push(...(document.nodesById[nodeId]?.childIds ?? []));
  }
  return false;
}

function mutableChildIds(
  document: DesignDocument,
  pageId: string,
  parentId: string | null,
): string[] | undefined {
  if (parentId) return document.nodesById[parentId]?.childIds;
  return document.pagesById[pageId]?.rootNodeIds;
}

function groupAncestorIds(
  document: DesignDocument,
  startNodeId: string | null,
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  let node = startNodeId ? document.nodesById[startNodeId] : undefined;
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    if (node.kind === "group") result.push(node.id);
    node = node.parentId ? document.nodesById[node.parentId] : undefined;
  }
  return result;
}

function nodeDepth(document: DesignDocument, nodeId: string): number {
  let depth = 0;
  const visited = new Set<string>();
  let node = document.nodesById[nodeId];
  while (node?.parentId && !visited.has(node.id)) {
    visited.add(node.id);
    depth += 1;
    node = document.nodesById[node.parentId];
  }
  return depth;
}

function normalizeGroupInPlace(
  document: DesignDocument,
  groupId: string,
): { ok: true } | LayerOperationFailure {
  const group = document.nodesById[groupId];
  if (!group || group.kind !== "group") {
    return failure("not-found", `Group ${groupId} does not exist`);
  }
  const children = group.childIds.map((nodeId) => document.nodesById[nodeId]);
  if (children.length === 0) {
    return failure("invalid-target", `Group ${groupId} cannot be left empty`);
  }
  if (children.some((node) => !node)) {
    return failure("not-found", `Group ${groupId} has a missing child`);
  }
  const bounds = localSelectionBounds(
    children.filter((node): node is DesignNode => node !== undefined),
  );
  if (!bounds) {
    return failure(
      "visual-fidelity",
      `Group ${groupId} children have invalid bounds`,
    );
  }
  const offset: Transform = [1, 0, 0, 1, bounds.x, bounds.y];
  const compensate: Transform = [1, 0, 0, 1, -bounds.x, -bounds.y];
  group.transform = multiplyTransforms(group.transform, offset);
  group.size = { width: bounds.width, height: bounds.height };
  for (const child of children) {
    if (child)
      child.transform = multiplyTransforms(compensate, child.transform);
  }
  return { ok: true };
}

function planBlockMoves(
  sourceOrder: readonly string[],
  targetOrder: readonly string[],
  orderedNodeIds: readonly string[],
  pageId: string,
  parentId: string | null,
  commandPrefix: string,
): DesignOperation[] | null {
  for (const executionOrder of [
    [...orderedNodeIds],
    [...orderedNodeIds].reverse(),
  ]) {
    const working = [...sourceOrder];
    const moves: DesignOperation[] = [];
    for (const nodeId of executionOrder) {
      const currentIndex = working.indexOf(nodeId);
      const targetIndex = targetOrder.indexOf(nodeId);
      if (currentIndex < 0 || targetIndex < 0) return null;
      if (currentIndex === targetIndex) continue;
      working.splice(currentIndex, 1);
      working.splice(targetIndex, 0, nodeId);
      moves.push({
        commandId: `${commandPrefix}_move_${moves.length}`,
        type: "move_element",
        nodeId,
        pageId,
        parentId,
        index: targetIndex,
      });
    }
    if (arraysEqual(working, targetOrder)) return moves;
  }
  return null;
}

function inheritedVisualContextChanged(
  document: DesignDocument,
  sourceParentId: string | null,
  targetParentId: string | null,
): boolean {
  return (
    JSON.stringify(inheritedVisualContext(document, sourceParentId)) !==
    JSON.stringify(inheritedVisualContext(document, targetParentId))
  );
}

function inheritedVisualContext(
  document: DesignDocument,
  parentId: string | null,
): object[] {
  const result: object[] = [];
  const visited = new Set<string>();
  let node = parentId ? document.nodesById[parentId] : undefined;
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    const nonNeutral =
      !node.visible ||
      node.opacity !== 1 ||
      (node.blendMode !== undefined && node.blendMode !== "pass-through") ||
      (node.effects?.length ?? 0) > 0 ||
      (node.maskMode !== undefined && node.maskMode !== "none") ||
      (node.kind === "frame" && node.properties.clipsContent);
    if (nonNeutral) {
      result.push({
        nodeId: node.id,
        visible: node.visible,
        opacity: node.opacity,
        blendMode: node.blendMode ?? "pass-through",
        effects: node.effects ?? [],
        maskMode: node.maskMode ?? "none",
        clipsContent:
          node.kind === "frame" ? node.properties.clipsContent : false,
      });
    }
    node = node.parentId ? document.nodesById[node.parentId] : undefined;
  }
  return result;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function localSelectionBounds(nodes: readonly DesignNode[]) {
  const points = nodes.flatMap((node) => [
    transformPoint({ x: 0, y: 0 }, node.transform),
    transformPoint({ x: node.size.width, y: 0 }, node.transform),
    transformPoint({ x: 0, y: node.size.height }, node.transform),
    transformPoint({ x: node.size.width, y: node.size.height }, node.transform),
  ]);
  if (
    points.length === 0 ||
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    return null;
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function isEffectivelyLocked(document: DesignDocument, nodeId: string) {
  const visited = new Set<string>();
  let node: DesignNode | undefined = document.nodesById[nodeId];
  while (node && !visited.has(node.id)) {
    if (node.locked) return true;
    visited.add(node.id);
    node = node.parentId ? document.nodesById[node.parentId] : undefined;
  }
  return false;
}

function hasNeutralGroupAppearance(group: DesignNode): boolean {
  return (
    group.kind === "group" &&
    group.visible &&
    group.opacity === 1 &&
    (group.blendMode === undefined || group.blendMode === "pass-through") &&
    (group.effects === undefined || group.effects.length === 0) &&
    (group.maskMode === undefined || group.maskMode === "none")
  );
}

function failure(
  code: LayerOperationFailureCode,
  message: string,
): LayerOperationFailure {
  return { ok: false, code, message };
}

function layerOrderDirection(action: LayerOrderAction): string {
  if (action === "bring-forward") return "further forward";
  if (action === "bring-to-front") return "to the front";
  if (action === "send-backward") return "further backward";
  return "to the back";
}
