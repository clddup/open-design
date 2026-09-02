import type {
  DesignDocument,
  Rect,
  Transform,
} from "@opendesign/design-contracts";
import type { SnapGuideLine } from "@opendesign/geometry-service/snapping";
import type * as LeaferEditorModule from "leafer-editor";
import { DirectMoveSnapController } from "./direct-move-snap-controller.js";
import {
  directTransformElementBounds,
  readDirectTransformElementState,
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
  #active = false;
  readonly #controlKeys = new Set<string>();
  readonly #currentDocument: () => DesignDocument | null;
  readonly #element: (nodeId: string) => LeaferElement | undefined;
  readonly #snap: DirectMoveSnapController;

  constructor(options: {
    currentDocument: () => DesignDocument | null;
    element: (nodeId: string) => LeaferElement | undefined;
    onLines: (lines: readonly SnapGuideLine[]) => void;
  }) {
    this.#currentDocument = options.currentDocument;
    this.#element = options.element;
    this.#snap = new DirectMoveSnapController({
      onLines: options.onLines,
      selectionBounds: (nodeIds) => this.#selectionBounds(nodeIds),
      translate: (nodeIds, delta) => this.#translate(nodeIds, delta),
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
    this.#active = true;
    this.#snap.setSuppressed(this.#controlKeys.size > 0);
    this.#snap.begin(
      snapInput(input.engineInput, nodeIds, input.excludedNodeIds),
    );
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
    this.#snap.refresh(
      snapInput(input.engineInput, nodeIds, input.excludedNodeIds),
    );
  }

  update(): void {
    if (this.#active) this.#snap.update();
  }

  syncViewport(input: LeaferEngineSyncInput): void {
    if (this.#active) this.#snap.syncViewport(input.viewport);
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const key = controlKeyId(event);
    if (!key) return false;
    this.#controlKeys.add(key);
    this.#snap.setSuppressed(true);
    return true;
  }

  handleKeyUp(event: KeyboardEvent): boolean {
    const key = controlKeyId(event);
    if (!key) return false;
    this.#controlKeys.delete(key);
    this.#snap.setSuppressed(this.#controlKeys.size > 0);
    return true;
  }

  resetModifiers(): void {
    if (this.#controlKeys.size === 0) return;
    this.#controlKeys.clear();
    this.#snap.setSuppressed(false);
  }

  finish(): void {
    this.#active = false;
    this.#snap.finish();
  }

  cancel(): void {
    this.#active = false;
    this.#snap.cancel();
  }

  #selectionBounds(nodeIds: readonly string[]): Rect | null {
    const document = this.#currentDocument();
    if (!document) return null;
    const bounds = nodeIds.flatMap((nodeId) => {
      const node = document.nodesById[nodeId];
      const element = this.#element(nodeId);
      if (!node || !element) return [];
      const parentTransform = node.parentId
        ? getVisibleWorldTransform(document.nodesById, node.parentId)
        : IDENTITY_TRANSFORM;
      if (!parentTransform) return [];
      const state = readDirectTransformElementState(element);
      return [
        directTransformElementBounds({
          ...state,
          transform: multiplyTransforms(parentTransform, state.transform),
        }),
      ];
    });
    if (bounds.length !== nodeIds.length || bounds.length === 0) return null;
    return unionBounds(bounds);
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
    settings: input.snapSettings ?? { objects: false, pixelGrid: false },
    viewport: input.viewport,
  };
}

function controlKeyId(event: KeyboardEvent): string | null {
  if (event.code === "ControlLeft" || event.code === "ControlRight") {
    return event.code;
  }
  return event.key === "Control" ? "Control" : null;
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
