import type { SnapGuideLine } from "@opendesign/geometry-service/snapping";
import type * as LeaferEditorModule from "leafer-editor";
import { matrixRelativeToParent } from "./affine.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

const MATRIX_EPSILON = 0.000_001;
const SNAP_GUIDE_COLOR = "#f24e8a";

export class SnapGuideOverlayController {
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
      stroke: SNAP_GUIDE_COLOR,
      strokeAlign: "center",
    });
    this.#layer.add(this.#path);
    options.presentationRoot.addAt(this.#layer, options.layerIndex);
  }

  setLines(lines: readonly SnapGuideLine[]): void {
    if (lines.length === 0) {
      this.#layer.visible = false;
      this.#path.visible = false;
      return;
    }
    this.#path.set({
      path: lines.map(snapGuideLinePath).join(" "),
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
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.hypot(
        this.#viewportRoot.localTransform.a,
        this.#viewportRoot.localTransform.b,
      ),
    );
    this.#path.set({ strokeWidth: 1 / zoom });
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

export function snapGuideLinePath(line: SnapGuideLine): string {
  if ("kind" in line) {
    return `M ${line.start.x} ${line.start.y} L ${line.end.x} ${line.end.y}`;
  }
  return line.axis === "x"
    ? `M ${line.position} ${line.range.start} L ${line.position} ${line.range.end}`
    : `M ${line.range.start} ${line.position} L ${line.range.end} ${line.position}`;
}
