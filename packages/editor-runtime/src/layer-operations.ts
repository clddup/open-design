import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  Transform,
} from "@opendesign/design-contracts";
import { MAX_TRANSACTION_COMMANDS } from "@opendesign/design-contracts";
import { multiplyTransforms, transformPoint } from "./geometry.js";

export type LayerOperationFailureCode =
  | "invalid-selection"
  | "locked"
  | "mixed-parent"
  | "not-found"
  | "operation-limit"
  | "visual-fidelity";

export type LayerOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      selectionNodeIds: string[];
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

type GroupSelectionAnalysis =
  | {
      ok: true;
      bounds: { x: number; y: number; width: number; height: number };
      ordered: string[];
      parentId: string | null;
      siblings: readonly string[];
    }
  | LayerOperationFailure;

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
