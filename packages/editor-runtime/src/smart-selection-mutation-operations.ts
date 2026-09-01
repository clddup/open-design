import {
  MAX_TRANSACTION_COMMANDS,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
} from "@opendesign/design-contracts";
import {
  analyzeSmartSelection,
  reflowSmartSelectionMutation,
  type ArrangementItem,
  type SmartSelectionReflowMutation,
  type TidyUpPlacement,
} from "@opendesign/geometry-service";
import { planDeleteNodes } from "./deletion-operations.js";
import {
  getNodeBounds,
  getWorldTransform,
  invertTransform,
} from "./geometry.js";
import { normalizeGroupAncestorsInPlace } from "./group-bounds.js";
import { isEffectivelyLocked } from "./layer-operations.js";
import {
  attachSmartSelectionClones,
  cloneSmartSelectionSubtrees,
  smartSelectionCloneInsertCommands,
  type SmartSelectionClones,
} from "./smart-selection-clone-operations.js";

export type SmartSelectionMutationFailureCode =
  | "invalid-selection"
  | "invalid-operation"
  | "operation-limit"
  | "visual-fidelity";

export type SmartSelectionMutationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      markedNodeIds: string[];
      selectionNodeIds: string[];
    }
  | {
      ok: false;
      code: SmartSelectionMutationFailureCode;
      message: string;
    };

type MutationSelection = {
  items: ArrangementItem[];
  markedNodeIds: string[];
  nodeIds: string[];
  nodes: DesignNode[];
};

type UpdateOperation = Extract<DesignOperation, { type: "update_properties" }>;

export function planSmartSelectionDelete(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  markedNodeIds: readonly string[],
  commandPrefix: string,
): SmartSelectionMutationPlan {
  const selection = analyzeMutationSelection(
    document,
    pageId,
    nodeIds,
    markedNodeIds,
  );
  if (!selection.ok) return selection;
  const deletion = planDeleteNodes(document, {
    nodeIds: selection.markedNodeIds,
    commandPrefix: `${commandPrefix}_delete`,
  });
  if (!deletion.ok) return failure("invalid-operation", deletion.message);
  const reflow = reflowSmartSelectionMutation(selection.items, {
    kind: "delete",
    removedNodeIds: selection.markedNodeIds,
  });
  if (!reflow.ok) return failure("invalid-operation", reflow.message);
  const projected = structuredClone(document);
  if (!applyPlacements(projected, reflow.placements)) {
    return failure(
      "visual-fidelity",
      "Smart selection parent transform is not invertible",
    );
  }
  removeSubtrees(projected, deletion.rootNodeIds);
  const normalized = normalizeGroupAncestorsInPlace(
    projected,
    selection.nodes.map((node) => node.parentId),
  );
  if (!normalized.ok) return failure("invalid-operation", normalized.message);
  const geometry = geometryDiff(document, projected, `${commandPrefix}_reflow`);
  const cleanup = deletion.commands.filter(
    (command) => command.type !== "delete_element",
  );
  const deletes = deletion.commands.filter(
    (command) => command.type === "delete_element",
  );
  return finalizePlan(
    [...cleanup, ...geometry, ...deletes],
    selection.nodeIds.filter((id) => !selection.markedNodeIds.includes(id)),
    [],
  );
}

export function planSmartSelectionDuplicate(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  markedNodeIds: readonly string[],
  commandPrefix: string,
): SmartSelectionMutationPlan {
  const selection = analyzeMutationSelection(
    document,
    pageId,
    nodeIds,
    markedNodeIds,
  );
  if (!selection.ok) return selection;
  const cloned = cloneSmartSelectionSubtrees(
    document,
    selection.markedNodeIds,
    commandPrefix,
  );
  const mutation: SmartSelectionReflowMutation = {
    duplicates: cloned.rootIds.map((id, index) => ({
      id,
      sourceId: selection.markedNodeIds[index]!,
    })),
    kind: "duplicate",
  };
  const reflow = reflowSmartSelectionMutation(selection.items, mutation);
  if (!reflow.ok) return failure("invalid-operation", reflow.message);
  return finishDuplicatePlan(
    document,
    pageId,
    selection,
    cloned,
    reflow.placements,
    commandPrefix,
  );
}

function finishDuplicatePlan(
  document: DesignDocument,
  pageId: string,
  selection: MutationSelection,
  clones: SmartSelectionClones,
  placements: readonly TidyUpPlacement[],
  commandPrefix: string,
): SmartSelectionMutationPlan {
  const projected = structuredClone(document);
  attachSmartSelectionClones(projected, pageId, clones);
  if (!applyPlacements(projected, placements)) {
    return failure(
      "visual-fidelity",
      "Smart selection parent transform is not invertible",
    );
  }
  const normalized = normalizeGroupAncestorsInPlace(
    projected,
    selection.nodes.map((node) => node.parentId),
  );
  if (!normalized.ok) return failure("invalid-operation", normalized.message);
  const inserts = smartSelectionCloneInsertCommands(
    projected,
    pageId,
    clones,
    `${commandPrefix}_insert`,
  );
  const geometry = geometryDiff(document, projected, `${commandPrefix}_reflow`);
  return finalizePlan(
    [...inserts, ...geometry],
    [...selection.nodeIds, ...clones.rootIds],
    clones.rootIds,
  );
}

