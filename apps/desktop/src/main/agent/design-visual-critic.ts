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
} from "@/shared/design-agent-tools.js";
import {
  activeVisualReferenceIds,
  DesignVisualReviewContract,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import {
  createDesignVisualCriticVerdictContract,
  DesignVisualCriticCaptureContentContract,
  type DesignVisualCriticAttachment,
  type DesignVisualCriticVerdict,
} from "@/shared/design-visual-critic-contract.js";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";

const GENERIC_CRITERIA = [
  "visual-thesis",
  "signature-decision",
  "composition-tension",
  "typography-character",
  "material-coherence",
  "template-avoidance",
  "glance-legibility",
  "subject-specificity",
  "craft-precision",
] as const satisfies readonly DesignVisualCriterion[];

const LOGO_GENERIC_CRITERIA = [
  "visual-thesis",
  "signature-decision",
  "template-avoidance",
  "craft-precision",
] as const satisfies readonly DesignVisualCriterion[];

const LOGO_BASE_CRITERIA = [
  "black-silhouette",
  "counterform-contour",
  "optical-balance",
  "small-size-recognition",
  "monochrome-integrity",
  "brand-color-system",
] as const;

type LogoOptionalCriterionId =
  | "concept-divergence"
  | "color-system-divergence"
  | "symbol-wordmark-relationship"
  | "app-icon-optical-redraw"
  | "app-icon-ecosystem-distinction"
  | "component-system-integrity";

const REFERENCE_CRITERION = "reference-adherence" as const;

type LogoDirectionCriterionId = `logo-concept-${string}-quality`;

type CriticCriterionId =
  | DesignVisualCriterion
  | (typeof LOGO_BASE_CRITERIA)[number]
  | LogoOptionalCriterionId
  | LogoDirectionCriterionId
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
  review: DesignVisualReviewToolInput | null;
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
  const criterionIds = criticCriteria(context.plan, context.target);
  const verdictContract = createDesignVisualCriticVerdictContract(criterionIds);
  const logoDirectionCriteria = logoDirectionCriterionContracts(
    context.plan,
    context.target,
  );
  const attemptId =
    `visual_critic_${context.runId}_${context.observedRevision}`.slice(0, 220);
  const events = await modelProviderHost.complete(
    {
      attemptId,
      sessionId: `${context.runId}:visual-critic`,
      latencyProfile: "interactive",
      modelSelection: {
        providerId: context.modelSelection.providerId,
        modelId: context.modelSelection.modelId,
      },
      system: [
        "You are OpenDesign's stateless independent visual delivery critic.",
        "You did not author this design. You receive no author conversation, reasoning, tool history, or self-review. Judge only the user brief, frozen target contract, and exact-revision capture.",
        "Call the critique tool exactly once. Do not answer with prose. Score anchors: 1 is broken or unusable; 2 has major defects; 3 is coherent but visibly not delivery-ready; 4 is delivery-ready with no material change required; 5 is exceptional. Attractive presentation cannot compensate for a failed criterion.",
        "Judge visible pixels before labels or rationale. A refinement means a material change is still required, so never attach one to a delivery-ready score. Omit optional nice-to-have polish. At either phase, pass-quality evidence requires every criterion to be independently ready; a first draft may pass honestly, and a final capture with unresolved refinements must fail.",
        "For UI, score glance-legibility, composition, typography, template-avoidance, and craft at 3 or lower when the task area is visually subordinate to decoration, important copy loses contrast, or generic gradients, light beams, rings, HUD lines, and floating panels carry the composition without product-specific behavior.",
        "For every logo-concept-*-quality criterion, judge that declared direction independently. It must have an ownable silhouette, visibly intentional construction, controlled contour or counterform, recognition at 32/24/16 px, anti-template originality, and visible agreement with its thesis. A caption cannot rescue an arbitrary shape, and stronger sibling concepts cannot compensate for one filler direction.",
        "For Logo color, treat monochrome as a required stress test rather than the default primary identity. brand-color-system fails when the main mark is only black/white/gray without an explicitly monochrome-only user brief, when color is decorative rather than semantic, or when light/dark adaptation is not visible. color-system-divergence requires explored directions to make materially different color decisions, not hue swaps. app-icon-ecosystem-distinction requires ownable color and optical weight among real macOS/Windows app icons.",
        "When visual references are supplied, the first image is always the delivery capture and later images are the authorized references named in the JSON contract. Judge the declared transferable decisions and avoidances; do not demand literal copying or confuse a content asset with a style reference.",
        "Write summary, evidence, and refinements in the language of the user's request.",
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
              text: JSON.stringify(
                criticEvidenceContract(
                  context,
                  criterionIds,
                  logoDirectionCriteria,
                ),
              ),
            },
            { type: "image_ref", ...context.attachment },
            ...context.referenceAttachments.map((attachment) => ({
              type: "image_ref" as const,
              ...attachment,
            })),
          ],
        },
      ],
      tools: [criticTool(verdictContract.schema)],
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
  const call = calls[0];
  if (
    response.stopReason !== "tool_use" ||
    calls.length !== 1 ||
    response.blocks.some(
      (block) =>
        block.type === "text" ||
        (block.type === "tool_call" && block.name !== SUBMIT_CRITIQUE_TOOL),
    ) ||
    call?.type !== "tool_call"
  ) {
    throw designWorkflowError(
      "visual_critic_unavailable",
      "Independent critic did not submit the required structured verdict",
      { path: "/response" },
    );
  }
  const parsed = verdictContract.parse(call.input);
  if (!parsed.ok) {
    throw designWorkflowError(
      "visual_critic_unavailable",
      formatValidationFailure("Independent visual critic", parsed.issues),
      {
        path: parsed.issues[0]?.path ?? "/response",
        recovery: parsed.issues[0]?.recovery,
      },
    );
  }
  const verdict: DesignVisualCriticVerdict<CriticCriterionId> = parsed.value;
  const scoreValues = criterionIds.map((id) => verdict.criteria[id].score);
  const averageScore =
    Math.round(
      (scoreValues.reduce((sum, score) => sum + score, 0) /
        scoreValues.length) *
        100,
    ) / 100;
  const failedCriteria = criterionIds.filter(
    (id) => verdict.criteria[id].score < 4,
  );
  const passed = failedCriteria.length === 0 && averageScore >= 4;
  const refinements = uniqueText([
    ...failedCriteria.map(
      (id) =>
        verdict.criteria[id].refinement ??
        `Rework ${id} using this evidence: ${verdict.criteria[id].evidence}`.slice(
          0,
          500,
        ),
    ),
  ]).slice(0, 12);
  return {
    version: 1,
    observedRevision: context.observedRevision,
    passed,
    averageScore,
    summary: verdict.summary,
    criteria: verdict.criteria,
    failedCriteria,
    refinements,
    review: passed
      ? null
      : toLedgerVisualReview(context.plan, verdict, refinements),
  };
}

