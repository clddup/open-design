import type {
  DesignDocument,
  ViewportState,
} from "@opendesign/design-contracts";
import { documentToScreen, getNodeBounds } from "@opendesign/editor-runtime";
import { useMemo, type CSSProperties, type PointerEvent } from "react";
import styles from "./CanvasFrameLabels.module.scss";

export type CanvasFrameLabel = {
  kind: "component" | "frame" | "slice";
  name: string;
  nodeId: string;
  selected: boolean;
  x: number;
  y: number;
};

export function CanvasFrameLabels({
  document,
  onSelect,
  pageId,
  selectedNodeIds,
  viewport,
}: {
  document: DesignDocument;
  onSelect: (nodeId: string) => void;
  pageId: string;
  selectedNodeIds: readonly string[];
  viewport: ViewportState;
}) {
  const labels = useMemo(
    () => resolveCanvasFrameLabels(document, pageId, viewport, selectedNodeIds),
    [document, pageId, selectedNodeIds, viewport],
  );
  if (labels.length === 0) return null;
  return (
    <div className={styles.root}>
      {labels.map((label) => (
        <button
          aria-pressed={label.selected}
          className={styles.label}
          data-kind={label.kind}
          data-selected={label.selected ? "true" : "false"}
          key={label.nodeId}
          onClick={() => onSelect(label.nodeId)}
          onPointerDown={stopCanvasPointer}
          style={
            {
              "--canvas-frame-label-x": `${label.x}px`,
              "--canvas-frame-label-y": `${label.y}px`,
            } as CSSProperties
          }
          title={label.name}
          type="button"
        >
          {label.name}
        </button>
      ))}
    </div>
  );
}

export function resolveCanvasFrameLabels(
  document: DesignDocument,
  pageId: string,
  viewport: ViewportState,
  selectedNodeIds: readonly string[],
): CanvasFrameLabel[] {
  const page = document.pagesById[pageId];
  if (!page) return [];
  const componentRootIds = new Set(
    Object.values(document.componentsById).map(
      (component) => component.rootNodeId,
    ),
  );
  const selectedIds = new Set(selectedNodeIds);
  return page.rootNodeIds.flatMap((nodeId) => {
    const node = document.nodesById[nodeId];
    if (!node || !node.visible || node.opacity <= 0) return [];
    const kind = labelKind(node.kind, componentRootIds.has(nodeId));
    if (!kind) return [];
    const bounds = getNodeBounds(document, nodeId);
    if (!bounds) return [];
    const topLeft = documentToScreen({ x: bounds.x, y: bounds.y }, viewport);
    const bottomRight = documentToScreen(
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      viewport,
    );
    if (!intersectsViewport(topLeft, bottomRight, viewport)) return [];
    return [
      {
        kind,
        name: node.name,
        nodeId,
        selected: selectedIds.has(nodeId),
        x: roundScreenCoordinate(topLeft.x),
        y: roundScreenCoordinate(topLeft.y - 20),
      },
    ];
  });
}

function labelKind(
  nodeKind: string,
  componentRoot: boolean,
): CanvasFrameLabel["kind"] | null {
  if (componentRoot) return "component";
  if (nodeKind === "frame") return "frame";
  if (nodeKind === "slice") return "slice";
  return null;
}

function intersectsViewport(
  topLeft: { x: number; y: number },
  bottomRight: { x: number; y: number },
  viewport: ViewportState,
): boolean {
  const margin = 32;
  return (
    bottomRight.x >= -margin &&
    bottomRight.y >= -margin &&
    topLeft.x <= viewport.width + margin &&
    topLeft.y <= viewport.height + margin
  );
}

function roundScreenCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function stopCanvasPointer(event: PointerEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}
