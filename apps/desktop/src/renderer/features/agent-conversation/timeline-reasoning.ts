import type { AgentTimelineItem, Translate } from "./timeline-types";

export function mergeReasoningByRun(
  items: readonly AgentTimelineItem[],
  t: Translate,
): AgentTimelineItem[] {
  const merged: AgentTimelineItem[] = [];
  const indexByRunId = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== "reasoning" || !item.runId || !item.reasoning) {
      merged.push(item);
      continue;
    }
    const existingIndex = indexByRunId.get(item.runId);
    if (existingIndex === undefined) {
      indexByRunId.set(item.runId, merged.length);
      merged.push(item);
      continue;
    }
    const existing = merged[existingIndex];
    if (!existing) {
      merged.push(item);
      continue;
    }
    const summaries = [existing.reasoning, item.reasoning].filter(
      (summary): summary is string => Boolean(summary),
    );
    const reasoningCount =
      (existing.reasoningCount ?? 1) + (item.reasoningCount ?? 1);
    merged[existingIndex] = {
      ...existing,
      reasoning: summaries.join("\n\n"),
      reasoningCount,
      title: t("agent.modelThinkingSummaryCount", { count: reasoningCount }),
      time: item.time,
    };
  }
  return merged;
}
