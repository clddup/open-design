import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import {
  isDesignDeliveryLedger,
  type DesignDeliveryLedger,
} from "@opendesign/workspace-contracts";
import type { AgentTimelineItem, Translate } from "./timeline-types";

export function latestDeliveryLedger(
  timeline: readonly SessionTimelineItem[],
  events: readonly AgentEvent[],
  activeRunId: string | null,
): DesignDeliveryLedger | undefined {
  let latest: DesignDeliveryLedger | undefined;
  for (const item of timeline) {
    if (item.type !== "tool" || item.status !== "completed") continue;
    if (activeRunId !== null && item.runId !== activeRunId) continue;
    const delivery = deliveryFromResult(item.result);
    if (delivery) latest = delivery;
  }
  for (const event of events) {
    if (event.type !== "tool.completed") continue;
    if (activeRunId !== null && event.runId !== activeRunId) continue;
    const delivery = deliveryFromResult(event.result);
    if (delivery) latest = delivery;
  }
  return latest;
}

export function projectDurableDesignSteps(
  timeline: readonly SessionTimelineItem[],
  t: Translate,
): AgentTimelineItem[] {
  return timeline.flatMap((item) => {
    if (item.type !== "tool" || item.status !== "completed") return [];
    const steps = committedStepsFromResult(item.result);
    return steps.map((step, index) => ({
      id: `design-step:${item.toolCallId}:${step.revision}`,
      ...(item.runId ? { runId: item.runId } : {}),
      order: item.sequence + (index + 1) / (steps.length + 1),
      state: "done" as const,
      kind: "system" as const,
      toolCallId: item.toolCallId,
      revision: step.revision,
      time: t("common.done"),
      title: step.label,
    }));
  });
}

export function committedStepsFromResult(
  value: unknown,
): Array<{ label: string; revision: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const steps = (value as { committedSteps?: unknown }).committedSteps;
  if (!Array.isArray(steps) || steps.length > 32) return [];
  return steps.flatMap((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return [];
    const candidate = step as { label?: unknown; revision?: unknown };
    return typeof candidate.label === "string" &&
      candidate.label.length > 0 &&
      candidate.label.length <= 512 &&
      Number.isSafeInteger(candidate.revision) &&
      Number(candidate.revision) >= 0
      ? [{ label: candidate.label, revision: Number(candidate.revision) }]
      : [];
  });
}

function deliveryFromResult(value: unknown): DesignDeliveryLedger | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const delivery = (value as Record<string, unknown>).delivery;
  return isDesignDeliveryLedger(delivery) ? delivery : undefined;
}
