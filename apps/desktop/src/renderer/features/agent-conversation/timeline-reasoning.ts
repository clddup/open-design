import type { AgentTimelineItem, Translate } from "./timeline-types";

export function mergeReasoningByRun(
  items: readonly AgentTimelineItem[],
  t: Translate,
): AgentTimelineItem[] {
  const aggregates = new Map<
    string,
    {
      anchorId: string;
      count: number;
      summaries: string[];
      time: string;
    }
  >();
  for (const item of items) {
    if (!item.runId || !item.reasoning) continue;
    const existing = aggregates.get(item.runId);
    aggregates.set(item.runId, {
      anchorId: existing?.anchorId ?? item.id,
      count: (existing?.count ?? 0) + (item.reasoningCount ?? 1),
      summaries: [...(existing?.summaries ?? []), item.reasoning],
      time: item.time,
    });
  }

  const merged: AgentTimelineItem[] = [];
  for (const item of items) {
    const aggregate = item.runId ? aggregates.get(item.runId) : undefined;
    if (!aggregate || !item.reasoning) {
      merged.push(item);
      continue;
    }

    if (item.kind !== "reasoning") {
      const visibleItem = { ...item };
      delete visibleItem.reasoning;
      delete visibleItem.reasoningCount;
      merged.push(visibleItem);
    }

    if (item.id === aggregate.anchorId && item.runId) {
      merged.push({
        id: `reasoning:${item.runId}`,
        runId: item.runId,
        kind: "reasoning",
        state: "done",
        order: item.order,
        time: aggregate.time,
        title:
          aggregate.count === 1
            ? t("agent.modelThinkingSummary")
            : t("agent.modelThinkingSummaryCount", {
                count: aggregate.count,
              }),
        reasoning: aggregate.summaries.join("\n\n"),
        reasoningCount: aggregate.count,
      });
    }
  }
  return merged;
}
