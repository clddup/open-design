import type {
  CanonicalStreamEvent,
  ModelGateway,
  ModelRequest,
} from "@opendesign/model-gateway";
import { describe, expect, it } from "vitest";
import { streamWithContextOverflowRecovery } from "./pi-context-overflow-recovery.js";
import type { PiModelContextProjectionPort } from "./pi-model-gateway-ports.js";

const request: ModelRequest = {
  attemptId: "attempt_context_recovery",
  modelSelection: { providerId: "provider", modelId: "model" },
  system: "system",
  messages: [
    { role: "user", content: "old context" },
    { role: "user", content: "current request" },
  ],
  tools: [],
  signal: new AbortController().signal,
};

describe("provider context overflow recovery", () => {
  it("discards the empty failed attempt and retries once with compacted context", async () => {
    const gateway = new OverflowThenSuccessGateway();
    const projection = recoveryProjection();

    const events = await collect(
      streamWithContextOverflowRecovery(
        gateway,
        request,
        projection,
        () => "attempt_context_recovery_retry",
      ),
    );

    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests.map((item) => item.attemptId)).toEqual([
      "attempt_context_recovery",
      "attempt_context_recovery_retry",
    ]);
    expect(gateway.requests[1]?.messages).toEqual([
      { role: "user", content: "current request" },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "attempt.started",
      "block.started",
      "block.delta",
      "block.completed",
      "attempt.completed",
    ]);
    expect(events.every((event) => event.attemptId === request.attemptId)).toBe(
      true,
    );
  });

  it("does not replay after visible assistant content has started", async () => {
    const gateway = new SemanticThenOverflowGateway();
    let recoveryCalls = 0;
    const projection = recoveryProjection(() => {
      recoveryCalls += 1;
    });

    const events = await collect(
      streamWithContextOverflowRecovery(
        gateway,
        request,
        projection,
        () => "attempt_context_recovery_retry",
      ),
    );

    expect(gateway.requests).toHaveLength(1);
    expect(recoveryCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({
      type: "attempt.failed",
      error: { code: "context_too_large" },
    });
  });

  it("exposes the second overflow instead of looping", async () => {
    const gateway = new AlwaysOverflowGateway();

    const events = await collect(
      streamWithContextOverflowRecovery(
        gateway,
        request,
        recoveryProjection(),
        () => "attempt_context_recovery_retry",
      ),
    );

    expect(gateway.requests).toHaveLength(2);
    expect(
      events.filter((event) => event.type === "attempt.failed"),
    ).toHaveLength(1);
  });

  it("does not apply context recovery to ordinary provider failures", async () => {
    let recoveryCalls = 0;
    const gateway = new ProviderFailureGateway();

    const events = await collect(
      streamWithContextOverflowRecovery(
        gateway,
        request,
        recoveryProjection(() => {
          recoveryCalls += 1;
        }),
        () => "unused_retry",
      ),
    );

    expect(gateway.requests).toHaveLength(1);
    expect(recoveryCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({
      type: "attempt.failed",
      error: { code: "provider_error" },
    });
  });
});

class OverflowThenSuccessGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  async *stream(modelRequest: ModelRequest) {
    await Promise.resolve();
    this.requests.push(modelRequest);
    yield started(modelRequest);
    if (this.requests.length === 1) {
      yield overflow(modelRequest);
      return;
    }
    yield {
      type: "block.started" as const,
      attemptId: modelRequest.attemptId,
      blockId: "text",
      kind: "text" as const,
    };
    yield {
      type: "block.delta" as const,
      attemptId: modelRequest.attemptId,
      blockId: "text",
      delta: "Recovered",
    };
    yield {
      type: "block.completed" as const,
      attemptId: modelRequest.attemptId,
      block: { id: "text", type: "text" as const, text: "Recovered" },
    };
    yield completed(modelRequest);
  }
}

class SemanticThenOverflowGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  async *stream(modelRequest: ModelRequest) {
    await Promise.resolve();
    this.requests.push(modelRequest);
    yield started(modelRequest);
    yield {
      type: "block.started" as const,
      attemptId: modelRequest.attemptId,
      blockId: "visible",
      kind: "text" as const,
    };
    yield {
      type: "block.delta" as const,
      attemptId: modelRequest.attemptId,
      blockId: "visible",
      delta: "Visible",
    };
    yield overflow(modelRequest);
  }
}

class AlwaysOverflowGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  async *stream(modelRequest: ModelRequest) {
    await Promise.resolve();
    this.requests.push(modelRequest);
    yield started(modelRequest);
    yield overflow(modelRequest);
  }
}

class ProviderFailureGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  async *stream(modelRequest: ModelRequest) {
    await Promise.resolve();
    this.requests.push(modelRequest);
    yield started(modelRequest);
    yield {
      type: "attempt.failed" as const,
      attemptId: modelRequest.attemptId,
      error: {
        code: "provider_error",
        message: "Service unavailable",
        retryable: true,
      },
    };
  }
}

function recoveryProjection(
  onRecover?: () => void,
): PiModelContextProjectionPort {
  return {
    beforeProviderTurn: () => undefined,
    attachmentsFor: () => [],
    recoverProviderContextOverflow(modelRequest) {
      onRecover?.();
      return { ...modelRequest, messages: modelRequest.messages.slice(1) };
    },
  };
}

function started(modelRequest: ModelRequest): CanonicalStreamEvent {
  return {
    type: "attempt.started",
    attemptId: modelRequest.attemptId,
    model: modelRequest.modelSelection.modelId,
    identity: {
      ...modelRequest.modelSelection,
      apiFormat: "openai-responses",
    },
  };
}

function overflow(modelRequest: ModelRequest): CanonicalStreamEvent {
  return {
    type: "attempt.failed",
    attemptId: modelRequest.attemptId,
    error: {
      code: "context_too_large",
      message: "Maximum context length exceeded",
      retryable: true,
    },
  };
}

function completed(modelRequest: ModelRequest): CanonicalStreamEvent {
  return {
    type: "attempt.completed",
    attemptId: modelRequest.attemptId,
    stopReason: "complete",
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    },
  };
}

async function collect(
  stream: AsyncIterable<CanonicalStreamEvent>,
): Promise<CanonicalStreamEvent[]> {
  const events: CanonicalStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
