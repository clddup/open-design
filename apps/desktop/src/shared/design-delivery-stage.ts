import { Type, type Static } from "@opendesign/design-contracts";
import {
  StableIdSchema,
  WorkspaceNameSchema,
} from "@opendesign/workspace-contracts";
import { defineContract, type ValidationIssue } from "./contract-validation";

const MAX_DELIVERY_STAGE_TARGETS = 32;

const DeliveryStageTargetSchema = Type.Object(
  {
    targetId: StableIdSchema,
    label: WorkspaceNameSchema,
    objective: Type.String({ minLength: 1, maxLength: 2_000 }),
    requiredContent: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
      maxItems: 16,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

const DeliveryStageCurrentPlanSchema = Type.Object(
  {
    stage: Type.Integer({ minimum: 1, maximum: MAX_DELIVERY_STAGE_TARGETS }),
    status: Type.Union([Type.Literal("active"), Type.Literal("verified")]),
    targets: Type.Array(DeliveryStageTargetSchema, {
      minItems: 1,
      maxItems: MAX_DELIVERY_STAGE_TARGETS,
    }),
  },
  { additionalProperties: false },
);

const DeliveryStageNextTargetSchema = Type.Object(
  {
    stage: Type.Integer({ minimum: 1, maximum: MAX_DELIVERY_STAGE_TARGETS }),
    ...DeliveryStageTargetSchema.properties,
  },
  { additionalProperties: false },
);

export const DesignDeliveryStageSchema = Type.Object(
  {
    totalTargets: Type.Integer({
      minimum: 1,
      maximum: MAX_DELIVERY_STAGE_TARGETS,
    }),
    plannedTargets: Type.Integer({
      minimum: 0,
      maximum: MAX_DELIVERY_STAGE_TARGETS,
    }),
    verifiedTargets: Type.Integer({
      minimum: 0,
      maximum: MAX_DELIVERY_STAGE_TARGETS,
    }),
    currentPlan: Type.Optional(DeliveryStageCurrentPlanSchema),
    nextTarget: Type.Optional(DeliveryStageNextTargetSchema),
  },
  { additionalProperties: false },
);

export type DesignDeliveryStage = Static<typeof DesignDeliveryStageSchema>;

export const DesignDeliveryStageContract = defineContract<DesignDeliveryStage>({
  schema: DesignDeliveryStageSchema,
  code: "design_delivery_stage.schema_invalid",
  subject: "Design Delivery Stage",
  maximum: 32,
  clone: false,
  refine: designDeliveryStageIssues,
});

function designDeliveryStageIssues(
  value: DesignDeliveryStage,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value.plannedTargets > value.totalTargets) {
    issues.push(
      issue(
        "design_delivery_stage.planned_count_invalid",
        "/plannedTargets",
        "Planned target count cannot exceed the confirmed delivery scope",
        value.totalTargets,
        value.plannedTargets,
      ),
    );
  }
  if (value.verifiedTargets > value.plannedTargets) {
    issues.push(
      issue(
        "design_delivery_stage.verified_count_invalid",
        "/verifiedTargets",
        "Verified target count cannot exceed planned target count",
        value.plannedTargets,
        value.verifiedTargets,
      ),
    );
  }
  issues.push(...currentPlanIssues(value));
  issues.push(...nextTargetIssues(value));
  return issues;
}

function currentPlanIssues(value: DesignDeliveryStage): ValidationIssue[] {
  const currentPlan = value.currentPlan;
  if (!currentPlan) {
    return value.plannedTargets === 0
      ? []
      : [
          issue(
            "design_delivery_stage.current_plan_required",
            "/currentPlan",
            "A non-empty planned target set requires its current Plan summary",
            "current Plan summary",
            value.plannedTargets,
          ),
        ];
  }
  const issues: ValidationIssue[] = [];
  if (value.plannedTargets === 0) {
    issues.push(
      issue(
        "design_delivery_stage.current_plan_unplanned",
        "/currentPlan",
        "Current Plan cannot exist before any target is planned",
        0,
        currentPlan.stage,
      ),
    );
  }
  const finalCurrentStage = currentPlan.stage + currentPlan.targets.length - 1;
  if (finalCurrentStage > value.plannedTargets) {
    issues.push(
      issue(
        "design_delivery_stage.current_plan_range_invalid",
        "/currentPlan/stage",
        "Current Plan stage range must belong to the planned target prefix",
        value.plannedTargets,
        finalCurrentStage,
      ),
    );
  }
  const targetIds = new Set<string>();
  currentPlan.targets.forEach((target, index) => {
    if (targetIds.has(target.targetId)) {
      issues.push({
        code: "design_delivery_stage.current_target_duplicate",
        path: `/currentPlan/targets/${index}/targetId`,
        message: "Current Plan target IDs must be unique",
        actual: target.targetId,
        recovery: "Regenerate Delivery Stage from the authoritative Plan.",
      });
    }
    targetIds.add(target.targetId);
  });
  return issues;
}

function nextTargetIssues(value: DesignDeliveryStage): ValidationIssue[] {
  const next = value.nextTarget;
  if (!next) return [];
  const issues: ValidationIssue[] = [];
  if (value.plannedTargets >= value.totalTargets) {
    issues.push(
      issue(
        "design_delivery_stage.next_target_exhausted",
        "/nextTarget",
        "Next target cannot exist after the confirmed scope is fully planned",
        value.totalTargets - 1,
        value.plannedTargets,
      ),
    );
  }
  if (next.stage !== value.plannedTargets + 1) {
    issues.push(
      issue(
        "design_delivery_stage.next_stage_invalid",
        "/nextTarget/stage",
        "Next target stage must immediately follow the planned target prefix",
        value.plannedTargets + 1,
        next.stage,
      ),
    );
  }
  if (value.currentPlan?.status === "active") {
    issues.push({
      code: "design_delivery_stage.next_target_while_active",
      path: "/nextTarget",
      message: "Next target is unavailable until the current Plan is verified",
      actual: next.targetId,
      recovery: "Verify the current Plan before projecting its next target.",
    });
  }
  if (
    value.currentPlan?.targets.some(
      (target) => target.targetId === next.targetId,
    )
  ) {
    issues.push({
      code: "design_delivery_stage.next_target_duplicate",
      path: "/nextTarget/targetId",
      message: "Next target must not repeat a current Plan target",
      actual: next.targetId,
      recovery: "Project the first unplanned confirmed delivery target.",
    });
  }
  return issues;
}

function issue(
  code: string,
  path: string,
  message: string,
  expected: string | number,
  actual: string | number,
): ValidationIssue {
  return {
    code,
    path,
    message,
    expected,
    actual,
    recovery: "Regenerate Delivery Stage from authoritative delivery state.",
  };
}
