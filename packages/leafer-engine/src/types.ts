import type {
  ComponentSelectionTarget,
  DesignChangeSet,
  DesignDocument,
  DesignOperation,
  ImagePlacement,
  Point,
  SelectionState,
  TextParagraphStyle,
  TextRunStyle,
  Transform,
  VectorNetwork,
  VectorPointMode,
  ViewportState,
} from "@opendesign/design-contracts";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import type { VectorCutLocation } from "@opendesign/geometry-service/vector-edit";
import type {
  RasterExportMimeType,
  RasterExportRequest,
} from "@opendesign/import-export-service/raster";
import type {
  TextLayoutProvider,
  TextRunLayoutProvider,
} from "@opendesign/text-service";
import type { LeaferTextRunStyle } from "./text-run-layout.js";
import type { LeaferTextRunProjectionResolution } from "./text-run-projection.js";

export type LeaferCanvasTool =
  | "select"
  | "frame"
  | "slice"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "polygon"
  | "star"
  | "pen"
  | "text";

export type LeaferBoxCreateTool = Exclude<LeaferCanvasTool, "select" | "pen">;

export type LeaferOperationKind =
  | "move"
  | "resize"
  | "rotate"
  | "skew"
  | "transform"
  | "text"
  | "vector"
  | "image";

export interface LeaferOperationRequest {
  kind: LeaferOperationKind;
  operations: DesignOperation[];
  selectionNodeIds?: string[];
}

export interface LeaferCreateRequest {
  dragged: boolean;
  end?: { x: number; y: number };
  height: number;
  pageId: string;
  parentId: string | null;
  start?: { x: number; y: number };
  tool: LeaferBoxCreateTool;
  width: number;
  x: number;
  y: number;
}

export interface LeaferCreateVectorRequest {
  closed: boolean;
  height: number;
  network: VectorNetwork;
  pageId: string;
  parentId: string | null;
  width: number;
  x: number;
  y: number;
}

export type LeaferVectorEditRequest =
  | { deleteNode: true; nodeId: string }
  | {
      deleteNode: false;
      edits: readonly { network: VectorNetwork; nodeId: string }[];
    };

export type LeaferVectorEditTool = "move" | "cut" | "lasso";

export interface LeaferImageCropCommitRequest {
  nodeId: string;
  placement: Extract<ImagePlacement, { mode: "crop" }>;
}

export interface LeaferImageCropState {
  nodeId: string;
  placement: Extract<ImagePlacement, { mode: "crop" }>;
}

export interface LeaferGridTrackReorderRequest {
  axis: "rows" | "columns";
  frameId: string;
  fromIndices: readonly number[];
  insertionIndex: number;
}

export type LeaferAutoLayoutSpacingChange =
  | {
      kind: "padding";
      value: { bottom: number; left: number; right: number; top: number };
    }
  | { kind: "gap"; value: number }
  | { kind: "counter-gap"; value: number };

export interface LeaferAutoLayoutSpacingCommitRequest {
  change: LeaferAutoLayoutSpacingChange;
  expectedRevision: number;
  frameId: string;
}

export type LeaferAutoLayoutSpacingInputKind =
  | "padding-top"
  | "padding-right"
  | "padding-bottom"
  | "padding-left"
  | "gap"
  | "counter-gap";

export interface LeaferAutoLayoutSpacingInputRequest {
  clientPoint: Point;
  expectedRevision: number;
  frameId: string;
  kind: LeaferAutoLayoutSpacingInputKind;
  padding: { bottom: number; left: number; right: number; top: number };
  paddingScope: "single" | "opposite" | "all";
  value: number;
}

export interface LeaferVectorCutRequest {
  at: VectorCutLocation;
  nodeId: string;
  pathId: string;
}

export interface LeaferVectorLineCutRequest {
  end: Point;
  nodeIds: readonly string[];
  start: Point;
}

export type LeaferVectorCutResponse =
  | {
      ok: true;
      network: VectorNetwork;
      selectedVertexIds: readonly [string, string];
    }
  | { ok: false };

export type LeaferVectorLineCutResponse =
  | {
      ok: true;
      resultNodeIds: readonly string[];
    }
  | { ok: false };

export interface LeaferEngineCallbacks {
  onAutoLayoutSpacingCommit?(
    request: LeaferAutoLayoutSpacingCommitRequest,
  ): boolean;
  onAutoLayoutSpacingInputRequest?(
    request: LeaferAutoLayoutSpacingInputRequest,
  ): void;
  onCreate(request: LeaferCreateRequest): boolean;
  onCreateVector(request: LeaferCreateVectorRequest): boolean;
  onError(error: Error): void;
  onGridTrackReorder?(request: LeaferGridTrackReorderRequest): boolean;
  onImageCropCommit?(request: LeaferImageCropCommitRequest): boolean;
  onImageCropStateChange?(state: LeaferImageCropState | null): void;
  onOperations(request: LeaferOperationRequest): boolean;
  onSelectionChange(
    nodeIds: string[],
    anchorNodeId?: string,
    componentTarget?: ComponentSelectionTarget,
  ): void;
  onTextRangeSelectionChange?(selection: LeaferTextRangeSelection | null): void;
  onVectorCut?(request: LeaferVectorCutRequest): LeaferVectorCutResponse;
  onVectorLineCut?(
    request: LeaferVectorLineCutRequest,
  ): LeaferVectorLineCutResponse;
  onVectorEdit?(request: LeaferVectorEditRequest): boolean;
  onVectorEditActiveNodeChange?(nodeId: string): void;
  onVectorEditScopeChange?(request: {
    mode: "add" | "toggle";
    nodeId: string;
  }): void;
  onVectorEditExit?(): void;
  onVectorEditSelectionChange?(
    nodeId: string,
    selection: {
      segmentIds: readonly string[];
      vertexIds: readonly string[];
    },
  ): void;
  onViewportChange(viewport: ViewportState): void;
  onWarning?(warning: LeaferFidelityWarning): void;
  onWarningsChange?(warnings: readonly LeaferFidelityWarning[]): void;
}

