import type {
  AutoLayout,
  DesignDocument,
  DesignNode,
  DesignOperation,
  GridChildPlacement,
  GridTrack,
} from "@opendesign/design-contracts";
import {
  DEFAULT_AUTO_LAYOUT_FRAME_SIZING,
  DEFAULT_LAYOUT_SIZING,
  MAX_GRID_TRACK_VALUE,
  MAX_TRANSACTION_COMMANDS,
} from "@opendesign/design-contracts";
import {
  GRID_AUTO_LAYOUT_CONTRACT_VERSION,
  solveGridAutoLayout,
} from "@opendesign/layout-service";
import type { AutoLayoutOperationPlan } from "./auto-layout-operations.js";
import { planDeleteNodes } from "./deletion-operations.js";

export type GridTrackAxis = "rows" | "columns";

const MAX_GRID_CHILD_MOVE_SEARCH_CELLS = 65_536;

export type GridTrackMovement = {
  from: number;
  to: number;
};

export type GridTrackReorderPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      frameId: string;
      nodeIds: string[];
      movements: GridTrackMovement[];
    }
  | Extract<AutoLayoutOperationPlan, { ok: false }>;

export type GridTrackUpdatePlan =
  | {
      ok: true;
      commands: DesignOperation[];
      frameId: string;
      indices: number[];
      nodeIds: string[];
      track: GridTrack;
    }
  | Extract<AutoLayoutOperationPlan, { ok: false }>;

export type GridTrackResizePlan = GridTrackUpdatePlan;

export type GridChildMovePlan =
  | {
      ok: true;
      commands: DesignOperation[];
      frameId: string;
      nodeIds: string[];
      target: { row: number; column: number };
    }
  | Extract<AutoLayoutOperationPlan, { ok: false }>;

export type GridTrackDeletePlan =
  | {
      ok: true;
      commands: DesignOperation[];
      deletedNodeIds: string[];
      frameId: string;
      indices: number[];
      nodeIds: string[];
    }
  | Extract<AutoLayoutOperationPlan, { ok: false }>;

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

