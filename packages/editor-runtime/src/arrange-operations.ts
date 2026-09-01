import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  Rect,
} from "@opendesign/design-contracts";
import { MAX_TRANSACTION_COMMANDS } from "@opendesign/design-contracts";
import {
  alignItems,
  distributeItems,
  measureItemSpacing,
  rearrangeSmartSelectionGrid,
  reorderSmartSelection,
  setItemSpacing,
  setSmartSelectionSpacing,
  tidyUpItems,
  type AlignAction,
  type ArrangementItem,
  type ArrangementPlan,
  type TidyUpDimension,
  type TidyUpPlan,
} from "@opendesign/geometry-service";
import {
  getLocalSelectionBounds,
  getNodeBounds,
  getWorldTransform,
  invertTransform,
} from "./geometry.js";
import { normalizeGroupAncestorsInPlace } from "./group-bounds.js";

export type ArrangeAction =
  | AlignAction
  | "distribute-horizontal"
  | "distribute-vertical"
  | "set-horizontal-spacing"
  | "set-vertical-spacing"
  | "tidy-up";

export type ArrangeOperation =
  | {
      action: Exclude<
        ArrangeAction,
        "set-horizontal-spacing" | "set-vertical-spacing"
      >;
    }
  | {
      action: "set-horizontal-spacing" | "set-vertical-spacing";
      spacing: number;
    };

export type ArrangeOperationFailureCode =
  | "invalid-target"
  | "invalid-selection"
  | "locked"
  | "no-op"
  | "not-found"
  | "operation-limit"
  | "visual-fidelity";

export type ArrangeOperationPlan =
  | {
      ok: true;
      action: ArrangeAction | "smart-grid-rearrange" | "smart-reorder";
      commands: DesignOperation[];
      orderedNodeIds: string[];
      selectionNodeIds: string[];
      resolvedSpacing?: number;
      resolvedHorizontalSpacing?: number;
      resolvedVerticalSpacing?: number;
      tidyUpDimension?: TidyUpDimension;
    }
  | {
      ok: false;
      code: ArrangeOperationFailureCode;
      message: string;
    };

export type ArrangementSelectionMetrics = {
  nodeIds: string[];
  horizontalSpacing: number | null;
  verticalSpacing: number | null;
  canDistributeHorizontal: boolean;
  canDistributeVertical: boolean;
  canTidyUp: boolean;
  tidyUpDimension: TidyUpDimension | null;
};

type ArrangeSelection = {
  coordinateSpace: "document" | "parent-local";
  nodeIds: string[];
  items: ArrangementItem[];
  nodes: DesignNode[];
  targetBounds?: Rect;
};

export function planArrangeNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  operation: ArrangeOperation,
  commandPrefix: string,
): ArrangeOperationPlan {
  const uniqueNodeIds = [...new Set(nodeIds)];
  const selection =
    uniqueNodeIds.length === 1 && isAlignOperation(operation)
      ? analyzeParentAlignment(document, pageId, uniqueNodeIds[0]!)
      : analyzeArrangeSelection(document, pageId, nodeIds);
  if (!selection.ok) return selection;
  const geometryPlan = planGeometry(
    selection.items,
    operation,
    selection.targetBounds,
  );
  if (!geometryPlan.ok) {
    return failure(
      geometryPlan.code === "no-op" ? "no-op" : "invalid-selection",
      geometryPlan.message,
    );
  }
  return arrangementCommands(
    document,
    selection,
    geometryPlan,
    operation.action,
    commandPrefix,
  );
}

export function planSmartSelectionSpacing(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  axis: "horizontal" | "vertical",
  spacing: number,
  commandPrefix: string,
): ArrangeOperationPlan {
  const selection = analyzeArrangeSelection(document, pageId, nodeIds);
  if (!selection.ok) return selection;
  const geometryPlan = setSmartSelectionSpacing(selection.items, axis, spacing);
  if (!geometryPlan.ok) {
    return failure(
      geometryPlan.code === "no-op" ? "no-op" : "invalid-selection",
      geometryPlan.message,
    );
  }
  return arrangementCommands(
    document,
    selection,
    geometryPlan,
    axis === "horizontal" ? "set-horizontal-spacing" : "set-vertical-spacing",
    commandPrefix,
  );
}

