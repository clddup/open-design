import type { DesignDeliveryLedger } from "@opendesign/workspace-contracts";
import type { AgentTimelineItem } from "./timeline-types";

type Plan = NonNullable<AgentTimelineItem["plan"]>;

type ProjectPlanExecutionStateInput = {
  delivery?: DesignDeliveryLedger;
  plan: Plan;
  planOrder: number;
  planToolCallId?: string;
  runId: string;
};

export function createPlanExecutionStateProjector(source: {
  events: readonly unknown[];
  timeline: readonly unknown[];
}): (input: ProjectPlanExecutionStateInput) => Plan {
  void source;
  return projectPlanExecutionState;
}

function projectPlanExecutionState(
  input: ProjectPlanExecutionStateInput,
): Plan {
  if (
    input.delivery?.planExecution &&
    input.delivery.planExecution.planRevision !== input.plan.planRevision
  ) {
    return input.plan;
  }
  const executionByTargetId = new Map(
    input.delivery?.planExecution?.targets.map((target) => [
      target.targetId,
      target,
    ]) ?? [],
  );
  const statusByTargetId = new Map(
    input.delivery?.targets.map((target) => [target.targetId, target.status]) ??
      [],
  );
  const targets = input.plan.targets.map((target) => {
    const execution = executionByTargetId.get(target.targetId);
    const labelsByStepId = new Map(
      target.implementationSteps.map((step) => [step.stepId, step.label]),
    );
    return {
      ...target,
      ...(statusByTargetId.has(target.targetId)
        ? { status: statusByTargetId.get(target.targetId) }
        : {}),
      ...(execution
        ? {
            implementationSteps: execution.steps.map((step) => ({
              stepId: step.stepId,
              kind: step.kind,
              label: labelsByStepId.get(step.stepId) ?? step.label,
              status: timelineStepStatus(step.status),
            })),
          }
        : {}),
    };
  });
  return {
    ...input.plan,
    status: targets.every(
      (target) =>
        target.status === "verified" &&
        target.implementationSteps.every((step) => step.status === "completed"),
    )
      ? "verified"
      : "active",
    targets,
  };
}

function timelineStepStatus(
  status: "pending" | "in_progress" | "completed",
): "pending" | "active" | "completed" {
  return status === "in_progress" ? "active" : status;
}
