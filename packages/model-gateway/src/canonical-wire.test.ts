import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  CanonicalStreamEventSchema,
  SerializableModelRequestSchema,
  type CanonicalStreamEvent,
} from "./index.js";

describe("canonical model wire schemas", () => {
  it("accepts every canonical stream event discriminant", () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 8,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      reasoningTokens: 4,
    };
    const events: CanonicalStreamEvent[] = [
      {
        type: "attempt.started",
        attemptId: "attempt_1",
        model: "design-model",
        identity: {
          providerId: "provider_1",
          modelId: "design-model",
          apiFormat: "openai-responses",
        },
      },
      {
        type: "attempt.retrying",
        attemptId: "attempt_1",
        retry: 1,
        maxRetries: 5,
        delayMs: 500,
      },
      {
        type: "attempt.recovered",
        attemptId: "attempt_1",
        retriesUsed: 1,
        maxRetries: 5,
      },
      {
        type: "block.started",
        attemptId: "attempt_1",
        blockId: "block_1",
        kind: "text",
      },
      {
        type: "block.delta",
        attemptId: "attempt_1",
        blockId: "block_1",
        delta: "Hello",
      },
      {
        type: "block.completed",
        attemptId: "attempt_1",
        block: { id: "block_1", type: "text", text: "Hello" },
      },
      {
        type: "attempt.completed",
        attemptId: "attempt_1",
        stopReason: "complete",
        providerStopReason: "stop",
        usage,
      },
      {
        type: "attempt.failed",
        attemptId: "attempt_1",
        error: {
          code: "provider_timeout",
          message: "Provider timed out",
          retryable: true,
          timeout: { phase: "stream-idle", thresholdMs: 120_000 },
        },
      },
    ];

    expect(
      events.every((event) => Value.Check(CanonicalStreamEventSchema, event)),
    ).toBe(true);
    expect(
      Value.Check(CanonicalStreamEventSchema, {
        ...events[0],
        credential: "secret",
      }),
    ).toBe(false);
    expect(
      Value.Check(CanonicalStreamEventSchema, {
        type: "block.started",
        attemptId: "attempt_1",
        blockId: "block_1",
        kind: "unknown",
      }),
    ).toBe(false);
  });

  it("owns the serializable request envelope and canonical message unions", () => {
    const request = {
      attemptId: "attempt_1",
      sessionId: "conversation_1",
      latencyProfile: "interactive",
      modelSelection: {
        providerId: "provider_1",
        modelId: "design-model",
        reasoningEffort: "high",
      },
      system: "Use tools.",
      messages: [
        { role: "user", content: "Create a design" },
        {
          role: "assistant",
          blocks: [
            {
              id: "tool_block",
              type: "tool_call",
              toolCallId: "tool_1",
              name: "design.edit",
              input: { target: "frame_1" },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "tool_1",
          toolName: "design.edit",
          content: { ok: true },
          isError: false,
        },
      ],
      tools: [
        {
          name: "design.edit",
          description: "Edit a design",
          inputSchema: { type: "object" },
        },
      ],
    };

    expect(Value.Check(SerializableModelRequestSchema, request)).toBe(true);
    expect(
      Value.Check(SerializableModelRequestSchema, {
        ...request,
        credentials: "secret",
      }),
    ).toBe(false);
  });
});
