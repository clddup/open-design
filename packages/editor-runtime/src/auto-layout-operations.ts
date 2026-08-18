import type {
  AutoLayout,
  AutoLayoutFlow,
  GridAutoLayout,
  GridChildPlacement,
  DesignDocument,
  DesignNode,
  DesignOperation,
  LayoutSizing,
  LayoutLimits,
} from "@opendesign/design-contracts";
import {
  DEFAULT_AUTO_LAYOUT_FRAME_SIZING,
  DEFAULT_LAYOUT_SIZING,
  MAX_TRANSACTION_COMMANDS,
} from "@opendesign/design-contracts";
import {
  AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
  DEFAULT_LAYOUT_CONSTRAINTS,
  LAYOUT_SERVICE_CONTRACT_VERSION,
  solveConstraints,
  solveLinearAutoLayout,
  solveGridAutoLayout,
} from "@opendesign/layout-service";

export type AutoLayoutOperationFailureCode =
  | "invalid-target"
  | "locked"
  | "no-op"
  | "not-found"
  | "operation-limit"
  | "visual-fidelity";

export type AutoLayoutOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      frameId: string;
      nodeIds: string[];
    }
  | {
      ok: false;
      code: AutoLayoutOperationFailureCode;
      message: string;
    };

export type AutoLayoutResolution =
  | { ok: true; frameIds: string[]; nodeIds: string[] }
  | {
      ok: false;
      code: "invalid-layout" | "not-found" | "visual-fidelity";
      frameId: string;
      message: string;
    };

