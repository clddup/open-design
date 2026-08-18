import {
  MAX_ASSISTANT_TEXT_BLOCK_CHARACTERS,
  MAX_REASONING_SUMMARY_CHARACTERS,
  isAgentEvent,
} from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import { normalizeAssistantTimelineBlocks } from "./timeline-blocks.js";

describe("assistant timeline block normalization", () => {
  it("preserves oversized text and reasoning as protocol-valid parts", () => {
    const text = `${"t".repeat(MAX_ASSISTANT_TEXT_BLOCK_CHARACTERS - 1)}😀tail`;
    const summary = `${"r".repeat(MAX_REASONING_SUMMARY_CHARACTERS - 1)}😀tail`;
    const blocks = normalizeAssistantTimelineBlocks([
      { blockId: "text", type: "text", text },
      {
        blockId: "reasoning",
        type: "reasoning_summary",
        status: "completed",
        summary,
      },
    ]);

    expect(
      blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(""),
    ).toBe(text);
    expect(
      blocks
        .filter((block) => block.type === "reasoning_summary")
        .map((block) => block.summary ?? "")
        .join(""),
    ).toBe(summary);
    expect(
      blocks.every(
        (block) =>
          block.blockId.length <= 256 &&
          (block.type === "text"
            ? block.text.length <= MAX_ASSISTANT_TEXT_BLOCK_CHARACTERS
            : (block.summary?.length ?? 0) <= MAX_REASONING_SUMMARY_CHARACTERS),
      ),
    ).toBe(true);
    expect(
      isAgentEvent({
        type: "message.completed",
        runId: "run_1",
        messageId: "message_1",
        blocks,
      }),
    ).toBe(true);
  });

  it("bounds provider-derived block ids without collisions", () => {
    const blockId = "provider_block_".repeat(32);
    const blocks = normalizeAssistantTimelineBlocks([
      {
        blockId,
        type: "reasoning_summary",
        status: "completed",
        summary: "r".repeat(MAX_REASONING_SUMMARY_CHARACTERS + 1),
      },
    ]);

    expect(blocks).toHaveLength(2);
    expect(new Set(blocks.map((block) => block.blockId)).size).toBe(2);
    expect(blocks.every((block) => block.blockId.length <= 256)).toBe(true);
  });
});
