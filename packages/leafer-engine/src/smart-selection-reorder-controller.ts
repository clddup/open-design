import type { DesignDocument, Transform } from "@opendesign/design-contracts";
import {
  rearrangeSmartSelectionGrid,
  reorderSmartSelection,
} from "@opendesign/geometry-service";
import type * as LeaferEditorModule from "leafer-editor";
import { matrixRelativeToParent } from "./affine.js";
import { eventClientPoint, type LeaferEventLike } from "./pointer-event.js";
import {
  documentDeltaToNodeParent,
  type SmartSelectionOverlayPlan,
} from "./smart-selection-overlay.js";
import type { LeaferSmartSelectionReorderRequest } from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

interface SmartRingElements {
  hit: LeaferElement;
  visual: LeaferElement;
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

interface SmartSelectionGridDragSession {
  before: ReadonlyMap<string, Transform>;
  documentId: string;
  expectedRevision: number;
  mode: "insert" | "swap";
  moved: boolean;
  movedNodeId: string;
  nodeIds: readonly string[];
  pageId: string;
  startClientPoint: { x: number; y: number };
  targetNodeId: string;
  valid: boolean;
}

const MATRIX_EPSILON = 0.000_001;
const SMART_COLOR = "#f24e8a";
const SMART_INSERTION_COLOR = "#0d99ff";
const SMART_HIT_FILL = "rgba(0, 0, 0, 0.001)";
const RING_SIZE = 8;
const RING_HIT_SIZE = 20;

export class SmartSelectionReorderController {
  #document: DesignDocument | null = null;
  #drag: SmartSelectionReorderDragSession | null = null;
  #gridDrag: SmartSelectionGridDragSession | null = null;
  readonly #element: (nodeId: string) => LeaferElement | undefined;
  readonly #finishNodePresentation: (nodeId: string) => void;
  readonly #hitRingNodeIds = new WeakMap<object, string>();
  #hovered = false;
  readonly #insertionIndicator: LeaferElement;
  readonly #layer: LeaferGroup;
  readonly #leafer: LeaferModule;
  readonly #markedNodeIds = new Set<string>();
  readonly #onReorder: (request: LeaferSmartSelectionReorderRequest) => boolean;
  #plan: SmartSelectionOverlayPlan | null = null;
  readonly #presentationRoot: LeaferGroup;
  readonly #restoreProjection: () => void;
  readonly #rings = new Map<string, SmartRingElements>();
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    element: (nodeId: string) => LeaferElement | undefined;
    finishNodePresentation: (nodeId: string) => void;
    layerIndex: number;
    leafer: LeaferModule;
    onReorder: (request: LeaferSmartSelectionReorderRequest) => boolean;
    presentationRoot: LeaferGroup;
    restoreProjection: () => void;
    viewportRoot: LeaferGroup;
  }) {
    this.#element = options.element;
    this.#finishNodePresentation = options.finishNodePresentation;
    this.#leafer = options.leafer;
    this.#onReorder = options.onReorder;
    this.#presentationRoot = options.presentationRoot;
    this.#restoreProjection = options.restoreProjection;
    this.#viewportRoot = options.viewportRoot;
    this.#layer = new this.#leafer.Group({
      editable: false,
      hitChildren: true,
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
    this.#presentationRoot.addAt(this.#layer, options.layerIndex);
  }

  get dragging(): boolean {
    return this.#drag !== null || this.#gridDrag !== null;
  }

  cancelDrag(restore = true): boolean {
    if (!this.#drag && !this.#gridDrag) return false;
    this.#drag = null;
    this.#gridDrag = null;
    this.#insertionIndicator.visible = false;
    if (restore) this.#restoreProjection();
    this.#syncAppearance();
    return true;
  }

  dispose(): void {
    this.cancelDrag(false);
    this.#destroyRings();
    this.#insertionIndicator.remove();
    this.#insertionIndicator.destroy();
    this.#layer.remove();
    this.#layer.destroy();
  }

  pointerDown(event: LeaferEventLike): boolean {
    const nodeId =
      event.target && typeof event.target === "object"
        ? this.#hitRingNodeIds.get(event.target)
        : undefined;
    const plan = this.#plan;
    if (!nodeId || !plan || event.right || event.middle) return false;
    if (event.shiftKey && plan.dimension !== "grid") {
      if (this.#markedNodeIds.has(nodeId)) this.#markedNodeIds.delete(nodeId);
      else this.#markedNodeIds.add(nodeId);
      this.#syncAppearance();
      return true;
    }
    if (!this.#markedNodeIds.has(nodeId)) {
      this.#markedNodeIds.clear();
      this.#markedNodeIds.add(nodeId);
    }
    this.#syncAppearance();
    const before = this.#captureTransforms(plan.nodeIds);
    if (!before) return true;
    if (plan.dimension === "grid") {
      this.#gridDrag = {
        before,
        documentId: plan.documentId,
        expectedRevision: plan.revision,
        mode: event.metaKey || event.ctrlKey ? "swap" : "insert",
        moved: false,
        movedNodeId: nodeId,
        nodeIds: plan.nodeIds,
        pageId: plan.pageId,
        startClientPoint: eventClientPoint(event),
        targetNodeId: nodeId,
        valid: false,
      };
      return true;
    }
    this.#drag = {
      axis: plan.dimension,
      before,
      documentId: plan.documentId,
      expectedRevision: plan.revision,
      insertionIndex: originalInsertionIndex(plan.nodeIds, this.#markedNodeIds),
      moved: false,
      movedNodeIds: plan.nodeIds.filter((id) => this.#markedNodeIds.has(id)),
      nodeIds: plan.nodeIds,
      pageId: plan.pageId,
      startClientPoint: eventClientPoint(event),
      valid: false,
    };
    return true;
  }

  pointerMove(event: LeaferEventLike): boolean {
    const gridDrag = this.#gridDrag;
    const gridPlan = this.#plan;
    if (gridDrag && gridPlan && this.#document) {
      if (event.isCancel) {
        this.cancelDrag(true);
        return true;
      }
      const clientPoint = eventClientPoint(event);
      if (
        Math.hypot(
          clientPoint.x - gridDrag.startClientPoint.x,
          clientPoint.y - gridDrag.startClientPoint.y,
        ) >= 3
      ) {
        gridDrag.moved = true;
      }
      if (!gridDrag.moved) return true;
      const point = event.getInnerPoint(this.#layer);
      const target = nearestGridItem(gridPlan, gridDrag.movedNodeId, point);
      if (!target) return true;
      gridDrag.mode = event.metaKey || event.ctrlKey ? "swap" : "insert";
      gridDrag.targetNodeId = target.id;
      const preview = rearrangeSmartSelectionGrid(
        gridPlan.items,
        gridDrag.movedNodeId,
        target.id,
        gridDrag.mode,
      );
      if (!preview.ok) {
        this.#restorePreview(gridDrag.before);
        gridDrag.valid = false;
        this.#insertionIndicator.visible = false;
        return true;
      }
      if (!this.#applyPreview(preview.placements, gridDrag.before)) return true;
      gridDrag.valid = true;
      this.#syncGridTarget(target.bounds);
      return true;
    }
    const drag = this.#drag;
    const plan = this.#plan;
    if (!drag || !plan || !this.#document) return false;
    if (event.isCancel) {
      this.cancelDrag(true);
      return true;
    }
    const clientPoint = eventClientPoint(event);
    if (
      Math.hypot(
        clientPoint.x - drag.startClientPoint.x,
        clientPoint.y - drag.startClientPoint.y,
      ) >= 3
    ) {
      drag.moved = true;
    }
    if (!drag.moved) return true;
    const point = event.getInnerPoint(this.#layer);
    const insertionIndex = smartInsertionIndex(
      plan.items,
      drag.movedNodeIds,
      drag.axis,
      drag.axis === "horizontal" ? point.x : point.y,
    );
    const preview = reorderSmartSelection(
      plan.items,
      drag.movedNodeIds,
      insertionIndex,
    );
    drag.insertionIndex = insertionIndex;
    if (!preview.ok) {
      this.#restorePreview(drag.before);
      drag.valid = false;
      this.#insertionIndicator.visible = false;
      return true;
    }
    if (!this.#applyPreview(preview.placements, drag.before)) return true;
    drag.valid = true;
    this.#syncInsertionIndicator(plan, drag, insertionIndex);
    return true;
  }

  pointerUp(event: LeaferEventLike): boolean {
    const gridDrag = this.#gridDrag;
    if (gridDrag) {
      if (!event.isCancel) this.pointerMove(event);
      const current = this.#gridDrag;
      this.cancelDrag(true);
      if (!event.isCancel && current?.moved && current.valid) {
        this.#onReorder({
          documentId: current.documentId,
          expectedRevision: current.expectedRevision,
          kind: "grid",
          mode: current.mode,
          movedNodeId: current.movedNodeId,
          nodeIds: current.nodeIds,
          pageId: current.pageId,
          targetNodeId: current.targetNodeId,
        });
      }
      return true;
    }
    const drag = this.#drag;
    if (!drag) return false;
    if (!event.isCancel) this.pointerMove(event);
    const current = this.#drag;
    this.cancelDrag(true);
    if (!event.isCancel && current?.moved && current.valid) {
      this.#onReorder({
        documentId: current.documentId,
        expectedRevision: current.expectedRevision,
        insertionIndex: current.insertionIndex,
        kind: "linear",
        movedNodeIds: current.movedNodeIds,
        nodeIds: current.nodeIds,
        pageId: current.pageId,
      });
    }
    return true;
  }

  setHovered(hovered: boolean): void {
    if (hovered === this.#hovered) return;
    this.#hovered = hovered;
    this.#syncAppearance();
  }

  sync(document: DesignDocument, plan: SmartSelectionOverlayPlan | null): void {
    if (
      this.#drag &&
      (!plan ||
        this.#drag.documentId !== plan.documentId ||
        this.#drag.expectedRevision !== plan.revision ||
        !sameStringSet(this.#drag.nodeIds, plan.nodeIds))
    ) {
      this.cancelDrag(true);
    }
    if (
      this.#gridDrag &&
      (!plan ||
        this.#gridDrag.documentId !== plan.documentId ||
        this.#gridDrag.expectedRevision !== plan.revision ||
        !sameStringSet(this.#gridDrag.nodeIds, plan.nodeIds))
    ) {
      this.cancelDrag(true);
    }
    this.#document = document;
    this.#plan = plan;
    if (!plan) {
      this.#markedNodeIds.clear();
      this.#hovered = false;
      this.#destroyRings();
      this.#insertionIndicator.visible = false;
      this.#layer.visible = false;
      return;
    }
    for (const nodeId of this.#markedNodeIds) {
      if (!plan.nodeIds.includes(nodeId)) this.#markedNodeIds.delete(nodeId);
    }
    this.#reconcileRings(plan);
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
    const zoom = this.#zoom();
    for (const spec of plan.rings) {
      const elements = this.#rings.get(spec.id);
      elements?.visual.set({
        x: spec.x - RING_SIZE / zoom / 2,
        y: spec.y - RING_SIZE / zoom / 2,
        width: RING_SIZE / zoom,
        height: RING_SIZE / zoom,
        strokeWidth: 1.5 / zoom,
      });
      elements?.hit.set({
        x: spec.x - RING_HIT_SIZE / zoom / 2,
        y: spec.y - RING_HIT_SIZE / zoom / 2,
        width: RING_HIT_SIZE / zoom,
        height: RING_HIT_SIZE / zoom,
      });
    }
    if (this.#drag?.valid) {
      this.#syncInsertionIndicator(plan, this.#drag, this.#drag.insertionIndex);
    }
    if (this.#gridDrag?.valid) {
      const target = plan.items.find(
        (item) => item.id === this.#gridDrag?.targetNodeId,
      );
      if (target) this.#syncGridTarget(target.bounds);
    }
    this.#syncAppearance();
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

  #applyPreview(
    placements: readonly { id: string; delta: { x: number; y: number } }[],
    beforeById: ReadonlyMap<string, Transform>,
  ): boolean {
    if (!this.#document) return false;
    for (const placement of placements) {
      const before = beforeById.get(placement.id);
      const element = this.#element(placement.id);
      const localDelta = documentDeltaToNodeParent(
        this.#document,
        placement.id,
        placement.delta,
      );
      if (!before || !element || !localDelta) {
        this.cancelDrag(true);
        return false;
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
    return true;
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

  #destroyRings(): void {
    for (const elements of this.#rings.values()) {
      elements.hit.remove();
      elements.hit.destroy();
      elements.visual.remove();
      elements.visual.destroy();
    }
    this.#rings.clear();
  }

  #reconcileRings(plan: SmartSelectionOverlayPlan): void {
    this.#destroyRings();
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

  #syncAppearance(): void {
    for (const spec of this.#plan?.rings ?? []) {
      const marked = this.#markedNodeIds.has(spec.nodeId);
      this.#rings.get(spec.id)?.visual.set({
        fill: marked ? SMART_COLOR : "rgba(255, 255, 255, 0.96)",
        opacity: this.#hovered || this.dragging || marked ? 1 : 0.72,
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
    const zoom = this.#zoom();
    const thickness = 2 / zoom;
    const overhang = 8 / zoom;
    this.#insertionIndicator.set(
      drag.axis === "horizontal"
        ? {
            fill: SMART_INSERTION_COLOR,
            stroke: "rgba(0, 0, 0, 0)",
            strokeWidth: 0,
            x: coordinate - thickness / 2,
            y: plan.bounds.y - overhang,
            width: thickness,
            height: plan.bounds.height + overhang * 2,
            visible: true,
          }
        : {
            fill: SMART_INSERTION_COLOR,
            stroke: "rgba(0, 0, 0, 0)",
            strokeWidth: 0,
            x: plan.bounds.x - overhang,
            y: coordinate - thickness / 2,
            width: plan.bounds.width + overhang * 2,
            height: thickness,
            visible: true,
          },
    );
  }

  #syncGridTarget(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): void {
    const zoom = this.#zoom();
    this.#insertionIndicator.set({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      cornerRadius: 4 / zoom,
      fill: "rgba(13, 153, 255, 0.12)",
      stroke: SMART_INSERTION_COLOR,
      strokeWidth: 2 / zoom,
      visible: true,
    });
  }

  #zoom(): number {
    return Math.max(
      MATRIX_EPSILON,
      Math.hypot(
        this.#viewportRoot.localTransform.a,
        this.#viewportRoot.localTransform.b,
      ),
    );
  }
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

function smartInsertionIndex(
  items: SmartSelectionOverlayPlan["items"],
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

function nearestGridItem(
  plan: SmartSelectionOverlayPlan,
  movedNodeId: string,
  point: { x: number; y: number },
): SmartSelectionOverlayPlan["items"][number] | null {
  let nearest: SmartSelectionOverlayPlan["items"][number] | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const item of plan.items) {
    if (item.id === movedNodeId) continue;
    const dx = point.x - (item.bounds.x + item.bounds.width / 2);
    const dy = point.y - (item.bounds.y + item.bounds.height / 2);
    const nextDistance = dx * dx + dy * dy;
    if (nextDistance < distance) {
      nearest = item;
      distance = nextDistance;
    }
  }
  return nearest;
}
