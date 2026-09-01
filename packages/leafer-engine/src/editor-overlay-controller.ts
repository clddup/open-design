import {
  DEFAULT_LAYOUT_SIZING,
  type DesignDocument,
  type SelectionState,
  type ViewportState,
} from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import {
  matrixRelativeToParent,
  sameAffineMatrix,
  transformToAffine,
  type AffineMatrix,
} from "./affine.js";
import { AutoLayoutSpacingOverlayController } from "./auto-layout-spacing-overlay-controller.js";
import {
  createComponentSlotOverlayPlan,
  type ComponentSlotOverlaySpec,
} from "./component-slot-overlay.js";
import { GridEditorOverlayController } from "./grid-editor-overlay-controller.js";
import type { GridEditorAxis } from "./grid-editor-overlay.js";
import {
  directTransformElementBounds,
  type DirectTransformElementState,
} from "./direct-transform-controller.js";
import {
  createLayoutGuideOverlayPlan,
  layoutGuideDocumentTransform,
  reconcileLayoutGuideElements,
} from "./layout-guide-overlay.js";
import {
  createSliceOverlayPlan,
  type SliceOverlaySpec,
} from "./slice-overlay.js";
import type { LeaferEventLike } from "./pointer-event.js";
import { SmartSelectionOverlayController } from "./smart-selection-overlay-controller.js";
import type {
  LeaferAutoLayoutSpacingCommitRequest,
  LeaferAutoLayoutSpacingInputRequest,
  LeaferGridTrackInputRequest,
  LeaferSmartSelectionMarkState,
  LeaferSmartSelectionSpacingRequest,
  LeaferSmartSelectionReorderRequest,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

const MATRIX_EPSILON = 0.000_001;
const LAYOUT_GUIDE_DEFAULT_COLOR = "#ff5a5f";
const SLOT_INDICATOR_COLOR = "#d946ef";
const SLICE_INDICATOR_COLOR = "#7c3aed";

export class EditorOverlayController {
  readonly #autoLayoutSpacing: AutoLayoutSpacingOverlayController;
  #document: DesignDocument | null = null;
  readonly #guideAreaIds = new Set<string>();
  readonly #guideElements = new Map<string, LeaferElement>();
  #guideFrameId: string | undefined;
  #guideFingerprint: string | null = null;
  readonly #guideLayer: LeaferGroup;
  readonly #gridEditor: GridEditorOverlayController;
  readonly #leafer: LeaferModule;
  readonly #presentationRoot: LeaferGroup;
  readonly #slotElements = new Map<string, LeaferElement>();
  #slotFingerprint: string | null = null;
  readonly #slotLayer: LeaferGroup;
  readonly #slotSpecs = new Map<string, ComponentSlotOverlaySpec>();
  readonly #sliceElements = new Map<string, LeaferElement>();
  #sliceFingerprint: string | null = null;
  readonly #sliceLayer: LeaferGroup;
  readonly #sliceSpecs = new Map<string, SliceOverlaySpec>();
  readonly #smartSelection: SmartSelectionOverlayController;
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    element: (nodeId: string) => LeaferElement | undefined;
    finishNodePresentation: (nodeId: string) => void;
    leafer: LeaferModule;
    onGridTrackDelete: (request: {
      axis: GridEditorAxis;
      expectedRevision: number;
      frameId: string;
      indices: readonly number[];
    }) => boolean;
    onAutoLayoutSpacingCommit: (
      request: LeaferAutoLayoutSpacingCommitRequest,
    ) => boolean;
    onAutoLayoutSpacingInputRequest: (
      request: LeaferAutoLayoutSpacingInputRequest,
    ) => void;
    onGridTrackReorder: (request: {
      axis: GridEditorAxis;
      frameId: string;
      fromIndices: readonly number[];
      insertionIndex: number;
    }) => boolean;
    onGridTrackInputRequest: (request: LeaferGridTrackInputRequest) => void;
    onGridTrackResize: (request: {
      axis: GridEditorAxis;
      expectedRevision: number;
      frameId: string;
      index: number;
      value: number;
    }) => boolean;
    onSmartSelectionSpacing: (
      request: LeaferSmartSelectionSpacingRequest,
    ) => boolean;
    onSmartSelectionReorder: (
      request: LeaferSmartSelectionReorderRequest,
    ) => boolean;
    onSmartSelectionMarkChange: (
      state: LeaferSmartSelectionMarkState | null,
    ) => void;
    presentationRoot: LeaferGroup;
    restoreProjection: () => void;
    viewportRoot: LeaferGroup;
  }) {
    this.#leafer = options.leafer;
    this.#presentationRoot = options.presentationRoot;
    this.#viewportRoot = options.viewportRoot;
    this.#guideLayer = this.#createLayer(1);
    this.#slotLayer = this.#createLayer(2);
    this.#sliceLayer = this.#createLayer(3);
    this.#autoLayoutSpacing = new AutoLayoutSpacingOverlayController({
      layerIndex: 4,
      leafer: options.leafer,
      onCommit: options.onAutoLayoutSpacingCommit,
      onInputRequest: options.onAutoLayoutSpacingInputRequest,
      presentationRoot: options.presentationRoot,
      viewportRoot: options.viewportRoot,
    });
    this.#gridEditor = new GridEditorOverlayController({
      layerIndex: 5,
      leafer: options.leafer,
      onDelete: options.onGridTrackDelete,
      onInputRequest: options.onGridTrackInputRequest,
      onReorder: options.onGridTrackReorder,
      onResize: options.onGridTrackResize,
      presentationRoot: options.presentationRoot,
      viewportRoot: options.viewportRoot,
    });
    this.#smartSelection = new SmartSelectionOverlayController({
      element: options.element,
      finishNodePresentation: options.finishNodePresentation,
      layerIndex: 6,
      leafer: options.leafer,
      onCommit: options.onSmartSelectionSpacing,
      onReorder: options.onSmartSelectionReorder,
      onMarkChange: options.onSmartSelectionMarkChange,
      presentationRoot: options.presentationRoot,
      restoreProjection: options.restoreProjection,
      viewportRoot: options.viewportRoot,
    });
  }

  get active(): boolean {
    return (
      this.#guideElements.size > 0 ||
      this.#slotElements.size > 0 ||
      this.#sliceElements.size > 0 ||
      this.#autoLayoutSpacing.active ||
      this.#gridEditor.active ||
      this.#smartSelection.active
    );
  }

  get dragging(): boolean {
    return (
      this.#autoLayoutSpacing.dragging ||
      this.#gridEditor.dragging ||
      this.#smartSelection.dragging
    );
  }

  cancelDrag(): boolean {
    return (
      this.#autoLayoutSpacing.cancelDrag() ||
      this.#gridEditor.cancelDrag() ||
      this.#smartSelection.cancelDrag()
    );
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    return this.#gridEditor.handleKeyDown(event);
  }

  previewGridChildDrop(
    frameId: string,
    point: { x: number; y: number } | null,
  ): { row: number; column: number } | null {
    const cell = this.#gridEditor.previewChildDrop(frameId, point);
    return cell ? { row: cell.row, column: cell.column } : null;
  }

  gridChildCellAt(
    frameId: string,
    point: { x: number; y: number },
  ): { row: number; column: number } | null {
    const cell = this.#gridEditor.childCellAt(frameId, point);
    return cell ? { row: cell.row, column: cell.column } : null;
  }

  previewGridChildSpan(
    frameId: string,
    nodeId: string,
    before: DirectTransformElementState,
    next: DirectTransformElementState | null,
  ): {
    row: number;
    column: number;
    rowSpan: number;
    columnSpan: number;
  } | null {
    if (!next) {
      this.#gridEditor.previewChildPlacement(frameId, null);
      return null;
    }
    const node = this.#document?.nodesById[nodeId];
    if (!node?.gridPlacement) return null;
    return this.#gridEditor.previewChildSpan(
      frameId,
      node.gridPlacement,
      node.layoutSizing ?? DEFAULT_LAYOUT_SIZING,
      directTransformElementBounds(before),
      directTransformElementBounds(next),
    );
  }

  dispose(): void {
    this.#destroyElements(this.#guideElements);
    this.#destroyElements(this.#slotElements);
    this.#destroyElements(this.#sliceElements);
    this.#guideAreaIds.clear();
    this.#slotSpecs.clear();
    this.#sliceSpecs.clear();
    this.#autoLayoutSpacing.dispose();
    this.#gridEditor.dispose();
    this.#smartSelection.dispose();
    this.#guideLayer.remove();
    this.#guideLayer.destroy();
    this.#slotLayer.remove();
    this.#slotLayer.destroy();
    this.#sliceLayer.remove();
    this.#sliceLayer.destroy();
  }

  sync(input: {
    autoLayoutSpacingFrameId?: string;
    document: DesignDocument;
    gridEditorFrameId?: string;
    layoutGuideFrameId?: string;
    pageId: string;
    selection: SelectionState;
    tool: string;
    viewport: ViewportState;
  }): void {
    this.#document = input.document;
    this.#guideFrameId = input.layoutGuideFrameId;
    this.#syncGuides(input.document, input.layoutGuideFrameId);
    this.#syncSlots(input.document, input.pageId);
    this.#syncSlices(input.document, input.pageId);
    this.#autoLayoutSpacing.sync({
      document: input.document,
      ...(input.autoLayoutSpacingFrameId
        ? { frameId: input.autoLayoutSpacingFrameId }
        : {}),
    });
    this.#gridEditor.sync({
      document: input.document,
      viewport: input.viewport,
      ...(input.gridEditorFrameId ? { frameId: input.gridEditorFrameId } : {}),
    });
    this.#smartSelection.sync({
      componentTargetActive: input.selection.componentTarget !== undefined,
      document: input.document,
      pageId: input.pageId,
      selectedNodeIds: input.selection.nodeIds,
      tool: input.tool,
    });
    this.syncViewport(input.viewport);
  }

  pointerDown(event: LeaferEventLike): boolean {
    return (
      this.#autoLayoutSpacing.pointerDown(event) ||
      this.#gridEditor.pointerDown(event) ||
      this.#smartSelection.pointerDown(event)
    );
  }

  pointerMove(event: LeaferEventLike): boolean {
    if (this.#autoLayoutSpacing.pointerMove(event)) return true;
    if (this.#gridEditor.pointerMove(event)) return true;
    return this.#smartSelection.pointerMove(event);
  }

  pointerUp(event: LeaferEventLike): boolean {
    return (
      this.#autoLayoutSpacing.pointerUp(event) ||
      this.#gridEditor.pointerUp(event) ||
      this.#smartSelection.pointerUp(event)
    );
  }

  syncViewport(viewport?: ViewportState): void {
    this.#syncGuideViewport();
    this.#syncSlotViewport();
    this.#syncSliceViewport();
    this.#autoLayoutSpacing.syncViewport();
    this.#gridEditor.syncViewport(viewport);
    this.#smartSelection.syncViewport();
  }

  #createLayer(index: number): LeaferGroup {
    const layer = new this.#leafer.Group({
      editable: false,
      hitChildren: false,
      hittable: false,
      visible: false,
    });
    this.#presentationRoot.addAt(layer, index);
    return layer;
  }

  #destroyElements(elements: Map<string, LeaferElement>): void {
    elements.forEach((element) => {
      element.remove();
      element.destroy();
    });
    elements.clear();
  }

  #syncGuides(document: DesignDocument, frameId: string | undefined): void {
    const plan = createLayoutGuideOverlayPlan(document, frameId);
    const result = reconcileLayoutGuideElements({
      areaIds: this.#guideAreaIds,
      createElement: () =>
        new this.#leafer.Path({
          editable: false,
          hittable: false,
          strokeAlign: "center",
        }),
      defaultColor: LAYOUT_GUIDE_DEFAULT_COLOR,
      elements: this.#guideElements,
      fingerprint: this.#guideFingerprint,
      layer: this.#guideLayer,
      plan,
    });
    this.#guideFingerprint = result.fingerprint;
  }

  #syncSlots(document: DesignDocument, pageId: string): void {
    const plan = createComponentSlotOverlayPlan(document, pageId);
    if (plan.fingerprint === this.#slotFingerprint) return;
    const expected = new Set<string>();
    this.#slotSpecs.clear();
    for (const spec of plan.specs) {
      expected.add(spec.id);
      this.#slotSpecs.set(spec.id, spec);
      let element = this.#slotElements.get(spec.id);
      if (!element) {
        element = new this.#leafer.Path({
          editable: false,
          fill: "rgba(0, 0, 0, 0)",
          hittable: false,
          stroke: SLOT_INDICATOR_COLOR,
          strokeAlign: "inside",
        });
        this.#slotElements.set(spec.id, element);
        this.#slotLayer.add(element);
      }
      element.set({ path: rectanglePath(spec.width, spec.height) });
    }
    for (const [id, element] of this.#slotElements) {
      if (expected.has(id)) continue;
      element.remove();
      element.destroy();
      this.#slotElements.delete(id);
    }
    this.#slotFingerprint = plan.fingerprint;
    this.#slotLayer.visible = expected.size > 0;
  }

  #syncSlices(document: DesignDocument, pageId: string): void {
    const plan = createSliceOverlayPlan(document, pageId);
    if (plan.fingerprint === this.#sliceFingerprint) return;
    const expected = new Set<string>();
    this.#sliceSpecs.clear();
    for (const spec of plan.specs) {
      expected.add(spec.id);
      this.#sliceSpecs.set(spec.id, spec);
      let element = this.#sliceElements.get(spec.id);
      if (!element) {
        element = new this.#leafer.Path({
          editable: false,
          fill: "rgba(0, 0, 0, 0)",
          hittable: false,
          stroke: SLICE_INDICATOR_COLOR,
          strokeAlign: "inside",
        });
        this.#sliceElements.set(spec.id, element);
        this.#sliceLayer.add(element);
      }
      element.set({ path: rectanglePath(spec.width, spec.height) });
    }
    for (const [id, element] of this.#sliceElements) {
      if (expected.has(id)) continue;
      element.remove();
      element.destroy();
      this.#sliceElements.delete(id);
    }
    this.#sliceFingerprint = plan.fingerprint;
    this.#sliceLayer.visible = expected.size > 0;
  }

  #syncGuideViewport(): void {
    if (this.#guideElements.size === 0) return;
    const document = this.#document;
    const frameId = this.#guideFrameId;
    if (!document || !frameId) return;
    const desired = layoutGuideDocumentTransform(
      document,
      frameId,
      this.#viewportRoot.localTransform,
    );
    const relative = matrixRelativeToParent(
      this.#presentationRoot.localTransform,
      desired,
      MATRIX_EPSILON,
    );
    if (!relative) {
      this.#guideLayer.visible = false;
      return;
    }
    this.#guideLayer.visible = true;
    const strokeWidth = 1 / this.#zoom;
    for (const [id, element] of this.#guideElements) {
      setTransform(element, relative);
      if (!this.#guideAreaIds.has(id)) element.set({ strokeWidth });
    }
  }

  #syncSlotViewport(): void {
    if (this.#slotElements.size === 0) return;
    const viewport = this.#viewportRoot.localTransform;
    const zoom = this.#zoom;
    let visible = false;
    for (const [id, element] of this.#slotElements) {
      const spec = this.#slotSpecs.get(id);
      const desired = spec
        ? multiplyAffine(viewport, transformToAffine(spec.transform))
        : undefined;
      const relative = desired
        ? matrixRelativeToParent(
            this.#presentationRoot.localTransform,
            desired,
            MATRIX_EPSILON,
          )
        : undefined;
      if (!relative) {
        element.visible = false;
        continue;
      }
      visible = true;
      element.visible = true;
      setTransform(element, relative);
      element.set({
        dashPattern: [5 / zoom, 4 / zoom],
        strokeWidth: 1.25 / zoom,
      });
    }
    this.#slotLayer.visible = visible;
  }

  #syncSliceViewport(): void {
    if (this.#sliceElements.size === 0) return;
    const viewport = this.#viewportRoot.localTransform;
    const zoom = this.#zoom;
    let visible = false;
    for (const [id, element] of this.#sliceElements) {
      const spec = this.#sliceSpecs.get(id);
      const desired = spec
        ? multiplyAffine(viewport, transformToAffine(spec.transform))
        : undefined;
      const relative = desired
        ? matrixRelativeToParent(
            this.#presentationRoot.localTransform,
            desired,
            MATRIX_EPSILON,
          )
        : undefined;
      if (!relative) {
        element.visible = false;
        continue;
      }
      visible = true;
      element.visible = true;
      setTransform(element, relative);
      element.set({
        dashPattern: [6 / zoom, 4 / zoom],
        strokeWidth: 1.25 / zoom,
      });
    }
    this.#sliceLayer.visible = visible;
  }

  get #zoom(): number {
    return Math.max(
      MATRIX_EPSILON,
      Math.abs(this.#viewportRoot.localTransform.a || 1),
    );
  }
}

function rectanglePath(width: number, height: number): string {
  return `M 0 0 H ${width} V ${height} H 0 Z`;
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
