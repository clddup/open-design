import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  LayoutConstraints,
} from "@opendesign/design-contracts";

export type LayoutPositioningIntent = "flow" | "absolute";

export type LayoutPositioningOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      frameId: string;
      nodeIds: string[];
    }
  | {
      ok: false;
      code:
        "invalid-target" | "locked" | "no-op" | "not-found" | "visual-fidelity";
      message: string;
    };

export function planSetNodeLayoutPositioning(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  positioning: LayoutPositioningIntent,
  commandPrefix: string,
  constraints?: LayoutConstraints,
): LayoutPositioningOperationPlan {
  const node = document.nodesById[nodeId];
  if (!node) return failure("not-found", `Layer ${nodeId} does not exist`);
  if (!nodeBelongsToPage(document, pageId, nodeId)) {
    return failure(
      "invalid-target",
      `Layer ${nodeId} is not on Page ${pageId}`,
    );
  }
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  const flow =
    parent?.kind === "frame" || parent?.kind === "slot"
      ? parent.properties.autoLayout
      : undefined;
  if (
    !parent ||
    (parent.kind !== "frame" && parent.kind !== "slot") ||
    !flow ||
    flow.mode === "none"
  ) {
    return failure(
      "invalid-target",
      "Layout positioning requires a direct child of an Auto Layout Frame",
    );
  }
  if (isEffectivelyLocked(document, nodeId)) {
    return failure("locked", "Locked layers cannot change layout positioning");
  }
  if (!isTranslationOnly(node)) {
    return failure(
      "visual-fidelity",
      `Layer ${nodeId} has rotation, skew, or local scale; absolute child v1 requires translation-only geometry`,
    );
  }
  const currentlyAbsolute = node.layoutPositioning === "absolute";
  const nextAbsolute = positioning === "absolute";
  const nextConstraints = nextAbsolute
    ? (constraints ?? node.constraints)
    : undefined;
  if (
    nextConstraints !== undefined &&
    (node.kind === "group" || node.kind === "boolean")
  ) {
    return failure(
      "visual-fidelity",
      `${node.kind} bounds follow their contents and cannot carry Frame constraints in absolute child v1`,
    );
  }
  if (
    nextConstraints !== undefined &&
    node.kind === "instance" &&
    (constraintResizes("horizontal", nextConstraints.horizontal) ||
      constraintResizes("vertical", nextConstraints.vertical))
  ) {
    return failure(
      "visual-fidelity",
      "Absolute Instance constraints may reposition the instance but cannot resize it",
    );
  }
  if (
    nextConstraints !== undefined &&
    node.kind === "text" &&
    node.properties.textResize !== "fixed" &&
    (constraintResizes("horizontal", nextConstraints.horizontal) ||
      constraintResizes("vertical", nextConstraints.vertical))
  ) {
    return failure(
      "visual-fidelity",
      "Absolute Auto Size text cannot use stretching or scale constraints",
    );
  }
  if (
    currentlyAbsolute === nextAbsolute &&
    (!nextAbsolute || sameConstraints(node.constraints, nextConstraints))
  ) {
    return failure(
      "no-op",
      `Layer already uses ${nextAbsolute ? "absolute" : "flow"} positioning`,
    );
  }
  return {
    ok: true,
    commands: [
      {
        commandId: `${commandPrefix}_positioning`,
        type: "update_properties",
        nodeId,
        layoutPositioning: nextAbsolute ? "absolute" : null,
        constraints: nextAbsolute ? (nextConstraints ?? null) : null,
        ...(node.layoutSizing !== undefined ? { layoutSizing: null } : {}),
        ...(node.layoutLimits !== undefined ? { layoutLimits: null } : {}),
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

function sameConstraints(
  left: LayoutConstraints | undefined,
  right: LayoutConstraints | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function constraintResizes(
  axis: "horizontal" | "vertical",
  constraint: LayoutConstraints[typeof axis],
): boolean {
  return axis === "horizontal"
    ? constraint === "left-right" || constraint === "scale"
    : constraint === "top-bottom" || constraint === "scale";
}

function failure(
  code: Extract<LayoutPositioningOperationPlan, { ok: false }>["code"],
  message: string,
): Extract<LayoutPositioningOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
