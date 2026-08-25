import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DeliveryScopeContract,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export function handleDeliveryScopeTool(
  coordinator: GlobalTaskCoordinator,
  call: ToolCallRequest,
  context: TrustedToolContext,
): TrustedToolResult {
  const parsed = DeliveryScopeContract.parse(call.input);
  if (!parsed.ok) {
    throw new TypeError(
      formatValidationFailure(DESIGN_DELIVERY_SCOPE_TOOL_NAME, parsed.issues),
    );
  }
  const scope = coordinator.recordDeliveryScopeReviewed(
    context,
    call.toolCallId,
    parsed.value,
  );
  return {
    content: {
      ok: true,
      status: "confirmed",
      deliveryScope: scope,
      nextAction: "define-executable-plan",
    },
  };
}
