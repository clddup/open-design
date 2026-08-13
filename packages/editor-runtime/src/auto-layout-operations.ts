import type {
  AutoLayout,
  AutoLayoutFlow,
  DesignDocument,
  DesignNode,
  DesignOperation,
} from "@opendesign/design-contracts";
import { MAX_TRANSACTION_COMMANDS } from "@opendesign/design-contracts";
import {
  AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
  solveLinearAutoLayout,
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
  if (frame.kind !== "frame" || !nodeBelongsToPage(document, pageId, frameId)) {
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
  if (autoLayout.mode !== "none") {
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
    }
  }
  const commands: DesignOperation[] = [
    {
      commandId: `${commandPrefix}_frame`,
      type: "update_properties",
      nodeId: frameId,
      properties: { autoLayout },
    },
  ];
  if (autoLayout.mode !== "none") {
    for (const childId of frame.childIds) {
      if (document.nodesById[childId]?.constraints === undefined) continue;
      commands.push({
        commandId: `${commandPrefix}_clear_${commands.length}`,
        type: "update_properties",
        nodeId: childId,
        constraints: null,
      });
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
      (node): node is Extract<DesignNode, { kind: "frame" }> =>
        node.kind === "frame" &&
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
    if (frame?.kind !== "frame") {
      return resolutionFailure(
        "not-found",
        frameId,
        `Auto Layout Frame ${frameId} does not exist`,
      );
    }
    const autoLayout = frame.properties.autoLayout;
    if (!autoLayout || autoLayout.mode === "none") continue;
    const children: Array<{ id: string; width: number; height: number }> = [];
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
        return resolutionFailure(
          "invalid-layout",
          frameId,
          `Flow child ${childId} cannot use ordinary Frame constraints`,
        );
      }
      if (!isTranslationOnly(child)) {
        return resolutionFailure(
          "visual-fidelity",
          frameId,
          `Flow child ${childId} has rotation, skew, or local scale; linear Auto Layout v1 only positions translation-only children`,
        );
      }
      if (child.visible) children.push({ id: child.id, ...child.size });
    }
    const result = solveFrame(frame.size, autoLayout, children);
    if (!result.ok) {
      return resolutionFailure(
        "invalid-layout",
        frameId,
        `Frame ${frameId} Auto Layout could not be resolved: ${result.message}`,
      );
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
      positioned.add(child.id);
    }
  }
  return { ok: true, frameIds, nodeIds: [...positioned] };
}

function solveFrame(
  frame: { width: number; height: number },
  autoLayout: AutoLayoutFlow,
  children: Array<{ id: string; width: number; height: number }>,
) {
  return solveLinearAutoLayout({
    version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
    direction: autoLayout.mode,
    frame,
    padding: autoLayout.padding,
    gap: autoLayout.gap,
    primaryAlignment: autoLayout.primaryAlignment,
    counterAlignment: autoLayout.counterAlignment,
    children,
  });
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
