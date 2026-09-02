import type {
  DesignDocument,
  Rect,
  Transform,
} from "@opendesign/design-contracts";
import type { SnapGuideLine } from "@opendesign/geometry-service/snapping";
import type * as LeaferEditorModule from "leafer-editor";
import { DirectMoveSnapController } from "./direct-move-snap-controller.js";
import {
  DirectResizeSnapController,
  resizeAxes,
  type DirectResizeScaleInput,
} from "./direct-resize-snap-controller.js";
import {
  directTransformElementBounds,
  readDirectTransformElementState,
  type DirectTransformElementState,
} from "./direct-transform-element-state.js";
import {
  getVisibleWorldTransform,
  invertTransform,
  multiplyTransforms,
  transformPoint,
} from "./scene-node-transform.js";
import type { LeaferEngineSyncInput } from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;

const IDENTITY_TRANSFORM: Transform = [1, 0, 0, 1, 0, 0];

export class DirectTransformSnapSession {
  #active: "move" | "resize" | null = null;
  readonly #controlKeys = new Set<string>();
  readonly #shiftKeys = new Set<string>();
  readonly #currentDocument: () => DesignDocument | null;
  readonly #element: (nodeId: string) => LeaferElement | undefined;
  readonly #move: DirectMoveSnapController;
  readonly #resize: DirectResizeSnapController;
  #resizeNodeIds: readonly string[] = [];
  #resizeOriented = false;

