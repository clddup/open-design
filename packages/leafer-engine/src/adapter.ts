import type {
  ComponentSelectionTarget,
  DesignChangeSet,
  SelectionState,
  VectorPointMode,
  ViewportState,
} from "@opendesign/design-contracts";
import { componentSourcePathKey } from "@opendesign/component-service";
import {
  isRasterExportRequest,
  type RasterExportRequest,
} from "@opendesign/import-export-service/raster";
import type {
  TextLayoutProvider,
  TextRunLayoutProvider,
} from "@opendesign/text-service";
import type * as LeaferEditorModule from "leafer-editor";
import {
  LEAFER_EDITOR_SELECTION_COLOR,
  type LeaferElementSpec,
  type LeaferSceneProjection,
} from "./mapping.js";
import type { GenerationTweenEndpoint } from "./generation-tween.js";
import { createLeaferTextLayoutProvider } from "./text-layout.js";
import {
  createLeaferTextRunLayoutProvider,
  type LeaferTextRunStyle,
} from "./text-run-layout.js";
import { TextRunEditController } from "./text-run-edit-controller.js";
import { TextEditDomController } from "./text-edit-dom-controller.js";
import {
  projectionNodeId,
  textRunProjectionNodeIds,
} from "./text-run-projection.js";
import { exportLeaferCapture } from "./capture-export.js";
import {
  createProjectionExportTarget,
  type ProjectionExportRequest,
} from "./projection-export-target.js";
import { exportLeaferRaster } from "./raster-export.js";
import { installLeaferImagePaintAdjustmentFilter } from "./image-paint-adjustment-filter.js";
import { transformToAffine } from "./affine.js";
import { EditorOverlayController } from "./editor-overlay-controller.js";
import type {
  LeaferCaptureResult,
  LeaferCaptureTarget,
  LeaferCanvasTool,
  LeaferEngineAdapter,
  LeaferEngineCallbacks,
  LeaferEngineOptions,
  LeaferEngineSyncInput,
  LeaferRasterExportResult,
  LeaferTextStyleUpdate,
} from "./types.js";
import { BoxDrawController } from "./box-draw-controller.js";
import { BoxSelectController } from "./box-select-controller.js";
import {
  DirectTransformController,
  type DirectTransformElementState,
} from "./direct-transform-controller.js";
import { ImageCropController } from "./image-crop-controller.js";
import { PenToolController } from "./pen-tool-controller.js";
import { VectorEditController } from "./vector-edit-controller.js";
import { asLeaferEvent } from "./pointer-event.js";
import { SceneReconciler } from "./scene-reconciler.js";
import { GenerationPresentationController } from "./generation-presentation-controller.js";
import { SceneProjectionController } from "./scene-projection-controller.js";
import { LeaferFrameScheduler } from "./frame-scheduler.js";
import { LeaferAdapterEventController } from "./adapter-event-controller.js";
import {
  LayerHoverController,
  type LayerHoverChromeResource,
} from "./layer-hover-controller.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferApp = InstanceType<LeaferModule["App"]>;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;
type LeaferEditor = InstanceType<LeaferModule["Editor"]>;

const MATRIX_EPSILON = 0.000_001;
const MIN_VIEWPORT_ZOOM = 0.1;
const MAX_VIEWPORT_ZOOM = 8;
const WHEEL_ZOOM_SPEED = 0.16;
const MAX_CAPTURE_WIDTH = 1_280;
const MAX_CAPTURE_HEIGHT = 960;

export async function createLeaferEngineAdapter(
  host: HTMLElement,
  callbacks: LeaferEngineCallbacks,
  options: LeaferEngineOptions = {},
): Promise<LeaferEngineAdapter> {
  const leafer = await import("leafer-editor");
  installLeaferImagePaintAdjustmentFilter(leafer);
  return new WebLeaferEngineAdapter(host, callbacks, leafer, options);
}

class WebLeaferEngineAdapter implements LeaferEngineAdapter {
  readonly textLayoutProvider: TextLayoutProvider;
  readonly textRunLayoutProvider: TextRunLayoutProvider<LeaferTextRunStyle>;
  readonly #app: LeaferApp;
  readonly #callbacks: LeaferEngineCallbacks;
  readonly #host: HTMLElement;
  readonly #leafer: LeaferModule;
  readonly #editor: LeaferEditor;
  readonly #events: LeaferAdapterEventController;
  readonly #layerHover: LayerHoverController<LeaferElement>;
  readonly #generationPresentation: GenerationPresentationController;
  readonly #generationPresentationRoot: LeaferGroup;
  readonly #editorOverlays: EditorOverlayController;
  readonly #boxDrawController: BoxDrawController;
  readonly #boxSelectController: BoxSelectController;
  readonly #directTransformController: DirectTransformController;
  readonly #imageCropController: ImageCropController;
  readonly #penToolController: PenToolController;
  readonly #scene: SceneReconciler;
  readonly #sceneProjection: SceneProjectionController;
  readonly #frameScheduler: LeaferFrameScheduler;
  readonly #textEditDomController: TextEditDomController<LeaferElement>;
  readonly #textRunEditor: TextRunEditController<LeaferElement>;
  readonly #vectorEditController: VectorEditController;
  #disposed = false;
  #input: LeaferEngineSyncInput | null = null;
  #projectionDirty = false;
  #synchronizing = false;

