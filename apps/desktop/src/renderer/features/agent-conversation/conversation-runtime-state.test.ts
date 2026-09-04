import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { MAX_REASONING_SUMMARY_CHARACTERS } from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import {
  appendLiveAgentEvent,
  mergeDurableTimeline,
  pruneLiveEventsCoveredByTimeline,
  reconcileActiveRunIdFromTimeline,
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

  it("finalizes streamed text when an empty completion marker arrives", () => {
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
      {
        ...completed,
        blocks: [{ blockId: "text_1", type: "text", text: "已经显示的回复" }],
      },
    ]);
  });

  it("does not erase a streamed reasoning block from a partial completion", () => {
    const reasoning: AgentEvent = {
      type: "message.delta",
      runId: "run_1",
      messageId: "assistant_1",
      blockId: "reasoning_0",
      blockType: "reasoning_summary",
      blockIndex: 0,
      delta: "正在分析完整需求",
    };
    const text: AgentEvent = {
      type: "message.delta",
      runId: "run_1",
      messageId: "assistant_1",
      blockId: "text_1",
      blockType: "text",
      blockIndex: 1,
      delta: "开始生成第一张画板",
    };
    const completed: AgentEvent = {
      type: "message.completed",
      runId: "run_1",
      messageId: "assistant_1",
      blocks: [{ blockId: "text_1", type: "text", text: "开始生成第一张画板" }],
    };

    expect(appendLiveAgentEvent([reasoning, text], completed)).toEqual([
      {
        ...completed,
        blocks: [
          {
            blockId: "reasoning_0",
            type: "reasoning_summary",
            status: "completed",
            summary: "正在分析完整需求",
          },
          completed.blocks[0],
        ],
      },
    ]);
  });

  it("does not duplicate split durable reasoning after streaming completes", () => {
    const summary = "分".repeat(MAX_REASONING_SUMMARY_CHARACTERS + 1);
    const delta: AgentEvent = {
      type: "message.delta",
      runId: "run_1",
      messageId: "assistant_1",
      blockId: "reasoning_0",
      blockType: "reasoning_summary",
      blockIndex: 0,
      delta: summary,
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
          summary: summary.slice(0, MAX_REASONING_SUMMARY_CHARACTERS),
        },
        {
          blockId: "reasoning_0_part_1",
          type: "reasoning_summary",
          status: "completed",
          summary: summary.slice(MAX_REASONING_SUMMARY_CHARACTERS),
        },
      ],
    };

    const result = appendLiveAgentEvent([delta], completed);
    expect(result).toEqual([completed]);
    const finalized = result[0];
    expect(finalized?.type).toBe("message.completed");
    if (finalized?.type !== "message.completed") return;
    expect(
      finalized.blocks
        .map((block) =>
          block.type === "text" ? block.text : (block.summary ?? ""),
        )
        .join(""),
    ).toBe(summary);
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

  it("retains richer live content when durable history has only part of the message", () => {
    const live: AgentEvent[] = [
      {
        type: "message.completed",
        runId: "run_finished",
        messageId: "assistant_partial",
        blocks: [
          {
            blockId: "reasoning_0",
            type: "reasoning_summary",
            status: "completed",
            summary: "完整分析",
          },
          { blockId: "text_1", type: "text", text: "开始执行" },
        ],
      },
    ];
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "message:assistant_partial",
        sessionId: "conversation_1",
        runId: "run_finished",
        sequence: 2,
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
        type: "assistant.message",
        messageId: "assistant_partial",
        blocks: [{ blockId: "text_1", type: "text", text: "开始执行" }],
      },
    ];

    expect(pruneLiveEventsCoveredByTimeline(live, timeline, null)).toEqual(
      live,
    );
  });

  it("clears a stale active Run after durable history records its terminal state", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "run:run_1",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 3,
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:01:00.000Z",
        type: "run",
        status: "error",
        startedAt: "2026-08-22T00:00:00.000Z",
        finishedAt: "2026-08-22T00:01:00.000Z",
        stopReason: "error",
      },
    ];

    expect(reconcileActiveRunIdFromTimeline("run_1", timeline)).toBeNull();
    expect(reconcileActiveRunIdFromTimeline("run_other", timeline)).toBe(
      "run_other",
    );
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
