import { describe, expect, it } from "vitest";
import {
  MockModelGateway,
  ModelResponseAccumulator,
  type CanonicalStreamEvent,
} from "./index.js";

const signal = new AbortController().signal;

describe("model gateway canonical responses", () => {
  it("accumulates completed text and tool calls", async () => {
    const gateway = new MockModelGateway({
      providerRequestId: "provider_request_1",
      blocks: [
        { id: "text", type: "text", text: "I will align the selection." },
        {
          id: "tool",
          type: "tool_call",
          toolCallId: "tool_align_1",
          name: "design.align",
          input: { alignment: "left" },
        },
      ],
      stopReason: "tool_use",
      usage: { inputTokens: 12, outputTokens: 8, cacheReadTokens: 4 },
    });
    const accumulator = new ModelResponseAccumulator("attempt_1");

    for await (const event of gateway.stream({
      attemptId: "attempt_1",
      sessionId: "session_1",
      modelSelection: {
        providerId: "mock",
        modelId: "design",
        reasoningEffort: "medium",
      },
      system: "system",
      messages: [{ role: "user", content: "align" }],
      tools: [],
      signal,
    })) {
      accumulator.add(event);
    }

    expect(accumulator.result()).toMatchObject({
      providerRequestId: "provider_request_1",
      identity: { providerId: "mock", modelId: "design" },
      stopReason: "tool_use",
      usage: { inputTokens: 12, outputTokens: 8, cacheReadTokens: 4 },
      blocks: [
        { type: "text", text: "I will align the selection." },
        {
          type: "tool_call",
          toolCallId: "tool_align_1",
          name: "design.align",
          input: { alignment: "left" },
        },
      ],
    });
  });

  it("rejects events from a different attempt and incomplete responses", () => {
    const accumulator = new ModelResponseAccumulator("attempt_1");
    const event: CanonicalStreamEvent = {
      type: "attempt.started",
      attemptId: "attempt_2",
      model: "other",
      identity: {
        providerId: "provider_2",
        modelId: "other",
        apiFormat: "openai-responses",
      },
    };

    expect(() => accumulator.add(event)).toThrow("Attempt mismatch");
    expect(() => accumulator.result()).toThrow("did not complete");
  });
});
