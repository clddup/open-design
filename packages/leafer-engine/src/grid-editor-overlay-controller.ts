import {
  MAX_GRID_TRACK_VALUE,
  type DesignDocument,
  type GridChildPlacement,
  type LayoutSizing,
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
  gridAreaForPlacement,
  gridChildSpanTargetFromBounds,
  gridTrackSelectionReorderChangesOrder,
  nearestGridInsertionIndex,
  nearestGridCell,
  type GridEditorAxis,
  type GridEditorCellSpec,
  type GridEditorOverlayPlan,
  type GridEditorTrackSpec,
} from "./grid-editor-overlay.js";
import { eventClientPoint, type LeaferEventLike } from "./pointer-event.js";
import type { LeaferGridTrackInputRequest } from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

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
  fromIndices: readonly number[];
  insertionIndex: number;
  kind: "reorder";
  moved: boolean;
  openInputOnClick: boolean;
  revision: number;
  startClientPoint: { x: number; y: number };
}

interface GridTrackSelection {
  anchorIndex: number;
  axis: GridEditorAxis;
  frameId: string;
  indices: readonly number[];
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

type GridTrackDeleteHandler = (request: {
  axis: GridEditorAxis;
  expectedRevision: number;
  frameId: string;
  indices: readonly number[];
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
const GRID_CHILD_DROP_FILL = "rgba(101, 116, 255, 0.14)";
const GRID_HIT_FILL = "rgba(0, 0, 0, 0.001)";
const PILL_HEIGHT = 18;
const PILL_MIN_WIDTH = 22;
const PILL_OFFSET = 7;
const HIT_PADDING = 5;
const RESIZE_HIT_SIZE = 8;
const RESIZE_DRAG_THRESHOLD = 3;

export class GridEditorOverlayController {
  readonly #childDrop: LeaferElement;
  #childDropCell: GridEditorCellSpec | null = null;
  #documentId: string | null = null;
  #drag: GridDragSession | null = null;
  #fingerprint: string | null = null;
  readonly #guide: LeaferElement;
  readonly #reorderHitTracks = new WeakMap<object, GridEditorTrackSpec>();
  readonly #resizeHitTracks = new WeakMap<object, GridEditorTrackSpec>();
  readonly #indicator: LeaferElement;
  readonly #layer: LeaferGroup;
  readonly #leafer: LeaferModule;
  readonly #onDelete: GridTrackDeleteHandler;
  readonly #onReorder: GridTrackReorderHandler;
  readonly #onResize: GridTrackResizeHandler;
  readonly #onInputRequest: (request: LeaferGridTrackInputRequest) => void;
  #plan: GridEditorOverlayPlan | null = null;
  readonly #presentationRoot: LeaferGroup;
  #renderScale = 1;
  #scaleX = 1;
  #scaleY = 1;
  #revision: number | null = null;
  #selection: GridTrackSelection | null = null;
  readonly #tracks = new Map<string, GridTrackElements>();
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    layerIndex: number;
    leafer: LeaferModule;
    onDelete: GridTrackDeleteHandler;
    onInputRequest: (request: LeaferGridTrackInputRequest) => void;
    onReorder: GridTrackReorderHandler;
    onResize: GridTrackResizeHandler;
    presentationRoot: LeaferGroup;
    viewportRoot: LeaferGroup;
  }) {
    this.#leafer = options.leafer;
    this.#onDelete = options.onDelete;
    this.#onInputRequest = options.onInputRequest;
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
    this.#childDrop = new this.#leafer.Rect({
      editable: false,
      fill: GRID_CHILD_DROP_FILL,
      hittable: false,
      id: "__opendesign_grid_child_drop__",
      stroke: GRID_COLOR,
      strokeAlign: "inside",
      visible: false,
    });
    this.#layer.add(this.#guide);
    this.#layer.add(this.#childDrop);
    this.#layer.add(this.#indicator);
    this.#presentationRoot.addAt(this.#layer, options.layerIndex);
  }

  get active(): boolean {
    return this.#plan !== null;
  }

  get dragging(): boolean {
    return this.#drag !== null;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (
      (event.code !== "Delete" && event.code !== "Backspace") ||
      this.#drag ||
      !this.#selection ||
      !this.#plan ||
      this.#revision === null ||
      this.#selection.frameId !== this.#plan.frameId ||
      this.#selection.revision !== this.#revision
    ) {
      return false;
    }
    this.#onDelete({
      axis: this.#selection.axis,
      expectedRevision: this.#revision,
      frameId: this.#selection.frameId,
      indices: this.#selection.indices,
    });
    return true;
  }

  cancelDrag(): boolean {
    if (!this.#drag) return false;
    this.#drag = null;
    this.#indicator.visible = false;
    this.#syncTrackAppearance();
    this.syncViewport();
    return true;
  }

  previewChildDrop(
    frameId: string,
    point: { x: number; y: number } | null,
  ): GridEditorCellSpec | null {
    if (!this.#plan || this.#plan.frameId !== frameId) return null;
    const cell = point ? nearestGridCell(this.#plan, point) : null;
    this.#childDropCell = cell;
    this.#syncChildDropAppearance();
    return cell;
  }

  childCellAt(
    frameId: string,
    point: { x: number; y: number },
  ): GridEditorCellSpec | null {
    if (!this.#plan || this.#plan.frameId !== frameId) return null;
    return nearestGridCell(this.#plan, point);
  }

  previewChildPlacement(
    frameId: string,
    placement: {
      row: number;
      column: number;
      rowSpan: number;
      columnSpan: number;
    } | null,
  ): boolean {
    if (!this.#plan || this.#plan.frameId !== frameId) return false;
    this.#childDropCell = placement
      ? gridAreaForPlacement(this.#plan, placement)
      : null;
    this.#syncChildDropAppearance();
    return this.#childDropCell !== null;
  }

  previewChildSpan(
    frameId: string,
    placement: GridChildPlacement,
    sizing: LayoutSizing,
    before: { x: number; y: number; width: number; height: number },
    next: { x: number; y: number; width: number; height: number },
  ): {
    row: number;
    column: number;
    rowSpan: number;
    columnSpan: number;
  } | null {
    if (!this.#plan || this.#plan.frameId !== frameId) return null;
    const target = gridChildSpanTargetFromBounds(
      this.#plan,
      placement,
      sizing,
      before,
      next,
    );
    if (!target) {
      this.previewChildPlacement(frameId, null);
      return null;
    }
    if (!this.previewChildPlacement(frameId, target)) return null;
    return target;
  }

  dispose(): void {
    this.cancelDrag();
    this.#destroyTracks();
    this.#guide.remove();
    this.#guide.destroy();
    this.#childDrop.remove();
    this.#childDrop.destroy();
    this.#indicator.remove();
    this.#indicator.destroy();
    this.#layer.remove();
    this.#layer.destroy();
  }

  pointerDown(event: LeaferEventLike): boolean {
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
      this.#selection = {
        anchorIndex: resizeTrack.index,
        axis: resizeTrack.axis,
        frameId: this.#plan.frameId,
        indices: [resizeTrack.index],
        revision: this.#revision!,
      };
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
    const modifiedSelection = Boolean(
      event.metaKey || event.ctrlKey || event.shiftKey,
    );
    const alreadySelected = Boolean(
      this.#selection?.frameId === this.#plan.frameId &&
      this.#selection.axis === track.axis &&
      this.#selection.indices.includes(track.index),
    );
    const fromIndices = this.#selectTrack(track, event);
    this.#drag = {
      axis: track.axis,
      documentId: this.#documentId!,
      frameId: this.#plan.frameId,
      fromIndex: track.index,
      fromIndices,
      insertionIndex: track.index,
      kind: "reorder",
      moved: false,
      openInputOnClick: !modifiedSelection && alreadySelected,
      revision: this.#revision!,
      startClientPoint: eventClientPoint(event),
    };
    this.#indicator.visible = false;
    this.#syncTrackAppearance();
    return true;
  }

  pointerMove(event: LeaferEventLike): boolean {
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
    const clientPoint = eventClientPoint(event);
    if (
      Math.hypot(
        clientPoint.x - drag.startClientPoint.x,
        clientPoint.y - drag.startClientPoint.y,
      ) >= RESIZE_DRAG_THRESHOLD
    ) {
      drag.moved = true;
    }
    drag.insertionIndex = nearestGridInsertionIndex(
      plan,
      drag.axis,
      drag.axis === "rows" ? point.y : point.x,
    );
    this.#syncDragIndicator();
    return true;
  }

  pointerUp(event: LeaferEventLike): boolean {
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
      current &&
      !event.isCancel &&
      !current.moved &&
      current.openInputOnClick
    ) {
      const tracks = this.#selectedTrackSpecs(
        current.axis,
        current.fromIndices,
      ).map((spec) => ({
        index: spec.index,
        resolvedSize: spec.resolvedSize,
        track: spec.authoredTrack,
      }));
      if (tracks.length > 0) {
        this.#onInputRequest({
          axis: current.axis,
          clientPoint: eventClientPoint(event),
          expectedRevision: current.revision,
          frameId: current.frameId,
          tracks,
        });
      }
      return true;
    }
    const trackCount =
      current?.axis === "rows"
        ? (this.#plan?.rows.length ?? 0)
        : (this.#plan?.columns.length ?? 0);
    if (
      event.isCancel ||
      !current ||
      !gridTrackSelectionReorderChangesOrder(
        current.fromIndices,
        current.insertionIndex,
        trackCount,
      )
    ) {
      return true;
    }
    this.#onReorder({
      axis: current.axis,
      frameId: current.frameId,
      fromIndices: current.fromIndices,
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
    if (
      this.#childDropCell &&
      (this.#documentId !== input.document.documentId ||
        this.#revision !== input.document.revision ||
        this.#plan?.frameId !== input.frameId)
    ) {
      this.#childDropCell = null;
    }
    if (
      this.#selection &&
      (this.#documentId !== input.document.documentId ||
        this.#selection.frameId !== input.frameId ||
        this.#selection.revision !== input.document.revision)
    ) {
      this.#selection = null;
    }
    this.#documentId = input.document.documentId;
    this.#revision = input.document.revision;
    const plan = createGridEditorOverlayPlan(input.document, input.frameId);
    this.#plan = plan;
    if (!plan) {
      this.#fingerprint = null;
      this.#selection = null;
      this.#destroyTracks();
      this.#guide.visible = false;
      this.#indicator.visible = false;
      this.#childDrop.visible = false;
      this.#layer.visible = false;
      return;
    }
    this.#reconcileSelection(plan);
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
              cursor: gridResizeCursor(spec.axis, desired),
              height: plan.frameSize.height,
              width: RESIZE_HIT_SIZE / scaleX,
              x: spec.end - RESIZE_HIT_SIZE / scaleX / 2,
              y: 0,
            }
          : {
              cursor: gridResizeCursor(spec.axis, desired),
              height: RESIZE_HIT_SIZE / scaleY,
              width: plan.frameSize.width,
              x: 0,
              y: spec.end - RESIZE_HIT_SIZE / scaleY / 2,
            },
      );
    }
    this.#syncTrackAppearance();
    this.#syncDragIndicator();
    this.#syncChildDropAppearance();
  }

  #syncChildDropAppearance(): void {
    const cell = this.#childDropCell;
    if (!cell || !this.#plan) {
      this.#childDrop.visible = false;
      return;
    }
    this.#childDrop.set({
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      strokeWidth: 2 / this.#renderScale,
      visible: true,
    });
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
      id: `__opendesign_grid_track_pill__:${spec.id}`,
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
      if (!spec.editable) continue;
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

  #selectTrack(
    track: GridEditorTrackSpec,
    event: LeaferEventLike,
  ): readonly number[] {
    const frameId = this.#plan?.frameId;
    if (!frameId) return [track.index];
    const selection = this.#selection;
    const current =
      selection?.frameId === frameId && selection.axis === track.axis
        ? selection
        : null;
    let anchorIndex = current?.anchorIndex ?? track.index;
    let indices: number[];
    if (event.shiftKey) {
      const start = Math.min(anchorIndex, track.index);
      const end = Math.max(anchorIndex, track.index);
      indices = Array.from(
        { length: end - start + 1 },
        (_, offset) => start + offset,
      );
    } else if (event.metaKey || event.ctrlKey) {
      const selected = new Set(current?.indices ?? []);
      if (selected.has(track.index)) selected.delete(track.index);
      else selected.add(track.index);
      if (selected.size === 0) selected.add(track.index);
      indices = [...selected].sort((left, right) => left - right);
      anchorIndex = track.index;
    } else if (current?.indices.includes(track.index)) {
      indices = [...current.indices];
    } else {
      indices = [track.index];
      anchorIndex = track.index;
    }
    this.#selection = {
      anchorIndex,
      axis: track.axis,
      frameId,
      indices,
      revision: this.#revision!,
    };
    return indices;
  }

  #selectedTrackSpecs(
    axis: GridEditorAxis,
    indices: readonly number[],
  ): GridEditorTrackSpec[] {
    const specs = axis === "rows" ? this.#plan?.rows : this.#plan?.columns;
    if (!specs) return [];
    const selected = new Set(indices);
    return specs.filter((spec) => selected.has(spec.index));
  }

  #reconcileSelection(plan: GridEditorOverlayPlan): void {
    const selection = this.#selection;
    if (!selection || selection.frameId !== plan.frameId) return;
    const trackCount =
      selection.axis === "rows" ? plan.rows.length : plan.columns.length;
    const indices = selection.indices.filter((index) => index < trackCount);
    if (indices.length === 0) {
      this.#selection = null;
      return;
    }
    this.#selection = {
      ...selection,
      anchorIndex: Math.min(selection.anchorIndex, trackCount - 1),
      indices,
    };
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
    const trackCount =
      drag.axis === "rows" ? plan.rows.length : plan.columns.length;
    if (
      !insertion ||
      !gridTrackSelectionReorderChangesOrder(
        drag.fromIndices,
        drag.insertionIndex,
        trackCount,
      )
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
    const selection =
      this.#selection?.frameId === this.#plan?.frameId ? this.#selection : null;
    const selectedIds = new Set(
      selection
        ? selection.indices.map(
            (index) => `${selection.frameId}:${selection.axis}:${index}`,
          )
        : [],
    );
    for (const [id, elements] of this.#tracks) {
      const active = id === activeId;
      const selected = selectedIds.has(id);
      elements.reorderHit.set({
        cursor: active && drag?.kind === "reorder" ? "grabbing" : "grab",
      });
      elements.pill.set({
        opacity: active ? 0.82 : selected ? 1 : 0.68,
        stroke: "#ffffff",
        strokeWidth: selected ? 1 / this.#renderScale : 0,
      });
      elements.label.set({ opacity: active ? 0.9 : selected ? 1 : 0.82 });
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

function gridResizeCursor(
  axis: GridEditorAxis,
  transform: AffineMatrix,
): "col-resize" | "row-resize" | "nesw-resize" | "nwse-resize" {
  const x = axis === "columns" ? transform.a : transform.c;
  const y = axis === "columns" ? transform.b : transform.d;
  const angle = ((Math.atan2(y, x) * 180) / Math.PI + 180) % 180;
  if (angle < 22.5 || angle >= 157.5) return "col-resize";
  if (angle < 67.5) return "nwse-resize";
  if (angle < 112.5) return "row-resize";
  return "nesw-resize";
}

function setTransform(element: LeaferElement, transform: AffineMatrix): void {
  if (!sameAffineMatrix(element.localTransform, transform, MATRIX_EPSILON)) {
    element.setTransform(transform);
  }
}
