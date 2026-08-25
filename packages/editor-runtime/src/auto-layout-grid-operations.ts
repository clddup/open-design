import type {
  AutoLayout,
  DesignDocument,
  DesignNode,
  DesignOperation,
  GridChildPlacement,
  GridTrack,
} from "@opendesign/design-contracts";
import {
  MAX_GRID_TRACK_VALUE,
  MAX_TRANSACTION_COMMANDS,
} from "@opendesign/design-contracts";
import type { AutoLayoutOperationPlan } from "./auto-layout-operations.js";

export type GridTrackAxis = "rows" | "columns";

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
