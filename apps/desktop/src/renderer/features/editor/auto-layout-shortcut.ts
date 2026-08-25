import type {
  AutoLayoutFlow,
  DesignDocument,
  DesignNode,
  SelectionState,
} from "@opendesign/design-contracts";

export function autoLayoutShortcutRequest(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
  document: DesignDocument,
  selection: SelectionState,
): { frameId: string; autoLayout: AutoLayoutFlow | { mode: "none" } } | null {
  if (
    !event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.key.toLowerCase() !== "a"
  ) {
    return null;
  }
  const nodeId = selection.anchorNodeId ?? selection.nodeIds[0] ?? "";
  const selected = document.nodesById[nodeId];
  if (
    selection.nodeIds.length !== 1 ||
    (selected?.kind !== "frame" && selected?.kind !== "slot")
  )
    return null;
  return {
    frameId: selected.id,
    autoLayout: event.altKey ? { mode: "none" } : suggestedAutoLayout(selected),
  };
}

export function canShowOrdinaryConstraints(
  document: DesignDocument,
  node: DesignNode | undefined,
): boolean {
  if (!node?.parentId || node.kind === "group" || node.kind === "boolean") {
    return false;
  }
  const parent = document.nodesById[node.parentId];
  return (
    (parent?.kind === "frame" || parent?.kind === "slot") &&
    (parent.properties.autoLayout === undefined ||
      parent.properties.autoLayout.mode === "none" ||
      node.layoutPositioning === "absolute")
  );
}

export function canShowAutoLayoutSizing(
  document: DesignDocument,
  node: DesignNode | undefined,
): boolean {
  if (!node?.parentId) return false;
  const parent = document.nodesById[node.parentId];
  return (
    (parent?.kind === "frame" || parent?.kind === "slot") &&
    parent.properties.autoLayout !== undefined &&
    parent.properties.autoLayout.mode !== "none" &&
    node.layoutPositioning !== "absolute"
  );
}

export function layoutInspectorMode(
  document: DesignDocument,
  node: DesignNode | undefined,
): "constraints" | "sizing" | "absolute" | null {
  if (node?.layoutPositioning === "absolute") return "absolute";
  if (canShowOrdinaryConstraints(document, node)) return "constraints";
  if (canShowAutoLayoutSizing(document, node)) return "sizing";
  return null;
}

function suggestedAutoLayout(
  frame: Extract<DesignNode, { kind: "frame" | "slot" }>,
): AutoLayoutFlow {
  const existing = frame.properties.autoLayout;
  if (existing && existing.mode !== "none") return existing;
  return {
    mode: frame.size.width >= frame.size.height ? "horizontal" : "vertical",
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    gap: 0,
    primaryAlignment: "start",
    counterAlignment: "start",
  };
}
