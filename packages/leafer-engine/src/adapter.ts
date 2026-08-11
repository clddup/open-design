import type {
  DesignChangeSet,
  DesignDocument,
  DesignOperation,
  Point,
  Transform,
  VectorNetwork,
  VectorPointMode,
  ViewportState,
} from "@opendesign/design-contracts";
import { normalizeLineEndpoints } from "@opendesign/design-contracts";
import {
  BOOLEAN_GEOMETRY_RESOLVER_VERSION,
  createBooleanGeometryResolver,
  type BooleanGeometryResolution,
  type BooleanGeometryResolver,
} from "@opendesign/geometry-service/boolean-resolver";
import {
  normalizeVectorNetwork,
  serializeVectorNetwork,
} from "@opendesign/geometry-service/editable-vector";
import {
  deleteVectorVertices,
  listVectorVertexHandles,
  moveVectorHandle,
  moveVectorVertices,
  setVectorPointMode,
  type VectorHandleReference,
} from "@opendesign/geometry-service/vector-edit";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import {
  isRasterExportRequest,
  planRasterExportDimensions,
  rasterExportMimeType,
  type RasterExportRequest,
} from "@opendesign/import-export-service/raster";
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
  appendPenVertex,
  createPenDraft,
  penDraftHandlePath,
  penDraftPreviewPath,
  penDraftToVectorNetwork,
  removeLastPenVertex,
  setPenVertexHandle,
  type PenDraft,
} from "./pen-tool.js";
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
import type {
  LeaferBoxCreateTool,
  LeaferCaptureResult,
  LeaferCaptureTarget,
  LeaferCanvasTool,
  LeaferCreateRequest,
  LeaferCreateVectorRequest,
  LeaferEngineAdapter,
  LeaferEngineCallbacks,
  LeaferGenerationActivity,
  LeaferGenerationReveal,
  LeaferGenerationSkeleton,
  LeaferEngineOptions,
  LeaferEngineSyncInput,
  LeaferOperationKind,
  LeaferRasterExportResult,
} from "./types.js";

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

interface ActiveGenerationTween {
  current: GenerationTweenFrame;
  plan: GenerationTweenPlan;
}

interface TransformSession {
  before: Map<string, ElementState>;
  changed: boolean;
  kind: LeaferOperationKind;
}

interface DrawSession {
  dragged: boolean;
  parentId: string | null;
  preview: LeaferElement;
  lineStart?: { x: number; y: number };
  lineEnd?: { x: number; y: number };
  start: { x: number; y: number };
  startClient: { x: number; y: number };
  tool: LeaferBoxCreateTool;
}

interface PenSession {
  activeVertexIndex: number | null;
  anchors: LeaferElement[];
  closeCandidate: boolean;
  cursor: Point;
  draft: PenDraft;
  handlePath: LeaferElement;
  pageId: string;
  parent: LeaferGroup;
  parentId: string | null;
  pointerDownClient: Point | null;
  previewGroup: LeaferGroup;
  previewPath: LeaferElement;
}

interface BoxSelectSession {
  additiveNodeIds: Set<string>;
  start: { x: number; y: number };
  startClient: { x: number; y: number };
}

type VectorEditControl =
  | { kind: "vertex"; vertexId: string }
  | {
      kind: "handle";
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
      before: VectorNetwork;
      kind: "handle";
      moved: boolean;
      reference: VectorHandleReference;
      startClient: Point;
      vertexId: string;
    };

interface VectorEditSession {
  anchorControls: LeaferElement[];
  drag: VectorEditDrag | null;
  handleControls: LeaferElement[];
  handlePath: LeaferElement;
  network: VectorNetwork;
  nodeId: string;
  overlayGroup: LeaferGroup;
  pathElement: LeaferElement;
  readOnly: boolean;
  selectedVertexIds: string[];
  tracePath: LeaferElement;
}

const MATRIX_EPSILON = 0.000_001;
const MIN_DRAW_DISTANCE = 4;
const PEN_CLOSE_DISTANCE = 10;
const MIN_VIEWPORT_ZOOM = 0.1;
const MAX_VIEWPORT_ZOOM = 8;
const WHEEL_ZOOM_SPEED = 0.16;
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
  return new WebLeaferEngineAdapter(host, callbacks, leafer, options);
}

class WebLeaferEngineAdapter implements LeaferEngineAdapter {
  readonly #app: LeaferApp;
  readonly #callbacks: LeaferEngineCallbacks;
  readonly #host: HTMLElement;
  readonly #leafer: LeaferModule;
  readonly #editor: LeaferEditor;
  readonly #generationRevealStroker: LeaferStroker;
  readonly #generationActivityElements: GenerationActivityElements;
  readonly #generationActivityLayer: LeaferGroup;
  readonly #generationSkeletonLayer: LeaferGroup;
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
  #boxSelect: BoxSelectSession | null = null;
  #draw: DrawSession | null = null;
  #input: LeaferEngineSyncInput | null = null;
  #pen: PenSession | null = null;
  #projection: LeaferSceneProjection | null = null;
  #synchronizing = false;
  #textBefore: { nodeId: string; text: string } | null = null;
  #cancelTextEdit = false;
  #transform: TransformSession | null = null;
  #vectorEdit: VectorEditSession | null = null;
  readonly #vectorEditControls = new WeakMap<
    LeaferElement,
    VectorEditControl
  >();
  #viewportFrame: number | null = null;
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
  readonly #generationRevealFocusPoints = new Map<string, Point>();
  readonly #suppressedGenerationActivityIds = new Set<string>();

