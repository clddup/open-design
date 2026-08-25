import type {
  DesignDocument,
  SelectionState,
} from "@opendesign/design-contracts";

export function canvasGridEditorScope(
  document: DesignDocument,
  selection: SelectionState,
): {
  autoLayoutSpacingFrameId?: string;
  gridEditorFrameId?: string;
} {
  if (selection.nodeIds.length === 1) {
    const selected = document.nodesById[selection.nodeIds[0] ?? ""];
    if (selected?.kind === "frame") {
      return {
        autoLayoutSpacingFrameId: selected.id,
        ...(selected.properties.autoLayout?.mode === "grid"
          ? { gridEditorFrameId: selected.id }
          : {}),
      };
    }
  }
  const selected = selection.nodeIds.map(
    (nodeId) => document.nodesById[nodeId],
  );
  const parentId = selected[0]?.parentId;
  if (
    !parentId ||
    selected.length === 0 ||
    selected.some(
      (node) =>
        !node ||
        node.parentId !== parentId ||
        !node.visible ||
        node.layoutPositioning === "absolute" ||
        !node.gridPlacement,
    )
  ) {
    return {};
  }
  const parent = document.nodesById[parentId];
  return (parent?.kind === "frame" || parent?.kind === "slot") &&
    parent.properties.autoLayout?.mode === "grid"
    ? { gridEditorFrameId: parentId }
    : {};
}
