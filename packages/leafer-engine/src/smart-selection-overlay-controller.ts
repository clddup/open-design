import type { DesignDocument, Transform } from "@opendesign/design-contracts";
import {
  reorderSmartSelection,
  setSmartSelectionSpacing,
} from "@opendesign/geometry-service";
import type * as LeaferEditorModule from "leafer-editor";
import { matrixRelativeToParent } from "./affine.js";
import { eventClientPoint, type LeaferEventLike } from "./pointer-event.js";
import {
  createSmartSelectionOverlayPlan,
  documentDeltaToNodeParent,
  type SmartSelectionGapHandleSpec,
  type SmartSelectionOverlayPlan,
} from "./smart-selection-overlay.js";
import type {
  LeaferSmartSelectionReorderRequest,
  LeaferSmartSelectionSpacingRequest,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

interface SmartGapElements {
  hit: LeaferElement;
  visual: LeaferElement;
}

interface SmartRingElements {
  hit: LeaferElement;
  visual: LeaferElement;
}

interface SmartSelectionDragSession {
  axis: "horizontal" | "vertical";
  before: ReadonlyMap<string, Transform>;
  documentId: string;
  expectedRevision: number;
  handleId: string;
  moved: boolean;
  nodeIds: readonly string[];
  pageId: string;
  spacing: number;
  startClientPoint: { x: number; y: number };
  startCoordinate: number;
  startSpacing: number;
}

interface SmartSelectionReorderDragSession {
  axis: "horizontal" | "vertical";
  before: ReadonlyMap<string, Transform>;
  documentId: string;
  expectedRevision: number;
  insertionIndex: number;
  moved: boolean;
  movedNodeIds: readonly string[];
  nodeIds: readonly string[];
  pageId: string;
  startClientPoint: { x: number; y: number };
  valid: boolean;
}

const MATRIX_EPSILON = 0.000_001;
const SMART_COLOR = "#f24e8a";
const SMART_INSERTION_COLOR = "#0d99ff";
const SMART_IDLE_COLOR = "rgba(242, 78, 138, 0.82)";
const SMART_HIT_FILL = "rgba(0, 0, 0, 0.001)";
const HANDLE_LENGTH = 22;
const HANDLE_THICKNESS = 2;
const HIT_CROSS = 14;
const HIT_LENGTH = 34;
const RING_SIZE = 8;
const RING_HIT_SIZE = 20;
const PILL_HEIGHT = 20;
const PILL_OFFSET = 10;
const BIG_NUDGE = 10;
const MAX_SPACING = 1_000_000;

export class SmartSelectionOverlayController {
  #document: DesignDocument | null = null;
  #drag: SmartSelectionDragSession | null = null;
  readonly #element: (nodeId: string) => LeaferElement | undefined;
  readonly #finishNodePresentation: (nodeId: string) => void;
  readonly #gaps = new Map<string, SmartGapElements>();
  readonly #hitHandleIds = new WeakMap<object, string>();
  readonly #hitRingNodeIds = new WeakMap<object, string>();
  #hovered = false;
  readonly #layer: LeaferGroup;
  readonly #leafer: LeaferModule;
  readonly #onCommit: (request: LeaferSmartSelectionSpacingRequest) => boolean;
  readonly #onReorder: (request: LeaferSmartSelectionReorderRequest) => boolean;
  readonly #pill: LeaferElement;
  readonly #pillLabel: LeaferElement;
  #plan: SmartSelectionOverlayPlan | null = null;
  #previewPoint: { x: number; y: number } | null = null;
  #previewSpacing: number | null = null;
  readonly #presentationRoot: LeaferGroup;
  readonly #restoreProjection: () => void;
  readonly #rings = new Map<string, SmartRingElements>();
  readonly #markedNodeIds = new Set<string>();
  readonly #insertionIndicator: LeaferElement;
  #reorderDrag: SmartSelectionReorderDragSession | null = null;
  readonly #specs = new Map<string, SmartSelectionGapHandleSpec>();
  #syncFingerprint: string | null = null;
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    element: (nodeId: string) => LeaferElement | undefined;
    finishNodePresentation: (nodeId: string) => void;
    layerIndex: number;
    leafer: LeaferModule;
    onCommit: (request: LeaferSmartSelectionSpacingRequest) => boolean;
    onReorder: (request: LeaferSmartSelectionReorderRequest) => boolean;
    presentationRoot: LeaferGroup;
    restoreProjection: () => void;
    viewportRoot: LeaferGroup;
  }) {
    this.#element = options.element;
    this.#finishNodePresentation = options.finishNodePresentation;
    this.#leafer = options.leafer;
    this.#onCommit = options.onCommit;
    this.#onReorder = options.onReorder;
    this.#presentationRoot = options.presentationRoot;
    this.#restoreProjection = options.restoreProjection;
    this.#viewportRoot = options.viewportRoot;
    this.#layer = new this.#leafer.Group({
      editable: false,
      hitChildren: true,
      visible: false,
    });
    this.#pill = new this.#leafer.Rect({
      cornerRadius: 4,
      editable: false,
      fill: SMART_COLOR,
      hittable: false,
      visible: false,
    });
    this.#pillLabel = new this.#leafer.Text({
      editable: false,
      fill: "#ffffff",
      fontFamily: "Inter, sans-serif",
      fontWeight: 650,
      hittable: false,
      textAlign: "center",
      verticalAlign: "middle",
      visible: false,
    });
    this.#insertionIndicator = new this.#leafer.Rect({
      cornerRadius: 1,
      editable: false,
      fill: SMART_INSERTION_COLOR,
      hittable: false,
      id: "__opendesign_smart_selection_insertion__",
      visible: false,
    });
    this.#layer.add(this.#insertionIndicator);
    this.#layer.add(this.#pill);
    this.#layer.add(this.#pillLabel);
    this.#presentationRoot.addAt(this.#layer, options.layerIndex);
  }

  get active(): boolean {
    return this.#plan !== null;
  }

  get dragging(): boolean {
    return this.#drag !== null || this.#reorderDrag !== null;
  }

  cancelDrag(restore = true): boolean {
    if (!this.#drag && !this.#reorderDrag) return false;
    this.#drag = null;
    this.#reorderDrag = null;
    this.#previewPoint = null;
    this.#previewSpacing = null;
    this.#pill.visible = false;
    this.#pillLabel.visible = false;
    this.#insertionIndicator.visible = false;
    if (restore) this.#restoreProjection();
    this.#syncAppearance();
    return true;
  }

  dispose(): void {
    this.cancelDrag(false);
    this.#destroyElements();
    this.#pill.remove();
    this.#pill.destroy();
    this.#pillLabel.remove();
    this.#pillLabel.destroy();
    this.#insertionIndicator.remove();
    this.#insertionIndicator.destroy();
    this.#layer.remove();
    this.#layer.destroy();
  }

  pointerDown(event: LeaferEventLike): boolean {
    const ringNodeId =
      event.target && typeof event.target === "object"
        ? this.#hitRingNodeIds.get(event.target)
        : undefined;
    if (ringNodeId && this.#plan && !event.right && !event.middle) {
      if (event.shiftKey && this.#plan.dimension !== "grid") {
        if (this.#markedNodeIds.has(ringNodeId)) {
          this.#markedNodeIds.delete(ringNodeId);
        } else {
          this.#markedNodeIds.add(ringNodeId);
        }
        this.#syncAppearance();
        return true;
      }
      if (!this.#markedNodeIds.has(ringNodeId)) {
        this.#markedNodeIds.clear();
        this.#markedNodeIds.add(ringNodeId);
      }
      this.#syncAppearance();
      if (this.#plan.dimension === "grid") return true;
      const before = this.#captureTransforms(this.#plan.nodeIds);
      if (!before) return true;
      this.#reorderDrag = {
        axis: this.#plan.dimension,
        before,
        documentId: this.#plan.documentId,
        expectedRevision: this.#plan.revision,
        insertionIndex: originalInsertionIndex(
          this.#plan.nodeIds,
          this.#markedNodeIds,
        ),
        moved: false,
        movedNodeIds: this.#plan.nodeIds.filter((id) =>
          this.#markedNodeIds.has(id),
        ),
        nodeIds: this.#plan.nodeIds,
        pageId: this.#plan.pageId,
        startClientPoint: eventClientPoint(event),
        valid: false,
      };
      return true;
    }
    const handleId =
      event.target && typeof event.target === "object"
        ? this.#hitHandleIds.get(event.target)
        : undefined;
    const spec = handleId ? this.#specs.get(handleId) : undefined;
    const plan = this.#plan;
    if (!spec || !plan || !this.#document || event.right || event.middle) {
      return false;
    }
    const point = event.getInnerPoint(this.#layer);
    const before = this.#captureTransforms(plan.nodeIds);
    if (!before) return false;
    this.#drag = {
      axis: spec.axis,
      before,
      documentId: plan.documentId,
      expectedRevision: plan.revision,
      handleId: spec.id,
      moved: false,
      nodeIds: plan.nodeIds,
      pageId: plan.pageId,
      spacing: spec.value,
      startClientPoint: eventClientPoint(event),
      startCoordinate: spec.axis === "horizontal" ? point.x : point.y,
      startSpacing: spec.value,
    };
    this.#hovered = true;
    this.#previewPoint = point;
    this.#previewSpacing = spec.value;
    this.#syncAppearance();
    this.#syncPill();
    return true;
  }

  pointerMove(event: LeaferEventLike): boolean {
    const reorderDrag = this.#reorderDrag;
    const reorderPlan = this.#plan;
    if (reorderDrag && reorderPlan && this.#document) {
      if (event.isCancel) {
        this.cancelDrag(true);
        return true;
      }
      const clientPoint = eventClientPoint(event);
      if (
        Math.hypot(
          clientPoint.x - reorderDrag.startClientPoint.x,
          clientPoint.y - reorderDrag.startClientPoint.y,
        ) >= 3
      ) {
        reorderDrag.moved = true;
      }
      if (!reorderDrag.moved) return true;
      const point = event.getInnerPoint(this.#layer);
      const insertionIndex = smartInsertionIndex(
        reorderPlan.items,
        reorderDrag.movedNodeIds,
        reorderDrag.axis,
        reorderDrag.axis === "horizontal" ? point.x : point.y,
      );
      const preview = reorderSmartSelection(
        reorderPlan.items,
        reorderDrag.movedNodeIds,
        insertionIndex,
      );
      reorderDrag.insertionIndex = insertionIndex;
      if (!preview.ok) {
        this.#restorePreview(reorderDrag.before);
        reorderDrag.valid = false;
        this.#insertionIndicator.visible = false;
        return true;
      }
      for (const placement of preview.placements) {
        const before = reorderDrag.before.get(placement.id);
        const element = this.#element(placement.id);
        const localDelta = documentDeltaToNodeParent(
          this.#document,
          placement.id,
          placement.delta,
        );
        if (!before || !element || !localDelta) {
          this.cancelDrag(true);
          return true;
        }
        element.setTransform({
          a: before[0],
          b: before[1],
          c: before[2],
          d: before[3],
          e: before[4] + localDelta.x,
          f: before[5] + localDelta.y,
        });
      }
      reorderDrag.valid = true;
      this.#syncInsertionIndicator(reorderPlan, reorderDrag, insertionIndex);
      return true;
    }
    const drag = this.#drag;
    const plan = this.#plan;
    if (!drag || !plan || !this.#document) {
      const point = event.getInnerPoint(this.#layer);
      const hovered = Boolean(
        plan &&
        point.x >= plan.bounds.x &&
        point.y >= plan.bounds.y &&
        point.x <= plan.bounds.x + plan.bounds.width &&
        point.y <= plan.bounds.y + plan.bounds.height,
      );
      if (hovered !== this.#hovered) {
        this.#hovered = hovered;
        this.#syncAppearance();
      }
      return false;
    }
    if (event.isCancel) {
      this.cancelDrag(true);
      return true;
    }
    const point = event.getInnerPoint(this.#layer);
    const clientPoint = eventClientPoint(event);
    if (
      Math.hypot(
        clientPoint.x - drag.startClientPoint.x,
        clientPoint.y - drag.startClientPoint.y,
      ) >= 3
    ) {
      drag.moved = true;
    }
    const coordinate = drag.axis === "horizontal" ? point.x : point.y;
    const step = event.shiftKey ? BIG_NUDGE : 1;
    const spacing = bounded(
      Math.round(
        (drag.startSpacing + coordinate - drag.startCoordinate) / step,
      ) * step,
      -MAX_SPACING,
      MAX_SPACING,
    );
    const preview = setSmartSelectionSpacing(plan.items, drag.axis, spacing);
    if (!preview.ok) {
      this.#restorePreview(drag.before);
      this.#previewSpacing = drag.startSpacing;
      drag.spacing = drag.startSpacing;
      return true;
    }
    for (const placement of preview.placements) {
      const before = drag.before.get(placement.id);
      const element = this.#element(placement.id);
      const localDelta = documentDeltaToNodeParent(
        this.#document,
        placement.id,
        placement.delta,
      );
      if (!before || !element || !localDelta) {
        this.cancelDrag(true);
        return true;
      }
      element.setTransform({
        a: before[0],
        b: before[1],
        c: before[2],
        d: before[3],
        e: before[4] + localDelta.x,
        f: before[5] + localDelta.y,
      });
    }
    drag.spacing = spacing;
    this.#previewPoint = point;
    this.#previewSpacing = spacing;
    this.#syncAppearance();
    this.#syncPill();
    return true;
  }

  pointerUp(event: LeaferEventLike): boolean {
    const reorderDrag = this.#reorderDrag;
    if (reorderDrag) {
      if (!event.isCancel) this.pointerMove(event);
      const current = this.#reorderDrag;
      this.cancelDrag(true);
      if (!event.isCancel && current?.moved && current.valid) {
        this.#onReorder({
          documentId: current.documentId,
          expectedRevision: current.expectedRevision,
          insertionIndex: current.insertionIndex,
          movedNodeIds: current.movedNodeIds,
          nodeIds: current.nodeIds,
          pageId: current.pageId,
        });
      }
      return true;
    }
    const drag = this.#drag;
    if (!drag) return false;
    if (!event.isCancel) this.pointerMove(event);
    const current = this.#drag;
    this.cancelDrag(true);
    if (
      !event.isCancel &&
      current?.moved &&
      current.spacing !== current.startSpacing
    ) {
      this.#onCommit({
        axis: current.axis,
        documentId: current.documentId,
        expectedRevision: current.expectedRevision,
        nodeIds: current.nodeIds,
        pageId: current.pageId,
        spacing: current.spacing,
      });
    }
    return true;
  }

  sync(input: {
    componentTargetActive: boolean;
    document: DesignDocument;
    pageId: string;
    selectedNodeIds: readonly string[];
    tool: string;
  }): void {
    if (
      this.#drag &&
      (this.#drag.documentId !== input.document.documentId ||
        this.#drag.expectedRevision !== input.document.revision ||
        input.tool !== "select" ||
        !sameStringSet(this.#drag.nodeIds, input.selectedNodeIds))
    ) {
      this.cancelDrag(true);
    }
    if (
      this.#reorderDrag &&
      (this.#reorderDrag.documentId !== input.document.documentId ||
        this.#reorderDrag.expectedRevision !== input.document.revision ||
        input.tool !== "select" ||
        !sameStringSet(this.#reorderDrag.nodeIds, input.selectedNodeIds))
    ) {
      this.cancelDrag(true);
    }
    this.#document = input.document;
    const fingerprint = smartSelectionSyncFingerprint(input);
    if (fingerprint === this.#syncFingerprint) {
      this.syncViewport();
      return;
    }
    this.#syncFingerprint = fingerprint;
    this.#plan =
      input.tool === "select" && !input.componentTargetActive
        ? createSmartSelectionOverlayPlan(
            input.document,
            input.pageId,
            input.selectedNodeIds,
          )
        : null;
    if (!this.#plan) {
      this.#markedNodeIds.clear();
      this.#hovered = false;
      this.#destroyElements();
      this.#pill.visible = false;
      this.#pillLabel.visible = false;
      this.#layer.visible = false;
      return;
    }
    for (const nodeId of this.#markedNodeIds) {
      if (!this.#plan.nodeIds.includes(nodeId))
        this.#markedNodeIds.delete(nodeId);
    }
    this.#reconcileElements(this.#plan);
    this.syncViewport();
  }

  syncViewport(): void {
    const plan = this.#plan;
    if (!plan) return;
    const relative = matrixRelativeToParent(
      this.#presentationRoot.localTransform,
      this.#viewportRoot.localTransform,
      MATRIX_EPSILON,
    );
    if (!relative) {
      this.#layer.visible = false;
      return;
    }
    this.#layer.setTransform(relative);
    this.#layer.visible = true;
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.hypot(
        this.#viewportRoot.localTransform.a,
        this.#viewportRoot.localTransform.b,
      ),
    );
    for (const ringSpec of plan.rings) {
      const elements = this.#rings.get(ringSpec.id);
      elements?.visual.set({
        x: ringSpec.x - RING_SIZE / zoom / 2,
        y: ringSpec.y - RING_SIZE / zoom / 2,
        width: RING_SIZE / zoom,
        height: RING_SIZE / zoom,
        strokeWidth: 1.5 / zoom,
      });
      elements?.hit.set({
        x: ringSpec.x - RING_HIT_SIZE / zoom / 2,
        y: ringSpec.y - RING_HIT_SIZE / zoom / 2,
        width: RING_HIT_SIZE / zoom,
        height: RING_HIT_SIZE / zoom,
      });
    }
    for (const spec of plan.handles) this.#syncGapGeometry(spec, zoom);
    if (this.#reorderDrag?.valid) {
      this.#syncInsertionIndicator(
        plan,
        this.#reorderDrag,
        this.#reorderDrag.insertionIndex,
      );
    }
    this.#syncAppearance();
    this.#syncPill();
  }

  #captureTransforms(
    nodeIds: readonly string[],
  ): Map<string, Transform> | null {
    const before = new Map<string, Transform>();
    for (const nodeId of nodeIds) {
      this.#finishNodePresentation(nodeId);
      const element = this.#element(nodeId);
      if (!element) return null;
      const transform = element.localTransform;
      before.set(nodeId, [
        transform.a,
        transform.b,
        transform.c,
        transform.d,
        transform.e,
        transform.f,
      ]);
    }
    return before;
  }

  #createGap(spec: SmartSelectionGapHandleSpec): SmartGapElements {
    const visual = new this.#leafer.Rect({
      cornerRadius: 2,
      editable: false,
      fill: SMART_IDLE_COLOR,
      hittable: false,
      visible: false,
    }) as LeaferElement;
    const hit = new this.#leafer.Rect({
      cursor: spec.axis === "horizontal" ? "ew-resize" : "ns-resize",
      editable: false,
      fill: SMART_HIT_FILL,
      hittable: true,
      id: `__opendesign_smart_selection_gap__:${spec.id}`,
    }) as LeaferElement;
    this.#hitHandleIds.set(hit, spec.id);
    this.#layer.add(visual);
    this.#layer.add(hit);
    return { hit, visual };
  }

  #createRing(id: string, nodeId: string): SmartRingElements {
    const hit = new this.#leafer.Ellipse({
      cursor: "move",
      editable: false,
      fill: SMART_HIT_FILL,
      hittable: true,
      id: `__opendesign_smart_selection_ring_hit__:${id}`,
    }) as LeaferElement;
    const visual = new this.#leafer.Ellipse({
      cursor: "move",
      editable: false,
      fill: "rgba(255, 255, 255, 0.96)",
      hittable: true,
      id: `__opendesign_smart_selection_ring__:${id}`,
      stroke: SMART_COLOR,
    }) as LeaferElement;
    this.#hitRingNodeIds.set(hit, nodeId);
    this.#hitRingNodeIds.set(visual, nodeId);
    this.#layer.add(hit);
    this.#layer.add(visual);
    return { hit, visual };
  }

  #destroyElements(): void {
    for (const elements of this.#gaps.values()) {
      elements.hit.remove();
      elements.hit.destroy();
      elements.visual.remove();
      elements.visual.destroy();
    }
    for (const elements of this.#rings.values()) {
      elements.hit.remove();
      elements.hit.destroy();
      elements.visual.remove();
      elements.visual.destroy();
    }
    this.#gaps.clear();
    this.#rings.clear();
    this.#specs.clear();
  }

  #reconcileElements(plan: SmartSelectionOverlayPlan): void {
    this.#destroyElements();
    for (const spec of plan.handles) {
      this.#specs.set(spec.id, spec);
      this.#gaps.set(spec.id, this.#createGap(spec));
    }
    for (const spec of plan.rings) {
      this.#rings.set(spec.id, this.#createRing(spec.id, spec.nodeId));
    }
  }

  #restorePreview(before: ReadonlyMap<string, Transform>): void {
    for (const [nodeId, transform] of before) {
      this.#element(nodeId)?.setTransform({
        a: transform[0],
        b: transform[1],
        c: transform[2],
        d: transform[3],
        e: transform[4],
        f: transform[5],
      });
    }
  }

  #syncInsertionIndicator(
    plan: SmartSelectionOverlayPlan,
    drag: SmartSelectionReorderDragSession,
    insertionIndex: number,
  ): void {
    const moved = new Set(drag.movedNodeIds);
    const remaining = [...plan.items]
      .filter((item) => !moved.has(item.id))
      .sort((left, right) =>
        drag.axis === "horizontal"
          ? left.bounds.x - right.bounds.x || left.id.localeCompare(right.id)
          : left.bounds.y - right.bounds.y || left.id.localeCompare(right.id),
      );
    const previous = remaining[insertionIndex - 1];
    const next = remaining[insertionIndex];
    const coordinate =
      drag.axis === "horizontal"
        ? previous && next
          ? (previous.bounds.x + previous.bounds.width + next.bounds.x) / 2
          : previous
            ? previous.bounds.x + previous.bounds.width
            : (next?.bounds.x ?? plan.bounds.x)
        : previous && next
          ? (previous.bounds.y + previous.bounds.height + next.bounds.y) / 2
          : previous
            ? previous.bounds.y + previous.bounds.height
            : (next?.bounds.y ?? plan.bounds.y);
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.hypot(
        this.#viewportRoot.localTransform.a,
        this.#viewportRoot.localTransform.b,
      ),
    );
    const thickness = 2 / zoom;
    const overhang = 8 / zoom;
    this.#insertionIndicator.set(
      drag.axis === "horizontal"
        ? {
            x: coordinate - thickness / 2,
            y: plan.bounds.y - overhang,
            width: thickness,
            height: plan.bounds.height + overhang * 2,
            visible: true,
          }
        : {
            x: plan.bounds.x - overhang,
            y: coordinate - thickness / 2,
            width: plan.bounds.width + overhang * 2,
            height: thickness,
            visible: true,
          },
    );
  }

  #syncGapGeometry(spec: SmartSelectionGapHandleSpec, zoom: number): void {
    const elements = this.#gaps.get(spec.id);
    if (!elements) return;
    const vertical = spec.axis === "horizontal";
    const visual = vertical
      ? {
          x: spec.x - HANDLE_THICKNESS / zoom / 2,
          y: spec.y - HANDLE_LENGTH / zoom / 2,
          width: HANDLE_THICKNESS / zoom,
          height: HANDLE_LENGTH / zoom,
        }
      : {
          x: spec.x - HANDLE_LENGTH / zoom / 2,
          y: spec.y - HANDLE_THICKNESS / zoom / 2,
          width: HANDLE_LENGTH / zoom,
          height: HANDLE_THICKNESS / zoom,
        };
    const hit = vertical
      ? {
          x: spec.x - HIT_CROSS / zoom / 2,
          y: spec.y - HIT_LENGTH / zoom / 2,
          width: HIT_CROSS / zoom,
          height: HIT_LENGTH / zoom,
        }
      : {
          x: spec.x - HIT_LENGTH / zoom / 2,
          y: spec.y - HIT_CROSS / zoom / 2,
          width: HIT_LENGTH / zoom,
          height: HIT_CROSS / zoom,
        };
    elements.visual.set(visual);
    elements.hit.set(hit);
  }

  #syncAppearance(): void {
    const activeId = this.#drag?.handleId;
    for (const [id, elements] of this.#gaps) {
      const active = id === activeId;
      elements.visual.set({
        opacity: active ? 1 : 0.84,
        visible: active || this.#hovered,
      });
    }
    for (const spec of this.#plan?.rings ?? []) {
      const marked = this.#markedNodeIds.has(spec.nodeId);
      this.#rings.get(spec.id)?.visual.set({
        fill: marked ? SMART_COLOR : "rgba(255, 255, 255, 0.96)",
        opacity: this.#hovered || this.dragging || marked ? 1 : 0.72,
      });
    }
  }

  #syncPill(): void {
    const point = this.#previewPoint;
    const spacing = this.#previewSpacing;
    if (!point || spacing === null || !this.#drag) {
      this.#pill.visible = false;
      this.#pillLabel.visible = false;
      return;
    }
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.hypot(
        this.#viewportRoot.localTransform.a,
        this.#viewportRoot.localTransform.b,
      ),
    );
    const label = `${spacing}px`;
    const width = Math.max(38, label.length * 7 + 12) / zoom;
    const height = PILL_HEIGHT / zoom;
    const x = point.x - width / 2;
    const y = point.y - (PILL_HEIGHT + PILL_OFFSET) / zoom;
    this.#pill.set({
      x,
      y,
      width,
      height,
      cornerRadius: 4 / zoom,
      visible: true,
    });
    this.#pillLabel.set({
      x,
      y: y + 2 / zoom,
      width,
      height,
      fontSize: 10 / zoom,
      lineHeight: 14 / zoom,
      text: label,
      visible: true,
    });
  }
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return (
    rightSet.size === left.length && left.every((value) => rightSet.has(value))
  );
}

