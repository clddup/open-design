import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import {
  appendLiveAgentEvent,
  mergeDurableTimeline,
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
        blockType: "text",
        blockIndex: 0,
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
      blockType: "text",
      blockIndex: 0,
      delta: "，再执行",
    });

    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ delta: "先分析，再执行" });
    expect(projected[1]).toMatchObject({ type: "tool.requested" });
  });

  it("does not erase streamed text when an empty completion marker arrives", () => {
    const delta: AgentEvent = {
      type: "message.delta",
      runId: "run_1",
      messageId: "assistant_1",
      blockId: "text_1",
      blockType: "text",
      blockIndex: 0,
      delta: "已经显示的回复",
    };
    const completed: AgentEvent = {
      type: "message.completed",
      runId: "run_1",
      messageId: "assistant_1",
      blocks: [],
    };

    expect(appendLiveAgentEvent([delta], completed)).toEqual([
      delta,
      completed,
    ]);
  });

  it("finalizes a streamed message without moving it past later activity", () => {
    const reasoning: AgentEvent = {
      type: "message.delta",
      runId: "run_1",
      messageId: "assistant_1",
      blockId: "reasoning_0",
      blockType: "reasoning_summary",
      blockIndex: 0,
      delta: "先分析",
    };
    const tool: AgentEvent = {
      type: "tool.requested",
      runId: "run_1",
      toolCallId: "inspect_1",
      toolName: "opendesign_inspect_document",
      input: {},
      risk: "read",
    };
    const completed: AgentEvent = {
      type: "message.completed",
      runId: "run_1",
      messageId: "assistant_1",
      blocks: [
        {
          blockId: "reasoning_0",
          type: "reasoning_summary",
          status: "completed",
          summary: "先分析",
        },
      ],
    };

    expect(appendLiveAgentEvent([reasoning, tool], completed)).toEqual([
      completed,
      tool,
    ]);
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

  it("retains an inactive Run message until its durable journal item arrives", () => {
    const event: AgentEvent = {
      type: "message.completed",
      runId: "run_finished",
      messageId: "assistant_partial",
      blocks: [{ blockId: "text_1", type: "text", text: "中断前的真实回复" }],
    };

    expect(pruneLiveEventsCoveredByTimeline([event], [], null)).toEqual([
      event,
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

  it("merges durable history monotonically instead of dropping newer messages", () => {
    const older: Extract<SessionTimelineItem, { type: "assistant.message" }> = {
      itemId: "message:older",
      sessionId: "conversation_1",
      runId: "run_1",
      sequence: 1,
      createdAt: "2026-08-25T08:00:00.000Z",
      updatedAt: "2026-08-25T08:00:00.000Z",
      type: "assistant.message",
      messageId: "older",
      blocks: [{ blockId: "older_text", type: "text", text: "先分析" }],
    };
    const current: SessionTimelineItem[] = [
      older,
      {
        itemId: "message:newer",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 3,
        createdAt: "2026-08-25T08:02:00.000Z",
        updatedAt: "2026-08-25T08:02:00.000Z",
        type: "assistant.message",
        messageId: "newer",
        blocks: [{ blockId: "newer_text", type: "text", text: "继续设计" }],
      },
    ];
    const staleSnapshot: SessionTimelineItem[] = [
      {
        ...older,
        updatedAt: "2026-08-25T07:59:00.000Z",
        blocks: [{ blockId: "older_text", type: "text", text: "过期内容" }],
      },
    ];

    expect(mergeDurableTimeline(current, staleSnapshot)).toEqual(current);
  });

  it("accepts a newer terminal lifecycle update for the same durable item", () => {
    const started: SessionTimelineItem = {
      itemId: "run:run_1",
      sessionId: "conversation_1",
      runId: "run_1",
      sequence: 2,
      createdAt: "2026-08-25T08:00:00.000Z",
      updatedAt: "2026-08-25T08:00:00.000Z",
      type: "run",
      status: "started",
      startedAt: "2026-08-25T08:00:00.000Z",
    };
    const terminal: SessionTimelineItem = {
      ...started,
      sequence: 8,
      updatedAt: "2026-08-25T08:05:00.000Z",
      status: "error",
      finishedAt: "2026-08-25T08:05:00.000Z",
      stopReason: "error",
      failure: {
        code: "tool_protocol_no_progress",
        message: "Invalid tool calls",
        retryable: false,
      },
    };

    expect(mergeDurableTimeline([started], [terminal])).toEqual([terminal]);
  });
});