  constructor(
    host: HTMLElement,
    callbacks: LeaferEngineCallbacks,
    leafer: LeaferModule,
    options: LeaferEngineOptions,
  ) {
    this.#host = host;
    this.#callbacks = callbacks;
    this.#leafer = leafer;
    this.textLayoutProvider = createLeaferTextLayoutProvider(leafer);
    this.textRunLayoutProvider = createLeaferTextRunLayoutProvider(leafer);
    this.#app = new leafer.App({
      view: host,
      type: "design",
      wheel: {
        zoomSpeed: WHEEL_ZOOM_SPEED,
      },
      zoom: {
        min: MIN_VIEWPORT_ZOOM,
        max: MAX_VIEWPORT_ZOOM,
      },
      editor: {
        beforeEditInner: ({ target }) =>
          this.#textRunEditor.beforeEditInner(
            this.#scene.projectionId(target as LeaferElement),
          ),
        editSize: "size",
        multipleSelect: true,
        multipleSelectKey: (event: {
          ctrlKey?: boolean;
          metaKey?: boolean;
          shiftKey?: boolean;
        }) => Boolean(event.ctrlKey || event.metaKey || event.shiftKey),
        boxSelect: "hit",
        hover: false,
        moveable: true,
        resizeable: true,
        rotateable: true,
        selectedPathType: "box",
        selectedStyle: {
          strokeAlign: "inside",
        },
        skewable: true,
        openInner: "double",
        stroke: LEAFER_EDITOR_SELECTION_COLOR,
        strokeWidth: 1.5,
        pointFill: "#ffffff",
        pointSize: 7,
        pointRadius: 2,
      },
    });
    this.#editor = this.#app.editor as LeaferEditor;
    this.#scene = new SceneReconciler({
      editor: this.#editor,
      leafer,
      onWarning: (warning) => this.#callbacks.onWarning?.(warning),
      onWarningsChange: (warnings) =>
        this.#callbacks.onWarningsChange?.(warnings),
      report: (error) => this.#report(error),
      root: this.#app.tree as unknown as LeaferGroup,
      scheduleEditorRefresh: (request) =>
        this.#scheduleEditorRefresh({
          ...(request.nodeBounds
            ? { nodeBounds: new Set(request.nodeBounds) }
            : {}),
          ...(request.treeBounds ? { treeBounds: true } : {}),
        }),
      selectionNodeIds: () => this.#input?.selection.nodeIds ?? [],
    });
    this.#sceneProjection = new SceneProjectionController({
      current: () => ({
        disposed: this.#disposed,
        input: this.#input,
        sceneProjection: this.#scene.projection,
      }),
      ...(options.loadVectorGeometryProvider
        ? { loadVectorGeometryProvider: options.loadVectorGeometryProvider }
        : {}),
      onAsyncProjection: (projection, input) => {
        if (this.#disposed || this.#input !== input) return;
        this.#synchronizing = true;
        try {
          this.#scene.reconcile(projection, {
            reapplyAll: this.#projectionDirty,
          });
          this.#syncSelection(input.selection);
          this.#sceneProjection.commitApplied(input);
          this.#projectionDirty = false;
        } catch (error) {
          this.#projectionDirty = true;
          try {
            this.#restoreProjection();
          } catch (recoveryError) {
            if (recoveryError !== error) this.#report(recoveryError);
          } finally {
            this.#projectionDirty = true;
          }
          throw error;
        } finally {
          this.#synchronizing = false;
        }
      },
      report: (error) => this.#report(error),
    });
    this.#frameScheduler = new LeaferFrameScheduler({
      isDisposed: () => this.#disposed,
      onEditorRefresh: ({ nodeBounds, treeBounds }) => {
        try {
          if (treeBounds) {
            this.#app.tree.forceUpdate("bounds");
          } else {
            nodeBounds.forEach((nodeId) =>
              this.#scene.element(nodeId)?.forceUpdate("bounds"),
            );
          }
          this.#editor.update();
        } catch (error) {
          this.#report(error);
        }
      },
      onViewportFrame: () => this.#emitViewport(),
    });
    // World-space editing presentation belongs to Leafer's built-in editor sky.
    // The sky is the same viewport plane used by selection chrome, so a pan or
    // zoom cannot advance the document and overlays on independently scheduled
    // canvases. Keep these layers below the Editor child and non-interactive.
    this.#generationPresentationRoot = this.#app.sky as unknown as LeaferGroup;
    this.#vectorEditController = new VectorEditController({
      callbacks: this.#callbacks,
      current: () => ({ disposed: this.#disposed }),
      element: (nodeId) => this.#scene.element(nodeId),
      finishNodePresentation: (nodeId) =>
        this.#generationPresentation.finishNode(nodeId),
      leafer,
      nodeId: (element) => this.#nodeId(element),
      presentationRoot: this.#generationPresentationRoot,
      report: (error) => this.#report(error),
      restoreProjection: () => this.#restoreProjection(),
      root: this.#app.tree as unknown as LeaferGroup,
    });
    this.#generationPresentation = new GenerationPresentationController({
      editor: this.#editor,
      hasAdjacentViewportPresentation: () => this.#editorOverlays.active,
      host: this.#host,
      isDisposed: () => this.#disposed,
      leafer,
      presentationRoot: this.#generationPresentationRoot,
      report: (error) => this.#report(error),
      scene: this.#scene,
      selectionNodeIds: () => this.#input?.selection.nodeIds ?? [],
      syncAdjacentViewport: () => this.#editorOverlays.syncViewport(),
      viewportRoot: this.#app.tree as unknown as LeaferGroup,
    });
    this.#editorOverlays = new EditorOverlayController({
      element: (nodeId) => this.#scene.element(nodeId),
      finishNodePresentation: (nodeId) =>
        this.#generationPresentation.finishNode(nodeId),
      leafer,
      onAutoLayoutSpacingCommit: (request) =>
        this.#callbacks.onAutoLayoutSpacingCommit?.(request) ?? false,
      onAutoLayoutSpacingInputRequest: (request) =>
        this.#callbacks.onAutoLayoutSpacingInputRequest?.(request),
      onGridTrackDelete: (request) =>
        this.#callbacks.onGridTrackDelete?.(request) ?? false,
      onGridTrackReorder: (request) =>
        this.#callbacks.onGridTrackReorder?.(request) ?? false,
      onGridTrackInputRequest: (request) =>
        this.#callbacks.onGridTrackInputRequest?.(request),
      onGridTrackResize: (request) =>
        this.#callbacks.onGridTrackResize?.(request) ?? false,
      onSmartSelectionSpacing: (request) =>
        this.#callbacks.onSmartSelectionSpacing?.(request) ?? false,
      onSmartSelectionReorder: (request) =>
        this.#callbacks.onSmartSelectionReorder?.(request) ?? false,
      presentationRoot: this.#generationPresentationRoot,
      restoreProjection: () => this.#restoreProjection(),
      viewportRoot: this.#app.tree as unknown as LeaferGroup,
    });
    this.#textRunEditor = new TextRunEditController({
      applySpecData: (element, spec, overrides) =>
        this.#scene.applySpecData(element, spec, overrides),
      current: () => ({
        baseProjection: this.#sceneProjection.baseProjection,
        document: this.#input?.document ?? null,
        projection: this.#scene.projection,
      }),
      element: (projectionId) => this.#scene.element(projectionId),
      openProxy: (projectionId) => {
        const proxy = this.#scene.element(projectionId);
        if (proxy && !this.#disposed) this.#editor.openInnerEditor(proxy, true);
      },
      readText: (element) => readElementText(element),
      scheduleBounds: (nodeId) =>
        this.#scheduleEditorRefresh({ nodeBounds: new Set([nodeId]) }),
      writeText: (element, content) => {
        (element as LeaferElement & { text: string }).text = content;
      },
    });
    this.#textEditDomController = new TextEditDomController({
      currentDocument: () => this.#input?.document ?? null,
      editor: this.#textRunEditor,
      element: (nodeId) => this.#scene.element(nodeId),
      publish: (selection) =>
        this.#callbacks.onTextRangeSelectionChange?.(selection),
      report: (error) => this.#report(error),
      writeText: (element, content) => {
        (element as LeaferElement & { text: string }).text = content;
      },
    });
    this.#imageCropController = new ImageCropController({
      applySpecData: (element, spec) =>
        this.#scene.applySpecData(element, spec),
      current: () => ({
        baseProjection: this.#sceneProjection.baseProjection,
        disposed: this.#disposed,
        input: this.#input,
        projection: this.#scene.projection,
      }),
      element: (nodeId) => this.#scene.element(nodeId),
      finishNodePresentation: (nodeId) => {
        this.#generationPresentation.finishNode(nodeId);
      },
      leafer,
      onCommit: (request) =>
        this.#callbacks.onImageCropCommit?.(request) === true,
      onStateChange: (state) => this.#callbacks.onImageCropStateChange?.(state),
      presentationRoot: this.#generationPresentationRoot,
      report: (error) => this.#report(error),
      scheduleBounds: (nodeId) =>
        this.#scheduleEditorRefresh({ nodeBounds: new Set([nodeId]) }),
      syncTool: (tool) => this.#syncTool(tool),
      viewportRoot: this.#app.tree as unknown as LeaferGroup,
    });
    this.#boxDrawController = new BoxDrawController({
      current: () => ({
        disposed: this.#disposed,
        input: this.#input,
        projection: this.#scene.projection,
      }),
      element: (nodeId) => this.#scene.element(nodeId),
      leafer,
      nodeId: (element) => this.#nodeId(element),
      onCreate: (request) => this.#callbacks.onCreate(request),
      restoreProjection: () => this.#restoreProjection(),
      root: this.#app.tree as unknown as LeaferGroup,
    });
    this.#boxSelectController = new BoxSelectController({
      app: this.#app,
      current: () => ({
        disposed: this.#disposed,
        input: this.#input,
      }),
      editor: this.#editor,
      element: (nodeId) => this.#scene.element(nodeId),
      leafer,
      nodeId: (element) => this.#nodeId(element),
      scheduleEditorRefresh: () => this.#scheduleEditorRefresh(),
    });
    this.#directTransformController = new DirectTransformController({
      canPreviewBoolean: () =>
        !this.#disposed &&
        this.#input?.booleanEditScope !== undefined &&
        !this.#input.booleanEditScope.readOnly &&
        this.#sceneProjection.canPreviewBoolean,
      current: () => ({
        disposed: this.#disposed,
        input: this.#input,
        projection: this.#scene.projection,
        synchronizing: this.#synchronizing,
      }),
      editor: this.#editor,
      element: (nodeId) => this.#scene.element(nodeId),
      finishNodePresentation: (nodeId) => {
        this.#generationPresentation.finishNode(nodeId);
      },
      gridChildCellAt: (frameId, point) =>
        this.#editorOverlays.gridChildCellAt(frameId, point),
      hasComponentTarget: () => this.#selectedComponentTarget() !== undefined,
      nodeId: (element) => this.#nodeId(element),
      onGridChildMove: (request) =>
        this.#callbacks.onGridChildMove?.(request) ?? false,
      onGridChildSpan: (request) =>
        this.#callbacks.onGridChildSpan?.(request) ?? false,
      onOperations: (request) => this.#callbacks.onOperations(request),
      onPreviewBoolean: (states) => this.#previewBooleanTransform(states),
      previewGridChildDrop: (frameId, point) =>
        this.#editorOverlays.previewGridChildDrop(frameId, point),
      previewGridChildSpan: (frameId, nodeId, before, next) =>
        this.#editorOverlays.previewGridChildSpan(
          frameId,
          nodeId,
          before,
          next,
        ),
      restoreProjection: () => this.#restoreProjection(),
    });
    this.#penToolController = new PenToolController({
      current: () => ({
        disposed: this.#disposed,
        input: this.#input,
        projection: this.#scene.projection,
      }),
      element: (nodeId) => this.#scene.element(nodeId),
      leafer,
      nodeId: (element) => this.#nodeId(element),
      onCreate: (request) => this.#callbacks.onCreateVector(request),
      report: (error) => this.#report(error),
      restoreProjection: () => this.#restoreProjection(),
      root: this.#app.tree as unknown as LeaferGroup,
    });
    this.#generationPresentation.mountForeground();
    this.#layerHover = new LayerHoverController<LeaferElement>({
      createChrome: () => {
        const stroker = new leafer.Stroker();
        return {
          get target() {
            return stroker.target as LeaferElement | null;
          },
          get opacity() {
            return stroker.opacity ?? 0;
          },
          mount: (style) => {
            stroker.set({
              hittable: false,
              opacity: style.opacity,
              stroke: style.color,
              strokeAlign: "center",
              strokePathType: "render-path",
              strokeWidth: style.strokeWidth,
            });
            this.#editor.add(stroker);
          },
          show: (element, style) =>
            stroker.setTarget(element, {
              opacity: style.opacity,
              stroke: style.color,
              strokeWidth: style.strokeWidth,
            }),
          clearTarget: () => {
            stroker.target = null as never;
          },
          setOpacity: (opacity) => {
            stroker.opacity = opacity;
          },
          update: () => stroker.update(),
          dispose: () => {
            stroker.remove();
            stroker.destroy();
          },
        } satisfies LayerHoverChromeResource<LeaferElement>;
      },
      componentElement: (target) => this.#componentTargetElement(target),
      element: (nodeId) => this.#scene.element(nodeId),
      projectionId: (element) => this.#scene.projectionId(element),
    });
    // Real pan/zoom gestures are emitted by App, while tree is only the
    // transformed viewport layer. Keep all adjacent sky overlays synchronized
    // from that event boundary rather than waiting for another React sync.
    const viewportChanged = () => {
      this.#scheduleViewport();
      this.#scheduleEditorRefresh();
      this.#vectorEditController.syncViewport();
      this.#editorOverlays.syncViewport();
      this.#imageCropController.syncViewport();
      this.#generationPresentation.syncViewport();
      this.#generationPresentation.scheduleViewportSync();
    };
    this.#events = new LeaferAdapterEventController({
      app: this.#app,
      editor: this.#editor,
      editBox: this.#editor.editBox,
      host: this.#host,
      keyboardTarget: window,
      events: {
        dragStart: leafer.DragEvent.START,
        drag: leafer.DragEvent.DRAG,
        dragEnd: leafer.DragEvent.END,
        editorSelect: leafer.EditorEvent.SELECT,
        beforeMove: leafer.EditorMoveEvent.BEFORE_MOVE,
        beforeScale: leafer.EditorScaleEvent.BEFORE_SCALE,
        beforeRotate: leafer.EditorRotateEvent.BEFORE_ROTATE,
        beforeSkew: leafer.EditorSkewEvent.BEFORE_SKEW,
        move: leafer.EditorMoveEvent.MOVE,
        scale: leafer.EditorScaleEvent.SCALE,
        rotate: leafer.EditorRotateEvent.ROTATE,
        skew: leafer.EditorSkewEvent.SKEW,
        beforeInnerOpen: leafer.InnerEditorEvent.BEFORE_OPEN,
        innerOpen: leafer.InnerEditorEvent.OPEN,
        beforeInnerClose: leafer.InnerEditorEvent.BEFORE_CLOSE,
        innerClose: leafer.InnerEditorEvent.CLOSE,
        pointerDown: leafer.PointerEvent.DOWN,
        pointerMove: leafer.PointerEvent.MOVE,
        pointerUp: leafer.PointerEvent.UP,
        viewportMove: leafer.MoveEvent.MOVE,
        viewportMoveEnd: leafer.MoveEvent.END,
        viewportZoom: leafer.ZoomEvent.ZOOM,
        viewportZoomEnd: leafer.ZoomEvent.END,
        viewportResize: leafer.ResizeEvent.RESIZE,
        renderChildStart: leafer.RenderEvent.CHILD_START,
      },
      callbacks: {
        onSelection: () => this.#emitSelection(),
        onEditBoxDragStart: () => this.#directTransformController.begin(),
        onEditBoxDragEnd: (event) => {
          if (gestureWasCancelled(event)) {
            this.#directTransformController.cancel(true);
            return;
          }
          this.#directTransformController.finish();
        },
        onBeforeTransform: (mode) =>
          this.#directTransformController.begin(mode),
        onTransformChanged: () => this.#directTransformController.markChanged(),
        onBeforeInnerOpen: (event) => {
          const element =
            (event as { editTarget?: LeaferElement } | undefined)?.editTarget ??
            this.#editor.list[0];
          const nodeId = element && this.#nodeId(element as LeaferElement);
          if (
            nodeId &&
            element === this.#scene.element(nodeId) &&
            this.#textRunEditor.begin(nodeId)
          ) {
            this.#generationPresentation.finishNode(nodeId);
          }
        },
        onInnerOpen: (event) => {
          const root = (
            event as { innerEditor?: { editDom?: HTMLDivElement } } | undefined
          )?.innerEditor?.editDom;
          if (root) this.#textEditDomController.attach(root);
        },
        onBeforeInnerClose: () => this.#textEditDomController.detach(true),
        onInnerClose: () => this.#finishTextEdit(),
        onDragStart: (event) => {
          this.#boxSelectController.start(event);
          this.#boxDrawController.start(event);
        },
        onDrag: (event) => this.#boxDrawController.update(event),
        onDragEnd: (event) => {
          this.#boxSelectController.finish(event);
          this.#boxDrawController.finish(event);
        },
        onPointerDown: (event) => {
          if (this.#editorOverlays.pointerDown(asLeaferEvent(event))) return;
          this.#imageCropController.pointerDown(event);
          this.#penToolController.pointerDown(event);
          this.#vectorEditController.pointerDown(event);
        },
        onPointerMove: (event) => {
          if (this.#editorOverlays.pointerMove(asLeaferEvent(event))) return;
          this.#imageCropController.pointerMove(event);
          this.#penToolController.pointerMove(event);
          this.#vectorEditController.pointerMove(event);
        },
        onPointerUp: (event) => {
          if (this.#editorOverlays.pointerUp(asLeaferEvent(event))) return;
          this.#imageCropController.pointerUp(event);
          this.#penToolController.pointerUp(event);
          this.#vectorEditController.pointerUp(event);
        },
        onViewportChanged: viewportChanged,
        // Programmatic viewport sync may settle tree and sky in different
        // callbacks; reconcile adjacent chrome at the actual render boundary.
        onRenderChildStart: () => {
          this.#editorOverlays.syncViewport();
          this.#imageCropController.syncViewport();
          this.#generationPresentation.syncViewport();
        },
        onKeyDown: (event) => this.#onWindowKeyDown(event),
        onKeyUp: (event) => this.#onWindowKeyUp(event),
        onContextLost: (event) => this.#onContextLost(event),
      },
    });
  }

  sync(input: LeaferEngineSyncInput): void {
    if (this.#disposed) return;
    const forceFullProjection = this.#projectionDirty;
    const previous = this.#input;
    const identityChanged =
      !previous ||
      previous.document.documentId !== input.document.documentId ||
      previous.pageId !== input.pageId;
    const documentSceneChanged =
      forceFullProjection ||
      identityChanged ||
      previous?.document.revision !== input.document.revision;
    const textRunProjectionChanged =
      previous?.textRunProjection !== input.textRunProjection;
    const sceneChanged =
      forceFullProjection || documentSceneChanged || textRunProjectionChanged;
    this.#boxDrawController.syncInput(input);
    this.#boxSelectController.syncInput(input);
    this.#directTransformController.syncInput(input);
    this.#imageCropController.syncInput(input);
    this.#penToolController.prepareSync(input, sceneChanged);
    this.#vectorEditController.prepareSync(input);
    if (identityChanged) {
      this.#generationPresentation.identityChanged();
    }
    this.#textRunEditor.handleProjectionChange({
      documentChanged: documentSceneChanged,
      identityChanged,
      projectionChanged: textRunProjectionChanged,
    });
    this.#input = input;
    const editScopeChanged = !sameBooleanEditScope(
      previous?.booleanEditScope,
      input.booleanEditScope,
    );
    if (sceneChanged || editScopeChanged) {
      this.#directTransformController.cancelPreview();
    }
    let generationTweenStarts:
      ReadonlyMap<string, GenerationTweenEndpoint> | undefined;
    let baseProjectionToCommit: LeaferSceneProjection | undefined;

    this.#synchronizing = true;
    try {
      if (sceneChanged) {
        const contiguousChanges =
          !forceFullProjection &&
          !identityChanged &&
          !textRunProjectionChanged &&
          previous &&
          input.changes?.documentId === input.document.documentId &&
          input.changes.fromRevision === previous.document.revision &&
          input.changes.toRevision === input.document.revision;
        const changedNodeIds = new Set([
          ...(input.changes ? changeSetNodeIds(input.changes) : []),
          ...textRunProjectionNodeIds(previous?.textRunProjection),
          ...textRunProjectionNodeIds(input.textRunProjection),
        ]);
        const baseProjection = this.#sceneProjection.baseFor(
          previous,
          input,
          documentSceneChanged,
          { forceFull: forceFullProjection },
        );
        baseProjectionToCommit = baseProjection;
        const projection = this.#sceneProjection.project(
          input,
          baseProjection,
          editScopeChanged
            ? {
                affectedEditScopeBooleanIds: changedBooleanEditScopeIds(
                  previous,
                  input,
                ),
              }
            : {},
        );
        if (!contiguousChanges || input.reducedMotion === true) {
          this.#generationPresentation.finishTweens();
        } else {
          const requestedTweenNodeIds = new Set(
            input.generationReveal?.tweenNodeIds ?? [],
          );
          const starts = new Map<string, GenerationTweenEndpoint>();
          for (const nodeId of changedNodeIds) {
            const previousSpec =
              this.#scene.projection?.elementsById.get(nodeId);
            const nextSpec = projection.elementsById.get(nodeId);
            const canRetarget =
              requestedTweenNodeIds.has(nodeId) &&
              previousSpec !== undefined &&
              nextSpec !== undefined &&
              previousSpec.tag === nextSpec.tag &&
              previousSpec.parentId === nextSpec.parentId;
            this.#generationPresentation.finishRevealNode(nodeId);
            if (canRetarget) {
              starts.set(
                nodeId,
                this.#generationPresentation.takeTweenStart(
                  nodeId,
                  previousSpec,
                ),
              );
            } else {
              this.#generationPresentation.finishTweenNode(nodeId, true);
            }
          }
          if (starts.size > 0) generationTweenStarts = starts;
        }
        const invalidatesInteraction = (nodeId: string) =>
          changedNodeIds.has(nodeId) ||
          (projection.affectedNodeIds?.has(nodeId) === true &&
            isLockedSpec(projection.elementsById.get(nodeId)));
        this.#boxDrawController.syncProjection({
          changedNodeIds,
          input,
          projection,
          projectionContinuityLost: textRunProjectionChanged,
        });
        this.#boxSelectController.syncProjection({
          input,
          projectionContinuityLost: textRunProjectionChanged,
        });
        this.#directTransformController.syncProjection({
          changedNodeIds,
          input,
          projection,
          projectionContinuityLost: textRunProjectionChanged,
        });
        this.#penToolController.syncProjection({
          changedNodeIds,
          input,
          projection,
          projectionContinuityLost: textRunProjectionChanged,
        });
        this.#vectorEditController.syncProjection({
          changedNodeIds,
          contiguousChanges: contiguousChanges === true,
          identityChanged,
          input,
          projection,
        });
        if (identityChanged) this.#editor.visible = false;
        if (
          this.#editor.innerEditing &&
          (identityChanged ||
            !contiguousChanges ||
            (this.#textRunEditor.activeNodeId !== null &&
              invalidatesInteraction(this.#textRunEditor.activeNodeId)))
        ) {
          this.#editor.closeInnerEditor();
        }
        const hoveredNodeId = this.#editor.hoverTarget
          ? this.#nodeId(this.#editor.hoverTarget as LeaferElement)
          : undefined;
        if (
          this.#editor.hoverTarget &&
          (identityChanged ||
            !contiguousChanges ||
            (hoveredNodeId !== undefined &&
              invalidatesInteraction(hoveredNodeId)))
        ) {
          this.#editor.hoverTarget = null as never;
        }
        this.#scene.reconcile(projection, {
          reapplyAll: forceFullProjection,
        });
      } else if (editScopeChanged && this.#sceneProjection.baseProjection) {
        this.#scene.reconcile(
          this.#sceneProjection.project(
            input,
            this.#sceneProjection.baseProjection,
            {
              affectedEditScopeBooleanIds: changedBooleanEditScopeIds(
                previous,
                input,
              ),
              forceEditScopeAffected: true,
            },
          ),
        );
      }
      this.#vectorEditController.sync(input);
      this.#syncTool(input.tool);
      this.#syncViewport(input.viewport);
      this.#syncSelection(input.selection);
      this.#layerHover.sync(input.layerHoverTarget, {
        tool: input.tool,
        vectorEditing: input.vectorEditScope !== undefined,
        imageCropActive: this.#imageCropController.active,
        projection: this.#scene.projection,
        selectedElements: this.#editor.list as LeaferElement[],
      });
      this.#textRunEditor.syncPresentation();
      this.#editorOverlays.sync(input);
      this.#generationPresentation.syncSkeleton(input.generationSkeleton);
      this.#generationPresentation.syncActivity(
        input.generationActivity,
        input.reducedMotion === true,
      );
      this.#generationPresentation.syncReveal(
        input.generationReveal,
        input.reducedMotion === true,
        generationTweenStarts,
      );
      this.#sceneProjection.commitApplied(input, baseProjectionToCommit);
      this.#projectionDirty = false;
    } catch (error) {
      this.#projectionDirty = true;
      this.#boxDrawController.cancel();
      this.#boxSelectController.cancel();
      this.#directTransformController.cancel();
      this.#penToolController.abortSync();
      this.finishGenerationPresentation();
      this.#report(error);
      try {
        this.#restoreProjection();
        this.#projectionDirty = false;
      } catch (recoveryError) {
        if (recoveryError !== error) this.#report(recoveryError);
      }
    } finally {
      this.#synchronizing = false;
    }
    this.#penToolController.completeSync();
  }

  async capture(target: LeaferCaptureTarget): Promise<LeaferCaptureResult> {
    if (this.#disposed) throw new Error("Leafer capture adapter is disposed");
    this.#generationPresentation.finishReveal();
    const input = this.#input;
    if (!input || input.pageId !== target.pageId) {
      throw new Error("Leafer capture target is not the projected Page");
    }
    await this.#sceneProjection.settlePendingGeometry();
    if (this.#disposed || this.#input !== input) {
      throw new Error("Leafer capture target changed during rendering");
    }
    const sourceLeaf =
      target.kind === "page"
        ? this.#app.tree
        : this.#captureFrameElement(target.nodeId);
    const derived = this.#projectionExportTarget(
      target.kind === "page"
        ? { kind: "page" }
        : { kind: "node", nodeId: target.nodeId },
    );
    const leaf = derived?.element ?? sourceLeaf;
    try {
      return await exportLeaferCapture(
        leaf,
        {
          height: MAX_CAPTURE_HEIGHT,
          width: MAX_CAPTURE_WIDTH,
        },
        { viewCompletionSurface: this.#app.tree },
      );
    } finally {
      derived?.dispose();
    }
  }

  async exportRaster(
    request: RasterExportRequest,
  ): Promise<LeaferRasterExportResult> {
    if (this.#disposed)
      throw new Error("Leafer raster export adapter is disposed");
    if (!isRasterExportRequest(request)) {
      throw new TypeError("Invalid Leafer raster export request");
    }
    this.#generationPresentation.finishReveal();
    const input = this.#input;
    if (!input || input.pageId !== request.pageId) {
      throw new Error("Leafer raster export target is not the projected Page");
    }
    await this.#sceneProjection.settlePendingGeometry();
    if (this.#disposed || this.#input !== input) {
      throw new Error("Leafer raster export target changed during rendering");
    }
    const sourceLeaf = this.#exportElement(request.rootNodeId);
    const derived = this.#projectionExportTarget({
      kind: "node",
      nodeId: request.rootNodeId,
    });
    const leaf = derived?.element ?? sourceLeaf;
    const sourceNode = input.document.nodesById[request.rootNodeId];
    try {
      return await exportLeaferRaster(leaf, request, sourceNode?.kind);
    } finally {
      derived?.dispose();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#events.dispose();
    this.#sceneProjection.dispose();
    this.#textEditDomController.dispose();
    this.#textRunEditor.clear();
    this.#boxDrawController.dispose();
    this.#boxSelectController.dispose();
    this.#directTransformController.dispose();
    this.#penToolController.dispose();
    this.#vectorEditController.dispose();
    this.#imageCropController.dispose();
    this.#generationPresentation.dispose();
    this.#frameScheduler.dispose();
    this.#editorOverlays.dispose();
    this.#layerHover.dispose();
    this.#app.destroy();
    this.#scene.dispose();
  }

  finishGenerationPresentation(): void {
    this.#generationPresentation.finishPresentation();
  }

  startImageCrop(nodeId: string): boolean {
    return this.#imageCropController.start(nodeId);
  }

  updateImageCropZoom(zoom: number): boolean {
    return this.#imageCropController.updateZoom(zoom);
  }

  resetImageCrop(): boolean {
    return this.#imageCropController.reset();
  }

  finishImageCrop(): boolean {
    return this.#imageCropController.finish();
  }

  cancelImageCrop(): boolean {
    return this.#imageCropController.cancel();
  }

  retryBooleanGeometry(): boolean {
    return this.#sceneProjection.retry();
  }

  setVectorPointMode(mode: VectorPointMode): boolean {
    return this.#vectorEditController.setPointMode(mode);
  }

  updateTextEditingStyle(style: LeaferTextStyleUpdate): boolean {
    if (this.#disposed) return false;
    return this.#textEditDomController.updateStyle(style);
  }

  #syncTool(tool: LeaferCanvasTool): void {
    const drawing = tool !== "select";
    const mode = drawing ? "draw" : "normal";
    if (this.#app.mode !== mode) this.#app.mode = mode;
    const showEditor =
      !drawing &&
      !this.#input?.vectorEditScope &&
      !this.#imageCropController.active;
    if (this.#editor.visible !== showEditor) this.#editor.visible = showEditor;
    if (this.#editor.hittable !== showEditor)
      this.#editor.hittable = showEditor;
    if (!showEditor) this.#editor.hoverTarget = null as never;
  }

  #syncViewport(viewport: ViewportState): void {
    const current = this.#app.tree.localTransform;
    if (
      nearlyEqual(current.a, viewport.zoom) &&
      nearlyEqual(current.d, viewport.zoom) &&
      nearlyEqual(current.e, viewport.panX) &&
      nearlyEqual(current.f, viewport.panY) &&
      nearlyEqual(current.b, 0) &&
      nearlyEqual(current.c, 0)
    ) {
      if (!this.#synchronizing) this.#editorOverlays.syncViewport(viewport);
      return;
    }
    this.#app.tree.setTransform({
      a: viewport.zoom,
      b: 0,
      c: 0,
      d: viewport.zoom,
      e: viewport.panX,
      f: viewport.panY,
    });
    this.#generationPresentation.syncViewport();
    if (!this.#synchronizing) this.#editorOverlays.syncViewport(viewport);
    this.#generationPresentation.scheduleViewportSync();
    this.#scheduleEditorRefresh();
  }

  #syncSelection(selection: SelectionState): void {
    const target = this.#selectionElements(selection);
    const current = this.#editor.list;
    if (
      current.length === target.length &&
      current.every((element, index) => element === target[index])
    ) {
      return;
    }
    this.#editor.target = target.length === 0 ? (null as never) : target;
    this.#scheduleEditorRefresh();
  }

  #emitSelection(): void {
    if (this.#synchronizing || this.#disposed) return;
    const nodeIds = [...new Set(this.#selectedNodeIds())];
    const anchorNodeId = nodeIds.at(-1);
    const componentTarget =
      nodeIds.length === 1 ? this.#selectedComponentTarget() : undefined;
    const canonical = this.#selectionElements({
      nodeIds,
      ...(anchorNodeId ? { anchorNodeId } : {}),
      ...(componentTarget ? { componentTarget } : {}),
    });
    const current = this.#editor.list;
    if (
      canonical.length > 0 &&
      (current.length !== canonical.length ||
        current.some((element, index) => element !== canonical[index]))
    ) {
      this.#synchronizing = true;
      try {
        this.#editor.target = canonical;
      } finally {
        this.#synchronizing = false;
      }
      this.#scheduleEditorRefresh();
    }
    if (componentTarget) {
      this.#callbacks.onSelectionChange(nodeIds, anchorNodeId, componentTarget);
    } else {
      this.#callbacks.onSelectionChange(nodeIds, anchorNodeId);
    }
  }

  #selectionElements(selection: SelectionState): LeaferElement[] {
    const componentTarget = selection.componentTarget;
    if (
      selection.nodeIds.length === 1 &&
      componentTarget &&
      componentTarget.instanceId === selection.nodeIds[0]
    ) {
      const target = this.#componentTargetElement(componentTarget);
      if (target) return [target];
    }
    return selection.nodeIds.flatMap((nodeId) => {
      const element = this.#scene.element(nodeId);
      return element ? [element] : [];
    });
  }

  #previewBooleanTransform(
    states: ReadonlyMap<string, DirectTransformElementState>,
  ): void {
    const input = this.#input;
    if (!input || this.#disposed) return;
    const projection = this.#sceneProjection.previewBooleanTransform(
      input,
      states,
    );
    if (!projection) return;
    this.#synchronizing = true;
    try {
      this.#scene.reconcile(projection);
      this.#syncSelection(input.selection);
    } catch (error) {
      this.#projectionDirty = true;
      this.#report(error);
      try {
        this.#restoreProjection();
        this.#projectionDirty = false;
      } catch (recoveryError) {
        if (recoveryError !== error) this.#report(recoveryError);
      }
    } finally {
      this.#synchronizing = false;
    }
  }
  #selectedNodeIds(): string[] {
    return this.#editor.list.flatMap((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return nodeId ? [nodeId] : [];
    });
  }

  #selectedComponentTarget(): ComponentSelectionTarget | undefined {
    if (this.#editor.list.length === 0 || !this.#scene.projection)
      return undefined;
    const targets = new Map<string, ComponentSelectionTarget>();
    for (const candidate of this.#editor.list) {
      const element = candidate as LeaferElement;
      const projectionId = this.#scene.projectionId(element);
      const metadata = projectionId
        ? this.#scene.projection.elementsById.get(projectionId)?.data.data
        : undefined;
      if (!metadata || typeof metadata !== "object") continue;
      const value = (metadata as Record<string, unknown>)
        .opendesignComponentTarget;
      if (!value || typeof value !== "object") continue;
      const instanceId = (value as Record<string, unknown>).instanceId;
      const sourcePath = (value as Record<string, unknown>).sourcePath;
      if (
        typeof instanceId !== "string" ||
        !isStringArray(sourcePath) ||
        sourcePath.length === 0 ||
        this.#nodeId(element) !== instanceId
      ) {
        continue;
      }
      const target = {
        instanceId,
        sourcePath: [...sourcePath] as string[],
      };
      targets.set(
        `${target.instanceId}:${componentSourcePathKey(target.sourcePath)}`,
        target,
      );
    }
    return targets.size === 1 ? [...targets.values()][0] : undefined;
  }

  #componentTargetElement(
    target: ComponentSelectionTarget,
  ): LeaferElement | undefined {
    const targetPath = componentSourcePathKey(target.sourcePath);
    for (const [projectionId, spec] of this.#scene.projection?.elementsById ??
      []) {
      const metadata = spec.data.data;
      if (!metadata || typeof metadata !== "object") continue;
      const value = (metadata as Record<string, unknown>)
        .opendesignComponentTarget;
      if (!value || typeof value !== "object") continue;
      const instanceId = (value as Record<string, unknown>).instanceId;
      const sourcePath = (value as Record<string, unknown>).sourcePath;
      if (
        instanceId === target.instanceId &&
        isStringArray(sourcePath) &&
        componentSourcePathKey(sourcePath) === targetPath
      ) {
        return this.#scene.element(projectionId);
      }
    }
    return undefined;
  }

  #finishTextEdit(): void {
    const result = this.#textRunEditor.finish({
      disposed: this.#disposed,
      synchronizing: this.#synchronizing,
    });
    this.#textEditDomController.finish();
    if (result.kind === "none") return;
    if (result.kind === "restore") {
      this.#restoreProjection();
      return;
    }
    const accepted = this.#callbacks.onOperations({
      kind: "text",
      operations: [
        {
          commandId: `leafer_text_${result.before.nodeId}`,
          type: "commit_text_edit",
          nodeId: result.before.nodeId,
          content: result.content,
          paragraphPatches: result.paragraphPatches,
          ...(result.runs ? { runs: result.runs } : {}),
        },
      ],
      selectionNodeIds: [result.before.nodeId],
    });
    this.#textRunEditor.completeCommit(result, accepted);
    if (!accepted) {
      this.#restoreProjection();
    }
  }

  #scheduleViewport(): void {
    if (this.#synchronizing) return;
    this.#frameScheduler.scheduleViewport();
  }

  #scheduleEditorRefresh(
    options: {
      nodeBounds?: Iterable<string>;
      treeBounds?: boolean;
    } = {},
  ): void {
    this.#frameScheduler.scheduleEditorRefresh(options);
  }

  #emitViewport(): void {
    const input = this.#input;
    if (!input) return;
    const matrix = this.#app.tree.localTransform;
    const bounds = this.#host.getBoundingClientRect();
    const viewport: ViewportState = {
      panX: normalizeNumber(matrix.e),
      panY: normalizeNumber(matrix.f),
      zoom: Math.max(MATRIX_EPSILON, normalizeNumber(Math.abs(matrix.a))),
      width: Math.max(0, bounds.width),
      height: Math.max(0, bounds.height),
    };
    if (sameViewport(viewport, input.viewport)) return;
    this.#callbacks.onViewportChange(viewport);
  }

  #restoreProjection(): void {
    if (!this.#input) return;
    this.#synchronizing = true;
    try {
      const baseProjection = this.#sceneProjection.rebuild(this.#input);
      this.#scene.reconcile(
        this.#sceneProjection.project(this.#input, baseProjection),
        { reapplyAll: true },
      );
      this.#sceneProjection.commitApplied(this.#input, baseProjection);
      this.#syncViewport(this.#input.viewport);
      this.#syncSelection(this.#input.selection);
      this.#textRunEditor.syncPresentation();
      this.#vectorEditController.sync(this.#input);
      this.#imageCropController.restoreProjection();
    } finally {
      this.#synchronizing = false;
    }
  }

  #projectionExportTarget(request: ProjectionExportRequest) {
    const projection = this.#scene.projection;
    if (!projection) return null;
    return createProjectionExportTarget<LeaferElement>(projection, request, {
      addAt: (parent, child, index) => {
        const addAt: unknown = Reflect.get(parent, "addAt");
        if (typeof addAt !== "function") {
          throw new Error("Projection export parent cannot contain children");
        }
        Reflect.apply(addAt, parent, [child, index]);
      },
      applyData: (element, spec) => this.#scene.applySpecData(element, spec),
      create: (tag) => this.#scene.createElement(tag),
      createWrapper: () =>
        new this.#leafer.Group({
          editable: false,
          hittable: false,
          visible: true,
        }),
      setTransform: (element, transform) =>
        element.setTransform(transformToAffine(transform)),
    });
  }

  #captureFrameElement(nodeId: string): LeaferElement {
    const spec = this.#scene.projection?.elementsById.get(nodeId);
    const element = this.#scene.element(nodeId);
    if (!spec || spec.kind !== "frame" || !element) {
      throw new Error(`Leafer capture Frame is unavailable: ${nodeId}`);
    }
    return element;
  }

  #exportElement(nodeId: string): LeaferElement {
    const spec = this.#scene.projection?.elementsById.get(nodeId);
    const element = this.#scene.element(nodeId);
    if (!spec || !element) {
      throw new Error(`Leafer raster export layer is unavailable: ${nodeId}`);
    }
    return element;
  }

  #nodeId(element: LeaferElement): string | undefined {
    const projectionId = this.#scene.projectionId(element);
    if (!projectionId) return undefined;
    return this.#scene.projection
      ? projectionNodeId(this.#scene.projection, projectionId)
      : projectionId;
  }

  #onWindowKeyDown = (event: KeyboardEvent) => {
    if (this.#textEditDomController.handleKeyDown(event)) return;
    if (
      !isKeyboardInputTarget(event.target) &&
      this.#editorOverlays.handleKeyDown(event)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (
      event.code === "Escape" &&
      this.#editorOverlays.dragging &&
      !isKeyboardInputTarget(event.target)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#editorOverlays.cancelDrag();
      return;
    }
    if (
      this.#imageCropController.active &&
      !isKeyboardInputTarget(event.target)
    ) {
      if (event.code === "Escape" || event.code === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === "Escape") this.cancelImageCrop();
        else this.finishImageCrop();
        return;
      }
    }
    if (this.#vectorEditController.handleKeyDown(event)) return;
    if (this.#directTransformController.handleKeyDown(event)) return;
    if (this.#boxSelectController.handleKeyDown(event)) return;
    if (this.#penToolController.handleKeyDown(event)) return;
    if (this.#boxDrawController.handleKeyDown(event)) return;
    if (event.code === "Escape" && this.#editor.innerEditing) {
      this.#textEditDomController.cancel();
    }
  };

  #onWindowKeyUp = (event: KeyboardEvent) => {
    this.#vectorEditController.handleKeyUp(event);
  };

  #onContextLost = (event: Event) => {
    this.cancelImageCrop();
    event.preventDefault();
    this.#callbacks.onError(new Error("Canvas context was lost"));
  };

  #report(error: unknown): void {
    this.#callbacks.onError(
      error instanceof Error ? error : new Error("Leafer rendering failed"),
    );
  }
}

