import type { DesignDocument } from "@opendesign/design-contracts";
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
  hit: LeaferElement;
  label: LeaferElement;
  pill: LeaferElement;
}

interface GridDragSession {
  axis: GridEditorAxis;
  documentId: string;
  frameId: string;
  fromIndex: number;
  insertionIndex: number;
  revision: number;
}

type GridTrackReorderHandler = (request: {
  axis: GridEditorAxis;
  frameId: string;
  fromIndices: readonly number[];
  insertionIndex: number;
}) => boolean;

const MATRIX_EPSILON = 0.000_001;
const GRID_COLOR = "#6574ff";
const GRID_GUIDE_COLOR = "rgba(101, 116, 255, 0.5)";
const GRID_HIT_FILL = "rgba(0, 0, 0, 0.001)";
const PILL_HEIGHT = 18;
const PILL_MIN_WIDTH = 22;
const PILL_OFFSET = 7;
const HIT_PADDING = 5;

export class GridEditorOverlayController {
  #documentId: string | null = null;
  #drag: GridDragSession | null = null;
  #fingerprint: string | null = null;
  readonly #guide: LeaferElement;
  readonly #hitTracks = new WeakMap<object, GridEditorTrackSpec>();
  readonly #indicator: LeaferElement;
  readonly #layer: LeaferGroup;
  readonly #leafer: LeaferModule;
  readonly #onReorder: GridTrackReorderHandler;
  #plan: GridEditorOverlayPlan | null = null;
  readonly #presentationRoot: LeaferGroup;
  #renderScale = 1;
  #revision: number | null = null;
  readonly #tracks = new Map<string, GridTrackElements>();
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    layerIndex: number;
    leafer: LeaferModule;
    onReorder: GridTrackReorderHandler;
    presentationRoot: LeaferGroup;
    viewportRoot: LeaferGroup;
  }) {
    this.#leafer = options.leafer;
    this.#onReorder = options.onReorder;
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
    const track =
      event.target && typeof event.target === "object"
        ? this.#hitTracks.get(event.target)
        : undefined;
    if (!track || !this.#plan || event.right || event.middle) return false;
    this.#drag = {
      axis: track.axis,
      documentId: this.#documentId!,
      frameId: this.#plan.frameId,
      fromIndex: track.index,
      insertionIndex: track.index,
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
    this.#renderScale = Math.max(scaleX, scaleY);
    this.#guide.set({
      path: gridGuidePath(plan),
      strokeWidth: 1 / Math.max(scaleX, scaleY),
      visible: true,
    });
    for (const spec of [...plan.columns, ...plan.rows]) {
      const elements = this.#tracks.get(spec.id);
      if (!elements) continue;
      const pillWidth = Math.max(PILL_MIN_WIDTH, spec.label.length * 7 + 10);
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
      elements.hit.set({
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
      });
    }
    this.#syncDragIndicator();
  }

  #createTrack(spec: GridEditorTrackSpec): GridTrackElements {
    const hit = new this.#leafer.Rect({
      cursor: "grab",
      editable: false,
      fill: GRID_HIT_FILL,
      hittable: true,
      id: `__opendesign_grid_track_hit__:${spec.id}`,
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
    this.#hitTracks.set(hit, spec);
    this.#layer.add(pill);
    this.#layer.add(label);
    this.#layer.add(hit);
    return { hit, label, pill };
  }

  #destroyTracks(): void {
    for (const elements of this.#tracks.values()) {
      for (const element of [elements.hit, elements.label, elements.pill]) {
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
        this.#hitTracks.set(existing.hit, spec);
      } else {
        this.#tracks.set(spec.id, this.#createTrack(spec));
      }
    }
    for (const [id, elements] of this.#tracks) {
      if (expected.has(id)) continue;
      for (const element of [elements.hit, elements.label, elements.pill]) {
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
    for (const [id, elements] of this.#tracks) {
      const active =
        drag && id === `${drag.frameId}:${drag.axis}:${drag.fromIndex}`;
      elements.hit.set({ cursor: active ? "grabbing" : "grab" });
      elements.pill.set({ opacity: active ? 0.72 : 1 });
      elements.label.set({ opacity: active ? 0.82 : 1 });
    }
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