export function planReorderGridTracks(
  document: DesignDocument,
  pageId: string,
  frameId: string,
  axis: GridTrackAxis,
  fromIndices: readonly number[],
  insertionIndex: number,
  commandPrefix: string,
): GridTrackReorderPlan {
  const frame = document.nodesById[frameId];
  if (!frame) return failure("not-found", `Frame ${frameId} does not exist`);
  if (
    (frame.kind !== "frame" && frame.kind !== "slot") ||
    !nodeBelongsToPage(document, pageId, frameId)
  )
    return failure(
      "invalid-target",
      `Target ${frameId} must be a Frame on Page ${pageId}`,
    );
  const grid = frame.properties.autoLayout;
  if (!grid || grid.mode !== "grid")
    return failure(
      "invalid-target",
      `Frame ${frameId} does not use Grid Auto Layout`,
    );
  if (isEffectivelyLocked(document, frameId))
    return failure("locked", "Locked Frames cannot reorder Grid tracks");
  for (const childId of frame.childIds)
    if (!document.nodesById[childId])
      return failure("not-found", `Layer ${childId} does not exist`);

  const includeHidden = grid.itemsPositioning === "manual";
  const affectedNodeIds = frame.childIds.filter((childId) => {
    const child = document.nodesById[childId]!;
    return (
      (includeHidden || child.visible) && child.layoutPositioning !== "absolute"
    );
  });

  const tracks = grid[axis];
  if (
    fromIndices.length === 0 ||
    !Number.isInteger(insertionIndex) ||
    insertionIndex < 0 ||
    insertionIndex > tracks.length ||
    fromIndices.some(
      (index) =>
        !Number.isInteger(index) || index < 0 || index >= tracks.length,
    )
  )
    return failure(
      "invalid-target",
      `Grid ${axis} reorder indices are outside the declared tracks`,
    );

  const selected = closeSelectionOverChildSpans(
    document,
    frame.childIds,
    axis,
    new Set(fromIndices),
    includeHidden,
  );
  const selectedIndices = [...selected].sort((left, right) => left - right);
  const remainingIndices = Array.from(
    { length: tracks.length },
    (_, index) => index,
  ).filter((index) => !selected.has(index));
  const insertionInRemaining = remainingIndices.filter(
    (index) => index < insertionIndex,
  ).length;
  const nextOrder = [
    ...remainingIndices.slice(0, insertionInRemaining),
    ...selectedIndices,
    ...remainingIndices.slice(insertionInRemaining),
  ];
  if (nextOrder.every((from, to) => from === to))
    return failure("no-op", `Grid ${axis} already use the requested order`);

  const toByFrom = new Map(nextOrder.map((from, to) => [from, to] as const));
  const movements = Array.from({ length: tracks.length }, (_, from) => ({
    from,
    to: toByFrom.get(from)!,
  }));
  const nextGrid: Extract<AutoLayout, { mode: "grid" }> = {
    ...grid,
    [axis]: nextOrder.map((index) => tracks[index]!),
  };
  const commands: DesignOperation[] = [
    {
      commandId: `${commandPrefix}_tracks`,
      type: "update_properties",
      nodeId: frameId,
      properties: { autoLayout: nextGrid },
    },
  ];
  if (grid.itemsPositioning === "manual") {
    for (const childId of frame.childIds) {
      const child = document.nodesById[childId];
      if (
        !child ||
        child.layoutPositioning === "absolute" ||
        !child.gridPlacement
      )
        continue;
      const placement = remapPlacement(child.gridPlacement, axis, toByFrom);
      if (samePlacement(placement, child.gridPlacement)) continue;
      commands.push({
        commandId: `${commandPrefix}_placement_${commands.length}`,
        type: "update_properties",
        nodeId: childId,
        gridPlacement: placement,
      });
    }
  } else {
    const flowChildren = frame.childIds.filter((childId) => {
      const child = document.nodesById[childId];
      return (
        child?.visible === true &&
        child.layoutPositioning !== "absolute" &&
        child.gridPlacement !== undefined
      );
    });
    const originalFlowIndex = new Map(
      flowChildren.map((childId, index) => [childId, index] as const),
    );
    const reorderedFlow = [...flowChildren].sort((leftId, rightId) => {
      const left = remapPlacement(
        document.nodesById[leftId]!.gridPlacement!,
        axis,
        toByFrom,
      );
      const right = remapPlacement(
        document.nodesById[rightId]!.gridPlacement!,
        axis,
        toByFrom,
      );
      return (
        left.row - right.row ||
        left.column - right.column ||
        originalFlowIndex.get(leftId)! - originalFlowIndex.get(rightId)!
      );
    });
    const flowSlots = new Set(flowChildren);
    let nextFlowIndex = 0;
    const desiredChildren = frame.childIds.map((childId) =>
      flowSlots.has(childId) ? reorderedFlow[nextFlowIndex++]! : childId,
    );
    const working = [...frame.childIds];
    for (const [index, nodeId] of desiredChildren.entries()) {
      if (working[index] === nodeId) continue;
      const currentIndex = working.indexOf(nodeId);
      if (currentIndex < 0)
        return failure("not-found", `Layer ${nodeId} does not exist`);
      working.splice(currentIndex, 1);
      working.splice(index, 0, nodeId);
      commands.push({
        commandId: `${commandPrefix}_move_${commands.length}`,
        type: "move_element",
        nodeId,
        pageId,
        parentId: frameId,
        index,
      });
    }
  }

  if (commands.length > MAX_TRANSACTION_COMMANDS)
    return failure(
      "operation-limit",
      `Grid track reorder exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  return {
    ok: true,
    commands,
    frameId,
    nodeIds: [frameId, ...affectedNodeIds],
    movements,
  };
}

export function planResizeGridTrack(
  document: DesignDocument,
  pageId: string,
  frameId: string,
  axis: GridTrackAxis,
  index: number,
  value: number,
  commandPrefix: string,
): GridTrackResizePlan {
  return planSetGridTrack(
    document,
    pageId,
    frameId,
    axis,
    index,
    { type: "fixed", value },
    commandPrefix,
  );
}

export function planSetGridTrack(
  document: DesignDocument,
  pageId: string,
  frameId: string,
  axis: GridTrackAxis,
  index: number,
  track: GridTrack,
  commandPrefix: string,
): GridTrackUpdatePlan {
  return planSetGridTracks(
    document,
    pageId,
    frameId,
    axis,
    [index],
    track,
    commandPrefix,
  );
}

export function planSetGridTracks(
  document: DesignDocument,
  pageId: string,
  frameId: string,
  axis: GridTrackAxis,
  indices: readonly number[],
  track: GridTrack,
  commandPrefix: string,
): GridTrackUpdatePlan {
  const frame = document.nodesById[frameId];
  if (!frame) return failure("not-found", `Frame ${frameId} does not exist`);
  if (
    (frame.kind !== "frame" && frame.kind !== "slot") ||
    !nodeBelongsToPage(document, pageId, frameId)
  )
    return failure(
      "invalid-target",
      `Target ${frameId} must be a Frame on Page ${pageId}`,
    );
  const grid = frame.properties.autoLayout;
  if (!grid || grid.mode !== "grid")
    return failure(
      "invalid-target",
      `Frame ${frameId} does not use Grid Auto Layout`,
    );
  if (isEffectivelyLocked(document, frameId))
    return failure("locked", "Locked Frames cannot resize Grid tracks");
  const tracks = grid[axis];
  const selectedIndices = [...new Set(indices)].sort(
    (left, right) => left - right,
  );
  if (
    selectedIndices.length === 0 ||
    selectedIndices.some(
      (index) =>
        !Number.isInteger(index) || index < 0 || index >= tracks.length,
    )
  )
    return failure(
      "invalid-target",
      `Grid ${axis} sizing indices are outside the declared tracks`,
    );
  if (!validGridTrack(track))
    return failure(
      "invalid-target",
      `Grid track must be Hug, a Fixed value from 0 to ${MAX_GRID_TRACK_VALUE}px, or a positive Fill weight up to ${MAX_GRID_TRACK_VALUE}fr`,
    );
  if (selectedIndices.every((index) => sameTrack(tracks[index]!, track)))
    return failure(
      "no-op",
      `Selected Grid ${axis} tracks already use the requested sizing`,
    );
  const selected = new Set(selectedIndices);
  const nextTracks = tracks.map((candidate, candidateIndex) =>
    selected.has(candidateIndex) ? track : candidate,
  );
  const nextGrid: Extract<AutoLayout, { mode: "grid" }> = {
    ...grid,
    [axis]: nextTracks,
  };
  return {
    ok: true,
    commands: [
      {
        commandId: `${commandPrefix}_tracks`,
        type: "update_properties",
        nodeId: frameId,
        properties: { autoLayout: nextGrid },
      },
    ],
    frameId,
    indices: selectedIndices,
    nodeIds: [frameId, ...frame.childIds],
    track,
  };
}

export function planDeleteGridTracks(
  document: DesignDocument,
  pageId: string,
  frameId: string,
  axis: GridTrackAxis,
  indices: readonly number[],
  commandPrefix: string,
): GridTrackDeletePlan {
  const frame = document.nodesById[frameId];
  if (!frame) return failure("not-found", `Frame ${frameId} does not exist`);
  if (
    (frame.kind !== "frame" && frame.kind !== "slot") ||
    !nodeBelongsToPage(document, pageId, frameId)
  ) {
    return failure(
      "invalid-target",
      `Target ${frameId} must be a Frame on Page ${pageId}`,
    );
  }
  const grid = frame.properties.autoLayout;
  if (!grid || grid.mode !== "grid") {
    return failure(
      "invalid-target",
      `Frame ${frameId} does not use Grid Auto Layout`,
    );
  }
  if (isEffectivelyLocked(document, frameId)) {
    return failure("locked", "Locked Frames cannot delete Grid tracks");
  }
  if (axis === "rows" && grid.autoTracks === "rows") {
    return failure(
      "invalid-target",
      "Automatically generated Grid rows cannot be deleted individually",
    );
  }

  const tracks = grid[axis];
  const selectedIndices = [...new Set(indices)].sort(
    (left, right) => left - right,
  );
  if (
    selectedIndices.length === 0 ||
    selectedIndices.some(
      (index) =>
        !Number.isInteger(index) || index < 0 || index >= tracks.length,
    )
  ) {
    return failure(
      "invalid-target",
      `Grid ${axis} deletion indices are outside the declared tracks`,
    );
  }
  if (selectedIndices.length >= tracks.length) {
    return failure(
      "invalid-target",
      `Grid ${axis} must retain at least one track`,
    );
  }

  const selected = new Set(selectedIndices);
  const deletedNodeIds: string[] = [];
  const placementUpdates: Array<{
    nodeId: string;
    placement: GridChildPlacement;
  }> = [];
  for (const childId of frame.childIds) {
    const child = document.nodesById[childId];
    if (!child) return failure("not-found", `Layer ${childId} does not exist`);
    if (child.layoutPositioning === "absolute" || !child.gridPlacement) {
      continue;
    }
    const placement = placementAfterTrackDeletion(
      child.gridPlacement,
      axis,
      selected,
    );
    if (!placement) {
      deletedNodeIds.push(childId);
      continue;
    }
    if (samePlacement(placement, child.gridPlacement)) continue;
    if (isEffectivelyLocked(document, childId)) {
      return failure(
        "locked",
        `Locked layer ${childId} cannot move with deleted Grid tracks`,
      );
    }
    placementUpdates.push({ nodeId: childId, placement });
  }

  const deletion =
    deletedNodeIds.length > 0
      ? planDeleteNodes(document, {
          nodeIds: deletedNodeIds,
          commandPrefix: `${commandPrefix}_contents`,
        })
      : { ok: true as const, commands: [], rootNodeIds: [] };
  if (!deletion.ok) {
    return failure(
      deletion.code === "operation-limit"
        ? "operation-limit"
        : "invalid-target",
      deletion.message,
    );
  }

  const nextGrid: Extract<AutoLayout, { mode: "grid" }> = {
    ...grid,
    [axis]: tracks.filter((_, index) => !selected.has(index)),
  };
  const commands: DesignOperation[] = [
    ...deletion.commands,
    {
      commandId: `${commandPrefix}_tracks`,
      type: "update_properties",
      nodeId: frameId,
      properties: { autoLayout: nextGrid },
    },
    ...placementUpdates.map(
      ({ nodeId, placement }, index): DesignOperation => ({
        commandId: `${commandPrefix}_placement_${index}`,
        type: "update_properties",
        nodeId,
        gridPlacement: placement,
      }),
    ),
  ];
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Grid track deletion exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return {
    ok: true,
    commands,
    deletedNodeIds: [...deletion.rootNodeIds],
    frameId,
    indices: selectedIndices,
    nodeIds: [frameId, ...frame.childIds],
  };
}

export function planMoveGridChildren(
  document: DesignDocument,
  pageId: string,
  frameId: string,
  nodeIds: readonly string[],
  anchorNodeId: string,
  target: { row: number; column: number },
  commandPrefix: string,
): GridChildMovePlan {
  const frame = document.nodesById[frameId];
  if (!frame) return failure("not-found", `Frame ${frameId} does not exist`);
  if (
    (frame.kind !== "frame" && frame.kind !== "slot") ||
    !nodeBelongsToPage(document, pageId, frameId)
  ) {
    return failure(
      "invalid-target",
      `Target ${frameId} must be a Frame on Page ${pageId}`,
    );
  }
  const grid = frame.properties.autoLayout;
  if (!grid || grid.mode !== "grid") {
    return failure(
      "invalid-target",
      `Frame ${frameId} does not use Grid Auto Layout`,
    );
  }
  if (isEffectivelyLocked(document, frameId)) {
    return failure("locked", "Locked Grid Frames cannot move cell contents");
  }
  if (
    grid.rows.length * grid.columns.length >
    MAX_GRID_CHILD_MOVE_SEARCH_CELLS
  ) {
    return failure(
      "operation-limit",
      "Grid is too large for bounded direct cell movement",
    );
  }
  if (
    !Number.isInteger(target.row) ||
    !Number.isInteger(target.column) ||
    target.row < 0 ||
    target.column < 0 ||
    target.row >= grid.rows.length ||
    target.column >= grid.columns.length
  ) {
    return failure("invalid-target", "Grid child drop cell is out of range");
  }

  const selected = new Set(nodeIds);
  const ordered = frame.childIds.filter((nodeId) => selected.has(nodeId));
  if (
    selected.size === 0 ||
    ordered.length !== selected.size ||
    !selected.has(anchorNodeId)
  ) {
    return failure(
      "invalid-target",
      "Grid child movement requires current direct children and an anchor",
    );
  }
  for (const nodeId of ordered) {
    const node = document.nodesById[nodeId];
    if (
      !node ||
      !node.visible ||
      node.parentId !== frameId ||
      node.layoutPositioning === "absolute" ||
      (grid.itemsPositioning === "manual" && !node.gridPlacement)
    ) {
      return failure(
        "invalid-target",
        `Layer ${nodeId} is not a visible Grid flow child`,
      );
    }
    if (isEffectivelyLocked(document, nodeId)) {
      return failure("locked", `Locked layer ${nodeId} cannot move`);
    }
  }

  if (grid.itemsPositioning === "row-auto-flow") {
    return planMoveAutomaticGridChildren(
      document,
      pageId,
      frame,
      grid,
      ordered,
      anchorNodeId,
      target,
      commandPrefix,
    );
  }
  return planMoveManualGridChildren(
    document,
    frame,
    ordered,
    anchorNodeId,
    target,
    commandPrefix,
  );
}

function planMoveAutomaticGridChildren(
  document: DesignDocument,
  pageId: string,
  frame: Extract<DesignNode, { kind: "frame" | "slot" }>,
  grid: Extract<AutoLayout, { mode: "grid" }>,
  ordered: readonly string[],
  anchorNodeId: string,
  target: { row: number; column: number },
  commandPrefix: string,
): GridChildMovePlan {
  const selected = new Set(ordered);
  const flowChildren = frame.childIds.filter((nodeId) => {
    const node = document.nodesById[nodeId];
    return node?.visible === true && node.layoutPositioning !== "absolute";
  });
  const remaining = flowChildren.filter((nodeId) => !selected.has(nodeId));
  const targetOrdinal = target.row * grid.columns.length + target.column;
  const anchorOffset = ordered.indexOf(anchorNodeId);
  const insertionIndex = Math.max(
    0,
    Math.min(targetOrdinal - anchorOffset, remaining.length),
  );
  const nextFlow = [
    ...remaining.slice(0, insertionIndex),
    ...ordered,
    ...remaining.slice(insertionIndex),
  ];
  if (sameStringList(flowChildren, nextFlow)) {
    return failure("no-op", "Grid children already occupy this flow position");
  }

  const preflight = solveGridAutoLayout({
    version: GRID_AUTO_LAYOUT_CONTRACT_VERSION,
    frame: frame.size,
    frameSizing: grid.sizing ?? DEFAULT_AUTO_LAYOUT_FRAME_SIZING,
    ...(frame.layoutLimits ? { frameLimits: frame.layoutLimits } : {}),
    padding: grid.padding,
    rowGap: grid.rowGap,
    columnGap: grid.columnGap,
    rows: grid.rows,
    columns: grid.columns,
    itemsPositioning: grid.itemsPositioning,
    ...(grid.autoTracks ? { autoTracks: grid.autoTracks } : {}),
    children: nextFlow.map((nodeId) => {
      const node = document.nodesById[nodeId]!;
      return {
        id: node.id,
        width: node.size.width,
        height: node.size.height,
        sizing: node.layoutSizing ?? DEFAULT_LAYOUT_SIZING,
        ...(node.layoutLimits ? { limits: node.layoutLimits } : {}),
        ...(node.gridPlacement ? { placement: node.gridPlacement } : {}),
      };
    }),
  });
  if (!preflight.ok) {
    return failure(
      "visual-fidelity",
      `Grid content cannot use the requested flow order: ${preflight.message}`,
    );
  }

  const flowSlots = new Set(flowChildren);
  let nextFlowIndex = 0;
  const desiredChildren = frame.childIds.map((nodeId) =>
    flowSlots.has(nodeId) ? nextFlow[nextFlowIndex++]! : nodeId,
  );
  const working = [...frame.childIds];
  const commands: DesignOperation[] = [];
  const desiredIndexById = new Map(
    desiredChildren.map((nodeId, index) => [nodeId, index] as const),
  );
  for (let index = 0; index < desiredChildren.length; index += 1) {
    while (working[index] !== desiredChildren[index]) {
      const desiredNodeId = desiredChildren[index]!;
      const nodeId = flowSlots.has(desiredNodeId)
        ? desiredNodeId
        : working[index]!;
      if (!flowSlots.has(nodeId)) {
        return failure(
          "visual-fidelity",
          "Grid flow cannot preserve fixed layer slots",
        );
      }
      const currentIndex = working.indexOf(nodeId);
      const nextIndex = flowSlots.has(desiredNodeId)
        ? index
        : desiredIndexById.get(nodeId);
      if (currentIndex < 0 || nextIndex === undefined) {
        return failure("not-found", `Layer ${nodeId} does not exist`);
      }
      working.splice(currentIndex, 1);
      working.splice(nextIndex, 0, nodeId);
      commands.push({
        commandId: `${commandPrefix}_move_${commands.length}`,
        type: "move_element",
        nodeId,
        pageId,
        parentId: frame.id,
        index: nextIndex,
      });
      if (commands.length > MAX_TRANSACTION_COMMANDS) {
        return failure(
          "operation-limit",
          `Moving Grid children exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
        );
      }
    }
  }
  if (commands.length === 0) {
    return failure("no-op", "Grid children already use the requested order");
  }
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Moving Grid children exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return {
    ok: true,
    commands,
    frameId: frame.id,
    nodeIds: [...ordered],
    target,
  };
}

