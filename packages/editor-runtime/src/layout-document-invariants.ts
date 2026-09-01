import {
  DEFAULT_AUTO_LAYOUT_FRAME_SIZING,
  DEFAULT_LAYOUT_SIZING,
  layoutGuideGeometryIsValid,
  type DesignDocument,
  type DesignIssue,
  type DesignNode,
} from "@opendesign/design-contracts";

export interface DocumentInvariantIssue {
  code?: string;
  path: string;
  message: string;
  expected?: DesignIssue["expected"];
  actual?: DesignIssue["actual"];
  recovery?: string;
}

export function validateNodeLayoutInvariants(
  document: DesignDocument,
  nodeId: string,
  node: DesignNode,
): DocumentInvariantIssue[] {
  const issues: DocumentInvariantIssue[] = [];
  if (
    (node.kind === "frame" || node.kind === "slot") &&
    node.properties.autoLayout?.mode === "vertical" &&
    node.properties.autoLayout.counterAlignment === "baseline"
  ) {
    issues.push({
      path: `/nodesById/${nodeId}/properties/autoLayout/counterAlignment`,
      message: "baseline alignment is only valid on horizontal Auto Layout",
    });
  }
  if (
    (node.kind === "frame" || node.kind === "slot") &&
    node.properties.autoLayout?.mode === "grid"
  ) {
    const grid = node.properties.autoLayout;
    const sizing = grid.sizing ?? DEFAULT_AUTO_LAYOUT_FRAME_SIZING;
    if (
      grid.autoTracks === "rows" &&
      grid.itemsPositioning !== "row-auto-flow"
    ) {
      issues.push({
        path: `/nodesById/${nodeId}/properties/autoLayout/autoTracks`,
        message: "automatic Grid rows require row auto-flow positioning",
      });
    }
    if (
      (sizing.horizontal === "hug" &&
        grid.columns.some((track) => track.type === "fill")) ||
      (sizing.vertical === "hug" &&
        (grid.rows.some((track) => track.type === "fill") ||
          grid.autoTracks === "rows"))
    ) {
      issues.push({
        path: `/nodesById/${nodeId}/properties/autoLayout`,
        message: "a hugged Grid axis cannot contain Fill tracks",
      });
    }
  }
  if (
    (node.kind === "frame" || node.kind === "slot") &&
    node.properties.autoLayout?.mode === "horizontal" &&
    node.properties.autoLayout.wrap &&
    (node.properties.autoLayout.sizing?.horizontal ?? "fixed") !== "fixed"
  ) {
    issues.push({
      path: `/nodesById/${nodeId}/properties/autoLayout/sizing/horizontal`,
      message: "wrapped Auto Layout requires fixed Frame width",
    });
  }
  if (node.kind === "frame" && node.properties.layoutGuides !== undefined) {
    const guideIds = new Set<string>();
    for (const guide of node.properties.layoutGuides) {
      if (guideIds.has(guide.id)) {
        issues.push({
          path: `/nodesById/${nodeId}/properties/layoutGuides`,
          message: "layout guide IDs must be unique within a Frame",
        });
        break;
      }
      guideIds.add(guide.id);
      if (!layoutGuideGeometryIsValid(node.size, guide)) {
        issues.push({
          path: `/nodesById/${nodeId}/properties/layoutGuides`,
          message:
            "layout guide geometry exceeds the Frame or 4096-primitive safety limit",
        });
        break;
      }
    }
  }
  const layoutParent = node.parentId
    ? document.nodesById[node.parentId]
    : undefined;
  const parentFlow =
    layoutParent?.kind === "frame" || layoutParent?.kind === "slot"
      ? layoutParent.properties.autoLayout
      : undefined;
  const absoluteInFlow =
    node.layoutPositioning === "absolute" &&
    parentFlow !== undefined &&
    parentFlow.mode !== "none";
  const parentGrid = parentFlow?.mode === "grid" ? parentFlow : undefined;
  if (node.gridPlacement !== undefined) {
    if (!parentGrid || absoluteInFlow) {
      issues.push({
        path: `/nodesById/${nodeId}/gridPlacement`,
        message:
          "grid placement is only valid on flow children of a Grid Auto Layout Frame",
      });
    } else if (
      node.gridPlacement.row + node.gridPlacement.rowSpan >
        parentGrid.rows.length ||
      node.gridPlacement.column + node.gridPlacement.columnSpan >
        parentGrid.columns.length
    ) {
      issues.push({
        path: `/nodesById/${nodeId}/gridPlacement`,
        message:
          "grid placement must stay inside the declared rows and columns",
      });
    }
  } else if (
    parentGrid?.itemsPositioning === "manual" &&
    !absoluteInFlow &&
    node.visible
  ) {
    issues.push({
      path: `/nodesById/${nodeId}/gridPlacement`,
      message:
        "manual Grid flow requires an explicit cell for every visible child",
    });
  }
  if (node.layoutPositioning !== undefined && !absoluteInFlow) {
    issues.push({
      path: `/nodesById/${nodeId}/layoutPositioning`,
      message:
        "absolute positioning is only valid on direct children of an Auto Layout Frame",
    });
  }
  if (
    absoluteInFlow &&
    (Math.abs(Math.abs(node.transform[0]) - 1) >= Number.EPSILON ||
      node.transform[1] !== 0 ||
      node.transform[2] !== 0 ||
      Math.abs(Math.abs(node.transform[3]) - 1) >= Number.EPSILON)
  ) {
    issues.push({
      path: `/nodesById/${nodeId}/layoutPositioning`,
      message:
        "absolute child requires axis-aligned geometry without rotation, skew, or unsupported local scale",
    });
  }
  if (node.constraints !== undefined) {
    if (layoutParent?.kind !== "frame" && layoutParent?.kind !== "slot") {
      issues.push({
        path: `/nodesById/${nodeId}/constraints`,
        message: "constraints are only valid on direct children of a Frame",
      });
    }
    if (node.kind === "group" || node.kind === "boolean") {
      issues.push({
        path: `/nodesById/${nodeId}/constraints`,
        message: `${node.kind} bounds follow their contents and cannot carry constraints v1`,
      });
    }
    if (
      (layoutParent?.kind === "frame" || layoutParent?.kind === "slot") &&
      layoutParent.properties.autoLayout !== undefined &&
      layoutParent.properties.autoLayout.mode !== "none" &&
      !absoluteInFlow
    ) {
      issues.push({
        path: `/nodesById/${nodeId}/constraints`,
        message:
          "ordinary constraints are not valid on children participating in Auto Layout",
      });
    }
  }
  if (node.layoutSizing !== undefined) {
    if (!parentFlow || parentFlow.mode === "none" || absoluteInFlow) {
      issues.push({
        path: `/nodesById/${nodeId}/layoutSizing`,
        message:
          "layout sizing is only valid on flow children of an Auto Layout Frame",
      });
    } else {
      const frameSizing = parentFlow.sizing ?? DEFAULT_AUTO_LAYOUT_FRAME_SIZING;
      const childSizing = node.layoutSizing ?? DEFAULT_LAYOUT_SIZING;
      if (
        (node.visible &&
          frameSizing.horizontal === "hug" &&
          childSizing.horizontal === "fill") ||
        (node.visible &&
          frameSizing.vertical === "hug" &&
          childSizing.vertical === "fill")
      ) {
        issues.push({
          path: `/nodesById/${nodeId}/layoutSizing`,
          message: "a child cannot fill an axis hugged by its parent Frame",
        });
      }
    }
    if (
      (node.kind === "group" || node.kind === "boolean") &&
      (node.layoutSizing.horizontal === "fill" ||
        node.layoutSizing.vertical === "fill")
    ) {
      issues.push({
        path: `/nodesById/${nodeId}/layoutSizing`,
        message: `${node.kind} bounds follow their contents and cannot fill an Auto Layout axis`,
      });
    }
    if (
      node.kind === "text" &&
      ((node.properties.textResize === "auto-width" &&
        (node.layoutSizing.horizontal === "fill" ||
          node.layoutSizing.vertical === "fill")) ||
        (node.properties.textResize === "auto-height" &&
          node.layoutSizing.vertical === "fill"))
    ) {
      issues.push({
        path: `/nodesById/${nodeId}/layoutSizing`,
        message: `text ${node.properties.textResize} sizing conflicts with the requested fill axis`,
      });
    }
  }
  if (node.layoutLimits !== undefined) {
    const ownFlow =
      node.kind === "frame" || node.kind === "slot"
        ? node.properties.autoLayout
        : undefined;
    const participatesInAutoLayout =
      (parentFlow !== undefined &&
        parentFlow.mode !== "none" &&
        !absoluteInFlow) ||
      (ownFlow !== undefined && ownFlow.mode !== "none");
    if (!participatesInAutoLayout) {
      issues.push({
        path: `/nodesById/${nodeId}/layoutLimits`,
        message:
          "layout limits are only valid on an Auto Layout Frame or its direct flow child",
      });
    }
  }
  return issues;
}