export function planSetFrameAutoLayout(
  document: DesignDocument,
  pageId: string,
  frameId: string,
  autoLayout: AutoLayout,
  commandPrefix: string,
): AutoLayoutOperationPlan {
  const frame = document.nodesById[frameId];
  if (!frame) return failure("not-found", `Frame ${frameId} does not exist`);
  if (
    !isAutoLayoutContainer(frame) ||
    !nodeBelongsToPage(document, pageId, frameId)
  ) {
    return failure(
      "invalid-target",
      `Target ${frameId} must be a Frame on Page ${pageId}`,
    );
  }
  if (isEffectivelyLocked(document, frameId)) {
    return failure("locked", "Locked Frames cannot change Auto Layout");
  }
  if (sameAutoLayout(frame.properties.autoLayout, autoLayout)) {
    return failure("no-op", "Frame already uses the requested Auto Layout");
  }
  const commands: DesignOperation[] = [
    {
      commandId: `${commandPrefix}_frame`,
      type: "update_properties",
      nodeId: frameId,
      properties: { autoLayout },
    },
  ];
  const plannedGridPlacements =
    autoLayout.mode === "grid" && autoLayout.itemsPositioning === "manual"
      ? missingManualGridPlacements(document, frame, autoLayout)
      : new Map<string, GridChildPlacement>();
  if (typeof plannedGridPlacements === "string")
    return failure("visual-fidelity", plannedGridPlacements);
  if (autoLayout.mode !== "none") {
    if (
      autoLayout.mode === "grid" &&
      (((autoLayout.sizing?.horizontal ?? "fixed") === "hug" &&
        autoLayout.columns.some((track) => track.type === "fill")) ||
        ((autoLayout.sizing?.vertical ?? "fixed") === "hug" &&
          autoLayout.rows.some((track) => track.type === "fill")))
    ) {
      return failure(
        "visual-fidelity",
        `Grid Auto Layout Frame ${frameId} cannot use Fill tracks on a hugged axis`,
      );
    }
    if (
      autoLayout.mode === "horizontal" &&
      autoLayout.wrap &&
      (autoLayout.sizing?.horizontal ?? "fixed") !== "fixed"
    ) {
      return failure(
        "visual-fidelity",
        `Wrapped Auto Layout Frame ${frameId} requires fixed width`,
      );
    }
    for (const childId of frame.childIds) {
      const child = document.nodesById[childId];
      if (!child)
        return failure("not-found", `Layer ${childId} does not exist`);
      if (!isTranslationOnly(child)) {
        return failure(
          "visual-fidelity",
          `Layer ${childId} has rotation, skew, or local scale; linear Auto Layout v1 only positions translation-only direct children`,
        );
      }
      if (child.layoutPositioning === "absolute") continue;
      if (
        autoLayout.mode === "grid" &&
        autoLayout.itemsPositioning === "manual" &&
        child.visible &&
        child.gridPlacement === undefined &&
        !plannedGridPlacements.has(childId)
      ) {
        return failure(
          "visual-fidelity",
          `Manual Grid Auto Layout requires an explicit cell for child ${childId}`,
        );
      }
      const frameSizing = autoLayout.sizing ?? DEFAULT_AUTO_LAYOUT_FRAME_SIZING;
      const childSizing = child.layoutSizing ?? DEFAULT_LAYOUT_SIZING;
      if (
        child.visible &&
        autoLayout.mode === "horizontal" &&
        autoLayout.wrap &&
        (childSizing.horizontal === "fill" || childSizing.vertical === "fill")
      ) {
        return failure(
          "visual-fidelity",
          `Wrapped Auto Layout v1 does not support Fill child ${childId}`,
        );
      }
      if (
        child.visible &&
        ((frameSizing.horizontal === "hug" &&
          childSizing.horizontal === "fill") ||
          (frameSizing.vertical === "hug" && childSizing.vertical === "fill"))
      ) {
        return failure(
          "visual-fidelity",
          `Layer ${childId} cannot fill an axis hugged by Frame ${frameId}`,
        );
      }
    }
  } else {
    for (const childId of frame.childIds) {
      const child = document.nodesById[childId];
      if (!child) continue;
      if (child.layoutPositioning !== undefined) {
        commands.push({
          commandId: `${commandPrefix}_clear_positioning_${commands.length}`,
          type: "update_properties",
          nodeId: childId,
          layoutPositioning: null,
        });
      }
      if (child.layoutSizing !== undefined) {
        commands.push({
          commandId: `${commandPrefix}_clear_sizing_${commands.length}`,
          type: "update_properties",
          nodeId: childId,
          layoutSizing: null,
        });
      }
      if (child.gridPlacement !== undefined) {
        commands.push({
          commandId: `${commandPrefix}_clear_grid_${commands.length}`,
          type: "update_properties",
          nodeId: childId,
          gridPlacement: null,
        });
      }
      const childOwnFlow = isAutoLayoutContainer(child)
        ? child.properties.autoLayout
        : undefined;
      if (
        child.layoutLimits !== undefined &&
        (!childOwnFlow || childOwnFlow.mode === "none")
      ) {
        commands.push({
          commandId: `${commandPrefix}_clear_limits_${commands.length}`,
          type: "update_properties",
          nodeId: childId,
          layoutLimits: null,
        });
      }
    }
    const parent = frame.parentId
      ? document.nodesById[frame.parentId]
      : undefined;
    const parentFlow =
      parent && isAutoLayoutContainer(parent)
        ? parent.properties.autoLayout
        : undefined;
    if (
      frame.layoutLimits !== undefined &&
      (!parentFlow || parentFlow.mode === "none")
    ) {
      commands.push({
        commandId: `${commandPrefix}_clear_frame_limits_${commands.length}`,
        type: "update_properties",
        nodeId: frame.id,
        layoutLimits: null,
      });
    }
  }
  if (autoLayout.mode !== "none") {
    for (const childId of frame.childIds) {
      const child = document.nodesById[childId];
      if (
        child?.constraints === undefined ||
        child.layoutPositioning === "absolute"
      )
        continue;
      commands.push({
        commandId: `${commandPrefix}_clear_${commands.length}`,
        type: "update_properties",
        nodeId: childId,
        constraints: null,
      });
    }
    if (autoLayout.mode !== "grid") {
      for (const childId of frame.childIds) {
        const child = document.nodesById[childId];
        if (!child?.gridPlacement) continue;
        commands.push({
          commandId: `${commandPrefix}_clear_grid_${commands.length}`,
          type: "update_properties",
          nodeId: childId,
          gridPlacement: null,
        });
      }
    }
  }
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Auto Layout activation requires ${commands.length} commands, exceeding the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return {
    ok: true,
    commands,
    frameId,
    nodeIds: [frameId, ...frame.childIds],
  };
}

