import type {
  AgentEvent,
  AssistantTimelineBlock,
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
        candidate.blockId === event.blockId &&
        candidate.blockType === event.blockType &&
        candidate.blockIndex === event.blockIndex,
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
    const matchingDeltas = events.filter(
      (
        candidate,
      ): candidate is Extract<AgentEvent, { type: "message.delta" }> =>
        isMatchingMessageDelta(candidate, event),
    );
    const firstDeltaIndex = events.findIndex((candidate) =>
      isMatchingMessageDelta(candidate, event),
    );
    if (firstDeltaIndex < 0) return [...events, event];
    const completed = mergeAssistantCompletion(event, matchingDeltas);
    return events.flatMap((candidate, index) => {
      if (index === firstDeltaIndex) return [completed];
      return isMatchingMessageDelta(candidate, event) ? [] : [candidate];
    });
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
  const durableMessages = new Map(
    timeline.flatMap((item) =>
      item.type === "assistant.message"
        ? ([[item.messageId, item.blocks]] as const)
        : [],
    ),
  );
  const durableTools = new Map(
    timeline.flatMap((item) =>
      item.type === "tool"
        ? [
            [
              `${item.runId ?? "unknown-run"}:${item.toolCallId}`,
              item.status,
            ] as const,
          ]
        : [],
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
    if (
      (event.type === "message.delta" || event.type === "message.completed") &&
      durableAssistantCoversEvent(durableMessages.get(event.messageId), event)
    ) {
      return false;
    }
    if (
      event.type === "tool.requested" ||
      event.type === "tool.progress" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed"
    ) {
      const status = durableTools.get(`${event.runId}:${event.toolCallId}`);
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
    if (
      "runId" in event &&
      event.runId !== activeRunId &&
      (event.type === "model.retrying" ||
        event.type === "model.recovered" ||
        event.type === "run.continuation")
    ) {
      return false;
    }
    if (event.type === "agent.error" && event.runId) {
      const status = durableRuns.get(event.runId);
      return status === undefined || status === "started";
    }
    return true;
  });
}

export function reconcileActiveRunIdFromTimeline(
  activeRunId: string | null,
  timeline: readonly SessionTimelineItem[],
): string | null {
  if (!activeRunId) return null;
  const run = [...timeline]
    .reverse()
    .find(
      (item): item is Extract<SessionTimelineItem, { type: "run" }> =>
        item.type === "run" && item.runId === activeRunId,
    );
  return run && run.status !== "started" ? null : activeRunId;
}

function isMatchingMessageDelta(
  candidate: AgentEvent,
  completed: Extract<AgentEvent, { type: "message.completed" }>,
): boolean {
  return (
    candidate.type === "message.delta" &&
    candidate.runId === completed.runId &&
    candidate.messageId === completed.messageId
  );
}

function mergeAssistantCompletion(
  event: Extract<AgentEvent, { type: "message.completed" }>,
  deltas: readonly Extract<AgentEvent, { type: "message.delta" }>[],
): Extract<AgentEvent, { type: "message.completed" }> {
  const blocksById = new Map<
    string,
    { block: AssistantTimelineBlock; order: number }
  >();
  const consumedCompletedIds = new Set<string>();
  for (const delta of deltas) {
    const streamed = timelineBlockFromDelta(delta);
    const completed = assistantBlockParts(event.blocks, delta.blockId);
    if (
      assistantBlocksContent(completed).length >=
      assistantBlockContent(streamed).length
    ) {
      continue;
    }
    completed.forEach((block) => consumedCompletedIds.add(block.blockId));
    blocksById.set(delta.blockId, {
      block: streamed,
      order: delta.blockIndex,
    });
  }
  event.blocks.forEach((block, index) => {
    if (
      !consumedCompletedIds.has(block.blockId) &&
      !blocksById.has(block.blockId)
    ) {
      blocksById.set(block.blockId, { block, order: index });
    }
  });
  return {
    ...event,
    blocks: [...blocksById.values()]
      .sort((left, right) => left.order - right.order)
      .map(({ block }) => block),
  };
}

function timelineBlockFromDelta(
  event: Extract<AgentEvent, { type: "message.delta" }>,
): AssistantTimelineBlock {
  return event.blockType === "text"
    ? { blockId: event.blockId, type: "text", text: event.delta }
    : {
        blockId: event.blockId,
        type: "reasoning_summary",
        status: "completed",
        summary: event.delta,
      };
}

function durableAssistantCoversEvent(
  durable: readonly AssistantTimelineBlock[] | undefined,
  event: Extract<AgentEvent, { type: "message.delta" | "message.completed" }>,
): boolean {
  if (!durable) return false;
  const visible =
    event.type === "message.delta"
      ? [timelineBlockFromDelta(event)]
      : event.blocks.filter((block) => assistantBlockContent(block).length > 0);
  return visible.every((block) => {
    const persisted = assistantBlockParts(durable, block.blockId);
    return assistantBlocksContent(persisted).includes(
      assistantBlockContent(block),
    );
  });
}

function assistantBlockParts(
  blocks: readonly AssistantTimelineBlock[],
  blockId: string,
): AssistantTimelineBlock[] {
  return blocks.filter(
    (block) =>
      block.blockId === blockId || block.blockId.startsWith(`${blockId}_part_`),
  );
}

function assistantBlocksContent(
  blocks: readonly AssistantTimelineBlock[],
): string {
  return blocks.map(assistantBlockContent).join("");
}

function assistantBlockContent(block: AssistantTimelineBlock): string {
  return block.type === "text" ? block.text : (block.summary ?? "");
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
