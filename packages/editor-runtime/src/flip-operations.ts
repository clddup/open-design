import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  Rect,
  Transform,
} from "@opendesign/design-contracts";
import { MAX_TRANSACTION_COMMANDS } from "@opendesign/design-contracts";
import {
  localReflectionTransform,
  reflectionTransform,
  type ReflectionAxis,
} from "@opendesign/geometry-service";
import {
  getNodeBounds,
  getSelectionBounds,
  getWorldTransform,
  invertTransform,
  multiplyTransforms,
} from "./geometry.js";
import { normalizeGroupAncestorsInPlace } from "./group-bounds.js";
import { isEffectivelyLocked, nodeBelongsToPage } from "./layer-operations.js";
import { nodeGeometryUpdate } from "./node-geometry-update.js";

export type FlipAxis = ReflectionAxis;

export type FlipOperationFailureCode =
  | "invalid-selection"
  | "invalid-target"
  | "locked"
  | "not-found"
  | "operation-limit"
  | "visual-fidelity";

export type FlipOperationPlan =
  | {
      ok: true;
      axis: FlipAxis;
      commands: DesignOperation[];
      selectionNodeIds: string[];
    }
  | {
      ok: false;
      code: FlipOperationFailureCode;
      message: string;
    };

export function planFlipNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  axis: FlipAxis,
  commandPrefix: string,
): FlipOperationPlan {
  const selection = analyzeSelection(document, pageId, nodeIds);
  if (!selection.ok) return selection;
  const bounds = getSelectionBounds(document, selection.nodeIds);
  if (!bounds)
    return failure("visual-fidelity", "Selected layers have invalid bounds");

  const projected = structuredClone(document);
  for (const node of selection.nodes) {
    const nodeBounds = getNodeBounds(document, node.id);
    const localAxis =
      selection.nodes.length === 1 || isAutoLayoutFlowChild(document, node);
    if (
      !nodeBounds ||
      !flipNode(projected, document, node, axis, bounds, localAxis)
    ) {
      return failure(
        "visual-fidelity",
        `Layer ${node.id} or its parent has a non-invertible transform`,
      );
    }
  }

  const normalized = normalizeGroupAncestorsInPlace(
    projected,
    selection.nodes.map((node) => node.parentId),
  );
  if (!normalized.ok) return failure(normalized.code, normalized.message);
  const commands = geometryCommands(document, projected, commandPrefix);
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Flipping these layers requires ${commands.length} commands, exceeding the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return { ok: true, axis, commands, selectionNodeIds: selection.nodeIds };
}

export function canFlipNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): boolean {
  const selection = analyzeSelection(document, pageId, nodeIds);
  if (!selection.ok || !getSelectionBounds(document, selection.nodeIds))
    return false;
  return selection.nodes.every((node) => {
    if (
      !getNodeBounds(document, node.id) ||
      !getWorldTransform(document, node.id)
    )
      return false;
    if (!node.parentId) return true;
    const parentWorld = getWorldTransform(document, node.parentId);
    return parentWorld !== null && invertTransform(parentWorld) !== null;
  });
}

function analyzeSelection(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
):
  | { ok: true; nodeIds: string[]; nodes: DesignNode[] }
  | Extract<FlipOperationPlan, { ok: false }> {
  if (!document.pagesById[pageId])
    return failure("not-found", `Page ${pageId} does not exist`);
  const unique = [...new Set(nodeIds)];
  if (unique.length === 0)
    return failure("invalid-selection", "Flip requires at least one layer");
  if (unique.some((nodeId) => !document.nodesById[nodeId]))
    return failure("not-found", "One or more flip layers do not exist");
  const selected = topLevelSelection(document, unique);
  if (selected.some((nodeId) => !nodeBelongsToPage(document, pageId, nodeId)))
    return failure(
      "invalid-selection",
      "Selected layers do not belong to the target Page",
    );
  if (selected.some((nodeId) => isEffectivelyLocked(document, nodeId)))
    return failure("locked", "Locked layers cannot be flipped");
  return {
    ok: true,
    nodeIds: selected,
    nodes: selected.map((nodeId) => document.nodesById[nodeId]!),
  };
}

function flipNode(
  projected: DesignDocument,
  source: DesignDocument,
  node: DesignNode,
  axis: FlipAxis,
  bounds: Rect,
  localAxis: boolean,
): boolean {
  const parentWorld = node.parentId
    ? getWorldTransform(source, node.parentId)
    : ([1, 0, 0, 1, 0, 0] as Transform);
  const parentInverse = parentWorld ? invertTransform(parentWorld) : null;
  if (!parentInverse) return false;
  if (localAxis) {
    projected.nodesById[node.id]!.transform = normalizeTransform(
      multiplyTransforms(
        node.transform,
        localReflectionTransform(axis, node.size),
      ),
    );
    return true;
  }
  const world = getWorldTransform(source, node.id);
  if (!world) return false;
  const reflectedWorld = multiplyTransforms(
    reflectionTransform(axis, bounds),
    world,
  );
  const local = normalizeTransform(
    multiplyTransforms(parentInverse, reflectedWorld),
  );
  if (local.some((value) => !Number.isFinite(value))) return false;
  projected.nodesById[node.id]!.transform = local;
  return true;
}

function isAutoLayoutFlowChild(
  document: DesignDocument,
  node: DesignNode,
): boolean {
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  if (!parent || (parent.kind !== "frame" && parent.kind !== "slot"))
    return false;
  const layout = parent.properties.autoLayout;
  return Boolean(
    layout && layout.mode !== "none" && node.layoutPositioning !== "absolute",
  );
}

function geometryCommands(
  before: DesignDocument,
  after: DesignDocument,
  commandPrefix: string,
): DesignOperation[] {
  const commands: DesignOperation[] = [];
  for (const nodeId of Object.keys(after.nodesById)) {
    const previous = before.nodesById[nodeId];
    const next = after.nodesById[nodeId];
    if (!previous || !next) continue;
    const command = nodeGeometryUpdate(
      previous,
      next,
      `${commandPrefix}_update_${commands.length}`,
    );
    if (command) commands.push(command);
  }
  return commands;
}

function topLevelSelection(
  document: DesignDocument,
  nodeIds: readonly string[],
): string[] {
  const selected = new Set(nodeIds);
  return [...selected].filter((nodeId) => {
    const visited = new Set<string>();
    let parentId = document.nodesById[nodeId]?.parentId;
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = document.nodesById[parentId]?.parentId ?? null;
    }
    return true;
  });
}

function normalizeTransform(transform: Transform): Transform {
  return transform.map((value) => {
    const normalized =
      Math.abs(value) < 1e-12 ? 0 : Math.round(value * 1e12) / 1e12;
    return Object.is(normalized, -0) ? 0 : normalized;
  }) as Transform;
}

function failure(
  code: FlipOperationFailureCode,
  message: string,
): Extract<FlipOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