export interface LeaferTextRangeSelection {
  documentId: string;
  editing?: {
    characterMixedFields: readonly (keyof TextRunStyle)[];
    characterStyle: TextRunStyle;
    content: string;
    paragraphMixedFields: readonly (keyof TextParagraphStyle)[];
    paragraphStyle: TextParagraphStyle;
  };
  nodeId: string;
  revision: number;
  start: number;
  end: number;
}

export type LeaferTextStyleUpdate = Extract<
  DesignOperation,
  { type: "update_text_range_style" }
>["style"];

export interface LeaferBooleanEditScope {
  booleanId: string;
  readOnly: boolean;
  selectedOperandIds: readonly string[];
}

export interface LeaferVectorEditScope {
  activeNodeId: string;
  nodes: readonly {
    nodeId: string;
    readOnly: boolean;
    selectedSegmentIds: readonly string[];
    selectedVertexIds: readonly string[];
  }[];
  tool: LeaferVectorEditTool;
}

export interface LeaferGenerationReveal {
  focusPoints?: Readonly<Record<string, Point>>;
  id: string;
  nodeIds: readonly string[];
  startedAt: number;
  tweenNodeIds?: readonly string[];
}

export type LeaferGenerationActivityPhase =
  | "structuring"
  | "building"
  | "assets"
  | "reviewing"
  | "refining"
  | "recovering";

export interface LeaferGenerationActivity {
  id: string;
  label: string;
  phase: LeaferGenerationActivityPhase;
  progress?: number;
  target: Point;
}

export interface LeaferLayerHoverTarget {
  componentTarget?: ComponentSelectionTarget;
  nodeId: string;
}

export type LeaferCaptureTarget =
  | { kind: "page"; pageId: string }
  | { kind: "frame"; pageId: string; nodeId: string };

export interface LeaferCaptureResult {
  bytes: Uint8Array;
  height: number;
  mimeType: "image/jpeg";
  width: number;
}

export interface LeaferRasterExportResult {
  bytes: Uint8Array;
  height: number;
  mimeType: RasterExportMimeType;
  width: number;
}

export type LeaferGenerationSkeletonRole =
  | "structure"
  | "content"
  | "typography"
  | "media"
  | "graphic"
  | "decoration"
  | "interaction"
  | "other";

export interface LeaferGenerationSkeletonRegion {
  height: number;
  id: string;
  name: string;
  role: LeaferGenerationSkeletonRole;
  width: number;
  x: number;
  y: number;
}

export interface LeaferGenerationSkeleton {
  artboard: {
    frameId: string;
    height: number;
    pending: boolean;
    transform: Transform;
    width: number;
  };
  id: string;
  regions: readonly LeaferGenerationSkeletonRegion[];
}

export interface LeaferEngineSyncInput {
  autoLayoutSpacingFrameId?: string;
  booleanEditScope?: LeaferBooleanEditScope;
  document: DesignDocument;
  changes?: DesignChangeSet;
  generationActivity?: LeaferGenerationActivity;
  generationReveal?: LeaferGenerationReveal;
  generationSkeleton?: LeaferGenerationSkeleton;
  gridEditorFrameId?: string;
  layerHoverTarget?: LeaferLayerHoverTarget;
  layoutGuideFrameId?: string;
  pageId: string;
  reducedMotion?: boolean;
  selection: SelectionState;
  textRunProjection?: LeaferTextRunProjectionResolution;
  tool: LeaferCanvasTool;
  vectorEditScope?: LeaferVectorEditScope;
  viewport: ViewportState;
}

export interface LeaferFidelityWarning {
  code:
    | "boolean-geometry-failed"
    | "boolean-geometry-pending"
    | "boolean-geometry-provider-failed"
    | "boolean-geometry-unsupported"
    | "component-resolution-failed"
    | "invalid-path"
    | "missing-image"
    | "rich-text-layout-failed"
    | "style-resolution-failed"
    | "variable-resolution-failed"
    | "unsupported-color-alpha"
    | "unsupported-node";
  message: string;
  nodeId: string;
}

export interface LeaferEngineOptions {
  loadVectorGeometryProvider?: () => Promise<VectorGeometryProvider>;
}

export interface LeaferEngineAdapter {
  cancelImageCrop(): boolean;
  capture(target: LeaferCaptureTarget): Promise<LeaferCaptureResult>;
  dispose(): void;
  exportRaster(request: RasterExportRequest): Promise<LeaferRasterExportResult>;
  finishGenerationPresentation(): void;
  finishImageCrop(): boolean;
  resetImageCrop(): boolean;
  retryBooleanGeometry(): boolean;
  setVectorPointMode(mode: VectorPointMode): boolean;
  startImageCrop(nodeId: string): boolean;
  sync(input: LeaferEngineSyncInput): void;
  updateImageCropZoom(zoom: number): boolean;
  updateTextEditingStyle(style: LeaferTextStyleUpdate): boolean;
  readonly textLayoutProvider: TextLayoutProvider;
  readonly textRunLayoutProvider: TextRunLayoutProvider<LeaferTextRunStyle>;
}
