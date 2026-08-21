import type { AgentImageAttachment } from "@opendesign/agent-contracts";
import type { ModelSelection } from "@opendesign/model-gateway";
import { ModelResponseAccumulator } from "@opendesign/model-gateway";
import { formatBuiltinDesignReviewSkillBundleForDeliverable } from "@opendesign/design-skills";
import type { ModelProviderHost } from "../model/model-provider-host.js";
import type {
  DesignPlanTarget,
  DesignPlanToolInput,
  DesignVisualCriterion,
  DesignVisualReviewToolInput,
} from "../../shared/design-agent-tools.js";
import { activeVisualReferenceIds } from "../../shared/design-agent-tools.js";

const GENERIC_CRITERIA = [
  "visual-thesis",
  "signature-motif",
  "composition-tension",
  "typography-character",
  "material-coherence",
  "template-avoidance",
  "glance-legibility",
  "subject-specificity",
  "craft-precision",
] as const satisfies readonly DesignVisualCriterion[];

const LOGO_CRITERIA = [
  "concept-divergence",
  "black-silhouette",
  "counterform-contour",
  "optical-balance",
  "small-size-recognition",
  "monochrome-integrity",
  "symbol-wordmark-relationship",
  "app-icon-optical-redraw",
  "component-system-integrity",
] as const;

const REFERENCE_CRITERION = "reference-adherence" as const;

type CriticCriterionId =
  | DesignVisualCriterion
  | (typeof LOGO_CRITERIA)[number]
  | typeof REFERENCE_CRITERION;

export type DesignVisualCriticResult = {
  version: 1;
  observedRevision: number;
  passed: boolean;
  averageScore: number;
  summary: string;
  criteria: Partial<
    Record<
      CriticCriterionId,
      { score: number; evidence: string; refinement?: string }
    >
  >;
  failedCriteria: CriticCriterionId[];
  refinements: string[];
  review: DesignVisualReviewToolInput;
};

export type DesignVisualCriticAttachment = {
  attachmentId: string;
  byteSize: number;
  mimeType: "image/jpeg";
  name: string;
};

export type DesignVisualCriticContext = {
  runId: string;
  modelSelection: ModelSelection;
  userRequest: string;
  plan: DesignPlanToolInput;
  target: DesignPlanTarget;
  observedRevision: number;
  phase: "draft" | "final";
  attachment: DesignVisualCriticAttachment;
  referenceAttachments: AgentImageAttachment[];
};

const SUBMIT_CRITIQUE_TOOL = "opendesign_submit_independent_visual_critique";