export function planSmartSelectionResize(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  markedNodeIds: readonly string[],
  operations: readonly DesignOperation[],
  commandPrefix: string,
): SmartSelectionMutationPlan {
  const selection = analyzeMutationSelection(
    document,
    pageId,
    nodeIds,
    markedNodeIds,
  );
  if (!selection.ok) return selection;
  const updates = operations.filter(
    (operation): operation is UpdateOperation =>
      operation.type === "update_properties",
  );
  if (
    updates.length !== operations.length ||
    !updatesMatchMarkedSubtrees(document, updates, selection.markedNodeIds)
  ) {
    return failure(
      "invalid-operation",
      "Smart selection resize contains unrelated operations",
    );
  }
  return finishResizePlan(document, selection, updates, commandPrefix);
}

function finishResizePlan(
  document: DesignDocument,
  selection: MutationSelection,
  updates: readonly UpdateOperation[],
  commandPrefix: string,
): SmartSelectionMutationPlan {
  const projected = structuredClone(document);
  updates.forEach((operation) => applyUpdate(projected, operation));
  const resizedGroups = normalizeGroupAncestorsInPlace(
    projected,
    selection.markedNodeIds,
  );
  if (!resizedGroups.ok) {
    return failure("invalid-operation", resizedGroups.message);
  }
  const updatedItems = selection.markedNodeIds.flatMap((id) => {
    const bounds = getNodeBounds(projected, id);
    return bounds ? [{ id, bounds }] : [];
  });
  const reflow = reflowSmartSelectionMutation(selection.items, {
    kind: "resize",
    markedNodeIds: selection.markedNodeIds,
    updatedItems,
  });
  if (!reflow.ok) return failure("invalid-operation", reflow.message);
  if (!applyPlacements(projected, reflow.placements)) {
    return failure(
      "visual-fidelity",
      "Smart selection parent transform is not invertible",
    );
  }
  const normalized = normalizeGroupAncestorsInPlace(
    projected,
    selection.nodes.map((node) => node.parentId),
  );
  if (!normalized.ok) return failure("invalid-operation", normalized.message);
  const commands = geometryDiff(document, projected, commandPrefix, updates);
  return finalizePlan(commands, selection.nodeIds, selection.markedNodeIds);
}

function analyzeMutationSelection(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  markedNodeIds: readonly string[],
):
  | ({ ok: true } & MutationSelection)
  | Extract<SmartSelectionMutationPlan, { ok: false }> {
  const unique = [...new Set(nodeIds)];
  const marked = [...new Set(markedNodeIds)];
  if (
    !document.pagesById[pageId] ||
    unique.length < 2 ||
    unique.length !== nodeIds.length ||
    marked.length === 0 ||
    marked.length !== markedNodeIds.length ||
    marked.some((id) => !unique.includes(id)) ||
    topLevelNodeIds(document, unique).length !== unique.length
  ) {
    return failure("invalid-selection", "Smart selection scope is invalid");
  }
  const nodes = unique.flatMap((id) => {
    const node = document.nodesById[id];
    return node ? [node] : [];
  });
  if (
    nodes.length !== unique.length ||
    unique.some((id) => !nodeBelongsToPage(document, pageId, id)) ||
    unique.some((id) => isEffectivelyLocked(document, id))
  ) {
    return failure(
      "invalid-selection",
      "Smart selection layers are unavailable",
    );
  }
  const items = unique.flatMap((id) => {
    const bounds = getNodeBounds(document, id);
    return bounds ? [{ id, bounds }] : [];
  });
  if (items.length !== unique.length || !analyzeSmartSelection(items).ok) {
    return failure(
      "invalid-selection",
      "Layers no longer form a Smart selection",
    );
  }
  return { ok: true, items, markedNodeIds: marked, nodeIds: unique, nodes };
}

function applyPlacements(
  document: DesignDocument,
  placements: readonly { id: string; delta: { x: number; y: number } }[],
): boolean {
  for (const placement of placements) {
    const node = document.nodesById[placement.id];
    if (!node || (placement.delta.x === 0 && placement.delta.y === 0)) continue;
    const local = documentDeltaToParent(
      document,
      node.parentId,
      placement.delta,
    );
    if (!local) return false;
    node.transform = [...node.transform];
    node.transform[4] += local.x;
    node.transform[5] += local.y;
  }
  return true;
}

