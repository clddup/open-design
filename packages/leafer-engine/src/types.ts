import type {
  DesignChangeSet,
  DesignDocument,
  DesignOperation,
  Point,
  SelectionState,
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
import type { TextLayoutProvider } from "@opendesign/text-service";

export type LeaferCanvasTool =
  | "select"
  | "frame"
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
  "move" | "resize" | "rotate" | "skew" | "transform" | "text" | "vector";

export interface LeaferOperationRequest {
  kind: LeaferOperationKind;
  operations: DesignOperation[];
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
  | { deleteNode: false; network: VectorNetwork; nodeId: string };

export type LeaferVectorEditTool = "move" | "cut";

export interface LeaferVectorCutRequest {
  at: VectorCutLocation;
  nodeId: string;
  pathId: string;
}

export type LeaferVectorCutResponse =
  | {
      ok: true;
      network: VectorNetwork;
      selectedVertexIds: readonly [string, string];
    }
  | { ok: false };

export interface LeaferEngineCallbacks {
  onCreate(request: LeaferCreateRequest): boolean;
  onCreateVector(request: LeaferCreateVectorRequest): boolean;
  onError(error: Error): void;
  onOperations(request: LeaferOperationRequest): boolean;
  onSelectionChange(nodeIds: string[], anchorNodeId?: string): void;
  onVectorCut?(request: LeaferVectorCutRequest): LeaferVectorCutResponse;
  onVectorEdit?(request: LeaferVectorEditRequest): boolean;
  onVectorEditExit?(): void;
  onVectorEditSelectionChange?(vertexIds: readonly string[]): void;
  onViewportChange(viewport: ViewportState): void;
  onWarning?(warning: LeaferFidelityWarning): void;
  onWarningsChange?(warnings: readonly LeaferFidelityWarning[]): void;
}

export interface LeaferBooleanEditScope {
  booleanId: string;
  readOnly: boolean;
  selectedOperandIds: readonly string[];
}

export interface LeaferVectorEditScope {
  nodeId: string;
  readOnly: boolean;
  selectedVertexIds: readonly string[];
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
  booleanEditScope?: LeaferBooleanEditScope;
  document: DesignDocument;
  changes?: DesignChangeSet;
  generationActivity?: LeaferGenerationActivity;
  generationReveal?: LeaferGenerationReveal;
  generationSkeleton?: LeaferGenerationSkeleton;
  pageId: string;
  reducedMotion?: boolean;
  selection: SelectionState;
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
    | "invalid-path"
    | "missing-image"
    | "unsupported-color-alpha"
    | "unsupported-node";
  message: string;
  nodeId: string;
}

export interface LeaferEngineOptions {
  loadVectorGeometryProvider?: () => Promise<VectorGeometryProvider>;
}

export interface LeaferEngineAdapter {
  capture(target: LeaferCaptureTarget): Promise<LeaferCaptureResult>;
  dispose(): void;
  exportRaster(request: RasterExportRequest): Promise<LeaferRasterExportResult>;
  finishGenerationPresentation(): void;
  retryBooleanGeometry(): boolean;
  setVectorPointMode(mode: VectorPointMode): boolean;
  sync(input: LeaferEngineSyncInput): void;
  readonly textLayoutProvider: TextLayoutProvider;
}
