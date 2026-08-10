import type { DesignDocument, Rect } from "@opendesign/design-contracts";
import type {
  SvgImportResult,
  SvgInterchangeIssue,
} from "@opendesign/import-export-service";

export const SVG_WORKER_PROTOCOL_VERSION = 1 as const;

export interface SvgWorkerExportSettings {
  includeLayerIds: boolean;
  padding: number;
}

export type SvgWorkerRequest =
  | {
      protocolVersion: typeof SVG_WORKER_PROTOCOL_VERSION;
      requestId: string;
      operation: "import";
      svg: string;
      idPrefix: string;
      name: string;
    }
  | {
      protocolVersion: typeof SVG_WORKER_PROTOCOL_VERSION;
      requestId: string;
      operation: "export";
      document: DesignDocument;
      pageId: string;
      rootNodeIds: string[];
      settings: SvgWorkerExportSettings;
    };

export type SuccessfulSvgImportResult = Extract<SvgImportResult, { ok: true }>;

export type SvgWorkerResponse =
  | {
      protocolVersion: typeof SVG_WORKER_PROTOCOL_VERSION;
      requestId: string;
      operation: "import";
      type: "completed";
      result: SuccessfulSvgImportResult;
    }
  | {
      protocolVersion: typeof SVG_WORKER_PROTOCOL_VERSION;
      requestId: string;
      operation: "export";
      type: "completed";
      result: {
        svg: string;
        issues: readonly SvgInterchangeIssue[];
        exportedNodeIds: readonly string[];
        revision: number;
        sourceBounds: Rect;
      };
    }
  | {
      protocolVersion: typeof SVG_WORKER_PROTOCOL_VERSION;
      requestId: string;
      operation: SvgWorkerRequest["operation"];
      type: "failed";
      code: string;
      message: string;
      issues?: readonly SvgInterchangeIssue[];
    };
