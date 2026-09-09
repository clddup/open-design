import { Type, type Static } from "@sinclair/typebox";
import { DesignTargetQualityProfileSchema } from "@opendesign/design-contracts";
import { defineContract } from "./contract-validation";
import { DELIVERABLE_SCHEMA } from "./design-generation-tool-schema";
import { idSchema } from "./design-generation-schema-primitives";

const CaptureTargetSchema = Type.Object(
  {
    frameId: idSchema(),
    deliverable: DELIVERABLE_SCHEMA,
    qualityProfile: Type.Optional(DesignTargetQualityProfileSchema),
    referenceAttachmentIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
        maxItems: 8,
        uniqueItems: true,
      }),
    ),
  },
  { additionalProperties: false },
);

const CaptureCanvasSchema = Type.Object(
  { target: Type.Optional(CaptureTargetSchema) },
  { additionalProperties: false },
);

export type CaptureCanvasInput = Static<typeof CaptureCanvasSchema>;
export type ExplicitCaptureTarget = Static<typeof CaptureTargetSchema>;

export const CaptureCanvasContract = defineContract<CaptureCanvasInput>({
  schema: CaptureCanvasSchema,
  code: "design_capture.input_invalid",
  subject: "canvas capture",
  clone: false,
  refine: ({ target }) => {
    if (!target?.qualityProfile) return [];
    const expected = target.deliverable === "ui" ? "ui" : "graphic";
    return target.qualityProfile.kind === expected
      ? []
      : [
          {
            code: "design_capture.quality_profile_kind_mismatch",
            path: "/target/qualityProfile/kind",
            message: "Quality profile must match the declared deliverable",
            expected,
            actual: target.qualityProfile.kind,
            recovery:
              "Use the quality profile for the design type being reviewed.",
          },
        ];
  },
});
