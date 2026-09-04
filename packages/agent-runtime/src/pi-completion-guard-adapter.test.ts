import type { AgentEvent } from "@opendesign/agent-contracts";
import {
  MockModelGateway,
  type ModelGateway,
  type ModelRequest,
} from "@opendesign/model-gateway";
import {
  projectTimeline,
  type JournalEvent,
  type SessionProjection,
  type SessionStore,
} from "@opendesign/session-store";
import { describe, expect, it } from "vitest";
import type { AgentRunRequest, CompletionGuardPort } from "./index.js";
import { createOpenDesignPiAgent } from "./pi-core-adapter.js";
import { createPiModelGatewayStreamFn } from "./pi-model-gateway-adapter.js";
import { PiRunEventAdapter } from "./pi-run-event-adapter.js";

const request: AgentRunRequest = {
  runId: "run_pi_completion",
  sessionId: "conversation_pi_completion",
  prompt: "Create and review the composition",
  documentId: "document_completion",
  revision: 7,
  scope: { kind: "page", selectedNodeIds: [], pageId: "page_completion" },
  mutationTarget: { kind: "page", pageId: "page_completion" },
  modelSelection: {
    providerId: "configured-provider",
    modelId: "design-model",
    reasoningEffort: "medium",
  },
};

class MemorySessionStore implements SessionStore {
  readonly events: JournalEvent[] = [];

  append<T>(event: JournalEvent<T>): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  read(sessionId: string): Promise<JournalEvent[]> {
    return Promise.resolve(
      this.events.filter((event) => event.sessionId === sessionId),
    );
  }

  async readTimeline(sessionId: string) {
    return projectTimeline(sessionId, await this.read(sessionId));
  }

  appendNext<T>(
    sessionId: string,
    createEvent: (sequence: number) => JournalEvent<T>,
  ): Promise<JournalEvent<T>> {
    const sequence =
      this.events.filter((event) => event.sessionId === sessionId).length + 1;
    const event = createEvent(sequence);
    this.events.push(event);
    return Promise.resolve(event);
  }

  async project(sessionId: string): Promise<SessionProjection> {
    const events = await this.read(sessionId);
    return {
      sessionId,
      lastSequence: events.at(-1)?.sequence ?? 0,
      messageCount: events.filter((event) => event.type.startsWith("message."))
        .length,
      toolCallCount: 0,
      compactedRanges: [],
    };
  }
}

class RecordingGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly delegate: ModelGateway) {}

  stream(modelRequest: ModelRequest) {
    this.requests.push(modelRequest);
    return this.delegate.stream(modelRequest);
  }
}

