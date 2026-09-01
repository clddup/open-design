import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { DesignPlanUpdateContract } from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export function handleDesignPlanUpdateTool(
  coordinator: GlobalTaskCoordinator,
  call: ToolCallRequest,
  context: TrustedToolContext,
): TrustedToolResult {
  const parsed = DesignPlanUpdateContract.parse(call.input);
  if (!parsed.ok) {
    throw new TypeError(
      formatValidationFailure("opendesign_update_plan", parsed.issues),
    );
  }
  const delivery = coordinator.updateDesignPlan(context, parsed.value);
  return {
    content: {
      ok: true,
      planRevision: delivery.planExecution?.planRevision,
      planExecution: delivery.planExecution,
      delivery,
      deliveryStage: coordinator.getDeliveryStageContext(context.runId),
    },
  };
}