function planMoveManualGridChildren(
  document: DesignDocument,
  frame: Extract<DesignNode, { kind: "frame" | "slot" }>,
  ordered: readonly string[],
  anchorNodeId: string,
  target: { row: number; column: number },
  commandPrefix: string,
): GridChildMovePlan {
  const grid = frame.properties.autoLayout;
  if (!grid || grid.mode !== "grid") {
    return failure("invalid-target", "Grid Auto Layout is unavailable");
  }
  const anchor = document.nodesById[anchorNodeId]?.gridPlacement;
  if (!anchor) return failure("not-found", "Grid move anchor is unavailable");
  const rowOffset = target.row - anchor.row;
  const columnOffset = target.column - anchor.column;
  const selected = new Set(ordered);
  const selectedPlacements = new Map<string, GridChildPlacement>();
  for (const nodeId of ordered) {
    const placement = document.nodesById[nodeId]!.gridPlacement!;
    const shifted = {
      ...placement,
      row: placement.row + rowOffset,
      column: placement.column + columnOffset,
    };
    if (!placementFitsGrid(shifted, grid.rows.length, grid.columns.length)) {
      return failure(
        "invalid-target",
        `Moving ${nodeId} would extend outside the declared Grid tracks`,
      );
    }
    if (
      [...selectedPlacements.values()].some((candidate) =>
        placementsOverlap(candidate, shifted),
      )
    ) {
      return failure(
        "visual-fidelity",
        "Selected Grid children would overlap after this move",
      );
    }
    selectedPlacements.set(nodeId, shifted);
  }

  const unselected = frame.childIds.flatMap((nodeId) => {
    const node = document.nodesById[nodeId];
    return node &&
      !selected.has(nodeId) &&
      node.visible &&
      node.layoutPositioning !== "absolute" &&
      node.gridPlacement
      ? [{ nodeId, placement: node.gridPlacement }]
      : [];
  });
  const collided = unselected.filter(({ placement }) =>
    [...selectedPlacements.values()].some((candidate) =>
      placementsOverlap(candidate, placement),
    ),
  );
  for (const { nodeId } of collided) {
    if (isEffectivelyLocked(document, nodeId)) {
      return failure(
        "locked",
        `Locked layer ${nodeId} cannot be displaced from the target cell`,
      );
    }
  }

  const collidedIds = new Set(collided.map(({ nodeId }) => nodeId));
  const occupied = unselected
    .filter(({ nodeId }) => !collidedIds.has(nodeId))
    .map(({ placement }) => placement);
  occupied.push(...selectedPlacements.values());
  const occupancy = createGridOccupancyIndex(occupied);
  const displacedPlacements = new Map<string, GridChildPlacement>();
  let rowCount = grid.rows.length;
  for (const { nodeId, placement } of collided) {
    const next = nearestAvailablePlacement(
      placement,
      occupancy,
      4_096,
      grid.columns.length,
    );
    if (!next) {
      return failure(
        "operation-limit",
        `Grid has no available cell for displaced layer ${nodeId}`,
      );
    }
    displacedPlacements.set(nodeId, next);
    occupancy.add(next);
    rowCount = Math.max(rowCount, next.row + next.rowSpan);
  }

  const placements = new Map([...selectedPlacements, ...displacedPlacements]);
  if (
    rowCount === grid.rows.length &&
    [...placements].every(([nodeId, placement]) =>
      samePlacement(document.nodesById[nodeId]!.gridPlacement!, placement),
    )
  ) {
    return failure("no-op", "Grid children already occupy these cells");
  }
  const commands: DesignOperation[] = [];
  if (rowCount > grid.rows.length) {
    const template = grid.rows.at(-1)!;
    commands.push({
      commandId: `${commandPrefix}_rows`,
      type: "update_properties",
      nodeId: frame.id,
      properties: {
        autoLayout: {
          ...grid,
          rows: [
            ...grid.rows,
            ...Array.from({ length: rowCount - grid.rows.length }, () =>
              structuredClone(template),
            ),
          ],
        },
      },
    });
  }
  for (const [nodeId, placement] of placements) {
    if (samePlacement(document.nodesById[nodeId]!.gridPlacement!, placement)) {
      continue;
    }
    commands.push({
      commandId: `${commandPrefix}_placement_${commands.length}`,
      type: "update_properties",
      nodeId,
      gridPlacement: placement,
    });
  }
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Moving Grid children exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return {
    ok: true,
    commands,
    frameId: frame.id,
    nodeIds: [...placements.keys()],
    target,
  };
}

