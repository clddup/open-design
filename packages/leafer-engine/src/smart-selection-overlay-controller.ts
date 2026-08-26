import type { DesignDocument, Transform } from "@opendesign/design-contracts";
import { setSmartSelectionSpacing } from "@opendesign/geometry-service";
import type * as LeaferEditorModule from "leafer-editor";
import { matrixRelativeToParent } from "./affine.js";
import { eventClientPoint, type LeaferEventLike } from "./pointer-event.js";
import {
  createSmartSelectionOverlayPlan,
  documentDeltaToNodeParent,
  type SmartSelectionGapHandleSpec,
  type SmartSelectionOverlayPlan,
} from "./smart-selection-overlay.js";
import { SmartSelectionReorderController } from "./smart-selection-reorder-controller.js";
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

const MATRIX_EPSILON = 0.000_001;
const SMART_COLOR = "#f24e8a";
const SMART_IDLE_COLOR = "rgba(242, 78, 138, 0.82)";
const SMART_HIT_FILL = "rgba(0, 0, 0, 0.001)";
const HANDLE_LENGTH = 22;
const HANDLE_THICKNESS = 2;
const HIT_CROSS = 14;
const HIT_LENGTH = 34;
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
  #hovered = false;
  readonly #layer: LeaferGroup;
  readonly #leafer: LeaferModule;
  readonly #onCommit: (request: LeaferSmartSelectionSpacingRequest) => boolean;
  readonly #pill: LeaferElement;
  readonly #pillLabel: LeaferElement;
  #plan: SmartSelectionOverlayPlan | null = null;
  #previewPoint: { x: number; y: number } | null = null;
  #previewSpacing: number | null = null;
  readonly #presentationRoot: LeaferGroup;
  readonly #restoreProjection: () => void;
  readonly #reorder: SmartSelectionReorderController;
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
    this.#layer.add(this.#pill);
    this.#layer.add(this.#pillLabel);
    this.#presentationRoot.addAt(this.#layer, options.layerIndex);
    this.#reorder = new SmartSelectionReorderController({
      element: options.element,
      finishNodePresentation: options.finishNodePresentation,
      layerIndex: options.layerIndex + 1,
      leafer: options.leafer,
      onReorder: options.onReorder,
      presentationRoot: options.presentationRoot,
      restoreProjection: options.restoreProjection,
      viewportRoot: options.viewportRoot,
    });
  }

  get active(): boolean {
    return this.#plan !== null;
  }

  get dragging(): boolean {
    return this.#drag !== null || this.#reorder.dragging;
  }

  cancelDrag(restore = true): boolean {
    if (!this.#drag) return this.#reorder.cancelDrag(restore);
    this.#drag = null;
    this.#previewPoint = null;
    this.#previewSpacing = null;
    this.#pill.visible = false;
    this.#pillLabel.visible = false;
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
    this.#reorder.dispose();
    this.#layer.remove();
    this.#layer.destroy();
  }

  pointerDown(event: LeaferEventLike): boolean {
    if (this.#reorder.pointerDown(event)) return true;
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
    if (this.#reorder.pointerMove(event)) return true;
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
        this.#reorder.setHovered(hovered);
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
    if (this.#reorder.pointerUp(event)) return true;
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
      this.#hovered = false;
      this.#destroyElements();
      this.#pill.visible = false;
      this.#pillLabel.visible = false;
      this.#layer.visible = false;
      this.#reorder.sync(input.document, null);
      return;
    }
    this.#reconcileElements(this.#plan);
    this.#reorder.sync(input.document, this.#plan);
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
    for (const spec of plan.handles) this.#syncGapGeometry(spec, zoom);
    this.#reorder.syncViewport();
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

  #destroyElements(): void {
    for (const elements of this.#gaps.values()) {
      elements.hit.remove();
      elements.hit.destroy();
      elements.visual.remove();
      elements.visual.destroy();
    }
    this.#gaps.clear();
    this.#specs.clear();
  }

  #reconcileElements(plan: SmartSelectionOverlayPlan): void {
    this.#destroyElements();
    for (const spec of plan.handles) {
      this.#specs.set(spec.id, spec);
      this.#gaps.set(spec.id, this.#createGap(spec));
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
