import type { AgentTimelineItem, Translate } from "./timeline-types";

export function projectReasoningInPlace(
  items: readonly AgentTimelineItem[],
  t: Translate,
): AgentTimelineItem[] {
  const projected: AgentTimelineItem[] = [];
  for (const item of items) {
    if (!item.reasoning) {
      projected.push(item);
      continue;
    }

    if (item.kind !== "reasoning") {
      const visibleItem = { ...item };
      delete visibleItem.reasoning;
      delete visibleItem.reasoningCount;
      projected.push(visibleItem);
    }

    const count = item.reasoningCount ?? 1;
    projected.push({
      id: item.kind === "reasoning" ? item.id : `reasoning:${item.id}`,
      ...(item.runId ? { runId: item.runId } : {}),
      kind: "reasoning",
      state: "done",
      order: item.order,
      time: item.time,
      title:
        count === 1
          ? t("agent.modelThinkingSummary")
          : t("agent.modelThinkingSummaryCount", {
              count,
            }),
      reasoning: item.reasoning,
      reasoningCount: count,
    });
  }
  return projected;
}
