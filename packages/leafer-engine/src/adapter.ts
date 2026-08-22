import type {
  ComponentSelectionTarget,
  DesignChangeSet,
  DesignDocument,
  DesignOperation,
  Point,
  Rect,
  SelectionState,
  TextRunStyle,
  Transform,
  VectorNetwork,
  VectorPointMode,
  ViewportState,
} from "@opendesign/design-contracts";
import { normalizeLineEndpoints } from "@opendesign/design-contracts";
import { componentSourcePathKey } from "@opendesign/component-service";
import {
  BOOLEAN_GEOMETRY_RESOLVER_VERSION,
  createBooleanGeometryResolver,
  type BooleanGeometryResolution,
  type BooleanGeometryResolver,
} from "@opendesign/geometry-service/boolean-resolver";
import { serializeVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import {
  deleteVectorSelection,
  findVectorPathIdForVertex,
  listVectorVertexHandles,
  moveVectorHandle,
  moveVectorVertices,
  nearestVectorSegmentPoint,
  setVectorPointMode,
  transformVectorVertices,
  type VectorCutLocation,
  type VectorHandleReference,
} from "@opendesign/geometry-service/vector-edit";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import {
  isRasterExportRequest,
  type RasterExportRequest,
} from "@opendesign/import-export-service/raster";
import type {
  TextEditingListCommand,
  TextLayoutProvider,
  TextRunLayoutProvider,
} from "@opendesign/text-service";
import type * as LeaferEditorModule from "leafer-editor";
import {
  LEAFER_EDITOR_SELECTION_COLOR,
  projectBooleanEditScope,
  projectDesignPage,
  projectDesignPageIncrementally,
  projectResolvedBooleanGeometry,
  type LeaferElementSpec,
  type LeaferElementTag,
  type LeaferSceneProjection,
} from "./mapping.js";
import {
  generationRevealPaintState,
  scheduleGenerationReveals,
  type ScheduledGenerationReveal,
} from "./generation-reveal.js";
import {
  createGenerationTweenPlan,
  generationTweenCadence,
  generationTweenFrame,
  type GenerationTweenEndpoint,
  type GenerationTweenFrame,
  type GenerationTweenPlan,
} from "./generation-tween.js";
import { createLeaferTextLayoutProvider } from "./text-layout.js";
import {
  createLeaferTextRunLayoutProvider,
  type LeaferTextRunStyle,
} from "./text-run-layout.js";
import { TextRunEditController } from "./text-run-edit-controller.js";
import {
  projectionNodeId,
  projectTextRunProjection,
  textRunProjectionNodeIds,
} from "./text-run-projection.js";
import { materializeLeaferTextData } from "./text-truncation.js";
import { exportLeaferCapture } from "./capture-export.js";
import {
  createProjectionExportTarget,
  type ProjectionExportRequest,
} from "./projection-export-target.js";
import { exportLeaferRaster } from "./raster-export.js";
import { installLeaferImagePaintAdjustmentFilter } from "./image-paint-adjustment-filter.js";
import {
  generationActivityBadgeWidth,
  generationSkeletonFill,
} from "./generation-presentation-style.js";
import {
  matrixRelativeToParent,
  sameAffineMatrix,
  transformToAffine,
  type AffineMatrix,
} from "./affine.js";
import { EditorOverlayController } from "./editor-overlay-controller.js";
import {
  documentTransformToLocal,
  getVisibleWorldTransform,
} from "./scene-node-transform.js";
import {
  pointInPolygon,
  translateVectorSelectionTransform,
  vectorDocumentSelectionBounds,
  vectorSegmentsInPolygon,
  vectorSegmentSelectionPath,
  vectorLassoPath,
  vectorSelectionResizeTransform,
  vectorSelectionRotationTransform,
  type VectorResizeHandle,
} from "./vector-selection-transform.js";
import type {
  LeaferCaptureResult,
  LeaferCaptureTarget,
  LeaferCanvasTool,
  LeaferEngineAdapter,
  LeaferEngineCallbacks,
  LeaferGenerationActivity,
  LeaferGenerationReveal,
  LeaferGenerationSkeleton,
  LeaferLayerHoverTarget,
  LeaferEngineOptions,
  LeaferEngineSyncInput,
  LeaferOperationKind,
  LeaferRasterExportResult,
  LeaferTextStyleUpdate,
  LeaferVectorEditTool,
} from "./types.js";
import { BoxDrawController } from "./box-draw-controller.js";
import { BoxSelectController } from "./box-select-controller.js";
import { ImageCropController } from "./image-crop-controller.js";
import { PenToolController } from "./pen-tool-controller.js";
import { asLeaferEvent, eventClientPoint } from "./pointer-event.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferApp = InstanceType<LeaferModule["App"]>;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;
type LeaferEditor = InstanceType<LeaferModule["Editor"]>;
type LeaferStroker = InstanceType<LeaferModule["Stroker"]>;

interface ElementState {
  linePoints?: readonly [number, number, number, number];
  size: { height: number; width: number };
  text?: string;
  transform: Transform;
}

interface GenerationSkeletonLabel {
  element: LeaferElement;
  height: number;
  width: number;
  x: number;
  y: number;
}

interface GenerationActivityElements {
  badge: LeaferElement;
  cursor: LeaferElement;
  label: LeaferElement;
}

interface GenerationActivityViewportState {
  badgeWidth: number;
  badgeX: number;
  badgeY: number;
  layerTransform: AffineMatrix;
}

interface GenerationSkeletonViewportState {
  layerTransform: AffineMatrix;
  zoom: number;
}

interface ActiveGenerationTween {
  current: GenerationTweenFrame;
  plan: GenerationTweenPlan;
}

interface TransformSession {
  before: Map<string, ElementState>;
  changed: boolean;
  kind: LeaferOperationKind;
  selectionNodeIds: string[];
}

type VectorEditControl =
  | { kind: "path"; nodeId: string }
  | { kind: "vertex"; nodeId: string; vertexId: string }
  | { kind: "selection-box" }
  | { handle: VectorResizeHandle; kind: "resize" }
  | { kind: "rotate" }
  | {
      kind: "handle";
      nodeId: string;
      reference: VectorHandleReference;
      vertexId: string;
    };

type VectorEditDrag =
  | {
      before: VectorNetwork;
      kind: "vertices";
      moved: boolean;
      startClient: Point;
      startLocal: Point;
      vertexIds: readonly string[];
    }
  | {
      beforeByNode: ReadonlyMap<string, VectorNetwork>;
      bounds: Rect;
      currentDocument: Point;
      handle?: VectorResizeHandle;
      kind: "selection-transform";
      mode: "move" | "resize" | "rotate";
      moved: boolean;
      repositionOffset: Point;
      spaceActionDocument: Point | null;
      spaceBaseOffset: Point | null;
      spaceStartDocument: Point | null;
      startClient: Point;
      startDocument: Point;
      vertexIdsByNode: ReadonlyMap<string, readonly string[]>;
      worldByNode: ReadonlyMap<string, Transform>;
    }
  | {
      before: VectorNetwork;
      kind: "handle";
      moved: boolean;
      reference: VectorHandleReference;
      startClient: Point;
      vertexId: string;
    }
  | {
      clickTarget?: { at: VectorCutLocation; pathId: string };
      currentDocument: Point;
      currentLocal: Point;
      kind: "cut";
      moved: boolean;
      startClient: Point;
      startDocument: Point;
      startLocal: Point;
    };

interface VectorEditSession {
  anchorControls: LeaferElement[];
  cutGuidePath: LeaferElement;
  cutHitPath: LeaferElement;
  drag: VectorEditDrag | null;
  handleControls: LeaferElement[];
  handlePath: LeaferElement;
  lassoPath: LeaferElement;
  network: VectorNetwork;
  nodeId: string;
  overlayGroup: LeaferGroup;
  pathElement: LeaferElement;
  readOnly: boolean;
  segmentSelectionPath: LeaferElement;
  selectedSegmentIds: string[];
  selectedVertexIds: string[];
  tool: LeaferVectorEditTool;
  tracePath: LeaferElement;
}

interface VectorSelectionOverlay {
  box: LeaferElement;
  controls: LeaferElement[];
  group: LeaferGroup;
  hitArea: LeaferElement;
}

interface VectorLassoSession {
  activeNodeId: string;
  lastClient: Point;
  moved: boolean;
  pointsByNode: Map<string, Point[]>;
  startClient: Point;
  toggle: boolean;
}

const MATRIX_EPSILON = 0.000_001;
const MIN_DRAW_DISTANCE = 4;
const MIN_VIEWPORT_ZOOM = 0.1;
const MAX_VIEWPORT_ZOOM = 8;
const WHEEL_ZOOM_SPEED = 0.16;
const VECTOR_CUT_GUIDE_COLOR = "#f248b5";
const MAX_VECTOR_LASSO_POINTS = 4_096;
const LAYER_HOVER_COLOR = "#4f7fff";
const GENERATION_REVEAL_COLOR = "#6574ff";
const MAX_PROCESSED_GENERATION_REVEALS = 128;
const GENERATION_SKELETON_COLOR = "#7c6ee6";
const GENERATION_SKELETON_FILL = "rgba(124, 110, 230, 0.08)";
const MAX_SUPPRESSED_GENERATION_SKELETONS = 128;
const GENERATION_ACTIVITY_BADGE_FILL = "rgba(31, 28, 48, 0.94)";
const GENERATION_ACTIVITY_MOVE_MS = 180;
const MAX_SUPPRESSED_GENERATION_ACTIVITIES = 128;
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
  readonly #generationRevealStroker: LeaferStroker;
  readonly #layerHoverStroker: LeaferStroker;
  readonly #generationActivityElements: GenerationActivityElements;
  readonly #generationActivityLayer: LeaferGroup;
  readonly #generationPresentationRoot: LeaferGroup;
  readonly #generationSkeletonLayer: LeaferGroup;
  readonly #editorOverlays: EditorOverlayController;
  readonly #boxDrawController: BoxDrawController;
  readonly #boxSelectController: BoxSelectController;
  readonly #imageCropController: ImageCropController;
  readonly #penToolController: PenToolController;
  readonly #textRunEditor: TextRunEditController<LeaferElement>;
  readonly #elements = new Map<string, LeaferElement>();
  readonly #loadVectorGeometryProvider: () => Promise<VectorGeometryProvider>;
  #baseProjection: LeaferSceneProjection | null = null;
  #booleanNodeIds = new Set<string>();
  #booleanResolver: BooleanGeometryResolver | null = null;
  #booleanPreviewFrame: number | null = null;
  #geometryLoadError: Error | null = null;
  #geometryLoadGeneration = 0;
  #geometryLoadPromise: Promise<void> | null = null;
  #disposed = false;
  #input: LeaferEngineSyncInput | null = null;
  #projection: LeaferSceneProjection | null = null;
  #synchronizing = false;
  #transform: TransformSession | null = null;
  #activeVectorEditNodeId: string | null = null;
  readonly #vectorEdits = new Map<string, VectorEditSession>();
  readonly #vectorEditControls = new WeakMap<
    LeaferElement,
    VectorEditControl
  >();
  readonly #vectorSelectionOverlay: VectorSelectionOverlay;
  #vectorLasso: VectorLassoSession | null = null;
  #viewportFrame: number | null = null;
  readonly #onDocumentSelectionChange = () => {
    this.#emitTextRangeSelection();
  };
  #textEditComposing = false;
  #textEditDom: HTMLDivElement | null = null;
  #editorFrame: number | null = null;
  #editorRefreshNeedsTreeBounds = false;
  readonly #editorRefreshNodeBounds = new Set<string>();
  #generationPresentationFrame: number | null = null;
  #generationPresentationAverageFrameMs = 16.67;
  #generationPresentationLastFrameAt: number | null = null;
  #generationRevealNextStartAt: number | null = null;
  readonly #generationReveals = new Map<string, ScheduledGenerationReveal>();
  readonly #generationTweens = new Map<string, ActiveGenerationTween>();
  readonly #processedGenerationRevealIds = new Set<string>();
  #generationViewportFrame: number | null = null;
  #generationSkeletonFingerprint: string | null = null;
  #generationSkeletonId: string | null = null;
  readonly #generationSkeletonStrokes: LeaferElement[] = [];
  readonly #generationSkeletonLabels: GenerationSkeletonLabel[] = [];
  readonly #suppressedGenerationSkeletonIds = new Set<string>();
  #generationActivityCurrentPoint: Point | null = null;
  #generationActivityFingerprint: string | null = null;
  #generationActivityFrame: number | null = null;
  #generationActivityId: string | null = null;
  #generationActivityMoveFrom: Point | null = null;
  #generationActivityMoveStartedAt: number | null = null;
  #generationActivityTargetPoint: Point | null = null;
  #generationActivityRevealNodeId: string | null = null;
  #generationActivityViewportState: GenerationActivityViewportState | null =
    null;
  readonly #generationRevealFocusPoints = new Map<string, Point>();
  readonly #suppressedGenerationActivityIds = new Set<string>();
  #generationSkeletonViewportState: GenerationSkeletonViewportState | null =
    null;

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
    this.#loadVectorGeometryProvider =
      options.loadVectorGeometryProvider ?? loadBrowserVectorGeometryProvider;
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
            this.#projectionId(target as LeaferElement),
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
    // World-space editing presentation belongs to Leafer's built-in editor sky.
    // The sky is the same viewport plane used by selection chrome, so a pan or
    // zoom cannot advance the document and overlays on independently scheduled
    // canvases. Keep these layers below the Editor child and non-interactive.
    this.#generationPresentationRoot = this.#app.sky as unknown as LeaferGroup;
    const vectorSelectionGroup = new leafer.Group({
      editable: false,
      hitChildren: true,
      hittable: false,
      visible: false,
    }) as LeaferGroup;
    const vectorSelectionHitArea = new leafer.Rect({
      editable: false,
      fill: "rgba(0, 0, 0, 0.001)",
      hittable: false,
    }) as LeaferElement;
    const vectorSelectionBox = new leafer.Rect({
      editable: false,
      fill: null,
      hittable: false,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
    }) as LeaferElement;
    vectorSelectionGroup.add(vectorSelectionHitArea);
    vectorSelectionGroup.add(vectorSelectionBox);
    this.#generationPresentationRoot.add(vectorSelectionGroup);
    this.#vectorSelectionOverlay = {
      box: vectorSelectionBox,
      controls: [],
      group: vectorSelectionGroup,
      hitArea: vectorSelectionHitArea,
    };
    this.#vectorEditControls.set(vectorSelectionHitArea, {
      kind: "selection-box",
    });
    this.#generationSkeletonLayer = new leafer.Group({
      editable: false,
      hitChildren: false,
      hittable: false,
      visible: false,
    });
    this.#generationPresentationRoot.addAt(this.#generationSkeletonLayer, 0);
    this.#editorOverlays = new EditorOverlayController({
      leafer,
      onGridTrackReorder: (request) =>
        this.#callbacks.onGridTrackReorder?.(request) ?? false,
      presentationRoot: this.#generationPresentationRoot,
      viewportRoot: this.#app.tree as unknown as LeaferGroup,
    });
    this.#textRunEditor = new TextRunEditController({
      applySpecData: (element, spec, overrides) =>
        this.#applyElementSpecData(element, spec, overrides),
      current: () => ({
        baseProjection: this.#baseProjection,
        document: this.#input?.document ?? null,
        projection: this.#projection,
      }),
      element: (projectionId) => this.#elements.get(projectionId),
      openProxy: (projectionId) => {
        const proxy = this.#elements.get(projectionId);
        if (proxy && !this.#disposed) this.#editor.openInnerEditor(proxy, true);
      },
      readText: (element) => readElementText(element),
      scheduleBounds: (nodeId) =>
        this.#scheduleEditorRefresh({ nodeBounds: new Set([nodeId]) }),
      writeText: (element, content) => {
        (element as LeaferElement & { text: string }).text = content;
      },
    });
    this.#imageCropController = new ImageCropController({
      applySpecData: (element, spec) =>
        this.#applyElementSpecData(element, spec),
      current: () => ({
        baseProjection: this.#baseProjection,
        disposed: this.#disposed,
        input: this.#input,
        projection: this.#projection,
      }),
      element: (nodeId) => this.#elements.get(nodeId),
      finishNodePresentation: (nodeId) => {
        this.#finishGenerationRevealNode(nodeId);
        this.#finishGenerationTweenNode(nodeId, true);
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
        projection: this.#projection,
      }),
      element: (nodeId) => this.#elements.get(nodeId),
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
      element: (nodeId) => this.#elements.get(nodeId),
      leafer,
      nodeId: (element) => this.#nodeId(element),
      scheduleEditorRefresh: () => this.#scheduleEditorRefresh(),
    });
    this.#penToolController = new PenToolController({
      current: () => ({
        disposed: this.#disposed,
        input: this.#input,
        projection: this.#projection,
      }),
      element: (nodeId) => this.#elements.get(nodeId),
      leafer,
      nodeId: (element) => this.#nodeId(element),
      onCreate: (request) => this.#callbacks.onCreateVector(request),
      report: (error) => this.#report(error),
      restoreProjection: () => this.#restoreProjection(),
      root: this.#app.tree as unknown as LeaferGroup,
    });
    this.#generationActivityLayer = new leafer.Group({
      editable: false,
      hitChildren: false,
      hittable: false,
      visible: false,
    });
    const activityCursor = new leafer.Path({
      editable: false,
      fill: GENERATION_SKELETON_COLOR,
      hittable: false,
      path: "M 0 0 L 0 18 L 4.5 13.5 L 8.5 21 L 12 19 L 8 11.5 L 15 11.5 Z",
      stroke: "#ffffff",
      strokeJoin: "round",
      strokeWidth: 1,
    });
    const activityBadge = new leafer.Rect({
      cornerRadius: 4,
      editable: false,
      fill: GENERATION_ACTIVITY_BADGE_FILL,
      height: 26,
      hittable: false,
      stroke: "rgba(124, 110, 230, 0.72)",
      strokeAlign: "inside",
      strokeWidth: 1,
      width: 148,
      x: 14,
      y: 16,
    });
    const activityLabel = new leafer.Text({
      editable: false,
      fill: "#ffffff",
      fontFamily: "Inter, sans-serif",
      fontSize: 11,
      fontWeight: 600,
      height: 16,
      hittable: false,
      lineHeight: 14,
      text: "AI",
      textOverflow: "ellipsis",
      width: 132,
      x: 22,
      y: 22,
    });
    this.#generationActivityLayer.add(activityCursor);
    this.#generationActivityLayer.add(activityBadge);
    this.#generationActivityLayer.add(activityLabel);
    this.#generationActivityElements = {
      badge: activityBadge,
      cursor: activityCursor,
      label: activityLabel,
    };
    this.#generationPresentationRoot.addAt(this.#generationActivityLayer, 3);
    this.#generationRevealStroker = new leafer.Stroker();
    this.#generationRevealStroker.set({
      dashPattern: [6, 4],
      hittable: false,
      opacity: 0,
      stroke: GENERATION_REVEAL_COLOR,
      strokeAlign: "center",
      strokePathType: "render-path",
      strokeWidth: 1.25,
    });
    this.#editor.add(this.#generationRevealStroker);
    this.#layerHoverStroker = new leafer.Stroker();
    this.#layerHoverStroker.set({
      hittable: false,
      opacity: 0,
      stroke: LAYER_HOVER_COLOR,
      strokeAlign: "center",
      strokePathType: "render-path",
      strokeWidth: 1,
    });
    this.#editor.add(this.#layerHoverStroker);
    this.#listen();
  }

  sync(input: LeaferEngineSyncInput): void {
    if (this.#disposed) return;
    const previous = this.#input;
    const identityChanged =
      !previous ||
      previous.document.documentId !== input.document.documentId ||
      previous.pageId !== input.pageId;
    const documentSceneChanged =
      identityChanged ||
      previous?.document.revision !== input.document.revision;
    const textRunProjectionChanged =
      previous?.textRunProjection !== input.textRunProjection;
    const sceneChanged = documentSceneChanged || textRunProjectionChanged;
    this.#boxDrawController.syncInput(input);
    this.#boxSelectController.syncInput(input);
    this.#imageCropController.syncInput(input);
    this.#penToolController.prepareSync(input, sceneChanged);
    if (
      !sameStringList(
        previous?.vectorEditScope?.nodes.map((node) => node.nodeId) ?? [],
        input.vectorEditScope?.nodes.map((node) => node.nodeId) ?? [],
      ) ||
      previous?.document.documentId !== input.document.documentId ||
      previous?.pageId !== input.pageId
    ) {
      this.#cancelVectorEdit();
    }
    if (identityChanged) {
      this.#finishGenerationReveal();
      this.#clearGenerationActivity(false);
      this.#clearGenerationSkeleton(false);
      this.#generationRevealFocusPoints.clear();
      this.#processedGenerationRevealIds.clear();
      this.#suppressedGenerationActivityIds.clear();
      this.#suppressedGenerationSkeletonIds.clear();
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
    if (sceneChanged || editScopeChanged) this.#cancelBooleanPreview();
    let generationTweenStarts:
      ReadonlyMap<string, GenerationTweenEndpoint> | undefined;

    this.#synchronizing = true;
    try {
      if (sceneChanged) {
        const contiguousChanges =
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
        const baseProjection = documentSceneChanged
          ? previous && this.#baseProjection && input.changes
            ? projectDesignPageIncrementally(
                this.#baseProjection,
                input.document,
                input.pageId,
                input.changes,
              )
            : projectDesignPage(input.document, input.pageId)
          : (this.#baseProjection ??
            projectDesignPage(input.document, input.pageId));
        this.#baseProjection = baseProjection;
        const projection = this.#projectScene(
          baseProjection,
          undefined,
          editScopeChanged
            ? changedBooleanEditScopeIds(previous, input)
            : undefined,
        );
        if (!contiguousChanges || input.reducedMotion === true) {
          this.#finishGenerationTweens();
        } else {
          const requestedTweenNodeIds = new Set(
            input.generationReveal?.tweenNodeIds ?? [],
          );
          const starts = new Map<string, GenerationTweenEndpoint>();
          for (const nodeId of changedNodeIds) {
            const previousSpec = this.#projection?.elementsById.get(nodeId);
            const nextSpec = projection.elementsById.get(nodeId);
            const canRetarget =
              requestedTweenNodeIds.has(nodeId) &&
              previousSpec !== undefined &&
              nextSpec !== undefined &&
              previousSpec.tag === nextSpec.tag &&
              previousSpec.parentId === nextSpec.parentId;
            this.#finishGenerationRevealNode(nodeId);
            if (canRetarget) {
              starts.set(
                nodeId,
                this.#takeGenerationTweenStart(nodeId, previousSpec),
              );
            } else {
              this.#finishGenerationTweenNode(nodeId, true);
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
        this.#penToolController.syncProjection({
          changedNodeIds,
          input,
          projection,
          projectionContinuityLost: textRunProjectionChanged,
        });
        if (
          this.#vectorEdits.size > 0 &&
          (identityChanged ||
            !contiguousChanges ||
            [...this.#vectorEdits.keys()].some(invalidatesInteraction))
        ) {
          this.#cancelVectorEdit();
        }
        if (identityChanged) this.#editor.visible = false;
        if (
          identityChanged ||
          !contiguousChanges ||
          (this.#transform &&
            [...this.#transform.before.keys()].some((nodeId) =>
              invalidatesInteraction(nodeId),
            ))
        ) {
          this.#transform = null;
        }
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
        this.#reconcile(projection);
      } else if (editScopeChanged && this.#baseProjection) {
        this.#reconcile(
          this.#projectScene(
            this.#baseProjection,
            undefined,
            changedBooleanEditScopeIds(previous, input),
            true,
          ),
        );
      }
      this.#syncVectorEdit();
      this.#syncTool(input.tool);
      this.#syncViewport(input.viewport);
      this.#syncSelection(input.selection);
      this.#syncLayerHover(input.layerHoverTarget);
      this.#textRunEditor.syncPresentation();
      this.#editorOverlays.sync(input);
      this.#syncGenerationSkeleton(input.generationSkeleton);
      this.#syncGenerationActivity(
        input.generationActivity,
        input.reducedMotion === true,
      );
      if (input.reducedMotion === true) {
        this.#finishGenerationReveal();
        if (input.generationReveal) {
          this.#rememberGenerationReveal(input.generationReveal.id);
          this.#focusGenerationActivityOnRevealLast(input.generationReveal);
        }
      } else if (input.generationReveal) {
        this.#queueGenerationReveal(
          input.generationReveal,
          generationTweenStarts,
        );
      }
    } catch (error) {
      this.#boxDrawController.cancel();
      this.#boxSelectController.cancel();
      this.#penToolController.abortSync();
      this.finishGenerationPresentation();
      this.#report(error);
    } finally {
      this.#synchronizing = false;
    }
    this.#penToolController.completeSync();
  }

  async capture(target: LeaferCaptureTarget): Promise<LeaferCaptureResult> {
    if (this.#disposed) throw new Error("Leafer capture adapter is disposed");
    this.#finishGenerationReveal();
    const input = this.#input;
    if (!input || input.pageId !== target.pageId) {
      throw new Error("Leafer capture target is not the projected Page");
    }
    if (this.#geometryLoadPromise) await this.#geometryLoadPromise;
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
    this.#finishGenerationReveal();
    const input = this.#input;
    if (!input || input.pageId !== request.pageId) {
      throw new Error("Leafer raster export target is not the projected Page");
    }
    if (this.#geometryLoadPromise) await this.#geometryLoadPromise;
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
    this.#geometryLoadGeneration += 1;
    this.#geometryLoadPromise = null;
    this.#booleanResolver?.clear();
    this.#booleanResolver = null;
    this.#baseProjection = null;
    this.#booleanNodeIds.clear();
    this.#detachTextEditDom(false);
    this.#textRunEditor.clear();
    this.#boxDrawController.dispose();
    this.#boxSelectController.dispose();
    this.#penToolController.dispose();
    this.#cancelVectorEdit();
    this.#imageCropController.dispose();
    this.finishGenerationPresentation();
    if (this.#viewportFrame !== null) cancelAnimationFrame(this.#viewportFrame);
    if (this.#editorFrame !== null) cancelAnimationFrame(this.#editorFrame);
    if (this.#generationViewportFrame !== null) {
      cancelAnimationFrame(this.#generationViewportFrame);
    }
    this.#cancelBooleanPreview();
    this.#viewportFrame = null;
    this.#editorFrame = null;
    this.#generationViewportFrame = null;
    this.#editorRefreshNeedsTreeBounds = false;
    this.#editorRefreshNodeBounds.clear();
    this.#generationActivityLayer.remove();
    this.#generationActivityLayer.destroy();
    this.#editorOverlays.dispose();
    this.#vectorSelectionOverlay.group.remove();
    this.#vectorSelectionOverlay.group.destroy();
    this.#generationSkeletonLayer.remove();
    this.#generationSkeletonLayer.destroy();
    this.#generationRevealStroker.remove();
    this.#generationRevealStroker.destroy();
    this.#layerHoverStroker.remove();
    this.#layerHoverStroker.destroy();
    window.removeEventListener("keydown", this.#onWindowKeyDown, true);
    window.removeEventListener("keyup", this.#onWindowKeyUp, true);
    document.removeEventListener(
      "selectionchange",
      this.#onDocumentSelectionChange,
    );
    this.#host.removeEventListener("contextlost", this.#onContextLost, true);
    this.#app.destroy();
    this.#elements.clear();
  }

  finishGenerationPresentation(): void {
    this.#finishGenerationReveal();
    this.#clearGenerationActivity(true);
    this.#clearGenerationSkeleton(true);
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

  #finishGenerationReveal(): void {
    if (this.#generationPresentationFrame !== null) {
      cancelAnimationFrame(this.#generationPresentationFrame);
      this.#generationPresentationFrame = null;
    }
    for (const [nodeId] of this.#generationReveals) {
      this.#restoreGenerationRevealNode(nodeId);
    }
    this.#generationReveals.clear();
    const tweenNodeIds = new Set(this.#generationTweens.keys());
    for (const [nodeId] of this.#generationTweens) {
      this.#restoreGenerationTweenNode(nodeId);
    }
    this.#generationTweens.clear();
    this.#refreshGenerationTweenSelection(tweenNodeIds);
    this.#generationPresentationLastFrameAt = null;
    this.#generationRevealFocusPoints.clear();
    this.#generationActivityRevealNodeId = null;
    this.#generationRevealNextStartAt = null;
    this.#generationRevealStroker.target = null as never;
    this.#generationRevealStroker.opacity = 0;
    this.#generationRevealStroker.update();
  }

  retryBooleanGeometry(): boolean {
    if (
      this.#disposed ||
      !this.#geometryLoadError ||
      this.#booleanNodeIds.size === 0
    ) {
      return false;
    }
    this.#geometryLoadError = null;
    this.#geometryLoadPromise = null;
    this.#refreshBooleanGeometry();
    return true;
  }

  setVectorPointMode(mode: VectorPointMode): boolean {
    const session = this.#activeVectorEditSession();
    if (
      !session ||
      session.readOnly ||
      session.drag ||
      session.selectedVertexIds.length === 0
    ) {
      return false;
    }
    const result = setVectorPointMode(
      session.network,
      session.selectedVertexIds,
      mode,
    );
    if (!result.ok) {
      this.#report(new Error(result.message));
      return false;
    }
    return this.#submitVectorEdit(session, result.network);
  }

  updateTextEditingStyle(style: LeaferTextStyleUpdate): boolean {
    if (this.#disposed) return false;
    const update = this.#textRunEditor.updateStyle(style);
    if (!update.changed) return false;
    const root = this.#textEditDom;
    const activeSelection = this.#textRunEditor.activeSelection;
    if (root && activeSelection && update.characterChanged) {
      if (activeSelection.start === activeSelection.end) {
        const typingStyle = this.#textRunEditor.activeTypingStyle;
        if (typingStyle) {
          installTextEditTypingStyleMarker(
            root,
            activeSelection.start,
            typingStyle,
            shouldRestoreTextEditDomSelection(root),
          );
        }
      } else {
        finalizeTextEditTypingStyleMarkers(
          root,
          activeSelection,
          shouldRestoreTextEditDomSelection(root),
        );
        const runs = this.#textRunEditor.activeRuns;
        if (runs) {
          applyTextEditCharacterStylesInPlace(
            root,
            activeSelection,
            runs,
            shouldRestoreTextEditDomSelection(root),
          );
        }
      }
    }
    const nodeId = this.#textRunEditor.activeNodeId;
    if (nodeId && activeSelection && this.#input) {
      this.#publishTextEditingSelection(nodeId, this.#input, activeSelection);
    }
    return true;
  }

  #listen(): void {
    const {
      DragEvent,
      EditorEvent,
      EditorMoveEvent,
      EditorRotateEvent,
      EditorScaleEvent,
      EditorSkewEvent,
      InnerEditorEvent,
      MoveEvent,
      PointerEvent,
      RenderEvent,
      ResizeEvent,
      ZoomEvent,
    } = this.#leafer;

    this.#editor.on(EditorEvent.SELECT, () => this.#emitSelection());
    this.#editor.editBox.on(DragEvent.START, () => this.#beginTransform());
    this.#editor.editBox.on(DragEvent.END, () => this.#finishTransform());

    const beforeTransform = () => this.#beginTransform();
    const changed = () => this.#markTransformChanged();
    this.#editor.on(EditorMoveEvent.BEFORE_MOVE, beforeTransform);
    this.#editor.on(EditorScaleEvent.BEFORE_SCALE, beforeTransform);
    this.#editor.on(EditorRotateEvent.BEFORE_ROTATE, beforeTransform);
    this.#editor.on(EditorSkewEvent.BEFORE_SKEW, beforeTransform);
    this.#editor.on(EditorMoveEvent.MOVE, changed);
    this.#editor.on(EditorScaleEvent.SCALE, changed);
    this.#editor.on(EditorRotateEvent.ROTATE, changed);
    this.#editor.on(EditorSkewEvent.SKEW, changed);

    this.#editor.on(InnerEditorEvent.BEFORE_OPEN, (event: unknown) => {
      const element =
        (event as { editTarget?: LeaferElement } | undefined)?.editTarget ??
        this.#editor.list[0];
      const nodeId = element && this.#nodeId(element as LeaferElement);
      if (
        nodeId &&
        element === this.#elements.get(nodeId) &&
        this.#textRunEditor.begin(nodeId)
      ) {
        this.#finishGenerationRevealNode(nodeId);
        this.#finishGenerationTweenNode(nodeId, true);
      }
    });
    this.#editor.on(InnerEditorEvent.OPEN, (event: unknown) => {
      const root = (
        event as { innerEditor?: { editDom?: HTMLDivElement } } | undefined
      )?.innerEditor?.editDom;
      if (root) this.#attachTextEditDom(root);
    });
    this.#editor.on(InnerEditorEvent.BEFORE_CLOSE, () => {
      this.#detachTextEditDom(true);
    });
    this.#editor.on(InnerEditorEvent.CLOSE, () => this.#finishTextEdit());
    document.addEventListener(
      "selectionchange",
      this.#onDocumentSelectionChange,
    );

    this.#app.on(DragEvent.START, (event: unknown) => {
      this.#boxSelectController.start(event);
      this.#boxDrawController.start(event);
    });
    this.#app.on(DragEvent.DRAG, (event: unknown) =>
      this.#boxDrawController.update(event),
    );
    this.#app.on(DragEvent.END, (event: unknown) => {
      this.#boxSelectController.finish(event);
      this.#boxDrawController.finish(event);
    });
    this.#app.on(PointerEvent.DOWN, (event: unknown) => {
      if (this.#editorOverlays.gridPointerDown(asLeaferEvent(event))) return;
      this.#imageCropController.pointerDown(event);
      this.#penToolController.pointerDown(event);
      this.#vectorEditPointerDown(event);
    });
    this.#app.on(PointerEvent.MOVE, (event: unknown) => {
      if (this.#editorOverlays.gridPointerMove(asLeaferEvent(event))) return;
      this.#imageCropController.pointerMove(event);
      this.#penToolController.pointerMove(event);
      this.#vectorEditPointerMove(event);
    });
    this.#app.on(PointerEvent.UP, (event: unknown) => {
      if (this.#editorOverlays.gridPointerUp(asLeaferEvent(event))) return;
      this.#imageCropController.pointerUp(event);
      this.#penToolController.pointerUp(event);
      this.#vectorEditPointerUp(event);
    });

    const viewportChanged = () => {
      this.#scheduleViewport();
      this.#scheduleEditorRefresh();
      this.#renderVectorEditOverlays();
      this.#editorOverlays.syncViewport();
      this.#imageCropController.syncViewport();
      this.#syncGenerationSkeletonViewport();
      this.#syncGenerationActivityViewport();
      this.#scheduleGenerationViewportSync();
    };
    // Viewport gestures are emitted by the App interaction dispatcher. The
    // tree is the transformed zoom layer, not the event owner. Listening on
    // the tree happened to cover programmatic syncs in unit tests but missed
    // real pan/zoom gestures, leaving sky-layer presentation at the previous
    // viewport transform until the next React sync.
    this.#app.on(MoveEvent.MOVE, viewportChanged);
    this.#app.on(MoveEvent.END, viewportChanged);
    this.#app.on(ZoomEvent.ZOOM, viewportChanged);
    this.#app.on(ZoomEvent.END, viewportChanged);
    this.#app.on(ResizeEvent.RESIZE, viewportChanged);
    // Read the sky transform at its actual render boundary. Programmatic
    // viewport sync and gesture propagation can update tree/sky in different
    // callbacks, but no Agent child is rendered until this reconciliation has
    // expressed it relative to the sky's settled transform.
    this.#app.on(RenderEvent.CHILD_START, () => {
      this.#editorOverlays.syncViewport();
      this.#imageCropController.syncViewport();
      this.#syncGenerationSkeletonViewport();
      this.#syncGenerationActivityViewport();
    });

    window.addEventListener("keydown", this.#onWindowKeyDown, true);
    window.addEventListener("keyup", this.#onWindowKeyUp, true);
    this.#host.addEventListener("contextlost", this.#onContextLost, true);
  }

  #reconcile(
    projection: LeaferSceneProjection,
    options: { reapplyAll?: boolean } = {},
  ): void {
    const previous = this.#projection;
    const changedNodeIds = new Set<string>();
    const parentsToAttach = new Set<string | null>();
    const reapplyAll = options.reapplyAll === true;
    projection.warnings.forEach((warning) =>
      this.#callbacks.onWarning?.(warning),
    );
    this.#callbacks.onWarningsChange?.(projection.warnings);

    const candidateNodeIds =
      projection.affectedNodeIds ?? this.#elements.keys();
    for (const nodeId of candidateNodeIds) {
      const element = this.#elements.get(nodeId);
      if (!element) continue;
      if (projection.elementsById.has(nodeId)) continue;
      changedNodeIds.add(nodeId);
      parentsToAttach.add(previous?.elementsById.get(nodeId)?.parentId ?? null);
      if (this.#editor.hasItem(element)) this.#editor.removeItem(element);
      element.remove();
      element.destroy();
      this.#elements.delete(nodeId);
    }

    const candidateSpecs: LeaferElementSpec[] = [];
    if (projection.affectedNodeIds) {
      projection.affectedNodeIds.forEach((nodeId) => {
        const spec = projection.elementsById.get(nodeId);
        if (spec) candidateSpecs.push(spec);
      });
    } else {
      candidateSpecs.push(...projection.elementsById.values());
    }
    for (const spec of candidateSpecs) {
      const previousSpec = previous?.elementsById.get(spec.id);
      let existing = this.#elements.get(spec.id);
      let replaced = false;
      if (existing && this.#tag(existing) !== spec.tag) {
        if (this.#editor.hasItem(existing)) this.#editor.removeItem(existing);
        existing.remove();
        existing.destroy();
        this.#elements.delete(spec.id);
        existing = undefined;
        replaced = true;
      }
      const created = existing === undefined;
      const element = existing ?? this.#createElement(spec.tag);
      this.#elements.set(spec.id, element);
      const dataChanged =
        reapplyAll ||
        created ||
        previousSpec?.textMaxLines !== spec.textMaxLines ||
        !sameProjectionValue(previousSpec?.data, spec.data);
      const transformChanged =
        reapplyAll ||
        created ||
        !previousSpec ||
        !sameTransform(previousSpec.transform, spec.transform);
      const parentChanged =
        !previousSpec || previousSpec.parentId !== spec.parentId;
      const childrenChanged =
        !previousSpec || !sameStringList(previousSpec.childIds, spec.childIds);
      if (dataChanged) {
        this.#applyElementSpecData(element, spec);
      }
      if (transformChanged)
        element.setTransform(transformToAffine(spec.transform));
      if (dataChanged || transformChanged || parentChanged || replaced) {
        changedNodeIds.add(spec.id);
      }
      if (parentChanged || created || replaced) {
        parentsToAttach.add(previousSpec?.parentId ?? null);
        parentsToAttach.add(spec.parentId);
      }
      if (childrenChanged || created || replaced || reapplyAll) {
        parentsToAttach.add(spec.id);
      }
    }

    const attachChildren = (
      parent: LeaferGroup,
      childIds: readonly string[],
    ) => {
      childIds.forEach((childId, index) => {
        const child = this.#elements.get(childId);
        if (!child) return;
        if (child.parent !== parent || parent.children[index] !== child) {
          parent.addAt(child, index);
        }
      });
    };
    if (
      reapplyAll ||
      !previous ||
      !sameStringList(previous.rootIds, projection.rootIds)
    ) {
      parentsToAttach.add(null);
    }
    this.#projection = projection;
    for (const parentId of parentsToAttach) {
      if (parentId === null) {
        attachChildren(
          this.#app.tree as unknown as LeaferGroup,
          projection.rootIds,
        );
        continue;
      }
      const spec = projection.elementsById.get(parentId);
      const element = this.#elements.get(parentId);
      if (spec && element && "children" in element) {
        attachChildren(element as LeaferGroup, spec.childIds);
      }
    }
    if (reapplyAll || !previous) {
      this.#scheduleEditorRefresh({ treeBounds: true });
    } else {
      const selectionBounds = this.#selectionBoundsAffected(
        changedNodeIds,
        previous,
        projection,
      );
      if (selectionBounds.size > 0) {
        this.#scheduleEditorRefresh({ nodeBounds: selectionBounds });
      }
    }
  }

  #projectBooleanGeometry(
    base: LeaferSceneProjection,
    forceBooleanIds?: ReadonlySet<string>,
  ): LeaferSceneProjection {
    const currentBooleanIds = collectBooleanNodeIds(base);
    const removedBooleanIds = new Set(
      [...this.#booleanNodeIds].filter(
        (nodeId) => !currentBooleanIds.has(nodeId),
      ),
    );
    this.#booleanNodeIds = currentBooleanIds;
    const document = this.#input?.document;
    if (!document) return base;
    if (currentBooleanIds.size === 0) {
      return removedBooleanIds.size === 0
        ? base
        : projectResolvedBooleanGeometry(
            base,
            document,
            emptyBooleanResolution(base.pageId),
            { removedBooleanNodeIds: removedBooleanIds },
          );
    }

    if (!this.#booleanResolver) {
      if (this.#geometryLoadError) {
        const incremental =
          base.affectedNodeIds !== undefined || forceBooleanIds !== undefined;
        return projectResolvedBooleanGeometry(
          base,
          document,
          failedBooleanResolution(
            base.pageId,
            currentBooleanIds,
            this.#geometryLoadError,
          ),
          incremental
            ? {
                affectedBooleanNodeIds:
                  forceBooleanIds ?? new Set(currentBooleanIds),
                removedBooleanNodeIds: removedBooleanIds,
              }
            : {},
        );
      }
      this.#ensureVectorGeometryProvider();
      return base;
    }

    const resolution = this.#booleanResolver.resolve(document, base.pageId);
    const incremental =
      base.affectedNodeIds !== undefined || forceBooleanIds !== undefined;
    return projectResolvedBooleanGeometry(
      base,
      document,
      resolution,
      incremental
        ? {
            affectedBooleanNodeIds: new Set([
              ...resolution.computedNodeIds,
              ...(forceBooleanIds ?? []),
            ]),
            removedBooleanNodeIds: removedBooleanIds,
          }
        : {},
    );
  }

  #projectScene(
    base: LeaferSceneProjection,
    forceBooleanIds?: ReadonlySet<string>,
    affectedEditScopeBooleanIds?: ReadonlySet<string>,
    forceEditScopeAffected = false,
  ): LeaferSceneProjection {
    const projection = this.#projectBooleanGeometry(base, forceBooleanIds);
    const document = this.#input?.document;
    if (!document) return projection;
    return projectTextRunProjection(
      projectBooleanEditScope(
        projection,
        document,
        this.#input?.booleanEditScope,
        affectedEditScopeBooleanIds
          ? {
              affectedBooleanNodeIds: affectedEditScopeBooleanIds,
              forceAffected: forceEditScopeAffected,
            }
          : {},
      ),
      this.#input?.textRunProjection,
      this.#projection,
    );
  }

  #ensureVectorGeometryProvider(): void {
    if (
      this.#disposed ||
      this.#geometryLoadPromise ||
      this.#booleanResolver ||
      this.#geometryLoadError
    ) {
      return;
    }
    const generation = ++this.#geometryLoadGeneration;
    this.#geometryLoadPromise = this.#loadVectorGeometryProvider().then(
      (provider) => {
        if (this.#disposed || generation !== this.#geometryLoadGeneration) {
          return;
        }
        this.#booleanResolver = createBooleanGeometryResolver(provider);
        this.#geometryLoadError = null;
        this.#geometryLoadPromise = null;
        this.#refreshBooleanGeometry();
      },
      (error: unknown) => {
        if (this.#disposed || generation !== this.#geometryLoadGeneration) {
          return;
        }
        this.#geometryLoadError =
          error instanceof Error
            ? error
            : new Error("PathKit geometry provider failed to load");
        this.#geometryLoadPromise = null;
        this.#refreshBooleanGeometry();
      },
    );
  }

  #refreshBooleanGeometry(): void {
    const base = this.#baseProjection;
    const input = this.#input;
    if (!base || !input || this.#disposed) return;
    this.#synchronizing = true;
    try {
      const projection = this.#projectScene(
        base,
        new Set(this.#booleanNodeIds),
      );
      this.#reconcile(projection);
      this.#syncSelection(input.selection);
    } catch (error) {
      this.#report(error);
    } finally {
      this.#synchronizing = false;
    }
  }

  #selectionBoundsAffected(
    changedNodeIds: ReadonlySet<string>,
    previous: LeaferSceneProjection,
    projection: LeaferSceneProjection,
  ): Set<string> {
    const selection = this.#input?.selection.nodeIds;
    if (!selection || changedNodeIds.size === 0 || selection.length === 0)
      return new Set();
    const affectedSelection = new Set<string>();
    const selectedNodeIds = new Set(selection);
    for (const selectedNodeId of selectedNodeIds) {
      if (
        lineage(selectedNodeId, previous).some((nodeId) =>
          changedNodeIds.has(nodeId),
        ) ||
        lineage(selectedNodeId, projection).some((nodeId) =>
          changedNodeIds.has(nodeId),
        )
      ) {
        affectedSelection.add(selectedNodeId);
      }
    }
    for (const changedNodeId of changedNodeIds) {
      for (const nodeId of [
        ...lineage(changedNodeId, previous),
        ...lineage(changedNodeId, projection),
      ]) {
        if (selectedNodeIds.has(nodeId)) affectedSelection.add(nodeId);
      }
    }
    return affectedSelection;
  }

  #createElement(tag: LeaferElementTag): LeaferElement {
    const Constructor = this.#leafer[tag] as new (
      data?: Record<string, unknown>,
    ) => LeaferElement;
    return new Constructor();
  }

  #applyElementSpecData(
    element: LeaferElement,
    spec: LeaferElementSpec,
    overrides: Record<string, unknown> = {},
  ): void {
    const data =
      spec.tag === "Text"
        ? materializeLeaferTextData(this.#leafer, spec.data, spec.textMaxLines)
        : spec.data;
    element.set({ ...data, ...overrides });
  }

  #tag(element: LeaferElement): string {
    return (element as LeaferElement & { tag?: string }).tag ?? "";
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
    this.#syncGenerationSkeletonViewport();
    this.#syncGenerationActivityViewport();
    if (this.#input) this.#editorOverlays.sync(this.#input);
    this.#scheduleGenerationViewportSync();
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

  #syncLayerHover(target: LeaferLayerHoverTarget | undefined): void {
    const input = this.#input;
    const projection = this.#projection;
    const element = target?.componentTarget
      ? this.#componentTargetElement(target.componentTarget)
      : target
        ? this.#elements.get(target.nodeId)
        : undefined;
    const projectionId = element ? this.#projectionId(element) : undefined;
    const visible =
      projection && projectionId
        ? lineage(projectionId, projection).every(
            (nodeId) =>
              projection.elementsById.get(nodeId)?.data.visible !== false,
          )
        : false;
    const show =
      input?.tool === "select" &&
      !input.vectorEditScope &&
      !this.#imageCropController.active &&
      element !== undefined &&
      visible &&
      !this.#editor.list.includes(element);
    if (!show) {
      this.#clearLayerHover();
      return;
    }
    if (this.#layerHoverStroker.target !== element) {
      this.#layerHoverStroker.setTarget(element, {
        opacity: 1,
        stroke: LAYER_HOVER_COLOR,
        strokeWidth: 1,
      });
    } else if (this.#layerHoverStroker.opacity !== 1) {
      this.#layerHoverStroker.opacity = 1;
      this.#layerHoverStroker.update();
    }
  }

  #clearLayerHover(): void {
    if (
      this.#layerHoverStroker.target === null &&
      this.#layerHoverStroker.opacity === 0
    ) {
      return;
    }
    this.#layerHoverStroker.target = null as never;
    this.#layerHoverStroker.opacity = 0;
    this.#layerHoverStroker.update();
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
      const element = this.#elements.get(nodeId);
      return element ? [element] : [];
    });
  }

  #beginTransform(): void {
    if (this.#synchronizing || this.#transform || this.#disposed) return;
    if (this.#selectedComponentTarget()) return;
    if (this.#selectionHasLockedElement()) return;
    const nodeIds = this.#selectedSubtreeIds();
    if (nodeIds.length === 0) return;
    for (const nodeId of nodeIds) {
      this.#finishGenerationRevealNode(nodeId);
      this.#finishGenerationTweenNode(nodeId, true);
    }
    this.#transform = {
      before: this.#capture(nodeIds),
      changed: false,
      kind: this.#currentTransformKind(),
      selectionNodeIds: this.#selectedNodeIds(),
    };
  }

  #markTransformChanged(): void {
    if (this.#synchronizing || this.#disposed) return;
    this.#beginTransform();
    if (!this.#transform) {
      if (this.#selectionHasLockedElement()) this.#restoreProjection();
      return;
    }
    this.#transform.changed = true;
    this.#scheduleBooleanPreview();
    if (!this.#editor.editBox.dragging && !this.#editor.editBox.gesturing) {
      queueMicrotask(() => this.#finishTransform());
    }
  }

  #finishTransform(): void {
    const session = this.#transform;
    if (!session || this.#synchronizing || this.#disposed) return;
    this.#transform = null;
    if (!session.changed) return;
    const operations = this.#operationsFrom(session.before);
    if (operations.length === 0) return;
    const accepted = this.#callbacks.onOperations({
      kind: session.kind,
      operations,
      selectionNodeIds: session.selectionNodeIds,
    });
    if (!accepted) this.#restoreProjection();
  }

  #scheduleBooleanPreview(): void {
    if (
      this.#disposed ||
      this.#booleanPreviewFrame !== null ||
      !this.#input?.booleanEditScope ||
      this.#input.booleanEditScope.readOnly ||
      !this.#booleanResolver ||
      !this.#baseProjection ||
      !this.#transform
    ) {
      return;
    }
    this.#booleanPreviewFrame = requestAnimationFrame(() => {
      this.#booleanPreviewFrame = null;
      this.#previewBooleanTransform();
    });
  }

  #previewBooleanTransform(): void {
    const input = this.#input;
    const base = this.#baseProjection;
    const resolver = this.#booleanResolver;
    const transform = this.#transform;
    if (
      !input?.booleanEditScope ||
      input.booleanEditScope.readOnly ||
      !base ||
      !resolver ||
      !transform ||
      this.#disposed
    ) {
      return;
    }
    const nodesById: DesignDocument["nodesById"] = {
      ...input.document.nodesById,
    };
    for (const nodeId of transform.before.keys()) {
      const node = input.document.nodesById[nodeId];
      const element = this.#elements.get(nodeId);
      if (!node || !element) continue;
      const current = this.#readElementState(element);
      nodesById[nodeId] = {
        ...node,
        transform: current.transform,
        ...(node.kind === "group" ||
        node.kind === "boolean" ||
        node.kind === "instance"
          ? {}
          : { size: current.size }),
      };
    }
    const previewDocument: DesignDocument = {
      ...input.document,
      nodesById,
    };
    try {
      const resolution = resolver.resolve(previewDocument, input.pageId);
      const projection = projectResolvedBooleanGeometry(
        base,
        previewDocument,
        resolution,
        {
          affectedBooleanNodeIds: new Set([
            ...resolution.computedNodeIds,
            input.booleanEditScope.booleanId,
          ]),
        },
      );
      this.#synchronizing = true;
      this.#reconcile(
        projectBooleanEditScope(
          projection,
          previewDocument,
          input.booleanEditScope,
        ),
      );
      this.#syncSelection(input.selection);
    } catch (error) {
      this.#report(error);
    } finally {
      this.#synchronizing = false;
    }
  }

  #cancelBooleanPreview(): void {
    if (this.#booleanPreviewFrame === null) return;
    cancelAnimationFrame(this.#booleanPreviewFrame);
    this.#booleanPreviewFrame = null;
  }

  #capture(nodeIds: readonly string[]): Map<string, ElementState> {
    const captured = new Map<string, ElementState>();
    nodeIds.forEach((nodeId) => {
      const element = this.#elements.get(nodeId);
      if (!element) return;
      captured.set(nodeId, this.#readElementState(element));
    });
    return captured;
  }

  #operationsFrom(
    before: ReadonlyMap<string, ElementState>,
  ): DesignOperation[] {
    const document = this.#input?.document;
    if (!document) return [];
    const operations: DesignOperation[] = [];
    for (const [nodeId, previous] of before) {
      const node = document.nodesById[nodeId];
      const element = this.#elements.get(nodeId);
      const spec = this.#projection?.elementsById.get(nodeId);
      if (!node || !element || isLockedSpec(spec)) continue;
      const current = this.#readElementState(element);
      const linePointsChanged =
        node.kind === "line" &&
        previous.linePoints !== undefined &&
        current.linePoints !== undefined &&
        !sameNumberList(previous.linePoints, current.linePoints);
      let nextTransform = current.transform;
      let nextSize = node.kind === "line" ? node.size : current.size;
      let lineProperties:
        | { start: { x: number; y: number }; end: { x: number; y: number } }
        | undefined;
      if (linePointsChanged && current.linePoints) {
        const geometry = normalizeLineEndpoints(
          { x: current.linePoints[0], y: current.linePoints[1] },
          { x: current.linePoints[2], y: current.linePoints[3] },
        );
        nextTransform = translateLocalTransform(
          current.transform,
          geometry.bounds.x,
          geometry.bounds.y,
        );
        nextSize = {
          width: geometry.bounds.width,
          height: geometry.bounds.height,
        };
        lineProperties = { start: geometry.start, end: geometry.end };
      }
      const transformChanged = !sameTransform(node.transform, nextTransform);
      const sizeChanged =
        node.kind !== "group" &&
        node.kind !== "boolean" &&
        node.kind !== "instance" &&
        (!nearlyEqual(node.size.width, nextSize.width) ||
          !nearlyEqual(node.size.height, nextSize.height));
      if (!transformChanged && !sizeChanged && !lineProperties) continue;
      operations.push({
        commandId: `leafer_transform_${nodeId}`,
        type: "update_properties",
        nodeId,
        ...(transformChanged ? { transform: nextTransform } : {}),
        ...(sizeChanged ? { size: nextSize } : {}),
        ...(lineProperties ? { properties: lineProperties } : {}),
      });
    }
    return operations;
  }

  #readElementState(element: LeaferElement): ElementState {
    const matrix = element.localTransform;
    const tag = this.#tag(element);
    const textBounds =
      tag === "Text" ? element.getBounds("box", "inner") : undefined;
    const linePoints =
      tag === "Arrow" || tag === "Line" ? readLinePoints(element) : undefined;
    return {
      transform: normalizeTransform([
        matrix.a,
        matrix.b,
        matrix.c,
        matrix.d,
        matrix.e,
        matrix.f,
      ]),
      size: {
        width: normalizeNumber(
          element.width === undefined
            ? (textBounds?.width ?? 0)
            : Number(element.width) || 0,
        ),
        height: normalizeNumber(
          element.height === undefined
            ? (textBounds?.height ?? 0)
            : Number(element.height) || 0,
        ),
      },
      ...(linePoints ? { linePoints } : {}),
      ...(tag === "Text" ? { text: readElementText(element) } : {}),
    };
  }

  #selectedSubtreeIds(): string[] {
    const projection = this.#projection;
    if (!projection) return [];
    const selected = this.#editor.list.flatMap((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return nodeId ? [nodeId] : [];
    });
    const result: string[] = [];
    const visited = new Set<string>();
    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const spec = projection.elementsById.get(nodeId);
      if (!spec) return;
      result.push(nodeId);
      spec.childIds.forEach(visit);
    };
    selected.forEach(visit);
    return result;
  }

  #selectedNodeIds(): string[] {
    return this.#editor.list.flatMap((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return nodeId ? [nodeId] : [];
    });
  }

  #selectedComponentTarget(): ComponentSelectionTarget | undefined {
    if (this.#editor.list.length === 0 || !this.#projection) return undefined;
    const targets = new Map<string, ComponentSelectionTarget>();
    for (const candidate of this.#editor.list) {
      const element = candidate as LeaferElement;
      const projectionId = this.#projectionId(element);
      const metadata = projectionId
        ? this.#projection.elementsById.get(projectionId)?.data.data
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
    for (const [projectionId, spec] of this.#projection?.elementsById ?? []) {
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
        return this.#elements.get(projectionId);
      }
    }
    return undefined;
  }

  #currentTransformKind(): LeaferOperationKind {
    if (this.#editor.resizing) return "resize";
    if (this.#editor.rotating) return "rotate";
    if (this.#editor.skewing) return "skew";
    if (this.#editor.moving) return "move";
    return "transform";
  }

  #selectionHasLockedElement(): boolean {
    if (this.#selectedComponentTarget()) return true;
    return this.#editor.list.some((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return (
        nodeId !== undefined &&
        isLockedSpec(this.#projection?.elementsById.get(nodeId))
      );
    });
  }

  #finishTextEdit(): void {
    const result = this.#textRunEditor.finish({
      disposed: this.#disposed,
      synchronizing: this.#synchronizing,
    });
    this.#callbacks.onTextRangeSelectionChange?.(null);
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

  #attachTextEditDom(root: HTMLDivElement): void {
    this.#detachTextEditDom(false);
    this.#textEditDom = root;
    this.#textEditComposing = false;
    root.addEventListener("input", this.#onTextEditInput);
    root.addEventListener("compositionstart", this.#onTextEditCompositionStart);
    root.addEventListener("compositionend", this.#onTextEditCompositionEnd);
    const snapshot = textEditDomSnapshot(root);
    this.#textRunEditor.selection(snapshot.selection);
    this.#renderTextEditCharacterStyles(root, snapshot.selection, true);
  }

  #detachTextEditDom(sync: boolean): void {
    const root = this.#textEditDom;
    if (!root) return;
    if (sync) this.#syncTextEditDom(root, false);
    root.removeEventListener("input", this.#onTextEditInput);
    root.removeEventListener(
      "compositionstart",
      this.#onTextEditCompositionStart,
    );
    root.removeEventListener("compositionend", this.#onTextEditCompositionEnd);
    this.#textEditDom = null;
    this.#textEditComposing = false;
  }

  #onTextEditInput = (event: Event): void => {
    const input = event as InputEvent;
    this.#syncTextEditDom(
      event.currentTarget as HTMLDivElement,
      !this.#textEditComposing &&
        input.isComposing !== true &&
        input.inputType === "insertText" &&
        input.data === " ",
    );
  };

  #onTextEditCompositionStart = (): void => {
    this.#textEditComposing = true;
  };

  #onTextEditCompositionEnd = (): void => {
    this.#textEditComposing = false;
    if (this.#textEditDom) this.#syncTextEditDom(this.#textEditDom, false);
  };

  #syncTextEditDom(root: HTMLDivElement, automaticList: boolean): void {
    if (root !== this.#textEditDom || !this.#textRunEditor.activeNodeId) return;
    try {
      const snapshot = textEditDomSnapshot(root);
      const result = this.#textRunEditor.input(
        snapshot.content,
        snapshot.selection,
        automaticList,
      );
      if (!result) return;
      const rewrite = result.rewrite ?? null;
      if (rewrite) this.#applyTextEditRewrite(root, rewrite);
      else this.#writeActiveTextEditContent(result.state.content);
      this.#emitTextRangeSelection();
    } catch (error) {
      this.#report(error);
      this.#textRunEditor.cancel();
    }
  }

  #applyTextEditRewrite(
    root: HTMLDivElement,
    rewrite: { content: string; selection: { start: number; end: number } },
  ): void {
    writeTextEditDom(root, rewrite.content);
    setTextEditDomSelection(root, rewrite.selection);
    this.#writeActiveTextEditContent(rewrite.content);
  }

  #writeActiveTextEditContent(content: string): void {
    const nodeId = this.#textRunEditor.activeNodeId;
    const element = nodeId ? this.#elements.get(nodeId) : undefined;
    if (element) (element as LeaferElement & { text: string }).text = content;
  }

  #renderTextEditCharacterStyles(
    root: HTMLDivElement,
    selection: { start: number; end: number },
    restoreSelection: boolean,
  ): void {
    const content = this.#textRunEditor.activeContent;
    const runs = this.#textRunEditor.activeRuns;
    if (content === null || !runs) return;
    writeStyledTextEditDom(root, content, runs);
    if (restoreSelection) setTextEditDomSelection(root, selection);
  }

  #handleTextEditKeyDown(event: KeyboardEvent): boolean {
    const root = this.#textEditDom;
    if (
      !root ||
      !(event.target instanceof Node) ||
      !root.contains(event.target) ||
      this.#textEditComposing ||
      event.isComposing
    ) {
      return false;
    }
    try {
      const snapshot = textEditDomSnapshot(root);
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z"
      ) {
        const undone = this.#textRunEditor.undoAutomaticList();
        if (!undone?.rewrite) return false;
        stopTextEditKey(event);
        this.#applyTextEditRewrite(root, undone.rewrite);
        this.#emitTextRangeSelection();
        return true;
      }
      const command = textEditingListCommand(event);
      if (!command) return false;
      const result = this.#textRunEditor.listCommand(
        snapshot.selection,
        command,
      );
      if (!result?.handled) return false;
      stopTextEditKey(event);
      this.#writeActiveTextEditContent(result.state.content);
      this.#emitTextRangeSelection();
      return true;
    } catch (error) {
      this.#report(error);
      this.#textRunEditor.cancel();
      return false;
    }
  }

  #emitTextRangeSelection(): void {
    const nodeId = this.#textRunEditor.activeNodeId;
    const input = this.#input;
    const innerEditor = this.#editor.innerEditor as
      { editDom?: HTMLDivElement } | undefined;
    const root = innerEditor?.editDom;
    const selection = window.getSelection();
    if (
      !nodeId ||
      !input ||
      !root ||
      !selection ||
      selection.rangeCount === 0
    ) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    ) {
      return;
    }
    const snapshot = textEditDomSnapshot(root);
    if (snapshot.content !== this.#textRunEditor.activeContent) return;
    this.#publishTextEditingSelection(nodeId, input, snapshot.selection);
    if (!this.#textRunEditor.hasTypingStyle) {
      finalizeTextEditTypingStyleMarkers(
        root,
        snapshot.selection,
        shouldRestoreTextEditDomSelection(root),
      );
    }
  }

  #publishTextEditingSelection(
    nodeId: string,
    input: LeaferEngineSyncInput,
    activeSelection: { start: number; end: number },
  ): void {
    const authoritative = input.document.nodesById[nodeId];
    if (authoritative?.kind !== "text") {
      this.#callbacks.onTextRangeSelectionChange?.(null);
      return;
    }
    const inspection = this.#textRunEditor.selection(activeSelection);
    if (!inspection) {
      this.#callbacks.onTextRangeSelectionChange?.(null);
      return;
    }
    this.#callbacks.onTextRangeSelectionChange?.({
      documentId: input.document.documentId,
      editing: {
        characterMixedFields: inspection.characterMixedFields,
        characterStyle: inspection.characterStyle,
        content:
          this.#textRunEditor.activeContent ?? authoritative.properties.content,
        paragraphMixedFields: inspection.paragraphMixedFields,
        paragraphStyle: inspection.paragraphStyle,
      },
      nodeId,
      revision: input.document.revision,
      ...activeSelection,
    });
  }

  #syncVectorEdit(): void {
    const input = this.#input;
    const scope = input?.vectorEditScope;
    if (!input || !scope) {
      this.#cancelVectorEdit();
      return;
    }
    if (this.#vectorLasso && scope.tool !== "lasso") {
      this.#cancelVectorLasso();
    }
    const requestedNodeIds = new Set(scope.nodes.map((item) => item.nodeId));
    for (const [nodeId, session] of this.#vectorEdits) {
      if (!requestedNodeIds.has(nodeId)) this.#cancelVectorEditSession(session);
    }

    for (const item of scope.nodes) {
      const node = input.document.nodesById[item.nodeId];
      const pathElement = this.#elements.get(item.nodeId);
      if (
        !node ||
        (node.kind !== "path" && node.kind !== "vector") ||
        !("network" in node.properties) ||
        !pathElement
      ) {
        const staleSession = this.#vectorEdits.get(item.nodeId);
        if (staleSession) this.#cancelVectorEditSession(staleSession);
        continue;
      }
      this.#finishGenerationRevealNode(item.nodeId);
      this.#finishGenerationTweenNode(item.nodeId, true);
      const network = node.properties.network;
      const selectedVertexIds = [...new Set(item.selectedVertexIds)].filter(
        (vertexId) => network.vertices.some((vertex) => vertex.id === vertexId),
      );
      const selectedSegmentIds = [
        ...new Set(item.selectedSegmentIds ?? []),
      ].filter((segmentId) =>
        network.segments.some((segment) => segment.id === segmentId),
      );
      let session = this.#vectorEdits.get(item.nodeId);
      if (!session) {
        session = this.#createVectorEditSession(
          item.nodeId,
          pathElement,
          network,
          selectedSegmentIds,
          selectedVertexIds,
          item.readOnly,
          scope.tool,
        );
        if (!session) continue;
        this.#vectorEdits.set(item.nodeId, session);
      } else {
        if (
          session.drag?.kind === "cut" &&
          (scope.tool !== "cut" || item.readOnly)
        ) {
          this.#cancelVectorEditDrag(session);
        }
        session.pathElement = pathElement;
        session.readOnly = item.readOnly;
        session.selectedSegmentIds = selectedSegmentIds;
        session.selectedVertexIds = selectedVertexIds;
        session.tool = scope.tool;
        if (!session.drag) session.network = structuredClone(network);
      }
      session.overlayGroup.setTransform({ ...pathElement.localTransform });
    }
    this.#activeVectorEditNodeId = this.#vectorEdits.has(scope.activeNodeId)
      ? scope.activeNodeId
      : (scope.nodes.find((item) => this.#vectorEdits.has(item.nodeId))
          ?.nodeId ?? null);
    if (this.#vectorEdits.size === 0) this.#activeVectorEditNodeId = null;
    this.#renderVectorEditOverlays();
  }

  #createVectorEditSession(
    nodeId: string,
    pathElement: LeaferElement,
    network: VectorNetwork,
    selectedSegmentIds: string[],
    selectedVertexIds: string[],
    readOnly: boolean,
    tool: LeaferVectorEditTool,
  ): VectorEditSession | undefined {
    const parent = pathElement.parent as LeaferGroup | undefined;
    if (!parent || typeof parent.add !== "function") return undefined;
    const overlayGroup = new this.#leafer.Group({
      editable: false,
      hitChildren: true,
    }) as LeaferGroup;
    const tracePath = new this.#leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      opacity: 0.55,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
    }) as LeaferElement;
    const cutHitPath = new this.#leafer.Path({
      cursor: "crosshair",
      editable: false,
      fill: null,
      hittable: tool === "cut" && !readOnly,
      stroke: "rgba(0, 0, 0, 0.001)",
    }) as LeaferElement;
    const cutGuidePath = new this.#leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: VECTOR_CUT_GUIDE_COLOR,
      strokeCap: "round",
      visible: false,
    }) as LeaferElement;
    const handlePath = new this.#leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: "#8b8b89",
    }) as LeaferElement;
    const lassoPath = new this.#leafer.Path({
      editable: false,
      fill: "rgba(79, 127, 255, 0.08)",
      hittable: false,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
      visible: false,
    }) as LeaferElement;
    const segmentSelectionPath = new this.#leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
    }) as LeaferElement;
    overlayGroup.add(cutHitPath);
    overlayGroup.add(tracePath);
    overlayGroup.add(segmentSelectionPath);
    overlayGroup.add(handlePath);
    overlayGroup.add(lassoPath);
    overlayGroup.add(cutGuidePath);
    parent.add(overlayGroup);
    this.#vectorEditControls.set(cutHitPath, { kind: "path", nodeId });
    return {
      anchorControls: [],
      cutGuidePath,
      cutHitPath,
      drag: null,
      handleControls: [],
      handlePath,
      lassoPath,
      network: structuredClone(network),
      nodeId,
      overlayGroup,
      pathElement,
      readOnly,
      segmentSelectionPath,
      selectedSegmentIds,
      selectedVertexIds,
      tool,
      tracePath,
    };
  }

  #activeVectorEditSession(): VectorEditSession | null {
    return this.#activeVectorEditNodeId
      ? (this.#vectorEdits.get(this.#activeVectorEditNodeId) ?? null)
      : null;
  }

  #renderVectorEditOverlays(): void {
    for (const session of this.#vectorEdits.values()) {
      this.#renderVectorEditOverlay(session);
    }
    this.#renderVectorSelectionOverlay();
  }

  #renderVectorEditOverlay(session: VectorEditSession): void {
    const serialized = serializeVectorNetwork(session.network);
    if (!serialized.ok) {
      this.#report(
        new Error(serialized.issues.map((issue) => issue.message).join("; ")),
      );
      return;
    }
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.abs(this.#input?.viewport.zoom ?? 1),
    );
    const anchorSize = 8 / zoom;
    const handleSize = 6 / zoom;
    session.pathElement.set({ path: serialized.path });
    session.cutHitPath.set({
      hittable: session.tool === "cut" && !session.readOnly,
      path: serialized.path,
      strokeWidth: 14 / zoom,
    });
    session.tracePath.set({ path: serialized.path, strokeWidth: 1.5 / zoom });
    session.segmentSelectionPath.set({
      path: vectorSegmentSelectionPath(
        session.network,
        session.selectedSegmentIds,
      ),
      strokeWidth: 4 / zoom,
    });
    session.cutGuidePath.set({ strokeWidth: 1.5 / zoom });
    this.#renderVectorCutGuide(session);
    session.anchorControls.forEach((control) => {
      control.remove();
      control.destroy();
    });
    session.handleControls.forEach((control) => {
      control.remove();
      control.destroy();
    });
    session.anchorControls = [];
    session.handleControls = [];
    const selected = new Set(session.selectedVertexIds);
    for (const vertex of session.network.vertices) {
      const isSelected = selected.has(vertex.id);
      const anchor = new this.#leafer.Ellipse({
        cursor: session.readOnly
          ? "default"
          : session.tool === "cut"
            ? "crosshair"
            : "pointer",
        editable: false,
        fill: isSelected ? LEAFER_EDITOR_SELECTION_COLOR : "#ffffff",
        height: anchorSize,
        hittable: true,
        stroke: LEAFER_EDITOR_SELECTION_COLOR,
        strokeWidth: 1.5 / zoom,
        width: anchorSize,
        x: vertex.x - anchorSize / 2,
        y: vertex.y - anchorSize / 2,
      }) as LeaferElement;
      session.anchorControls.push(anchor);
      this.#vectorEditControls.set(anchor, {
        kind: "vertex",
        nodeId: session.nodeId,
        vertexId: vertex.id,
      });
      session.overlayGroup.add(anchor);
    }

    const handleParts: string[] = [];
    for (const vertexId of session.tool === "move"
      ? session.selectedVertexIds
      : []) {
      const vertex = session.network.vertices.find(
        (candidate) => candidate.id === vertexId,
      );
      if (!vertex) continue;
      for (const handle of listVectorVertexHandles(session.network, vertexId)) {
        handleParts.push(
          `M ${vertex.x} ${vertex.y} L ${handle.position.x} ${handle.position.y}`,
        );
        const control = new this.#leafer.Ellipse({
          cursor: session.readOnly ? "default" : "pointer",
          editable: false,
          fill: LEAFER_EDITOR_SELECTION_COLOR,
          height: handleSize,
          hittable: !session.readOnly,
          stroke: "#ffffff",
          strokeWidth: 1 / zoom,
          width: handleSize,
          x: handle.position.x - handleSize / 2,
          y: handle.position.y - handleSize / 2,
        }) as LeaferElement;
        session.handleControls.push(control);
        this.#vectorEditControls.set(control, {
          kind: "handle",
          nodeId: session.nodeId,
          reference: {
            segmentId: handle.segmentId,
            side: handle.side,
          },
          vertexId,
        });
        session.overlayGroup.add(control);
      }
    }
    session.handlePath.set({
      path: handleParts.join(" "),
      strokeWidth: 1 / zoom,
    });
    if (
      !this.#vectorLasso ||
      this.#vectorLasso.activeNodeId !== session.nodeId
    ) {
      session.lassoPath.set({ path: "", visible: false });
    }
  }

  #renderVectorSelectionOverlay(): void {
    const overlay = this.#vectorSelectionOverlay;
    overlay.controls.forEach((control) => {
      control.remove();
      control.destroy();
    });
    overlay.controls = [];
    const targets = this.#vectorSelectionTargets();
    const bounds = targets
      ? vectorDocumentSelectionBounds(
          targets.map((target) => ({
            network: target.session.network,
            vertexIds: target.vertexIds,
            worldTransform: target.world,
          })),
        )
      : null;
    if (!bounds || !targets) {
      overlay.group.set({ visible: false });
      overlay.hitArea.set({ hittable: false });
      return;
    }
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.abs(this.#input?.viewport.zoom ?? 1),
    );
    const readOnly = targets.some((target) => target.session.readOnly);
    const visualWidth = Math.max(bounds.width, 1 / zoom);
    const visualHeight = Math.max(bounds.height, 1 / zoom);
    const x = bounds.x + (bounds.width - visualWidth) / 2;
    const y = bounds.y + (bounds.height - visualHeight) / 2;
    overlay.group.set({ visible: true });
    overlay.box.set({
      height: visualHeight,
      strokeWidth: 1.5 / zoom,
      width: visualWidth,
      x,
      y,
    });
    overlay.hitArea.set({
      height: visualHeight,
      hittable: !readOnly,
      width: visualWidth,
      x,
      y,
    });
    const handleSize = 7 / zoom;
    const positions: Array<{
      cursor: string;
      handle: VectorResizeHandle;
      x: number;
      y: number;
    }> = [
      { handle: "north-west", x, y, cursor: "nwse-resize" },
      {
        handle: "north",
        x: x + visualWidth / 2,
        y,
        cursor: "ns-resize",
      },
      {
        handle: "north-east",
        x: x + visualWidth,
        y,
        cursor: "nesw-resize",
      },
      {
        handle: "east",
        x: x + visualWidth,
        y: y + visualHeight / 2,
        cursor: "ew-resize",
      },
      {
        handle: "south-east",
        x: x + visualWidth,
        y: y + visualHeight,
        cursor: "nwse-resize",
      },
      {
        handle: "south",
        x: x + visualWidth / 2,
        y: y + visualHeight,
        cursor: "ns-resize",
      },
      {
        handle: "south-west",
        x,
        y: y + visualHeight,
        cursor: "nesw-resize",
      },
      {
        handle: "west",
        x,
        y: y + visualHeight / 2,
        cursor: "ew-resize",
      },
    ];
    for (const position of positions) {
      const control = new this.#leafer.Rect({
        cursor: readOnly ? "default" : position.cursor,
        editable: false,
        fill: "#ffffff",
        height: handleSize,
        hittable: !readOnly,
        stroke: LEAFER_EDITOR_SELECTION_COLOR,
        strokeWidth: 1 / zoom,
        width: handleSize,
        x: position.x - handleSize / 2,
        y: position.y - handleSize / 2,
      }) as LeaferElement;
      overlay.controls.push(control);
      this.#vectorEditControls.set(control, {
        handle: position.handle,
        kind: "resize",
      });
      overlay.group.add(control);
    }
    const rotationOffset = 14 / zoom;
    for (const position of positions.filter((item) =>
      item.handle.includes("-"),
    )) {
      const directionX = position.x < x + visualWidth / 2 ? -1 : 1;
      const directionY = position.y < y + visualHeight / 2 ? -1 : 1;
      const control = new this.#leafer.Ellipse({
        cursor: readOnly ? "default" : "crosshair",
        editable: false,
        fill: "rgba(0, 0, 0, 0.001)",
        height: 12 / zoom,
        hittable: !readOnly,
        width: 12 / zoom,
        x: position.x + directionX * rotationOffset - 6 / zoom,
        y: position.y + directionY * rotationOffset - 6 / zoom,
      }) as LeaferElement;
      overlay.controls.push(control);
      this.#vectorEditControls.set(control, {
        kind: "rotate",
      });
      overlay.group.add(control);
    }
  }

  #vectorSelectionTargets(): Array<{
    session: VectorEditSession;
    vertexIds: readonly string[];
    world: Transform;
  }> | null {
    const document = this.#input?.document;
    if (!document) return null;
    const targets = [...this.#vectorEdits.values()].flatMap((session) => {
      if (session.tool !== "move" || session.selectedVertexIds.length === 0) {
        return [];
      }
      const world = getVisibleWorldTransform(
        document.nodesById,
        session.nodeId,
      );
      return world
        ? [
            {
              session,
              vertexIds: [...session.selectedVertexIds],
              world,
            },
          ]
        : [];
    });
    return targets.reduce(
      (count, target) => count + target.vertexIds.length,
      0,
    ) >= 2
      ? targets
      : null;
  }

  #setVectorSelection(
    session: VectorEditSession,
    segmentIds: readonly string[],
    vertexIds: readonly string[],
  ): void {
    const availableSegments = new Set(
      session.network.segments.map((segment) => segment.id),
    );
    const available = new Set(
      session.network.vertices.map((vertex) => vertex.id),
    );
    const selectedSegments = [...new Set(segmentIds)].filter((segmentId) =>
      availableSegments.has(segmentId),
    );
    const selected = [...new Set(vertexIds)].filter((vertexId) =>
      available.has(vertexId),
    );
    if (
      sameStringList(selectedSegments, session.selectedSegmentIds) &&
      sameStringList(selected, session.selectedVertexIds)
    )
      return;
    session.selectedSegmentIds = selectedSegments;
    session.selectedVertexIds = selected;
    this.#callbacks.onVectorEditSelectionChange?.(session.nodeId, {
      segmentIds: selectedSegments,
      vertexIds: selected,
    });
    this.#renderVectorEditOverlay(session);
    this.#renderVectorSelectionOverlay();
  }

  #vectorEditPointerDown(event: unknown): void {
    if (
      this.#disposed ||
      [...this.#vectorEdits.values()].some((session) => session.drag)
    ) {
      return;
    }
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel || pointer.right || pointer.middle) return;
    const target = isElement(pointer.target) ? pointer.target : undefined;
    const control = target ? this.#vectorEditControls.get(target) : undefined;
    if (
      control?.kind === "selection-box" ||
      control?.kind === "resize" ||
      control?.kind === "rotate"
    ) {
      const targets = this.#vectorSelectionTargets();
      const bounds = targets
        ? vectorDocumentSelectionBounds(
            targets.map((item) => ({
              network: item.session.network,
              vertexIds: item.vertexIds,
              worldTransform: item.world,
            })),
          )
        : null;
      const holder = this.#activeVectorEditSession() ?? targets?.[0]?.session;
      if (
        !targets ||
        !bounds ||
        !holder ||
        targets.some((item) => item.session.readOnly)
      ) {
        return;
      }
      const startClient = eventClientPoint(pointer);
      const startDocument = pointer.getInnerPoint(this.#app.tree);
      holder.drag = {
        beforeByNode: new Map(
          targets.map((item) => [
            item.session.nodeId,
            structuredClone(item.session.network),
          ]),
        ),
        bounds,
        currentDocument: startDocument,
        ...(control.kind === "resize" ? { handle: control.handle } : {}),
        kind: "selection-transform",
        mode:
          control.kind === "selection-box"
            ? "move"
            : control.kind === "resize"
              ? "resize"
              : "rotate",
        moved: false,
        repositionOffset: { x: 0, y: 0 },
        spaceActionDocument: null,
        spaceBaseOffset: null,
        spaceStartDocument: null,
        startClient,
        startDocument,
        vertexIdsByNode: new Map(
          targets.map((item) => [item.session.nodeId, item.vertexIds]),
        ),
        worldByNode: new Map(
          targets.map((item) => [item.session.nodeId, item.world]),
        ),
      };
      return;
    }
    const controlNodeId =
      control && "nodeId" in control ? control.nodeId : undefined;
    const targetNodeId =
      controlNodeId ?? (target ? this.#nodeId(target) : undefined);
    const targetNode = targetNodeId
      ? this.#input?.document.nodesById[targetNodeId]
      : undefined;
    const targetIsEditableVector =
      targetNode !== undefined &&
      (targetNode.kind === "path" || targetNode.kind === "vector") &&
      "network" in targetNode.properties;
    if (
      targetNodeId &&
      targetIsEditableVector &&
      (!control || control.kind === "path") &&
      (pointer.metaKey ||
        pointer.ctrlKey ||
        (pointer.shiftKey && !this.#vectorEdits.has(targetNodeId)))
    ) {
      this.#callbacks.onVectorEditScopeChange?.({
        mode: pointer.metaKey || pointer.ctrlKey ? "toggle" : "add",
        nodeId: targetNodeId,
      });
      return;
    }
    const targetSession = controlNodeId
      ? this.#vectorEdits.get(controlNodeId)
      : target
        ? [...this.#vectorEdits.values()].find(
            (session) =>
              target === session.cutHitPath ||
              this.#nodeId(target) === session.nodeId,
          )
        : undefined;
    const session = targetSession ?? this.#activeVectorEditSession();
    if (!session) return;
    if (this.#activeVectorEditNodeId !== session.nodeId) {
      this.#activeVectorEditNodeId = session.nodeId;
      this.#callbacks.onVectorEditActiveNodeChange?.(session.nodeId);
    }
    if (session.tool === "lasso") {
      const client = eventClientPoint(pointer);
      this.#vectorLasso = {
        activeNodeId: session.nodeId,
        lastClient: client,
        moved: false,
        pointsByNode: new Map(
          [...this.#vectorEdits.values()].map((candidate) => [
            candidate.nodeId,
            [pointer.getInnerPoint(candidate.pathElement)],
          ]),
        ),
        startClient: client,
        toggle: pointer.shiftKey,
      };
      session.lassoPath.set({ path: "", visible: false });
      return;
    }
    if (session.tool === "cut") {
      if (session.readOnly) return;
      let clickTarget: { at: VectorCutLocation; pathId: string } | undefined;
      if (control?.kind === "vertex") {
        const pathId = findVectorPathIdForVertex(
          session.network,
          control.vertexId,
        );
        if (pathId) {
          clickTarget = {
            at: { kind: "vertex", vertexId: control.vertexId },
            pathId,
          };
        }
      } else if (target === session.cutHitPath) {
        const local = pointer.getInnerPoint(session.pathElement);
        const hit = nearestVectorSegmentPoint(session.network, local);
        if (hit) {
          clickTarget = {
            at: {
              kind: "segment",
              segmentId: hit.segmentId,
              t: hit.t,
            },
            pathId: hit.pathId,
          };
        }
      }
      const startLocal = pointer.getInnerPoint(session.pathElement);
      const startDocument = pointer.getInnerPoint(this.#app.tree);
      session.drag = {
        ...(clickTarget ? { clickTarget } : {}),
        currentDocument: startDocument,
        currentLocal: startLocal,
        kind: "cut",
        moved: false,
        startClient: eventClientPoint(pointer),
        startDocument,
        startLocal,
      };
      return;
    }
    if (!control || control.kind === "path") {
      if (target && this.#nodeId(target) === session.nodeId) {
        const local = pointer.getInnerPoint(session.pathElement);
        const hit = nearestVectorSegmentPoint(session.network, local);
        const zoom = Math.max(
          MATRIX_EPSILON,
          Math.abs(this.#input?.viewport.zoom ?? 1),
        );
        const segmentIds = new Set(session.selectedSegmentIds);
        if (hit && hit.distance <= 8 / zoom) {
          if (pointer.shiftKey) {
            if (segmentIds.has(hit.segmentId)) segmentIds.delete(hit.segmentId);
            else segmentIds.add(hit.segmentId);
            this.#setVectorSelection(
              session,
              [...segmentIds],
              session.selectedVertexIds,
            );
          } else {
            this.#setVectorSelection(session, [hit.segmentId], []);
          }
        } else if (!pointer.shiftKey) {
          this.#setVectorSelection(session, [], []);
        }
      }
      return;
    }

    if (control.kind === "vertex") {
      const current = new Set(session.selectedVertexIds);
      if (pointer.shiftKey) {
        if (current.has(control.vertexId)) current.delete(control.vertexId);
        else current.add(control.vertexId);
      } else if (!current.has(control.vertexId)) {
        current.clear();
        current.add(control.vertexId);
      }
      this.#setVectorSelection(
        session,
        pointer.shiftKey ? session.selectedSegmentIds : [],
        [...current],
      );
      if (session.readOnly || !current.has(control.vertexId)) return;
      session.drag = {
        before: structuredClone(session.network),
        kind: "vertices",
        moved: false,
        startClient: eventClientPoint(pointer),
        startLocal: pointer.getInnerPoint(session.pathElement),
        vertexIds: [...current],
      };
      return;
    }

    if (!session.selectedVertexIds.includes(control.vertexId)) {
      this.#setVectorSelection(session, [], [control.vertexId]);
    }
    if (session.readOnly) return;
    session.drag = {
      before: structuredClone(session.network),
      kind: "handle",
      moved: false,
      reference: control.reference,
      startClient: eventClientPoint(pointer),
      vertexId: control.vertexId,
    };
  }

  #vectorEditPointerMove(event: unknown): void {
    const pointer = asLeaferEvent(event);
    const lasso = this.#vectorLasso;
    if (lasso && !this.#disposed) {
      if (pointer.isCancel) return;
      const client = eventClientPoint(pointer);
      lasso.moved ||=
        pointDistance(lasso.startClient, client) >= MIN_DRAW_DISTANCE;
      if (!lasso.moved || pointDistance(lasso.lastClient, client) < 2) return;
      lasso.lastClient = client;
      for (const session of this.#vectorEdits.values()) {
        const points = lasso.pointsByNode.get(session.nodeId);
        if (points) {
          const point = pointer.getInnerPoint(session.pathElement);
          if (points.length < MAX_VECTOR_LASSO_POINTS) points.push(point);
          else points[MAX_VECTOR_LASSO_POINTS - 1] = point;
        }
      }
      const active = this.#vectorEdits.get(lasso.activeNodeId);
      const points = lasso.pointsByNode.get(lasso.activeNodeId);
      if (active && points) {
        const zoom = Math.max(
          MATRIX_EPSILON,
          Math.abs(this.#input?.viewport.zoom ?? 1),
        );
        active.lassoPath.set({
          path: vectorLassoPath(points),
          strokeWidth: 1.5 / zoom,
          visible: true,
        });
      }
      return;
    }
    const session = [...this.#vectorEdits.values()].find(
      (candidate) => candidate.drag !== null,
    );
    const drag = session?.drag;
    if (!session || !drag || this.#disposed) return;
    if (pointer.isCancel) return;
    const client = eventClientPoint(pointer);
    drag.moved ||= pointDistance(drag.startClient, client) >= MIN_DRAW_DISTANCE;
    if (!drag.moved) return;
    if (drag.kind === "cut") {
      drag.currentDocument = pointer.getInnerPoint(this.#app.tree);
      drag.currentLocal = pointer.getInnerPoint(session.pathElement);
      this.#renderVectorCutGuide(session);
      return;
    }
    if (drag.kind === "selection-transform") {
      const currentDocument = pointer.getInnerPoint(this.#app.tree);
      drag.currentDocument = currentDocument;
      const repositioning =
        drag.mode !== "move" &&
        drag.spaceStartDocument !== null &&
        drag.spaceBaseOffset !== null &&
        drag.spaceActionDocument !== null;
      if (repositioning) {
        drag.repositionOffset = {
          x:
            drag.spaceBaseOffset!.x +
            currentDocument.x -
            drag.spaceStartDocument!.x,
          y:
            drag.spaceBaseOffset!.y +
            currentDocument.y -
            drag.spaceStartDocument!.y,
        };
      }
      const actionDocument = repositioning
        ? drag.spaceActionDocument!
        : {
            x: currentDocument.x - drag.repositionOffset.x,
            y: currentDocument.y - drag.repositionOffset.y,
          };
      const baseTransform: Transform =
        drag.mode === "move"
          ? [
              1,
              0,
              0,
              1,
              currentDocument.x - drag.startDocument.x,
              currentDocument.y - drag.startDocument.y,
            ]
          : drag.mode === "resize" && drag.handle
            ? vectorSelectionResizeTransform(
                drag.bounds,
                drag.handle,
                actionDocument,
                {
                  fromCenter: pointer.altKey,
                  proportional: pointer.shiftKey,
                },
              )
            : vectorSelectionRotationTransform(
                drag.bounds,
                drag.startDocument,
                actionDocument,
                pointer.shiftKey,
              );
      const documentTransform =
        drag.mode === "move"
          ? baseTransform
          : translateVectorSelectionTransform(
              baseTransform,
              drag.repositionOffset,
            );
      const previews = new Map<string, VectorNetwork>();
      let changed = false;
      for (const [nodeId, before] of drag.beforeByNode) {
        const world = drag.worldByNode.get(nodeId);
        const vertexIds = drag.vertexIdsByNode.get(nodeId);
        const localTransform = world
          ? documentTransformToLocal(world, documentTransform)
          : null;
        if (!world || !vertexIds || !localTransform) {
          this.#report(
            new Error(`Vector layer ${nodeId} has a non-invertible transform`),
          );
          return;
        }
        const result = transformVectorVertices(
          before,
          vertexIds,
          localTransform,
        );
        if (!result.ok) {
          if (result.code === "no-op") {
            previews.set(nodeId, structuredClone(before));
            continue;
          }
          this.#report(new Error(result.message));
          return;
        }
        changed = true;
        previews.set(nodeId, result.network);
      }
      if (!changed) drag.moved = false;
      for (const [nodeId, network] of previews) {
        const target = this.#vectorEdits.get(nodeId);
        if (target) target.network = network;
      }
      this.#renderVectorEditOverlays();
      return;
    }
    const local = pointer.getInnerPoint(session.pathElement);
    const result = (() => {
      if (drag.kind === "vertices") {
        return moveVectorVertices(drag.before, drag.vertexIds, {
          x: local.x - drag.startLocal.x,
          y: local.y - drag.startLocal.y,
        });
      }
      return (() => {
        const vertex = drag.before.vertices.find(
          (candidate) => candidate.id === drag.vertexId,
        );
        return vertex
          ? moveVectorHandle(drag.before, drag.reference, {
              x: local.x - vertex.x,
              y: local.y - vertex.y,
            })
          : {
              ok: false as const,
              code: "missing-vertex" as const,
              message: `Vector vertex ${drag.vertexId} does not exist`,
            };
      })();
    })();
    if (!result.ok) {
      if (result.code === "no-op") {
        drag.moved = false;
        session.network = structuredClone(drag.before);
        this.#renderVectorEditOverlay(session);
        return;
      }
      this.#report(new Error(result.message));
      return;
    }
    session.network = result.network;
    this.#renderVectorEditOverlay(session);
  }

  #vectorEditPointerUp(event: unknown): void {
    if (this.#vectorLasso) {
      const pointer = asLeaferEvent(event);
      if (!pointer.isCancel) this.#vectorEditPointerMove(event);
      if (pointer.isCancel) this.#cancelVectorLasso();
      else this.#finishVectorLasso();
      return;
    }
    const session = [...this.#vectorEdits.values()].find(
      (candidate) => candidate.drag !== null,
    );
    const drag = session?.drag;
    if (!session || !drag) return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel) {
      this.#cancelVectorEditDrag(session);
      this.#renderVectorEditOverlays();
      return;
    }
    this.#vectorEditPointerMove(event);
    const moved = drag.moved;
    if (drag.kind === "cut") {
      const end = drag.currentDocument;
      const clickTarget = drag.clickTarget;
      const start = drag.startDocument;
      session.drag = null;
      this.#renderVectorCutGuide(session);
      if (moved) this.#submitVectorLineCut(start, end);
      else if (clickTarget) {
        this.#submitVectorCut(clickTarget.pathId, clickTarget.at);
      }
      return;
    }
    if (drag.kind === "selection-transform") {
      session.drag = null;
      if (moved) {
        this.#submitVectorEdits(
          [...drag.beforeByNode.keys()].flatMap((nodeId) => {
            const target = this.#vectorEdits.get(nodeId);
            return target
              ? [{ network: target.network, nodeId: target.nodeId }]
              : [];
          }),
        );
      } else {
        this.#renderVectorEditOverlays();
      }
      return;
    }
    const network = session.network;
    session.drag = null;
    if (moved) this.#submitVectorEdit(session, network);
  }

  #finishVectorLasso(): void {
    const lasso = this.#vectorLasso;
    if (!lasso) return;
    this.#vectorLasso = null;
    let lastSelectedNodeId: string | null = null;
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.abs(this.#input?.viewport.zoom ?? 1),
    );
    for (const session of this.#vectorEdits.values()) {
      const polygon = lasso.pointsByNode.get(session.nodeId) ?? [];
      const enclosedVertices = lasso.moved
        ? session.network.vertices
            .filter((vertex) => pointInPolygon(vertex, polygon))
            .map((vertex) => vertex.id)
        : [];
      const enclosedSegments = lasso.moved
        ? vectorSegmentsInPolygon(session.network, polygon, 0.75 / zoom)
        : [];
      const nextVertices = lasso.toggle
        ? toggleStringSelection(session.selectedVertexIds, enclosedVertices)
        : enclosedVertices;
      const nextSegments = lasso.toggle
        ? toggleStringSelection(session.selectedSegmentIds, enclosedSegments)
        : enclosedSegments;
      if (nextVertices.length > 0 || nextSegments.length > 0) {
        lastSelectedNodeId = session.nodeId;
      }
      this.#setVectorSelection(session, nextSegments, nextVertices);
      session.lassoPath.set({ path: "", visible: false });
    }
    if (
      lastSelectedNodeId &&
      lastSelectedNodeId !== this.#activeVectorEditNodeId
    ) {
      this.#activeVectorEditNodeId = lastSelectedNodeId;
      this.#callbacks.onVectorEditActiveNodeChange?.(lastSelectedNodeId);
    }
  }

  #cancelVectorLasso(): void {
    if (!this.#vectorLasso) return;
    this.#vectorLasso = null;
    for (const session of this.#vectorEdits.values()) {
      session.lassoPath.set({ path: "", visible: false });
    }
  }

  #renderVectorCutGuide(session: VectorEditSession): void {
    const drag = session.drag;
    if (!drag || drag.kind !== "cut" || !drag.moved) {
      session.cutGuidePath.set({ path: "", visible: false });
      return;
    }
    session.cutGuidePath.set({
      path: `M ${drag.startLocal.x} ${drag.startLocal.y} L ${drag.currentLocal.x} ${drag.currentLocal.y}`,
      visible: true,
    });
  }

  #cancelVectorEditDrag(session: VectorEditSession): void {
    const drag = session.drag;
    if (!drag) return;
    if (drag.kind === "selection-transform") {
      for (const [nodeId, before] of drag.beforeByNode) {
        const target = this.#vectorEdits.get(nodeId);
        if (target) target.network = structuredClone(before);
      }
    } else if (drag.kind !== "cut") {
      session.network = drag.before;
    }
    session.drag = null;
    session.cutGuidePath.set({ path: "", visible: false });
  }

  #submitVectorEdit(
    session: VectorEditSession,
    network: VectorNetwork,
  ): boolean {
    return this.#submitVectorEdits([{ network, nodeId: session.nodeId }]);
  }

  #submitVectorEdits(
    edits: readonly { network: VectorNetwork; nodeId: string }[],
  ): boolean {
    if (!this.#callbacks.onVectorEdit) {
      this.#report(new Error("Vector editing callback is unavailable"));
      return false;
    }
    const accepted = this.#callbacks.onVectorEdit({
      deleteNode: false,
      edits,
    });
    if (!accepted) {
      this.#restoreProjection();
      return false;
    }
    for (const edit of edits) {
      const session = this.#vectorEdits.get(edit.nodeId);
      if (session) session.network = structuredClone(edit.network);
    }
    this.#renderVectorEditOverlays();
    return true;
  }

  #submitVectorCut(pathId: string, at: VectorCutLocation): boolean {
    const session = this.#activeVectorEditSession();
    if (!session || !this.#callbacks.onVectorCut) {
      this.#report(new Error("Vector cut callback is unavailable"));
      return false;
    }
    const response = this.#callbacks.onVectorCut({
      at,
      nodeId: session.nodeId,
      pathId,
    });
    if (!response.ok) {
      this.#restoreProjection();
      return false;
    }
    if (this.#vectorEdits.get(session.nodeId) === session) {
      session.network = structuredClone(response.network);
      session.selectedSegmentIds = [];
      session.selectedVertexIds = [...response.selectedVertexIds];
      this.#callbacks.onVectorEditSelectionChange?.(session.nodeId, {
        segmentIds: [],
        vertexIds: response.selectedVertexIds,
      });
      this.#renderVectorEditOverlays();
    }
    return true;
  }

  #submitVectorLineCut(start: Point, end: Point): boolean {
    if (!this.#callbacks.onVectorLineCut) {
      this.#report(new Error("Vector line Cut callback is unavailable"));
      return false;
    }
    const response = this.#callbacks.onVectorLineCut({
      end,
      nodeIds: [...this.#vectorEdits.values()]
        .filter((session) => !session.readOnly)
        .map((session) => session.nodeId),
      start,
    });
    if (!response.ok) {
      this.#restoreProjection();
      return false;
    }
    this.#callbacks.onVectorEditExit?.();
    return true;
  }

  #deleteSelectedVectorVertices(): boolean {
    const session = this.#activeVectorEditSession();
    if (!session) return false;
    if (
      session.readOnly ||
      (session.selectedVertexIds.length === 0 &&
        session.selectedSegmentIds.length === 0)
    )
      return true;
    const result = deleteVectorSelection(
      session.network,
      session.selectedVertexIds,
      session.selectedSegmentIds,
    );
    if (!result.ok) {
      this.#report(new Error(result.message));
      return true;
    }
    const accepted = result.deleteNode
      ? (this.#callbacks.onVectorEdit?.({
          deleteNode: true,
          nodeId: session.nodeId,
        }) ?? false)
      : this.#submitVectorEdit(session, result.network);
    if (accepted) {
      this.#callbacks.onVectorEditSelectionChange?.(session.nodeId, {
        segmentIds: [],
        vertexIds: [],
      });
      if (result.deleteNode) this.#callbacks.onVectorEditExit?.();
    }
    return true;
  }

  #cancelVectorEditSession(session: VectorEditSession): void {
    if (this.#vectorLasso) this.#cancelVectorLasso();
    const sharedDrag = [...this.#vectorEdits.values()].find(
      (candidate) =>
        candidate.drag?.kind === "selection-transform" &&
        candidate.drag.beforeByNode.has(session.nodeId),
    );
    if (sharedDrag) this.#cancelVectorEditDrag(sharedDrag);
    this.#vectorEdits.delete(session.nodeId);
    if (this.#activeVectorEditNodeId === session.nodeId) {
      this.#activeVectorEditNodeId = null;
    }
    const node = this.#input?.document.nodesById[session.nodeId];
    if (
      node &&
      (node.kind === "path" || node.kind === "vector") &&
      "network" in node.properties
    ) {
      const authoritative = serializeVectorNetwork(node.properties.network);
      if (authoritative.ok)
        session.pathElement.set({ path: authoritative.path });
    }
    session.overlayGroup.remove();
    session.overlayGroup.destroy();
  }

  #cancelVectorEdit(): void {
    this.#cancelVectorLasso();
    for (const session of [...this.#vectorEdits.values()]) {
      this.#cancelVectorEditSession(session);
    }
    this.#activeVectorEditNodeId = null;
    this.#renderVectorSelectionOverlay();
  }

  #syncGenerationActivity(
    activity: LeaferGenerationActivity | undefined,
    reducedMotion: boolean,
  ): void {
    if (!activity || this.#suppressedGenerationActivityIds.has(activity.id)) {
      this.#clearGenerationActivity(false);
      return;
    }
    const fingerprint = JSON.stringify(activity);
    if (
      this.#generationActivityId === activity.id &&
      this.#generationActivityFingerprint === fingerprint
    ) {
      this.#syncGenerationActivityViewport();
      return;
    }

    this.#generationActivityId = activity.id;
    this.#generationActivityFingerprint = fingerprint;
    this.#generationActivityRevealNodeId = null;
    const badgeWidth = generationActivityBadgeWidth(activity.label);
    this.#generationActivityElements.badge.set({ width: badgeWidth });
    this.#generationActivityElements.label.set({
      text: activity.label,
      width: badgeWidth - 16,
    });
    this.#setGenerationActivityTarget(activity.target, reducedMotion);
  }

  #setGenerationActivityTarget(point: Point, reducedMotion: boolean): void {
    const target = { x: point.x, y: point.y };
    if (
      reducedMotion ||
      !this.#generationActivityCurrentPoint ||
      !this.#generationActivityTargetPoint
    ) {
      this.#cancelGenerationActivityMove();
      this.#generationActivityCurrentPoint = target;
      this.#generationActivityTargetPoint = target;
      this.#generationActivityMoveFrom = target;
      this.#generationActivityLayer.visible = true;
      this.#syncGenerationActivityViewport();
      return;
    }
    if (samePoint(this.#generationActivityTargetPoint, target)) {
      this.#syncGenerationActivityViewport();
      return;
    }
    this.#generationActivityMoveFrom = {
      ...this.#generationActivityCurrentPoint,
    };
    this.#generationActivityTargetPoint = target;
    this.#generationActivityMoveStartedAt = null;
    this.#generationActivityLayer.visible = true;
    this.#scheduleGenerationActivityFrame();
  }

  #scheduleGenerationActivityFrame(): void {
    if (
      this.#disposed ||
      this.#generationActivityFrame !== null ||
      !this.#generationActivityId
    ) {
      return;
    }
    this.#generationActivityFrame = requestAnimationFrame((now) => {
      this.#generationActivityFrame = null;
      if (this.#disposed || !this.#generationActivityId) return;
      const from = this.#generationActivityMoveFrom;
      const target = this.#generationActivityTargetPoint;
      if (!from || !target) return;
      this.#generationActivityMoveStartedAt ??= now;
      const elapsed = Math.max(0, now - this.#generationActivityMoveStartedAt);
      const progress = Math.min(1, elapsed / GENERATION_ACTIVITY_MOVE_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.#generationActivityCurrentPoint = {
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
      };
      this.#syncGenerationActivityViewport();
      if (progress < 1) {
        this.#scheduleGenerationActivityFrame();
      } else {
        this.#generationActivityMoveFrom = target;
        this.#generationActivityMoveStartedAt = null;
      }
    });
  }

  #syncGenerationActivityViewport(): void {
    const point = this.#generationActivityCurrentPoint;
    if (!point || !this.#generationActivityId) return;
    const matrix = this.#app.tree.localTransform;
    const screen = {
      x: matrix.a * point.x + matrix.c * point.y + matrix.e,
      y: matrix.b * point.x + matrix.d * point.y + matrix.f,
    };
    const hostBounds = this.#host.getBoundingClientRect();
    const onScreen =
      screen.x >= -24 &&
      screen.y >= -24 &&
      screen.x <= hostBounds.width + 24 &&
      screen.y <= hostBounds.height + 24;
    if (this.#generationActivityLayer.visible !== onScreen) {
      this.#generationActivityLayer.visible = onScreen;
    }
    if (!onScreen) return;
    const layerTransform = matrixRelativeToParent(
      this.#generationPresentationRoot.localTransform,
      {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: screen.x,
        f: screen.y,
      },
      MATRIX_EPSILON,
    );
    if (!layerTransform) {
      this.#generationActivityLayer.visible = false;
      this.#generationActivityViewportState = null;
      return;
    }
    const badgeWidth = Math.max(
      1,
      Number(this.#generationActivityElements.badge.width) || 148,
    );
    const badgeX =
      screen.x + badgeWidth + 28 > hostBounds.width ? -badgeWidth - 14 : 14;
    const badgeY = screen.y + 48 > hostBounds.height ? -40 : 16;
    const previous = this.#generationActivityViewportState;
    if (
      previous &&
      sameAffineMatrix(
        previous.layerTransform,
        layerTransform,
        MATRIX_EPSILON,
      ) &&
      nearlyEqual(previous.badgeWidth, badgeWidth) &&
      nearlyEqual(previous.badgeX, badgeX) &&
      nearlyEqual(previous.badgeY, badgeY)
    ) {
      return;
    }
    this.#generationActivityViewportState = {
      badgeWidth,
      badgeX,
      badgeY,
      layerTransform: { ...layerTransform },
    };
    this.#generationActivityLayer.setTransform(layerTransform);
    this.#generationActivityElements.badge.set({ x: badgeX, y: badgeY });
    this.#generationActivityElements.label.set({
      width: badgeWidth - 16,
      x: badgeX + 8,
      y: badgeY + 6,
    });
  }

  #focusGenerationActivityOnRevealLast(reveal: LeaferGenerationReveal): void {
    if (!this.#generationActivityId || !reveal.focusPoints) return;
    const nodeIds = [...reveal.nodeIds, ...(reveal.tweenNodeIds ?? [])];
    for (let index = nodeIds.length - 1; index >= 0; index -= 1) {
      const nodeId = nodeIds[index];
      if (!nodeId) continue;
      const point = reveal.focusPoints[nodeId];
      if (!point) continue;
      this.#generationActivityRevealNodeId = nodeId;
      this.#setGenerationActivityTarget(point, true);
      return;
    }
  }

  #cancelGenerationActivityMove(): void {
    if (this.#generationActivityFrame !== null) {
      cancelAnimationFrame(this.#generationActivityFrame);
      this.#generationActivityFrame = null;
    }
    this.#generationActivityMoveStartedAt = null;
  }

  #clearGenerationActivity(suppress: boolean): void {
    const activityId = this.#generationActivityId;
    if (suppress && activityId) {
      this.#suppressedGenerationActivityIds.add(activityId);
      while (
        this.#suppressedGenerationActivityIds.size >
        MAX_SUPPRESSED_GENERATION_ACTIVITIES
      ) {
        const oldest = this.#suppressedGenerationActivityIds
          .values()
          .next().value;
        if (oldest === undefined) break;
        this.#suppressedGenerationActivityIds.delete(oldest);
      }
    }
    this.#cancelGenerationActivityMove();
    this.#generationActivityLayer.visible = false;
    this.#generationActivityCurrentPoint = null;
    this.#generationActivityFingerprint = null;
    this.#generationActivityId = null;
    this.#generationActivityMoveFrom = null;
    this.#generationActivityTargetPoint = null;
    this.#generationActivityRevealNodeId = null;
    this.#generationActivityViewportState = null;
  }

  #syncGenerationSkeleton(
    skeleton: LeaferGenerationSkeleton | undefined,
  ): void {
    if (!skeleton || this.#suppressedGenerationSkeletonIds.has(skeleton.id)) {
      this.#clearGenerationSkeleton(false);
      return;
    }
    const fingerprint = JSON.stringify(skeleton);
    if (
      this.#generationSkeletonId === skeleton.id &&
      this.#generationSkeletonFingerprint === fingerprint
    ) {
      this.#syncGenerationSkeletonViewport();
      return;
    }

    this.#clearGenerationSkeleton(false);
    this.#generationSkeletonId = skeleton.id;
    this.#generationSkeletonFingerprint = fingerprint;
    if (!skeleton.artboard.pending && skeleton.regions.length === 0) {
      return;
    }

    const artboardGroup = new this.#leafer.Group({
      editable: false,
      hitChildren: false,
      hittable: false,
    }) as LeaferGroup;
    artboardGroup.setTransform(transformToAffine(skeleton.artboard.transform));
    if (skeleton.artboard.pending) {
      const outline = new this.#leafer.Rect({
        cornerRadius: 8,
        dashPattern: [8, 6],
        editable: false,
        fill: "rgba(124, 110, 230, 0.035)",
        height: skeleton.artboard.height,
        hittable: false,
        stroke: GENERATION_SKELETON_COLOR,
        strokeAlign: "inside",
        width: skeleton.artboard.width,
      }) as LeaferElement;
      this.#generationSkeletonStrokes.push(outline);
      artboardGroup.add(outline);
    }
    for (const region of skeleton.regions) {
      const outline = new this.#leafer.Rect({
        cornerRadius: 5,
        dashPattern: [5, 4],
        editable: false,
        fill: generationSkeletonFill(region.role, GENERATION_SKELETON_FILL),
        height: region.height,
        hittable: false,
        stroke: GENERATION_SKELETON_COLOR,
        strokeAlign: "inside",
        width: region.width,
        x: region.x,
        y: region.y,
      }) as LeaferElement;
      const label = new this.#leafer.Text({
        editable: false,
        fill: GENERATION_SKELETON_COLOR,
        fontFamily: "Inter, sans-serif",
        fontWeight: 600,
        hittable: false,
        text: region.name,
        textOverflow: "ellipsis",
      }) as LeaferElement;
      this.#generationSkeletonStrokes.push(outline);
      this.#generationSkeletonLabels.push({
        element: label,
        height: region.height,
        width: region.width,
        x: region.x,
        y: region.y,
      });
      artboardGroup.add(outline);
      artboardGroup.add(label);
    }
    this.#generationSkeletonLayer.add(artboardGroup);
    this.#generationSkeletonLayer.visible = true;
    this.#syncGenerationSkeletonViewport();
  }

  #syncGenerationSkeletonViewport(): void {
    if (!this.#generationSkeletonId) return;
    const treeTransform = this.#app.tree.localTransform;
    const layerTransform = matrixRelativeToParent(
      this.#generationPresentationRoot.localTransform,
      treeTransform,
      MATRIX_EPSILON,
    );
    if (!layerTransform) {
      this.#generationSkeletonLayer.visible = false;
      this.#generationSkeletonViewportState = null;
      return;
    }
    const zoom = Math.max(MATRIX_EPSILON, Math.abs(treeTransform.a || 1));
    const previous = this.#generationSkeletonViewportState;
    if (
      previous &&
      sameAffineMatrix(
        previous.layerTransform,
        layerTransform,
        MATRIX_EPSILON,
      ) &&
      nearlyEqual(previous.zoom, zoom)
    ) {
      if (!this.#generationSkeletonLayer.visible) {
        this.#generationSkeletonLayer.visible = true;
      }
      return;
    }
    this.#generationSkeletonViewportState = {
      layerTransform: { ...layerTransform },
      zoom,
    };
    this.#generationSkeletonLayer.setTransform(layerTransform);
    this.#generationSkeletonLayer.visible = true;
    const inverseZoom = 1 / zoom;
    for (const element of this.#generationSkeletonStrokes) {
      element.set({
        dashPattern: [5 * inverseZoom, 4 * inverseZoom],
        strokeWidth: 1.15 * inverseZoom,
      });
    }
    for (const label of this.#generationSkeletonLabels) {
      const inset = 7 * inverseZoom;
      const labelHeight = Math.min(label.height, 16 * inverseZoom);
      label.element.set({
        fontSize: 11 * inverseZoom,
        height: labelHeight,
        lineHeight: 14 * inverseZoom,
        width: Math.max(inverseZoom, label.width - inset * 2),
        x: label.x + inset,
        y: label.y + 5 * inverseZoom,
      });
    }
  }

  #scheduleGenerationViewportSync(): void {
    if (
      this.#disposed ||
      this.#generationViewportFrame !== null ||
      (!this.#generationSkeletonId &&
        !this.#generationActivityId &&
        !this.#editorOverlays.active)
    ) {
      return;
    }
    this.#generationViewportFrame = requestAnimationFrame(() => {
      this.#generationViewportFrame = null;
      if (this.#disposed) return;
      // Leafer can settle the document tree and built-in editor sky in
      // different callbacks. Re-read both and recompute their relative
      // transform so kinetic pan/zoom never leaves an intermediate offset.
      this.#editorOverlays.syncViewport();
      this.#syncGenerationSkeletonViewport();
      this.#syncGenerationActivityViewport();
    });
  }

  #clearGenerationSkeleton(suppress: boolean): void {
    const skeletonId = this.#generationSkeletonId;
    if (suppress && skeletonId) {
      this.#suppressedGenerationSkeletonIds.add(skeletonId);
      while (
        this.#suppressedGenerationSkeletonIds.size >
        MAX_SUPPRESSED_GENERATION_SKELETONS
      ) {
        const oldest = this.#suppressedGenerationSkeletonIds
          .values()
          .next().value;
        if (oldest === undefined) break;
        this.#suppressedGenerationSkeletonIds.delete(oldest);
      }
    }
    for (const child of [...this.#generationSkeletonLayer.children]) {
      child.remove();
      child.destroy();
    }
    this.#generationSkeletonLayer.visible = false;
    this.#generationSkeletonFingerprint = null;
    this.#generationSkeletonId = null;
    this.#generationSkeletonLabels.length = 0;
    this.#generationSkeletonStrokes.length = 0;
    this.#generationSkeletonViewportState = null;
  }

  #queueGenerationReveal(
    reveal: LeaferGenerationReveal,
    tweenStarts?: ReadonlyMap<string, GenerationTweenEndpoint>,
  ): void {
    if (!this.#rememberGenerationReveal(reveal.id)) return;
    if (reveal.focusPoints) {
      for (const nodeId of [
        ...reveal.nodeIds,
        ...(reveal.tweenNodeIds ?? []),
      ]) {
        const point = reveal.focusPoints[nodeId];
        if (point) this.#generationRevealFocusPoints.set(nodeId, point);
      }
    }
    const nodeIds = reveal.nodeIds.filter((nodeId) => {
      const spec = this.#projection?.elementsById.get(nodeId);
      const opacity = spec?.data.opacity;
      return (
        this.#elements.has(nodeId) &&
        spec?.data.visible !== false &&
        (typeof opacity !== "number" || opacity > 0)
      );
    });
    const scheduled = scheduleGenerationReveals(
      nodeIds,
      reveal.startedAt,
      this.#generationRevealNextStartAt,
    );
    this.#generationRevealNextStartAt = scheduled.nextAvailableStartAt;
    for (const item of scheduled.items) {
      this.#generationReveals.set(item.nodeId, item);
      this.#setGenerationRevealOpacity(item.nodeId, 0);
    }
    this.#queueGenerationTweens(reveal, tweenStarts);
    if (scheduled.items.length > 0 || this.#generationTweens.size > 0) {
      this.#scheduleGenerationPresentationFrame();
    }
  }

  #rememberGenerationReveal(revealId: string): boolean {
    if (this.#processedGenerationRevealIds.has(revealId)) return false;
    this.#processedGenerationRevealIds.add(revealId);
    while (
      this.#processedGenerationRevealIds.size > MAX_PROCESSED_GENERATION_REVEALS
    ) {
      const oldest = this.#processedGenerationRevealIds.values().next().value;
      if (oldest === undefined) break;
      this.#processedGenerationRevealIds.delete(oldest);
    }
    return true;
  }

  #scheduleGenerationPresentationFrame(): void {
    if (this.#disposed || this.#generationPresentationFrame !== null) return;
    this.#generationPresentationFrame = requestAnimationFrame((now) => {
      this.#generationPresentationFrame = null;
      if (this.#disposed) return;
      try {
        this.#recordGenerationPresentationFrame(now);
        this.#renderGenerationRevealFrame(now);
        this.#renderGenerationTweenFrame(now);
      } catch (error) {
        this.#finishGenerationReveal();
        this.#report(error);
        return;
      }
      if (this.#generationReveals.size > 0 || this.#generationTweens.size > 0) {
        this.#scheduleGenerationPresentationFrame();
      } else {
        this.#generationPresentationLastFrameAt = null;
      }
    });
  }

  #renderGenerationRevealFrame(now: number): void {
    let active:
      | {
          element: LeaferElement;
          nodeId: string;
          opacity: number;
          startsAt: number;
        }
      | undefined;
    for (const [nodeId, item] of this.#generationReveals) {
      const element = this.#elements.get(nodeId);
      const spec = this.#projection?.elementsById.get(nodeId);
      if (!element || !spec) {
        this.#generationReveals.delete(nodeId);
        continue;
      }
      const state = generationRevealPaintState(item, now);
      const finalOpacity = projectionOpacity(spec.data.opacity);
      this.#setGenerationRevealOpacity(
        nodeId,
        finalOpacity * state.nodeOpacity,
      );
      if (state.phase === "done") {
        this.#generationReveals.delete(nodeId);
        continue;
      }
      if (
        state.overlayOpacity > 0 &&
        (!active || item.startsAt >= active.startsAt)
      ) {
        active = {
          element,
          nodeId,
          opacity: state.overlayOpacity,
          startsAt: item.startsAt,
        };
      }
    }

    if (active) {
      this.#generationRevealStroker.setTarget(active.element, {
        opacity: active.opacity,
      });
      if (
        this.#generationActivityId &&
        this.#generationActivityRevealNodeId !== active.nodeId
      ) {
        const point = this.#generationRevealFocusPoints.get(active.nodeId);
        if (point) {
          this.#generationActivityRevealNodeId = active.nodeId;
          this.#setGenerationActivityTarget(point, false);
        }
      }
    } else {
      this.#generationRevealStroker.target = null as never;
      this.#generationRevealStroker.opacity = 0;
      this.#generationRevealStroker.update();
    }
    if (
      this.#generationReveals.size === 0 &&
      this.#generationTweens.size === 0
    ) {
      this.#generationRevealNextStartAt = null;
      this.#generationRevealFocusPoints.clear();
      this.#generationActivityRevealNodeId = null;
    }
  }

  #setGenerationRevealOpacity(nodeId: string, opacity: number): void {
    const element = this.#elements.get(nodeId);
    if (!element || nearlyEqual(element.opacity ?? 1, opacity)) return;
    element.opacity = opacity;
  }

  #restoreGenerationRevealNode(nodeId: string): void {
    const opacity = projectionOpacity(
      this.#projection?.elementsById.get(nodeId)?.data.opacity,
    );
    this.#setGenerationRevealOpacity(nodeId, opacity);
  }

  #finishGenerationRevealNode(nodeId: string): void {
    if (!this.#generationReveals.delete(nodeId)) return;
    const element = this.#elements.get(nodeId);
    this.#restoreGenerationRevealNode(nodeId);
    if (element && this.#generationRevealStroker.target === element) {
      this.#generationRevealStroker.target = null as never;
      this.#generationRevealStroker.opacity = 0;
      this.#generationRevealStroker.update();
    }
  }

  #queueGenerationTweens(
    reveal: LeaferGenerationReveal,
    tweenStarts?: ReadonlyMap<string, GenerationTweenEndpoint>,
  ): void {
    const requested = reveal.tweenNodeIds ?? [];
    if (requested.length === 0 || !tweenStarts || !this.#projection) return;
    const selectedNodeIds = new Set(this.#input?.selection.nodeIds ?? []);
    const candidates = requested.flatMap((nodeId, order) => {
      const start = tweenStarts.get(nodeId);
      const target = this.#projection?.elementsById.get(nodeId);
      const element = this.#elements.get(nodeId);
      const disappearing =
        target?.data.visible === false && start?.data.visible !== false;
      if (
        !start ||
        !target ||
        !element ||
        (target.data.visible === false && !disappearing) ||
        (!disappearing && !this.#isGenerationTweenVisible(element))
      ) {
        return [];
      }
      return [
        {
          element,
          nodeId,
          order,
          selected: selectedNodeIds.has(nodeId),
          start,
          target,
        },
      ];
    });
    const cadence = generationTweenCadence({
      averageFrameMs: this.#generationPresentationAverageFrameMs,
      nodeCount: requested.length,
      visibleNodeCount: candidates.length,
    });
    candidates.sort(
      (left, right) =>
        Number(right.selected) - Number(left.selected) ||
        left.order - right.order,
    );
    candidates
      .slice(0, cadence.maximumAnimatedNodeCount)
      .forEach(({ element, nodeId, start, target }, index) => {
        const plan = createGenerationTweenPlan(
          nodeId,
          start,
          { data: target.data, transform: target.transform },
          reveal.startedAt + index * cadence.staggerMs,
          cadence.durationMs,
        );
        if (!plan) return;
        const current = generationTweenFrame(plan, plan.startsAt);
        this.#generationTweens.set(nodeId, { current, plan });
        this.#applyGenerationTweenFrame(element, current);
      });
    const animatedNodeIds = new Set(this.#generationTweens.keys());
    const selectionBounds = this.#selectionBoundsAffected(
      animatedNodeIds,
      this.#projection,
      this.#projection,
    );
    if (selectionBounds.size > 0) {
      for (const nodeId of selectionBounds) {
        this.#elements.get(nodeId)?.forceUpdate("bounds");
      }
      this.#editor.update();
    }
    const lastAnimatedNodeId = [...this.#generationTweens.keys()].at(-1);
    const focusPoint = lastAnimatedNodeId
      ? this.#generationRevealFocusPoints.get(lastAnimatedNodeId)
      : undefined;
    if (
      lastAnimatedNodeId &&
      focusPoint &&
      this.#generationActivityId &&
      this.#generationActivityRevealNodeId !== lastAnimatedNodeId
    ) {
      this.#generationActivityRevealNodeId = lastAnimatedNodeId;
      this.#setGenerationActivityTarget(focusPoint, false);
    }
  }

  #renderGenerationTweenFrame(now: number): void {
    if (this.#generationTweens.size === 0) return;
    const changedNodeIds = new Set<string>();
    for (const [nodeId, active] of this.#generationTweens) {
      const element = this.#elements.get(nodeId);
      const target = this.#projection?.elementsById.get(nodeId);
      if (!element || !target) {
        this.#generationTweens.delete(nodeId);
        continue;
      }
      const current = generationTweenFrame(active.plan, now);
      active.current = current;
      this.#applyGenerationTweenFrame(element, current);
      changedNodeIds.add(nodeId);
      if (current.done) {
        this.#restoreGenerationTweenNode(nodeId);
        this.#generationTweens.delete(nodeId);
      }
    }
    const projection = this.#projection;
    if (projection && changedNodeIds.size > 0) {
      const selectionBounds = this.#selectionBoundsAffected(
        changedNodeIds,
        projection,
        projection,
      );
      if (selectionBounds.size > 0) {
        for (const nodeId of selectionBounds) {
          this.#elements.get(nodeId)?.forceUpdate("bounds");
        }
        this.#editor.update();
      }
    }
    if (
      this.#generationTweens.size === 0 &&
      this.#generationReveals.size === 0
    ) {
      this.#generationRevealNextStartAt = null;
      this.#generationRevealFocusPoints.clear();
      this.#generationActivityRevealNodeId = null;
    }
  }

  #takeGenerationTweenStart(
    nodeId: string,
    previousSpec: LeaferElementSpec,
  ): GenerationTweenEndpoint {
    const active = this.#generationTweens.get(nodeId);
    if (!active) {
      return { data: previousSpec.data, transform: previousSpec.transform };
    }
    this.#generationTweens.delete(nodeId);
    return {
      data: { ...previousSpec.data, ...active.current.data },
      transform: active.current.transform,
    };
  }

  #finishGenerationTweenNode(nodeId: string, restore: boolean): void {
    if (!this.#generationTweens.delete(nodeId)) return;
    if (restore) {
      this.#restoreGenerationTweenNode(nodeId);
      this.#refreshGenerationTweenSelection(new Set([nodeId]));
    }
  }

  #finishGenerationTweens(): void {
    const nodeIds = new Set(this.#generationTweens.keys());
    for (const [nodeId] of this.#generationTweens) {
      this.#restoreGenerationTweenNode(nodeId);
    }
    this.#generationTweens.clear();
    this.#refreshGenerationTweenSelection(nodeIds);
  }

  #restoreGenerationTweenNode(nodeId: string): void {
    const element = this.#elements.get(nodeId);
    const target = this.#projection?.elementsById.get(nodeId);
    if (!element || !target) return;
    element.set(target.data);
    element.setTransform(transformToAffine(target.transform));
  }

  #applyGenerationTweenFrame(
    element: LeaferElement,
    frame: GenerationTweenFrame,
  ): void {
    element.set(frame.data);
    element.setTransform(transformToAffine(frame.transform));
  }

  #refreshGenerationTweenSelection(nodeIds: ReadonlySet<string>): void {
    const projection = this.#projection;
    if (!projection || nodeIds.size === 0) return;
    const selectionBounds = this.#selectionBoundsAffected(
      nodeIds,
      projection,
      projection,
    );
    if (selectionBounds.size === 0) return;
    for (const nodeId of selectionBounds) {
      this.#elements.get(nodeId)?.forceUpdate("bounds");
    }
    this.#editor.update();
  }

  #recordGenerationPresentationFrame(now: number): void {
    const previous = this.#generationPresentationLastFrameAt;
    this.#generationPresentationLastFrameAt = now;
    if (previous === null) return;
    const interval = now - previous;
    if (!Number.isFinite(interval) || interval < 4 || interval > 100) return;
    this.#generationPresentationAverageFrameMs =
      this.#generationPresentationAverageFrameMs * 0.85 + interval * 0.15;
  }

  #isGenerationTweenVisible(element: LeaferElement): boolean {
    let bounds: ReturnType<LeaferElement["getBounds"]>;
    try {
      bounds = element.getBounds("render", "page");
    } catch {
      return false;
    }
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height)
    ) {
      return false;
    }
    const host = this.#host.getBoundingClientRect();
    const left = Number.isFinite(host.left) ? host.left : 0;
    const top = Number.isFinite(host.top) ? host.top : 0;
    const right = Number.isFinite(host.right) ? host.right : left + host.width;
    const bottom = Number.isFinite(host.bottom)
      ? host.bottom
      : top + host.height;
    return (
      bounds.x + bounds.width >= left &&
      bounds.y + bounds.height >= top &&
      bounds.x <= right &&
      bounds.y <= bottom
    );
  }

  #scheduleViewport(): void {
    if (this.#synchronizing || this.#disposed || this.#viewportFrame !== null) {
      return;
    }
    this.#viewportFrame = requestAnimationFrame(() => {
      this.#viewportFrame = null;
      this.#emitViewport();
    });
  }

  #scheduleEditorRefresh(
    options: {
      nodeBounds?: Iterable<string>;
      treeBounds?: boolean;
    } = {},
  ): void {
    this.#editorRefreshNeedsTreeBounds ||= options.treeBounds === true;
    if (options.nodeBounds) {
      for (const nodeId of options.nodeBounds) {
        this.#editorRefreshNodeBounds.add(nodeId);
      }
    }
    if (this.#disposed || this.#editorFrame !== null) return;
    this.#editorFrame = requestAnimationFrame(() => {
      this.#editorFrame = null;
      if (this.#disposed) return;
      try {
        const refreshTreeBounds = this.#editorRefreshNeedsTreeBounds;
        const refreshNodeBounds = [...this.#editorRefreshNodeBounds];
        this.#editorRefreshNeedsTreeBounds = false;
        this.#editorRefreshNodeBounds.clear();
        if (refreshTreeBounds) {
          this.#app.tree.forceUpdate("bounds");
        } else {
          refreshNodeBounds.forEach((nodeId) =>
            this.#elements.get(nodeId)?.forceUpdate("bounds"),
          );
        }
        this.#editor.update();
      } catch (error) {
        this.#report(error);
      }
    });
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
      const base = projectDesignPage(this.#input.document, this.#input.pageId);
      this.#baseProjection = base;
      this.#reconcile(this.#projectScene(base), {
        reapplyAll: true,
      });
      this.#syncViewport(this.#input.viewport);
      this.#syncSelection(this.#input.selection);
      this.#textRunEditor.syncPresentation();
      this.#syncVectorEdit();
      this.#imageCropController.restoreProjection();
    } finally {
      this.#synchronizing = false;
    }
  }

  #projectionExportTarget(request: ProjectionExportRequest) {
    const projection = this.#projection;
    if (!projection) return null;
    return createProjectionExportTarget<LeaferElement>(projection, request, {
      addAt: (parent, child, index) => {
        const addAt: unknown = Reflect.get(parent, "addAt");
        if (typeof addAt !== "function") {
          throw new Error("Projection export parent cannot contain children");
        }
        Reflect.apply(addAt, parent, [child, index]);
      },
      applyData: (element, spec) => this.#applyElementSpecData(element, spec),
      create: (tag) => this.#createElement(tag),
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
    const spec = this.#projection?.elementsById.get(nodeId);
    const element = this.#elements.get(nodeId);
    if (!spec || spec.kind !== "frame" || !element) {
      throw new Error(`Leafer capture Frame is unavailable: ${nodeId}`);
    }
    return element;
  }

  #exportElement(nodeId: string): LeaferElement {
    const spec = this.#projection?.elementsById.get(nodeId);
    const element = this.#elements.get(nodeId);
    if (!spec || !element) {
      throw new Error(`Leafer raster export layer is unavailable: ${nodeId}`);
    }
    return element;
  }

  #nodeId(element: LeaferElement): string | undefined {
    const projectionId = this.#projectionId(element);
    if (!projectionId) return undefined;
    return this.#projection
      ? projectionNodeId(this.#projection, projectionId)
      : projectionId;
  }

  #projectionId(element: LeaferElement): string | undefined {
    const id = element.id;
    return typeof id === "string" && this.#elements.get(id) === element
      ? id
      : undefined;
  }

  #onWindowKeyDown = (event: KeyboardEvent) => {
    if (this.#handleTextEditKeyDown(event)) return;
    if (
      event.code === "Escape" &&
      this.#editorOverlays.gridDragging &&
      !isKeyboardInputTarget(event.target)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#editorOverlays.cancelGridDrag();
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
    if (this.#vectorEdits.size > 0 && !isKeyboardInputTarget(event.target)) {
      const selectionDrag = [...this.#vectorEdits.values()]
        .map((session) => session.drag)
        .find(
          (
            drag,
          ): drag is Extract<VectorEditDrag, { kind: "selection-transform" }> =>
            drag?.kind === "selection-transform",
        );
      if (
        event.code === "Space" &&
        selectionDrag &&
        selectionDrag.mode !== "move"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat && selectionDrag.spaceStartDocument === null) {
          selectionDrag.spaceStartDocument = {
            ...selectionDrag.currentDocument,
          };
          selectionDrag.spaceBaseOffset = {
            ...selectionDrag.repositionOffset,
          };
          selectionDrag.spaceActionDocument = {
            x:
              selectionDrag.currentDocument.x -
              selectionDrag.repositionOffset.x,
            y:
              selectionDrag.currentDocument.y -
              selectionDrag.repositionOffset.y,
          };
        }
        return;
      }
      if (event.code === "Escape" && this.#vectorLasso) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.#cancelVectorLasso();
        return;
      }
      if (event.code === "Escape" || event.code === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const draggingSession = [...this.#vectorEdits.values()].find(
          (session) => session.drag !== null,
        );
        if (draggingSession) {
          this.#cancelVectorEditDrag(draggingSession);
          this.#renderVectorEditOverlays();
          if (event.code === "Escape") return;
        }
        this.#callbacks.onVectorEditExit?.();
        return;
      }
      if (event.code === "Backspace" || event.code === "Delete") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.#deleteSelectedVectorVertices();
        return;
      }
    }
    if (this.#boxSelectController.handleKeyDown(event)) return;
    if (this.#penToolController.handleKeyDown(event)) return;
    if (this.#boxDrawController.handleKeyDown(event)) return;
    if (event.code === "Escape" && this.#editor.innerEditing) {
      this.#textRunEditor.cancel();
    }
  };

  #onWindowKeyUp = (event: KeyboardEvent) => {
    if (
      event.code !== "Space" ||
      this.#vectorEdits.size === 0 ||
      isKeyboardInputTarget(event.target)
    ) {
      return;
    }
    const selectionDrag = [...this.#vectorEdits.values()]
      .map((session) => session.drag)
      .find(
        (
          drag,
        ): drag is Extract<VectorEditDrag, { kind: "selection-transform" }> =>
          drag?.kind === "selection-transform",
      );
    if (!selectionDrag || selectionDrag.spaceStartDocument === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectionDrag.spaceStartDocument = null;
    selectionDrag.spaceBaseOffset = null;
    selectionDrag.spaceActionDocument = null;
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

function textDomOffset(
  root: HTMLElement,
  target: Node,
  targetOffset: number,
): number | null {
  let total = 0;
  let resolved: number | null = null;
  const visit = (node: Node): void => {
    if (resolved !== null) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        const length = node.textContent?.length ?? 0;
        resolved = total + Math.min(Math.max(targetOffset, 0), length);
      } else {
        const children = [...node.childNodes];
        for (
          let index = 0;
          index < Math.min(targetOffset, children.length);
          index += 1
        ) {
          total += textDomLength(children[index]!);
        }
        resolved = total;
      }
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += node.textContent?.length ?? 0;
      return;
    }
    if (node instanceof HTMLBRElement) {
      total += 1;
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
  return resolved;
}

function textDomLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node instanceof HTMLBRElement) return 1;
  return [...node.childNodes].reduce(
    (sum, child) => sum + textDomLength(child),
    0,
  );
}

function textEditDomSnapshot(root: HTMLDivElement): {
  content: string;
  rawContent: string;
  selection: { start: number; end: number };
} {
  const rawContent = textEditDomText(root);
  const content = rawContent.replaceAll("\u200B", "");
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return {
      content,
      rawContent,
      selection: { start: content.length, end: content.length },
    };
  }
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return {
      content,
      rawContent,
      selection: { start: content.length, end: content.length },
    };
  }
  const rawStart = textDomOffset(root, range.startContainer, range.startOffset);
  const rawEnd = textDomOffset(root, range.endContainer, range.endOffset);
  if (rawStart === null || rawEnd === null) {
    throw new Error("Text edit selection is outside the active edit root");
  }
  const first = normalizedTextDomOffset(rawContent, rawStart);
  const second = normalizedTextDomOffset(rawContent, rawEnd);
  return {
    content,
    rawContent,
    selection: {
      start: Math.min(first, second),
      end: Math.max(first, second),
    },
  };
}

function textEditDomText(root: HTMLElement): string {
  return [...root.childNodes]
    .map((child) => textEditDomNodeText(child))
    .join("");
}

function textEditDomNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLBRElement) return "\n";
  return [...node.childNodes].map(textEditDomNodeText).join("");
}

