import type { ComponentSelectionTarget } from "@opendesign/design-contracts";
import type { LeaferSceneProjection } from "./mapping.js";
import type { LeaferCanvasTool, LeaferLayerHoverTarget } from "./types.js";

const LAYER_HOVER_COLOR = "#4f7fff";

export interface LayerHoverChromeResource<Element extends object> {
  readonly target: Element | null;
  readonly opacity: number;
  mount(style: { color: string; opacity: number; strokeWidth: number }): void;
  show(
    element: Element,
    style: { color: string; opacity: number; strokeWidth: number },
  ): void;
  clearTarget(): void;
  setOpacity(opacity: number): void;
  update(): void;
  dispose(): void;
}

export type LayerHoverControllerState<Element extends object> = {
  tool: LeaferCanvasTool;
  vectorEditing: boolean;
  imageCropActive: boolean;
  projection: LeaferSceneProjection | null;
  selectedElements: readonly Element[];
};

export class LayerHoverController<Element extends object> {
  readonly #chrome: LayerHoverChromeResource<Element>;
  readonly #componentElement: (
    target: ComponentSelectionTarget,
  ) => Element | undefined;
  readonly #element: (nodeId: string) => Element | undefined;
  readonly #projectionId: (element: Element) => string | undefined;
  #disposed = false;

  constructor(options: {
    createChrome: () => LayerHoverChromeResource<Element>;
    componentElement: (target: ComponentSelectionTarget) => Element | undefined;
    element: (nodeId: string) => Element | undefined;
    projectionId: (element: Element) => string | undefined;
  }) {
    this.#chrome = options.createChrome();
    this.#componentElement = options.componentElement;
    this.#element = options.element;
    this.#projectionId = options.projectionId;
    this.#chrome.mount({
      color: LAYER_HOVER_COLOR,
      opacity: 0,
      strokeWidth: 1,
    });
  }

  sync(
    target: LeaferLayerHoverTarget | undefined,
    state: LayerHoverControllerState<Element>,
  ): void {
    if (this.#disposed) return;
    const element = target?.componentTarget
      ? this.#componentElement(target.componentTarget)
      : target
        ? this.#element(target.nodeId)
        : undefined;
    const projectionId = element ? this.#projectionId(element) : undefined;
    const visible =
      state.projection && projectionId
        ? lineage(projectionId, state.projection).every(
            (nodeId) =>
              state.projection?.elementsById.get(nodeId)?.data.visible !==
              false,
          )
        : false;
    const show =
      state.tool === "select" &&
      !state.vectorEditing &&
      !state.imageCropActive &&
      element !== undefined &&
      visible &&
      !state.selectedElements.includes(element);
    if (!show) {
      this.clear();
      return;
    }
    if (this.#chrome.target !== element) {
      this.#chrome.show(element, {
        color: LAYER_HOVER_COLOR,
        opacity: 1,
        strokeWidth: 1,
      });
    } else if (this.#chrome.opacity !== 1) {
      this.#chrome.setOpacity(1);
      this.#chrome.update();
    }
  }

  clear(): void {
    if (this.#disposed) return;
    if (this.#chrome.target === null && this.#chrome.opacity === 0) return;
    this.#chrome.clearTarget();
    this.#chrome.setOpacity(0);
    this.#chrome.update();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#chrome.dispose();
  }
}

function lineage(nodeId: string, projection: LeaferSceneProjection): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = nodeId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    result.push(currentId);
    currentId = projection.elementsById.get(currentId)?.parentId ?? null;
  }
  return result;
}
