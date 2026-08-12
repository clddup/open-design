import type { SvgInterchangeIssue } from "@opendesign/import-export-service";
import type {
  RasterExportBackground,
  RasterExportFormat,
  RasterExportResampling,
  RasterExportSize,
} from "@opendesign/import-export-service/raster";

export type ExportFormat = "svg" | RasterExportFormat;

export interface RasterExportSettings {
  format: RasterExportFormat;
  size: RasterExportSize;
  background: RasterExportBackground;
  quality: number;
  resampling: RasterExportResampling;
}

export interface SvgOperationStatus {
  kind: "import" | "export" | "raster-export";
  name: string;
}

export interface SvgInterchangeFeedback {
  kind: "import" | "export";
  name: string;
  issues: readonly SvgInterchangeIssue[];
}

export interface RasterExportFeedback {
  name: string;
  format: RasterExportFormat;
  width: number;
  height: number;
  byteSize: number;
}