export function planSmartSelectionReorder(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  movedNodeIds: readonly string[],
  insertionIndex: number,
  commandPrefix: string,
): ArrangeOperationPlan {
  const selection = analyzeArrangeSelection(document, pageId, nodeIds);
  if (!selection.ok) return selection;
  const geometryPlan = reorderSmartSelection(
    selection.items,
    movedNodeIds,
    insertionIndex,
  );
  if (!geometryPlan.ok) {
    return failure(
      geometryPlan.code === "no-op" ? "no-op" : "invalid-selection",
      geometryPlan.message,
    );
  }
  return arrangementCommands(
    document,
    selection,
    geometryPlan,
    "smart-reorder",
    commandPrefix,
  );
}

export function planSmartSelectionGridRearrange(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  movedNodeId: string,
  targetNodeId: string,
  mode: "insert" | "swap",
  commandPrefix: string,
): ArrangeOperationPlan {
  const selection = analyzeArrangeSelection(document, pageId, nodeIds);
  if (!selection.ok) return selection;
  const geometryPlan = rearrangeSmartSelectionGrid(
    selection.items,
    movedNodeId,
    targetNodeId,
    mode,
  );
  if (!geometryPlan.ok) {
    return failure(
      geometryPlan.code === "no-op" ? "no-op" : "invalid-selection",
      geometryPlan.message,
    );
  }
  return arrangementCommands(
    document,
    selection,
    geometryPlan,
    "smart-grid-rearrange",
    commandPrefix,
  );
}

function arrangementCommands(
  document: DesignDocument,
  selection: ArrangeSelection,
  geometryPlan: Extract<ArrangementPlan | TidyUpPlan, { ok: true }>,
  action: ArrangeAction | "smart-grid-rearrange" | "smart-reorder",
  commandPrefix: string,
): ArrangeOperationPlan {
  const projected = structuredClone(document);
  for (const placement of geometryPlan.placements) {
    if (placement.delta.x === 0 && placement.delta.y === 0) continue;
    const node = projected.nodesById[placement.id];
    if (!node) return failure("not-found", `Layer ${placement.id} is missing`);
    const localDelta =
      selection.coordinateSpace === "parent-local"
        ? placement.delta
        : documentDeltaToParent(document, node.parentId, placement.delta);
    if (!localDelta) {
      return failure(
        "visual-fidelity",
        `Layer ${placement.id} has a non-invertible parent transform`,
      );
    }
    node.transform = [...node.transform];
    node.transform[4] += localDelta.x;
    node.transform[5] += localDelta.y;
  }
  const normalized = normalizeGroupAncestorsInPlace(
    projected,
    selection.nodes.map((node) => node.parentId),
  );
  if (!normalized.ok) return failure(normalized.code, normalized.message);

  const commands: DesignOperation[] = [];
  for (const nodeId of Object.keys(projected.nodesById)) {
    const before = document.nodesById[nodeId];
    const after = projected.nodesById[nodeId];
    if (!before || !after) continue;
    const transformChanged = !arraysEqual(before.transform, after.transform);
    const sizeChanged =
      before.size.width !== after.size.width ||
      before.size.height !== after.size.height;
    if (!transformChanged && !sizeChanged) continue;
    commands.push({
      commandId: `${commandPrefix}_update_${commands.length}`,
      type: "update_properties",
      nodeId,
      ...(transformChanged ? { transform: after.transform } : {}),
      ...(sizeChanged ? { size: after.size } : {}),
    });
  }
  if (commands.length === 0) {
    return failure("no-op", "Layers already match the requested arrangement");
  }
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Arranging these layers requires ${commands.length} commands, exceeding the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return {
    ok: true,
    action,
    commands,
    orderedNodeIds: geometryPlan.orderedIds,
    selectionNodeIds: selection.nodeIds,
    ...("dimension" in geometryPlan ||
    geometryPlan.resolvedSpacing === undefined
      ? {}
      : { resolvedSpacing: geometryPlan.resolvedSpacing }),
    ...("dimension" in geometryPlan
      ? {
          tidyUpDimension: geometryPlan.dimension,
          ...(geometryPlan.horizontalSpacing === undefined
            ? {}
            : { resolvedHorizontalSpacing: geometryPlan.horizontalSpacing }),
          ...(geometryPlan.verticalSpacing === undefined
            ? {}
            : { resolvedVerticalSpacing: geometryPlan.verticalSpacing }),
        }
      : {}),
  };
}

