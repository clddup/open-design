import type {
  DesignDocument,
  DesignOperation,
  Rect,
  Size,
} from "@opendesign/design-contracts";
import { isFrameLikeNode } from "@opendesign/design-contracts";
import { getNodeBounds, getWorldTransform } from "./geometry.js";
import { diagnoseDesignTargetLayout } from "./layout-quality.js";
import { isEffectivelyLocked } from "./layer-operations.js";

const GEOMETRY_TOLERANCE = 0.5;
const MAX_REPAIRED_SIZE = 1_000_000;

export type DeliveryOverflowRepairPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      artboardFrameId: string;
      nodeIds: string[];
      resizedFrameIds: string[];
    }
  | {
      ok: false;
      code: "invalid-target" | "no-op" | "unsafe-overflow";
      message: string;
    };

/**
 * Expands only translation-only, non-Auto-Layout persistent clipping Frames.
 * Existing content keeps its world position. Negative-edge overflow, rotated
 * geometry, locked containers, and projected Component Main nodes remain
 * explicit model repair work instead of being silently restructured.
 */
export function planRepairDeliveryOverflow(
  document: DesignDocument,
  pageId: string,
  artboardFrameId: string,
  commandPrefix: string,
): DeliveryOverflowRepairPlan {
  const artboard = document.nodesById[artboardFrameId];
  if (!artboard || artboard.kind !== "frame") {
    return {
      ok: false,
      code: "invalid-target",
      message: `Delivery artboard ${artboardFrameId} is not a persistent Frame`,
    };
  }
  const report = diagnoseDesignTargetLayout(document, pageId, artboardFrameId);
  if (report.issues.some((issue) => issue.code === "target-frame-invalid")) {
    return {
      ok: false,
      code: "invalid-target",
      message: `Delivery artboard ${artboardFrameId} does not belong to Page ${pageId}`,
    };
  }

  const requestedSizes = new Map<string, Size>();
  const skipped: string[] = [];
  for (const issue of report.issues) {
    const nodeBounds = issue.geometry?.nodeBounds;
    if (!nodeBounds) continue;
    if (
      issue.code === "node-fully-outside-artboard" ||
      issue.code === "node-excessive-artboard-overflow" ||
      issue.code === "node-partial-artboard-overflow"
    ) {
      requestTrailingExpansion(
        document,
        artboardFrameId,
        nodeBounds,
        requestedSizes,
        skipped,
      );
      continue;
    }
    if (issue.code !== "component-node-clipped-by-ancestor") continue;
    for (const ancestorId of issue.relatedNodeIds.slice(1)) {
      requestTrailingExpansion(
        document,
        ancestorId,
        nodeBounds,
        requestedSizes,
        skipped,
      );
    }
  }

  const commands: DesignOperation[] = [];
  for (const [frameId, size] of requestedSizes) {
    const frame = document.nodesById[frameId];
    if (!frame || !isFrameLikeNode(frame)) continue;
    if (
      Math.abs(frame.size.width - size.width) <= GEOMETRY_TOLERANCE &&
      Math.abs(frame.size.height - size.height) <= GEOMETRY_TOLERANCE
    ) {
      continue;
    }
    commands.push({
      commandId: `${commandPrefix}_expand_${commands.length}`,
      type: "update_properties",
      nodeId: frameId,
      size,
    });
  }
  if (commands.length === 0) {
    return {
      ok: false,
      code: skipped.length > 0 ? "unsafe-overflow" : "no-op",
      message:
        skipped.length > 0
          ? `Overflow requires explicit structural repair: ${[...new Set(skipped)].slice(0, 8).join("; ")}`
          : `Delivery artboard ${artboardFrameId} has no safely expandable trailing-edge overflow`,
    };
  }
  return {
    ok: true,
    commands,
    artboardFrameId,
    nodeIds: [...requestedSizes.keys()],
    resizedFrameIds: [...requestedSizes.keys()],
  };
}

function requestTrailingExpansion(
  document: DesignDocument,
  frameId: string,
  nodeBounds: Rect,
  requestedSizes: Map<string, Size>,
  skipped: string[],
): void {
  const frame = document.nodesById[frameId];
  if (!frame || !isFrameLikeNode(frame)) {
    skipped.push(`${frameId} is a projected or non-Frame clipping ancestor`);
    return;
  }
  if (isEffectivelyLocked(document, frame.id)) {
    skipped.push(`${frameId} is locked`);
    return;
  }
  if (
    frame.properties.autoLayout !== undefined &&
    frame.properties.autoLayout.mode !== "none"
  ) {
    skipped.push(`${frameId} uses Auto Layout`);
    return;
  }
  const world = getWorldTransform(document, frame.id);
  const bounds = getNodeBounds(document, frame.id);
  if (
    !world ||
    !bounds ||
    !approximately(world[0], 1) ||
    !approximately(world[1], 0) ||
    !approximately(world[2], 0) ||
    !approximately(world[3], 1)
  ) {
    skipped.push(`${frameId} has rotated, skewed, or scaled geometry`);
    return;
  }
  if (
    nodeBounds.x < bounds.x - GEOMETRY_TOLERANCE ||
    nodeBounds.y < bounds.y - GEOMETRY_TOLERANCE
  ) {
    skipped.push(`${frameId} requires leading-edge expansion`);
    return;
  }
  const current = requestedSizes.get(frame.id) ?? frame.size;
  const width = Math.max(
    current.width,
    nodeBounds.x + nodeBounds.width - bounds.x,
  );
  const height = Math.max(
    current.height,
    nodeBounds.y + nodeBounds.height - bounds.y,
  );
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_REPAIRED_SIZE ||
    height > MAX_REPAIRED_SIZE
  ) {
    skipped.push(`${frameId} would exceed the bounded repair size`);
    return;
  }
  requestedSizes.set(frame.id, { width, height });
}

function approximately(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-6;
}