function normalizedTextDomOffset(rawContent: string, offset: number): number {
  return rawContent.slice(0, offset).replaceAll("\u200B", "").length;
}

function writeTextEditDom(root: HTMLDivElement, content: string): void {
  const fragment = root.ownerDocument.createDocumentFragment();
  content.split("\n").forEach((line, index, lines) => {
    if (index > 0) fragment.appendChild(root.ownerDocument.createElement("br"));
    if (line.length > 0 || lines.length === 1) {
      fragment.appendChild(root.ownerDocument.createTextNode(line));
    }
  });
  root.replaceChildren(fragment);
}

function writeStyledTextEditDom(
  root: HTMLDivElement,
  content: string,
  runs: readonly { end: number; start: number; style: TextRunStyle }[],
): void {
  if (content.length === 0) {
    writeTextEditDom(root, content);
    return;
  }
  const fragment = root.ownerDocument.createDocumentFragment();
  for (const run of runs) {
    const pieces = content.slice(run.start, run.end).split("\n");
    pieces.forEach((piece, index) => {
      if (piece.length > 0) {
        const span = root.ownerDocument.createElement("span");
        span.textContent = piece;
        applyTextRunDomStyle(span, run.style);
        fragment.appendChild(span);
      }
      if (index < pieces.length - 1) {
        fragment.appendChild(root.ownerDocument.createElement("br"));
      }
    });
  }
  root.replaceChildren(fragment);
}

