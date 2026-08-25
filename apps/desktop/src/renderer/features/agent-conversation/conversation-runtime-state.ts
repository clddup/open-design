import type {
  AgentEvent,
  SelectionScope,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import type { EditorSnapshot } from "@opendesign/editor-runtime";
import type { ConversationDescriptor } from "@opendesign/workspace-contracts";

export type ConversationAgentState = {
  timeline: SessionTimelineItem[];
  events: AgentEvent[];
  activeRunId: string | null;
  error: string | null;
};

export const EMPTY_AGENT_STATE: ConversationAgentState = {
  timeline: [],
  events: [],
  activeRunId: null,
  error: null,
};

export function selectionScope(
  snapshot: EditorSnapshot,
  pageId: string,
): SelectionScope {
  const { selection } = snapshot.state;
  if (selection.nodeIds.length > 0) {
    return {
      kind: "selection",
      selectedNodeIds: [...selection.nodeIds],
      ...(selection.anchorNodeId
        ? { primaryNodeId: selection.anchorNodeId }
        : {}),
      ...(pageId ? { pageId } : {}),
    };
  }
  if (pageId) return { kind: "page", pageId, selectedNodeIds: [] };
  return { kind: "document", selectedNodeIds: [] };
}

export function updateConversationAgentState(
  current: Readonly<Record<string, ConversationAgentState>>,
  conversationId: string,
  update: (state: ConversationAgentState) => ConversationAgentState,
): Readonly<Record<string, ConversationAgentState>> {
  return {
    ...current,
    [conversationId]: update(current[conversationId] ?? EMPTY_AGENT_STATE),
  };
}

export function touchConversationList(
  current: ConversationDescriptor[],
  conversationId: string,
  updatedAt: string,
): ConversationDescriptor[] {
  const conversation = current.find(
    (candidate) => candidate.conversationId === conversationId,
  );
  if (!conversation || conversation.updatedAt >= updatedAt) return current;
  return current
    .map((candidate) =>
      candidate.conversationId === conversationId
        ? { ...candidate, updatedAt }
        : candidate,
    )
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.conversationId.localeCompare(right.conversationId),
    );
}

export function appendLiveAgentEvent(
  events: readonly AgentEvent[],
  event: AgentEvent,
): AgentEvent[] {
  if (event.type === "message.delta") {
    const index = events.findIndex(
      (candidate) =>
        candidate.type === "message.delta" &&
        candidate.runId === event.runId &&
        candidate.messageId === event.messageId &&
        candidate.blockId === event.blockId,
    );
    if (index >= 0) {
      return events.map((candidate, candidateIndex) =>
        candidateIndex === index && candidate.type === "message.delta"
          ? { ...candidate, delta: `${candidate.delta}${event.delta}` }
          : candidate,
      );
    }
  }
  if (event.type === "tool.progress") {
    return [
      ...events.filter(
        (candidate) =>
          candidate.type !== "tool.progress" ||
          candidate.toolCallId !== event.toolCallId,
      ),
      event,
    ];
  }
  if (event.type === "message.completed") {
    return [
      ...events.filter(
        (candidate) =>
          !(
            candidate.type === "message.delta" &&
            candidate.runId === event.runId &&
            candidate.messageId === event.messageId
          ),
      ),
      event,
    ];
  }
  if (event.type === "tool.completed" || event.type === "tool.failed") {
    return [
      ...events.filter(
        (candidate) =>
          candidate.type !== "tool.progress" ||
          candidate.toolCallId !== event.toolCallId,
      ),
      event,
    ];
  }
  return [...events, event];
}

export function mergeDurableTimeline(
  current: readonly SessionTimelineItem[],
  incoming: readonly SessionTimelineItem[],
): SessionTimelineItem[] {
  const merged = new Map(current.map((item) => [item.itemId, item]));
  for (const item of incoming) {
    const existing = merged.get(item.itemId);
    if (
      !existing ||
      item.updatedAt > existing.updatedAt ||
      (item.updatedAt === existing.updatedAt &&
        item.sequence >= existing.sequence)
    ) {
      merged.set(item.itemId, item);
    }
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.sequence - right.sequence || left.itemId.localeCompare(right.itemId),
  );
}

export function pruneLiveEventsCoveredByTimeline(
  events: readonly AgentEvent[],
  timeline: readonly SessionTimelineItem[],
  activeRunId: string | null,
): AgentEvent[] {
  const durableMessages = new Set(
    timeline.flatMap((item) =>
      item.type === "assistant.message" ? [item.messageId] : [],
    ),
  );
  const durableTools = new Map(
    timeline.flatMap((item) =>
      item.type === "tool" ? [[item.toolCallId, item.status] as const] : [],
    ),
  );
  const durableApprovals = new Map(
    timeline.flatMap((item) =>
      item.type === "approval" ? [[item.approvalId, item.status] as const] : [],
    ),
  );
  const durableRuns = new Map(
    timeline.flatMap((item) =>
      item.type === "run" ? [[item.runId, item.status] as const] : [],
    ),
  );
  return events.filter((event) => {
    if ("runId" in event && event.runId !== activeRunId) return false;
    if (
      (event.type === "message.delta" || event.type === "message.completed") &&
      durableMessages.has(event.messageId)
    ) {
      return false;
    }
    if (
      event.type === "tool.requested" ||
      event.type === "tool.progress" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed"
    ) {
      const status = durableTools.get(event.toolCallId);
      if (status === "completed" || status === "failed") return false;
    }
    if (event.type === "approval.requested") {
      return !durableApprovals.has(event.approvalId);
    }
    if (event.type === "approval.resolved") {
      return durableApprovals.get(event.approvalId) !== "resolved";
    }
    if (event.type === "run.started") return !durableRuns.has(event.runId);
    if (event.type === "run.completed") {
      const status = durableRuns.get(event.runId);
      return status === undefined || status === "started";
    }
    return true;
  });
}

export function isDurableAgentCheckpoint(event: AgentEvent): boolean {
  return (
    event.type === "run.started" ||
    event.type === "message.completed" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "approval.requested" ||
    event.type === "approval.resolved"
  );
}

export function agentEventActivityAt(event: AgentEvent): string | null {
  if (event.type === "run.started") return event.startedAt;
  if (event.type === "run.completed") return event.finishedAt;
  if (
    event.type === "message.completed" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "agent.error"
  ) {
    return new Date().toISOString();
  }
  return null;
}
