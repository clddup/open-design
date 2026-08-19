import {
  MAX_REASONING_SUMMARY_CHARACTERS,
  isAgentEvent,
} from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import { normalizeSessionHistory } from "./session-history.js";

const timestamp = "2026-08-18T12:00:00.000Z";

describe("Agent session history normalization", () => {
  it("migrates an oversized persisted reasoning block without hiding it", () => {
    const summary = "reasoning".repeat(
      Math.ceil((MAX_REASONING_SUMMARY_CHARACTERS + 1) / 9),
    );
    const timeline = normalizeSessionHistory([
      {
        type: "assistant.message",
        itemId: "message:message_1",
        sessionId: "session_1",
        runId: "run_1",
        sequence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        messageId: "message_1",
        blocks: [
          {
            blockId: "reasoning_1",
            type: "reasoning_summary",
            status: "completed",
            summary,
          },
        ],
      },
    ]);

    const message = timeline[0];
    expect(message?.type).toBe("assistant.message");
    if (message?.type !== "assistant.message") return;
    expect(
      message.blocks
        .filter((block) => block.type === "reasoning_summary")
        .map((block) => block.summary ?? "")
        .join(""),
    ).toBe(summary);
    expect(
      isAgentEvent({
        type: "session.history",
        requestId: "history_1",
        sessionId: "session_1",
        timeline,
      }),
    ).toBe(true);
  });

  it("keeps a legacy tool failure while dropping only incompatible details", () => {
    const timeline = normalizeSessionHistory([
      {
        type: "tool",
        itemId: "tool:call_1",
        sessionId: "session_1",
        runId: "run_1",
        sequence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        toolCallId: "call_1",
        toolName: "opendesign_inspect_document",
        input: {},
        risk: "read",
        status: "failed",
        error: {
          code: "legacy_error",
          message: "Legacy failure remains visible",
          details: { legacy: true },
        },
      },
    ]);

    expect(timeline).toMatchObject([
      {
        type: "tool",
        status: "failed",
        error: {
          code: "legacy_error",
          message: "Legacy failure remains visible",
        },
      },
    ]);
    expect(
      (timeline[0]?.type === "tool" && timeline[0].error) || undefined,
    ).not.toHaveProperty("details");
  });

  it("recovers a legacy oversized tool failure without discarding session history", () => {
    const timeline = normalizeSessionHistory([
      {
        type: "tool",
        itemId: "tool:call_oversized",
        sessionId: "session_1",
        runId: "run_1",
        sequence: 59,
        createdAt: timestamp,
        updatedAt: timestamp,
        toolCallId: "call_oversized",
        toolName: "opendesign_design_checkpoint",
        input: {},
        risk: "design_write",
        status: "failed",
        error: {
          code: "invalid_tool_input",
          message: `Validation failed\n${"x".repeat(34_870)}`,
          recoverable: true,
        },
      },
    ]);

    const tool = timeline[0];
    expect(tool?.type).toBe("tool");
    if (tool?.type !== "tool") return;
    expect(tool.error?.message).toHaveLength(20_000);
    expect(tool.error?.message).toContain("Validation failed");
    expect(tool.error?.message).toContain(
      "[OpenDesign truncated legacy tool diagnostics]",
    );
    expect(
      isAgentEvent({
        type: "session.history",
        requestId: "history_1",
        sessionId: "session_1",
        timeline,
      }),
    ).toBe(true);
  });
});
