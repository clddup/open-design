import type { DesignDocument } from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import {
  matrixRelativeToParent,
  sameAffineMatrix,
  transformToAffine,
  type AffineMatrix,
} from "./affine.js";
import {
  createComponentSlotOverlayPlan,
  type ComponentSlotOverlaySpec,
} from "./component-slot-overlay.js";
import {
  GridEditorOverlayController,
  type GridEditorPointerEvent,
} from "./grid-editor-overlay-controller.js";
import type { GridEditorAxis } from "./grid-editor-overlay.js";
import {
  createLayoutGuideOverlayPlan,
  layoutGuideDocumentTransform,
  reconcileLayoutGuideElements,
} from "./layout-guide-overlay.js";
import {
  createSliceOverlayPlan,
  type SliceOverlaySpec,
} from "./slice-overlay.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

const MATRIX_EPSILON = 0.000_001;
const LAYOUT_GUIDE_DEFAULT_COLOR = "#ff5a5f";
const SLOT_INDICATOR_COLOR = "#d946ef";
const SLICE_INDICATOR_COLOR = "#7c3aed";

export class EditorOverlayController {
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
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    leafer: LeaferModule;
    onGridTrackReorder: (request: {
      axis: GridEditorAxis;
      frameId: string;
      fromIndices: readonly number[];
      insertionIndex: number;
    }) => boolean;
    presentationRoot: LeaferGroup;
    viewportRoot: LeaferGroup;
  }) {
    this.#leafer = options.leafer;
    this.#presentationRoot = options.presentationRoot;
    this.#viewportRoot = options.viewportRoot;
    this.#guideLayer = this.#createLayer(1);
    this.#slotLayer = this.#createLayer(2);
    this.#sliceLayer = this.#createLayer(3);
    this.#gridEditor = new GridEditorOverlayController({
      layerIndex: 4,
      leafer: options.leafer,
      onReorder: options.onGridTrackReorder,
      presentationRoot: options.presentationRoot,
      viewportRoot: options.viewportRoot,
    });
  }

  get active(): boolean {
    return (
      this.#guideElements.size > 0 ||
      this.#slotElements.size > 0 ||
      this.#sliceElements.size > 0 ||
      this.#gridEditor.active
    );
  }

  get gridDragging(): boolean {
    return this.#gridEditor.dragging;
  }

  cancelGridDrag(): boolean {
    return this.#gridEditor.cancelDrag();
  }

  dispose(): void {
    this.#destroyElements(this.#guideElements);
    this.#destroyElements(this.#slotElements);
    this.#destroyElements(this.#sliceElements);
    this.#guideAreaIds.clear();
    this.#slotSpecs.clear();
    this.#sliceSpecs.clear();
    this.#gridEditor.dispose();
    this.#guideLayer.remove();
    this.#guideLayer.destroy();
    this.#slotLayer.remove();
    this.#slotLayer.destroy();
    this.#sliceLayer.remove();
    this.#sliceLayer.destroy();
  }

  sync(input: {
    document: DesignDocument;
    gridEditorFrameId?: string;
    layoutGuideFrameId?: string;
    pageId: string;
  }): void {
    this.#document = input.document;
    this.#guideFrameId = input.layoutGuideFrameId;
    this.#syncGuides(input.document, input.layoutGuideFrameId);
    this.#syncSlots(input.document, input.pageId);
    this.#syncSlices(input.document, input.pageId);
    this.#gridEditor.sync({
      document: input.document,
      ...(input.gridEditorFrameId ? { frameId: input.gridEditorFrameId } : {}),
    });
    this.syncViewport();
  }

  gridPointerDown(event: GridEditorPointerEvent): boolean {
    return this.#gridEditor.pointerDown(event);
  }

  gridPointerMove(event: GridEditorPointerEvent): boolean {
    return this.#gridEditor.pointerMove(event);
  }

  gridPointerUp(event: GridEditorPointerEvent): boolean {
    return this.#gridEditor.pointerUp(event);
  }

  syncViewport(): void {
    this.#syncGuideViewport();
    this.#syncSlotViewport();
    this.#syncSliceViewport();
    this.#gridEditor.syncViewport();
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
