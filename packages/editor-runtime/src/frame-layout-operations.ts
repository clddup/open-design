import type {
  AutoLayoutFlow,
  DesignDocument,
  DesignNode,
  DesignOperation,
  LayoutConstraints,
  Size,
} from "@opendesign/design-contracts";
import { MAX_TRANSACTION_COMMANDS } from "@opendesign/design-contracts";
import {
  DEFAULT_LAYOUT_CONSTRAINTS,
  LAYOUT_SERVICE_CONTRACT_VERSION,
  solveConstraints,
} from "@opendesign/layout-service";

export type FrameLayoutOperationFailureCode =
  | "invalid-target"
  | "locked"
  | "no-op"
  | "not-found"
  | "operation-limit"
  | "visual-fidelity";

export type FrameLayoutOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      frameId?: string;
      nodeIds: string[];
    }
  | {
      ok: false;
      code: FrameLayoutOperationFailureCode;
      message: string;
    };

export function planSetNodeConstraints(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  constraints: LayoutConstraints,
  commandPrefix: string,
): FrameLayoutOperationPlan {
  const node = document.nodesById[nodeId];
  if (!node) return failure("not-found", `Layer ${nodeId} does not exist`);
  if (!nodeBelongsToPage(document, pageId, nodeId)) {
    return failure(
      "invalid-target",
      `Layer ${nodeId} is not on Page ${pageId}`,
    );
  }
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  if (parent?.kind !== "frame") {
    return failure(
      "invalid-target",
      "Constraints require a layer directly inside a Frame",
    );
  }
  if (
    parent.properties.autoLayout !== undefined &&
    parent.properties.autoLayout.mode !== "none"
  ) {
    return failure(
      "invalid-target",
      "Flow children use Auto Layout sizing and cannot use ordinary Frame constraints",
    );
  }
  if (isEffectivelyLocked(document, nodeId)) {
    return failure("locked", "Locked layers cannot change constraints");
  }
  if (node.kind === "group" || node.kind === "boolean") {
    return failure(
      "visual-fidelity",
      `${node.kind} bounds follow their contents and cannot carry Frame constraints in constraints v1`,
    );
  }
  if (
    node.kind === "instance" &&
    (constraintResizes("horizontal", constraints.horizontal) ||
      constraintResizes("vertical", constraints.vertical))
  ) {
    return failure(
      "visual-fidelity",
      "Instance constraints v1 may reposition an instance but cannot resize it; resize its main component or detach it",
    );
  }
  if (
    node.kind === "text" &&
    node.properties.textResize !== "fixed" &&
    (constraintResizes("horizontal", constraints.horizontal) ||
      constraintResizes("vertical", constraints.vertical))
  ) {
    return failure(
      "visual-fidelity",
      "Auto Size text cannot use stretching or scale constraints before hug/fill sizing is available",
    );
  }
  if (sameConstraints(node.constraints, constraints)) {
    return failure("no-op", "Layer already uses the requested constraints");
  }
  return {
    ok: true,
    commands: [
      {
        commandId: `${commandPrefix}_constraints`,
        type: "update_properties",
        nodeId,
        constraints,
      },
    ],
    nodeIds: [nodeId],
  };
}

