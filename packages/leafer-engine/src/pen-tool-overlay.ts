import type * as LeaferEditorModule from "leafer-editor";
import { LEAFER_EDITOR_SELECTION_COLOR } from "./mapping.js";
import {
  penDraftAnchors,
  penDraftHandlePath,
  penDraftPreviewHasFillRegion,
  penDraftPreviewPath,
  type PenDraft,
  type PenDraftAnchor,
} from "./pen-tool.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

export interface PenToolOverlay {
  anchors: LeaferElement[];
  group: LeaferGroup;
  handlePath: LeaferElement;
  previewPath: LeaferElement;
}

const MATRIX_EPSILON = 0.000_001;
const PEN_HANDLE_COLOR = "#8aa4ff";

export function createPenToolOverlay(
  leafer: LeaferModule,
  parent: LeaferGroup,
): PenToolOverlay {
  const group = new leafer.Group({
    editable: false,
    hittable: false,
  }) as LeaferGroup;
  const previewPath = new leafer.Path({
    editable: false,
    fill: null,
    hittable: false,
    stroke: LEAFER_EDITOR_SELECTION_COLOR,
    strokeCap: "round",
    strokeJoin: "round",
  }) as LeaferElement;
  const handlePath = new leafer.Path({
    editable: false,
    fill: null,
    hittable: false,
    stroke: PEN_HANDLE_COLOR,
  }) as LeaferElement;
  group.add(previewPath);
  group.add(handlePath);
  parent.add(group);
  return { anchors: [], group, handlePath, previewPath };
}

export function destroyPenToolOverlay(overlay: PenToolOverlay): void {
  overlay.group.remove();
  overlay.group.destroy();
}

export function updatePenToolOverlay(
  leafer: LeaferModule,
  overlay: PenToolOverlay,
  draft: PenDraft,
  cursor: { x: number; y: number } | undefined,
  targetVertexId: string | undefined,
  zoomValue: number,
): void {
  const zoom = Math.max(MATRIX_EPSILON, Math.abs(zoomValue));
  const previewPath = penDraftPreviewPath(draft, cursor, targetVertexId);
  overlay.previewPath.set({
    path: previewPath ?? "",
    fill: penDraftPreviewHasFillRegion(draft, targetVertexId)
      ? {
          type: "solid",
          color: LEAFER_EDITOR_SELECTION_COLOR,
          opacity: 0.08,
        }
      : "transparent",
    strokeWidth: 1.5 / zoom,
  });
  overlay.handlePath.set({
    path: penDraftHandlePath(draft) ?? "",
    strokeWidth: 1 / zoom,
  });
  updateAnchors(leafer, overlay, displayAnchors(draft), targetVertexId, zoom);
}

function displayAnchors(draft: PenDraft): PenDraftAnchor[] {
  const anchors = penDraftAnchors(draft);
  return draft.pendingStart
    ? [
        ...anchors,
        {
          id: "__pending_pen_start__",
          x: draft.pendingStart.point.x,
          y: draft.pendingStart.point.y,
        },
      ]
    : anchors;
}

function updateAnchors(
  leafer: LeaferModule,
  overlay: PenToolOverlay,
  anchors: readonly PenDraftAnchor[],
  targetVertexId: string | undefined,
  zoom: number,
): void {
  while (overlay.anchors.length > anchors.length) {
    const anchor = overlay.anchors.pop();
    anchor?.remove();
    anchor?.destroy();
  }
  const size = 7 / zoom;
  anchors.forEach((item, index) => {
    let anchor = overlay.anchors[index];
    if (!anchor) {
      anchor = new leafer.Ellipse({ editable: false, hittable: false });
      overlay.anchors.push(anchor);
      overlay.group.add(anchor);
    }
    const targeted = item.id === targetVertexId;
    anchor.set({
      x: item.x - size / 2,
      y: item.y - size / 2,
      width: size,
      height: size,
      fill: targeted ? LEAFER_EDITOR_SELECTION_COLOR : "#ffffff",
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
      strokeWidth: 1.25 / zoom,
    });
  });
}