function smartSelectionSyncFingerprint(input: {
  componentTargetActive: boolean;
  document: DesignDocument;
  pageId: string;
  selectedNodeIds: readonly string[];
  tool: string;
}): string {
  return [
    input.document.documentId,
    input.document.revision,
    input.pageId,
    input.tool,
    input.componentTargetActive ? "component" : "nodes",
    [...new Set(input.selectedNodeIds)].sort().join("\u0000"),
  ].join("\u0001");
}

function originalInsertionIndex(
  orderedIds: readonly string[],
  movedIds: ReadonlySet<string>,
): number {
  const firstMovedIndex = orderedIds.findIndex((id) => movedIds.has(id));
  if (firstMovedIndex < 0) return 0;
  return orderedIds.slice(0, firstMovedIndex).filter((id) => !movedIds.has(id))
    .length;
}

function smartInsertionIndex(
  items: readonly SmartSelectionOverlayPlan["items"][number][],
  movedNodeIds: readonly string[],
  axis: "horizontal" | "vertical",
  coordinate: number,
): number {
  const moved = new Set(movedNodeIds);
  return items
    .filter((item) => !moved.has(item.id))
    .map((item) =>
      axis === "horizontal"
        ? item.bounds.x + item.bounds.width / 2
        : item.bounds.y + item.bounds.height / 2,
    )
    .filter((center) => coordinate > center).length;
}
