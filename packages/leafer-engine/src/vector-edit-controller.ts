import type {
  Point,
  Rect,
  Transform,
  VectorNetwork,
  VectorPointMode,
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
import type * as LeaferEditorModule from "leafer-editor";
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

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;
type LeaferGroup = InstanceType<LeaferModule["Group"]>;

type VectorEditControl =
  | { kind: "path"; nodeId: string }
  | { kind: "region"; nodeId: string; regionId: string }
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
    | "onVectorEdit"
    | "onVectorEditActiveNodeChange"
    | "onVectorEditExit"
    | "onVectorEditScopeChange"
    | "onVectorEditSelectionChange"
    | "onVectorLineCut"
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
  readonly #vectorEditControls = new WeakMap<
    LeaferElement,
    VectorEditControl
  >();
  readonly #vectorEdits = new Map<string, VectorEditSession>();
  readonly #vectorGeometrySnap: VectorGeometrySnapController;
  readonly #vectorSelectionOverlay: VectorSelectionOverlay;
  #activeVectorEditNodeId: string | null = null;
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
            (scope.tool !== "pen" || item.readOnly))
        ) {
          this.#cancelVectorEditDrag(session);
        }
        session.pathElement = pathElement;
        if (item.activePathId) session.activePathId = item.activePathId;
        else delete session.activePathId;
        session.readOnly = item.readOnly;
        session.topologyEditable = item.topologyEditable;
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
      cursor: tool === "bend" ? "pointer" : "crosshair",
      editable: false,
      fill: null,
      hittable:
        !readOnly && (tool === "bend" || tool === "cut" || tool === "pen"),
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
      tool,
      topologyEditable,
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
      cursor: session.tool === "bend" ? "pointer" : "crosshair",
      hittable:
        (session.tool === "cut" ||
          session.tool === "bend" ||
          session.tool === "pen") &&
        !session.readOnly,
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
        cursor: session.tool === "paint" ? "crosshair" : "pointer",
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
    session.anchorControls = [];
    session.handleControls = [];
    const selected = new Set(session.selectedVertexIds);
    for (const vertex of session.network.vertices) {
      const isSelected = selected.has(vertex.id);
      const isPenTarget = session.penTargetVertexId === vertex.id;
      const renderedAnchorSize = isPenTarget ? 11 / zoom : anchorSize;
      const anchor = new this.#options.leafer.Ellipse({
        cursor: session.readOnly
          ? "default"
          : session.tool === "cut" || session.tool === "pen"
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

  pointerDown(event: unknown): void {
    if (
      this.#options.current().disposed ||
      [...this.#vectorEdits.values()].some((session) => session.drag)
    ) {
      return;
    }
    const pointer = asLeaferEvent(event);
    if (pointer.isCancel || pointer.right || pointer.middle) return;
    this.#vectorAnchorMeasurements.clear();
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

    if (control.kind === "region") return;

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
    if (drag.kind === "pen-start") {
      const contour = session.penContour;
      if (!contour) return;
      const local = pointer.getInnerPoint(session.pathElement);
      contour.start = dragVectorPenContourStart(contour.start, local);
      contour.cursor = local;
      this.#renderVectorEditOverlay(session);
      return;
    }
    if (drag.kind === "pen") {
      const result = dragVectorPenPoint(
        drag.edit,
        pointer.getInnerPoint(session.pathElement),
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
    } else if (drag.kind !== "cut" && drag.kind !== "pen-start") {
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
    session.cutGuidePath.set({ path: "", visible: false });
  }

  #cancelVectorPenContour(session: VectorEditSession): void {
    if (session.drag?.kind === "pen-start") session.drag = null;
    delete session.penContour;
    this.#renderVectorEditOverlay(session);
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
      if (session) session.network = structuredClone(edit.network);
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
    this.#cancelVectorLasso();
    for (const session of [...this.#vectorEdits.values()]) {
      this.#cancelVectorEditSession(session);
    }
    this.#activeVectorEditNodeId = null;
    this.#renderVectorSelectionOverlay();
  }

  handleWindowBlur(): void {
    this.#vectorAnchorMeasurements.handleWindowBlur();
    this.#clearVectorPenTargets();
  }

  pointerLeave(): void {
    this.#vectorAnchorMeasurements.pointerLeave();
    this.#clearVectorPenTargets();
  }

  #beginVectorGeometrySnap(moving: readonly VectorSnapSelection[]): void {
    const input = this.#input;
    if (!input) return;
    const layers = [...this.#vectorEdits.values()].flatMap((session) => {
      const worldTransform = getVisibleWorldTransform(
        input.document.nodesById,
        session.nodeId,
      );
      return worldTransform
        ? [
            {
              network: session.network,
              nodeId: session.nodeId,
              worldTransform,
            },
          ]
        : [];
    });
    this.#vectorGeometrySnap.begin({
      layers,
      moving,
      settings: input.snapSettings ?? {
        geometry: false,
        objects: false,
        pixelGrid: false,
      },
      viewport: input.viewport,
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
    const local = pointer.getInnerPoint(session.pathElement);
    if (session.penContour) {
      this.#continueVectorPenContour(pointer, session, local);
      return;
    }
    const zoom = Math.max(
      MATRIX_EPSILON,
      Math.abs(this.#input?.viewport.zoom ?? 1),
    );
    const hit =
      target === session.cutHitPath
        ? nearestVectorSegmentPoint(session.network, local)
        : null;
    const sourceVertexId =
      session.selectedVertexIds.length === 1
        ? session.selectedVertexIds[0]
        : undefined;
    const result =
      hit && hit.distance <= 8 / zoom
        ? beginVectorPenInsert(session.network, hit)
        : sourceVertexId
          ? beginVectorPenAppend(session.network, sourceVertexId, local)
          : null;
    if (!result) {
      this.#startVectorPenContour(pointer, session, local);
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
    session.penContour.cursor = pointer.getInnerPoint(session.pathElement);
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
