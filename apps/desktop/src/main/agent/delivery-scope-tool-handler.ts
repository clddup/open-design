import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import type { DesignDeliveryScope } from "@/shared/design-agent-tools.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export function handleDeliveryScopeTool(
  coordinator: GlobalTaskCoordinator,
  call: ToolCallRequest,
  context: TrustedToolContext,
): TrustedToolResult {
  const scope = call.input as DesignDeliveryScope;
  const reservation = coordinator.createDeliveryScopeReservation(
    context,
    scope,
  );
  const completed = coordinator.recordDeliveryScopeCompleted(
    context,
    scope,
    reservation,
  );
  return {
    content: {
      ok: true,
      status: "recorded",
      deliveryScope: completed.scope,
      reservation: {
        artboards: completed.artboards,
      },
      delivery: coordinator.getDeliveryLedger(context.runId),
      deliveryStage: coordinator.getDeliveryStageContext(context.runId),
      nextAction: "generate-first-target",
    },
  };
}