const TEXT_EDIT_TYPING_STYLE_ATTRIBUTE = "data-opendesign-typing-style";

function installTextEditTypingStyleMarker(
  root: HTMLDivElement,
  offset: number,
  style: TextRunStyle,
  restoreSelection: boolean,
): void {
  const selection = { start: offset, end: offset };
  finalizeTextEditTypingStyleMarkers(root, selection, false);
  const marker = root.ownerDocument.createElement("span");
  marker.setAttribute(TEXT_EDIT_TYPING_STYLE_ATTRIBUTE, "true");
  marker.textContent = "\u200B";
  applyTextRunDomStyle(marker, style);
  const point = textEditDomPoint(root, offset);
  if (point.node.nodeType === Node.TEXT_NODE) {
    const text = point.node as Text;
    const parent = text.parentNode;
    if (!parent) return;
    if (point.offset === 0) {
      parent.insertBefore(marker, text);
    } else if (point.offset === (text.textContent?.length ?? 0)) {
      parent.insertBefore(marker, text.nextSibling);
    } else {
      parent.insertBefore(marker, text.splitText(point.offset));
    }
  } else {
    point.node.insertBefore(
      marker,
      point.node.childNodes[point.offset] ?? null,
    );
  }
  if (restoreSelection) {
    const range = root.ownerDocument.createRange();
    const text = marker.firstChild;
    if (!text) return;
    range.setStart(text, 1);
    range.collapse(true);
    const domSelection = root.ownerDocument.getSelection();
    domSelection?.removeAllRanges();
    domSelection?.addRange(range);
  }
}