export function planResizeFrameWithConstraints(
  document: DesignDocument,
  pageId: string,
  frameId: string,
  size: Size,
  commandPrefix: string,
): FrameLayoutOperationPlan {
  const frame = document.nodesById[frameId];
  if (!frame) return failure("not-found", `Frame ${frameId} does not exist`);
  if (frame.kind !== "frame" || !nodeBelongsToPage(document, pageId, frameId)) {
    return failure(
      "invalid-target",
      `Target ${frameId} must be a Frame on Page ${pageId}`,
    );
  }
  if (isEffectivelyLocked(document, frameId)) {
    return failure("locked", "Locked Frames cannot be resized");
  }
  if (!finitePositiveSize(size)) {
    return failure("invalid-target", "Frame width and height must be positive");
  }
  if (sameSize(frame.size, size)) {
    return failure("no-op", "Frame already has the requested size");
  }
  const projected = structuredClone(document);
  const resizedIds = new Set<string>();
  const result = resizeFrame(projected, frameId, size, resizedIds);
  if (!result.ok) return result;
  const commands: DesignOperation[] = [];
  for (const nodeId of resizedIds) {
    const before = document.nodesById[nodeId];
    const after = projected.nodesById[nodeId];
    if (!before || !after) continue;
    const transformChanged = !sameTransform(before.transform, after.transform);
    const sizeChanged = !sameSize(before.size, after.size);
    const autoLayoutChanged =
      before.kind === "frame" &&
      after.kind === "frame" &&
      JSON.stringify(before.properties.autoLayout) !==
        JSON.stringify(after.properties.autoLayout);
    if (!transformChanged && !sizeChanged && !autoLayoutChanged) continue;
    commands.push({
      commandId: `${commandPrefix}_resize_${commands.length}`,
      type: "update_properties",
      nodeId,
      ...(transformChanged ? { transform: after.transform } : {}),
      ...(sizeChanged ? { size: after.size } : {}),
      ...(autoLayoutChanged &&
      after.kind === "frame" &&
      after.properties.autoLayout !== undefined
        ? { properties: { autoLayout: after.properties.autoLayout } }
        : {}),
    });
  }
  if (commands.length === 0) {
    return failure("no-op", "Frame and constrained descendants are unchanged");
  }
  if (commands.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Responsive resize requires ${commands.length} commands, exceeding the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return { ok: true, commands, frameId, nodeIds: [...resizedIds] };
}

function resizeFrame(
  document: DesignDocument,
  frameId: string,
  nextSize: Size,
  resizedIds: Set<string>,
):
  | Extract<FrameLayoutOperationPlan, { ok: true }>
  | Extract<FrameLayoutOperationPlan, { ok: false }> {
  const frame = document.nodesById[frameId];
  if (frame?.kind !== "frame") {
    return failure("not-found", `Frame ${frameId} does not exist`);
  }
  const previousSize = frame.size;
  if (
    frame.properties.autoLayout !== undefined &&
    frame.properties.autoLayout.mode !== "none"
  ) {
    const flow = frame.properties.autoLayout;
    const sizing = flow.sizing ?? { horizontal: "fixed", vertical: "fixed" };
    const nextSizing = {
      horizontal:
        nextSize.width !== frame.size.width
          ? ("fixed" as const)
          : sizing.horizontal,
      vertical:
        nextSize.height !== frame.size.height
          ? ("fixed" as const)
          : sizing.vertical,
    };
    const autoLayout: AutoLayoutFlow = { ...flow, sizing: nextSizing };
    if (
      nextSizing.horizontal !== sizing.horizontal ||
      nextSizing.vertical !== sizing.vertical
    )
      frame.properties.autoLayout = autoLayout;
    frame.size = structuredClone(nextSize);
    resizedIds.add(frameId);
    return { ok: true, commands: [], frameId, nodeIds: [...resizedIds] };
  }
  for (const childId of frame.childIds) {
    const child = document.nodesById[childId];
    if (!child) return failure("not-found", `Layer ${childId} does not exist`);
    if (!isTranslationOnly(child)) {
      return failure(
        "visual-fidelity",
        `Layer ${childId} has rotation, skew, or local scale; constraints v1 only resizes translation-only Frame children`,
      );
    }
    const constraints = child.constraints ?? DEFAULT_LAYOUT_CONSTRAINTS;
    const solved = solveConstraints({
      version: LAYOUT_SERVICE_CONTRACT_VERSION,
      constraints,
      child: {
        x: child.transform[4],
        y: child.transform[5],
        width: child.size.width,
        height: child.size.height,
      },
      previousParent: previousSize,
      nextParent: nextSize,
    });
    if (!solved.ok) {
      return failure(
        "visual-fidelity",
        `Layer ${childId} constraints could not be resolved: ${solved.message}`,
      );
    }
    const childNextSize = {
      width: solved.rect.width,
      height: solved.rect.height,
    };
    const childSizeChanged = !sameSize(child.size, childNextSize);
    if (
      childSizeChanged &&
      (child.kind === "group" ||
        child.kind === "boolean" ||
        child.kind === "instance")
    ) {
      return failure(
        "visual-fidelity",
        `Layer ${childId} cannot be resized by its constraints v1 semantics`,
      );
    }
    if (
      childSizeChanged &&
      child.kind === "text" &&
      child.properties.textResize !== "fixed"
    ) {
      return failure(
        "visual-fidelity",
        `Auto Size text ${childId} cannot be stretched or scaled before hug/fill sizing is available`,
      );
    }
    child.transform = [1, 0, 0, 1, solved.rect.x, solved.rect.y];
    if (child.kind === "frame" && childSizeChanged) {
      const nested = resizeFrame(document, child.id, childNextSize, resizedIds);
      if (!nested.ok) return nested;
    } else if (childSizeChanged) {
      child.size = childNextSize;
    }
    resizedIds.add(childId);
  }
  frame.size = structuredClone(nextSize);
  resizedIds.add(frameId);
  return { ok: true, commands: [], frameId, nodeIds: [...resizedIds] };
}

function constraintResizes(
  axis: "horizontal" | "vertical",
  constraint: LayoutConstraints[typeof axis],
): boolean {
  return axis === "horizontal"
    ? constraint === "left-right" || constraint === "scale"
    : constraint === "top-bottom" || constraint === "scale";
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

function isTranslationOnly(node: DesignNode): boolean {
  return (
    node.transform[0] === 1 &&
    node.transform[1] === 0 &&
    node.transform[2] === 0 &&
    node.transform[3] === 1
  );
}

function finitePositiveSize(size: Size): boolean {
  return (
    Number.isFinite(size.width) &&
    size.width > 0 &&
    Number.isFinite(size.height) &&
    size.height > 0
  );
}

function sameConstraints(
  left: LayoutConstraints | undefined,
  right: LayoutConstraints,
): boolean {
  const current = left ?? DEFAULT_LAYOUT_CONSTRAINTS;
  return (
    current.horizontal === right.horizontal &&
    current.vertical === right.vertical
  );
}

function sameSize(left: Size, right: Size): boolean {
  return left.width === right.width && left.height === right.height;
}

function sameTransform(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.every((value, index) => value === right[index]);
}

function failure(
  code: FrameLayoutOperationFailureCode,
  message: string,
): Extract<FrameLayoutOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
