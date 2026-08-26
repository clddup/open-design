import { SVG_MAX_CHARACTERS } from "@opendesign/import-export-service/limits";
import {
  RASTER_EXPORT_MAX_DIMENSION,
  RASTER_EXPORT_MAX_ENCODED_BYTES,
  rasterExportMimeType,
  type RasterExportFormat,
  type RasterExportMimeType,
} from "@opendesign/import-export-service/raster";
import { Type } from "@sinclair/typebox";
import { defineContract, type ValidationIssue } from "./contract-validation";
import {
  isPortableFileName,
  PortableFileNameSchema,
} from "./portable-file-name";

const DesignFileContentsSchema = Type.String({
  minLength: 1,
  maxLength: 64 * 1024 * 1024,
});
const SvgContentsSchema = Type.String({
  minLength: 1,
  maxLength: SVG_MAX_CHARACTERS,
});
const RasterDimensionSchema = Type.Integer({
  minimum: 1,
  maximum: RASTER_EXPORT_MAX_DIMENSION,
});
const RasterFileProperties = {
  suggestedName: PortableFileNameSchema,
  bytes: Type.Uint8Array({
    minByteLength: 1,
    maxByteLength: RASTER_EXPORT_MAX_ENCODED_BYTES,
  }),
  width: RasterDimensionSchema,
  height: RasterDimensionSchema,
};

export const OpenDesignFileSchema = Type.Object(
  {
    name: PortableFileNameSchema,
    contents: DesignFileContentsSchema,
  },
  { additionalProperties: false },
);

