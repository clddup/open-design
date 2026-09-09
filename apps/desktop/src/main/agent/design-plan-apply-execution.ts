import type { DesignApplyToolInput } from "@/shared/design-agent-tools.js";
import type { DesignWorkflowState } from "./design-plan-registration.js";

type ActivePlanStep =
  DesignWorkflowState["planExecution"]["targets"][number]["steps"][number] & {
    targetId: string;
  };

type PlanExecutionState = Pick<
  DesignWorkflowState,
  "planExecution" | "targetsById"
>;

export function bindApplyToActivePlanSteps(
  state: PlanExecutionState,
  targetIds: readonly string[],
  input: DesignApplyToolInput,
): DesignApplyToolInput {
  const active = flattenedPlanSteps(state, targetIds).find(
    (step) => step.status !== "completed",
  );
  if (!active) return input;

  if (active.kind === "implementation") {
    return bindImplementationSteps(state, targetIds, input);
  }

  if (!targetIds.includes(active.targetId)) return input;

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

function bindImplementationSteps(
  state: PlanExecutionState,
  targetIds: readonly string[],
  input: DesignApplyToolInput,
): DesignApplyToolInput {
  const flattened = flattenedPlanSteps(state, targetIds);
  const activeIndex = flattened.findIndex(
    (step) => step.status !== "completed",
  );
  const active = flattened[activeIndex];
  const allowedTargets = new Set(targetIds);
  const submittedStepsAreAuthoritative = input.steps?.every(
    (submitted, offset) => {
      const expected = flattened[activeIndex + offset];
      return (
        expected?.kind === "implementation" &&
        allowedTargets.has(expected.targetId) &&
        expected.stepId === submitted.stepId &&
        (offset === 0 || expected.status === "pending")
      );
    },
  );
  if (submittedStepsAreAuthoritative && input.steps) {
    return {
      ...input,
      steps: input.steps.map((submitted, offset) => {
        const expected = flattened[activeIndex + offset];
        return {
          stepId: expected?.stepId ?? submitted.stepId,
          label: expected?.label ?? submitted.label,
          commandIds: submitted.commandIds,
        };
      }),
    };
  }
  if (
    !active ||
    active.kind !== "implementation" ||
    targetIds.length !== 1 ||
    targetIds[0] !== active.targetId
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

function flattenedPlanSteps(
  state: PlanExecutionState,
  targetIds: readonly string[],
): ActivePlanStep[] {
  return state.planExecution.targets
    .filter((target) => targetIds.includes(target.targetId))
    .flatMap((target) =>
      target.steps.map((step) => ({ ...step, targetId: target.targetId })),
    );
}