describe("Pi completion guard adapter", () => {
  it("retains a rejected assistant response and continues with trusted feedback", async () => {
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "first",
              type: "text",
              text: "The first draft is finished.",
            },
          ],
        },
        {
          blocks: [
            {
              id: "reviewed",
              type: "text",
              text: "The reviewed composition is finished.",
            },
          ],
        },
      ]),
    );
    const reviews: Array<{ turn: number; rejectionCount: number }> = [];
    const completionGuard: CompletionGuardPort = {
      review: (context) => {
        reviews.push({
          turn: context.turn,
          rejectionCount: context.rejectionCount,
        });
        return reviews.length === 1
          ? {
              allow: false,
              message: "Capture and refine the rendered draft first.",
            }
          : { allow: true };
      },
    };
    const result = await runGuardedAgent({ gateway, completionGuard });

    expect(gateway.requests).toHaveLength(2);
    expect(reviews).toEqual([
      { turn: 1, rejectionCount: 0 },
      { turn: 2, rejectionCount: 1 },
    ]);
    expect(
      gateway.requests[1]?.messages.map((message) => message.role),
    ).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(gateway.requests[1]?.messages)).toContain(
      "Capture and refine the rendered draft first.",
    );

    const completions = result.events.filter(
      (event) => event.type === "message.completed",
    );
    expect(completions).toHaveLength(2);
    expect(completions[0]).toMatchObject({
      blocks: [
        {
          type: "text",
          text: "The first draft is finished.",
        },
      ],
    });
    expect(completions[1]).toMatchObject({
      blocks: [
        {
          type: "text",
          text: "The reviewed composition is finished.",
        },
      ],
    });
    expect(
      result.store.events.filter((event) => event.type === "message.user"),
    ).toHaveLength(1);
    expect(
      result.store.events.filter((event) => event.type === "message.assistant"),
    ).toHaveLength(2);
    const reviewEvents = result.store.events.filter(
      (event) => event.type === "completion.review",
    );
    expect(reviewEvents).toHaveLength(1);
    expect(reviewEvents[0]?.payload).toMatchObject({
      status: "rejected",
      code: "completion_guard_rejected",
      rejectionCount: 1,
      message: "Capture and refine the rendered draft first.",
    });
    expect(result.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });
  });

  it("does not charge repeated bounded input context against delivery generation", async () => {
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [{ id: "draft", type: "text", text: "Draft reviewed." }],
          usage: { inputTokens: 180_000, outputTokens: 8 },
        },
        {
          blocks: [{ id: "final", type: "text", text: "Delivery verified." }],
          usage: { inputTokens: 180_000, outputTokens: 8 },
        },
      ]),
    );
    let reviews = 0;
    const result = await runGuardedAgent({
      gateway,
      completionGuard: {
        review: () =>
          ++reviews === 1
            ? { allow: false, message: "Apply the reviewed refinement." }
            : { allow: true },
      },
      maxGeneratedTokens: 32,
    });

    expect(gateway.requests).toHaveLength(2);
    expect(reviews).toBe(2);
    expect(result.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });
  });

  it("returns a visible terminal error when the guard rejection limit is reached", async () => {
    const gateway = new RecordingGateway(
      new MockModelGateway("The unreviewed draft is finished."),
    );
    const result = await runGuardedAgent({
      gateway,
      completionGuard: {
        review: () => ({
          allow: false,
          message: "Rendered review is still missing.",
        }),
      },
      maxCompletionGuardRejections: 0,
    });

    expect(gateway.requests).toHaveLength(1);
    expect(result.events).toContainEqual({
      type: "agent.error",
      code: "completion_guard_blocked",
      message: "Rendered review is still missing.",
      runId: request.runId,
      failure: {
        code: "completion_guard_blocked",
        message: "Rendered review is still missing.",
        retryable: true,
      },
    });
    expect(result.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "error",
    });
    expect(
      result.store.events.some((event) => event.type === "message.assistant"),
    ).toBe(true);
    expect(
      result.events.filter((event) => event.type === "message.completed"),
    ).toContainEqual(
      expect.objectContaining({
        blocks: [
          expect.objectContaining({
            type: "text",
            text: "The unreviewed draft is finished.",
          }),
        ],
      }),
    );
  });

  it("retains the assistant response when completion review itself fails", async () => {
    const gateway = new RecordingGateway(
      new MockModelGateway("The provider response reached the client."),
    );
    const result = await runGuardedAgent({
      gateway,
      completionGuard: {
        review: () => {
          throw new Error("Review service unavailable");
        },
      },
    });

    const visibleEvents = result.events.filter(
      (event) =>
        event.type === "message.completed" || event.type === "agent.error",
    );
    expect(visibleEvents).toHaveLength(2);
    expect(visibleEvents[0]).toEqual(
      expect.objectContaining({
        type: "message.completed",
        blocks: [
          expect.objectContaining({
            type: "text",
            text: "The provider response reached the client.",
          }),
        ],
      }),
    );
    const errorEvent = visibleEvents[1];
    if (errorEvent?.type !== "agent.error") {
      throw new Error("Completion guard error event is missing");
    }
    expect(errorEvent.failure?.code).toBe("completion_guard_failed");
    expect(
      result.store.events.filter((event) => event.type === "message.assistant"),
    ).toHaveLength(1);
  });

  it("enforces generated-token budget before asking the completion guard", async () => {
    let reviews = 0;
    const gateway = new RecordingGateway(
      new MockModelGateway({
        blocks: [{ id: "large", type: "text", text: "Large response" }],
        usage: { inputTokens: 20, outputTokens: 40, reasoningTokens: 5 },
      }),
    );
    const result = await runGuardedAgent({
      gateway,
      completionGuard: {
        review: () => {
          reviews += 1;
          return { allow: true };
        },
      },
      maxGeneratedTokens: 30,
    });

    expect(reviews).toBe(0);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "message.completed",
        blocks: [expect.objectContaining({ text: "Large response" })],
      }),
    );
    expect(result.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "budget",
    });
  });
});

async function runGuardedAgent(options: {
  gateway: RecordingGateway;
  completionGuard: CompletionGuardPort;
  maxCompletionGuardRejections?: number;
  maxGeneratedTokens?: number;
}) {
  const store = new MemorySessionStore();
  const events: AgentEvent[] = [];
  const agentRef: {
    current?: ReturnType<typeof createOpenDesignPiAgent>;
  } = {};
  const adapter = new PiRunEventAdapter({
    request,
    sessionStore: store,
    emit: (event) => {
      events.push(event);
    },
    completionGuard: options.completionGuard,
    requestContinuation: (message) => {
      if (agentRef.current === undefined) {
        throw new Error("Pi Agent is not ready for trusted continuation");
      }
      agentRef.current.steer(message);
    },
    ...(options.maxCompletionGuardRejections === undefined
      ? {}
      : {
          maxCompletionGuardRejections: options.maxCompletionGuardRejections,
        }),
    ...(options.maxGeneratedTokens === undefined
      ? {}
      : { maxGeneratedTokens: options.maxGeneratedTokens }),
    now: () => new Date("2026-08-11T03:04:05.000Z"),
  });
  const agent = createOpenDesignPiAgent({
    initialState: {
      messages: [],
      model: {
        id: request.modelSelection.modelId,
        name: "Design model",
        api: "openai-responses",
        provider: request.modelSelection.providerId,
        baseUrl: "https://provider.invalid/v1",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 16_384,
      },
      systemPrompt: "OpenDesign completion parity",
      thinkingLevel: "medium",
      tools: [],
    },
    sessionId: request.sessionId,
    streamFn: createPiModelGatewayStreamFn({
      modelGateway: options.gateway,
      nextAttemptId: (() => {
        let sequence = 0;
        return () => `${request.runId}_attempt_${++sequence}`;
      })(),
    }),
    shouldStopAfterTurn: adapter.shouldStopAfterTurn,
  });
  agentRef.current = agent;
  const unsubscribe = agent.subscribe((event) => adapter.accept(event));
  try {
    await agent.prompt(request.prompt);
  } finally {
    unsubscribe();
    agent.abort();
    await agent.waitForIdle();
  }
  return { events, store };
}