function sameBooleanEditScope(
  left: LeaferEngineSyncInput["booleanEditScope"],
  right: LeaferEngineSyncInput["booleanEditScope"],
): boolean {
  return (
    left?.booleanId === right?.booleanId &&
    left?.readOnly === right?.readOnly &&
    sameStringList(
      left?.selectedOperandIds ?? [],
      right?.selectedOperandIds ?? [],
    )
  );
}

function changedBooleanEditScopeIds(
  previous: LeaferEngineSyncInput | null | undefined,
  current: LeaferEngineSyncInput,
): Set<string> {
  return new Set(
    [
      previous?.booleanEditScope?.booleanId,
      current.booleanEditScope?.booleanId,
    ].filter((nodeId): nodeId is string => nodeId !== undefined),
  );
}

function changeSetNodeIds(changes: DesignChangeSet): Set<string> {
  return new Set([
    ...changes.addedNodeIds,
    ...changes.changedNodeIds,
    ...changes.removedNodeIds,
  ]);
}

function isLockedSpec(spec: LeaferElementSpec | undefined): boolean {
  const metadata = spec?.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignLocked === true
  );
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MATRIX_EPSILON;
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameViewport(left: ViewportState, right: ViewportState): boolean {
  return (
    nearlyEqual(left.panX, right.panX) &&
    nearlyEqual(left.panY, right.panY) &&
    nearlyEqual(left.zoom, right.zoom) &&
    nearlyEqual(left.width, right.width) &&
    nearlyEqual(left.height, right.height)
  );
}

function readElementText(element: LeaferElement): string {
  const text = (element as LeaferElement & { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function gestureWasCancelled(event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { isCancel?: unknown }).isCancel === true
  );
}

function isKeyboardInputTarget(target: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== "undefined" &&
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}
