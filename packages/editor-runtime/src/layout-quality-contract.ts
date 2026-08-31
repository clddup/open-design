import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import {
  ComponentSelectionTargetSchema,
  DesignTargetQualityProfileSchema,
  RectSchema,
} from "@opendesign/design-contracts";
import {
  MeasuredTextLayoutQualityMeasurementSchema,
  TextLayoutQualitySizeSchema,
} from "@opendesign/text-service";
import { Type, type Static } from "@sinclair/typebox";

export const DESIGN_LAYOUT_QUALITY_REPORT_VERSION = 7 as const;
export const MAX_DESIGN_LAYOUT_QUALITY_ISSUES = 128;

const QualityIdSchema = Type.String({ minLength: 1, maxLength: 512 });
const PointSchema = Type.Object(
  { x: Type.Number(), y: Type.Number() },
  { additionalProperties: false },
);

export const DesignLayoutQualityGeometrySchema = Type.Object(
  {
    coordinateSpace: Type.Literal("world"),
    constraint: Type.Union([
      Type.Literal("artboard"),
      Type.Literal("clipping-ancestor"),
      Type.Literal("safe-area"),
    ]),
    nodeBounds: RectSchema,
    artboardBounds: RectSchema,
    constraintBounds: RectSchema,
    parentId: Type.Union([Type.Null(), QualityIdSchema]),
    currentLocalPosition: PointSchema,
    recommendedLocalDelta: PointSchema,
    recommendedLocalPosition: PointSchema,
    requiresResize: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const DesignLayoutQualityMeasurementSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("minimum-interactive-size"),
      actualSize: TextLayoutQualitySizeSchema,
      requiredSize: TextLayoutQualitySizeSchema,
      source: QualityIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("text-layout"),
      ...MeasuredTextLayoutQualityMeasurementSchema.properties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("interaction-overlap"),
      intersectionArea: Type.Number({ minimum: 0 }),
      overlapRatio: Type.Number({ minimum: 0, maximum: 1 }),
      otherNodeId: QualityIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("interaction-occlusion"),
      coveredRatio: Type.Literal(1),
      occluderNodeId: QualityIdSchema,
      proof: Type.Literal("opaque-later-sibling"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("layout-spacing-outlier"),
      axis: Type.Union([Type.Literal("horizontal"), Type.Literal("vertical")]),
      actualGap: Type.Number(),
      expectedGap: Type.Number(),
      delta: Type.Number(),
      tolerance: Type.Number({ minimum: 0 }),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
      peerNodeIds: Type.Array(QualityIdSchema, {
        minItems: 4,
        maxItems: 8,
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("layout-alignment-outlier"),
      axis: Type.Union([Type.Literal("x"), Type.Literal("y")]),
      anchor: Type.Literal("start"),
      actualPosition: Type.Number(),
      expectedPosition: Type.Number(),
      delta: Type.Number(),
      tolerance: Type.Number({ minimum: 0 }),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
      peerNodeIds: Type.Array(QualityIdSchema, {
        minItems: 4,
        maxItems: 8,
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  ),
]);

export const DesignLayoutQualityCodeSchema = Type.Union([
  Type.Literal("artboard-clipping-disabled"),
  Type.Literal("artboard-geometry-unavailable"),
  Type.Literal("artboard-not-visible"),
  Type.Literal("component-instance-resolution-failed"),
  Type.Literal("component-node-clipped-by-ancestor"),
  Type.Literal("node-excessive-artboard-overflow"),
  Type.Literal("node-fully-outside-artboard"),
  Type.Literal("node-geometry-unavailable"),
  Type.Literal("node-outside-safe-area"),
  Type.Literal("node-partial-artboard-overflow"),
  Type.Literal("interactive-target-too-small"),
  Type.Literal("interactive-target-overlap"),
  Type.Literal("interactive-target-fully-occluded"),
  Type.Literal("interaction-geometry-unavailable"),
  Type.Literal("quality-node-missing"),
  Type.Literal("quality-node-not-visible"),
  Type.Literal("quality-profile-geometry-unavailable"),
  Type.Literal("repeated-layer-alignment-outlier"),
  Type.Literal("repeated-layer-spacing-outlier"),
  Type.Literal("quality-scan-truncated"),
  Type.Literal("text-content-clipped"),
  Type.Literal("text-content-overflow"),
  Type.Literal("text-ending-truncation-active"),
  Type.Literal("text-layout-evidence-unavailable"),
  Type.Literal("target-frame-invalid"),
]);

export const DesignLayoutQualityIssueSchema = Type.Object(
  {
    code: DesignLayoutQualityCodeSchema,
    message: Type.String({ minLength: 1, maxLength: 4_000 }),
    nodeId: QualityIdSchema,
    outsideRatio: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    geometry: Type.Optional(DesignLayoutQualityGeometrySchema),
    measurement: Type.Optional(DesignLayoutQualityMeasurementSchema),
    componentTarget: Type.Optional(ComponentSelectionTargetSchema),
    relatedNodeIds: Type.Array(QualityIdSchema, { maxItems: 8 }),
    severity: Type.Union([Type.Literal("error"), Type.Literal("warning")]),
  },
  { additionalProperties: false },
);

export const DesignLayoutQualityReportSchema = Type.Object(
  {
    version: Type.Literal(DESIGN_LAYOUT_QUALITY_REPORT_VERSION),
    documentId: QualityIdSchema,
    revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    pageId: QualityIdSchema,
    artboardFrameId: QualityIdSchema,
    checkedNodeCount: Type.Integer({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    checkedQualityNodeCount: Type.Integer({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    checkedTextNodeCount: Type.Integer({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    errorCount: Type.Integer({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    warningCount: Type.Integer({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    issues: Type.Array(DesignLayoutQualityIssueSchema, {
      maxItems: MAX_DESIGN_LAYOUT_QUALITY_ISSUES,
    }),
    qualityProfile: Type.Union([Type.Null(), DesignTargetQualityProfileSchema]),
  },
  { additionalProperties: false },
);

export type DesignLayoutQualitySeverity = Static<
  typeof DesignLayoutQualityIssueSchema
>["severity"];
export type DesignLayoutQualityCode = Static<
  typeof DesignLayoutQualityCodeSchema
>;
export type DesignLayoutQualityGeometry = Static<
  typeof DesignLayoutQualityGeometrySchema
>;
export type DesignLayoutQualityMeasurement = Static<
  typeof DesignLayoutQualityMeasurementSchema
>;
export type DesignLayoutQualityIssue = Static<
  typeof DesignLayoutQualityIssueSchema
>;
export type DesignLayoutQualityReport = Static<
  typeof DesignLayoutQualityReportSchema
>;

export const DesignLayoutQualityReportContract =
  defineContract<DesignLayoutQualityReport>({
    schema: DesignLayoutQualityReportSchema,
    code: "design.layout_quality_report_structure_invalid",
    subject: "design layout quality report",
    refine: layoutQualityReportDomainIssues,
    clone: false,
  });

function layoutQualityReportDomainIssues(
  report: DesignLayoutQualityReport,
): ValidationIssue[] {
  const actualErrorCount = report.issues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const actualWarningCount = report.issues.length - actualErrorCount;
  const issues: ValidationIssue[] = [];
  if (report.errorCount !== actualErrorCount) {
    issues.push({
      code: "design.layout_quality_report_error_count_mismatch",
      path: "/errorCount",
      message: "errorCount must equal the number of error issues",
      expected: actualErrorCount,
      actual: report.errorCount,
      recovery: "Set errorCount from the issue severities.",
    });
  }
  if (report.warningCount !== actualWarningCount) {
    issues.push({
      code: "design.layout_quality_report_warning_count_mismatch",
      path: "/warningCount",
      message: "warningCount must equal the number of warning issues",
      expected: actualWarningCount,
      actual: report.warningCount,
      recovery: "Set warningCount from the issue severities.",
    });
  }
  report.issues.forEach((issue, index) => {
    if (
      issue.code !== "repeated-layer-spacing-outlier" &&
      issue.code !== "repeated-layer-alignment-outlier"
    ) {
      return;
    }
    const expectedKind =
      issue.code === "repeated-layer-spacing-outlier"
        ? "layout-spacing-outlier"
        : "layout-alignment-outlier";
    if (report.qualityProfile?.kind !== "ui") {
      issues.push({
        code: "design.layout_quality_consistency_profile_invalid",
        path: "/qualityProfile",
        message:
          "Inferred repeated-layout findings are only valid for an explicit UI quality profile",
        expected: "ui",
        actual: report.qualityProfile?.kind ?? null,
        recovery:
          "Remove the inferred finding from graphic delivery or bind the exact UI quality profile selected by Main.",
      });
    }
    if (issue.severity !== "warning") {
      issues.push({
        code: "design.layout_quality_consistency_severity_invalid",
        path: `/issues/${index}/severity`,
        message: "Inferred layout consistency findings must remain warnings",
        expected: "warning",
        actual: issue.severity,
        recovery:
          "Keep inferred alignment and spacing findings advisory; only explicit geometry invariants may block delivery.",
      });
    }
    if (issue.measurement?.kind !== expectedKind) {
      issues.push({
        code: "design.layout_quality_consistency_measurement_invalid",
        path: `/issues/${index}/measurement`,
        message: `${issue.code} requires its matching structured measurement`,
        expected: expectedKind,
        actual: issue.measurement?.kind ?? null,
        recovery:
          "Attach the matching alignment or spacing measurement generated from the exact revision.",
      });
      return;
    }
    const expectedDelta =
      issue.measurement.kind === "layout-spacing-outlier"
        ? issue.measurement.expectedGap - issue.measurement.actualGap
        : issue.measurement.expectedPosition - issue.measurement.actualPosition;
    if (Math.abs(issue.measurement.delta - expectedDelta) > 1e-6) {
      issues.push({
        code: "design.layout_quality_consistency_delta_invalid",
        path: `/issues/${index}/measurement/delta`,
        message: "Layout consistency delta must match expected minus actual",
        expected: expectedDelta,
        actual: issue.measurement.delta,
        recovery: "Recompute the delta from the exact-revision measurement.",
      });
    }
  });
  return issues;
}
