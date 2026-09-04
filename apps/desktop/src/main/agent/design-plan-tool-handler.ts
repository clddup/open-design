import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  designPlanTargets,
  type DesignPlanToolInput,
} from "@/shared/design-agent-tools.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export function handleDesignPlanTool(
  coordinator: GlobalTaskCoordinator,
  call: ToolCallRequest,
  context: TrustedToolContext,
): TrustedToolResult {
  const plan = call.input as DesignPlanToolInput;
  const preparation = coordinator.prepareDesignPlan(context, plan);
  const registration = coordinator.commitDesignPlan(context, preparation);
  return {
    content: {
      ok: true,
      status: registration.status,
      planRevision: registration.planRevision,
      changedTargetIds: registration.changedTargetIds,
      plan: registration.plan,
      version: registration.plan.version,
      deliverable: registration.plan.deliverable,
      outputMode: registration.plan.outputMode,
      targets: designPlanTargets(registration.plan),
      rasterAssetRoles: registration.plan.rasterAssetRoles,
      delivery: coordinator.getDeliveryLedger(context.runId),
      deliveryStage: coordinator.getDeliveryStageContext(context.runId),
      nextAction: "write-current-target",
    },
  };
}
