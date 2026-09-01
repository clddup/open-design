import {
  DesignDocumentSchema,
  RectSchema,
  Type,
  type Static,
} from "@opendesign/design-contracts";
import {
  defineContract,
  selectDiscriminatedUnionSchema,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import {
  SVG_MAX_CHARACTERS,
  SuccessfulSvgImportResultSchema,
  SvgInterchangeIssueSchema,
} from "@opendesign/import-export-service";
import { MAX_SVG_EXPORT_PADDING } from "@opendesign/editor-runtime";

export const SVG_WORKER_PROTOCOL_VERSION = 1 as const;
const MAX_WORKER_NODE_IDS = 8_192;

const WorkerRequestIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9_-]+$",
});
const WorkerResourceIdSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const SvgWorkerExportSettingsSchema = Type.Object(
  {
    includeLayerIds: Type.Boolean(),
    padding: Type.Number({ minimum: 0, maximum: MAX_SVG_EXPORT_PADDING }),
  },
  { additionalProperties: false },
);

const SvgWorkerImportRequestSchema = Type.Object(
  {
    protocolVersion: Type.Literal(SVG_WORKER_PROTOCOL_VERSION),
    requestId: WorkerRequestIdSchema,
    operation: Type.Literal("import"),
    svg: Type.String({ minLength: 1, maxLength: SVG_MAX_CHARACTERS }),
    idPrefix: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
    }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false },
);
const SvgWorkerExportRequestSchema = Type.Object(
  {
    protocolVersion: Type.Literal(SVG_WORKER_PROTOCOL_VERSION),
    requestId: WorkerRequestIdSchema,
    operation: Type.Literal("export"),
    document: DesignDocumentSchema,
    pageId: WorkerResourceIdSchema,
    rootNodeIds: Type.Array(WorkerResourceIdSchema, {
      minItems: 1,
      maxItems: MAX_WORKER_NODE_IDS,
      uniqueItems: true,
    }),
    settings: SvgWorkerExportSettingsSchema,
  },
  { additionalProperties: false },
);
export const SvgWorkerRequestSchema = Type.Union([
  SvgWorkerImportRequestSchema,
  SvgWorkerExportRequestSchema,
]);
export type SvgWorkerRequest = Static<typeof SvgWorkerRequestSchema>;
export type SvgWorkerExportSettings = Static<
  typeof SvgWorkerExportSettingsSchema
>;
export type SuccessfulSvgImportResult = Static<
  typeof SuccessfulSvgImportResultSchema
>;

const SvgWorkerImportCompletedSchema = Type.Object(
  {
    protocolVersion: Type.Literal(SVG_WORKER_PROTOCOL_VERSION),
    requestId: WorkerRequestIdSchema,
    operation: Type.Literal("import"),
    type: Type.Literal("completed"),
    result: SuccessfulSvgImportResultSchema,
  },
  { additionalProperties: false },
);
const SvgWorkerExportCompletedSchema = Type.Object(
  {
    protocolVersion: Type.Literal(SVG_WORKER_PROTOCOL_VERSION),
    requestId: WorkerRequestIdSchema,
    operation: Type.Literal("export"),
    type: Type.Literal("completed"),
    result: Type.Object(
      {
        svg: Type.String({ minLength: 1, maxLength: SVG_MAX_CHARACTERS }),
        issues: Type.Array(SvgInterchangeIssueSchema, {
          maxItems: MAX_WORKER_NODE_IDS,
        }),
        exportedNodeIds: Type.Array(WorkerResourceIdSchema, {
          maxItems: MAX_WORKER_NODE_IDS,
          uniqueItems: true,
        }),
        revision: Type.Integer({ minimum: 0 }),
        sourceBounds: RectSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const SvgWorkerFailedSchema = Type.Object(
  {
    protocolVersion: Type.Literal(SVG_WORKER_PROTOCOL_VERSION),
    requestId: WorkerRequestIdSchema,
    operation: Type.Union([Type.Literal("import"), Type.Literal("export")]),
    type: Type.Literal("failed"),
    code: Type.String({ minLength: 1, maxLength: 256 }),
    message: Type.String({ minLength: 1, maxLength: 10_000 }),
    issues: Type.Optional(
      Type.Array(SvgInterchangeIssueSchema, {
        maxItems: MAX_WORKER_NODE_IDS,
      }),
    ),
  },
  { additionalProperties: false },
);
export const SvgWorkerResponseSchema = Type.Union([
  SvgWorkerImportCompletedSchema,
  SvgWorkerExportCompletedSchema,
  SvgWorkerFailedSchema,
]);
export type SvgWorkerResponse = Static<typeof SvgWorkerResponseSchema>;

export const SvgWorkerRequestContract = defineContract<SvgWorkerRequest>({
  schema: SvgWorkerRequestSchema,
  code: "svg_worker.request_structure_invalid",
  subject: "SVG worker request",
  selectSchema: (input) =>
    selectDiscriminatedUnionSchema(SvgWorkerRequestSchema, input, "operation"),
  clone: false,
});

export const SvgWorkerResponseContract = defineContract<SvgWorkerResponse>({
  schema: SvgWorkerResponseSchema,
  code: "svg_worker.response_structure_invalid",
  subject: "SVG worker response",
  refine: svgWorkerResponseDomainIssues,
  clone: false,
});

function svgWorkerResponseDomainIssues(
  response: SvgWorkerResponse,
): ValidationIssue[] {
  if (
    response.type !== "completed" ||
    response.operation !== "export" ||
    positiveRect(response.result.sourceBounds)
  ) {
    return [];
  }
  return [
    {
      code: "svg_worker.export_bounds_invalid",
      path: "/result/sourceBounds",
      message: "SVG worker export bounds must be finite and positive",
      recovery: "Recompute the frozen export bounds before returning.",
    },
  ];
}

function positiveRect(rect: Static<typeof RectSchema>): boolean {
  return rect.width > 0 && rect.height > 0;
}
