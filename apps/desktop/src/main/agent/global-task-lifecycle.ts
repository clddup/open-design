import type { AgentEvent } from "@opendesign/agent-contracts";
import type {
  GlobalTaskLifecycle,
  GlobalTaskProjection,
} from "@opendesign/workspace-contracts";

type RunScopedEvent = AgentEvent & { runId: string };

export function conversationActivityAt(
  event: AgentEvent,
  now: () => Date,
): string | null {
  if (event.type === "run.started") return event.startedAt;
  if (event.type === "run.completed") return event.finishedAt;
  if (
    event.type === "message.completed" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "agent.error"
  ) {
    return now().toISOString();
  }
  return null;
}

export function projectGlobalTaskLifecycle(
  event: RunScopedEvent,
  current: GlobalTaskLifecycle,
): GlobalTaskProjection["lifecycle"] {
  if (event.type === "run.started") return "running";
  if (event.type === "approval.requested") return "waiting_approval";
  if (event.type === "approval.resolved") return "running";
  if (event.type === "run.continuation") {
    return event.status === "needs_attention"
      ? "needs_attention"
      : "interrupted";
  }
  if (event.type !== "run.completed") return current;
  if (event.stopReason === "complete") return "completed";
  if (event.stopReason === "cancelled") return "cancelled";
  return "failed";
}