  constructor(
    host: HTMLElement,
    callbacks: LeaferEngineCallbacks,
    leafer: LeaferModule,
    options: LeaferEngineOptions,
  ) {
    this.#host = host;
    this.#callbacks = callbacks;
    this.#leafer = leafer;
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
        editSize: "size",
        multipleSelect: true,
        boxSelect: "hit",
        hover: true,
        hoverPathType: "box",
        hoverStyle: {
          stroke: "#8b8b89",
          // Leafer's Stroker surface is sized to the target bounds. A centered
          // one-pixel stroke can therefore lose its right and bottom halves at
          // fractional viewport zooms. Keep canvas chrome fully inside that
          // surface so every edge remains visible on macOS and Windows.
          strokeAlign: "inside",
          strokeWidth: 1,
        },
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
    this.#generationSkeletonLayer = new leafer.Group({
      editable: false,
      hitChildren: false,
      hittable: false,
      visible: false,
    });
    (this.#app.sky as unknown as LeaferGroup).addAt(
      this.#generationSkeletonLayer,
      0,
    );
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
    (this.#app.sky as unknown as LeaferGroup).addAt(
      this.#generationActivityLayer,
      1,
    );
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
    this.#listen();
  }

  sync(input: LeaferEngineSyncInput): void {
    if (this.#disposed) return;
    const previous = this.#input;
    const identityChanged =
      !previous ||
      previous.document.documentId !== input.document.documentId ||
      previous.pageId !== input.pageId;
    if (
      previous?.vectorEditScope?.nodeId !== input.vectorEditScope?.nodeId ||
      previous?.document.documentId !== input.document.documentId ||
      previous?.pageId !== input.pageId
    ) {
      this.#cancelVectorEdit();
    }
    const pendingPenRequest =
      previous?.tool === "pen" && input.tool !== "pen" && this.#pen
        ? this.#takePenRequest(false)
        : null;
    if (identityChanged) {
      this.#finishGenerationReveal();
      this.#clearGenerationActivity(false);
      this.#clearGenerationSkeleton(false);
      this.#generationRevealFocusPoints.clear();
      this.#processedGenerationRevealIds.clear();
      this.#suppressedGenerationActivityIds.clear();
      this.#suppressedGenerationSkeletonIds.clear();
    }
    this.#input = input;
    const sceneChanged =
      identityChanged ||
      previous?.document.revision !== input.document.revision;
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
          previous &&
          input.changes?.documentId === input.document.documentId &&
          input.changes.fromRevision === previous.document.revision &&
          input.changes.toRevision === input.document.revision;
        const changedNodeIds = input.changes
          ? changeSetNodeIds(input.changes)
          : new Set<string>();
        const baseProjection =
          previous && this.#baseProjection && input.changes
            ? projectDesignPageIncrementally(
                this.#baseProjection,
                input.document,
                input.pageId,
                input.changes,
              )
            : projectDesignPage(input.document, input.pageId);
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
        if (
          this.#vectorEdit &&
          (identityChanged ||
            !contiguousChanges ||
            invalidatesInteraction(this.#vectorEdit.nodeId))
        ) {
          this.#cancelVectorEdit();
        }
        if (identityChanged) this.#editor.visible = false;
        if (
          identityChanged ||
          !contiguousChanges ||
          (this.#draw?.parentId !== undefined &&
            this.#draw?.parentId !== null &&
            invalidatesInteraction(this.#draw.parentId))
        ) {
          this.#boxSelect = null;
          this.#cancelDraw();
        }
        if (
          identityChanged ||
          !contiguousChanges ||
          (this.#pen?.parentId !== undefined &&
            this.#pen.parentId !== null &&
            invalidatesInteraction(this.#pen.parentId))
        ) {
          this.#cancelPen();
        }
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
            (this.#textBefore &&
              invalidatesInteraction(this.#textBefore.nodeId)))
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
      this.#syncSelection(input.selection.nodeIds);
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
      this.finishGenerationPresentation();
      this.#report(error);
    } finally {
      this.#synchronizing = false;
    }
    if (pendingPenRequest) this.#submitPenRequest(pendingPenRequest);
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
    const leaf =
      target.kind === "page"
        ? this.#app.tree
        : this.#captureFrameElement(target.nodeId);
    const bounds = leaf.getBounds("render", "local");
    if (
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      throw new Error("Leafer capture target has no renderable bounds");
    }
    const scale = Math.min(
      1,
      MAX_CAPTURE_WIDTH / bounds.width,
      MAX_CAPTURE_HEIGHT / bounds.height,
    );
    const exported = await leaf.export("jpg", {
      blob: true,
      pixelRatio: 1,
      quality: 0.88,
      scale,
      smooth: true,
    });
    if (exported.error) {
      throw exported.error instanceof Error
        ? exported.error
        : new Error("Leafer capture export failed");
    }
    if (!isBlobLike(exported.data)) {
      throw new Error("Leafer capture did not return image bytes");
    }
    const width = finitePositiveInteger(exported.width);
    const height = finitePositiveInteger(exported.height);
    if (width === null || height === null) {
      throw new Error("Leafer capture returned invalid dimensions");
    }
    return {
      bytes: new Uint8Array(await exported.data.arrayBuffer()),
      height,
      mimeType: "image/jpeg",
      width,
    };
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
    const leaf = this.#exportElement(request.rootNodeId);
    const bounds = leaf.getBounds("render", "local");
    const plan = planRasterExportDimensions(bounds, request.size);
    if (!plan.ok) throw new RangeError(`${plan.code}: ${plan.message}`);
    const exported = await leaf.export(
      request.format === "jpeg" ? "jpg" : request.format,
      {
        blob: true,
        pixelRatio: 1,
        scale: plan.dimensions.scale,
        smooth: request.resampling === "smooth",
        ...(request.quality === undefined ? {} : { quality: request.quality }),
        ...(request.background.mode === "color"
          ? { fill: request.background.color }
          : {}),
      },
    );
    if (exported.error) {
      throw exported.error instanceof Error
        ? exported.error
        : new Error("Leafer raster export failed");
    }
    if (!isBlobLike(exported.data)) {
      throw new Error("Leafer raster export did not return image bytes");
    }
    const width = finitePositiveInteger(exported.width);
    const height = finitePositiveInteger(exported.height);
    if (width === null || height === null) {
      throw new Error("Leafer raster export returned invalid dimensions");
    }
    if (width !== plan.dimensions.width || height !== plan.dimensions.height) {
      throw new Error(
        `Leafer raster export returned ${width}x${height}; expected ${plan.dimensions.width}x${plan.dimensions.height}`,
      );
    }
    return {
      bytes: new Uint8Array(await exported.data.arrayBuffer()),
      height,
      mimeType: rasterExportMimeType(request.format),
      width,
    };
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
    this.#boxSelect = null;
    this.#cancelDraw();
    this.#cancelPen();
    this.#cancelVectorEdit();
    this.finishGenerationPresentation();
    if (this.#viewportFrame !== null) cancelAnimationFrame(this.#viewportFrame);
    if (this.#editorFrame !== null) cancelAnimationFrame(this.#editorFrame);
    this.#cancelBooleanPreview();
    this.#viewportFrame = null;
    this.#editorFrame = null;
    this.#editorRefreshNeedsTreeBounds = false;
    this.#editorRefreshNodeBounds.clear();
    this.#generationActivityLayer.remove();
    this.#generationActivityLayer.destroy();
    this.#generationSkeletonLayer.remove();
    this.#generationSkeletonLayer.destroy();
    this.#generationRevealStroker.remove();
    this.#generationRevealStroker.destroy();
    window.removeEventListener("keydown", this.#onWindowKeyDown, true);
    this.#host.removeEventListener("contextlost", this.#onContextLost, true);
    this.#app.destroy();
    this.#elements.clear();
  }

  finishGenerationPresentation(): void {
    this.#finishGenerationReveal();
    this.#clearGenerationActivity(true);
    this.#clearGenerationSkeleton(true);
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
    const session = this.#vectorEdit;
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
    return this.#submitVectorEdit(result.network);
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

    this.#editor.on(InnerEditorEvent.BEFORE_OPEN, () => {
      const element = this.#editor.list[0];
      const nodeId = element && this.#nodeId(element as LeaferElement);
      if (nodeId && this.#input?.document.nodesById[nodeId]?.kind === "text") {
        this.#finishGenerationRevealNode(nodeId);
        this.#finishGenerationTweenNode(nodeId, true);
        this.#textBefore = {
          nodeId,
          text: readElementText(element as LeaferElement),
        };
        this.#cancelTextEdit = false;
      }
    });
    this.#editor.on(InnerEditorEvent.CLOSE, () => this.#finishTextEdit());

    this.#app.on(DragEvent.START, (event: unknown) => {
      this.#startBoxSelect(event);
      this.#startDraw(event);
    });
    this.#app.on(DragEvent.DRAG, (event: unknown) => this.#updateDraw(event));
    this.#app.on(DragEvent.END, (event: unknown) => {
      this.#finishBoxSelect(event);
      this.#finishDraw(event);
    });
    this.#app.on(PointerEvent.DOWN, (event: unknown) => {
      this.#penPointerDown(event);
      this.#vectorEditPointerDown(event);
    });
    this.#app.on(PointerEvent.MOVE, (event: unknown) => {
      this.#penPointerMove(event);
      this.#vectorEditPointerMove(event);
    });
    this.#app.on(PointerEvent.UP, (event: unknown) => {
      this.#penPointerUp(event);
      this.#vectorEditPointerUp(event);
    });

    const viewportChanged = () => {
      this.#scheduleViewport();
      this.#scheduleEditorRefresh();
      this.#renderVectorEditOverlay();
      this.#syncGenerationSkeletonViewport();
      this.#syncGenerationActivityViewport();
    };
    this.#app.tree.on(MoveEvent.MOVE, viewportChanged);
    this.#app.tree.on(MoveEvent.END, viewportChanged);
    this.#app.tree.on(ZoomEvent.ZOOM, viewportChanged);
    this.#app.tree.on(ZoomEvent.END, viewportChanged);
    this.#app.on(ResizeEvent.RESIZE, viewportChanged);

    window.addEventListener("keydown", this.#onWindowKeyDown, true);
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
      if (dataChanged) element.set(spec.data);
      if (transformChanged) element.setTransform(toMatrix(spec.transform));
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
    return projectBooleanEditScope(
      projection,
      document,
      this.#input?.booleanEditScope,
      affectedEditScopeBooleanIds
        ? {
            affectedBooleanNodeIds: affectedEditScopeBooleanIds,
            forceAffected: forceEditScopeAffected,
          }
        : {},
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
      this.#syncSelection(input.selection.nodeIds);
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

  #tag(element: LeaferElement): string {
    return (element as LeaferElement & { tag?: string }).tag ?? "";
  }

  #syncTool(tool: LeaferCanvasTool): void {
    const drawing = tool !== "select";
    const mode = drawing ? "draw" : "normal";
    if (this.#app.mode !== mode) this.#app.mode = mode;
    const showEditor = !drawing && !this.#input?.vectorEditScope;
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
    this.#scheduleEditorRefresh();
  }

  #syncSelection(nodeIds: readonly string[]): void {
    const target = nodeIds.flatMap((nodeId) => {
      const element = this.#elements.get(nodeId);
      return element ? [element] : [];
    });
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
    const nodeIds = this.#editor.list.flatMap((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return nodeId ? [nodeId] : [];
    });
    this.#callbacks.onSelectionChange(nodeIds, nodeIds.at(-1));
  }

  #beginTransform(): void {
    if (this.#synchronizing || this.#transform || this.#disposed) return;
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
      this.#syncSelection(input.selection.nodeIds);
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
        width: normalizeNumber(Number(element.width) || 0),
        height: normalizeNumber(Number(element.height) || 0),
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

  #currentTransformKind(): LeaferOperationKind {
    if (this.#editor.resizing) return "resize";
    if (this.#editor.rotating) return "rotate";
    if (this.#editor.skewing) return "skew";
    if (this.#editor.moving) return "move";
    return "transform";
  }

  #selectionHasLockedElement(): boolean {
    return this.#editor.list.some((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return (
        nodeId !== undefined &&
        isLockedSpec(this.#projection?.elementsById.get(nodeId))
      );
    });
  }

  #finishTextEdit(): void {
    const before = this.#textBefore;
    this.#textBefore = null;
    if (!before || this.#synchronizing || this.#disposed) return;
    const element = this.#elements.get(before.nodeId);
    const node = this.#input?.document.nodesById[before.nodeId];
    const spec = this.#projection?.elementsById.get(before.nodeId);
    if (!element || !node || node.kind !== "text" || isLockedSpec(spec)) return;
    const content = readElementText(element);
    if (this.#cancelTextEdit) {
      (element as LeaferElement & { text: string }).text = before.text;
      this.#cancelTextEdit = false;
      return;
    }
    if (content === before.text) return;
    const accepted = this.#callbacks.onOperations({
      kind: "text",
      operations: [
        {
          commandId: `leafer_text_${before.nodeId}`,
          type: "update_properties",
          nodeId: before.nodeId,
          properties: { ...node.properties, content },
        },
      ],
    });
    if (!accepted) this.#restoreProjection();
  }

  #startBoxSelect(event: unknown): void {
    const input = this.#input;
    if (
      !input ||
      input.tool !== "select" ||
      !this.#editor.selector.dragging ||
      this.#disposed
    ) {
      return;
    }
    const drag = asLeaferEvent(event);
    const client = eventClientPoint(drag);
    this.#boxSelect = {
      additiveNodeIds: new Set(
        drag.shiftKey
          ? this.#editor.list.flatMap((element) => {
              const nodeId = this.#nodeId(element as LeaferElement);
              return nodeId ? [nodeId] : [];
            })
          : [],
      ),
      start: drag.getInnerPoint(this.#editor.selector),
      startClient: client,
    };
  }

  #finishBoxSelect(event: unknown): void {
    const session = this.#boxSelect;
    this.#boxSelect = null;
    if (!session || this.#disposed) return;
    const drag = asLeaferEvent(event);
    const client = eventClientPoint(drag);
    if (
      drag.isCancel ||
      Math.hypot(
        client.x - session.startClient.x,
        client.y - session.startClient.y,
      ) < MIN_DRAW_DISTANCE
    ) {
      return;
    }
    const end = drag.getInnerPoint(this.#editor.selector);
    const rect = rectFromPoints(session.start, end, false, false);
    const bounds = new this.#leafer.Bounds(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    );
    const selected = this.#leafer.EditSelectHelper.findByBounds(
      this.#app as unknown as LeaferElement,
      bounds,
      "hit",
    ).flatMap((element) => {
      const nodeId = this.#nodeId(element as LeaferElement);
      return nodeId ? [{ element: element as LeaferElement, nodeId }] : [];
    });
    const selectedNodeIds = new Set(selected.map(({ nodeId }) => nodeId));
    const targetNodeIds = new Set(session.additiveNodeIds);
    for (const nodeId of selectedNodeIds) {
      if (targetNodeIds.has(nodeId)) targetNodeIds.delete(nodeId);
      else targetNodeIds.add(nodeId);
    }
    const target = [...targetNodeIds].flatMap((nodeId) => {
      const element = this.#elements.get(nodeId);
      return element ? [element] : [];
    });
    const current = this.#editor.list;
    if (
      current.length !== target.length ||
      current.some((element, index) => element !== target[index])
    ) {
      this.#editor.target = target.length === 0 ? (null as never) : target;
      this.#scheduleEditorRefresh();
    }
  }

  #syncVectorEdit(): void {
    const input = this.#input;
    const scope = input?.vectorEditScope;
    if (!input || !scope) {
      this.#cancelVectorEdit();
      return;
    }
    const node = input.document.nodesById[scope.nodeId];
    const pathElement = this.#elements.get(scope.nodeId);
    if (
      !node ||
      (node.kind !== "path" && node.kind !== "vector") ||
      !("network" in node.properties) ||
      !pathElement
    ) {
      this.#cancelVectorEdit();
      return;
    }
    this.#finishGenerationRevealNode(scope.nodeId);
    this.#finishGenerationTweenNode(scope.nodeId, true);
    const network = node.properties.network;
    const selectedVertexIds = [...new Set(scope.selectedVertexIds)].filter(
      (vertexId) => network.vertices.some((vertex) => vertex.id === vertexId),
    );
    let session = this.#vectorEdit;
    if (!session || session.nodeId !== scope.nodeId) {
      this.#cancelVectorEdit();
      const parent = pathElement.parent as LeaferGroup | undefined;
      if (!parent || typeof parent.add !== "function") return;
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
      const handlePath = new this.#leafer.Path({
        editable: false,
        fill: null,
        hittable: false,
        stroke: "#8b8b89",
      }) as LeaferElement;
      overlayGroup.add(tracePath);
      overlayGroup.add(handlePath);
      parent.add(overlayGroup);
      session = {
        anchorControls: [],
        drag: null,
        handleControls: [],
        handlePath,
        network: structuredClone(network),
        nodeId: scope.nodeId,
        overlayGroup,
        pathElement,
        readOnly: scope.readOnly,
        selectedVertexIds,
        tracePath,
      };
      this.#vectorEdit = session;
    } else {
      session.pathElement = pathElement;
      session.readOnly = scope.readOnly;
      session.selectedVertexIds = selectedVertexIds;
      if (!session.drag) session.network = structuredClone(network);
    }
    session.overlayGroup.setTransform({ ...pathElement.localTransform });
    this.#renderVectorEditOverlay();
  }

  #renderVectorEditOverlay(): void {
    const session = this.#vectorEdit;
    if (!session) return;
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
    session.tracePath.set({ path: serialized.path, strokeWidth: 1.5 / zoom });
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
        cursor: session.readOnly ? "default" : "pointer",
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
        vertexId: vertex.id,
      });
      session.overlayGroup.add(anchor);
    }

    const handleParts: string[] = [];
    for (const vertexId of session.selectedVertexIds) {
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
  }

  #setVectorVertexSelection(vertexIds: readonly string[]): void {
    const session = this.#vectorEdit;
    if (!session) return;
    const available = new Set(
      session.network.vertices.map((vertex) => vertex.id),
    );
    const selected = [...new Set(vertexIds)].filter((vertexId) =>
      available.has(vertexId),
    );
    if (sameStringList(selected, session.selectedVertexIds)) return;
    session.selectedVertexIds = selected;
    this.#callbacks.onVectorEditSelectionChange?.(selected);
    this.#renderVectorEditOverlay();
  }

  #vectorEditPointerDown(event: unknown): void {
    const session = this.#vectorEdit;
    if (!session || session.drag || this.#disposed) return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel || pointer.right || pointer.middle) return;
    const target = isElement(pointer.target) ? pointer.target : undefined;
    const control = target ? this.#vectorEditControls.get(target) : undefined;
    if (!control) {
      if (target && this.#nodeId(target) === session.nodeId) {
        this.#setVectorVertexSelection([]);
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
      this.#setVectorVertexSelection([...current]);
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
      this.#setVectorVertexSelection([control.vertexId]);
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
    const session = this.#vectorEdit;
    const drag = session?.drag;
    if (!session || !drag || this.#disposed) return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel) return;
    const client = eventClientPoint(pointer);
    drag.moved ||= pointDistance(drag.startClient, client) >= MIN_DRAW_DISTANCE;
    if (!drag.moved) return;
    const local = pointer.getInnerPoint(session.pathElement);
    const result =
      drag.kind === "vertices"
        ? moveVectorVertices(drag.before, drag.vertexIds, {
            x: local.x - drag.startLocal.x,
            y: local.y - drag.startLocal.y,
          })
        : (() => {
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
    if (!result.ok) {
      this.#report(new Error(result.message));
      return;
    }
    session.network = result.network;
    this.#renderVectorEditOverlay();
  }

  #vectorEditPointerUp(event: unknown): void {
    const session = this.#vectorEdit;
    const drag = session?.drag;
    if (!session || !drag) return;
    this.#vectorEditPointerMove(event);
    const moved = drag.moved;
    const network = session.network;
    session.drag = null;
    if (moved) this.#submitVectorEdit(network);
  }

  #submitVectorEdit(network: VectorNetwork): boolean {
    const session = this.#vectorEdit;
    if (!session || !this.#callbacks.onVectorEdit) {
      this.#report(new Error("Vector editing callback is unavailable"));
      return false;
    }
    const accepted = this.#callbacks.onVectorEdit({
      deleteNode: false,
      network,
      nodeId: session.nodeId,
    });
    if (!accepted) {
      this.#restoreProjection();
      return false;
    }
    if (this.#vectorEdit === session) {
      session.network = structuredClone(network);
      this.#renderVectorEditOverlay();
    }
    return true;
  }

  #deleteSelectedVectorVertices(): boolean {
    const session = this.#vectorEdit;
    if (!session) return false;
    if (session.readOnly || session.selectedVertexIds.length === 0) return true;
    const result = deleteVectorVertices(
      session.network,
      session.selectedVertexIds,
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
      : this.#submitVectorEdit(result.network);
    if (accepted) {
      this.#callbacks.onVectorEditSelectionChange?.([]);
      if (result.deleteNode) this.#callbacks.onVectorEditExit?.();
    }
    return true;
  }

  #cancelVectorEdit(): void {
    const session = this.#vectorEdit;
    if (!session) return;
    this.#vectorEdit = null;
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

  #penPointerDown(event: unknown): void {
    const input = this.#input;
    if (!input || input.tool !== "pen" || this.#disposed) return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel || pointer.right || pointer.middle) return;
    const existing = this.#pen;
    if (existing) {
      const point = pointer.getInnerPoint(existing.parent);
      if (this.#isPenCloseCandidate(existing, point)) {
        this.#finishPen(true);
        return;
      }
      const previous = existing.draft.vertices.at(-1);
      const zoom = Math.max(MATRIX_EPSILON, Math.abs(input.viewport.zoom));
      if (
        previous &&
        pointDistance(previous, point) * zoom < MIN_DRAW_DISTANCE
      ) {
        return;
      }
      if (!appendPenVertex(existing.draft, point)) return;
      existing.activeVertexIndex = existing.draft.vertices.length - 1;
      existing.closeCandidate = false;
      existing.cursor = point;
      existing.pointerDownClient = eventClientPoint(pointer);
      this.#updatePenPreview();
      return;
    }

    const parentId = this.#resolveDrawParent(pointer.target, "pen");
    if (parentId === undefined) return;
    const parent = parentId
      ? (this.#elements.get(parentId) as LeaferGroup | undefined)
      : (this.#app.tree as unknown as LeaferGroup);
    if (!parent) return;
    const point = pointer.getInnerPoint(parent);
    const previewGroup = new this.#leafer.Group({
      editable: false,
      hittable: false,
    }) as LeaferGroup;
    const previewPath = new this.#leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
      strokeCap: "round",
      strokeJoin: "round",
    }) as LeaferElement;
    const handlePath = new this.#leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: "#8aa4ff",
    }) as LeaferElement;
    previewGroup.add(previewPath);
    previewGroup.add(handlePath);
    parent.add(previewGroup);
    this.#pen = {
      activeVertexIndex: 0,
      anchors: [],
      closeCandidate: false,
      cursor: point,
      draft: createPenDraft(point),
      handlePath,
      pageId: input.pageId,
      parent,
      parentId,
      pointerDownClient: eventClientPoint(pointer),
      previewGroup,
      previewPath,
    };
    this.#updatePenPreview();
  }

  #penPointerMove(event: unknown): void {
    const session = this.#pen;
    const input = this.#input;
    if (!session || !input || input.tool !== "pen" || this.#disposed) return;
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel) return;
    const point = pointer.getInnerPoint(session.parent);
    session.cursor = point;
    if (
      session.activeVertexIndex !== null &&
      session.pointerDownClient !== null
    ) {
      const vertex = session.draft.vertices[session.activeVertexIndex];
      const client = eventClientPoint(pointer);
      const dragged =
        pointDistance(session.pointerDownClient, client) >= MIN_DRAW_DISTANCE;
      if (vertex) {
        setPenVertexHandle(
          session.draft,
          session.activeVertexIndex,
          dragged
            ? { x: point.x - vertex.x, y: point.y - vertex.y }
            : { x: 0, y: 0 },
        );
      }
      session.closeCandidate = false;
    } else {
      session.closeCandidate = this.#isPenCloseCandidate(session, point);
    }
    this.#updatePenPreview();
  }

  #penPointerUp(event: unknown): void {
    const session = this.#pen;
    if (!session || session.activeVertexIndex === null) return;
    this.#penPointerMove(event);
    if (!this.#pen) return;
    this.#pen.activeVertexIndex = null;
    this.#pen.pointerDownClient = null;
    this.#pen.closeCandidate = this.#isPenCloseCandidate(
      this.#pen,
      this.#pen.cursor,
    );
    this.#updatePenPreview();
  }

  #isPenCloseCandidate(session: PenSession, point: Point): boolean {
    const first = session.draft.vertices[0];
    if (!first || session.draft.vertices.length < 3) return false;
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.abs(this.#input?.viewport.zoom ?? 1),
    );
    return pointDistance(first, point) * zoom <= PEN_CLOSE_DISTANCE;
  }

  #updatePenPreview(): void {
    const session = this.#pen;
    if (!session) return;
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.abs(this.#input?.viewport.zoom ?? 1),
    );
    const anchorSize = 7 / zoom;
    const path = penDraftPreviewPath(
      session.draft,
      session.cursor,
      session.closeCandidate,
    );
    session.previewPath.set({
      path: path ?? "",
      fill: session.closeCandidate
        ? {
            type: "solid",
            color: LEAFER_EDITOR_SELECTION_COLOR,
            opacity: 0.08,
          }
        : "transparent",
      strokeWidth: 1.5 / zoom,
    });
    session.handlePath.set({
      path: penDraftHandlePath(session.draft) ?? "",
      strokeWidth: 1 / zoom,
    });

    while (session.anchors.length > session.draft.vertices.length) {
      const anchor = session.anchors.pop();
      anchor?.remove();
      anchor?.destroy();
    }
    session.draft.vertices.forEach((vertex, index) => {
      let anchor = session.anchors[index];
      if (!anchor) {
        anchor = new this.#leafer.Ellipse({
          editable: false,
          hittable: false,
        });
        session.anchors.push(anchor);
        session.previewGroup.add(anchor);
      }
      const closeTarget = index === 0 && session.closeCandidate;
      anchor.set({
        x: vertex.x - anchorSize / 2,
        y: vertex.y - anchorSize / 2,
        width: anchorSize,
        height: anchorSize,
        fill: closeTarget ? LEAFER_EDITOR_SELECTION_COLOR : "#ffffff",
        stroke: LEAFER_EDITOR_SELECTION_COLOR,
        strokeWidth: 1.25 / zoom,
      });
    });
  }

  #takePenRequest(closed: boolean): LeaferCreateVectorRequest | null {
    const session = this.#pen;
    if (!session) return null;
    const network = penDraftToVectorNetwork(session.draft, closed);
    const pageId = session.pageId;
    const parentId = session.parentId;
    this.#cancelPen();
    if (!network) return null;
    const normalized = normalizeVectorNetwork(network);
    if (!normalized.ok || !normalized.offset) {
      const message = normalized.ok
        ? "Pen geometry could not be normalized"
        : normalized.issues.map((issue) => issue.message).join("; ");
      this.#report(new Error(message));
      return null;
    }
    return {
      closed,
      height: normalized.bounds.height,
      network: normalized.network,
      pageId,
      parentId,
      width: normalized.bounds.width,
      x: normalized.offset.x,
      y: normalized.offset.y,
    };
  }

  #finishPen(closed: boolean): void {
    const request = this.#takePenRequest(closed);
    if (request) this.#submitPenRequest(request);
  }

  #submitPenRequest(request: LeaferCreateVectorRequest): void {
    const accepted = this.#callbacks.onCreateVector(request);
    if (!accepted) this.#restoreProjection();
  }

  #cancelPen(): void {
    const session = this.#pen;
    if (!session) return;
    this.#pen = null;
    session.previewGroup.remove();
    session.previewGroup.destroy();
  }

  #startDraw(event: unknown): void {
    const input = this.#input;
    if (
      !input ||
      input.tool === "select" ||
      input.tool === "pen" ||
      this.#draw ||
      this.#disposed
    )
      return;
    const drag = asLeaferEvent(event);
    const parentId = this.#resolveDrawParent(drag.target, input.tool);
    if (parentId === undefined) return;
    const parent = parentId
      ? (this.#elements.get(parentId) as LeaferGroup | undefined)
      : (this.#app.tree as unknown as LeaferGroup);
    if (!parent) return;
    const start = drag.getInnerPoint(parent);
    const client = eventClientPoint(drag);
    const preview = this.#createDrawPreview(input.tool);
    const lineTool = input.tool === "line" || input.tool === "arrow";
    preview.set(
      lineTool
        ? { x: 0, y: 0, points: [start.x, start.y, start.x + 1, start.y] }
        : { x: start.x, y: start.y, width: 1, height: 1 },
    );
    parent.add(preview);
    this.#draw = {
      dragged: false,
      parentId,
      preview,
      ...(lineTool ? { lineStart: start, lineEnd: start } : {}),
      start,
      startClient: client,
      tool: input.tool,
    };
  }

  #updateDraw(event: unknown): void {
    const session = this.#draw;
    if (!session) return;
    const drag = asLeaferEvent(event);
    const client = eventClientPoint(drag);
    const parent = session.parentId
      ? (this.#elements.get(session.parentId) as LeaferGroup | undefined)
      : (this.#app.tree as unknown as LeaferGroup);
    if (!parent) return;
    const point = drag.getInnerPoint(parent);
    const lineTool = session.tool === "line" || session.tool === "arrow";
    session.dragged =
      Math.hypot(
        client.x - session.startClient.x,
        client.y - session.startClient.y,
      ) >= MIN_DRAW_DISTANCE;
    if (lineTool) {
      const endpoints = lineEndpointsFromDrag(
        session.start,
        point,
        drag.shiftKey,
        drag.altKey,
      );
      session.lineStart = endpoints.start;
      session.lineEnd = endpoints.end;
      session.preview.set({
        x: 0,
        y: 0,
        points: [
          endpoints.start.x,
          endpoints.start.y,
          endpoints.end.x,
          endpoints.end.y,
        ],
      });
    } else {
      session.preview.set(
        rectFromPoints(session.start, point, drag.shiftKey, drag.altKey),
      );
    }
  }

  #finishDraw(event: unknown): void {
    const session = this.#draw;
    const input = this.#input;
    if (!session || !input) return;
    const drag = asLeaferEvent(event);
    const lineTool = session.tool === "line" || session.tool === "arrow";
    const rawLineStart = session.lineStart ?? session.start;
    const rawLineEnd = session.dragged
      ? (session.lineEnd ?? session.start)
      : { x: session.start.x + 160, y: session.start.y };
    const lineGeometry = lineTool
      ? normalizeLineEndpoints(rawLineStart, rawLineEnd)
      : undefined;
    const rect = lineGeometry?.bounds ?? {
      x: Number(session.preview.x) || session.start.x,
      y: Number(session.preview.y) || session.start.y,
      width: Number(session.preview.width) || 1,
      height: Number(session.preview.height) || 1,
    };
    this.#cancelDraw();
    if (drag.isCancel) return;
    const request: LeaferCreateRequest = {
      dragged: session.dragged,
      height: rect.height,
      pageId: input.pageId,
      parentId: session.parentId,
      ...(lineGeometry
        ? { start: lineGeometry.start, end: lineGeometry.end }
        : {}),
      tool: session.tool,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    };
    const accepted = this.#callbacks.onCreate(request);
    if (!accepted) this.#restoreProjection();
  }

  #createDrawPreview(tool: LeaferBoxCreateTool): LeaferElement {
    if (tool === "line" || tool === "arrow") {
      return new this.#leafer.Arrow({
        editable: false,
        hittable: false,
        stroke: "#4f7fff",
        strokeWidth: 2,
        startArrow: "none",
        endArrow: tool === "arrow" ? "angle" : "none",
      });
    }
    const data = {
      editable: false,
      hittable: false,
      fill: [{ type: "solid", color: "#4f7fff", opacity: 0.12 }],
      stroke: "#4f7fff",
      strokeWidth: 1,
      ...(tool === "frame" ? { dashPattern: [5, 4] } : {}),
    };
    return tool === "ellipse"
      ? new this.#leafer.Ellipse(data)
      : tool === "polygon"
        ? new this.#leafer.Polygon({ ...data, sides: 3 })
        : tool === "star"
          ? new this.#leafer.Star({
              ...data,
              corners: 5,
              innerRadius: 0.382,
            })
          : new this.#leafer.Rect(data);
  }

  #resolveDrawParent(
    target: unknown,
    tool: Exclude<LeaferCanvasTool, "select">,
  ): string | null | undefined {
    if (tool === "frame") return null;
    let element = isElement(target) ? target : undefined;
    while (element) {
      const nodeId = this.#nodeId(element);
      const spec = nodeId
        ? this.#projection?.elementsById.get(nodeId)
        : undefined;
      if (isLockedSpec(spec)) return undefined;
      if (spec && (spec.kind === "frame" || spec.kind === "group")) {
        return spec.id;
      }
      element = isElement(element.parent) ? element.parent : undefined;
    }
    return null;
  }

  #cancelDraw(): void {
    if (!this.#draw) return;
    this.#draw.preview.remove();
    this.#draw.preview.destroy();
    this.#draw = null;
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
    this.#generationActivityLayer.visible = onScreen;
    if (!onScreen) return;
    this.#generationActivityLayer.setTransform({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: screen.x,
      f: screen.y,
    });
    const badgeWidth = Math.max(
      1,
      Number(this.#generationActivityElements.badge.width) || 148,
    );
    const badgeX =
      screen.x + badgeWidth + 28 > hostBounds.width ? -badgeWidth - 14 : 14;
    const badgeY = screen.y + 48 > hostBounds.height ? -40 : 16;
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
    artboardGroup.setTransform(toMatrix(skeleton.artboard.transform));
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
        fill: generationSkeletonFill(region.role),
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
    this.#generationSkeletonLayer.setTransform({
      ...this.#app.tree.localTransform,
    });
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.abs(this.#app.tree.localTransform.a || 1),
    );
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
    element.setTransform(toMatrix(target.transform));
  }

  #applyGenerationTweenFrame(
    element: LeaferElement,
    frame: GenerationTweenFrame,
  ): void {
    element.set(frame.data);
    element.setTransform(toMatrix(frame.transform));
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
      this.#syncSelection(this.#input.selection.nodeIds);
      this.#syncVectorEdit();
    } finally {
      this.#synchronizing = false;
    }
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
    const metadata =
      this.#projection?.elementsById.get(projectionId)?.data.data;
    if (typeof metadata !== "object" || metadata === null) return projectionId;
    const nodeId = (metadata as Record<string, unknown>).opendesignNodeId;
    return typeof nodeId === "string" ? nodeId : projectionId;
  }

  #projectionId(element: LeaferElement): string | undefined {
    const id = element.id;
    return typeof id === "string" && this.#elements.get(id) === element
      ? id
      : undefined;
  }

  #onWindowKeyDown = (event: KeyboardEvent) => {
    if (this.#vectorEdit && !isKeyboardInputTarget(event.target)) {
      if (event.code === "Escape" || event.code === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (this.#vectorEdit.drag) {
          this.#vectorEdit.network = this.#vectorEdit.drag.before;
          this.#vectorEdit.drag = null;
          this.#renderVectorEditOverlay();
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
    if (this.#pen) {
      if (event.code === "Escape" || event.code === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (this.#pen.draft.vertices.length >= 2) this.#finishPen(false);
        else this.#cancelPen();
        return;
      }
      if (event.code === "Backspace" || event.code === "Delete") {
        event.preventDefault();
        event.stopImmediatePropagation();
        removeLastPenVertex(this.#pen.draft);
        if (this.#pen.draft.vertices.length === 0) {
          this.#cancelPen();
        } else {
          this.#pen.activeVertexIndex = null;
          this.#pen.pointerDownClient = null;
          this.#pen.closeCandidate = false;
          const last = this.#pen.draft.vertices.at(-1)!;
          this.#pen.cursor = { x: last.x, y: last.y };
          this.#updatePenPreview();
        }
        return;
      }
    }
    if (event.code === "Escape" && this.#draw) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#cancelDraw();
      return;
    }
    if (event.code === "Escape" && this.#editor.innerEditing) {
      this.#cancelTextEdit = true;
    }
  };

  #onContextLost = (event: Event) => {
    event.preventDefault();
    this.#callbacks.onError(new Error("Canvas context was lost"));
  };

  #report(error: unknown): void {
    this.#callbacks.onError(
      error instanceof Error ? error : new Error("Leafer rendering failed"),
    );
  }
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

function toMatrix(transform: Transform) {
  return {
    a: transform[0],
    b: transform[1],
    c: transform[2],
    d: transform[3],
    e: transform[4],
    f: transform[5],
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

function generationSkeletonFill(
  role: LeaferGenerationSkeleton["regions"][number]["role"],
): string {
  return role === "media" || role === "graphic"
    ? "rgba(124, 110, 230, 0.12)"
    : GENERATION_SKELETON_FILL;
}

function generationActivityBadgeWidth(label: string): number {
  let width = 28;
  for (const character of label) {
    width += character.codePointAt(0)! > 0xff ? 11 : 6.3;
  }
  return Math.min(220, Math.max(104, Math.ceil(width)));
}

function samePoint(left: Point, right: Point): boolean {
  return nearlyEqual(left.x, right.x) && nearlyEqual(left.y, right.y);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MATRIX_EPSILON;
}

function isBlobLike(value: unknown): value is Blob {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

function finitePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
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

function rectFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  constrain: boolean,
  fromCenter: boolean,
) {
  let width = end.x - start.x;
  let height = end.y - start.y;
  if (constrain) {
    const size = Math.max(Math.abs(width), Math.abs(height));
    width = Math.sign(width || 1) * size;
    height = Math.sign(height || 1) * size;
  }
  return {
    x: fromCenter
      ? start.x - Math.abs(width)
      : Math.min(start.x, start.x + width),
    y: fromCenter
      ? start.y - Math.abs(height)
      : Math.min(start.y, start.y + height),
    width: Math.max(1, Math.abs(width) * (fromCenter ? 2 : 1)),
    height: Math.max(1, Math.abs(height) * (fromCenter ? 2 : 1)),
  };
}

function lineEndpointsFromDrag(
  origin: { x: number; y: number },
  pointer: { x: number; y: number },
  constrain: boolean,
  fromCenter: boolean,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  let x = pointer.x - origin.x;
  let y = pointer.y - origin.y;
  if (constrain && (x !== 0 || y !== 0)) {
    const distance = Math.hypot(x, y);
    const angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
    x = Math.cos(angle) * distance;
    y = Math.sin(angle) * distance;
  }
  return fromCenter
    ? {
        start: { x: origin.x - x, y: origin.y - y },
        end: { x: origin.x + x, y: origin.y + y },
      }
    : { start: origin, end: { x: origin.x + x, y: origin.y + y } };
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

interface LeaferEventLike {
  altKey: boolean;
  clientX: number;
  clientY: number;
  getInnerPoint(relative: unknown): { x: number; y: number };
  isCancel?: boolean;
  middle?: boolean;
  right?: boolean;
  shiftKey: boolean;
  target: unknown;
  x?: number;
  y?: number;
}

function asLeaferEvent(value: unknown): LeaferEventLike {
  return value as LeaferEventLike;
}

function eventClientPoint(event: LeaferEventLike): Point {
  return {
    x: Number.isFinite(event.clientX) ? event.clientX : (event.x ?? 0),
    y: Number.isFinite(event.clientY) ? event.clientY : (event.y ?? 0),
  };
}

function pointDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
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
