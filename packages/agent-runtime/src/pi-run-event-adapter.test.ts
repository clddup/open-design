import type { AgentEvent } from "@opendesign/agent-contracts";
import {
  MockModelGateway,
  type CanonicalStreamEvent,
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
import { type AgentRunRequest, type ToolExecutionEvent } from "./index.js";
import { createOpenDesignPiAgent } from "./pi-core-adapter.js";
import {
  createPiModelFailurePort,
  createPiModelGatewayStreamFn,
} from "./pi-model-gateway-adapter.js";
import { PiRunEventAdapter } from "./pi-run-event-adapter.js";
import { OpenDesignPiRuntime } from "./pi-runtime.js";

const request: AgentRunRequest = {
  runId: "run_pi_parity",
  sessionId: "conversation_pi_parity",
  prompt: "Review the current design",
  documentId: "document_parity",
  revision: 12,
  scope: {
    kind: "page",
    selectedNodeIds: [],
    pageId: "page_parity",
  },
  mutationTarget: { kind: "page", pageId: "page_parity" },
  modelSelection: {
    providerId: "configured-provider",
    modelId: "design-model",
    reasoningEffort: "medium",
  },
};

const fixedNow = () => new Date("2026-08-11T01:02:03.000Z");

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
      this.events
        .filter((event) => event.sessionId === sessionId)
        .reduce((maximum, event) => Math.max(maximum, event.sequence), 0) + 1;
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
      toolCallCount: events.filter((event) => event.type === "tool.requested")
        .length,
      compactedRanges: [],
    };
  }
}

describe("Pi run event adapter", () => {
  it("matches the composed production runtime's public events and durable journal for a model turn", async () => {
    const response = {
      blocks: [
        {
          id: "reasoning",
          type: "reasoning_summary" as const,
          status: "completed" as const,
          summary: "Inspect hierarchy and visual balance.",
        },
        {
          id: "answer",
          type: "text" as const,
          text: "The current design has a clear hierarchy.",
        },
      ],
      stopReason: "complete" as const,
      providerRequestId: "response_parity",
    };
    const production = await runProduction(new MockModelGateway(response));
    const pi = await runPi(new MockModelGateway(response));

    expect(normalizePublicEvents(pi.events)).toEqual(
      normalizePublicEvents(production.events),
    );
    expect(normalizeJournal(pi.store.events)).toEqual(
      normalizeJournal(production.store.events),
    );
    expect(await pi.store.readTimeline(request.sessionId)).toMatchObject([
      { type: "run", status: "completed" },
      { type: "user.message", content: request.prompt },
      {
        type: "assistant.message",
        blocks: [
          {
            type: "reasoning_summary",
            summary: "Inspect hierarchy and visual balance.",
          },
          {
            type: "text",
            text: "The current design has a clear hierarchy.",
          },
        ],
      },
    ]);
  });

  it("matches the current Runtime's visible error and terminal journal state", async () => {
    const production = await runProduction(createFailingGateway());
    const pi = await runPi(createFailingGateway());

    expect(normalizePublicEvents(pi.events)).toEqual(
      normalizePublicEvents(production.events),
    );
    expect(normalizeJournal(pi.store.events)).toEqual(
      normalizeJournal(production.store.events),
    );
    expect(pi.events).toContainEqual({
      type: "agent.error",
      code: "upstream_error",
      message: "Provider failed",
      runId: request.runId,
      failure: {
        code: "upstream_error",
        message: "Provider failed",
        retryable: true,
        provider: "configured-provider",
      },
    });
    expect(pi.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "error",
    });
    const timeline = await pi.store.readTimeline(request.sessionId);
    expect(timeline.find((item) => item.type === "run")).toMatchObject({
      type: "run",
      status: "error",
      failure: { code: "upstream_error" },
    });
  });

  it("surfaces a tool-use stop without a tool call through the production composition", async () => {
    const response = {
      blocks: [
        {
          id: "invalid_tool_stop",
          type: "text" as const,
          text: "I will call a tool.",
        },
      ],
      stopReason: "tool_use" as const,
    };
    const production = await runProduction(new MockModelGateway(response));
    const pi = await runPi(new MockModelGateway(response));

    expect(normalizePublicEvents(pi.events)).toEqual(
      normalizePublicEvents(production.events),
    );
    expect(normalizeJournal(pi.store.events)).toEqual(
      normalizeJournal(production.store.events),
    );
    expect(pi.events).toContainEqual({
      type: "agent.error",
      code: "invalid_model_response",
      message: "Model stopped for tool use without a tool call",
      runId: request.runId,
      failure: {
        code: "invalid_model_response",
        message: "Model stopped for tool use without a tool call",
        retryable: true,
      },
    });
  });

  it("fails closed on out-of-order lifecycle and unadapted tool events", async () => {
    const store = new MemorySessionStore();
    const adapter = new PiRunEventAdapter({
      request,
      sessionStore: store,
      emit: () => undefined,
      now: fixedNow,
    });

    await expect(adapter.accept({ type: "turn_start" })).rejects.toThrow(
      "before agent_start",
    );
    await adapter.accept({ type: "agent_start" });
    await expect(adapter.accept({ type: "agent_start" })).rejects.toThrow(
      "duplicate agent_start",
    );
    await expect(
      adapter.accept({
        type: "tool_execution_start",
        toolCallId: "pending_tool",
        toolName: "opendesign_probe",
        args: {},
      }),
    ).rejects.toThrow("production tool adapter");
  });

  it("finalizes a pending adapted tool when Pi reaches agent_end unexpectedly", async () => {
    const store = new MemorySessionStore();
    const events: AgentEvent[] = [];
    const definition = {
      name: "opendesign_probe",
      description: "Probe pending tool recovery.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      risk: "read" as const,
      approval: "never" as const,
      validateInput: (input: unknown) =>
        !!input && typeof input === "object" && Object.keys(input).length === 0,
    };
    const adapter = new PiRunEventAdapter({
      request,
      sessionStore: store,
      emit: (event) => {
        events.push(event);
      },
      toolDefinitions: [definition],
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield { type: "progress", message: "Unexpected", progress: 0 };
          throw new Error("Tool executor should not run");
        },
      },
      now: fixedNow,
    });

    await adapter.accept({ type: "agent_start" });
    await adapter.accept({
      type: "message_start",
      message: { role: "user", content: request.prompt, timestamp: 1 },
    });
    await adapter.accept({
      type: "message_end",
      message: { role: "user", content: request.prompt, timestamp: 1 },
    });
    await adapter.accept({
      type: "tool_execution_start",
      toolCallId: "pending_probe",
      toolName: definition.name,
      args: {},
    });
    await adapter.accept({ type: "agent_end", messages: [] });

    expect(events).toContainEqual({
      type: "tool.failed",
      runId: request.runId,
      toolCallId: "pending_probe",
      code: "run_error",
      message: "Tool call did not complete because the run ended",
      retryable: false,
      recoverable: false,
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "error",
    });
    expect(store.events.map((event) => event.type)).toContain("tool.failed");
  });
});