export function resolveAutoLayoutInPlace(
  document: DesignDocument,
): AutoLayoutResolution {
  const frameIds = Object.values(document.nodesById)
    .filter(
      (node): node is Extract<DesignNode, { kind: "frame" | "slot" }> =>
        isAutoLayoutContainer(node) &&
        node.properties.autoLayout !== undefined &&
        node.properties.autoLayout.mode !== "none",
    )
    .map((frame) => frame.id)
    .sort((left, right) => {
      const depth = nodeDepth(document, right) - nodeDepth(document, left);
      return depth !== 0 ? depth : left.localeCompare(right);
    });
  const positioned = new Set<string>();
  for (const frameId of frameIds) {
    const frame = document.nodesById[frameId];
    if (!frame || !isAutoLayoutContainer(frame)) {
      return resolutionFailure(
        "not-found",
        frameId,
        `Auto Layout Frame ${frameId} does not exist`,
      );
    }
    const autoLayout = frame.properties.autoLayout;
    if (!autoLayout || autoLayout.mode === "none") continue;
    if (
      autoLayout.mode === "grid" &&
      autoLayout.itemsPositioning === "manual"
    ) {
      const missing = missingManualGridPlacements(document, frame, autoLayout);
      if (typeof missing === "string")
        return resolutionFailure("invalid-layout", frameId, missing);
      for (const [childId, placement] of missing) {
        const child = document.nodesById[childId];
        if (child) child.gridPlacement = placement;
      }
    }
    const children: Array<{
      id: string;
      positioning: "flow" | "absolute";
      width: number;
      height: number;
      sizing: typeof DEFAULT_LAYOUT_SIZING;
      limits?: LayoutLimits;
      gridPlacement?: GridChildPlacement;
    }> = [];
    for (const childId of frame.childIds) {
      const child = document.nodesById[childId];
      if (!child) {
        return resolutionFailure(
          "not-found",
          frameId,
          `Auto Layout child ${childId} does not exist`,
        );
      }
      if (child.constraints !== undefined) {
        if (child.layoutPositioning === "absolute") continue;
        return resolutionFailure(
          "invalid-layout",
          frameId,
          `Flow child ${childId} cannot use ordinary Frame constraints`,
        );
      }
      if (child.layoutPositioning === "absolute") {
        children.push({
          id: child.id,
          positioning: "absolute",
          ...child.size,
          sizing: DEFAULT_LAYOUT_SIZING,
          ...(child.gridPlacement
            ? { gridPlacement: child.gridPlacement }
            : {}),
        });
        continue;
      }
      if (!isTranslationOnly(child)) {
        return resolutionFailure(
          "visual-fidelity",
          frameId,
          `Flow child ${childId} has rotation, skew, or local scale; linear Auto Layout v1 only positions translation-only children`,
        );
      }
      if (child.visible) {
        children.push({
          id: child.id,
          positioning: "flow",
          ...child.size,
          sizing: child.layoutSizing ?? DEFAULT_LAYOUT_SIZING,
          ...(child.layoutLimits ? { limits: child.layoutLimits } : {}),
          ...(child.gridPlacement
            ? { gridPlacement: child.gridPlacement }
            : {}),
        });
      }
    }
    const result = solveFrame(
      frame.size,
      frame.layoutLimits,
      autoLayout,
      children,
    );
    if (!result.ok) {
      return resolutionFailure(
        "invalid-layout",
        frameId,
        `Frame ${frameId} Auto Layout could not be resolved: ${result.message}`,
      );
    }
    const previousFrameSize = frame.size;
    frame.size = result.frame;
    positioned.add(frame.id);
    if (
      previousFrameSize.width !== result.frame.width ||
      previousFrameSize.height !== result.frame.height
    ) {
      for (const childId of frame.childIds) {
        const child = document.nodesById[childId];
        if (child?.layoutPositioning !== "absolute") continue;
        const constrained = solveConstraints({
          version: LAYOUT_SERVICE_CONTRACT_VERSION,
          constraints: child.constraints ?? DEFAULT_LAYOUT_CONSTRAINTS,
          child: {
            x: child.transform[4],
            y: child.transform[5],
            width: child.size.width,
            height: child.size.height,
          },
          previousParent: previousFrameSize,
          nextParent: result.frame,
        });
        if (!constrained.ok) {
          return resolutionFailure(
            "invalid-layout",
            frameId,
            `Absolute child ${childId} constraints could not be resolved: ${constrained.message}`,
          );
        }
        child.transform = [1, 0, 0, 1, constrained.rect.x, constrained.rect.y];
        child.size = {
          width: constrained.rect.width,
          height: constrained.rect.height,
        };
        positioned.add(child.id);
      }
    }
    for (const placement of result.placements) {
      const child = document.nodesById[placement.id];
      if (!child) {
        return resolutionFailure(
          "not-found",
          frameId,
          `Auto Layout child ${placement.id} does not exist`,
        );
      }
      child.transform = [1, 0, 0, 1, placement.x, placement.y];
      child.size = { width: placement.width, height: placement.height };
      if (isGridResolvedPlacement(placement))
        child.gridPlacement = placement.placement;
      positioned.add(child.id);
    }
  }
  return { ok: true, frameIds, nodeIds: [...positioned] };
}

