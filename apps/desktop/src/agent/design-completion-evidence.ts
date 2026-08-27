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
  type DesignDeliveryStage,
} from "@/shared/design-delivery-stage.js";

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
  serialized: string | undefined,
): DesignDeliveryStage | undefined {
  if (!serialized) return undefined;
  try {
    const content: unknown = JSON.parse(serialized);
    const parsed = DesignDeliveryStageContract.parse(
      isRecord(content) ? content.deliveryStage : undefined,
    );
    return parsed.ok ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

export function latestDeliveryLedger(
  toolCalls: readonly AgentToolCallRecord[],
): DesignDeliveryLedger | undefined {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const result = toolCalls[index]?.result;
    if (!isRecord(result)) continue;
    if (result.deliveryDisposition === "superseded") return undefined;
    if (isDesignDeliveryLedger(result.delivery)) return result.delivery;
    if (isDesignDeliveryLedger(result.unfinishedDelivery)) {
      return result.unfinishedDelivery;
    }
  }
  return undefined;
}

export function hasSupersededDelivery(
  toolCalls: readonly AgentToolCallRecord[],
): boolean {
  return toolCalls.some(
    (call) =>
      call.toolName === DESIGN_PAGE_TOOL_NAME &&
      isRecord(call.result) &&
      call.result.deliveryDisposition === "superseded",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
