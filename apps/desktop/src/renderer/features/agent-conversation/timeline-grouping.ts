import type { AgentTimelineItem, Translate } from "./timeline-types";

export type AgentTimelineRenderEntry =
  | { type: "item"; item: AgentTimelineItem }
  | {
      type: "tool-group";
      id: string;
      items: AgentTimelineItem[];
      state: "active" | "done";
      title: string;
    };

export function groupAgentTimelineItems(
  items: readonly AgentTimelineItem[],
  t: Translate,
): AgentTimelineRenderEntry[] {
  const entries: AgentTimelineRenderEntry[] = [];
  let tools: AgentTimelineItem[] = [];

  const flushTools = () => {
    if (tools.length === 1) {
      entries.push({ type: "item", item: tools[0] });
    } else if (tools.length > 1) {
      const state = tools.some((item) =>
        ["active", "queued", "stopping"].includes(item.state),
      )
        ? "active"
        : "done";
      entries.push({
        type: "tool-group",
        id: `tool-group:${tools[0].id}:${tools.at(-1).id}`,
        items: tools,
        state,
        title: t(
          state === "active"
            ? "agent.toolGroupRunning"
            : "agent.toolGroupCompleted",
          { count: tools.length },
        ),
      });
    }
    tools = [];
  };

  for (const item of items) {
    if (item.kind === "tool" && item.state !== "error") {
      tools.push(item);
      continue;
    }
    flushTools();
    entries.push({ type: "item", item });
  }
  flushTools();
  return entries;
}
