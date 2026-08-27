import { MAX_AGENT_IMAGE_BYTES } from "@opendesign/agent-contracts";
import {
  executableJsonSchema,
  Type,
  type Static,
} from "@opendesign/design-contracts";
import { defineContract } from "./contract-validation";

export type DesignVisualCriticPhase = "draft" | "final";

export type DesignVisualCriticVerdict<CriterionId extends string = string> = {
  summary: string;
  criteria: Record<
    CriterionId,
    { score: number; evidence: string; refinement?: string }
  >;
  refinements: string[];
};

export function createDesignVisualCriticVerdictContract<
  CriterionId extends string,
>(criterionIds: readonly CriterionId[], phase: DesignVisualCriticPhase) {
  const criterionSchema = {
    type: "object",
    properties: {
      score: { type: "integer", minimum: 1, maximum: 5 },
      evidence: {
        type: "string",
        minLength: 12,
        maxLength: 1_000,
        pattern: "\\S",
      },
      refinement: {
        type: "string",
        minLength: 8,
        maxLength: 500,
        pattern: "\\S",
      },
    },
    required: ["score", "evidence"],
    additionalProperties: false,
  } as const;
  const schema = executableJsonSchema({
    type: "object",
    properties: {
      summary: {
        type: "string",
        minLength: 12,
        maxLength: 1_000,
        pattern: "\\S",
      },
      criteria: {
        type: "object",
        properties: Object.fromEntries(
          criterionIds.map((criterionId) => [criterionId, criterionSchema]),
        ),
        required: [...criterionIds],
        additionalProperties: false,
      },
      refinements: {
        type: "array",
        minItems: phase === "draft" ? 2 : 0,
        maxItems: 12,
        items: {
          type: "string",
          minLength: 8,
          maxLength: 500,
          pattern: "\\S",
        },
      },
    },
    required: ["summary", "criteria", "refinements"],
    additionalProperties: false,
  });
  return defineContract<DesignVisualCriticVerdict<CriterionId>>({
    schema,
    code: "design_visual_critic.schema_invalid",
    subject: "independent visual critic verdict",
    maximum: 64,
    recovery:
      "Submit one complete scorecard containing exactly every required criterion and actionable draft refinements.",
  });
}

export const DesignVisualCriticAttachmentSchema = Type.Object(
  {
    attachmentId: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 512 }),
    mimeType: Type.Literal("image/jpeg"),
    byteSize: Type.Integer({ minimum: 1, maximum: MAX_AGENT_IMAGE_BYTES }),
  },
  { additionalProperties: false },
);

export type DesignVisualCriticAttachment = Static<
  typeof DesignVisualCriticAttachmentSchema
>;

const CanvasCaptureStructuredContentSchema = Type.Object(
  {},
  { additionalProperties: true },
);

export const CanvasCaptureStructuredContentContract = defineContract<
  Static<typeof CanvasCaptureStructuredContentSchema>
>({
  schema: CanvasCaptureStructuredContentSchema,
  code: "design_capture.content_schema_invalid",
  subject: "canvas capture structured content",
  maximum: 8,
  recovery: "Capture the active delivery target again.",
  clone: false,
});

const DesignVisualCriticCaptureContentSchema = Type.Object(
  { attachment: DesignVisualCriticAttachmentSchema },
  { additionalProperties: true },
);

export const DesignVisualCriticCaptureContentContract = defineContract<
  Static<typeof DesignVisualCriticCaptureContentSchema>
>({
  schema: DesignVisualCriticCaptureContentSchema,
  code: "design_visual_critic.capture_schema_invalid",
  subject: "exact-revision visual critic capture",
  maximum: 16,
  recovery:
    "Capture the active delivery target again and provide its bounded JPEG attachment.",
});
