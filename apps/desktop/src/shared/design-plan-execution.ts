import type {
  DesignPlanExecution,
  DesignPlanStepStatus,
} from "@opendesign/workspace-contracts";
import { Type, type Static } from "@sinclair/typebox";
import { defineContract } from "./contract-validation";
import type { DesignPlanToolInput } from "./design-agent-plan-review";

export const DESIGN_PLAN_REVIEW_STEP_LABEL =
  "Review and refine the rendered target";

export const DESIGN_PLAN_UPDATE_TOOL_INPUT_SCHEMA = Type.Object(
  {
    planRevision: Type.Integer({ minimum: 1 }),
    targetId: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    }),
    completeStepId: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    }),
  },
  { additionalProperties: false },
);

export type DesignPlanUpdateToolInput = Static<
  typeof DESIGN_PLAN_UPDATE_TOOL_INPUT_SCHEMA
>;

export const DesignPlanUpdateContract =
  defineContract<DesignPlanUpdateToolInput>({
    schema: DESIGN_PLAN_UPDATE_TOOL_INPUT_SCHEMA,
    code: "design_plan_update.schema_invalid",
    subject: "Design Plan progress update",
    clone: false,
  });

export function designPlanReviewStepId(targetId: string): string {
  return `${targetId}.review-refine`;
}

export function createInitialPlanExecution(
  plan: DesignPlanToolInput,
  planRevision: number,
  currentRevision: number,
): DesignPlanExecution {
  let activeAssigned = false;
  return {
    planRevision,
    targets: plan.targets.map((target) => ({
      targetId: target.targetId,
      steps: [
        ...target.implementationSteps.map((step) => {
          const active = !activeAssigned;
          if (active) activeAssigned = true;
          return {
            ...step,
            kind: "implementation" as const,
            status: active ? ("in_progress" as const) : ("pending" as const),
            ...(active ? { startedRevision: currentRevision } : {}),
          };
        }),
        {
          stepId: designPlanReviewStepId(target.targetId),
          label: DESIGN_PLAN_REVIEW_STEP_LABEL,
          kind: "review-refine" as const,
          status: "pending" as const,
        },
      ],
    })),
  };
}

export function serializePlanStepStatuses<
  Step extends { status: DesignPlanStepStatus },
>(steps: readonly Step[]): Step[] {
  let phase: "completed" | "active" | "pending" = "completed";
  return steps.map((step) => {
    if (phase === "pending") return { ...step, status: "pending" };
    if (phase === "active") {
      phase = "pending";
      return { ...step, status: "pending" };
    }
    if (step.status === "completed") return step;
    if (step.status === "in_progress") {
      phase = "active";
      return step;
    }
    phase = "pending";
    return step;
  });
}
