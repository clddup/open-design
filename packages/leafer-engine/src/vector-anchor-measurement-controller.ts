import type { Point } from "@opendesign/design-contracts";
import { measureVectorAnchorDistances } from "@opendesign/geometry-service/measurements";
import type * as LeaferEditorModule from "leafer-editor";
import type { DistanceMeasurementPresenter } from "./distance-measurement-controller.js";
import { DistanceMeasurementOverlay } from "./distance-measurement-overlay.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

export interface VectorAnchorMeasurementReference {
  id: string;
  position: Point;
}

export class VectorAnchorMeasurementController {
  readonly #altKeys = new Set<string>();
  #hovered: VectorAnchorMeasurementReference | null = null;
  readonly #overlay: DistanceMeasurementPresenter;
  #pointerAlt = false;
  #selected: VectorAnchorMeasurementReference | null = null;

  constructor(options: {
    layerIndex: number;
    leafer: LeaferModule;
    presentationRoot: LeaferGroup;
    presenter?: DistanceMeasurementPresenter;
    viewportRoot: LeaferGroup;
  }) {
    this.#overlay =
      options.presenter ?? new DistanceMeasurementOverlay(options);
  }

  sync(selected: VectorAnchorMeasurementReference | null): void {
    if (sameReference(this.#selected, selected)) return;
    this.#selected = selected;
    this.#hovered = null;
    this.#pointerAlt = false;
    this.#overlay.clear();
  }

  pointerMove(input: {
    altKey: boolean;
    target: VectorAnchorMeasurementReference | null;
  }): void {
    this.#pointerAlt = input.altKey;
    this.#hovered = input.target;
    this.#refresh();
  }

  handleKeyDown(event: KeyboardEvent): void {
    const key = altKeyId(event);
    if (!key) return;
    this.#altKeys.add(key);
    this.#refresh();
  }

  handleKeyUp(event: KeyboardEvent): void {
    const key = altKeyId(event);
    if (!key) return;
    this.#altKeys.delete(key);
    this.#pointerAlt = false;
    this.#refresh();
  }

  pointerLeave(): void {
    this.#hovered = null;
    this.#overlay.clear();
  }

  handleWindowBlur(): void {
    this.#altKeys.clear();
    this.#pointerAlt = false;
    this.#hovered = null;
    this.#overlay.clear();
  }

  clear(): void {
    this.#hovered = null;
    this.#overlay.clear();
  }

  syncViewport(): void {
    this.#overlay.syncViewport();
  }

  dispose(): void {
    this.#overlay.dispose();
  }

  #refresh(): void {
    const selected = this.#selected;
    const hovered = this.#hovered;
    if (
      (!this.#pointerAlt && this.#altKeys.size === 0) ||
      !selected ||
      !hovered ||
      selected.id === hovered.id
    ) {
      this.#overlay.clear();
      return;
    }
    this.#overlay.setMeasurements(
      measureVectorAnchorDistances({
        source: selected.position,
        sourceId: selected.id,
        target: hovered.position,
        targetId: hovered.id,
      }),
    );
  }
}

function sameReference(
  left: VectorAnchorMeasurementReference | null,
  right: VectorAnchorMeasurementReference | null,
): boolean {
  return (
    left?.id === right?.id &&
    left?.position.x === right?.position.x &&
    left?.position.y === right?.position.y
  );
}

function altKeyId(event: KeyboardEvent): string | null {
  if (event.code === "AltLeft" || event.code === "AltRight") {
    return event.code;
  }
  return event.key === "Alt" ? "Alt" : null;
}
