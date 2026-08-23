import type { DesignDocument } from "@opendesign/design-contracts";
import {
  planArrangeNodes,
  planReorderGridTracks,
  planRepairDeliveryOverflow,
  planResizeFrameWithConstraints,
  planSetFrameAutoLayout,
  planSetNodeConstraints,
  planSetNodeLayoutLimits,
  planSetNodeLayoutPositioning,
  planSetNodeLayoutSizing,
  planSetFrameLayoutGuides,
  planSetNodeGridPlacement,
} from "@opendesign/editor-runtime";
import type { DesignArrangeToolInput } from "../../../shared/design-arrange-tool";

export function planDesignArrangeTool(
  document: DesignDocument,
  input: DesignArrangeToolInput,
  commandPrefix: string,
) {
  if (input.action === "repair-overflow")
    return planRepairDeliveryOverflow(
      document,
      input.pageId,
      input.frameId,
      commandPrefix,
    );
  if (input.action === "set-constraints")
    return planSetNodeConstraints(
      document,
      input.pageId,
      input.nodeId,
      input.constraints,
      commandPrefix,
    );
  if (input.action === "reorder-grid-tracks")
    return planReorderGridTracks(
      document,
      input.pageId,
      input.frameId,
      input.axis,
      input.fromIndices,
      input.insertionIndex,
      commandPrefix,
    );
  if (input.action === "resize-frame")
    return planResizeFrameWithConstraints(
      document,
      input.pageId,
      input.frameId,
      { width: input.width, height: input.height },
      commandPrefix,
    );
  if (input.action === "set-auto-layout")
    return planSetFrameAutoLayout(
      document,
      input.pageId,
      input.frameId,
      input.autoLayout,
      commandPrefix,
    );
  if (input.action === "set-layout-sizing")
    return planSetNodeLayoutSizing(
      document,
      input.pageId,
      input.nodeId,
      input.sizing,
      commandPrefix,
    );
  if (input.action === "set-grid-placement")
    return planSetNodeGridPlacement(
      document,
      input.pageId,
      input.nodeId,
      input.placement,
      commandPrefix,
    );
  if (input.action === "set-layout-positioning")
    return planSetNodeLayoutPositioning(
      document,
      input.pageId,
      input.nodeId,
      input.positioning,
      commandPrefix,
      input.constraints,
    );
  if (input.action === "set-layout-limits")
    return planSetNodeLayoutLimits(
      document,
      input.pageId,
      input.nodeId,
      input.limits,
      commandPrefix,
    );
  if (input.action === "set-layout-guides")
    return planSetFrameLayoutGuides(
      document,
      input.pageId,
      input.frameId,
      input.layoutGuides,
      commandPrefix,
    );
  return planArrangeNodes(
    document,
    input.pageId,
    input.nodeIds,
    input.action === "set-horizontal-spacing" ||
      input.action === "set-vertical-spacing"
      ? { action: input.action, spacing: input.spacing }
      : { action: input.action },
    commandPrefix,
  );
}