  constructor(options: {
    currentDocument: () => DesignDocument | null;
    element: (nodeId: string) => LeaferElement | undefined;
    onLines: (lines: readonly SnapGuideLine[]) => void;
  }) {
    this.#currentDocument = options.currentDocument;
    this.#element = options.element;
    this.#move = new DirectMoveSnapController({
      onLines: options.onLines,
      selectionBounds: (nodeIds) => this.#selectionBounds(nodeIds),
      translate: (nodeIds, delta) => this.#translate(nodeIds, delta),
    });
    this.#resize = new DirectResizeSnapController({
      onLines: options.onLines,
    });
  }

  begin(input: {
    engineInput: LeaferEngineSyncInput;
    excludedNodeIds: ReadonlySet<string>;
    selectedNodeIds: readonly string[];
  }): void {
    if (this.#active) return;
    const nodeIds = topLevelNodeIds(
      input.engineInput.document,
      input.selectedNodeIds,
    );
    if (nodeIds.length === 0) return;
    this.#active = "move";
    this.#move.setSuppressed(this.#controlKeys.size > 0);
    this.#move.begin(
      snapInput(input.engineInput, nodeIds, input.excludedNodeIds),
    );
  }

  beginResize(input: {
    engineInput: LeaferEngineSyncInput;
    excludedNodeIds: ReadonlySet<string>;
    selectedNodeIds: readonly string[];
  }): boolean {
    if (this.#active) return this.#active === "resize";
    const nodeIds = topLevelNodeIds(
      input.engineInput.document,
      input.selectedNodeIds,
    );
    const usesSelectionBox = this.#usesAxisAlignedSelectionBox(nodeIds);
    const oriented =
      !usesSelectionBox && nodeIds.length === 1
        ? this.#orientedFrame(nodeIds[0]!)
        : null;
    if (nodeIds.length === 0 || (!usesSelectionBox && !oriented)) {
      return false;
    }
    this.#active = "resize";
    this.#resizeNodeIds = nodeIds;
    this.#resizeOriented = Boolean(oriented);
    this.#resize.setSuppressed(this.#controlKeys.size > 0);
    this.#resize.begin(
      snapInput(input.engineInput, nodeIds, input.excludedNodeIds),
    );
    return true;
  }

  resolveResize(input: Omit<DirectResizeScaleInput, "bounds" | "origin">): {
    scaleX: number;
    scaleY: number;
  } {
    if (this.#active !== "resize") return originalScale(input);
    const bounds = this.#selectionBounds(this.#resizeNodeIds);
    if (!bounds) return originalScale(input);
    const frame = this.#resizeOriented
      ? this.#orientedFrame(this.#resizeNodeIds[0]!)
      : undefined;
    if (this.#resizeOriented && !frame) return originalScale(input);
    return this.#resize.resolve({
      ...input,
      bounds,
      ...(frame ? { frame } : undefined),
      origin: resizeOrigin(bounds, input.direction, input.aroundCenter),
    });
  }

  refresh(input: {
    engineInput: LeaferEngineSyncInput;
    excludedNodeIds: ReadonlySet<string>;
    selectedNodeIds: readonly string[];
  }): void {
    if (!this.#active) return;
    const nodeIds = topLevelNodeIds(
      input.engineInput.document,
      input.selectedNodeIds,
    );
    if (nodeIds.length === 0) {
      this.cancel();
      return;
    }
    const next = snapInput(input.engineInput, nodeIds, input.excludedNodeIds);
    if (this.#active === "move") this.#move.refresh(next);
    else if (
      this.#resizeOriented
        ? nodeIds.length === 1 && Boolean(this.#orientedFrame(nodeIds[0]!))
        : this.#usesAxisAlignedSelectionBox(nodeIds)
    ) {
      this.#resizeNodeIds = nodeIds;
      this.#resize.refresh(next);
    } else this.cancel();
  }

  update(): void {
    if (this.#active === "move") this.#move.update();
  }

  syncViewport(input: LeaferEngineSyncInput): void {
    if (this.#active === "move") this.#move.syncViewport(input.viewport);
    if (this.#active === "resize") this.#resize.syncViewport(input.viewport);
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const shift = shiftKeyId(event);
    if (shift) this.#shiftKeys.add(shift);
    const key = controlKeyId(event);
    if (!key) return false;
    this.#controlKeys.add(key);
    this.#move.setSuppressed(true);
    this.#resize.setSuppressed(true);
    return true;
  }

  handleKeyUp(event: KeyboardEvent): boolean {
    const shift = shiftKeyId(event);
    if (shift) this.#shiftKeys.delete(shift);
    const key = controlKeyId(event);
    if (!key) return false;
    this.#controlKeys.delete(key);
    const suppressed = this.#controlKeys.size > 0;
    this.#move.setSuppressed(suppressed);
    this.#resize.setSuppressed(suppressed);
    return true;
  }

  resetModifiers(): void {
    this.#shiftKeys.clear();
    if (this.#controlKeys.size === 0) return;
    this.#controlKeys.clear();
    this.#move.setSuppressed(false);
    this.#resize.setSuppressed(false);
  }

  get ratioLocked(): boolean {
    return this.#shiftKeys.size > 0;
  }

  finish(): void {
    this.#active = null;
    this.#resizeNodeIds = [];
    this.#resizeOriented = false;
    this.#move.finish();
    this.#resize.finish();
  }

  cancel(): void {
    this.#active = null;
    this.#resizeNodeIds = [];
    this.#resizeOriented = false;
    this.#move.cancel();
    this.#resize.cancel();
  }

  #selectionBounds(nodeIds: readonly string[]): Rect | null {
    const document = this.#currentDocument();
    if (!document) return null;
    const bounds = nodeIds.flatMap((nodeId) => {
      const world = this.#worldElementState(nodeId);
      if (!world) return [];
      return [
        directTransformElementBounds({
          ...world.state,
          transform: world.transform,
        }),
      ];
    });
    if (bounds.length !== nodeIds.length || bounds.length === 0) return null;
    return unionBounds(bounds);
  }

  #selectionIsAxisAligned(nodeIds: readonly string[]): boolean {
    return nodeIds.every((nodeId) => {
      const transform = this.#worldElementState(nodeId)?.transform;
      if (!transform) return false;
      return (
        Math.abs(transform[1]) <= 0.000_001 &&
        Math.abs(transform[2]) <= 0.000_001
      );
    });
  }

  #usesAxisAlignedSelectionBox(nodeIds: readonly string[]): boolean {
    return nodeIds.length > 1 || this.#selectionIsAxisAligned(nodeIds);
  }

  #orientedFrame(nodeId: string) {
    const world = this.#worldElementState(nodeId);
    if (
      !world ||
      world.state.linePoints ||
      world.state.size.width <= 0 ||
      world.state.size.height <= 0
    ) {
      return null;
    }
    return {
      bounds: {
        x: 0,
        y: 0,
        width: world.state.size.width,
        height: world.state.size.height,
      },
      transform: world.transform,
    };
  }

  #worldElementState(nodeId: string): {
    state: DirectTransformElementState;
    transform: Transform;
  } | null {
    const document = this.#currentDocument();
    const node = document?.nodesById[nodeId];
    const element = this.#element(nodeId);
    if (!document || !node || !element) return null;
    const parentTransform = node.parentId
      ? getVisibleWorldTransform(document.nodesById, node.parentId)
      : IDENTITY_TRANSFORM;
    if (!parentTransform) return null;
    const state = readDirectTransformElementState(element);
    return {
      state,
      transform: multiplyTransforms(parentTransform, state.transform),
    };
  }

  #translate(
    nodeIds: readonly string[],
    delta: { x: number; y: number },
  ): boolean {
    const document = this.#currentDocument();
    if (!document) return false;
    const updates = nodeIds.flatMap((nodeId) => {
      const node = document.nodesById[nodeId];
      const element = this.#element(nodeId);
      const parentTransform = node?.parentId
        ? getVisibleWorldTransform(document.nodesById, node.parentId)
        : IDENTITY_TRANSFORM;
      const inverse = parentTransform && invertTransform(parentTransform);
      if (!node || !element || !inverse) return [];
      const origin = transformPoint({ x: 0, y: 0 }, inverse);
      const translated = transformPoint(delta, inverse);
      return [
        {
          element,
          localDelta: {
            x: translated.x - origin.x,
            y: translated.y - origin.y,
          },
        },
      ];
    });
    if (updates.length !== nodeIds.length) return false;
    updates.forEach(({ element, localDelta }) => {
      const transform = element.localTransform;
      element.setTransform({
        a: transform.a,
        b: transform.b,
        c: transform.c,
        d: transform.d,
        e: transform.e + localDelta.x,
        f: transform.f + localDelta.y,
      });
    });
    return true;
  }
}

