import type {
  DesignPlanExecution,
  DesignPlanStepStatus,
} from "@opendesign/workspace-contracts";
import type { DesignPlanToolInput } from "./design-agent-plan-review";

export const DESIGN_PLAN_REVIEW_STEP_LABEL =
  "Review and refine the rendered target";

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
