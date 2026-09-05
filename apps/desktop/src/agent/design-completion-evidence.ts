import type { AgentToolCallRecord } from "@opendesign/agent-runtime";
import {
  isDesignDeliveryLedger,
  type DesignDeliveryLedger,
} from "@opendesign/workspace-contracts";
import {
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DeliveryScopeContract,
  type DesignDeliveryScope,
} from "@/shared/design-agent-tools.js";
import {
  DesignDeliveryStageContract,
  type AgentInitialDesignInspectionContent,
  type DesignDeliveryStage,
} from "@opendesign/agent-contracts";

export function latestReviewedDeliveryScope(
  toolCalls: readonly AgentToolCallRecord[],
): DesignDeliveryScope | undefined {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const call = toolCalls[index];
    if (call?.toolName !== DESIGN_DELIVERY_SCOPE_TOOL_NAME) continue;
    const result = isRecord(call.result)
      ? call.result.deliveryScope
      : undefined;
    const parsed = DeliveryScopeContract.parse(result);
    if (parsed.ok) return parsed.value;
  }
  return undefined;
}

export function latestDeliveryStage(
  toolCalls: readonly AgentToolCallRecord[],
): DesignDeliveryStage | undefined {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const result = toolCalls[index]?.result;
    if (!isRecord(result)) continue;
    const parsed = DesignDeliveryStageContract.parse(result.deliveryStage);
    if (parsed.ok) return parsed.value;
  }
  return undefined;
}

export function initialDeliveryStage(
  content: AgentInitialDesignInspectionContent | undefined,
): DesignDeliveryStage | undefined {
  const parsed = DesignDeliveryStageContract.parse(content?.deliveryStage);
  return parsed.ok ? parsed.value : undefined;
}

export function latestDeliveryLedger(
  toolCalls: readonly AgentToolCallRecord[],
  includeRecoveryContext = false,
): DesignDeliveryLedger | undefined {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const result = toolCalls[index]?.result;
    if (!isRecord(result)) continue;
    if (result.deliveryDisposition === "superseded") return undefined;
    if (isDesignDeliveryLedger(result.delivery)) return result.delivery;
    if (
      includeRecoveryContext &&
      isDesignDeliveryLedger(result.unfinishedDelivery)
    ) {
      return result.unfinishedDelivery;
    }
  }
  return undefined;
}

export function designCallsAfterSupersession(
  toolCalls: readonly AgentToolCallRecord[],
): readonly AgentToolCallRecord[] {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const call = toolCalls[index];
    if (
      call.toolName === DESIGN_PAGE_TOOL_NAME &&
      isRecord(call.result) &&
      call.result.deliveryDisposition === "superseded"
    )
      return toolCalls.slice(index + 1);
  }
  return toolCalls;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
