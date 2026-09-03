import type { Point } from "@opendesign/design-contracts";
import type { VectorEraserShape } from "@opendesign/geometry-service/vector-eraser";
import type * as LeaferEditorModule from "leafer-editor";
import { matrixRelativeToParent } from "./affine.js";
import { LEAFER_EDITOR_SELECTION_COLOR } from "./mapping.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

const MATRIX_EPSILON = 0.000_001;

export class VectorEraserOverlayController {
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
      hittable: false,
      opacity: 0.3,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
    });
    this.#layer.add(this.#path);
    options.presentationRoot.addAt(this.#layer, options.layerIndex);
  }

  show(
    points: readonly Point[],
    weight: number,
    shape: VectorEraserShape,
  ): void {
    const point = points[0];
    if (!point) {
      this.clear();
      return;
    }
    const single = points.length === 1;
    const path = single
      ? eraserDotPath(point, weight / 2, shape)
      : points
          .map(
            (candidate, index) =>
              `${index === 0 ? "M" : "L"} ${candidate.x} ${candidate.y}`,
          )
          .join(" ");
    if (single) {
      this.#path.set({
        fill: LEAFER_EDITOR_SELECTION_COLOR,
        path,
        stroke: "transparent",
        strokeWidth: 0,
        visible: true,
      });
    } else {
      this.#path.set({
        fill: "transparent",
        path,
        stroke: LEAFER_EDITOR_SELECTION_COLOR,
        strokeCap: shape === "round" ? "round" : "square",
        strokeJoin: shape === "round" ? "round" : "miter",
        strokeWidth: weight,
        visible: true,
      });
    }
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

function eraserDotPath(
  point: Point,
  radius: number,
  shape: VectorEraserShape,
): string {
  if (shape === "square") {
    return `M ${point.x - radius} ${point.y - radius} L ${point.x + radius} ${point.y - radius} L ${point.x + radius} ${point.y + radius} L ${point.x - radius} ${point.y + radius} Z`;
  }
  return `M ${point.x - radius} ${point.y} A ${radius} ${radius} 0 1 0 ${point.x + radius} ${point.y} A ${radius} ${radius} 0 1 0 ${point.x - radius} ${point.y}`;
}