function criticEvidenceContract(
  context: DesignVisualCriticContext,
  requiredCriteria: readonly CriticCriterionId[],
  logoDirectionCriteria: ReturnType<typeof logoDirectionCriterionContracts>,
) {
  const logoEvidence =
    context.plan.deliverable === "logo"
      ? {
          logoExploration:
            context.plan.logoExploration?.targetId === context.target.targetId
              ? context.plan.logoExploration
              : undefined,
          logoDirectionCriteria,
        }
      : {};
  return {
    phase: context.phase,
    observedRevision: context.observedRevision,
    userRequest: context.userRequest,
    deliverable: context.plan.deliverable,
    objective: context.plan.objective,
    target: {
      targetId: context.target.targetId,
      label: context.target.label,
      objective: context.target.objective,
      qualityProfile: context.target.qualityProfile,
      composition: context.target.composition,
      editableLayers: context.target.editableLayers,
      validationChecks: context.target.validationChecks,
    },
    briefFidelity: context.plan.briefFidelity,
    designIntent: context.plan.designIntent,
    visualSystem: context.plan.visualSystem,
    logoOutputs: context.plan.logoOutputs,
    referenceStrategy: context.plan.referenceStrategy,
    deliveryCaptureAttachmentId: context.attachment.attachmentId,
    visualReferenceAttachmentIds: context.referenceAttachments.map(
      (attachment) => attachment.attachmentId,
    ),
    ...logoEvidence,
    requiredCriteria,
  };
}

function criticCriteria(
  plan: DesignPlanToolInput,
  target: DesignPlanTarget,
): CriticCriterionId[] {
  const logoOutputs = new Set(plan.logoOutputs ?? []);
  const directionCriteria = logoDirectionCriterionContracts(plan, target).map(
    (direction) => direction.criterionId,
  );
  const reviewingExploration = directionCriteria.length > 0;
  if (plan.deliverable !== "logo") {
    return [
      ...GENERIC_CRITERIA,
      ...(activeVisualReferenceIds(plan.referenceStrategy).length > 0
        ? [REFERENCE_CRITERION]
        : []),
    ];
  }
  const genericCriteria = reviewingExploration
    ? LOGO_GENERIC_CRITERIA.filter(
        (criterion) => criterion !== "signature-decision",
      )
    : LOGO_GENERIC_CRITERIA;
  const logoCriteria: CriticCriterionId[] = reviewingExploration
    ? [
        "brand-color-system",
        "concept-divergence",
        "color-system-divergence",
        ...directionCriteria,
      ]
    : [
        ...LOGO_BASE_CRITERIA,
        ...(logoOutputs.has("wordmark") || logoOutputs.has("lockups")
          ? (["symbol-wordmark-relationship"] as const)
          : []),
        ...(logoOutputs.has("app-icon")
          ? ([
              "app-icon-optical-redraw",
              "app-icon-ecosystem-distinction",
            ] as const)
          : []),
        ...(logoOutputs.size > 1
          ? (["component-system-integrity"] as const)
          : []),
      ];
  return [
    ...genericCriteria,
    ...logoCriteria,
    ...(activeVisualReferenceIds(plan.referenceStrategy).length > 0
      ? [REFERENCE_CRITERION]
      : []),
  ];
}

