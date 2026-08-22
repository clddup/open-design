import type { Point } from "@opendesign/design-contracts";
import {
  createImageCropSession,
  imageCropSourceTransform,
  moveImageCrop,
  resetImageCrop,
  resolveImagePlacement,
  setImageCropZoom,
  type ImageCropSession as ImageCropGeometrySession,
} from "@opendesign/image-service";
import type * as LeaferEditorModule from "leafer-editor";
import type { LeaferElementSpec, LeaferSceneProjection } from "./mapping.js";
import { matrixRelativeToParent, transformToAffine } from "./affine.js";
import { asLeaferEvent } from "./pointer-event.js";
import {
  getVisibleWorldTransform,
  multiplyTransforms,
} from "./scene-node-transform.js";
import type {
  LeaferCanvasTool,
  LeaferEngineSyncInput,
  LeaferImageCropState,
} from "./types.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

interface ImageCropSession {
  cropOutline: LeaferElement;
  documentId: string;
  drag: { before: ImageCropGeometrySession; startLocal: Point } | null;
  geometry: ImageCropGeometrySession;
  hitArea: LeaferElement;
  imageElement: LeaferElement;
  nodeId: string;
  overlayGroup: LeaferGroup;
  pageId: string;
  revision: number;
  sourceOutline: LeaferElement;
}

interface ImageCropCurrentState {
  baseProjection: LeaferSceneProjection | null;
  disposed: boolean;
  input: LeaferEngineSyncInput | null;
  projection: LeaferSceneProjection | null;
}

export interface ImageCropControllerOptions {
  applySpecData: (element: LeaferElement, spec: LeaferElementSpec) => void;
  current: () => ImageCropCurrentState;
  element: (nodeId: string) => LeaferElement | undefined;
  finishNodePresentation: (nodeId: string) => void;
  leafer: LeaferModule;
  onCommit: (request: {
    nodeId: string;
    placement: ImageCropGeometrySession["current"];
  }) => boolean;
  onStateChange: (state: LeaferImageCropState | null) => void;
  presentationRoot: LeaferGroup;
  report: (error: unknown) => void;
  scheduleBounds: (nodeId: string) => void;
  syncTool: (tool: LeaferCanvasTool) => void;
  viewportRoot: LeaferGroup;
}

const MATRIX_EPSILON = 0.000_001;
const IMAGE_CROP_COLOR = "#4f7fff";
const IMAGE_CROP_SOURCE_COLOR = "rgba(255, 255, 255, 0.88)";

export class ImageCropController {
  readonly #options: ImageCropControllerOptions;
  #session: ImageCropSession | null = null;

  constructor(options: ImageCropControllerOptions) {
    this.#options = options;
  }

  get active(): boolean {
    return this.#session !== null;
  }

  syncInput(input: LeaferEngineSyncInput): void {
    const session = this.#session;
    if (
      session &&
      (session.documentId !== input.document.documentId ||
        session.pageId !== input.pageId ||
        session.revision !== input.document.revision ||
        input.tool !== "select" ||
        input.selection.nodeIds.length !== 1 ||
        input.selection.nodeIds[0] !== session.nodeId)
    ) {
      this.#clear(true, true);
    }
  }

