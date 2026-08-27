import { Type, type TSchema } from "@sinclair/typebox";
import type { ValidationIssue } from "@opendesign/contract-runtime";

export const DESIGN_WORKFLOW_FAILURE_DEFINITIONS = [
  definition("active_ui_target_required", "material-write", true),
  definition("allocated_artboard_invalid", "inspection", true),
  definition("allocation_revision_invalid", "inspection", true),
  definition("allocation_state_invalid", "inspection", true),
  definition("artboard_already_exists", "plan-repair", true),
  definition("artboard_overlap", "layout-repair", true),
  definition("auto_layout_requires_layout_tool", "layout-repair", false),
  definition("capture_required", "capture", false),
  definition("capture_revision_invalid", "capture", true),
  definition("component_catalog_stale", "component-repair", true),
  definition("component_strategy_incomplete", "component-repair", true),
  definition("cross_artboard_edit_invalid", "inspection", true),
  definition("delivery_already_verified", "plan-repair", false),
  definition("delivery_scope_already_reviewed", "plan-repair", false),
  definition("delivery_scope_approval_required", "plan-repair", false),
  definition("delivery_scope_late", "plan-repair", false),
  definition("delivery_scope_mismatch", "plan-repair", false),
  definition("delivery_scope_review_required", "plan-repair", false),
  definition("delivery_structure_incomplete", "material-write", true),
  definition("delivery_verification_required", "capture", true),
  definition("revision_conflict", "inspection", true),
  definition("scope_conflict", "inspection", true),
  definition("target_stale", "inspection", true),
  definition("edit_rebase_requires_inspection", "inspection", true),
  definition("empty_artboard_draft", "material-write", true),
  definition("empty_region_draft", "material-write", true),
  definition("existing_artboard_invalid", "inspection", true),
  definition("frame_resize_requires_layout_tool", "layout-repair", true),
  definition("image_attachment_ambiguous", "material-write", false),
  definition("image_paint_update_requires_image_tool", "material-write", false),
  definition("image_update_requires_image_tool", "material-write", false),
  definition("initial_inspection_stale", "inspection", true),
  definition("inspection_invalid", "inspection", true),
  definition("inspection_required", "inspection", true),
  definition("inspection_stale", "inspection", true),
  definition("layout_guides_requires_layout_tool", "layout-repair", false),
  definition("layout_quality_failed", "layout-repair", true),
  definition("layout_quality_unavailable", "capture", true),
  definition("logo_exploration_incomplete", "material-write", true),
  definition("logo_exploration_required", "material-write", false),
  definition("material_write_required", "material-write", false),
  definition("new_node_id_namespace_required", "plan-repair", false),
  definition("page_structure_access_required", "plan-repair", false),
  definition("plan_amendment_invalid", "plan-repair", true),
  definition("plan_node_ambiguous", "plan-repair", true),
  definition("planned_parent_not_materialized", "material-write", true),
  definition("planned_region_id_reserved", "plan-repair", false),
  definition("reference_strategy_invalid", "material-write", false),
  definition("reference_unavailable", "inspection", true),
  definition("ui_draft_structure_incomplete", "material-write", true),
  definition("visual_critic_unavailable", "capture", true),
  definition("visual_review_required", "capture", false),
  definition("visual_review_skill_binding_invalid", "capture", false),
] as const;

export type DesignWorkflowFailureCode =
  (typeof DESIGN_WORKFLOW_FAILURE_DEFINITIONS)[number]["code"];
export type DesignWorkflowFailurePhase =
  (typeof DESIGN_WORKFLOW_FAILURE_DEFINITIONS)[number]["phase"];

export const DESIGN_WORKFLOW_FAILURE_CODES =
  DESIGN_WORKFLOW_FAILURE_DEFINITIONS.map(({ code }) => code);

export const DesignWorkflowFailureCodeSchema = Type.Union(
  DESIGN_WORKFLOW_FAILURE_CODES.map((code) => Type.Literal(code)),
);

