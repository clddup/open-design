import { describe, expect, it } from "vitest";
import type { JournalEvent } from "@opendesign/session-store";
import {
  canonicalUserMessage,
  restoreModelMessages,
} from "./model-message-projection.js";

describe("canonicalUserMessage", () => {
  it("exposes stable Conversation attachment IDs beside multimodal content", () => {
    const attachmentId = `image_${"a".repeat(64)}`;
    const message = canonicalUserMessage("Continue this design", [
      {
        attachmentId,
        name: "reference.png",
        mimeType: "image/png",
        byteSize: 4_096,
      },
    ]);

    const [textBlock, imageBlock] = message.content;
    if (
      typeof textBlock !== "object" ||
      textBlock === null ||
      textBlock.type !== "text"
    ) {
      throw new Error("Expected text block");
    }
    expect(textBlock.type).toBe("text");
    expect(textBlock.text).toContain(`attachmentId=${attachmentId}`);
    expect(imageBlock).toMatchObject({ type: "image_ref", attachmentId });
  });
});

describe("restoreModelMessages", () => {
  it("omits an interrupted tool call that has no terminal result", () => {
    const base = {
      sessionId: "session_1",
      runId: "run_1",
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    const events: JournalEvent[] = [
      {
        ...base,
        eventId: "event_1",
        sequence: 1,
        type: "message.assistant",
        payload: {
          messageId: "assistant_1",
          blocks: [{ blockId: "text_1", type: "text", text: "先检查画布" }],
        },
      },
      {
        ...base,
        eventId: "event_2",
        sequence: 2,
        type: "tool.requested",
        payload: {
          toolCallId: "call_1",
          toolName: "opendesign_inspect_document",
          input: {},
          risk: "read",
        },
      },
      {
        ...base,
        runId: "run_2",
        eventId: "event_3",
        sequence: 3,
        type: "message.user",
        payload: { messageId: "user_2", content: "继续" },
      },
    ];

    expect(restoreModelMessages(events)).toEqual([
      {
        role: "assistant",
        blocks: [{ id: "text_1", type: "text", text: "先检查画布" }],
      },
      { role: "user", content: "继续" },
    ]);
  });

  it("namespaces reused historical tool-call IDs by journal event", () => {
    const events = [1, 2].flatMap((run, index): JournalEvent[] => {
      const runId = `run_${run}`;
      const sequence = index * 2 + 1;
      return [
        {
          eventId: `event_${sequence}`,
          sessionId: "session_1",
          runId,
          sequence,
          type: "tool.requested",
          createdAt: "2026-09-04T00:00:00.000Z",
          payload: {
            toolCallId: "call_1",
            toolName: "opendesign_inspect_document",
            input: {},
            risk: "read",
          },
        },
        {
          eventId: `event_${sequence + 1}`,
          sessionId: "session_1",
          runId,
          sequence: sequence + 1,
          type: "tool.completed",
          createdAt: "2026-09-04T00:00:00.000Z",
          payload: { toolCallId: "call_1", result: { run } },
        },
      ];
    });

    const projected = restoreModelMessages(events);
    expect(
      projected.flatMap((message) =>
        message.role === "assistant"
          ? message.blocks.flatMap((block) =>
              block.type === "tool_call" ? [block.toolCallId] : [],
            )
          : [],
      ),
    ).toEqual(["history_1_call_1", "history_3_call_1"]);
    expect(
      projected.flatMap((message) =>
        message.role === "tool" ? [message.toolCallId] : [],
      ),
    ).toEqual(["history_1_call_1", "history_3_call_1"]);
  });

  it("keeps rejected Assistant text and appends the trusted host review", () => {
    const base = {
      sessionId: "session_1",
      runId: "run_1",
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    const events: JournalEvent[] = [
      {
        ...base,
        eventId: "event_1",
        sequence: 1,
        type: "message.assistant",
        payload: {
          messageId: "assistant_1",
          blocks: [
            {
              blockId: "text_1",
              type: "text",
              text: "我已经完成当前设计。",
            },
          ],
        },
      },
      {
        ...base,
        eventId: "event_2",
        sequence: 2,
        type: "completion.review",
        payload: {
          assistantMessageId: "assistant_1",
          status: "rejected",
          code: "completion_guard_rejected",
          message: "当前交付仍缺少一个真实画板。",
          rejectionCount: 1,
        },
      },
    ];

    const messages = restoreModelMessages(events);
    expect(messages[0]).toEqual({
      role: "assistant",
      blocks: [{ id: "text_1", type: "text", text: "我已经完成当前设计。" }],
    });
    expect(messages[1]?.role).toBe("user");
    if (messages[1]?.role !== "user") return;
    expect(messages[1].content).toContain("当前交付仍缺少一个真实画板。");
  });
});