export const SaveDesignFileRequestSchema = Type.Object(
  {
    suggestedName: PortableFileNameSchema,
    contents: DesignFileContentsSchema,
    saveAs: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const SaveDesignFileResultSchema = Type.Object(
  { name: PortableFileNameSchema },
  { additionalProperties: false },
);

export const OpenSvgFileSchema = Type.Object(
  {
    name: PortableFileNameSchema,
    contents: SvgContentsSchema,
  },
  { additionalProperties: false },
);

export const SaveSvgFileRequestSchema = Type.Object(
  {
    suggestedName: PortableFileNameSchema,
    contents: SvgContentsSchema,
  },
  { additionalProperties: false },
);

export const SaveSvgFileResultSchema = Type.Object(
  { name: PortableFileNameSchema },
  { additionalProperties: false },
);

export const SaveRasterFileRequestSchema = Type.Object(
  {
    ...RasterFileProperties,
    format: Type.Union([
      Type.Literal("png"),
      Type.Literal("jpeg"),
      Type.Literal("webp"),
    ]),
    mimeType: Type.Union([
      Type.Literal("image/png"),
      Type.Literal("image/jpeg"),
      Type.Literal("image/webp"),
    ]),
  },
  { additionalProperties: false },
);

export const SaveRasterFileResultSchema = Type.Object(
  {
    name: PortableFileNameSchema,
    byteSize: Type.Integer({
      minimum: 1,
      maximum: RASTER_EXPORT_MAX_ENCODED_BYTES,
    }),
  },
  { additionalProperties: false },
);

export type OpenDesignFile = {
  name: string;
  contents: string;
};

export type SaveDesignFileRequest = {
  suggestedName: string;
  contents: string;
  saveAs?: boolean;
};

export type SaveDesignFileResult = { name: string };

export type OpenSvgFile = {
  name: string;
  contents: string;
};

export type SaveSvgFileRequest = {
  suggestedName: string;
  contents: string;
};

export type SaveSvgFileResult = { name: string };

export type SaveRasterFileRequest = {
  suggestedName: string;
  format: RasterExportFormat;
  mimeType: RasterExportMimeType;
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type SaveRasterFileResult = {
  name: string;
  byteSize: number;
};

export const OpenDesignFileContract = defineContract<OpenDesignFile>({
  schema: OpenDesignFileSchema,
  code: "open_design_file.schema_invalid",
  subject: "opened Design File",
  clone: false,
  refine: (value) => portableNameIssues(value.name, "/name"),
});

export const SaveDesignFileRequestContract =
  defineContract<SaveDesignFileRequest>({
    schema: SaveDesignFileRequestSchema,
    code: "save_design_file_request.schema_invalid",
    subject: "Save Design File request",
    clone: false,
    refine: (value) =>
      portableNameIssues(value.suggestedName, "/suggestedName"),
  });

export const SaveDesignFileResultContract =
  defineContract<SaveDesignFileResult>({
    schema: SaveDesignFileResultSchema,
    code: "save_design_file_result.schema_invalid",
    subject: "Save Design File result",
    clone: false,
    refine: (value) => portableNameIssues(value.name, "/name"),
  });

export const OpenSvgFileContract = defineContract<OpenSvgFile>({
  schema: OpenSvgFileSchema,
  code: "open_svg_file.schema_invalid",
  subject: "opened SVG file",
  clone: false,
  refine: (value) => svgNameIssues(value.name, "/name"),
});

export const SaveSvgFileRequestContract = defineContract<SaveSvgFileRequest>({
  schema: SaveSvgFileRequestSchema,
  code: "save_svg_file_request.schema_invalid",
  subject: "Save SVG file request",
  clone: false,
  refine: (value) => portableNameIssues(value.suggestedName, "/suggestedName"),
});

export const SaveSvgFileResultContract = defineContract<SaveSvgFileResult>({
  schema: SaveSvgFileResultSchema,
  code: "save_svg_file_result.schema_invalid",
  subject: "Save SVG file result",
  clone: false,
  refine: (value) => svgNameIssues(value.name, "/name"),
});

export const SaveRasterFileRequestContract =
  defineContract<SaveRasterFileRequest>({
    schema: SaveRasterFileRequestSchema,
    code: "save_raster_file_request.schema_invalid",
    subject: "Save raster file request",
    clone: false,
    refine: (value) => [
      ...portableNameIssues(value.suggestedName, "/suggestedName"),
      ...(value.mimeType === rasterExportMimeType(value.format)
        ? []
        : [
            issue(
              "save_raster_file_request.mime_type_mismatch",
              "/mimeType",
              "Raster MIME type must match the selected format",
            ),
          ]),
    ],
  });

export const SaveRasterFileResultContract =
  defineContract<SaveRasterFileResult>({
    schema: SaveRasterFileResultSchema,
    code: "save_raster_file_result.schema_invalid",
    subject: "Save raster file result",
    clone: false,
    refine: (value) => portableNameIssues(value.name, "/name"),
  });

export function isOpenDesignFile(value: unknown): value is OpenDesignFile {
  return OpenDesignFileContract.parse(value).ok;
}

export function isSaveDesignFileRequest(
  value: unknown,
): value is SaveDesignFileRequest {
  return SaveDesignFileRequestContract.parse(value).ok;
}

export function isSaveDesignFileResult(
  value: unknown,
): value is SaveDesignFileResult {
  return SaveDesignFileResultContract.parse(value).ok;
}

export function isOpenSvgFile(value: unknown): value is OpenSvgFile {
  return OpenSvgFileContract.parse(value).ok;
}

export function isSaveSvgFileRequest(
  value: unknown,
): value is SaveSvgFileRequest {
  return SaveSvgFileRequestContract.parse(value).ok;
}

export function isSaveSvgFileResult(
  value: unknown,
): value is SaveSvgFileResult {
  return SaveSvgFileResultContract.parse(value).ok;
}

export function isSaveRasterFileRequest(
  value: unknown,
): value is SaveRasterFileRequest {
  return SaveRasterFileRequestContract.parse(value).ok;
}

export function isSaveRasterFileResult(
  value: unknown,
): value is SaveRasterFileResult {
  return SaveRasterFileResultContract.parse(value).ok;
}

function svgNameIssues(name: string, path: string): ValidationIssue[] {
  const issues = portableNameIssues(name, path);
  if (issues.length > 0) return issues;
  return name.toLowerCase().endsWith(".svg")
    ? []
    : [
        issue(
          "native_file.svg_extension_invalid",
          path,
          "SVG file name must end with .svg",
        ),
      ];
}

function portableNameIssues(name: string, path: string): ValidationIssue[] {
  return isPortableFileName(name)
    ? []
    : [
        issue(
          "native_file.name_invalid",
          path,
          "File name is not portable across macOS and Windows",
        ),
      ];
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery: "Choose a path-free portable file name and retry.",
  };
}