export function resolveAutoLayoutUntilStable(
  document: DesignDocument,
  resolveWidthDependentText: (
    node: Extract<DesignNode, { kind: "text" }>,
  ) => void,
): AutoLayoutResolution {
  const flowCount = Object.values(document.nodesById).filter(
    (node) =>
      isAutoLayoutContainer(node) &&
      node.properties.autoLayout !== undefined &&
      node.properties.autoLayout.mode !== "none",
  ).length;
  const maximumPasses = Math.max(1, flowCount * 2 + 2);
  let previous = autoLayoutGeometryFingerprint(document);
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const autoHeightWidths = new Map<string, number>();
    for (const node of Object.values(document.nodesById)) {
      if (node.kind === "text" && node.properties.textResize === "auto-height")
        autoHeightWidths.set(node.id, node.size.width);
    }
    const resolution = resolveAutoLayoutInPlace(document);
    if (!resolution.ok) return resolution;
    for (const [nodeId, previousWidth] of autoHeightWidths) {
      const node = document.nodesById[nodeId];
      if (
        node?.kind === "text" &&
        node.properties.textResize === "auto-height" &&
        node.size.width !== previousWidth
      )
        resolveWidthDependentText(node);
    }
    const next = autoLayoutGeometryFingerprint(document);
    if (next === previous) return resolution;
    previous = next;
  }
  return resolutionFailure(
    "invalid-layout",
    Object.values(document.nodesById).find(
      (node) =>
        isAutoLayoutContainer(node) &&
        node.properties.autoLayout !== undefined &&
        node.properties.autoLayout.mode !== "none",
    )?.id ?? "unknown",
    `Auto Layout did not converge within ${maximumPasses} passes`,
  );
}

