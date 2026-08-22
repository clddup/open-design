import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import {
  appendLiveAgentEvent,
  pruneLiveEventsCoveredByTimeline,
  touchConversationList,
} from "./conversation-runtime-state";

describe("conversation runtime state", () => {
  it("preserves message order while coalescing only matching streamed blocks", () => {
    const events: AgentEvent[] = [
      {
        type: "message.delta",
        runId: "run_1",
        messageId: "assistant_1",
        blockId: "reasoning",
        delta: "先分析",
      },
      {
        type: "tool.requested",
        runId: "run_1",
        toolCallId: "inspect_1",
        toolName: "opendesign_inspect_document",
        input: {},
        risk: "read",
      },
    ];

    const projected = appendLiveAgentEvent(events, {
      type: "message.delta",
      runId: "run_1",
      messageId: "assistant_1",
      blockId: "reasoning",
      delta: "，再执行",
    });

    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ delta: "先分析，再执行" });
    expect(projected[1]).toMatchObject({ type: "tool.requested" });
  });

  it("removes live duplicates only after the same durable message or tool exists", () => {
    const runId = "run_1";
    const events: AgentEvent[] = [
      {
        type: "message.completed",
        runId,
        messageId: "assistant_1",
        blocks: [{ blockId: "text_1", type: "text", text: "真实回复" }],
      },
      {
        type: "tool.completed",
        runId,
        toolCallId: "tool_1",
        result: {},
      },
      {
        type: "message.completed",
        runId,
        messageId: "assistant_later",
        blocks: [{ blockId: "text_2", type: "text", text: "继续设计" }],
      },
    ];
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "message:assistant_1",
        sessionId: "conversation_1",
        runId,
        sequence: 1,
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
        type: "assistant.message",
        messageId: "assistant_1",
        blocks: [{ blockId: "text_1", type: "text", text: "真实回复" }],
      },
      {
        itemId: "tool:tool_1",
        sessionId: "conversation_1",
        runId,
        sequence: 2,
        createdAt: "2026-08-22T00:00:01.000Z",
        updatedAt: "2026-08-22T00:00:01.000Z",
        type: "tool",
        toolCallId: "tool_1",
        toolName: "opendesign_inspect_document",
        status: "completed",
        input: {},
        risk: "read",
        result: {},
      },
    ];

    expect(pruneLiveEventsCoveredByTimeline(events, timeline, runId)).toEqual([
      expect.objectContaining({ messageId: "assistant_later" }),
    ]);
  });

  it("does not let an older activity timestamp reorder conversations", () => {
    const conversations = [
      {
        conversationId: "conversation_new",
        originProjectId: "project_1",
        filedProjectId: "project_1",
        title: "Newer",
        lifecycle: "active" as const,
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T02:00:00.000Z",
      },
      {
        conversationId: "conversation_old",
        originProjectId: "project_1",
        filedProjectId: "project_1",
        title: "Older",
        lifecycle: "active" as const,
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T01:00:00.000Z",
      },
    ];

    expect(
      touchConversationList(
        conversations,
        "conversation_old",
        "2026-08-22T00:30:00.000Z",
      ),
    ).toBe(conversations);
  });
});
