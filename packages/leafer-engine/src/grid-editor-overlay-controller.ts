import {
  MAX_GRID_TRACK_VALUE,
  type DesignDocument,
} from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import {
  matrixRelativeToParent,
  sameAffineMatrix,
  transformToAffine,
  type AffineMatrix,
} from "./affine.js";
import {
  createGridEditorOverlayPlan,
  gridTrackReorderChangesOrder,
  nearestGridInsertionIndex,
  type GridEditorAxis,
  type GridEditorOverlayPlan,
  type GridEditorTrackSpec,
} from "./grid-editor-overlay.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

export interface GridEditorPointerEvent {
  getInnerPoint(relative: unknown): { x: number; y: number };
  isCancel?: boolean;
  middle?: boolean;
  right?: boolean;
  target: unknown;
}

interface GridTrackElements {
  label: LeaferElement;
  pill: LeaferElement;
  reorderHit: LeaferElement;
  resizeHit: LeaferElement;
}

interface GridReorderDragSession {
  axis: GridEditorAxis;
  documentId: string;
  frameId: string;
  fromIndex: number;
  insertionIndex: number;
  kind: "reorder";
  revision: number;
}

interface GridResizeDragSession {
  axis: GridEditorAxis;
  documentId: string;
  frameId: string;
  index: number;
  initialPointerCoordinate: number;
  kind: "resize";
  moved: boolean;
  revision: number;
  start: number;
  value: number;
}

type GridDragSession = GridReorderDragSession | GridResizeDragSession;

type GridTrackReorderHandler = (request: {
  axis: GridEditorAxis;
  frameId: string;
  fromIndices: readonly number[];
  insertionIndex: number;
}) => boolean;

type GridTrackResizeHandler = (request: {
  axis: GridEditorAxis;
  expectedRevision: number;
  frameId: string;
  index: number;
  value: number;
}) => boolean;

const MATRIX_EPSILON = 0.000_001;
const GRID_COLOR = "#6574ff";
const GRID_GUIDE_COLOR = "rgba(101, 116, 255, 0.5)";
const GRID_HIT_FILL = "rgba(0, 0, 0, 0.001)";
const PILL_HEIGHT = 18;
const PILL_MIN_WIDTH = 22;
const PILL_OFFSET = 7;
const HIT_PADDING = 5;
const RESIZE_HIT_SIZE = 8;
const RESIZE_DRAG_THRESHOLD = 3;

