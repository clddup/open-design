import type {
  DesignDocument,
  DesignNode,
  GridChildPlacement,
} from "@opendesign/design-contracts";
import type { AutoLayoutOperationPlan } from "./auto-layout-operations.js";

export function planSetNodeGridPlacement(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  placement: GridChildPlacement,
  commandPrefix: string,
): AutoLayoutOperationPlan {
  const node = document.nodesById[nodeId];
  if (!node) return failure("not-found", `Layer ${nodeId} does not exist`);
  if (!nodeBelongsToPage(document, pageId, nodeId))
    return failure(
      "invalid-target",
      `Layer ${nodeId} is not on Page ${pageId}`,
    );
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  const grid =
    parent?.kind === "frame" || parent?.kind === "slot"
      ? parent.properties.autoLayout
      : undefined;
  if (!parent || !grid || grid.mode !== "grid")
    return failure(
      "invalid-target",
      "Grid placement requires a direct child of a Grid Auto Layout Frame",
    );
  if (node.layoutPositioning === "absolute")
    return failure(
      "invalid-target",
      "Absolute children do not occupy Grid cells",
    );
  if (isEffectivelyLocked(document, nodeId))
    return failure("locked", "Locked layers cannot change Grid placement");
  if (
    placement.row + placement.rowSpan > grid.rows.length ||
    placement.column + placement.columnSpan > grid.columns.length
  )
    return failure(
      "visual-fidelity",
      `Grid placement for ${nodeId} extends outside the declared tracks`,
    );
  if (JSON.stringify(node.gridPlacement) === JSON.stringify(placement))
    return failure("no-op", "Layer already uses the requested Grid placement");
  return {
    ok: true,
    commands: [
      {
        commandId: `${commandPrefix}_grid_placement`,
        type: "update_properties",
        nodeId,
        gridPlacement: placement,
      },
    ],
    frameId: parent.id,
    nodeIds: [nodeId],
  };
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const roots = new Set(document.pagesById[pageId]?.rootNodeIds ?? []);
  const visited = new Set<string>();
  let current: DesignNode | undefined = document.nodesById[nodeId];
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parentId === null) return roots.has(current.id);
    current = current.parentId
      ? document.nodesById[current.parentId]
      : undefined;
  }
  return false;
}

function isEffectivelyLocked(
  document: DesignDocument,
  nodeId: string,
): boolean {
  let current: DesignNode | undefined = document.nodesById[nodeId];
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.locked) return true;
    visited.add(current.id);
    current = current.parentId
      ? document.nodesById[current.parentId]
      : undefined;
  }
  return false;
}

function failure(
  code: Extract<AutoLayoutOperationPlan, { ok: false }>["code"],
  message: string,
): AutoLayoutOperationPlan {
  return { ok: false, code, message };
}