function logoDirectionCriterionContracts(
  plan: DesignPlanToolInput,
  target: DesignPlanTarget,
): Array<{
  criterionId: LogoDirectionCriterionId;
  conceptId: string;
  label: string;
  principle: string;
  thesis: string;
  constructionLogic: string;
  colorSystem: { palette: string[]; rationale: string };
  requiredEvidenceNodeIds: string[];
  rubric: readonly string[];
}> {
  const directions =
    plan.logoExploration?.targetId === target.targetId
      ? plan.logoExploration.directions
      : [];
  return directions.map((direction) => ({
    criterionId: `logo-concept-${direction.conceptId}-quality`,
    conceptId: direction.conceptId,
    label: direction.label,
    principle: direction.principle,
    thesis: direction.thesis,
    constructionLogic: direction.constructionLogic,
    colorSystem: structuredClone(direction.colorSystem),
    requiredEvidenceNodeIds: [direction.rootNodeId, direction.masterNodeId],
    rubric: [
      "ownable black silhouette",
      "visible intentional construction logic",
      "controlled counterform or contour",
      "a silhouette and counterform robust enough for later optical redraws at small sizes",
      "no mechanically scaled clone presented as proof of small-size optimization",
      "anti-template originality",
      "a brief-specific primary color system whose role is visible in the mark rather than only in captions or presentation backgrounds",
      "visible agreement between the form and declared thesis without relying on its caption",
    ],
  }));
}

function criticTool(
  inputSchema: ReturnType<
    typeof createDesignVisualCriticVerdictContract<CriticCriterionId>
  >["schema"],
) {
  return {
    name: SUBMIT_CRITIQUE_TOOL,
    description:
      "Submit the independent exact-revision visual scorecard once. Every required criterion is non-compensating.",
    inputSchema,
  };
}

function toLedgerVisualReview(
  plan: DesignPlanToolInput,
  critic: {
    summary: string;
    criteria: Record<
      CriticCriterionId,
      { score: number; evidence: string; refinement?: string }
    >;
  },
  refinements: readonly string[],
): DesignVisualReviewToolInput {
  const generic = Object.fromEntries(
    GENERIC_CRITERIA.map((id) => [
      id,
      critic.criteria[id]?.evidence ??
        "Not applicable to this target; evaluated through deliverable-specific criteria.",
    ]),
  ) as Record<DesignVisualCriterion, string>;
  const reviewFailedCriteria = [
    ...new Set(
      Object.entries(critic.criteria)
        .filter(([, criterion]) => criterion.score < 4)
        .map(([criterionId]) => closestGenericCriterion(criterionId)),
    ),
  ];
  const candidate: DesignVisualReviewToolInput = {
    version: 1,
    skillRefs: structuredClone(plan.skillRefs),
    briefFidelity: generic["subject-specificity"],
    distinctiveness: generic["visual-thesis"],
    signatureDecision: generic["signature-decision"],
    composition: generic["composition-tension"],
    hierarchy: generic["glance-legibility"],
    typography: generic["typography-character"],
    assetIntegration: generic["subject-specificity"],
    formAndSurface: generic["material-coherence"],
    effects: generic["craft-precision"],
    antiTemplate: generic["template-avoidance"],
    criteria: generic,
    failedCriteria: reviewFailedCriteria,
    refinements: [...refinements],
  };
  const parsed = DesignVisualReviewContract.parse(candidate, {
    canonical: true,
  });
  if (!parsed.ok) {
    throw new TypeError(
      formatValidationFailure("independent Visual Review", parsed.issues),
    );
  }
  return parsed.value;
}

function closestGenericCriterion(failed: string): DesignVisualCriterion {
  const generic = GENERIC_CRITERIA.find((criterion) => criterion === failed);
  if (generic) return generic;
  if (failed === "brand-color-system" || failed === "color-system-divergence") {
    return "material-coherence";
  }
  if (failed === "small-size-recognition") return "glance-legibility";
  if (failed === "symbol-wordmark-relationship") {
    return "typography-character";
  }
  if (failed === "reference-adherence") return "subject-specificity";
  if (
    failed === "concept-divergence" ||
    failed === "app-icon-ecosystem-distinction"
  ) {
    return "template-avoidance";
  }
  if (failed.startsWith("logo-concept-")) return "signature-decision";
  return "craft-precision";
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function requireDesignVisualCriticAttachment(
  value: unknown,
): DesignVisualCriticAttachment {
  const parsed = DesignVisualCriticCaptureContentContract.parse(value);
  if (!parsed.ok) {
    throw designWorkflowError(
      "visual_critic_unavailable",
      formatValidationFailure("Visual critic capture", parsed.issues),
      {
        path: parsed.issues[0]?.path ?? "/attachment",
        recovery: parsed.issues[0]?.recovery,
      },
    );
  }
  return parsed.value.attachment;
}