function nearestAvailablePlacement(
  source: GridChildPlacement,
  occupied: GridOccupancyIndex,
  rowCount: number,
  columnCount: number,
): GridChildPlacement | null {
  if (source.rowSpan > rowCount || source.columnSpan > columnCount) return null;
  const maxDistance = rowCount + columnCount;
  let inspected = 0;
  for (let distance = 0; distance <= maxDistance; distance += 1) {
    for (let rowDelta = -distance; rowDelta <= distance; rowDelta += 1) {
      const columnDistance = distance - Math.abs(rowDelta);
      const columns =
        columnDistance === 0
          ? [source.column]
          : [source.column - columnDistance, source.column + columnDistance];
      for (const column of columns) {
        const row = source.row + rowDelta;
        if (
          row < 0 ||
          column < 0 ||
          row + source.rowSpan > rowCount ||
          column + source.columnSpan > columnCount
        ) {
          continue;
        }
        inspected += 1;
        if (inspected > MAX_GRID_CHILD_MOVE_SEARCH_CELLS) return null;
        const candidate = { ...source, row, column };
        if (occupied.available(candidate)) return candidate;
      }
    }
  }
  return null;
}

interface GridOccupancyIndex {
  add(placement: GridChildPlacement): void;
  available(placement: GridChildPlacement): boolean;
}