export class GridEditorOverlayController {
  #documentId: string | null = null;
  #drag: GridDragSession | null = null;
  #fingerprint: string | null = null;
  readonly #guide: LeaferElement;
  readonly #reorderHitTracks = new WeakMap<object, GridEditorTrackSpec>();
  readonly #resizeHitTracks = new WeakMap<object, GridEditorTrackSpec>();
  readonly #indicator: LeaferElement;
  readonly #layer: LeaferGroup;
  readonly #leafer: LeaferModule;
  readonly #onReorder: GridTrackReorderHandler;
  readonly #onResize: GridTrackResizeHandler;
  #plan: GridEditorOverlayPlan | null = null;
  readonly #presentationRoot: LeaferGroup;
  #renderScale = 1;
  #scaleX = 1;
  #scaleY = 1;
  #revision: number | null = null;
  readonly #tracks = new Map<string, GridTrackElements>();
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    layerIndex: number;
    leafer: LeaferModule;
    onReorder: GridTrackReorderHandler;
    onResize: GridTrackResizeHandler;
    presentationRoot: LeaferGroup;
    viewportRoot: LeaferGroup;
  }) {
    this.#leafer = options.leafer;
    this.#onReorder = options.onReorder;
    this.#onResize = options.onResize;
    this.#presentationRoot = options.presentationRoot;
    this.#viewportRoot = options.viewportRoot;
    this.#layer = new this.#leafer.Group({
      editable: false,
      hitChildren: true,
      visible: false,
    });
    this.#guide = new this.#leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: GRID_GUIDE_COLOR,
    });
    this.#indicator = new this.#leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: GRID_COLOR,
      strokeCap: "round",
      visible: false,
    });
    this.#layer.add(this.#guide);
    this.#layer.add(this.#indicator);
    this.#presentationRoot.addAt(this.#layer, options.layerIndex);
  }

  get active(): boolean {
    return this.#plan !== null;
  }

  get dragging(): boolean {
    return this.#drag !== null;
  }

  cancelDrag(): boolean {
    if (!this.#drag) return false;
    this.#drag = null;
    this.#indicator.visible = false;
    this.#syncTrackAppearance();
    this.syncViewport();
    return true;
  }

  dispose(): void {
    this.cancelDrag();
    this.#destroyTracks();
    this.#guide.remove();
    this.#guide.destroy();
    this.#indicator.remove();
    this.#indicator.destroy();
    this.#layer.remove();
    this.#layer.destroy();
  }

  pointerDown(event: GridEditorPointerEvent): boolean {
    const target =
      event.target && typeof event.target === "object"
        ? event.target
        : undefined;
    const resizeTrack = target ? this.#resizeHitTracks.get(target) : undefined;
    const reorderTrack = target
      ? this.#reorderHitTracks.get(target)
      : undefined;
    if (
      (!resizeTrack && !reorderTrack) ||
      !this.#plan ||
      event.right ||
      event.middle
    )
      return false;
    if (resizeTrack) {
      const point = event.getInnerPoint(this.#layer);
      const coordinate = resizeTrack.axis === "rows" ? point.y : point.x;
      this.#drag = {
        axis: resizeTrack.axis,
        documentId: this.#documentId!,
        frameId: this.#plan.frameId,
        index: resizeTrack.index,
        initialPointerCoordinate: coordinate,
        kind: "resize",
        moved: false,
        revision: this.#revision!,
        start: resizeTrack.start,
        value: Math.round(resizeTrack.resolvedSize),
      };
      this.#indicator.visible = true;
      this.#syncTrackAppearance();
      this.syncViewport();
      return true;
    }
    const track = reorderTrack!;
    this.#drag = {
      axis: track.axis,
      documentId: this.#documentId!,
      frameId: this.#plan.frameId,
      fromIndex: track.index,
      insertionIndex: track.index,
      kind: "reorder",
      revision: this.#revision!,
    };
    this.#indicator.visible = false;
    this.#syncTrackAppearance();
    return true;
  }

  pointerMove(event: GridEditorPointerEvent): boolean {
    const drag = this.#drag;
    const plan = this.#plan;
    if (!drag || !plan) return false;
    if (event.isCancel) {
      this.cancelDrag();
      return true;
    }
    const point = event.getInnerPoint(this.#layer);
    if (drag.kind === "resize") {
      const coordinate = drag.axis === "rows" ? point.y : point.x;
      if (
        Math.abs(coordinate - drag.initialPointerCoordinate) *
          (drag.axis === "rows" ? this.#scaleY : this.#scaleX) >=
        RESIZE_DRAG_THRESHOLD
      ) {
        drag.moved = true;
      }
      drag.value = Math.min(
        MAX_GRID_TRACK_VALUE,
        Math.max(0, Math.round(coordinate - drag.start)),
      );
      this.#syncTrackAppearance();
      this.syncViewport();
      return true;
    }
    drag.insertionIndex = nearestGridInsertionIndex(
      plan,
      drag.axis,
      drag.axis === "rows" ? point.y : point.x,
    );
    this.#syncDragIndicator();
    return true;
  }

  pointerUp(event: GridEditorPointerEvent): boolean {
    const drag = this.#drag;
    if (!drag) return false;
    if (!event.isCancel) this.pointerMove(event);
    const current = this.#drag;
    this.cancelDrag();
    if (current?.kind === "resize") {
      if (event.isCancel || !current.moved) return true;
      this.#onResize({
        axis: current.axis,
        expectedRevision: current.revision,
        frameId: current.frameId,
        index: current.index,
        value: current.value,
      });
      return true;
    }
    if (
      event.isCancel ||
      !current ||
      !gridTrackReorderChangesOrder(current.fromIndex, current.insertionIndex)
    ) {
      return true;
    }
    this.#onReorder({
      axis: current.axis,
      frameId: current.frameId,
      fromIndices: [current.fromIndex],
      insertionIndex: current.insertionIndex,
    });
    return true;
  }

  sync(input: { document: DesignDocument; frameId?: string }): void {
    if (
      this.#drag &&
      (this.#drag.documentId !== input.document.documentId ||
        this.#drag.revision !== input.document.revision ||
        this.#drag.frameId !== input.frameId)
    ) {
      this.cancelDrag();
    }
    this.#documentId = input.document.documentId;
    this.#revision = input.document.revision;
    const plan = createGridEditorOverlayPlan(input.document, input.frameId);
    this.#plan = plan;
    if (!plan) {
      this.#fingerprint = null;
      this.#destroyTracks();
      this.#guide.visible = false;
      this.#indicator.visible = false;
      this.#layer.visible = false;
      return;
    }
    if (plan.fingerprint !== this.#fingerprint) {
      this.#reconcileTracks(plan);
      this.#fingerprint = plan.fingerprint;
    }
    this.syncViewport();
  }

  syncViewport(): void {
    const plan = this.#plan;
    if (!plan) return;
    const desired = multiplyAffine(
      this.#viewportRoot.localTransform,
      transformToAffine(plan.transform),
    );
    const relative = matrixRelativeToParent(
      this.#presentationRoot.localTransform,
      desired,
      MATRIX_EPSILON,
    );
    if (!relative) {
      this.#layer.visible = false;
      return;
    }
    setTransform(this.#layer, relative);
    this.#layer.visible = true;
    const scaleX = Math.max(MATRIX_EPSILON, Math.hypot(desired.a, desired.b));
    const scaleY = Math.max(MATRIX_EPSILON, Math.hypot(desired.c, desired.d));
    this.#scaleX = scaleX;
    this.#scaleY = scaleY;
    this.#renderScale = Math.max(scaleX, scaleY);
    this.#guide.set({
      path: gridGuidePath(plan),
      strokeWidth: 1 / Math.max(scaleX, scaleY),
      visible: true,
    });
    for (const spec of [...plan.columns, ...plan.rows]) {
      const elements = this.#tracks.get(spec.id);
      if (!elements) continue;
      const label = this.#displayLabel(spec);
      const pillWidth = Math.max(PILL_MIN_WIDTH, label.length * 7 + 10);
      const geometry =
        spec.axis === "columns"
          ? {
              x: spec.center - pillWidth / scaleX / 2,
              y: -(PILL_HEIGHT + PILL_OFFSET) / scaleY,
              width: pillWidth / scaleX,
              height: PILL_HEIGHT / scaleY,
            }
          : {
              x: -(pillWidth + PILL_OFFSET) / scaleX,
              y: spec.center - PILL_HEIGHT / scaleY / 2,
              width: pillWidth / scaleX,
              height: PILL_HEIGHT / scaleY,
            };
      elements.pill.set({ ...geometry, cornerRadius: 4 / scaleX });
      elements.reorderHit.set({
        x: geometry.x - HIT_PADDING / scaleX,
        y: geometry.y - HIT_PADDING / scaleY,
        width: geometry.width + (HIT_PADDING * 2) / scaleX,
        height: geometry.height + (HIT_PADDING * 2) / scaleY,
      });
      elements.label.set({
        x: geometry.x,
        y: geometry.y + 2 / scaleY,
        width: geometry.width,
        height: geometry.height,
        fontSize: 10 / scaleY,
        lineHeight: 14 / scaleY,
        text: label,
      });
      elements.resizeHit.set(
        spec.axis === "columns"
          ? {
              cursor: "col-resize",
              height: plan.frameSize.height,
              width: RESIZE_HIT_SIZE / scaleX,
              x: spec.end - RESIZE_HIT_SIZE / scaleX / 2,
              y: 0,
            }
          : {
              cursor: "row-resize",
              height: RESIZE_HIT_SIZE / scaleY,
              width: plan.frameSize.width,
              x: 0,
              y: spec.end - RESIZE_HIT_SIZE / scaleY / 2,
            },
      );
    }
    this.#syncDragIndicator();
  }

  #createTrack(spec: GridEditorTrackSpec): GridTrackElements {
    const reorderHit = new this.#leafer.Rect({
      cursor: "grab",
      editable: false,
      fill: GRID_HIT_FILL,
      hittable: true,
      id: `__opendesign_grid_track_hit__:${spec.id}`,
    }) as LeaferElement;
    const resizeHit = new this.#leafer.Rect({
      cursor: spec.axis === "columns" ? "col-resize" : "row-resize",
      editable: false,
      fill: GRID_HIT_FILL,
      hittable: true,
      id: `__opendesign_grid_track_resize_hit__:${spec.id}`,
    }) as LeaferElement;
    const pill = new this.#leafer.Rect({
      editable: false,
      fill: GRID_COLOR,
      hittable: false,
    }) as LeaferElement;
    const label = new this.#leafer.Text({
      editable: false,
      fill: "#ffffff",
      fontFamily: "Inter, sans-serif",
      fontWeight: 650,
      hittable: false,
      text: spec.label,
      textAlign: "center",
      verticalAlign: "middle",
    }) as LeaferElement;
    this.#reorderHitTracks.set(reorderHit, spec);
    this.#resizeHitTracks.set(resizeHit, spec);
    this.#layer.add(pill);
    this.#layer.add(label);
    this.#layer.add(reorderHit);
    this.#layer.add(resizeHit);
    return { label, pill, reorderHit, resizeHit };
  }

  #destroyTracks(): void {
    for (const elements of this.#tracks.values()) {
      for (const element of [
        elements.reorderHit,
        elements.resizeHit,
        elements.label,
        elements.pill,
      ]) {
        element.remove();
        element.destroy();
      }
    }
    this.#tracks.clear();
  }

  #reconcileTracks(plan: GridEditorOverlayPlan): void {
    const expected = new Set<string>();
    for (const spec of [...plan.columns, ...plan.rows]) {
      expected.add(spec.id);
      const existing = this.#tracks.get(spec.id);
      if (existing) {
        existing.label.set({ text: spec.label });
        this.#reorderHitTracks.set(existing.reorderHit, spec);
        this.#resizeHitTracks.set(existing.resizeHit, spec);
      } else {
        this.#tracks.set(spec.id, this.#createTrack(spec));
      }
    }
    for (const [id, elements] of this.#tracks) {
      if (expected.has(id)) continue;
      for (const element of [
        elements.reorderHit,
        elements.resizeHit,
        elements.label,
        elements.pill,
      ]) {
        element.remove();
        element.destroy();
      }
      this.#tracks.delete(id);
    }
    this.#syncTrackAppearance();
  }

  #syncDragIndicator(): void {
    const drag = this.#drag;
    const plan = this.#plan;
    if (!drag || !plan) {
      this.#indicator.visible = false;
      return;
    }
    if (drag.kind === "resize") {
      const coordinate = drag.start + drag.value;
      this.#indicator.set({
        path:
          drag.axis === "rows"
            ? `M 0 ${coordinate} L ${plan.frameSize.width} ${coordinate}`
            : `M ${coordinate} 0 L ${coordinate} ${plan.frameSize.height}`,
        strokeWidth: 2 / this.#renderScale,
        visible: true,
      });
      return;
    }
    const insertion = (
      drag.axis === "rows" ? plan.rowInsertions : plan.columnInsertions
    ).find((candidate) => candidate.index === drag.insertionIndex);
    if (
      !insertion ||
      !gridTrackReorderChangesOrder(drag.fromIndex, drag.insertionIndex)
    ) {
      this.#indicator.visible = false;
      return;
    }
    this.#indicator.set({
      path:
        drag.axis === "rows"
          ? `M 0 ${insertion.coordinate} L ${plan.frameSize.width} ${insertion.coordinate}`
          : `M ${insertion.coordinate} 0 L ${insertion.coordinate} ${plan.frameSize.height}`,
      strokeWidth: 2 / this.#renderScale,
      visible: true,
    });
  }

  #syncTrackAppearance(): void {
    const drag = this.#drag;
    const activeId = drag
      ? `${drag.frameId}:${drag.axis}:${drag.kind === "reorder" ? drag.fromIndex : drag.index}`
      : null;
    for (const [id, elements] of this.#tracks) {
      const active = id === activeId;
      elements.reorderHit.set({
        cursor: active && drag?.kind === "reorder" ? "grabbing" : "grab",
      });
      elements.pill.set({ opacity: active ? 0.72 : 1 });
      elements.label.set({ opacity: active ? 0.9 : 1 });
    }
  }

  #displayLabel(spec: GridEditorTrackSpec): string {
    const drag = this.#drag;
    return drag?.kind === "resize" &&
      drag.frameId === this.#plan?.frameId &&
      drag.axis === spec.axis &&
      drag.index === spec.index
      ? `${drag.value}px`
      : spec.label;
  }
}

function gridGuidePath(plan: GridEditorOverlayPlan): string {
  const parts: string[] = [];
  for (const track of plan.columns) {
    parts.push(
      `M ${track.start} 0 L ${track.start} ${plan.frameSize.height}`,
      `M ${track.end} 0 L ${track.end} ${plan.frameSize.height}`,
    );
  }
  for (const track of plan.rows) {
    parts.push(
      `M 0 ${track.start} L ${plan.frameSize.width} ${track.start}`,
      `M 0 ${track.end} L ${plan.frameSize.width} ${track.end}`,
    );
  }
  return parts.join(" ");
}

function multiplyAffine(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function setTransform(element: LeaferElement, transform: AffineMatrix): void {
  if (!sameAffineMatrix(element.localTransform, transform, MATRIX_EPSILON)) {
    element.setTransform(transform);
  }
}
