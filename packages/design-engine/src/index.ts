import type {
  DesignCapabilities,
  DesignChangeSet,
  DesignDocument,
  DesignError,
  DesignTransaction,
  DesignTransactionResult,
  EditorEvent,
  ExportArtifact,
  Revision,
} from "@opendesign/design-contracts";

export interface DocumentSource {
  kind: "path" | "bytes" | "empty";
  value?: string | Uint8Array;
}

export interface DocumentHandle {
  documentId: string;
  revision: number;
  engine: {
    id: string;
    version: string;
    schemaProfile: string;
  };
}

export type DesignQuery =
  | {
      type: "read_document_outline";
      pageId?: string;
      rootNodeId?: string;
      depth: number;
      limit: number;
      cursor?: string;
    }
  | { type: "read_layout_snapshot"; nodeIds: string[] }
  | { type: "read_document" }
  | { type: "read_node"; nodeId: string }
  | { type: "read_assets"; assetIds?: string[] };

export interface DesignResult<T = unknown> {
  revision: number;
  value: T;
  nextCursor?: string;
}

export interface RenderRequest {
  nodeId?: string;
  scale: number;
  background: string;
}

export interface RenderArtifact {
  artifactId: string;
  mimeType: "image/png";
  width: number;
  height: number;
  path: string;
}

export interface ExportRequest {
  format: "native" | "png" | "svg" | "pdf" | "tokens";
  nodeIds?: string[];
  destination: string;
}

export interface SaveRequest {
  destination?: string;
  revision?: number;
}

export interface RestoreRequest {
  revision: number;
}

export type EngineEventListener = (event: EditorEvent) => void;

export interface DesignEngineAdapter {
  capabilities(): Promise<DesignCapabilities>;
  createDocument(document?: DesignDocument): Promise<DocumentHandle>;
  openDocument(source: DocumentSource): Promise<DocumentHandle>;
  inspect<T = unknown>(query: DesignQuery): Promise<DesignResult<T>>;
  preview(transaction: DesignTransaction): Promise<DesignTransactionResult>;
  apply(transaction: DesignTransaction): Promise<DesignTransactionResult>;
  undo(actorId: string): Promise<DesignTransactionResult>;
  redo(actorId: string): Promise<DesignTransactionResult>;
  render(request: RenderRequest): Promise<RenderArtifact>;
  export(request: ExportRequest): Promise<ExportArtifact>;
  save(request?: SaveRequest): Promise<Revision>;
  restore(request: RestoreRequest): Promise<Revision>;
  checkpoint(label?: string): Promise<Revision>;
  diff(from: Revision, to: Revision): Promise<DesignChangeSet>;
  subscribe(listener: EngineEventListener): () => void;
  closeDocument(): Promise<void>;
}

export type EngineOperationResult<T> =
  { ok: true; value: T } | { ok: false; error: DesignError };

export interface EngineCompatibilityProfile {
  engineId: string;
  repository: string;
  commit: string;
  dependencyCommits: Record<string, string>;
  schemaProfile: string;
  wasmArtifactHash?: string;
  toolCatalogHash?: string;
  verifiedCapabilities: string[];
}

export interface DocumentSnapshotStore {
  load(documentId: string, revision?: number): Promise<DesignDocument | null>;
  save(document: DesignDocument): Promise<void>;
}
