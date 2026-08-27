import {
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
} from "@/shared/design-agent-tools";
import { DesignDeliveryStageContract } from "@/shared/design-delivery-stage";
import {
  DesignDeliveryLedgerContract,
  type DesignDeliveryStatus,
} from "@opendesign/workspace-contracts";
import { committedStepsFromResult } from "./timeline-design-delivery";
import type { AgentTimelineItem, Translate } from "./timeline-types";

type TimelinePlan = NonNullable<AgentTimelineItem["plan"]>;

export function projectDesignPlanTimeline(
  toolName: string | undefined,
  result: unknown,
): TimelinePlan | undefined {
  if (
    toolName !== DESIGN_PLAN_TOOL_NAME &&
    toolName !== DESIGN_FIRST_SLICE_TOOL_NAME
  ) {
    return undefined;
  }
  const record = asRecord(result);
  const plan = asRecord(record?.plan);
  if (!plan || !Array.isArray(plan.targets) || plan.targets.length === 0) {
    return undefined;
  }
  const parsedDelivery = DesignDeliveryLedgerContract.parse(record?.delivery);
  const delivery = parsedDelivery.ok ? parsedDelivery.value : undefined;
  const committedSteps = committedStepsFromResult(result);
  const statuses = new Map<string, DesignDeliveryStatus>();
  delivery?.targets.forEach((target) => {
    statuses.set(target.targetId, target.status);
  });
  const targets = plan.targets.flatMap((candidate) => {
    const target = asRecord(candidate);
    if (
      typeof target?.targetId !== "string" ||
      typeof target.label !== "string" ||
      typeof target.objective !== "string"
    ) {
      return [];
    }
    const implementationSteps = Array.isArray(target.implementationSteps)
      ? target.implementationSteps
          .filter((step): step is string => typeof step === "string")
          .map((label) => ({
            label,
            status: committedSteps.some(
              (step) => step.label.trim() === label.trim(),
            )
              ? ("completed" as const)
              : ("pending" as const),
          }))
      : [];
    const status = statuses.get(target.targetId);
    return [
      {
        targetId: target.targetId,
        label: target.label,
        objective: target.objective,
        implementationSteps,
        ...(status === undefined ? {} : { status }),
      },
    ];
  });
  if (targets.length === 0) return undefined;
  const parsedStage = DesignDeliveryStageContract.parse(record?.deliveryStage);
  const deliveryStage = parsedStage.ok ? parsedStage.value : undefined;
  return {
    stage:
      deliveryStage?.currentPlan?.stage ??
      (typeof record?.planRevision === "number" && record.planRevision >= 1
        ? record.planRevision
        : 1),
    ...(deliveryStage ? { totalTargets: deliveryStage.totalTargets } : {}),
    status:
      deliveryStage?.currentPlan?.status === "verified" ? "verified" : "active",
    targets,
  };
}

export function designPlanTimelineTitle(
  plan: TimelinePlan,
  t: Translate,
): string {
  return plan.totalTargets === undefined
    ? t("agent.currentPlan", { stage: plan.stage })
    : t("agent.currentPlanProgress", {
        stage: plan.stage,
        total: plan.totalTargets,
      });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