export function getArrangementSelectionMetrics(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): ArrangementSelectionMetrics | null {
  const selection = analyzeArrangeSelection(document, pageId, nodeIds);
  if (!selection.ok || selection.nodeIds.length < 2) return null;
  const horizontal = measureItemSpacing(selection.items, "horizontal");
  const vertical = measureItemSpacing(selection.items, "vertical");
  const distributeHorizontal = distributeItems(selection.items, "horizontal");
  const distributeVertical = distributeItems(selection.items, "vertical");
  const tidyUp = tidyUpItems(selection.items);
  return {
    nodeIds: selection.nodeIds,
    horizontalSpacing: horizontal.ok ? horizontal.value : null,
    verticalSpacing: vertical.ok ? vertical.value : null,
    canDistributeHorizontal:
      distributeHorizontal.ok || distributeHorizontal.code === "no-op",
    canDistributeVertical:
      distributeVertical.ok || distributeVertical.code === "no-op",
    canTidyUp: tidyUp.ok,
    tidyUpDimension: tidyUp.ok ? tidyUp.dimension : null,
  };
}

export function canAlignNodeToParent(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  return analyzeParentAlignment(document, pageId, nodeId).ok;
}

function planGeometry(
  items: readonly ArrangementItem[],
  operation: ArrangeOperation,
  targetBounds?: Rect,
): ArrangementPlan | TidyUpPlan {
  if ("spacing" in operation) {
    return setItemSpacing(
      items,
      operation.action === "set-horizontal-spacing" ? "horizontal" : "vertical",
      operation.spacing,
    );
  }
  if (operation.action === "distribute-horizontal") {
    return distributeItems(items, "horizontal");
  }
  if (operation.action === "distribute-vertical") {
    return distributeItems(items, "vertical");
  }
  if (operation.action === "tidy-up") {
    return tidyUpItems(items);
  }
  return alignItems(items, operation.action, targetBounds);
}

function isAlignOperation(
  operation: ArrangeOperation,
): operation is { action: AlignAction } {
  return operation.action.startsWith("align-");
}

function analyzeArrangeSelection(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
):
  | ({ ok: true } & ArrangeSelection)
  | Extract<ArrangeOperationPlan, { ok: false }> {
  if (!document.pagesById[pageId]) {
    return failure("not-found", `Page ${pageId} does not exist`);
  }
  const uniqueNodeIds = [...new Set(nodeIds)];
  if (uniqueNodeIds.some((nodeId) => !document.nodesById[nodeId])) {
    return failure("not-found", "One or more arrangement layers do not exist");
  }
  const selected = topLevelSelection(document, uniqueNodeIds);
  if (selected.length < 2) {
    return failure(
      "invalid-selection",
      "Arrangement requires at least two top-level selected layers",
    );
  }
  if (selected.some((nodeId) => !nodeBelongsToPage(document, pageId, nodeId))) {
    return failure(
      "invalid-selection",
      "Selected layers do not belong to the target Page hierarchy",
    );
  }
  if (selected.some((nodeId) => isEffectivelyLocked(document, nodeId))) {
    return failure("locked", "Locked layers cannot be arranged");
  }
  const nodes = selected.map((nodeId) => document.nodesById[nodeId]!);
  const items = nodes.map((node): ArrangementItem | null => {
    const bounds = getNodeBounds(document, node.id);
    return bounds ? { id: node.id, bounds } : null;
  });
  if (items.some((item) => !item)) {
    return failure(
      "visual-fidelity",
      "One or more selected layers have invalid world bounds",
    );
  }
  return {
    ok: true,
    coordinateSpace: "document",
    nodeIds: selected,
    nodes,
    items: items.filter((item): item is ArrangementItem => item !== null),
  };
}