function finalizeTextEditTypingStyleMarkers(
  root: HTMLDivElement,
  selection: { start: number; end: number },
  restoreSelection: boolean,
): void {
  const markers = [
    ...root.querySelectorAll<HTMLSpanElement>(
      `[${TEXT_EDIT_TYPING_STYLE_ATTRIBUTE}]`,
    ),
  ];
  if (markers.length === 0) return;
  for (const marker of markers) {
    for (const text of textEditDomTextNodes(marker)) {
      text.textContent = (text.textContent ?? "").replaceAll("\u200B", "");
    }
    marker.removeAttribute(TEXT_EDIT_TYPING_STYLE_ATTRIBUTE);
    if (textEditDomText(marker).length === 0) marker.remove();
  }
  if (restoreSelection) setTextEditDomSelection(root, selection);
}

function applyTextEditCharacterStylesInPlace(
  root: HTMLDivElement,
  selection: { start: number; end: number },
  runs: readonly { end: number; start: number; style: TextRunStyle }[],
  restoreSelection: boolean,
): void {
  const boundaries = new Set([selection.start, selection.end]);
  for (const run of runs) {
    if (run.start > selection.start && run.start < selection.end) {
      boundaries.add(run.start);
    }
    if (run.end > selection.start && run.end < selection.end) {
      boundaries.add(run.end);
    }
  }
  [...boundaries]
    .sort((left, right) => left - right)
    .forEach((offset) => splitTextEditDomAtOffset(root, offset));

  for (const text of textEditDomTextNodes(root)) {
    const start = textDomOffset(root, text, 0);
    const length = text.textContent?.length ?? 0;
    if (
      start === null ||
      length === 0 ||
      start < selection.start ||
      start + length > selection.end
    ) {
      continue;
    }
    const style = runs.find(
      (run) => run.start <= start && start < run.end,
    )?.style;
    if (!style) continue;
    const parent = text.parentElement;
    if (
      parent instanceof HTMLSpanElement &&
      parent.childNodes.length === 1 &&
      !parent.hasAttribute(TEXT_EDIT_TYPING_STYLE_ATTRIBUTE)
    ) {
      applyTextRunDomStyle(parent, style);
    } else {
      const span = root.ownerDocument.createElement("span");
      applyTextRunDomStyle(span, style);
      text.replaceWith(span);
      span.appendChild(text);
    }
  }
  if (restoreSelection) setTextEditDomSelection(root, selection);
}

