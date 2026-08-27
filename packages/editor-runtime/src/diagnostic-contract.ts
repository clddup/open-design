import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { Type, type Static, type TLiteral } from "@sinclair/typebox";

export const DESIGN_DIAGNOSTIC_REPORT_VERSION = 1 as const;
export const DESIGN_DIAGNOSTIC_CODES = [
  "empty-path",
  "empty-text",
  "fragmented-root",
  "invisible-node",
  "missing-asset",
  "no-visible-paint",
  "non-finite-bounds",
  "outside-clipping-bounds",
  "unsupported-image-source",
] as const;

export type DesignDiagnosticSeverity = "error" | "warning";
export type DesignDiagnosticCode = (typeof DESIGN_DIAGNOSTIC_CODES)[number];

const DiagnosticIdSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const DiagnosticCountSchema = Type.Integer({
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
});
const DesignDiagnosticCodeSchema = Type.Union(
  DESIGN_DIAGNOSTIC_CODES.map((code) => Type.Literal(code)) as [
    TLiteral<DesignDiagnosticCode>,
    ...TLiteral<DesignDiagnosticCode>[],
  ],
);

export const DesignDiagnosticSchema = Type.Object(
  {
    code: DesignDiagnosticCodeSchema,
    message: Type.String({ minLength: 1, maxLength: 10_000 }),
    nodeId: Type.Optional(DiagnosticIdSchema),
    pageId: DiagnosticIdSchema,
    relatedNodeIds: Type.Optional(
      Type.Array(DiagnosticIdSchema, { maxItems: 32, uniqueItems: true }),
    ),
    severity: Type.Union([Type.Literal("error"), Type.Literal("warning")]),
  },
  { additionalProperties: false },
);

export const DesignFeatureSummarySchema = Type.Object(
  {
    blends: DiagnosticCountSchema,
    blurs: DiagnosticCountSchema,
    glows: DiagnosticCountSchema,
    gradients: DiagnosticCountSchema,
    images: DiagnosticCountSchema,
    masks: DiagnosticCountSchema,
    paths: DiagnosticCountSchema,
    text: DiagnosticCountSchema,
  },
  { additionalProperties: false },
);

export const DesignDiagnosticReportSchema = Type.Object(
  {
    version: Type.Literal(DESIGN_DIAGNOSTIC_REPORT_VERSION),
    documentId: DiagnosticIdSchema,
    revision: Type.Integer({ minimum: 0 }),
    pageIds: Type.Array(DiagnosticIdSchema, {
      maxItems: 10_000,
      uniqueItems: true,
    }),
    checkedNodeCount: DiagnosticCountSchema,
    errorCount: DiagnosticCountSchema,
    warningCount: DiagnosticCountSchema,
    features: DesignFeatureSummarySchema,
    items: Type.Array(DesignDiagnosticSchema, { maxItems: 500_000 }),
  },
  { additionalProperties: false },
);

export type DesignDiagnostic = Static<typeof DesignDiagnosticSchema>;
export type DesignFeatureSummary = Static<typeof DesignFeatureSummarySchema>;
export type DesignDiagnosticReport = Static<
  typeof DesignDiagnosticReportSchema
>;

export const DesignDiagnosticReportContract =
  defineContract<DesignDiagnosticReport>({
    schema: DesignDiagnosticReportSchema,
    code: "design_diagnostic_report.schema_invalid",
    subject: "design diagnostic report",
    clone: false,
    refine: diagnosticReportIssues,
  });

function diagnosticReportIssues(
  report: DesignDiagnosticReport,
): ValidationIssue[] {
  const errorCount = report.items.filter(
    (item) => item.severity === "error",
  ).length;
  const warningCount = report.items.length - errorCount;
  const issues: ValidationIssue[] = [];
  if (report.errorCount !== errorCount) {
    issues.push(countIssue("errorCount", errorCount, report.errorCount));
  }
  if (report.warningCount !== warningCount) {
    issues.push(countIssue("warningCount", warningCount, report.warningCount));
  }
  const pageIds = new Set(report.pageIds);
  const invalidPageIndex = report.items.findIndex(
    (item) => !pageIds.has(item.pageId),
  );
  const invalidPageId = report.items[invalidPageIndex]?.pageId;
  if (invalidPageId !== undefined) {
    issues.push({
      code: "design_diagnostic_report.page_scope_invalid",
      path: `/items/${invalidPageIndex}/pageId`,
      message: "Diagnostic item Page must be included in report pageIds",
      actual: invalidPageId,
      recovery: "Regenerate diagnostics for the exact inspected Page scope.",
    });
  }
  return issues;
}

function countIssue(
  field: "errorCount" | "warningCount",
  expected: number,
  actual: number,
): ValidationIssue {
  return {
    code: "design_diagnostic_report.count_mismatch",
    path: `/${field}`,
    message: `${field} must match item severities`,
    expected,
    actual,
    recovery: "Recompute diagnostic counts from the returned items.",
  };
}