function documentDeltaToParent(
  document: DesignDocument,
  parentId: string | null,
  delta: { x: number; y: number },
) {
  if (!parentId) return delta;
  const world = getWorldTransform(document, parentId);
  const inverse = world ? invertTransform(world) : null;
  return inverse
    ? {
        x: inverse[0] * delta.x + inverse[2] * delta.y,
        y: inverse[1] * delta.x + inverse[3] * delta.y,
      }
    : null;
}

function removeSubtrees(
  document: DesignDocument,
  rootIds: readonly string[],
): void {
  const removed = new Set<string>();
  const visit = (id: string) => {
    if (removed.has(id)) return;
    removed.add(id);
    document.nodesById[id]?.childIds.forEach(visit);
  };
  rootIds.forEach(visit);
  for (const rootId of rootIds) {
    const node = document.nodesById[rootId];
    if (node?.parentId) {
      const parent = document.nodesById[node.parentId];
      if (parent)
        parent.childIds = parent.childIds.filter((id) => id !== rootId);
    } else {
      Object.values(document.pagesById).forEach((page) => {
        page.rootNodeIds = page.rootNodeIds.filter((id) => id !== rootId);
      });
    }
  }
  removed.forEach((id) => delete document.nodesById[id]);
}

function geometryDiff(
  before: DesignDocument,
  after: DesignDocument,
  prefix: string,
  sourceUpdates: readonly UpdateOperation[] = [],
): DesignOperation[] {
  const sourceById = new Map(
    sourceUpdates.map((operation) => [operation.nodeId, operation]),
  );
  const commands: DesignOperation[] = [];
  for (const [nodeId, next] of Object.entries(after.nodesById)) {
    const previous = before.nodesById[nodeId];
    if (!previous) continue;
    const source = sourceById.get(nodeId);
    const transformChanged = !sameNumbers(previous.transform, next.transform);
    const sizeChanged =
      previous.size.width !== next.size.width ||
      previous.size.height !== next.size.height;
    if (!source && !transformChanged && !sizeChanged) continue;
    commands.push({
      ...(source
        ? structuredClone(source)
        : { type: "update_properties", nodeId }),
      commandId: `${prefix}_${commands.length}`,
      ...(transformChanged ? { transform: next.transform } : {}),
      ...(sizeChanged ? { size: next.size } : {}),
    });
  }
  return commands;
}

function applyUpdate(
  document: DesignDocument,
  operation: UpdateOperation,
): void {
  const node = document.nodesById[operation.nodeId];
  if (!node) return;
  if (operation.transform) node.transform = [...operation.transform];
  if (
    operation.size &&
    node.kind !== "group" &&
    node.kind !== "boolean" &&
    node.kind !== "instance"
  ) {
    node.size = { ...operation.size };
  }
  if (operation.properties && node.kind === "line") {
    node.properties = { ...node.properties, ...operation.properties };
  }
}

function updatesMatchMarkedSubtrees(
  document: DesignDocument,
  updates: readonly UpdateOperation[],
  markedIds: readonly string[],
): boolean {
  const rootsByNode = new Map<string, string>();
  const visit = (rootId: string, nodeId: string) => {
    if (rootsByNode.has(nodeId)) return;
    rootsByNode.set(nodeId, rootId);
    document.nodesById[nodeId]?.childIds.forEach((id) => visit(rootId, id));
  };
  markedIds.forEach((id) => visit(id, id));
  const affectedRoots = new Set(
    updates.flatMap((operation) => {
      const rootId = rootsByNode.get(operation.nodeId);
      return rootId ? [rootId] : [];
    }),
  );
  return (
    updates.length > 0 &&
    updates.every((operation) => rootsByNode.has(operation.nodeId)) &&
    markedIds.every((id) => affectedRoots.has(id))
  );
}

function topLevelNodeIds(
  document: DesignDocument,
  nodeIds: readonly string[],
): string[] {
  const selected = new Set(nodeIds);
  return nodeIds.filter((id) => {
    let parentId = document.nodesById[id]?.parentId;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = document.nodesById[parentId]?.parentId ?? null;
    }
    return true;
  });
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const roots = document.pagesById[pageId]?.rootNodeIds ?? [];
  let node = document.nodesById[nodeId];
  const visited = new Set<string>();
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    if (!node.parentId) return roots.includes(node.id);
    node = document.nodesById[node.parentId];
  }
  return false;
}

function sameNumbers(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function finalizePlan(
  commands: DesignOperation[],
  selectionNodeIds: string[],
  markedNodeIds: string[],
): SmartSelectionMutationPlan {
  return commands.length <= MAX_TRANSACTION_COMMANDS
    ? { ok: true, commands, markedNodeIds, selectionNodeIds }
    : failure(
        "operation-limit",
        `Smart selection mutation requires ${commands.length} commands, exceeding the transaction limit`,
      );
}

function failure(
  code: SmartSelectionMutationFailureCode,
  message: string,
): Extract<SmartSelectionMutationPlan, { ok: false }> {
  return { ok: false, code, message };
}