function createGridOccupancyIndex(
  placements: readonly GridChildPlacement[],
): GridOccupancyIndex {
  const rows = new Map<number, Array<{ start: number; end: number }>>();
  const add = (placement: GridChildPlacement) => {
    for (
      let row = placement.row;
      row < placement.row + placement.rowSpan;
      row++
    ) {
      const intervals = rows.get(row) ?? [];
      intervals.push({
        start: placement.column,
        end: placement.column + placement.columnSpan,
      });
      rows.set(row, intervals);
    }
  };
  placements.forEach(add);
  return {
    add,
    available: (placement) => {
      const end = placement.column + placement.columnSpan;
      for (
        let row = placement.row;
        row < placement.row + placement.rowSpan;
        row += 1
      ) {
        if (
          rows
            .get(row)
            ?.some(
              (interval) =>
                placement.column < interval.end && interval.start < end,
            )
        ) {
          return false;
        }
      }
      return true;
    },
  };
}

function placementFitsGrid(
  placement: GridChildPlacement,
  rowCount: number,
  columnCount: number,
): boolean {
  return (
    placement.row >= 0 &&
    placement.column >= 0 &&
    placement.row + placement.rowSpan <= rowCount &&
    placement.column + placement.columnSpan <= columnCount
  );
}

function placementsOverlap(
  left: GridChildPlacement,
  right: GridChildPlacement,
): boolean {
  return (
    left.row < right.row + right.rowSpan &&
    right.row < left.row + left.rowSpan &&
    left.column < right.column + right.columnSpan &&
    right.column < left.column + left.columnSpan
  );
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function placementAfterTrackDeletion(
  placement: GridChildPlacement,
  axis: GridTrackAxis,
  deleted: ReadonlySet<number>,
): GridChildPlacement | null {
  const start = axis === "rows" ? placement.row : placement.column;
  const span = axis === "rows" ? placement.rowSpan : placement.columnSpan;
  const surviving = Array.from(
    { length: span },
    (_, offset) => start + offset,
  ).filter((index) => !deleted.has(index));
  const first = surviving[0];
  if (first === undefined) return null;
  const nextStart = Array.from({ length: first }, (_, index) => index).filter(
    (index) => !deleted.has(index),
  ).length;
  return axis === "rows"
    ? { ...placement, row: nextStart, rowSpan: surviving.length }
    : { ...placement, column: nextStart, columnSpan: surviving.length };
}

function validGridTrack(track: GridTrack): boolean {
  if (track.type === "hug") return true;
  return (
    Number.isFinite(track.value) &&
    track.value >= 0 &&
    track.value <= MAX_GRID_TRACK_VALUE &&
    (track.type !== "fill" || track.value > 0)
  );
}

function sameTrack(left: GridTrack, right: GridTrack): boolean {
  return (
    left.type === right.type &&
    (left.type === "hug" ||
      (right.type !== "hug" && left.value === right.value))
  );
}

function closeSelectionOverChildSpans(
  document: DesignDocument,
  childIds: readonly string[],
  axis: GridTrackAxis,
  selected: Set<number>,
  includeHidden: boolean,
): Set<number> {
  let changed = true;
  while (changed) {
    changed = false;
    for (const childId of childIds) {
      const child = document.nodesById[childId];
      if (
        !child ||
        (!includeHidden && !child.visible) ||
        child.layoutPositioning === "absolute" ||
        !child.gridPlacement
      )
        continue;
      const start =
        axis === "rows" ? child.gridPlacement.row : child.gridPlacement.column;
      const span =
        axis === "rows"
          ? child.gridPlacement.rowSpan
          : child.gridPlacement.columnSpan;
      if (
        !Array.from({ length: span }, (_, offset) => start + offset).some(
          (index) => selected.has(index),
        )
      )
        continue;
      for (let index = start; index < start + span; index += 1) {
        if (selected.has(index)) continue;
        selected.add(index);
        changed = true;
      }
    }
  }
  return selected;
}

function remapPlacement(
  placement: GridChildPlacement,
  axis: GridTrackAxis,
  toByFrom: ReadonlyMap<number, number>,
): GridChildPlacement {
  const start = axis === "rows" ? placement.row : placement.column;
  const span = axis === "rows" ? placement.rowSpan : placement.columnSpan;
  const mapped = Array.from(
    { length: span },
    (_, offset) => toByFrom.get(start + offset) ?? start + offset,
  );
  const nextStart = Math.min(...mapped);
  return axis === "rows"
    ? { ...placement, row: nextStart }
    : { ...placement, column: nextStart };
}

function samePlacement(
  left: GridChildPlacement,
  right: GridChildPlacement,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
): Extract<AutoLayoutOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
