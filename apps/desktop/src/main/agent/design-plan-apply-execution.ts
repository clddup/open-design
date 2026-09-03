import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import type { DesignApplyToolInput } from "@/shared/design-agent-tools.js";
import type { DesignWorkflowState } from "./design-plan-registration.js";

type ActivePlanStep =
  DesignWorkflowState["planExecution"]["targets"][number]["steps"][number] & {
    targetId: string;
  };

export function bindApplyToActiveReviewStep(
  state: DesignWorkflowState,
  targetIds: readonly string[],
  input: DesignApplyToolInput,
): DesignApplyToolInput {
  const active = activePlanStep(state);
  if (active?.kind !== "review-refine") return input;

  const target = state.targetsById.get(active.targetId);
  if (
    !targetIds.includes(active.targetId) ||
    (target?.delivery.status !== "reviewed" &&
      target?.delivery.status !== "refined")
  ) {
    return input;
  }

  return {
    ...input,
    steps: [
      {
        stepId: active.stepId,
        label: active.label,
        commandIds: input.commands.map((command) => command.commandId),
      },
    ],
  };
}

export function assertApplyPlanSteps(
  state: DesignWorkflowState,
  targetIds: readonly string[],
  steps: DesignApplyToolInput["steps"],
): void {
  if (!steps || steps.length === 0) return;
  const flattened = flattenedPlanSteps(state);
  const activeIndex = flattened.findIndex(
    (step) => step.status === "in_progress",
  );
  if (activeIndex < 0) {
    throw designWorkflowError(
      "plan_step_state_invalid",
      "No executable Plan step is currently in progress",
    );
  }
  const allowedTargets = new Set(targetIds);
  const active = flattened[activeIndex];
  if (active?.kind === "review-refine") {
    assertReviewStep(state, allowedTargets, active, steps);
    return;
  }
  assertImplementationSteps(allowedTargets, flattened, activeIndex, steps);
}

function activePlanStep(
  state: DesignWorkflowState,
): ActivePlanStep | undefined {
  return flattenedPlanSteps(state).find(
    (step) => step.status === "in_progress",
  );
}

function flattenedPlanSteps(state: DesignWorkflowState): ActivePlanStep[] {
  return state.planExecution.targets.flatMap((target) =>
    target.steps.map((step) => ({ ...step, targetId: target.targetId })),
  );
}

function assertReviewStep(
  state: DesignWorkflowState,
  allowedTargets: ReadonlySet<string>,
  active: ActivePlanStep,
  steps: NonNullable<DesignApplyToolInput["steps"]>,
): void {
  const target = state.targetsById.get(active.targetId);
  const submitted = steps[0];
  if (
    steps.length === 1 &&
    submitted?.stepId === active.stepId &&
    allowedTargets.has(active.targetId) &&
    (target?.delivery.status === "reviewed" ||
      target?.delivery.status === "refined")
  ) {
    return;
  }
  throw designWorkflowError(
    "plan_step_order_invalid",
    `Design Apply step ${submitted?.stepId ?? "missing"} must match the active reviewed target`,
  );
}

function assertImplementationSteps(
  allowedTargets: ReadonlySet<string>,
  flattened: readonly ActivePlanStep[],
  activeIndex: number,
  steps: NonNullable<DesignApplyToolInput["steps"]>,
): void {
  steps.forEach((step, offset) => {
    const expected = flattened[activeIndex + offset];
    if (
      !expected ||
      expected.kind !== "implementation" ||
      !allowedTargets.has(expected.targetId) ||
      expected.stepId !== step.stepId ||
      (offset > 0 && expected.status !== "pending")
    ) {
      throw designWorkflowError(
        "plan_step_order_invalid",
        `Design Apply step ${step.stepId} must match the current serial Plan step`,
      );
    }
  });
}