export function createDesignWorkflowFailureDetailsSchema<
  TIssueSchema extends TSchema,
  TAttemptFields extends Record<string, TSchema>,
>(issueSchema: TIssueSchema, attemptFields: TAttemptFields) {
  return Type.Object(
    {
      kind: Type.Literal("design-workflow"),
      fingerprint: Type.String({ minLength: 1, maxLength: 256 }),
      workflowCode: DesignWorkflowFailureCodeSchema,
      phase: Type.Union(
        [
          ...new Set(
            DESIGN_WORKFLOW_FAILURE_DEFINITIONS.map(({ phase }) => phase),
          ),
        ].map((phase) => Type.Literal(phase)),
      ),
      requiresInspection: Type.Boolean(),
      issues: Type.Array(issueSchema, { minItems: 1, maxItems: 128 }),
      recovery: Type.Object(
        {
          action: Type.Literal("follow-workflow"),
          required: Type.Literal(true),
        },
        { additionalProperties: false },
      ),
      ...attemptFields,
    },
    { additionalProperties: false },
  );
}

type WorkflowFailureLike = {
  code: string;
  details?: {
    kind: string;
    workflowCode?: string;
    phase?: string;
    requiresInspection?: boolean;
    issues?: Array<{ code?: string }>;
  };
};

export function designWorkflowFailureDomainIssues(
  value: WorkflowFailureLike,
  prefix: string,
): ValidationIssue[] {
  if (
    value.details?.kind !== "design-workflow" ||
    value.details.workflowCode === undefined ||
    value.details.issues === undefined
  ) {
    return [];
  }
  const expectedCode = `design_${value.details.workflowCode}`;
  const definition = designWorkflowFailureDefinition(
    value.details.workflowCode,
  );
  const acceptedFailureCodes = new Set([
    expectedCode,
    "design_inspection_required",
    "repeated_tool_failure",
  ]);
  const recovery =
    "Use the same workflow code across failure and issue fields.";
  const issues: ValidationIssue[] = [];
  if (!acceptedFailureCodes.has(value.code)) {
    issues.push({
      code: "trusted_tool_failure.workflow_code_mismatch",
      path: `${prefix}/code`,
      message: "Failure code must match its design workflow code",
      expected: expectedCode,
      actual: value.code,
      recovery,
    });
  }
  if (definition && value.details.phase !== definition.phase) {
    issues.push({
      code: "trusted_tool_failure.workflow_phase_mismatch",
      path: `${prefix}/details/phase`,
      message: "Workflow phase must match its stable workflow code",
      expected: definition.phase,
      actual: value.details.phase ?? null,
      recovery,
    });
  }
  if (
    definition &&
    value.details.requiresInspection !== definition.requiresInspection
  ) {
    issues.push({
      code: "trusted_tool_failure.workflow_inspection_mismatch",
      path: `${prefix}/details/requiresInspection`,
      message: "Inspection requirement must match its stable workflow code",
      expected: definition.requiresInspection,
      actual: value.details.requiresInspection ?? null,
      recovery,
    });
  }
  const expectedIssueCode = `design_workflow.${value.details.workflowCode}`;
  value.details.issues.forEach((issue, index) => {
    if (issue.code === expectedIssueCode) return;
    issues.push({
      code: "trusted_tool_failure.workflow_issue_code_mismatch",
      path: `${prefix}/details/issues/${index}/code`,
      message: "Workflow issue code must match its design workflow code",
      expected: expectedIssueCode,
      actual: issue.code ?? null,
      recovery,
    });
  });
  return issues;
}

export function designWorkflowFailureDefinition(code: string) {
  return DESIGN_WORKFLOW_FAILURE_DEFINITIONS.find(
    (candidate) => candidate.code === code,
  );
}

function definition<
  Code extends string,
  Phase extends string,
  RequiresInspection extends boolean,
>(code: Code, phase: Phase, requiresInspection: RequiresInspection) {
  return { code, phase, requiresInspection } as const;
}