  start(nodeId: string): boolean {
    const current = this.#options.current();
    if (current.disposed) return false;
    if (this.#session?.nodeId === nodeId) return true;
    if (this.#session) this.#clear(true, true);
    const input = current.input;
    const node = input?.document.nodesById[nodeId];
    const asset =
      node?.kind === "image"
        ? input?.document.assetsById[node.properties.assetId]
        : undefined;
    const imageElement = this.#options.element(nodeId);
    const spec = current.projection?.elementsById.get(nodeId);
    if (
      !input ||
      input.tool !== "select" ||
      input.selection.nodeIds.length !== 1 ||
      input.selection.nodeIds[0] !== nodeId ||
      !node ||
      node.kind !== "image" ||
      !asset ||
      asset.kind !== "image" ||
      !asset.size ||
      !imageElement ||
      !spec ||
      spec.kind !== "image" ||
      isLockedSpec(spec)
    ) {
      return false;
    }
    let geometry: ImageCropGeometrySession;
    try {
      geometry = createImageCropSession({
        placement: node.properties.placement,
        sourceSize: asset.size,
        targetSize: node.size,
      });
    } catch (error) {
      this.#options.report(error);
      return false;
    }
    const overlayGroup = new this.#options.leafer.Group({
      editable: false,
      hittable: false,
      visible: true,
    }) as LeaferGroup;
    const sourceOutline = new this.#options.leafer.Rect({
      dashPattern: [6, 4],
      editable: false,
      fill: "rgba(0, 0, 0, 0)",
      height: asset.size.height,
      hittable: false,
      stroke: IMAGE_CROP_SOURCE_COLOR,
      strokeAlign: "inside",
      width: asset.size.width,
    }) as LeaferElement;
    const cropOutline = new this.#options.leafer.Rect({
      editable: false,
      fill: "rgba(0, 0, 0, 0)",
      height: node.size.height,
      hittable: false,
      stroke: IMAGE_CROP_COLOR,
      strokeAlign: "inside",
      width: node.size.width,
    }) as LeaferElement;
    const hitArea = new this.#options.leafer.Rect({
      cursor: "move",
      editable: false,
      fill: "rgba(79, 127, 255, 0.001)",
      height: node.size.height,
      hittable: true,
      id: imageCropHitAreaId(nodeId),
      width: node.size.width,
    }) as LeaferElement;
    overlayGroup.add(sourceOutline);
    overlayGroup.add(cropOutline);
    overlayGroup.add(hitArea);
    this.#options.presentationRoot.add(overlayGroup);
    this.#session = {
      cropOutline,
      documentId: input.document.documentId,
      drag: null,
      geometry,
      hitArea,
      imageElement,
      nodeId,
      overlayGroup,
      pageId: input.pageId,
      revision: input.document.revision,
      sourceOutline,
    };
    this.#options.finishNodePresentation(nodeId);
    this.#options.syncTool(input.tool);
    this.#applyPreview();
    this.syncViewport();
    this.#publishState();
    return true;
  }

  updateZoom(zoom: number): boolean {
    const session = this.#session;
    if (!session || session.drag || this.#options.current().disposed) {
      return false;
    }
    try {
      session.geometry = setImageCropZoom(session.geometry, zoom);
      this.#applyPreview();
      this.#publishState();
      return true;
    } catch (error) {
      this.#options.report(error);
      return false;
    }
  }

  reset(): boolean {
    const session = this.#session;
    if (!session || session.drag || this.#options.current().disposed) {
      return false;
    }
    session.geometry = resetImageCrop(session.geometry);
    this.#applyPreview();
    this.#publishState();
    return true;
  }

  finish(): boolean {
    const session = this.#session;
    if (!session || this.#options.current().disposed) return false;
    if (session.drag) {
      session.geometry = session.drag.before;
      session.drag = null;
      this.#applyPreview();
    }
    const placement = structuredClone(session.geometry.current);
    if (sameStructuredValue(placement, session.geometry.original)) {
      this.#clear(true, true);
      return true;
    }
    const accepted = this.#options.onCommit({
      nodeId: session.nodeId,
      placement,
    });
    this.#clear(!accepted, true);
    return accepted;
  }

  cancel(): boolean {
    if (!this.#session) return false;
    this.#clear(true, true);
    return true;
  }

  dispose(): void {
    this.#clear(false, false);
  }

  syncViewport(): void {
    const session = this.#session;
    const input = this.#options.current().input;
    if (!session || !input) return;
    const world = getVisibleWorldTransform(
      input.document.nodesById,
      session.nodeId,
    );
    if (!world) {
      session.overlayGroup.visible = false;
      return;
    }
    const viewport = this.#options.viewportRoot.localTransform;
    const desired = transformToAffine(
      multiplyTransforms(
        [
          viewport.a,
          viewport.b,
          viewport.c,
          viewport.d,
          viewport.e,
          viewport.f,
        ],
        world,
      ),
    );
    const relative = matrixRelativeToParent(
      this.#options.presentationRoot.localTransform,
      desired,
      MATRIX_EPSILON,
    );
    if (!relative) {
      session.overlayGroup.visible = false;
      return;
    }
    session.overlayGroup.setTransform(relative);
    session.overlayGroup.visible = true;
    const zoom = Math.max(MATRIX_EPSILON, Math.abs(viewport.a || 1));
    session.cropOutline.set({ strokeWidth: 1.5 / zoom });
    session.sourceOutline.set({ strokeWidth: 1 / zoom });
  }

  restoreProjection(): void {
    this.#applyPreview();
    this.syncViewport();
  }

  pointerDown(event: unknown): void {
    const session = this.#session;
    if (!session || session.drag || this.#options.current().disposed) return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel || pointer.right || pointer.middle) return;
    if (pointer.target !== session.hitArea) {
      this.finish();
      return;
    }
    session.drag = {
      before: structuredClone(session.geometry),
      startLocal: pointer.getInnerPoint(session.overlayGroup),
    };
  }

  pointerMove(event: unknown): void {
    const session = this.#session;
    const drag = session?.drag;
    if (!session || !drag || this.#options.current().disposed) return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel) return;
    const local = pointer.getInnerPoint(session.overlayGroup);
    try {
      session.geometry = moveImageCrop(drag.before, {
        x: local.x - drag.startLocal.x,
        y: local.y - drag.startLocal.y,
      });
      this.#applyPreview();
      this.#publishState();
    } catch (error) {
      this.#options.report(error);
    }
  }

  pointerUp(event: unknown): void {
    const session = this.#session;
    const drag = session?.drag;
    if (!session || !drag) return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel) {
      session.geometry = drag.before;
      session.drag = null;
      this.#applyPreview();
      this.#publishState();
      return;
    }
    this.pointerMove(event);
    session.drag = null;
  }

  #publishState(): void {
    const session = this.#session;
    this.#options.onStateChange(
      session
        ? {
            nodeId: session.nodeId,
            placement: structuredClone(session.geometry.current),
          }
        : null,
    );
  }

  #applyPreview(): void {
    const session = this.#session;
    const spec = session
      ? this.#options.current().baseProjection?.elementsById.get(session.nodeId)
      : undefined;
    if (!session || !spec) return;
    const resolved = resolveImagePlacement({
      placement: session.geometry.current,
      sourceSize: session.geometry.sourceSize,
      targetSize: session.geometry.targetSize,
    });
    const fill = spec.data.fill;
    if (
      resolved.mode !== "clip" ||
      typeof fill !== "object" ||
      fill === null ||
      (fill as { type?: unknown }).type !== "image"
    ) {
      return;
    }
    setLeaferElementData(session.imageElement, {
      fill: {
        ...(fill as Record<string, unknown>),
        mode: "clip",
        offset: resolved.offset,
        rotation: resolved.rotation,
        scale: resolved.scale,
      },
    });
    session.sourceOutline.setTransform(
      transformToAffine(imageCropSourceTransform(session.geometry)),
    );
  }

  #clear(restore: boolean, publish: boolean): void {
    const session = this.#session;
    if (!session) return;
    this.#session = null;
    session.overlayGroup.remove();
    session.overlayGroup.destroy();
    if (restore) {
      const spec = this.#options
        .current()
        .baseProjection?.elementsById.get(session.nodeId);
      if (spec) this.#options.applySpecData(session.imageElement, spec);
    }
    this.#options.syncTool(this.#options.current().input?.tool ?? "select");
    this.#options.scheduleBounds(session.nodeId);
    if (publish) this.#options.onStateChange(null);
  }
}

function isLockedSpec(spec: LeaferElementSpec | undefined): boolean {
  return (
    spec?.data.locked === true ||
    spec?.data.editable === false ||
    spec?.data.moveable === false
  );
}

function imageCropHitAreaId(nodeId: string): string {
  return `__opendesign_image_crop_hit__:${nodeId}`;
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function setLeaferElementData(
  element: LeaferElement,
  data: Record<string, unknown>,
): void {
  element.set(data);
}