export async function runIndependentDesignVisualCritic(
  modelProviderHost: Pick<ModelProviderHost, "complete">,
  context: DesignVisualCriticContext,
  signal: AbortSignal,
): Promise<DesignVisualCriticResult> {
  const criterionIds = criticCriteria(context.plan);
  const attemptId =
    `visual_critic_${context.runId}_${context.observedRevision}`.slice(0, 220);
  const events = await modelProviderHost.complete(
    {
      attemptId,
      sessionId: `${context.runId}:visual-critic`,
      modelSelection: {
        providerId: context.modelSelection.providerId,
        modelId: context.modelSelection.modelId,
      },
      system: [
        "You are OpenDesign's stateless independent visual delivery critic.",
        "You did not author this design. You receive no author conversation, reasoning, tool history, or self-review. Judge only the user brief, frozen target contract, and exact-revision capture.",
        "Call the critique tool exactly once. Do not answer with prose. Scores are integers from 1 (unacceptable) to 5 (delivery quality). Attractive presentation cannot compensate for a failed criterion.",
        "At final phase, use pass only when every criterion is independently delivery-ready. At draft phase, identify the most consequential real defects, not invented praise or minor filler.",
        "When visual references are supplied, the first image is always the delivery capture and later images are the authorized references named in the JSON contract. Judge the declared transferable decisions and avoidances; do not demand literal copying or confuse a content asset with a style reference.",
        formatBuiltinDesignReviewSkillBundleForDeliverable(
          context.plan.deliverable,
        ),
      ].join("\n\n"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                phase: context.phase,
                observedRevision: context.observedRevision,
                userRequest: context.userRequest,
                deliverable: context.plan.deliverable,
                objective: context.plan.objective,
                target: context.target,
                visualSystem: context.plan.visualSystem,
                briefFidelity: context.plan.briefFidelity,
                designIntent: context.plan.designIntent,
                referenceStrategy: context.plan.referenceStrategy,
                deliveryCaptureAttachmentId: context.attachment.attachmentId,
                visualReferenceAttachmentIds: context.referenceAttachments.map(
                  (attachment) => attachment.attachmentId,
                ),
                logoExploration: context.plan.logoExploration,
                requiredCriteria: criterionIds,
              }),
            },
            { type: "image_ref", ...context.attachment },
            ...context.referenceAttachments.map((attachment) => ({
              type: "image_ref" as const,
              ...attachment,
            })),
          ],
        },
      ],
      tools: [criticTool(criterionIds, context.phase)],
    },
    signal,
  );
  const accumulator = new ModelResponseAccumulator(attemptId);
  events.forEach((event) => accumulator.add(event));
  const response = accumulator.result();
  const calls = response.blocks.filter(
    (block) =>
      block.type === "tool_call" && block.name === SUBMIT_CRITIQUE_TOOL,
  );
  const hasUnexpectedOutput = response.blocks.some(
    (block) =>
      block.type === "text" ||
      (block.type === "tool_call" && block.name !== SUBMIT_CRITIQUE_TOOL),
  );
  const call = calls[0];
  if (
    response.stopReason !== "tool_use" ||
    calls.length !== 1 ||
    hasUnexpectedOutput ||
    call?.type !== "tool_call"
  ) {
    throw new Error(
      "design_visual_critic.invalid_response: Independent critic did not submit the required structured verdict",
    );
  }
  const parsed = parseCriticInput(call.input, criterionIds, context.phase);
  if (!parsed) {
    throw new Error(
      "design_visual_critic.invalid_response: Independent critic returned an invalid scorecard",
    );
  }
  const scoreValues = criterionIds.map((id) => parsed.criteria[id].score);
  const averageScore =
    Math.round(
      (scoreValues.reduce((sum, score) => sum + score, 0) /
        scoreValues.length) *
        100,
    ) / 100;
  const criticalIds =
    context.plan.deliverable === "logo"
      ? new Set<CriticCriterionId>([
          "concept-divergence",
          "black-silhouette",
          "counterform-contour",
          "small-size-recognition",
          "app-icon-optical-redraw",
          "template-avoidance",
        ])
      : new Set<CriticCriterionId>([
          "visual-thesis",
          "signature-motif",
          "glance-legibility",
          "template-avoidance",
        ]);
  if (criterionIds.includes(REFERENCE_CRITERION)) {
    criticalIds.add(REFERENCE_CRITERION);
  }
  const failedCriteria = criterionIds.filter((id) => {
    const score = parsed.criteria[id].score;
    return score < (criticalIds.has(id) ? 4 : 3);
  });
  const passed = failedCriteria.length === 0 && averageScore >= 3.5;
  const refinements = uniqueText([
    ...failedCriteria.map(
      (id) =>
        parsed.criteria[id].refinement ??
        `Rework ${id} using this evidence: ${parsed.criteria[id].evidence}`.slice(
          0,
          500,
        ),
    ),
    ...parsed.refinements,
  ]).slice(0, 12);
  return {
    version: 1,
    observedRevision: context.observedRevision,
    passed,
    averageScore,
    summary: parsed.summary,
    criteria: parsed.criteria,
    failedCriteria,
    refinements,
    review: toLedgerVisualReview(context.plan, parsed, refinements),
  };
}

function criticCriteria(plan: DesignPlanToolInput): CriticCriterionId[] {
  return [
    ...GENERIC_CRITERIA,
    ...(plan.deliverable === "logo" ? LOGO_CRITERIA : []),
    ...(activeVisualReferenceIds(plan.referenceStrategy).length > 0
      ? [REFERENCE_CRITERION]
      : []),
  ];
}

function criticTool(
  criterionIds: readonly CriticCriterionId[],
  phase: DesignVisualCriticContext["phase"],
) {
  return {
    name: SUBMIT_CRITIQUE_TOOL,
    description:
      "Submit the independent exact-revision visual scorecard once. Every required criterion is non-compensating.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", minLength: 12, maxLength: 1_000 },
        criteria: {
          type: "object",
          properties: Object.fromEntries(
            criterionIds.map((id) => [
              id,
              {
                type: "object",
                properties: {
                  score: { type: "integer", minimum: 1, maximum: 5 },
                  evidence: {
                    type: "string",
                    minLength: 12,
                    maxLength: 1_000,
                  },
                  refinement: {
                    type: "string",
                    minLength: 8,
                    maxLength: 500,
                  },
                },
                required: ["score", "evidence"],
                additionalProperties: false,
              },
            ]),
          ),
          required: [...criterionIds],
          additionalProperties: false,
        },
        refinements: {
          type: "array",
          minItems: phase === "draft" ? 2 : 0,
          maxItems: 12,
          items: { type: "string", minLength: 8, maxLength: 500 },
        },
      },
      required: ["summary", "criteria", "refinements"],
      additionalProperties: false,
    },
  };
}