function splitTextEditDomAtOffset(root: HTMLDivElement, offset: number): void {
  const point = textEditDomPoint(root, offset);
  if (point.node.nodeType !== Node.TEXT_NODE) return;
  const text = point.node as Text;
  const length = text.textContent?.length ?? 0;
  if (point.offset > 0 && point.offset < length) text.splitText(point.offset);
}

function textEditDomTextNodes(root: Node): Text[] {
  const result: Text[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      result.push(node as Text);
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
  return result;
}

function shouldRestoreTextEditDomSelection(root: HTMLDivElement): boolean {
  const active = root.ownerDocument.activeElement;
  return (
    active === null ||
    active === root.ownerDocument.body ||
    active === root.ownerDocument.documentElement ||
    active === root ||
    root.contains(active)
  );
}

function applyTextRunDomStyle(
  element: HTMLSpanElement,
  style: TextRunStyle,
): void {
  element.style.fontFamily = style.fontFamily;
  element.style.fontSize = `${style.fontSize}px`;
  element.style.fontStyle = style.fontSlant;
  element.style.fontWeight = String(style.fontWeight);
  element.style.letterSpacing = `${style.letterSpacing}px`;
  element.style.lineHeight = `${style.lineHeight}px`;
  element.style.textDecorationLine =
    style.textDecoration === "strikethrough"
      ? "line-through"
      : style.textDecoration;
  element.style.textTransform =
    style.textCase === "title-case"
      ? "capitalize"
      : style.textCase === "small-caps" || style.textCase === "original"
        ? "none"
        : style.textCase;
  element.style.fontVariantCaps =
    style.textCase === "small-caps" ? "small-caps" : "normal";
  const fill = style.fills.find((paint) => paint.type === "solid");
  element.style.color = fill?.color ?? "";
  element.style.opacity = fill ? String(fill.opacity) : "";
}

function setTextEditDomSelection(
  root: HTMLDivElement,
  selection: { start: number; end: number },
): void {
  const start = textEditDomPoint(root, selection.start);
  const end = textEditDomPoint(root, selection.end);
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const domSelection = window.getSelection();
  domSelection?.removeAllRanges();
  domSelection?.addRange(range);
}

function textEditDomPoint(
  root: HTMLDivElement,
  requestedOffset: number,
): { node: Node; offset: number } {
  let remaining = requestedOffset;
  let result: { node: Node; offset: number } | null = null;
  const visit = (node: Node): void => {
    if (result) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) result = { node, offset: remaining };
      else remaining -= length;
      return;
    }
    if (node instanceof HTMLBRElement) {
      const parent = node.parentNode;
      if (!parent) return;
      const index = [...parent.childNodes].indexOf(node);
      if (remaining === 0) result = { node: parent, offset: index };
      else if (remaining === 1) {
        result = { node: parent, offset: index + 1 };
      } else remaining -= 1;
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
  return result ?? { node: root, offset: root.childNodes.length };
}

function textEditingListCommand(
  event: KeyboardEvent,
): TextEditingListCommand | null {
  const commandModifier = (event.metaKey || event.ctrlKey) && !event.altKey;
  if (commandModifier && event.shiftKey && event.code === "Digit7") {
    return "toggle-ordered";
  }
  if (commandModifier && event.shiftKey && event.code === "Digit8") {
    return "toggle-unordered";
  }
  if (commandModifier && !event.shiftKey && event.code === "BracketRight") {
    return "indent";
  }
  if (commandModifier && !event.shiftKey && event.code === "BracketLeft") {
    return "outdent";
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.code === "Tab") return event.shiftKey ? "outdent" : "indent";
  if (
    !event.shiftKey &&
    (event.code === "Backspace" || event.code === "Delete")
  ) {
    return "remove-marker";
  }
  if (!event.shiftKey && event.code === "Enter") return "exit-empty-item";
  return null;
}

function stopTextEditKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

async function loadBrowserVectorGeometryProvider(): Promise<VectorGeometryProvider> {
  const module =
    await import("@opendesign/geometry-service/browser-vector-path");
  return module.loadBrowserVectorGeometryProvider();
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

function collectBooleanNodeIds(projection: LeaferSceneProjection): Set<string> {
  return new Set(
    [...projection.elementsById.values()]
      .filter((spec) => spec.kind === "boolean")
      .map((spec) => spec.id),
  );
}

function failedBooleanResolution(
  pageId: string,
  nodeIds: ReadonlySet<string>,
  error: Error,
): BooleanGeometryResolution {
  return {
    computedNodeIds: [],
    issues: [...nodeIds].map((nodeId) => ({
      code: "provider-failure" as const,
      message: `Boolean geometry provider failed to load: ${error.message}`,
      nodeId,
    })),
    pageId,
    resolverVersion: BOOLEAN_GEOMETRY_RESOLVER_VERSION,
    resultsByNodeId: new Map(),
    reusedNodeIds: [],
  };
}

function emptyBooleanResolution(pageId: string): BooleanGeometryResolution {
  return {
    computedNodeIds: [],
    issues: [],
    pageId,
    resolverVersion: BOOLEAN_GEOMETRY_RESOLVER_VERSION,
    resultsByNodeId: new Map(),
    reusedNodeIds: [],
  };
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

function normalizeTransform(transform: Transform): Transform {
  return transform.map(normalizeNumber) as Transform;
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function projectionOpacity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 1;
}

function samePoint(left: Point, right: Point): boolean {
  return nearlyEqual(left.x, right.x) && nearlyEqual(left.y, right.y);
}
function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MATRIX_EPSILON;
}

function sameTransform(left: Transform, right: Transform): boolean {
  return left.every((value, index) => nearlyEqual(value, right[index] ?? 0));
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function toggleStringSelection(
  current: readonly string[],
  toggled: readonly string[],
): string[] {
  const next = new Set(current);
  for (const value of toggled) {
    if (next.has(value)) next.delete(value);
    else next.add(value);
  }
  return [...next];
}

function sameProjectionValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameProjectionValue(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        sameProjectionValue(leftRecord[key], rightRecord[key]),
    )
  );
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

function readLinePoints(
  element: LeaferElement,
): readonly [number, number, number, number] | undefined {
  const points = (element as LeaferElement & { points?: unknown }).points;
  if (
    Array.isArray(points) &&
    points.length >= 4 &&
    points.slice(0, 4).every((value) => typeof value === "number")
  ) {
    return points.slice(0, 4).map(normalizeNumber) as [
      number,
      number,
      number,
      number,
    ];
  }
  if (
    Array.isArray(points) &&
    points.length >= 2 &&
    points[0] &&
    points[1] &&
    typeof points[0] === "object" &&
    typeof points[1] === "object"
  ) {
    const start = points[0] as { x?: unknown; y?: unknown };
    const end = points[1] as { x?: unknown; y?: unknown };
    if (
      typeof start.x === "number" &&
      typeof start.y === "number" &&
      typeof end.x === "number" &&
      typeof end.y === "number"
    ) {
      return [start.x, start.y, end.x, end.y].map(normalizeNumber) as [
        number,
        number,
        number,
        number,
      ];
    }
  }
  return undefined;
}

function translateLocalTransform(
  transform: Transform,
  x: number,
  y: number,
): Transform {
  return normalizeTransform([
    transform[0],
    transform[1],
    transform[2],
    transform[3],
    transform[0] * x + transform[2] * y + transform[4],
    transform[1] * x + transform[3] * y + transform[5],
  ]);
}

function sameNumberList(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => nearlyEqual(value, right[index] ?? 0))
  );
}

function pointDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
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

function isElement(value: unknown): value is LeaferElement {
  return (
    typeof value === "object" && value !== null && "localTransform" in value
  );
}