function analyzeParentAlignment(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
):
  | ({ ok: true } & ArrangeSelection)
  | Extract<ArrangeOperationPlan, { ok: false }> {
  if (!document.pagesById[pageId]) {
    return failure("not-found", `Page ${pageId} does not exist`);
  }
  const node = document.nodesById[nodeId];
  if (!node) return failure("not-found", `Layer ${nodeId} does not exist`);
  if (!nodeBelongsToPage(document, pageId, nodeId)) {
    return failure(
      "invalid-selection",
      "The selected layer does not belong to the target Page hierarchy",
    );
  }
  if (isEffectivelyLocked(document, nodeId)) {
    return failure("locked", "Locked layers cannot be aligned");
  }
  if (!node.parentId) {
    return failure(
      "invalid-selection",
      "A Page root layer has no parent container to align against",
    );
  }
  const parent = document.nodesById[node.parentId];
  if (
    !parent ||
    (parent.kind !== "frame" && parent.kind !== "slot") ||
    !parent.childIds.includes(node.id)
  ) {
    return failure(
      "invalid-selection",
      "Single-layer alignment requires a direct Frame or Slot parent",
    );
  }
  const autoLayout = parent.properties.autoLayout;
  if (
    autoLayout !== undefined &&
    autoLayout.mode !== "none" &&
    node.layoutPositioning !== "absolute"
  ) {
    return failure(
      "invalid-selection",
      "Auto Layout flow children are positioned by their parent and cannot be aligned directly",
    );
  }
  const bounds = getLocalSelectionBounds([node]);
  const targetBounds = {
    x: 0,
    y: 0,
    width: parent.size.width,
    height: parent.size.height,
  };
  if (!bounds || !validRect(targetBounds)) {
    return failure(
      "visual-fidelity",
      "The selected layer or its parent has invalid local geometry",
    );
  }
  return {
    ok: true,
    coordinateSpace: "parent-local",
    nodeIds: [node.id],
    nodes: [node],
    items: [{ id: node.id, bounds }],
    targetBounds,
  };
}

function validRect(rect: Rect): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width >= 0 &&
    rect.height >= 0 &&
    Number.isFinite(rect.x + rect.width) &&
    Number.isFinite(rect.y + rect.height)
  );
}

function documentDeltaToParent(
  document: DesignDocument,
  parentId: string | null,
  delta: { x: number; y: number },
): { x: number; y: number } | null {
  if (!parentId) return delta;
  const world = getWorldTransform(document, parentId);
  const inverse = world ? invertTransform(world) : null;
  if (!inverse) return null;
  return {
    x: inverse[0] * delta.x + inverse[2] * delta.y,
    y: inverse[1] * delta.x + inverse[3] * delta.y,
  };
}

function topLevelSelection(
  document: DesignDocument,
  nodeIds: readonly string[],
): string[] {
  const selected = new Set(nodeIds);
  return [...selected].filter((nodeId) => {
    let parentId = document.nodesById[nodeId]?.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
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
  const page = document.pagesById[pageId];
  const visited = new Set<string>();
  let node: DesignNode | undefined = document.nodesById[nodeId];
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    if (node.parentId === null) {
      return page?.rootNodeIds.includes(node.id) ?? false;
    }
    node = document.nodesById[node.parentId];
  }
  return false;
}

function isEffectivelyLocked(
  document: DesignDocument,
  nodeId: string,
): boolean {
  const visited = new Set<string>();
  let node: DesignNode | undefined = document.nodesById[nodeId];
  while (node && !visited.has(node.id)) {
    if (node.locked) return true;
    visited.add(node.id);
    node = node.parentId ? document.nodesById[node.parentId] : undefined;
  }
  return false;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function failure(
  code: ArrangeOperationFailureCode,
  message: string,
): Extract<ArrangeOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