function snapInput(
  input: LeaferEngineSyncInput,
  nodeIds: readonly string[],
  excludedNodeIds: ReadonlySet<string>,
) {
  return {
    document: input.document,
    excludedNodeIds,
    nodeIds,
    pageId: input.pageId,
    rulerGuidesVisible: input.rulerGuidesVisible === true,
    settings: input.snapSettings ?? {
      geometry: false,
      objects: false,
      pixelGrid: false,
    },
    viewport: input.viewport,
  };
}

function controlKeyId(event: KeyboardEvent): string | null {
  if (event.code === "ControlLeft" || event.code === "ControlRight") {
    return event.code;
  }
  return event.key === "Control" ? "Control" : null;
}

function shiftKeyId(event: KeyboardEvent): string | null {
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    return event.code;
  }
  return event.key === "Shift" ? "Shift" : null;
}

function topLevelNodeIds(
  document: DesignDocument,
  nodeIds: readonly string[],
): string[] {
  const selected = new Set(nodeIds);
  return nodeIds.filter((nodeId) => {
    const visited = new Set<string>();
    let parentId = document.nodesById[nodeId]?.parentId ?? null;
    while (parentId) {
      if (selected.has(parentId)) return false;
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      parentId = document.nodesById[parentId]?.parentId ?? null;
    }
    return true;
  });
}

function unionBounds(bounds: readonly Rect[]): Rect {
  const left = Math.min(...bounds.map(({ x }) => x));
  const top = Math.min(...bounds.map(({ y }) => y));
  const right = Math.max(...bounds.map(({ x, width }) => x + width));
  const bottom = Math.max(...bounds.map(({ y, height }) => y + height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function originalScale(input: { scaleX: number; scaleY: number }) {
  return { scaleX: input.scaleX, scaleY: input.scaleY };
}

function resizeOrigin(bounds: Rect, direction: number, aroundCenter: boolean) {
  const axes = resizeAxes(direction);
  if (aroundCenter) {
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }
  return {
    x:
      axes.horizontal === "start"
        ? bounds.x + bounds.width
        : axes.horizontal === "end"
          ? bounds.x
          : bounds.x + bounds.width / 2,
    y:
      axes.vertical === "start"
        ? bounds.y + bounds.height
        : axes.vertical === "end"
          ? bounds.y
          : bounds.y + bounds.height / 2,
  };
}
