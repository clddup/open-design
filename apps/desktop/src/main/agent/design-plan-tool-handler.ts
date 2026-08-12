import type {
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import {
  designPlanTargets,
  isDesignPlanToolInput,
} from "../../shared/design-agent-tools.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export function handleDesignPlanTool(
  coordinator: GlobalTaskCoordinator,
  context: TrustedToolContext,
  input: unknown,
): TrustedToolResult {
  if (!isDesignPlanToolInput(input)) {
    throw new TypeError("Invalid design plan tool input");
  }
  const registration = coordinator.registerDesignPlan(context, input);
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
    },
  };
}
