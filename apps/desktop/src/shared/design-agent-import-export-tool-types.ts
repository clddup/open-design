import type { SvgInterchangeIssue } from "@opendesign/import-export-service/svg-issues";
import type {
  RasterExportBackground,
  RasterExportFormat,
  RasterExportMimeType,
  RasterExportResampling,
  RasterExportSize,
} from "@opendesign/import-export-service/raster";

export type ExportSvgToolInput = {
  pageId: string;
  rootNodeIds: string[];
  suggestedName: string;
  includeLayerIds?: boolean;
  padding?: number;
};

export type ExportRasterToolInput = {
  pageId: string;
  rootNodeId: string;
  suggestedName: string;
  format: RasterExportFormat;
  size: RasterExportSize;
  background: RasterExportBackground;
  quality?: number;
  resampling: RasterExportResampling;
};

export type PreparedAgentRasterExport = {
  kind: "raster-export-preparation";
  version: 1;
  suggestedName: string;
  format: RasterExportFormat;
  mimeType: RasterExportMimeType;
  bytes: Uint8Array;
  width: number;
  height: number;
  revision: number;
  rootNodeId: string;
};

export type ImportSvgToolInput = {
  attachmentId: string;
  pageId: string;
  parentId: string | null;
  index: number;
  x: number;
  y: number;
};

export type InternalImportSvgToolInput = ImportSvgToolInput & {
  name: string;
  svg: string;
  idPrefix: string;
};

export type AgentSvgImportResult = {
  kind: "svg-import-result";
  version: 1;
  ok: true;
  format: "svg";
  attachmentId: string;
  name: string;
  pageId: string;
  parentId: string | null;
  rootNodeId: string;
  importedNodeIds: string[];
  revision: number;
  atomic: true;
  issues: SvgInterchangeIssue[];
};

export type PreparedAgentSvgExport = {
  kind: "svg-export-preparation";
  version: 1;
  suggestedName: string;
  svg: string;
  revision: number;
  exportedNodeIds: string[];
  issues: SvgInterchangeIssue[];
};
