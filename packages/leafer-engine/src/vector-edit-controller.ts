import type {
  DesignNode,
  Point,
  Rect,
  Transform,
  VectorNetwork,
  VectorPointMode,
  VariableWidthStrokeProperties,
} from "@opendesign/design-contracts";
import {
  serializeVectorNetwork,
  serializeVectorRegion,
} from "@opendesign/geometry-service/editable-vector";
import type { SnapGuideLine } from "@opendesign/geometry-service/snapping";
import { appendVectorPoint } from "@opendesign/geometry-service/vector-point-append";
import {
  bendVectorSegment,
  connectVectorEndpoints,
  deleteVectorSelection,
  findVectorPathIdForVertex,
  listVectorVertexHandles,
  moveVectorHandle,
  nearestVectorSegmentPoint,
  setVectorPointMode,
  setVectorRegionFillStyle,
  setVectorRegionFills,
  transformVectorVertices,
  type VectorCutLocation,
  type VectorHandleReference,
} from "@opendesign/geometry-service/vector-edit";
import {
  deleteVariableWidthPoints,
  insertVariableWidthPoint,
  updateVariableWidthPoints,
} from "@opendesign/geometry-service/vector-variable-width-edit";
import {
  variableWidthHitPosition,
  variableWidthPathLocation,
  variableWidthProfilePoints,
} from "@opendesign/geometry-service/vector-variable-width";
import type * as LeaferEditorModule from "leafer-editor";
import { constrainPointToOctant } from "./angle-constraint.js";
import {
  LEAFER_EDITOR_SELECTION_COLOR,
  type LeaferSceneProjection,
} from "./mapping.js";
import { asLeaferEvent, eventClientPoint } from "./pointer-event.js";
import {
  documentTransformToLocal,
  getVisibleWorldTransform,
  transformPoint,
} from "./scene-node-transform.js";
import {
  pointInPolygon,
  translateVectorSelectionTransform,
  vectorDocumentSelectionBounds,
  vectorLassoPath,
  vectorSegmentsInPolygon,
  vectorSegmentSelectionPath,
  vectorSelectionResizeTransform,
  vectorSelectionRotationTransform,
  type VectorResizeHandle,
} from "./vector-selection-transform.js";
import type {
  LeaferEngineCallbacks,
  LeaferEngineSyncInput,
  LeaferVectorEditScope,
  LeaferVectorEditTool,
} from "./types.js";
import {
  VectorGeometrySnapController,
  type VectorSnapHandleSelection,
  type VectorSnapLayer,
  type VectorSnapSelection,
} from "./vector-geometry-snap-controller.js";
import {
  VectorAnchorMeasurementController,
  type VectorAnchorMeasurementReference,
} from "./vector-anchor-measurement-controller.js";
import {
  beginVectorPenContour,
  beginVectorPenAppend,
  beginVectorPenInsert,
  createVectorPenContourStart,
  dragVectorPenContourStart,
  dragVectorPenPoint,
  finishVectorPenContourAtVertex,
  type VectorPenContourStart,
  type VectorPenPointEdit,
} from "./vector-pen-edit.js";
import {
  createVectorPenContourOverlay,
  renderVectorPenContourOverlay,
  type VectorPenContourDraft,
  type VectorPenContourOverlay,
} from "./vector-pen-contour-overlay.js";
import { VectorEraserOverlayController } from "./vector-eraser-overlay-controller.js";
import { VectorShapeBuilderOverlayController } from "./vector-shape-builder-overlay-controller.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

type VectorEditControl =
  | { kind: "path"; nodeId: string }
  | { kind: "region"; nodeId: string; regionId: string }
  | { kind: "vertex"; nodeId: string; vertexId: string }
  | {
      index: number;
      kind: "width-point";
      nodeId: string;
      pathId: string;
    }
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
      startDocument: Point;
      vertexIds: readonly string[];
      world: Transform;
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
      kind: "bend";
      moved: boolean;
      pathId: string;
      segmentId: string;
      startClient: Point;
      startPoint: Point;
      t: number;
    }
  | {
      before: VectorNetwork;
      kind: "handle";
      moved: boolean;
      reference: VectorHandleReference;
      startClient: Point;
      startDocument: Point;
      vertexId: string;
      world: Transform;
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
    }
  | {
      kind: "eraser";
      lastClient: Point;
      moved: boolean;
      points: Point[];
      shape: "round" | "square";
      startClient: Point;
      weight: number;
    }
  | {
      altKey: boolean;
      kind: "shape-builder";
      lastClient: Point;
      moved: boolean;
      points: Point[];
      startClient: Point;
    }
  | {
      before: VectorNetwork;
      beforeContour?: VectorPenContourDraft;
      beforeSegmentIds: readonly string[];
      beforeVertexIds: readonly string[];
      edit: VectorPenPointEdit;
      failed: boolean;
      kind: "pen";
      moved: boolean;
      startClient: Point;
    }
  | {
      before: VectorPenContourStart;
      kind: "pen-start";
      moved: boolean;
      startClient: Point;
    }
  | {
      anchorIndex: number;
      beforeProfile: VariableWidthStrokeProperties;
      created: boolean;
      kind: "variable-width";
      moved: boolean;
      pathId: string;
      startClient: Point;
      workingProfile: Extract<
        VariableWidthStrokeProperties,
        { widthProfile: "CUSTOM" }
      >;
    };

interface VectorEditSession {
  activePathId?: string;
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
  fillStyleId?: string;
  paint: NonNullable<LeaferVectorEditScope["paint"]>;
  penContour?: VectorPenContourDraft;
  penContourOverlay: VectorPenContourOverlay;
  penTargetVertexId?: string;
  readOnly: boolean;
  segmentSelectionPath: LeaferElement;
  selectedSegmentIds: string[];
  selectedVertexIds: string[];
  topologyEditable: boolean;
  tool: LeaferVectorEditTool;
  tracePath: LeaferElement;
  variableWidthEditable: boolean;
  selectedWidthPointIndexes: number[];
  strokeWidth: number;
  variableWidthStrokeProperties: VariableWidthStrokeProperties;
  widthPointControls: LeaferElement[];
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

interface VectorEditControllerOptions {
  callbacks: Pick<
    LeaferEngineCallbacks,
    | "onVectorCut"
    | "onVectorErase"
    | "onVectorEdit"
    | "onVectorEditActiveNodeChange"
    | "onVectorEditExit"
    | "onVectorEditScopeChange"
    | "onVectorEditSelectionChange"
    | "onVectorLineCut"
    | "onVectorShapeBuild"
  >;
  current(): { disposed: boolean };
  element(nodeId: string): LeaferElement | undefined;
  regionElement(nodeId: string, regionId: string): LeaferElement | undefined;
  finishNodePresentation(nodeId: string): void;
  leafer: LeaferModule;
  nodeId(element: LeaferElement): string | undefined;
  onSnapGuideLines: (lines: readonly SnapGuideLine[]) => void;
  presentationRoot: LeaferGroup;
  report(error: unknown): void;
  restoreProjection(): void;
  root: LeaferGroup;
}

export interface VectorEditProjectionSync {
  changedNodeIds: ReadonlySet<string>;
  contiguousChanges: boolean;
  identityChanged: boolean;
  input: LeaferEngineSyncInput;
  projection: LeaferSceneProjection;
}

const MATRIX_EPSILON = 0.000_001;
const MIN_DRAW_DISTANCE = 4;
const VECTOR_CUT_GUIDE_COLOR = "#f248b5";
const MAX_VECTOR_LASSO_POINTS = 4_096;

/**
 * Owns the complete direct Vector Edit interaction lifecycle. The controller
 * keeps only disposable Leafer previews and session selection; accepted edits
 * still enter the authoritative document through typed Adapter callbacks.
 */
export class VectorEditController {
  readonly #options: VectorEditControllerOptions;
  readonly #vectorAnchorMeasurements: VectorAnchorMeasurementController;
  readonly #vectorEraserOverlay: VectorEraserOverlayController;
  readonly #vectorShapeBuilderOverlay: VectorShapeBuilderOverlayController;
  readonly #vectorEditControls = new WeakMap<
    LeaferElement,
    VectorEditControl
  >();
  readonly #vectorEdits = new Map<string, VectorEditSession>();
  readonly #vectorGeometrySnap: VectorGeometrySnapController;
  readonly #vectorSelectionOverlay: VectorSelectionOverlay;
  #activeVectorEditNodeId: string | null = null;
  #eraserPending = false;
  #shapeBuilderPending = false;
  #input: LeaferEngineSyncInput | null = null;
  #vectorLasso: VectorLassoSession | null = null;

