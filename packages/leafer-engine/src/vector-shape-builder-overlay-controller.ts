import type { Point } from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import { matrixRelativeToParent } from "./affine.js";
import { LEAFER_EDITOR_SELECTION_COLOR } from "./mapping.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

const MATRIX_EPSILON = 0.000_001;

/** Disposable document-space drag trace for Shape Builder region gestures. */
export class VectorShapeBuilderOverlayController {
  readonly #layer: LeaferGroup;
  readonly #path: LeaferElement;
  readonly #presentationRoot: LeaferGroup;
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    layerIndex: number;
    leafer: LeaferModule;
    presentationRoot: LeaferGroup;
    viewportRoot: LeaferGroup;
  }) {
    this.#presentationRoot = options.presentationRoot;
    this.#viewportRoot = options.viewportRoot;
    this.#layer = new options.leafer.Group({
      editable: false,
      hitChildren: false,
      hittable: false,
      visible: false,
    });
    this.#path = new options.leafer.Path({
      editable: false,
      fill: "transparent",
      hittable: false,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
      strokeCap: "round",
      strokeJoin: "round",
    });
    this.#layer.add(this.#path);
    options.presentationRoot.addAt(this.#layer, options.layerIndex);
  }

  show(points: readonly Point[], zoom: number): void {
    if (points.length < 2) {
      this.clear();
      return;
    }
    this.#path.set({
      path: points
        .map(
          (point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`,
        )
        .join(" "),
      strokeWidth: 2 / Math.max(MATRIX_EPSILON, Math.abs(zoom)),
      visible: true,
    });
    this.syncViewport();
  }

  syncViewport(): void {
    if (!this.#path.visible) return;
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
  }

  clear(): void {
    this.#layer.visible = false;
    this.#path.visible = false;
  }

  dispose(): void {
    this.#path.remove();
    this.#path.destroy();
    this.#layer.remove();
    this.#layer.destroy();
  }
}
