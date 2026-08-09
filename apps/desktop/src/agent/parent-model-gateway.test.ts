import { describe, expect, it } from "vitest";
import { ParentModelGateway } from "./parent-model-gateway";

describe("ParentModelGateway", () => {
  it("correlates Main-owned model events without receiving credentials", async () => {
    const messages: unknown[] = [];
    const gateway = new ParentModelGateway({
      postMessage: (message) => messages.push(message),
    });
    const stream = gateway.stream({
      attemptId: "attempt_1",
      sessionId: "session_1",
      modelSelection: {
        providerId: "provider_1",
        modelId: "design-model",
        reasoningEffort: "medium",
      },
      system: "System",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      signal: new AbortController().signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    const first = iterator.next();
    await Promise.resolve();
    const request = messages[0] as { requestId: string };

    expect(JSON.stringify(request)).not.toContain("apiKey");
    expect(
      gateway.handleMessage({
        type: "model.event",
        requestId: request.requestId,
        event: {
          type: "attempt.started",
          attemptId: "attempt_1",
          model: "design-model",
          identity: {
            providerId: "provider_1",
            modelId: "design-model",
            apiFormat: "openai-responses",
            reasoningEffort: "medium",
          },
        },
      }),
    ).toBe(true);

    await expect(first).resolves.toEqual({
      done: false,
      value: {
        type: "attempt.started",
        attemptId: "attempt_1",
        model: "design-model",
        identity: {
          providerId: "provider_1",
          modelId: "design-model",
          apiFormat: "openai-responses",
          reasoningEffort: "medium",
        },
      },
    });
    expect(
      gateway.handleMessage({
        type: "model.event",
        requestId: request.requestId,
        event: {
          type: "attempt.completed",
          attemptId: "attempt_1",
          stopReason: "complete",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
          },
        },
      }),
    ).toBe(true);
    expect(
      gateway.handleMessage({
        type: "model.response",
        requestId: request.requestId,
        ok: true,
      }),
    ).toBe(true);
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "attempt.completed" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
