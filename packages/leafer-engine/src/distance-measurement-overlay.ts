import {
  formatDistanceMeasurement,
  type DistanceMeasurementSegment,
} from "@opendesign/geometry-service/measurements";
import type * as LeaferEditorModule from "leafer-editor";
import { matrixRelativeToParent } from "./affine.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

interface MeasurementLabelElements {
  label: LeaferElement;
  pill: LeaferElement;
}

const MATRIX_EPSILON = 0.000_001;
const MEASUREMENT_COLOR = "#f24822";

export class DistanceMeasurementOverlay {
  readonly #labels = new Map<string, MeasurementLabelElements>();
  readonly #layer: LeaferGroup;
  readonly #leafer: LeaferModule;
  #measurements: readonly DistanceMeasurementSegment[] = [];
  readonly #path: LeaferElement;
  readonly #presentationRoot: LeaferGroup;
  readonly #viewportRoot: LeaferGroup;

  constructor(options: {
    layerIndex: number;
    leafer: LeaferModule;
    presentationRoot: LeaferGroup;
    viewportRoot: LeaferGroup;
  }) {
    this.#leafer = options.leafer;
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
      stroke: MEASUREMENT_COLOR,
      strokeAlign: "center",
      visible: false,
    });
    this.#layer.add(this.#path);
    options.presentationRoot.addAt(this.#layer, options.layerIndex);
  }

  get active(): boolean {
    return this.#measurements.length > 0;
  }

  setMeasurements(measurements: readonly DistanceMeasurementSegment[]): void {
    this.#measurements = measurements;
    if (measurements.length === 0) {
      this.clear();
      return;
    }
    this.#path.set({
      path: measurements.map(measurementPath).join(" "),
      visible: true,
    });
    this.#reconcileLabels();
    this.syncViewport();
  }

  syncViewport(): void {
    if (this.#measurements.length === 0) return;
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
    this.#measurements.forEach((measurement) =>
      this.#positionLabel(measurement, zoom),
    );
    this.#layer.visible = true;
  }

  clear(): void {
    this.#measurements = [];
    this.#layer.visible = false;
    this.#path.visible = false;
    this.#labels.forEach(({ label, pill }) => {
      label.visible = false;
      pill.visible = false;
    });
  }

  dispose(): void {
    for (const { label, pill } of this.#labels.values()) {
      label.remove();
      label.destroy();
      pill.remove();
      pill.destroy();
    }
    this.#labels.clear();
    this.#path.remove();
    this.#path.destroy();
    this.#layer.remove();
    this.#layer.destroy();
  }

  #reconcileLabels(): void {
    const activeIds = new Set<string>(this.#measurements.map(({ id }) => id));
    this.#labels.forEach((elements, id) => {
      elements.label.visible = activeIds.has(id);
      elements.pill.visible = activeIds.has(id);
    });
    for (const measurement of this.#measurements) {
      if (this.#labels.has(measurement.id)) continue;
      const pill = new this.#leafer.Rect({
        cornerRadius: 3,
        editable: false,
        fill: MEASUREMENT_COLOR,
        hittable: false,
      }) as LeaferElement;
      const label = new this.#leafer.Text({
        editable: false,
        fill: "#ffffff",
        fontFamily: "Inter, sans-serif",
        fontWeight: 650,
        hittable: false,
        textAlign: "center",
        verticalAlign: "middle",
      }) as LeaferElement;
      this.#layer.add(pill);
      this.#layer.add(label);
      this.#labels.set(measurement.id, { label, pill });
    }
  }

  #positionLabel(measurement: DistanceMeasurementSegment, zoom: number): void {
    const elements = this.#labels.get(measurement.id);
    if (!elements) return;
    const text = formatDistanceMeasurement(measurement.value);
    const scale = 1 / zoom;
    const width = Math.max(26, text.length * 7 + 12) * scale;
    const height = 20 * scale;
    const center = {
      x: (measurement.start.x + measurement.end.x) / 2,
      y: (measurement.start.y + measurement.end.y) / 2,
    };
    elements.pill.set({
      cornerRadius: 3 * scale,
      height,
      visible: true,
      width,
      x: center.x - width / 2,
      y: center.y - height / 2,
    });
    elements.label.set({
      fontSize: 11 * scale,
      height,
      lineHeight: 14 * scale,
      text,
      visible: true,
      width,
      x: center.x - width / 2,
      y: center.y - height / 2,
    });
  }
}

function measurementPath(measurement: DistanceMeasurementSegment): string {
  return `M ${measurement.start.x} ${measurement.start.y} L ${measurement.end.x} ${measurement.end.y}`;
}