  constructor(options: VectorEditControllerOptions) {
    this.#options = options;
    this.#vectorGeometrySnap = new VectorGeometrySnapController({
      onLines: options.onSnapGuideLines,
    });
    const group = new options.leafer.Group({
      editable: false,
      hitChildren: true,
      hittable: false,
      visible: false,
    }) as LeaferGroup;
    const hitArea = new options.leafer.Rect({
      editable: false,
      fill: "rgba(0, 0, 0, 0.001)",
      hittable: false,
    }) as LeaferElement;
    const box = new options.leafer.Rect({
      editable: false,
      fill: null,
      hittable: false,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
    }) as LeaferElement;
    group.add(hitArea);
    group.add(box);
    options.presentationRoot.add(group);
    this.#vectorSelectionOverlay = {
      box,
      controls: [],
      group,
      hitArea,
    };
    this.#vectorEditControls.set(hitArea, { kind: "selection-box" });
    this.#vectorAnchorMeasurements = new VectorAnchorMeasurementController({
      layerIndex: 10,
      leafer: options.leafer,
      presentationRoot: options.presentationRoot,
      viewportRoot: options.root,
    });
    this.#vectorEraserOverlay = new VectorEraserOverlayController({
      layerIndex: 12,
      leafer: options.leafer,
      presentationRoot: options.presentationRoot,
      viewportRoot: options.root,
    });
    this.#vectorShapeBuilderOverlay = new VectorShapeBuilderOverlayController({
      layerIndex: 13,
      leafer: options.leafer,
      presentationRoot: options.presentationRoot,
      viewportRoot: options.root,
    });
  }

  get active(): boolean {
    return this.#vectorEdits.size > 0;
  }

  prepareSync(input: LeaferEngineSyncInput): void {
    const previous = this.#input;
    if (
      previous &&
      (previous.document.documentId !== input.document.documentId ||
        previous.pageId !== input.pageId ||
        !sameStringList(
          previous.vectorEditScope?.nodes.map((node) => node.nodeId) ?? [],
          input.vectorEditScope?.nodes.map((node) => node.nodeId) ?? [],
        ))
    ) {
      this.cancel();
    }
  }

  syncProjection(sync: VectorEditProjectionSync): void {
    this.#input = sync.input;
    if (
      this.#vectorEdits.size === 0 ||
      (!sync.identityChanged &&
        sync.contiguousChanges &&
        ![...this.#vectorEdits.keys()].some(
          (nodeId) =>
            sync.changedNodeIds.has(nodeId) ||
            (sync.projection.affectedNodeIds?.has(nodeId) === true &&
              isLockedSpec(sync.projection.elementsById.get(nodeId))),
        ))
    ) {
      return;
    }
    this.cancel();
  }

  syncViewport(): void {
    if (!this.active) return;
    if (this.#input)
      this.#vectorGeometrySnap.syncViewport(this.#input.viewport);
    this.#vectorAnchorMeasurements.syncViewport();
    this.#vectorEraserOverlay.syncViewport();
    this.#vectorShapeBuilderOverlay.syncViewport();
    this.#renderVectorEditOverlays();
  }

  setPointMode(mode: VectorPointMode): boolean {
    const session = this.#activeVectorEditSession();
    if (
      !session ||
      session.readOnly ||
      !session.topologyEditable ||
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
      this.#options.report(new Error(result.message));
      return false;
    }
    return this.#submitVectorEdit(session, result.network);
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.active || isKeyboardInputTarget(event.target)) return false;
    this.#vectorAnchorMeasurements.handleKeyDown(event);
    const pendingContour = [...this.#vectorEdits.values()].find(
      (session) => session.penContour !== undefined,
    );
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
      stopKey(event);
      if (!event.repeat && selectionDrag.spaceStartDocument === null) {
        selectionDrag.spaceStartDocument = {
          ...selectionDrag.currentDocument,
        };
        selectionDrag.spaceBaseOffset = {
          ...selectionDrag.repositionOffset,
        };
        selectionDrag.spaceActionDocument = {
          x: selectionDrag.currentDocument.x - selectionDrag.repositionOffset.x,
          y: selectionDrag.currentDocument.y - selectionDrag.repositionOffset.y,
        };
      }
      return true;
    }
    if (event.code === "Escape" && this.#vectorLasso) {
      stopKey(event);
      this.#cancelVectorLasso();
      return true;
    }
    if (event.code === "Escape") {
      if (pendingContour) {
        stopKey(event);
        this.#cancelVectorPenContour(pendingContour);
        return true;
      }
      const penSelection = [...this.#vectorEdits.values()].find(
        (session) =>
          session.tool === "pen" &&
          (session.selectedVertexIds.length > 0 ||
            session.selectedSegmentIds.length > 0),
      );
      if (penSelection) {
        stopKey(event);
        this.#setVectorSelection(penSelection, [], []);
        return true;
      }
    }
    if (event.code === "Escape" || event.code === "Enter") {
      stopKey(event);
      const draggingSession = [...this.#vectorEdits.values()].find(
        (session) => session.drag !== null,
      );
      if (draggingSession) {
        this.#cancelVectorEditDrag(draggingSession);
        this.#renderVectorEditOverlays();
        if (event.code === "Escape") return true;
      }
      this.#options.callbacks.onVectorEditExit?.();
      return true;
    }
    if (event.code === "Backspace" || event.code === "Delete") {
      stopKey(event);
      if (pendingContour) {
        this.#cancelVectorPenContour(pendingContour);
        return true;
      }
      if (this.#deleteSelectedVariableWidthPoints()) return true;
      this.#deleteSelectedVectorVertices();
      return true;
    }
    return false;
  }

  handleKeyUp(event: KeyboardEvent): boolean {
    if (!this.active || isKeyboardInputTarget(event.target)) {
      return false;
    }
    this.#vectorAnchorMeasurements.handleKeyUp(event);
    if (event.code !== "Space") return false;
    const selectionDrag = [...this.#vectorEdits.values()]
      .map((session) => session.drag)
      .find(
        (
          drag,
        ): drag is Extract<VectorEditDrag, { kind: "selection-transform" }> =>
          drag?.kind === "selection-transform",
      );
    if (!selectionDrag || selectionDrag.spaceStartDocument === null) {
      return false;
    }
    stopKey(event);
    selectionDrag.spaceStartDocument = null;
    selectionDrag.spaceBaseOffset = null;
    selectionDrag.spaceActionDocument = null;
    return true;
  }

  dispose(): void {
    this.cancel();
    this.#vectorAnchorMeasurements.dispose();
    this.#vectorEraserOverlay.dispose();
    this.#vectorShapeBuilderOverlay.dispose();
    this.#vectorSelectionOverlay.group.remove();
    this.#vectorSelectionOverlay.group.destroy();
    this.#input = null;
  }

  sync(input: LeaferEngineSyncInput): void {
    this.#input = input;
    const scope = input.vectorEditScope;
    if (!scope) {
      this.cancel();
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
      const pathElement = this.#options.element(item.nodeId);
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
      this.#options.finishNodePresentation(item.nodeId);
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
          item.activePathId,
          selectedSegmentIds,
          selectedVertexIds,
          item.readOnly,
          item.topologyEditable,
          item.strokeWidth,
          item.variableWidthEditable,
          item.variableWidthStrokeProperties ?? { widthProfile: "UNIFORM" },
          scope.fillStyleId,
          scope.paint ?? [{ type: "solid", color: "#4f7fff", opacity: 1 }],
          scope.tool,
        );
        if (!session) continue;
        this.#vectorEdits.set(item.nodeId, session);
      } else {
        if (
          (session.drag?.kind === "cut" &&
            (scope.tool !== "cut" || item.readOnly)) ||
          (session.drag?.kind === "bend" &&
            (scope.tool !== "bend" || item.readOnly)) ||
          ((session.drag?.kind === "pen" ||
            session.drag?.kind === "pen-start") &&
            (scope.tool !== "pen" || item.readOnly)) ||
          (session.drag?.kind === "variable-width" &&
            (scope.tool !== "variable-width" ||
              item.readOnly ||
              !item.variableWidthEditable)) ||
          (session.drag?.kind === "eraser" &&
            (scope.tool !== "eraser" || item.readOnly)) ||
          (session.drag?.kind === "shape-builder" &&
            (scope.tool !== "shape-builder" || item.readOnly))
        ) {
          this.#cancelVectorEditDrag(session);
        }
        session.pathElement = pathElement;
        if (item.activePathId) session.activePathId = item.activePathId;
        else delete session.activePathId;
        session.readOnly = item.readOnly;
        session.topologyEditable = item.topologyEditable;
        session.strokeWidth = item.strokeWidth;
        session.variableWidthEditable = item.variableWidthEditable;
        if (!session.drag) {
          session.variableWidthStrokeProperties = structuredClone(
            item.variableWidthStrokeProperties ?? { widthProfile: "UNIFORM" },
          );
        }
        if (scope.fillStyleId) session.fillStyleId = scope.fillStyleId;
        else delete session.fillStyleId;
        session.paint = scope.paint ?? [
          { type: "solid", color: "#4f7fff", opacity: 1 },
        ];
        session.selectedSegmentIds = selectedSegmentIds;
        session.selectedVertexIds = selectedVertexIds;
        session.tool = scope.tool;
        if (
          scope.tool !== "pen" ||
          item.readOnly ||
          selectedVertexIds.length > 0
        ) {
          delete session.penContour;
        }
        const penTargetVertexId = session.penTargetVertexId;
        if (
          scope.tool !== "pen" ||
          item.readOnly ||
          selectedVertexIds.length !== 1 ||
          penTargetVertexId === selectedVertexIds[0] ||
          (penTargetVertexId !== undefined &&
            !network.vertices.some(({ id }) => id === penTargetVertexId))
        ) {
          delete session.penTargetVertexId;
        }
        if (!session.drag) session.network = structuredClone(network);
      }
      session.overlayGroup.setTransform({ ...pathElement.localTransform });
    }
    this.#activeVectorEditNodeId = this.#vectorEdits.has(scope.activeNodeId)
      ? scope.activeNodeId
      : (scope.nodes.find((item) => this.#vectorEdits.has(item.nodeId))
          ?.nodeId ?? null);
    if (this.#vectorEdits.size === 0) this.#activeVectorEditNodeId = null;
    this.#vectorAnchorMeasurements.sync(this.#selectedVectorAnchor());
    this.#renderVectorEditOverlays();
  }

  #createVectorEditSession(
    nodeId: string,
    pathElement: LeaferElement,
    network: VectorNetwork,
    activePathId: string | undefined,
    selectedSegmentIds: string[],
    selectedVertexIds: string[],
    readOnly: boolean,
    topologyEditable: boolean,
    strokeWidth: number,
    variableWidthEditable: boolean,
    variableWidthStrokeProperties: VariableWidthStrokeProperties,
    fillStyleId: string | undefined,
    paint: NonNullable<LeaferVectorEditScope["paint"]>,
    tool: LeaferVectorEditTool,
  ): VectorEditSession | undefined {
    const parent = pathElement.parent as LeaferGroup | undefined;
    if (!parent || typeof parent.add !== "function") return undefined;
    const overlayGroup = new this.#options.leafer.Group({
      editable: false,
      hitChildren: true,
    }) as LeaferGroup;
    const tracePath = new this.#options.leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      opacity: 0.55,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
    }) as LeaferElement;
    const cutHitPath = new this.#options.leafer.Path({
      cursor:
        tool === "bend" || tool === "variable-width" ? "pointer" : "crosshair",
      editable: false,
      fill: null,
      hittable:
        !readOnly &&
        (tool === "bend" ||
          (tool === "variable-width" && variableWidthEditable) ||
          tool === "shape-builder" ||
          tool === "cut" ||
          tool === "pen"),
      stroke: "rgba(0, 0, 0, 0.001)",
    }) as LeaferElement;
    const cutGuidePath = new this.#options.leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: VECTOR_CUT_GUIDE_COLOR,
      strokeCap: "round",
      visible: false,
    }) as LeaferElement;
    const handlePath = new this.#options.leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: "#8b8b89",
    }) as LeaferElement;
    const lassoPath = new this.#options.leafer.Path({
      editable: false,
      fill: "rgba(79, 127, 255, 0.08)",
      hittable: false,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
      visible: false,
    }) as LeaferElement;
    const segmentSelectionPath = new this.#options.leafer.Path({
      editable: false,
      fill: null,
      hittable: false,
      stroke: LEAFER_EDITOR_SELECTION_COLOR,
    }) as LeaferElement;
    const penContourOverlay = createVectorPenContourOverlay(
      this.#options.leafer,
    );
    overlayGroup.add(cutHitPath);
    overlayGroup.add(tracePath);
    overlayGroup.add(segmentSelectionPath);
    overlayGroup.add(handlePath);
    overlayGroup.add(lassoPath);
    overlayGroup.add(cutGuidePath);
    overlayGroup.add(penContourOverlay.group);
    parent.add(overlayGroup);
    this.#vectorEditControls.set(cutHitPath, { kind: "path", nodeId });
    return {
      ...(activePathId ? { activePathId } : {}),
      anchorControls: [],
      cutGuidePath,
      cutHitPath,
      drag: null,
      ...(fillStyleId ? { fillStyleId } : {}),
      handleControls: [],
      handlePath,
      lassoPath,
      network: structuredClone(network),
      nodeId,
      overlayGroup,
      pathElement,
      paint,
      penContourOverlay,
      readOnly,
      segmentSelectionPath,
      selectedSegmentIds,
      selectedVertexIds,
      selectedWidthPointIndexes: [],
      strokeWidth,
      tool,
      topologyEditable,
      tracePath,
      variableWidthEditable,
      variableWidthStrokeProperties: structuredClone(
        variableWidthStrokeProperties,
      ),
      widthPointControls: [],
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
    const corner = this.#vectorCornerAppearance(session.nodeId);
    const serialized = serializeVectorNetwork(
      session.network,
      corner.radius,
      corner.smoothing,
    );
    if (!serialized.ok) {
      this.#options.report(
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
      cursor:
        session.tool === "bend" || session.tool === "variable-width"
          ? "pointer"
          : "crosshair",
      hittable:
        !session.readOnly &&
        (session.tool === "cut" ||
          session.tool === "bend" ||
          (session.tool === "variable-width" &&
            session.variableWidthEditable) ||
          session.tool === "shape-builder" ||
          session.tool === "eraser" ||
          session.tool === "pen"),
      path: serialized.path,
      strokeWidth: 14 / zoom,
    });
    for (const region of session.network.regions) {
      const element = this.#options.regionElement(session.nodeId, region.id);
      const serializedRegion = serializeVectorRegion(
        session.network,
        region.id,
        corner.radius,
        corner.smoothing,
      );
      if (!element || !serializedRegion.ok) continue;
      element.set({
        cursor:
          session.tool === "paint" || session.tool === "shape-builder"
            ? "crosshair"
            : "pointer",
        path: serializedRegion.path,
      });
      this.#vectorEditControls.set(element, {
        kind: "region",
        nodeId: session.nodeId,
        regionId: region.id,
      });
    }
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
    session.widthPointControls.forEach((control) => {
      control.remove();
      control.destroy();
    });
    session.anchorControls = [];
    session.handleControls = [];
    session.widthPointControls = [];
    const selected = new Set(session.selectedVertexIds);
    for (const vertex of session.network.vertices) {
      const isSelected = selected.has(vertex.id);
      const isPenTarget = session.penTargetVertexId === vertex.id;
      const renderedAnchorSize = isPenTarget ? 11 / zoom : anchorSize;
      const anchor = new this.#options.leafer.Ellipse({
        cursor: session.readOnly
          ? "default"
          : session.tool === "cut" ||
              session.tool === "eraser" ||
              session.tool === "shape-builder" ||
              session.tool === "pen"
            ? "crosshair"
            : "pointer",
        editable: false,
        fill: isSelected ? LEAFER_EDITOR_SELECTION_COLOR : "#ffffff",
        height: renderedAnchorSize,
        hittable: true,
        stroke: LEAFER_EDITOR_SELECTION_COLOR,
        strokeWidth: (isPenTarget ? 2.5 : 1.5) / zoom,
        width: renderedAnchorSize,
        x: vertex.x - renderedAnchorSize / 2,
        y: vertex.y - renderedAnchorSize / 2,
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
    for (const vertexId of session.tool === "move" || session.tool === "bend"
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
        const control = new this.#options.leafer.Ellipse({
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
    this.#renderVariableWidthControls(session, zoom);
    renderVectorPenContourOverlay(
      session.penContourOverlay,
      session.penContour,
      zoom,
      session.tool === "pen" && !session.readOnly,
    );
    if (
      !this.#vectorLasso ||
      this.#vectorLasso.activeNodeId !== session.nodeId
    ) {
      session.lassoPath.set({ path: "", visible: false });
    }
  }

  #renderVariableWidthControls(session: VectorEditSession, zoom: number): void {
    if (
      session.tool !== "variable-width" ||
      session.readOnly ||
      !session.topologyEditable ||
      !session.variableWidthEditable ||
      session.strokeWidth <= 0
    ) {
      return;
    }
    const pathId = session.activePathId ?? session.network.paths[0]?.id;
    if (!pathId) return;
    const selected = new Set(session.selectedWidthPointIndexes);
    for (const [index, widthPoint] of variableWidthProfilePoints(
      session.variableWidthStrokeProperties,
    ).entries()) {
      const location = variableWidthPathLocation(
        session.network,
        pathId,
        widthPoint.position,
      );
      if (!location) continue;
      const normal = { x: -location.tangent.y, y: location.tangent.x };
      const offset = (session.strokeWidth * widthPoint.width) / 2;
      const point = {
        x: location.point.x + normal.x * offset,
        y: location.point.y + normal.y * offset,
      };
      const size = (selected.has(index) ? 9 : 7) / zoom;
      const control = new this.#options.leafer.Ellipse({
        cursor: "move",
        editable: false,
        fill: selected.has(index) ? LEAFER_EDITOR_SELECTION_COLOR : "#ffffff",
        height: size,
        hittable: true,
        stroke: LEAFER_EDITOR_SELECTION_COLOR,
        strokeWidth: 1.5 / zoom,
        width: size,
        x: point.x - size / 2,
        y: point.y - size / 2,
      }) as LeaferElement;
      session.widthPointControls.push(control);
      this.#vectorEditControls.set(control, {
        index,
        kind: "width-point",
        nodeId: session.nodeId,
        pathId,
      });
      session.overlayGroup.add(control);
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
      const control = new this.#options.leafer.Rect({
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
      const control = new this.#options.leafer.Ellipse({
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
    if (selected.length > 0) delete session.penContour;
    if (selected.length !== 1 || session.penTargetVertexId === selected[0]) {
      delete session.penTargetVertexId;
    }
    this.#vectorAnchorMeasurements.sync(this.#selectedVectorAnchor());
    this.#options.callbacks.onVectorEditSelectionChange?.(session.nodeId, {
      segmentIds: selectedSegments,
      vertexIds: selected,
    });
    this.#renderVectorEditOverlay(session);
    this.#renderVectorSelectionOverlay();
  }

  #shapeBuilderStartSession(
    target: LeaferElement | undefined,
    control: VectorEditControl | undefined,
  ): VectorEditSession | null {
    const active = this.#activeVectorEditSession();
    if (!active || active.tool !== "shape-builder") return null;
    const controlNodeId =
      control && "nodeId" in control ? control.nodeId : undefined;
    const targetNodeId =
      controlNodeId ?? (target ? this.#options.nodeId(target) : undefined);
    const withinScope =
      control?.kind === "selection-box" ||
      (targetNodeId !== undefined && this.#vectorEdits.has(targetNodeId));
    if (!withinScope) return null;
    const targetSession = targetNodeId
      ? this.#vectorEdits.get(targetNodeId)
      : undefined;
    if (targetSession && !targetSession.readOnly) return targetSession;
    if (!active.readOnly) return active;
    return (
      [...this.#vectorEdits.values()].find((session) => !session.readOnly) ??
      null
    );
  }

  pointerDown(event: unknown): void {
    if (
      this.#options.current().disposed ||
      this.#eraserPending ||
      this.#shapeBuilderPending ||
      [...this.#vectorEdits.values()].some((session) => session.drag)
    ) {
      return;
    }
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel || pointer.right || pointer.middle) return;
    this.#vectorAnchorMeasurements.clear();
    const target = isElement(pointer.target) ? pointer.target : undefined;
    const control = target ? this.#vectorEditControls.get(target) : undefined;
    const shapeBuilderSession = this.#shapeBuilderStartSession(target, control);
    if (shapeBuilderSession) {
      const startClient = eventClientPoint(pointer);
      shapeBuilderSession.drag = {
        altKey: pointer.altKey,
        kind: "shape-builder",
        lastClient: startClient,
        moved: false,
        points: [pointer.getInnerPoint(this.#options.root)],
        startClient,
      };
      return;
    }
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
      const startDocument = pointer.getInnerPoint(this.#options.root);
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
      if (holder.drag.mode === "move") {
        this.#beginVectorGeometrySnap(
          targets.map(({ session: target, vertexIds }) => ({
            nodeId: target.nodeId,
            vertexIds,
          })),
        );
      }
      return;
    }
    const controlNodeId =
      control && "nodeId" in control ? control.nodeId : undefined;
    const targetNodeId =
      controlNodeId ?? (target ? this.#options.nodeId(target) : undefined);
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
      this.#options.callbacks.onVectorEditScopeChange?.({
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
              this.#options.nodeId(target) === session.nodeId,
          )
        : undefined;
    const session = targetSession ?? this.#activeVectorEditSession();
    if (!session) return;
    if (this.#activeVectorEditNodeId !== session.nodeId) {
      this.#activeVectorEditNodeId = session.nodeId;
      this.#options.callbacks.onVectorEditActiveNodeChange?.(session.nodeId);
    }
    if (this.#appendMeasuredVectorPoint(pointer, session, control)) return;
    if (session.tool === "variable-width") {
      this.#beginVariableWidthEdit(pointer, session, control, target);
      return;
    }
    if (session.tool === "pen") {
      this.#beginVectorPenPoint(pointer, session, control, target);
      return;
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
    if (session.tool === "eraser") {
      const holder = session.readOnly
        ? [...this.#vectorEdits.values()].find(
            (candidate) => !candidate.readOnly,
          )
        : session;
      const input = this.#input;
      if (!holder || !input) return;
      const startClient = eventClientPoint(pointer);
      const startDocument = pointer.getInnerPoint(this.#options.root);
      const settings = input.vectorEditScope?.eraser ?? {
        shape: "round" as const,
        weight: 24,
      };
      holder.drag = {
        kind: "eraser",
        lastClient: startClient,
        moved: false,
        points: [startDocument],
        shape: settings.shape,
        startClient,
        weight: settings.weight,
      };
      this.#vectorEraserOverlay.show(
        holder.drag.points,
        holder.drag.weight,
        holder.drag.shape,
      );
      return;
    }
    if (session.tool === "paint") {
      if (
        session.readOnly ||
        !session.topologyEditable ||
        control?.kind !== "region"
      )
        return;
      const painted =
        !pointer.altKey && session.fillStyleId
          ? setVectorRegionFillStyle(
              session.network,
              control.regionId,
              session.fillStyleId,
            )
          : setVectorRegionFills(
              session.network,
              control.regionId,
              pointer.altKey ? [] : session.paint,
            );
      if (!painted.ok) {
        if (painted.code !== "no-op")
          this.#options.report(new Error(painted.message));
        return;
      }
      this.#submitVectorEdit(session, painted.network);
      return;
    }
    if (session.tool === "cut") {
      if (session.readOnly) return;
      let clickTarget: { at: VectorCutLocation; pathId: string } | undefined;
      if (control?.kind === "vertex") {
        const pathId =
          session.activePathId ??
          findVectorPathIdForVertex(session.network, control.vertexId);
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
      const startDocument = pointer.getInnerPoint(this.#options.root);
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
    if (session.tool === "bend" && control?.kind !== "handle") {
      if (session.readOnly) return;
      if (control?.kind === "vertex") {
        if (!session.topologyEditable) return;
        this.#setVectorSelection(session, [], [control.vertexId]);
        if (listVectorVertexHandles(session.network, control.vertexId).length) {
          return;
        }
        const curved = setVectorPointMode(
          session.network,
          [control.vertexId],
          "smooth",
        );
        if (!curved.ok) {
          this.#options.report(new Error(curved.message));
          return;
        }
        this.#submitVectorEdit(session, curved.network);
        return;
      }
      if (target !== session.cutHitPath) return;
      const hit = nearestVectorSegmentPoint(
        session.network,
        pointer.getInnerPoint(session.pathElement),
      );
      if (!hit) return;
      const segment = session.network.segments.find(
        (candidate) => candidate.id === hit.segmentId,
      );
      this.#setVectorSelection(
        session,
        [hit.segmentId],
        segment ? [segment.startVertexId, segment.endVertexId] : [],
      );
      session.drag = {
        before: structuredClone(session.network),
        kind: "bend",
        moved: false,
        pathId: hit.pathId,
        segmentId: hit.segmentId,
        startClient: eventClientPoint(pointer),
        startPoint: hit.point,
        t: hit.t,
      };
      return;
    }
    if (!control || control.kind === "path") {
      if (target && this.#options.nodeId(target) === session.nodeId) {
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
      const document = this.#input?.document;
      const world = document
        ? getVisibleWorldTransform(document.nodesById, session.nodeId)
        : null;
      if (!world) return;
      session.drag = {
        before: structuredClone(session.network),
        kind: "vertices",
        moved: false,
        startClient: eventClientPoint(pointer),
        startDocument: pointer.getInnerPoint(this.#options.root),
        vertexIds: [...current],
        world,
      };
      this.#beginVectorGeometrySnap([
        { nodeId: session.nodeId, vertexIds: [...current] },
      ]);
      return;
    }

    if (control.kind === "region" || control.kind === "width-point") return;

    if (!session.selectedVertexIds.includes(control.vertexId)) {
      this.#setVectorSelection(session, [], [control.vertexId]);
    }
    if (session.readOnly) return;
    const document = this.#input?.document;
    const world = document
      ? getVisibleWorldTransform(document.nodesById, session.nodeId)
      : null;
    if (!world) return;
    const startDocument = pointer.getInnerPoint(this.#options.root);
    session.drag = {
      before: structuredClone(session.network),
      kind: "handle",
      moved: false,
      reference: control.reference,
      startClient: eventClientPoint(pointer),
      startDocument,
      vertexId: control.vertexId,
      world,
    };
    this.#beginVectorHandleSnap({
      nodeId: session.nodeId,
      position: startDocument,
      reference: control.reference,
    });
  }

  pointerMove(event: unknown): void {
    const pointer = asLeaferEvent(event);
    const activeDrag = [...this.#vectorEdits.values()].some(
      (candidate) => candidate.drag !== null,
    );
    if (this.#vectorLasso || activeDrag) {
      this.#vectorAnchorMeasurements.clear();
    } else {
      this.#vectorAnchorMeasurements.pointerMove({
        altKey: pointer.altKey,
        target:
          this.#hoveredVectorAnchor(pointer.target) ??
          this.#prospectiveVectorAnchor(pointer),
      });
    }
    this.#syncVectorPenTarget(pointer);
    this.#syncVectorPenContourCursor(pointer);
    const lasso = this.#vectorLasso;
    if (lasso && !this.#options.current().disposed) {
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
    if (!session || !drag || this.#options.current().disposed) return;
    if (pointer.isCancel) return;
    const client = eventClientPoint(pointer);
    drag.moved ||= pointDistance(drag.startClient, client) >= MIN_DRAW_DISTANCE;
    if (drag.kind === "eraser") {
      if (pointDistance(drag.lastClient, client) < 2) return;
      drag.lastClient = client;
      const point = pointer.getInnerPoint(this.#options.root);
      if (drag.points.length < MAX_VECTOR_LASSO_POINTS) drag.points.push(point);
      else drag.points[MAX_VECTOR_LASSO_POINTS - 1] = point;
      this.#vectorEraserOverlay.show(drag.points, drag.weight, drag.shape);
      return;
    }
    if (drag.kind === "shape-builder") {
      if (pointDistance(drag.lastClient, client) < 2) return;
      drag.lastClient = client;
      const point = pointer.getInnerPoint(this.#options.root);
      if (drag.points.length < MAX_VECTOR_LASSO_POINTS) drag.points.push(point);
      else drag.points[MAX_VECTOR_LASSO_POINTS - 1] = point;
      this.#vectorShapeBuilderOverlay.show(
        drag.points,
        this.#input?.viewport.zoom ?? 1,
      );
      return;
    }
    if (!drag.moved) return;
    if (drag.kind === "cut") {
      drag.currentDocument = pointer.getInnerPoint(this.#options.root);
      drag.currentLocal = pointer.getInnerPoint(session.pathElement);
      this.#renderVectorCutGuide(session);
      return;
    }
    if (drag.kind === "bend") {
      const result = bendVectorSegment(
        drag.before,
        drag.pathId,
        drag.segmentId,
        drag.t,
        pointer.getInnerPoint(session.pathElement),
      );
      if (!result.ok) {
        drag.moved = false;
        session.network = structuredClone(drag.before);
        if (result.code !== "no-op") {
          this.#options.report(new Error(result.message));
        }
      } else {
        session.network = result.network;
      }
      this.#renderVectorEditOverlay(session);
      return;
    }
    if (drag.kind === "variable-width") {
      const local = pointer.getInnerPoint(session.pathElement);
      const hit = nearestVectorSegmentPoint(session.network, local);
      if (!hit || hit.pathId !== drag.pathId) return;
      const location = variableWidthHitPosition(
        session.network,
        hit.pathId,
        hit.segmentId,
        hit.t,
      );
      if (!location || session.strokeWidth <= 0) return;
      const position = pointer.ctrlKey
        ? location.position
        : this.#snapVariableWidthPosition(
            session,
            drag.pathId,
            location.position,
            7 /
              Math.max(
                MATRIX_EPSILON,
                Math.abs(this.#input?.viewport.zoom ?? 1),
              ),
          );
      const snapped = variableWidthPathLocation(
        session.network,
        drag.pathId,
        position,
      );
      if (!snapped) return;
      const normal = { x: -snapped.tangent.y, y: snapped.tangent.x };
      const offset = {
        x: local.x - snapped.point.x,
        y: local.y - snapped.point.y,
      };
      const width =
        (2 * Math.abs(offset.x * normal.x + offset.y * normal.y)) /
        session.strokeWidth;
      const profile = updateVariableWidthPoints(
        drag.workingProfile,
        session.selectedWidthPointIndexes,
        drag.anchorIndex,
        { position, width },
      );
      if (!profile) return;
      session.variableWidthStrokeProperties = profile;
      this.#renderVectorEditOverlay(session);
      return;
    }
    if (drag.kind === "pen-start") {
      const contour = session.penContour;
      if (!contour) return;
      const rawLocal = pointer.getInnerPoint(session.pathElement);
      const local = pointer.shiftKey
        ? constrainPointToOctant(contour.start.point, rawLocal)
        : rawLocal;
      contour.start = dragVectorPenContourStart(contour.start, local);
      contour.cursor = local;
      this.#renderVectorEditOverlay(session);
      return;
    }
    if (drag.kind === "pen") {
      const rawLocal = pointer.getInnerPoint(session.pathElement);
      const result = dragVectorPenPoint(
        drag.edit,
        pointer.shiftKey
          ? constrainPointToOctant(drag.edit.point, rawLocal)
          : rawLocal,
      );
      if (!result.ok) {
        drag.failed = true;
        session.network = structuredClone(drag.before);
        this.#options.report(new Error(result.message));
      } else {
        drag.edit = result.edit;
        drag.failed = false;
        session.network = result.edit.network;
      }
      this.#renderVectorEditOverlay(session);
      return;
    }
    if (drag.kind === "selection-transform") {
      const currentDocument = pointer.getInnerPoint(this.#options.root);
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
          ? translationTransform(
              this.#vectorGeometrySnap.update(
                {
                  x: currentDocument.x - drag.startDocument.x,
                  y: currentDocument.y - drag.startDocument.y,
                },
                Boolean(pointer.ctrlKey),
              ),
            )
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
          this.#options.report(
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
          this.#options.report(new Error(result.message));
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
        const currentDocument = pointer.getInnerPoint(this.#options.root);
        const documentDelta = this.#vectorGeometrySnap.update(
          {
            x: currentDocument.x - drag.startDocument.x,
            y: currentDocument.y - drag.startDocument.y,
          },
          Boolean(pointer.ctrlKey),
        );
        const localTransform = documentTransformToLocal(
          drag.world,
          translationTransform(documentDelta),
        );
        return localTransform
          ? transformVectorVertices(drag.before, drag.vertexIds, localTransform)
          : {
              ok: false as const,
              code: "invalid-transform" as const,
              message: `Vector layer ${session.nodeId} has a non-invertible transform`,
            };
      }
      return (() => {
        const vertex = drag.before.vertices.find(
          (candidate) => candidate.id === drag.vertexId,
        );
        const currentDocument = pointer.getInnerPoint(this.#options.root);
        const rawDelta = {
          x: currentDocument.x - drag.startDocument.x,
          y: currentDocument.y - drag.startDocument.y,
        };
        const snappedDelta = this.#vectorGeometrySnap.update(
          rawDelta,
          Boolean(pointer.ctrlKey),
        );
        const adjustment = documentTransformToLocal(
          drag.world,
          translationTransform({
            x: snappedDelta.x - rawDelta.x,
            y: snappedDelta.y - rawDelta.y,
          }),
        );
        return vertex
          ? adjustment
            ? moveVectorHandle(drag.before, drag.reference, {
                x: local.x - vertex.x + adjustment[4],
                y: local.y - vertex.y + adjustment[5],
              })
            : {
                ok: false as const,
                code: "invalid-transform" as const,
                message: `Vector layer ${session.nodeId} has a non-invertible transform`,
              }
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
      this.#options.report(new Error(result.message));
      return;
    }
    session.network = result.network;
    this.#renderVectorEditOverlay(session);
  }

  pointerUp(event: unknown): void {
    if (this.#vectorLasso) {
      const pointer = asLeaferEvent(event);
      if (!pointer.isCancel) this.pointerMove(event);
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
    this.pointerMove(event);
    const moved = drag.moved;
    this.#vectorGeometrySnap.finish();
    if (drag.kind === "eraser") {
      const request = {
        points: [...drag.points],
        shape: drag.shape,
        weight: drag.weight,
      };
      session.drag = null;
      this.#vectorEraserOverlay.clear();
      void this.#submitVectorErase(request);
      return;
    }
    if (drag.kind === "shape-builder") {
      const firstPoint = drag.points[0];
      session.drag = null;
      this.#vectorShapeBuilderOverlay.clear();
      if (!firstPoint) return;
      void this.#submitVectorShapeBuild({
        mode: moved ? "merge" : drag.altKey ? "subtract" : "extract",
        points: moved ? [...drag.points] : [firstPoint],
      });
      return;
    }
    if (drag.kind === "cut") {
      const end = drag.currentDocument;
      const clickTarget = drag.clickTarget;
      const start = drag.startDocument;
      session.drag = null;
      this.#renderVectorCutGuide(session);
      if (moved) {
        this.#submitVectorLineCut(start, end);
      } else if (clickTarget) {
        this.#submitVectorCut(clickTarget.pathId, clickTarget.at);
      }
      return;
    }
    if (drag.kind === "bend") {
      session.drag = null;
      const result = moved
        ? { ok: true as const, network: session.network }
        : bendVectorSegment(
            drag.before,
            drag.pathId,
            drag.segmentId,
            drag.t,
            drag.startPoint,
          );
      if (!result.ok) {
        session.network = structuredClone(drag.before);
        this.#renderVectorEditOverlays();
        if (result.code !== "no-op") {
          this.#options.report(new Error(result.message));
        }
        return;
      }
      this.#submitVectorEdit(session, result.network);
      return;
    }
    if (drag.kind === "variable-width") {
      session.drag = null;
      if (moved || drag.created) {
        const profile = session.variableWidthStrokeProperties;
        if (!this.#submitVariableWidthProfile(session, profile)) {
          session.variableWidthStrokeProperties = structuredClone(
            drag.beforeProfile,
          );
          this.#renderVectorEditOverlays();
        }
      } else {
        this.#renderVectorEditOverlays();
      }
      return;
    }
    if (drag.kind === "pen-start") {
      session.drag = null;
      this.#renderVectorEditOverlay(session);
      return;
    }
    if (drag.kind === "pen") {
      session.drag = null;
      if (drag.failed) {
        session.network = structuredClone(drag.before);
        if (drag.beforeContour) {
          session.penContour = structuredClone(drag.beforeContour);
        }
        session.selectedSegmentIds = [...drag.beforeSegmentIds];
        session.selectedVertexIds = [...drag.beforeVertexIds];
        this.#renderVectorEditOverlays();
        return;
      }
      const accepted = this.#submitVectorEdit(session, drag.edit.network);
      if (accepted) {
        session.selectedSegmentIds = [];
        session.selectedVertexIds = [];
        this.#setVectorSelection(session, [], [drag.edit.vertexId]);
      } else {
        session.network = structuredClone(drag.before);
        if (drag.beforeContour) {
          session.penContour = structuredClone(drag.beforeContour);
        }
        session.selectedSegmentIds = [...drag.beforeSegmentIds];
        session.selectedVertexIds = [...drag.beforeVertexIds];
        this.#renderVectorEditOverlays();
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
      this.#options.callbacks.onVectorEditActiveNodeChange?.(
        lastSelectedNodeId,
      );
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
    } else if (drag.kind === "variable-width") {
      session.variableWidthStrokeProperties = structuredClone(
        drag.beforeProfile,
      );
    } else if (
      drag.kind !== "cut" &&
      drag.kind !== "eraser" &&
      drag.kind !== "shape-builder" &&
      drag.kind !== "pen-start"
    ) {
      session.network = drag.before;
    }
    if (drag.kind === "pen") {
      if (drag.beforeContour) {
        session.penContour = structuredClone(drag.beforeContour);
      }
      session.selectedSegmentIds = [...drag.beforeSegmentIds];
      session.selectedVertexIds = [...drag.beforeVertexIds];
    } else if (drag.kind === "pen-start" && session.penContour) {
      session.penContour.start = structuredClone(drag.before);
    }
    session.drag = null;
    this.#vectorGeometrySnap.finish();
    if (drag.kind === "eraser") this.#vectorEraserOverlay.clear();
    if (drag.kind === "shape-builder") this.#vectorShapeBuilderOverlay.clear();
    session.cutGuidePath.set({ path: "", visible: false });
  }

  #cancelVectorPenContour(session: VectorEditSession): void {
    if (session.drag?.kind === "pen-start") session.drag = null;
    delete session.penContour;
    this.#renderVectorEditOverlay(session);
  }

  #beginVariableWidthEdit(
    pointer: ReturnType<typeof asLeaferEvent>,
    session: VectorEditSession,
    control: VectorEditControl | undefined,
    target: LeaferElement | undefined,
  ): void {
    if (
      session.readOnly ||
      !session.topologyEditable ||
      !session.variableWidthEditable ||
      session.strokeWidth <= 0
    ) {
      return;
    }
    const beforeProfile = structuredClone(
      session.variableWidthStrokeProperties,
    );
    let pathId: string;
    let insertion: ReturnType<typeof insertVariableWidthPoint>;
    let created = false;
    if (control?.kind === "width-point") {
      pathId = control.pathId;
      const point = variableWidthProfilePoints(beforeProfile)[control.index];
      insertion = point
        ? insertVariableWidthPoint(beforeProfile, point.position)
        : null;
    } else if (target === session.cutHitPath) {
      const hit = nearestVectorSegmentPoint(
        session.network,
        pointer.getInnerPoint(session.pathElement),
      );
      const location = hit
        ? variableWidthHitPosition(
            session.network,
            hit.pathId,
            hit.segmentId,
            hit.t,
          )
        : null;
      if (!hit || !location) return;
      pathId = hit.pathId;
      insertion = insertVariableWidthPoint(beforeProfile, location.position);
      created = insertion !== null;
    } else {
      return;
    }
    if (!insertion) return;
    const selected = new Set(
      session.selectedWidthPointIndexes.map((index) =>
        created && index >= insertion.index ? index + 1 : index,
      ),
    );
    if (pointer.shiftKey) {
      if (selected.has(insertion.index)) selected.delete(insertion.index);
      else selected.add(insertion.index);
    } else if (!selected.has(insertion.index)) {
      selected.clear();
      selected.add(insertion.index);
    }
    session.activePathId = pathId;
    session.selectedWidthPointIndexes = [...selected].sort(
      (left, right) => left - right,
    );
    session.variableWidthStrokeProperties = insertion.profile;
    if (!selected.has(insertion.index)) {
      this.#renderVectorEditOverlay(session);
      return;
    }
    session.drag = {
      anchorIndex: insertion.index,
      beforeProfile,
      created,
      kind: "variable-width",
      moved: false,
      pathId,
      startClient: eventClientPoint(pointer),
      workingProfile: insertion.profile,
    };
    this.#renderVectorEditOverlay(session);
  }

  #snapVariableWidthPosition(
    session: VectorEditSession,
    pathId: string,
    position: number,
    threshold: number,
  ): number {
    const source = variableWidthPathLocation(session.network, pathId, position);
    if (!source) return position;
    const candidates = new Set<number>();
    const path = session.network.paths.find((item) => item.id === pathId);
    for (const reference of path?.segments ?? []) {
      for (const parameter of [0, 0.5, 1]) {
        const location = variableWidthHitPosition(
          session.network,
          pathId,
          reference.segmentId,
          parameter,
        );
        if (location) candidates.add(location.position);
      }
    }
    const points = variableWidthProfilePoints(
      session.variableWidthStrokeProperties,
    );
    for (let index = 0; index < points.length - 1; index += 1) {
      candidates.add(
        (points[index]!.position + points[index + 1]!.position) / 2,
      );
    }
    let nearest = position;
    let nearestDistance = threshold;
    for (const candidate of candidates) {
      const location = variableWidthPathLocation(
        session.network,
        pathId,
        candidate,
      );
      if (!location) continue;
      const distance = pointDistance(source.point, location.point);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  #deleteSelectedVariableWidthPoints(): boolean {
    const session = this.#activeVectorEditSession();
    if (
      !session ||
      session.tool !== "variable-width" ||
      session.selectedWidthPointIndexes.length === 0
    ) {
      return false;
    }
    if (session.readOnly) return true;
    const insertion = insertVariableWidthPoint(
      session.variableWidthStrokeProperties,
      variableWidthProfilePoints(session.variableWidthStrokeProperties)[0]
        ?.position ?? 0,
    );
    if (!insertion) return true;
    const profile = deleteVariableWidthPoints(
      insertion.profile,
      session.selectedWidthPointIndexes,
    );
    if (!profile) return true;
    session.selectedWidthPointIndexes = [];
    this.#submitVariableWidthProfile(session, profile);
    return true;
  }

  #submitVariableWidthProfile(
    session: VectorEditSession,
    profile: VariableWidthStrokeProperties,
  ): boolean {
    return this.#submitVectorEdits([
      {
        network: session.network,
        nodeId: session.nodeId,
        variableWidthStrokeProperties: profile,
      },
    ]);
  }

  #submitVectorEdit(
    session: VectorEditSession,
    network: VectorNetwork,
  ): boolean {
    return this.#submitVectorEdits([{ network, nodeId: session.nodeId }]);
  }

  #submitVectorEdits(
    edits: readonly {
      network: VectorNetwork;
      nodeId: string;
      variableWidthStrokeProperties?: VariableWidthStrokeProperties;
    }[],
  ): boolean {
    if (!this.#options.callbacks.onVectorEdit) {
      this.#options.report(new Error("Vector editing callback is unavailable"));
      return false;
    }
    const accepted = this.#options.callbacks.onVectorEdit({
      deleteNode: false,
      edits,
    });
    if (!accepted) {
      this.#options.restoreProjection();
      return false;
    }
    for (const edit of edits) {
      const session = this.#vectorEdits.get(edit.nodeId);
      if (session) {
        session.network = structuredClone(edit.network);
        if (edit.variableWidthStrokeProperties) {
          session.variableWidthStrokeProperties = structuredClone(
            edit.variableWidthStrokeProperties,
          );
        }
      }
    }
    this.#renderVectorEditOverlays();
    return true;
  }

  #submitVectorCut(pathId: string, at: VectorCutLocation): boolean {
    const session = this.#activeVectorEditSession();
    if (!session || !this.#options.callbacks.onVectorCut) {
      this.#options.report(new Error("Vector cut callback is unavailable"));
      return false;
    }
    const response = this.#options.callbacks.onVectorCut({
      at,
      nodeId: session.nodeId,
      pathId,
    });
    if (!response.ok) {
      this.#options.restoreProjection();
      return false;
    }
    if (this.#vectorEdits.get(session.nodeId) === session) {
      session.network = structuredClone(response.network);
      session.selectedSegmentIds = [];
      session.selectedVertexIds = [...response.selectedVertexIds];
      this.#options.callbacks.onVectorEditSelectionChange?.(session.nodeId, {
        segmentIds: [],
        vertexIds: response.selectedVertexIds,
      });
      this.#renderVectorEditOverlays();
    }
    return true;
  }

  async #submitVectorErase(request: {
    points: readonly Point[];
    shape: "round" | "square";
    weight: number;
  }): Promise<void> {
    const input = this.#input;
    const callback = this.#options.callbacks.onVectorErase;
    if (!input || !callback) {
      this.#options.report(new Error("Vector eraser callback is unavailable"));
      return;
    }
    this.#eraserPending = true;
    try {
      const response = await callback({
        documentId: input.document.documentId,
        expectedRevision: input.document.revision,
        nodeIds: [...this.#vectorEdits.values()]
          .filter((session) => !session.readOnly)
          .map((session) => session.nodeId),
        pageId: input.pageId,
        points: request.points,
        shape: request.shape,
        weight: request.weight,
      });
      if (!response.ok) this.#options.restoreProjection();
    } catch (error) {
      this.#options.report(error);
      this.#options.restoreProjection();
    } finally {
      this.#eraserPending = false;
    }
  }

  async #submitVectorShapeBuild(request: {
    mode: "extract" | "merge" | "subtract";
    points: readonly Point[];
  }): Promise<void> {
    const input = this.#input;
    const callback = this.#options.callbacks.onVectorShapeBuild;
    if (!input || !callback) {
      this.#options.report(
        new Error("Vector Shape Builder callback is unavailable"),
      );
      return;
    }
    this.#shapeBuilderPending = true;
    try {
      const response = await callback({
        documentId: input.document.documentId,
        expectedRevision: input.document.revision,
        mode: request.mode,
        nodeIds: [...this.#vectorEdits.values()]
          .filter((session) => !session.readOnly)
          .map((session) => session.nodeId),
        pageId: input.pageId,
        points: request.points,
      });
      if (!response.ok) this.#options.restoreProjection();
    } catch (error) {
      this.#options.report(error);
      this.#options.restoreProjection();
    } finally {
      this.#shapeBuilderPending = false;
    }
  }

  #submitVectorLineCut(start: Point, end: Point): boolean {
    if (!this.#options.callbacks.onVectorLineCut) {
      this.#options.report(
        new Error("Vector line Cut callback is unavailable"),
      );
      return false;
    }
    const response = this.#options.callbacks.onVectorLineCut({
      end,
      nodeIds: [...this.#vectorEdits.values()]
        .filter((session) => !session.readOnly)
        .map((session) => session.nodeId),
      start,
    });
    if (!response.ok) {
      this.#options.restoreProjection();
      return false;
    }
    this.#options.callbacks.onVectorEditExit?.();
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
      this.#options.report(new Error(result.message));
      return true;
    }
    const accepted = result.deleteNode
      ? (this.#options.callbacks.onVectorEdit?.({
          deleteNode: true,
          nodeId: session.nodeId,
        }) ?? false)
      : this.#submitVectorEdit(session, result.network);
    if (accepted) {
      this.#options.callbacks.onVectorEditSelectionChange?.(session.nodeId, {
        segmentIds: [],
        vertexIds: [],
      });
      if (result.deleteNode) this.#options.callbacks.onVectorEditExit?.();
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
      const authoritative = serializeVectorNetwork(
        node.properties.network,
        node.properties.cornerRadius ?? 0,
        node.properties.cornerSmoothing ?? 0,
      );
      if (authoritative.ok)
        session.pathElement.set({ path: authoritative.path });
    }
    session.overlayGroup.remove();
    session.overlayGroup.destroy();
  }

  cancel(): void {
    this.#vectorGeometrySnap.finish();
    this.#vectorAnchorMeasurements.sync(null);
    this.#vectorEraserOverlay.clear();
    this.#vectorShapeBuilderOverlay.clear();
    this.#cancelVectorLasso();
    for (const session of [...this.#vectorEdits.values()]) {
      this.#cancelVectorEditSession(session);
    }
    this.#activeVectorEditNodeId = null;
    this.#renderVectorSelectionOverlay();
  }

  handleWindowBlur(): void {
    this.#vectorAnchorMeasurements.handleWindowBlur();
    const eraser = [...this.#vectorEdits.values()].find(
      (session) => session.drag?.kind === "eraser",
    );
    if (eraser) this.#cancelVectorEditDrag(eraser);
    const shapeBuilder = [...this.#vectorEdits.values()].find(
      (session) => session.drag?.kind === "shape-builder",
    );
    if (shapeBuilder) this.#cancelVectorEditDrag(shapeBuilder);
    this.#clearVectorPenTargets();
  }

  pointerLeave(): void {
    this.#vectorAnchorMeasurements.pointerLeave();
    this.#clearVectorPenTargets();
  }

  #beginVectorGeometrySnap(moving: readonly VectorSnapSelection[]): void {
    const input = this.#input;
    if (!input) return;
    this.#vectorGeometrySnap.begin({
      layers: this.#vectorSnapLayers(input.document.nodesById),
      moving,
      settings: input.snapSettings ?? {
        geometry: false,
        objects: false,
        pixelGrid: false,
      },
      viewport: input.viewport,
    });
  }

  #beginVectorHandleSnap(moving: VectorSnapHandleSelection): void {
    const input = this.#input;
    if (!input) return;
    this.#vectorGeometrySnap.beginHandle({
      layers: this.#vectorSnapLayers(input.document.nodesById),
      moving,
      settings: input.snapSettings ?? {
        geometry: false,
        objects: false,
        pixelGrid: false,
      },
      viewport: input.viewport,
    });
  }

  #vectorSnapLayers(
    nodesById: Readonly<Record<string, DesignNode>>,
  ): VectorSnapLayer[] {
    return [...this.#vectorEdits.values()].flatMap((session) => {
      const worldTransform = getVisibleWorldTransform(
        nodesById,
        session.nodeId,
      );
      return worldTransform
        ? [
            {
              network: session.network,
              nodeId: session.nodeId,
              visibleHandleVertexIds: session.selectedVertexIds,
              worldTransform,
            },
          ]
        : [];
    });
  }

  #selectedVectorAnchor(): VectorAnchorMeasurementReference | null {
    return this.#selectedVectorAnchorSource()?.reference ?? null;
  }

  #appendMeasuredVectorPoint(
    pointer: ReturnType<typeof asLeaferEvent>,
    session: VectorEditSession,
    control: VectorEditControl | undefined,
  ): boolean {
    const source = this.#selectedVectorAnchorSource();
    if (
      !pointer.altKey ||
      pointer.metaKey ||
      pointer.ctrlKey ||
      pointer.shiftKey ||
      session.tool !== "move" ||
      session.readOnly ||
      source?.session !== session ||
      (control && control.kind !== "path" && control.kind !== "region")
    ) {
      return false;
    }
    const result = appendVectorPoint(
      session.network,
      source.vertexId,
      pointer.getInnerPoint(session.pathElement),
    );
    if (!result.ok) {
      if (result.code !== "no-op") {
        this.#options.report(new Error(result.message));
      }
      return true;
    }
    if (this.#submitVectorEdit(session, result.network)) {
      this.#setVectorSelection(session, [], [result.vertexId]);
    }
    return true;
  }

  #beginVectorPenPoint(
    pointer: ReturnType<typeof asLeaferEvent>,
    session: VectorEditSession,
    control: VectorEditControl | undefined,
    target: LeaferElement | undefined,
  ): void {
    if (session.readOnly) return;
    if (control?.kind === "vertex") {
      if (session.penContour) {
        this.#finishVectorPenContourAtVertex(session, control.vertexId);
      } else {
        this.#finishVectorPenAtVertex(session, control.vertexId);
      }
      return;
    }
    const rawLocal = pointer.getInnerPoint(session.pathElement);
    if (session.penContour) {
      const local = pointer.shiftKey
        ? constrainPointToOctant(session.penContour.start.point, rawLocal)
        : rawLocal;
      this.#continueVectorPenContour(pointer, session, local);
      return;
    }
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.abs(this.#input?.viewport.zoom ?? 1),
    );
    const hit =
      target === session.cutHitPath
        ? nearestVectorSegmentPoint(session.network, rawLocal)
        : null;
    const sourceVertexId =
      session.selectedVertexIds.length === 1
        ? session.selectedVertexIds[0]
        : undefined;
    const result =
      hit && hit.distance <= 8 / zoom
        ? beginVectorPenInsert(session.network, hit)
        : sourceVertexId
          ? beginVectorPenAppend(
              session.network,
              sourceVertexId,
              pointer.shiftKey
                ? constrainPointToOctant(
                    session.network.vertices.find(
                      ({ id }) => id === sourceVertexId,
                    )!,
                    rawLocal,
                  )
                : rawLocal,
            )
          : null;
    if (!result) {
      this.#startVectorPenContour(pointer, session, rawLocal);
      return;
    }
    if (!result.ok) {
      if (result.code !== "no-op") {
        this.#options.report(new Error(result.message));
      }
      return;
    }
    this.#beginVectorPenEdit(pointer, session, result.edit);
  }

  #continueVectorPenContour(
    pointer: ReturnType<typeof asLeaferEvent>,
    session: VectorEditSession,
    local: Point,
  ): void {
    const pending = session.penContour!;
    const result = beginVectorPenContour(session.network, pending.start, local);
    if (!result.ok) {
      if (result.code !== "no-op") {
        this.#options.report(new Error(result.message));
      }
      return;
    }
    delete session.penContour;
    this.#beginVectorPenEdit(pointer, session, result.edit, pending);
  }

  #startVectorPenContour(
    pointer: ReturnType<typeof asLeaferEvent>,
    session: VectorEditSession,
    local: Point,
  ): void {
    const start = createVectorPenContourStart(local);
    session.penContour = { cursor: { ...local }, start };
    session.drag = {
      before: structuredClone(start),
      kind: "pen-start",
      moved: false,
      startClient: eventClientPoint(pointer),
    };
    this.#renderVectorEditOverlay(session);
  }

  #beginVectorPenEdit(
    pointer: ReturnType<typeof asLeaferEvent>,
    session: VectorEditSession,
    edit: VectorPenPointEdit,
    beforeContour?: VectorPenContourDraft,
  ): void {
    session.drag = {
      before: structuredClone(session.network),
      ...(beforeContour
        ? { beforeContour: structuredClone(beforeContour) }
        : {}),
      beforeSegmentIds: [...session.selectedSegmentIds],
      beforeVertexIds: [...session.selectedVertexIds],
      edit,
      failed: false,
      kind: "pen",
      moved: false,
      startClient: eventClientPoint(pointer),
    };
    session.network = edit.network;
    session.selectedSegmentIds = [];
    session.selectedVertexIds = [edit.vertexId];
    this.#renderVectorEditOverlay(session);
    this.#renderVectorSelectionOverlay();
  }

  #finishVectorPenAtVertex(
    session: VectorEditSession,
    targetVertexId: string,
  ): void {
    const sourceVertexId =
      session.selectedVertexIds.length === 1
        ? session.selectedVertexIds[0]
        : undefined;
    if (!sourceVertexId || sourceVertexId === targetVertexId) {
      this.#setVectorSelection(session, [], [targetVertexId]);
      return;
    }
    const result = connectVectorEndpoints(session.network, [
      sourceVertexId,
      targetVertexId,
    ]);
    if (!result.ok) {
      if (result.code !== "no-op")
        this.#options.report(new Error(result.message));
      return;
    }
    delete session.penTargetVertexId;
    if (this.#submitVectorEdit(session, result.network)) {
      session.network = result.network;
      this.#setVectorSelection(session, [], []);
    }
  }

  #finishVectorPenContourAtVertex(
    session: VectorEditSession,
    targetVertexId: string,
  ): void {
    const pending = session.penContour!;
    const result = finishVectorPenContourAtVertex(
      session.network,
      pending.start,
      targetVertexId,
    );
    if (!result.ok) {
      if (result.code !== "no-op") {
        this.#options.report(new Error(result.message));
      }
      return;
    }
    delete session.penContour;
    if (this.#submitVectorEdit(session, result.edit.network)) {
      this.#setVectorSelection(session, [], []);
    } else {
      session.penContour = pending;
      this.#renderVectorEditOverlay(session);
    }
  }

  #syncVectorPenTarget(pointer: ReturnType<typeof asLeaferEvent>): void {
    const control = isElement(pointer.target)
      ? this.#vectorEditControls.get(pointer.target)
      : undefined;
    for (const session of this.#vectorEdits.values()) {
      const selected = session.selectedVertexIds[0];
      const next =
        session.tool === "pen" &&
        !session.drag &&
        session.selectedVertexIds.length === 1 &&
        control?.kind === "vertex" &&
        control.nodeId === session.nodeId &&
        control.vertexId !== selected
          ? control.vertexId
          : undefined;
      if (next === session.penTargetVertexId) continue;
      if (next) session.penTargetVertexId = next;
      else delete session.penTargetVertexId;
      this.#renderVectorEditOverlay(session);
    }
  }

  #syncVectorPenContourCursor(pointer: ReturnType<typeof asLeaferEvent>): void {
    const session = this.#activeVectorEditSession();
    if (!session?.penContour || session.tool !== "pen" || session.readOnly) {
      return;
    }
    const rawLocal = pointer.getInnerPoint(session.pathElement);
    session.penContour.cursor = pointer.shiftKey
      ? constrainPointToOctant(session.penContour.start.point, rawLocal)
      : rawLocal;
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.abs(this.#input?.viewport.zoom ?? 1),
    );
    renderVectorPenContourOverlay(
      session.penContourOverlay,
      session.penContour,
      zoom,
      true,
    );
  }

  #clearVectorPenTargets(): void {
    for (const session of this.#vectorEdits.values()) {
      if (!session.penTargetVertexId) continue;
      delete session.penTargetVertexId;
      this.#renderVectorEditOverlay(session);
    }
  }

  #selectedVectorAnchorSource(): {
    reference: VectorAnchorMeasurementReference;
    session: VectorEditSession;
    vertexId: string;
  } | null {
    const selected = [...this.#vectorEdits.values()].flatMap((session) =>
      session.selectedVertexIds.flatMap((vertexId) => {
        const reference = this.#vectorAnchorReference(session.nodeId, vertexId);
        return reference ? [{ reference, session, vertexId }] : [];
      }),
    );
    return selected.length === 1 ? selected[0]! : null;
  }

  #prospectiveVectorAnchor(
    pointer: ReturnType<typeof asLeaferEvent>,
  ): VectorAnchorMeasurementReference | null {
    const source = this.#selectedVectorAnchorSource();
    if (
      !source ||
      source.session.readOnly ||
      source.session.tool !== "move" ||
      source.session.drag
    ) {
      return null;
    }
    const control = isElement(pointer.target)
      ? this.#vectorEditControls.get(pointer.target)
      : undefined;
    if (control && control.kind !== "path" && control.kind !== "region") {
      return null;
    }
    const position = pointer.getInnerPoint(this.#options.root);
    return Number.isFinite(position.x) && Number.isFinite(position.y)
      ? {
          id: `${source.session.nodeId}:prospective-anchor`,
          position,
        }
      : null;
  }

  #hoveredVectorAnchor(
    target: unknown,
  ): VectorAnchorMeasurementReference | null {
    if (!isElement(target)) return null;
    const control = this.#vectorEditControls.get(target);
    return control?.kind === "vertex"
      ? this.#vectorAnchorReference(control.nodeId, control.vertexId)
      : null;
  }

  #vectorAnchorReference(
    nodeId: string,
    vertexId: string,
  ): VectorAnchorMeasurementReference | null {
    const session = this.#vectorEdits.get(nodeId);
    const document = this.#input?.document;
    const vertex = session?.network.vertices.find(({ id }) => id === vertexId);
    const world = document
      ? getVisibleWorldTransform(document.nodesById, nodeId)
      : null;
    return vertex && world
      ? {
          id: `${nodeId}:${vertexId}`,
          position: transformPoint(vertex, world),
        }
      : null;
  }

  #vectorCornerAppearance(nodeId: string): {
    radius: number;
    smoothing: number;
  } {
    const node = this.#input?.document.nodesById[nodeId];
    return node &&
      (node.kind === "path" || node.kind === "vector") &&
      "network" in node.properties
      ? {
          radius: node.properties.cornerRadius ?? 0,
          smoothing: node.properties.cornerSmoothing ?? 0,
        }
      : { radius: 0, smoothing: 0 };
  }
}

function translationTransform(delta: Point): Transform {
  return [1, 0, 0, 1, delta.x, delta.y];
}

function isLockedSpec(spec: { data: { data?: unknown } } | undefined): boolean {
  const metadata = spec?.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignLocked === true
  );
}

function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function toggleStringSelection(
  current: readonly string[],
  toggled: readonly string[],
): string[] {
  const result = new Set(current);
  for (const id of toggled) {
    if (result.has(id)) result.delete(id);
    else result.add(id);
  }
  return [...result];
}

function pointDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isKeyboardInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isElement(value: unknown): value is LeaferElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "set" in value &&
    typeof (value as { set?: unknown }).set === "function"
  );
}

function stopKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}