async function runProduction(modelGateway: ModelGateway) {
  const store = new MemorySessionStore();
  const runtime = new OpenDesignPiRuntime({
    modelGateway,
    sessionStore: store,
    now: fixedNow,
  });
  const events: AgentEvent[] = [];
  for await (const event of runtime.run(request)) events.push(event);
  return { events, store };
}

async function runPi(modelGateway: ModelGateway) {
  const store = new MemorySessionStore();
  const events: AgentEvent[] = [];
  const modelFailurePort = createPiModelFailurePort();
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
      systemPrompt: "OpenDesign parity",
      thinkingLevel: request.modelSelection.reasoningEffort ?? "off",
      tools: [],
    },
    sessionId: request.sessionId,
    streamFn: createPiModelGatewayStreamFn({
      modelGateway,
      failurePort: modelFailurePort,
      nextAttemptId: () => `${request.runId}_attempt_1`,
      now: () => fixedNow().getTime(),
    }),
  });
  const adapter = new PiRunEventAdapter({
    request,
    sessionStore: store,
    emit: (event) => {
      events.push(event);
    },
    modelFailurePort,
    now: fixedNow,
  });
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

function createFailingGateway(): ModelGateway {
  return {
    async *stream(
      modelRequest: ModelRequest,
    ): AsyncIterable<CanonicalStreamEvent> {
      await Promise.resolve();
      yield {
        type: "attempt.started",
        attemptId: modelRequest.attemptId,
        model: modelRequest.modelSelection.modelId,
        identity: {
          ...modelRequest.modelSelection,
          apiFormat: "openai-responses",
        },
      };
      yield {
        type: "attempt.failed",
        attemptId: modelRequest.attemptId,
        error: {
          code: "upstream_error",
          message: "Provider failed",
          retryable: true,
          provider: modelRequest.modelSelection.providerId,
        },
      };
    },
  };
}

function normalizePublicEvents(events: AgentEvent[]) {
  return events.map((event) => {
    if (event.type === "message.delta") {
      return { type: event.type, delta: event.delta };
    }
    if (event.type === "message.completed") {
      return {
        type: event.type,
        blocks: event.blocks.map(normalizeBlock),
      };
    }
    return event;
  });
}

function normalizeJournal(events: JournalEvent[]) {
  return events.map((event) => {
    if (event.type !== "message.assistant") {
      return { type: event.type, payload: event.payload };
    }
    const payload = event.payload as {
      messageId: string;
      blocks: Array<Record<string, unknown>>;
      source?: unknown;
    };
    return {
      type: event.type,
      payload: {
        ...payload,
        blocks: payload.blocks.map(normalizeBlock),
      },
    };
  });
}

function normalizeBlock(block: object) {
  const normalized = { ...block } as Record<string, unknown>;
  delete normalized.blockId;
  return normalized;
}