function parseCriticInput(
  value: unknown,
  criterionIds: readonly CriticCriterionId[],
  phase: DesignVisualCriticContext["phase"],
): {
  summary: string;
  criteria: Record<
    CriticCriterionId,
    { score: number; evidence: string; refinement?: string }
  >;
  refinements: string[];
} | null {
  if (!isRecord(value) || !boundedText(value.summary, 12, 1_000)) return null;
  if (!isRecord(value.criteria)) return null;
  if (!exactKeys(value.criteria, criterionIds)) return null;
  const criteria = {} as Record<
    CriticCriterionId,
    { score: number; evidence: string; refinement?: string }
  >;
  for (const id of criterionIds) {
    const candidate = value.criteria[id];
    if (
      !isRecord(candidate) ||
      !Number.isInteger(candidate.score) ||
      Number(candidate.score) < 1 ||
      Number(candidate.score) > 5 ||
      !boundedText(candidate.evidence, 12, 1_000) ||
      (candidate.refinement !== undefined &&
        !boundedText(candidate.refinement, 8, 500)) ||
      !exactKeys(candidate, [
        "score",
        "evidence",
        ...(candidate.refinement === undefined ? [] : ["refinement"]),
      ])
    ) {
      return null;
    }
    criteria[id] = {
      score: Number(candidate.score),
      evidence: candidate.evidence,
      ...(candidate.refinement === undefined
        ? {}
        : { refinement: candidate.refinement }),
    };
  }
  if (
    !Array.isArray(value.refinements) ||
    (phase === "draft" && value.refinements.length < 2) ||
    value.refinements.length > 12 ||
    !value.refinements.every((item) => boundedText(item, 8, 500)) ||
    !exactKeys(value, ["summary", "criteria", "refinements"])
  ) {
    return null;
  }
  return {
    summary: value.summary,
    criteria,
    refinements: [...value.refinements],
  };
}

function toLedgerVisualReview(
  plan: DesignPlanToolInput,
  critic: ReturnType<typeof parseCriticInput> extends infer Parsed
    ? Exclude<Parsed, null>
    : never,
  refinements: readonly string[],
): DesignVisualReviewToolInput {
  const generic = Object.fromEntries(
    GENERIC_CRITERIA.map((id) => [id, critic.criteria[id].evidence]),
  ) as Record<DesignVisualCriterion, string>;
  const lowest = [...GENERIC_CRITERIA]
    .sort(
      (left, right) =>
        critic.criteria[left].score - critic.criteria[right].score,
    )
    .slice(0, 2);
  const reviewRefinements = uniqueText([
    ...refinements,
    ...lowest.map(
      (id) =>
        critic.criteria[id].refinement ??
        `Strengthen ${id} using the visible critic evidence`,
    ),
  ]).slice(0, 12);
  return {
    version: 1,
    skillRefs: structuredClone(plan.skillRefs),
    briefFidelity: generic["subject-specificity"],
    distinctiveness: generic["visual-thesis"],
    signatureMotif: generic["signature-motif"],
    composition: generic["composition-tension"],
    hierarchy: generic["glance-legibility"],
    typography: generic["typography-character"],
    assetIntegration: generic["subject-specificity"],
    formAndSurface: generic["material-coherence"],
    effects: generic["craft-precision"],
    antiTemplate: generic["template-avoidance"],
    criteria: generic,
    failedCriteria: lowest,
    refinements: reviewRefinements,
  };
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.length <= maximum
  );
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

export function requireDesignVisualCriticAttachment(
  value: Record<string, unknown>,
): DesignVisualCriticAttachment {
  const attachment = value.attachment;
  if (
    !isRecord(attachment) ||
    typeof attachment.attachmentId !== "string" ||
    attachment.attachmentId.length === 0 ||
    typeof attachment.name !== "string" ||
    attachment.name.length === 0 ||
    attachment.mimeType !== "image/jpeg" ||
    !Number.isSafeInteger(attachment.byteSize) ||
    Number(attachment.byteSize) <= 0 ||
    !exactKeys(attachment, ["attachmentId", "name", "mimeType", "byteSize"])
  ) {
    throw new Error(
      "design_visual_critic.capture_unavailable: Exact-revision capture attachment is missing or invalid",
    );
  }
  return {
    attachmentId: attachment.attachmentId,
    name: attachment.name,
    mimeType: "image/jpeg",
    byteSize: Number(attachment.byteSize),
  };
}
