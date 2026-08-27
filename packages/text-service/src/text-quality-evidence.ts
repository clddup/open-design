import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { Type, type Static } from "@sinclair/typebox";

export const TEXT_LAYOUT_QUALITY_EVIDENCE_VERSION = 1 as const;
export const MAX_TEXT_LAYOUT_QUALITY_MEASUREMENTS = 4_096;

const QualityTextSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const QualityDimensionSchema = Type.Number({
  minimum: 0,
  maximum: 1_000_000,
});

export const TextLayoutQualityAxisSchema = Type.Object(
  {
    horizontal: Type.Boolean(),
    vertical: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const TextLayoutQualitySizeSchema = Type.Object(
  {
    width: QualityDimensionSchema,
    height: QualityDimensionSchema,
  },
  { additionalProperties: false },
);

export const MeasuredTextLayoutQualityMeasurementSchema = Type.Object(
  {
    status: Type.Literal("measured"),
    nodeId: QualityTextSchema,
    provider: QualityTextSchema,
    providerVersion: QualityTextSchema,
    boxSize: TextLayoutQualitySizeSchema,
    fullContentSize: TextLayoutQualitySizeSchema,
    displayedContentSize: TextLayoutQualitySizeSchema,
    overflow: TextLayoutQualityAxisSchema,
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const TextLayoutQualityMeasurementSchema = Type.Union([
  MeasuredTextLayoutQualityMeasurementSchema,
  Type.Object(
    {
      status: Type.Literal("unavailable"),
      nodeId: QualityTextSchema,
      message: Type.String({
        minLength: 1,
        maxLength: 4_000,
        pattern: "^[^\\u0000-\\u001F\\u007F]+$",
      }),
    },
    { additionalProperties: false },
  ),
]);

export const TextLayoutQualityEvidenceSchema = Type.Object(
  {
    version: Type.Literal(TEXT_LAYOUT_QUALITY_EVIDENCE_VERSION),
    documentId: QualityTextSchema,
    revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    pageId: QualityTextSchema,
    measurements: Type.Array(TextLayoutQualityMeasurementSchema, {
      maxItems: MAX_TEXT_LAYOUT_QUALITY_MEASUREMENTS,
    }),
  },
  { additionalProperties: false },
);

export type TextLayoutQualityAxis = Static<typeof TextLayoutQualityAxisSchema>;
export type TextLayoutQualitySize = Static<typeof TextLayoutQualitySizeSchema>;
export type TextLayoutQualityMeasurement = Static<
  typeof TextLayoutQualityMeasurementSchema
>;
export type TextLayoutQualityEvidence = Static<
  typeof TextLayoutQualityEvidenceSchema
>;

export const TextLayoutQualityEvidenceContract =
  defineContract<TextLayoutQualityEvidence>({
    schema: TextLayoutQualityEvidenceSchema,
    code: "text.layout_quality_evidence_structure_invalid",
    subject: "text layout quality evidence",
    refine: textLayoutQualityEvidenceDomainIssues,
    clone: false,
  });

export function isTextLayoutQualityEvidence(
  value: unknown,
): value is TextLayoutQualityEvidence {
  return TextLayoutQualityEvidenceContract.parse(value).ok;
}

function textLayoutQualityEvidenceDomainIssues(
  evidence: TextLayoutQualityEvidence,
): ValidationIssue[] {
  const firstIndexByNodeId = new Map<string, number>();
  for (const [index, measurement] of evidence.measurements.entries()) {
    const firstIndex = firstIndexByNodeId.get(measurement.nodeId);
    if (firstIndex !== undefined) {
      return [
        {
          code: "text.layout_quality_evidence_node_duplicate",
          path: `/measurements/${index}/nodeId`,
          message: "Each text node may have only one quality measurement",
          expected: `unique from /measurements/${firstIndex}/nodeId`,
          actual: measurement.nodeId,
          recovery: "Remove the duplicate measurement for this node.",
        },
      ];
    }
    firstIndexByNodeId.set(measurement.nodeId, index);
  }
  return [];
}