function autoLayoutGeometryFingerprint(document: DesignDocument): string {
  return JSON.stringify(
    Object.values(document.nodesById)
      .filter((node) => {
        if (
          isAutoLayoutContainer(node) &&
          node.properties.autoLayout !== undefined &&
          node.properties.autoLayout.mode !== "none"
        )
          return true;
        const parent = node.parentId
          ? document.nodesById[node.parentId]
          : undefined;
        return (
          parent !== undefined &&
          isAutoLayoutContainer(parent) &&
          parent.properties.autoLayout !== undefined &&
          parent.properties.autoLayout.mode !== "none"
        );
      })
      .map((node) => ({
        id: node.id,
        transform: node.transform,
        size: node.size,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function solveFrame(
  frame: { width: number; height: number },
  frameLimits: LayoutLimits | undefined,
  autoLayout: AutoLayoutFlow,
  children: Array<{
    id: string;
    positioning: "flow" | "absolute";
    width: number;
    height: number;
    sizing: LayoutSizing;
    limits?: LayoutLimits;
    gridPlacement?: GridChildPlacement;
  }>,
) {
  if (autoLayout.mode === "grid") {
    return solveGridAutoLayout({
      version: 1,
      frame,
      frameSizing: autoLayout.sizing ?? DEFAULT_AUTO_LAYOUT_FRAME_SIZING,
      ...(frameLimits ? { frameLimits } : {}),
      padding: autoLayout.padding,
      rowGap: autoLayout.rowGap,
      columnGap: autoLayout.columnGap,
      rows: autoLayout.rows,
      columns: autoLayout.columns,
      itemsPositioning: autoLayout.itemsPositioning,
      children: children
        .filter((child) => child.positioning === "flow")
        .map((child) => ({
          id: child.id,
          width: child.width,
          height: child.height,
          sizing: child.sizing,
          ...(child.limits ? { limits: child.limits } : {}),
          ...(child.gridPlacement ? { placement: child.gridPlacement } : {}),
        })),
    });
  }
  return solveLinearAutoLayout({
    version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
    direction: autoLayout.mode,
    frame,
    padding: autoLayout.padding,
    gap: autoLayout.gap,
    primaryAlignment: autoLayout.primaryAlignment,
    counterAlignment: autoLayout.counterAlignment,
    frameSizing: autoLayout.sizing ?? DEFAULT_AUTO_LAYOUT_FRAME_SIZING,
    ...(frameLimits ? { frameLimits } : {}),
    ...(autoLayout.mode === "horizontal" && autoLayout.wrap
      ? { wrap: autoLayout.wrap }
      : {}),
    children,
  });
}

function isAutoLayoutContainer(
  node: DesignNode,
): node is Extract<DesignNode, { kind: "frame" | "slot" }> {
  return node.kind === "frame" || node.kind === "slot";
}

function sameAutoLayout(
  left: AutoLayout | undefined,
  right: AutoLayout,
): boolean {
  return JSON.stringify(left ?? { mode: "none" }) === JSON.stringify(right);
}

function isTranslationOnly(node: DesignNode): boolean {
  return (
    node.transform[0] === 1 &&
    node.transform[1] === 0 &&
    node.transform[2] === 0 &&
    node.transform[3] === 1
  );
}

function isGridResolvedPlacement(value: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): value is typeof value & { placement: GridChildPlacement } {
  return (
    "placement" in value &&
    typeof (value as { placement?: unknown }).placement === "object" &&
    (value as { placement?: unknown }).placement !== null
  );
}

function missingManualGridPlacements(
  document: DesignDocument,
  frame: Extract<DesignNode, { kind: "frame" | "slot" }>,
  grid: GridAutoLayout,
): Map<string, GridChildPlacement> | string {
  const occupied = new Set<string>();
  const missing: string[] = [];
  for (const childId of frame.childIds) {
    const child = document.nodesById[childId];
    if (!child || !child.visible || child.layoutPositioning === "absolute")
      continue;
    const placement = child.gridPlacement;
    if (!placement) {
      missing.push(childId);
      continue;
    }
    if (
      placement.row + placement.rowSpan > grid.rows.length ||
      placement.column + placement.columnSpan > grid.columns.length
    )
      return `Grid placement for ${childId} extends outside the declared tracks`;
    for (
      let row = placement.row;
      row < placement.row + placement.rowSpan;
      row += 1
    ) {
      for (
        let column = placement.column;
        column < placement.column + placement.columnSpan;
        column += 1
      ) {
        const cell = `${row}:${column}`;
        if (occupied.has(cell))
          return `Manual Grid children overlap at ${cell}`;
        occupied.add(cell);
      }
    }
  }
  const result = new Map<string, GridChildPlacement>();
  for (const childId of missing) {
    let found: GridChildPlacement | undefined;
    for (let row = 0; row < grid.rows.length && !found; row += 1) {
      for (let column = 0; column < grid.columns.length; column += 1) {
        if (occupied.has(`${row}:${column}`)) continue;
        found = {
          row,
          column,
          rowSpan: 1,
          columnSpan: 1,
          horizontalAlign: "auto",
          verticalAlign: "auto",
        };
        occupied.add(`${row}:${column}`);
        break;
      }
    }
    if (!found) return `Manual Grid has no free cell for child ${childId}`;
    result.set(childId, found);
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
    current = document.nodesById[current.parentId];
  }
  return false;
}

function isEffectivelyLocked(
  document: DesignDocument,
  nodeId: string,
): boolean {
  const visited = new Set<string>();
  let current: DesignNode | undefined = document.nodesById[nodeId];
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
  code: AutoLayoutOperationFailureCode,
  message: string,
): AutoLayoutOperationPlan {
  return { ok: false, code, message };
}

function resolutionFailure(
  code: Extract<AutoLayoutResolution, { ok: false }>["code"],
  frameId: string,
  message: string,
): AutoLayoutResolution {
  return { ok: false, code, frameId, message };
}
