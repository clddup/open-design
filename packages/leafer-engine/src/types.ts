import type {
  DesignChangeSet,
  DesignDocument,
  DesignOperation,
  SelectionState,
  ViewportState,
} from "@opendesign/design-contracts";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";

export type LeaferCanvasTool =
  "select" | "frame" | "rectangle" | "ellipse" | "text";

export type LeaferOperationKind =
  "move" | "resize" | "rotate" | "skew" | "transform" | "text";

export interface LeaferOperationRequest {
  kind: LeaferOperationKind;
  operations: DesignOperation[];
}

export interface LeaferCreateRequest {
  dragged: boolean;
  height: number;
  pageId: string;
  parentId: string | null;
  tool: Exclude<LeaferCanvasTool, "select">;
  width: number;
  x: number;
  y: number;
}

export interface LeaferEngineCallbacks {
  onCreate(request: LeaferCreateRequest): boolean;
  onError(error: Error): void;
  onOperations(request: LeaferOperationRequest): boolean;
  onSelectionChange(nodeIds: string[], anchorNodeId?: string): void;
  onViewportChange(viewport: ViewportState): void;
  onWarning?(warning: LeaferFidelityWarning): void;
  onWarningsChange?(warnings: readonly LeaferFidelityWarning[]): void;
}

export interface LeaferBooleanEditScope {
  booleanId: string;
  readOnly: boolean;
  selectedOperandIds: readonly string[];
}

export interface LeaferEngineSyncInput {
  booleanEditScope?: LeaferBooleanEditScope;
  document: DesignDocument;
  changes?: DesignChangeSet;
  pageId: string;
  selection: SelectionState;
  tool: LeaferCanvasTool;
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
  sync(input: LeaferEngineSyncInput): void;
}
