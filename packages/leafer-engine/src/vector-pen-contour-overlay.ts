import type { Point } from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import { LEAFER_EDITOR_SELECTION_COLOR } from "./mapping.js";
import type { VectorPenContourStart } from "./vector-pen-edit.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

export interface VectorPenContourDraft {
  cursor: Point;
  start: VectorPenContourStart;
}

export interface VectorPenContourOverlay {
  anchor: LeaferElement;
  group: LeaferGroup;
  handlePath: LeaferElement;
  previewPath: LeaferElement;
}

export function createVectorPenContourOverlay(
  leafer: LeaferModule,
): VectorPenContourOverlay {
  const previewPath = new leafer.Path({
    editable: false,
    fill: null,
    hittable: false,
    stroke: LEAFER_EDITOR_SELECTION_COLOR,
    strokeCap: "round",
  }) as LeaferElement;
  const handlePath = new leafer.Path({
    editable: false,
    fill: null,
    hittable: false,
    stroke: "#8b8b89",
  }) as LeaferElement;
  const anchor = new leafer.Ellipse({
    editable: false,
    fill: "#ffffff",
    hittable: false,
    stroke: LEAFER_EDITOR_SELECTION_COLOR,
  }) as LeaferElement;
  const group = new leafer.Group({
    editable: false,
    hitChildren: false,
    visible: false,
  }) as LeaferGroup;
  group.add(previewPath);
  group.add(handlePath);
  group.add(anchor);
  return { anchor, group, handlePath, previewPath };
}

export function renderVectorPenContourOverlay(
  overlay: VectorPenContourOverlay,
  contour: VectorPenContourDraft | undefined,
  zoom: number,
  enabled: boolean,
): void {
  if (!contour || !enabled) {
    overlay.group.set({ visible: false });
    return;
  }
  const { point, tangentOut } = contour.start;
  const cursor = contour.cursor;
  const anchorSize = 8 / zoom;
  overlay.group.set({ visible: true });
  overlay.previewPath.set({
    path: tangentOut
      ? cubicPreviewPath(point, tangentOut, cursor)
      : `M ${point.x} ${point.y} L ${cursor.x} ${cursor.y}`,
    strokeWidth: 1.5 / zoom,
  });
  overlay.handlePath.set({
    path: tangentOut
      ? `M ${point.x - tangentOut.x} ${point.y - tangentOut.y} L ${point.x + tangentOut.x} ${point.y + tangentOut.y}`
      : "",
    strokeWidth: 1 / zoom,
  });
  overlay.anchor.set({
    height: anchorSize,
    strokeWidth: 1.5 / zoom,
    width: anchorSize,
    x: point.x - anchorSize / 2,
    y: point.y - anchorSize / 2,
  });
}

function cubicPreviewPath(point: Point, tangent: Point, cursor: Point): string {
  return `M ${point.x} ${point.y} C ${point.x + tangent.x} ${point.y + tangent.y} ${cursor.x} ${cursor.y} ${cursor.x} ${cursor.y}`;
}
