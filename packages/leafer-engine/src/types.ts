import type {
  DesignChangeSet,
  DesignDocument,
  DesignOperation,
  SelectionState,
  VectorNetwork,
  VectorPointMode,
  ViewportState,
} from "@opendesign/design-contracts";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";

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

export interface LeaferEngineCallbacks {
  onCreate(request: LeaferCreateRequest): boolean;
  onCreateVector(request: LeaferCreateVectorRequest): boolean;
  onError(error: Error): void;
  onOperations(request: LeaferOperationRequest): boolean;
  onSelectionChange(nodeIds: string[], anchorNodeId?: string): void;
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
}

export interface LeaferEngineSyncInput {
  booleanEditScope?: LeaferBooleanEditScope;
  document: DesignDocument;
  changes?: DesignChangeSet;
  pageId: string;
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
  dispose(): void;
  retryBooleanGeometry(): boolean;
  setVectorPointMode(mode: VectorPointMode): boolean;
  sync(input: LeaferEngineSyncInput): void;
}
