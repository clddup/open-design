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
import type {
  AgentRunRequest,
  AgentToolDefinition,
  ToolExecutionEvent,
} from "./index.js";
import { OpenDesignPiRuntime } from "./pi-runtime.js";

const request: AgentRunRequest = {
  runId: "run_pi_runtime",
  sessionId: "conversation_pi_runtime",
  prompt: "Inspect the current design",
  documentId: "document_pi_runtime",
  revision: 7,
  scope: { kind: "document", selectedNodeIds: [] },
  mutationTarget: { kind: "document" },
  modelSelection: {
    providerId: "configured",
    modelId: "design-model",
    reasoningEffort: "medium",
  },
  modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
};

const tool: AgentToolDefinition = {
  name: "opendesign_runtime_probe",
  description: "Exercises the production Pi runtime tool boundary.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  risk: "read",
  approval: "never",
  validateInput: (input) =>
    typeof input === "object" && input !== null && !Array.isArray(input),
};

class MemorySessionStore implements SessionStore {
  readonly events: JournalEvent[] = [];

  append<T>(event: JournalEvent<T>): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  read(sessionId: string): Promise<JournalEvent[]> {
    return Promise.resolve(
      this.events
        .filter((event) => event.sessionId === sessionId)
        .sort((left, right) => left.sequence - right.sequence),
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

describe("OpenDesign Pi production runtime", () => {
  it("owns the complete run, tool and journal lifecycle behind the request-handler port", async () => {
    const store = new MemorySessionStore();
    const runtime = new OpenDesignPiRuntime({
      modelGateway: new MockModelGateway([
        {
          blocks: [
            {
              id: "runtime_probe_block",
              type: "tool_call",
              toolCallId: "runtime_probe_call",
              name: tool.name,
              input: {},
            },
          ],
          stopReason: "tool_use",
        },
        {
          blocks: [
            {
              id: "runtime_complete",
              type: "text",
              text: "Runtime completed.",
            },
          ],
        },
      ]),
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield {
            type: "completed",
            result: { content: { ok: true, inspectedRevision: 7 } },
          };
        },
      },
      systemPrompt: "OpenDesign Pi production runtime",
    });

    const events = await collect(runtime, request);

    expect(events[0]).toMatchObject({ type: "run.started" });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        toolCallId: "runtime_probe_call",
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });
    expect(store.events.map((event) => event.type)).toEqual([
      "run.state",
      "message.user",
      "message.assistant",
      "tool.requested",
      "tool.completed",
      "message.assistant",
      "run.state",
    ]);
    expect(await runtime.loadSessionHistory(request.sessionId)).toContainEqual(
      expect.objectContaining({ type: "assistant.message" }),
    );
  });

  it("cancels the active Pi loop and publishes a terminal cancelled run", async () => {
    const store = new MemorySessionStore();
    const gateway = new AbortableGateway();
    const runtime = new OpenDesignPiRuntime({
      modelGateway: gateway,
      sessionStore: store,
    });
    const events: AgentEvent[] = [];
    const collecting = (async () => {
      for await (const event of runtime.run({
        ...request,
        runId: "run_pi_runtime_cancelled",
      })) {
        events.push(event);
      }
    })();
    await gateway.started;

    expect(runtime.cancel("run_pi_runtime_cancelled")).toBe(true);
    await collecting;

    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "cancelled",
    });
    expect(runtime.cancel("run_pi_runtime_cancelled")).toBe(false);
  });

  it("serializes two runs in one Conversation while allowing the caller to start both", async () => {
    const store = new MemorySessionStore();
    const gateway = new OrderedGateway();
    const runtime = new OpenDesignPiRuntime({
      modelGateway: gateway,
      sessionStore: store,
    });
    const first = collect(runtime, {
      ...request,
      runId: "run_pi_serial_1",
      prompt: "First run",
    });
    await gateway.firstStarted;
    const second = collect(runtime, {
      ...request,
      runId: "run_pi_serial_2",
      prompt: "Second run",
    });
    await Promise.resolve();
    expect(gateway.requestRunIds).toEqual(["run_pi_serial_1"]);
    gateway.releaseFirst();
    await Promise.all([first, second]);

    expect(gateway.requestRunIds).toEqual([
      "run_pi_serial_1",
      "run_pi_serial_2",
    ]);
    const firstTerminal = store.events.findIndex(
      (event) =>
        event.runId === "run_pi_serial_1" &&
        event.type === "run.state" &&
        (event.payload as { status?: unknown }).status === "completed",
    );
    const secondStart = store.events.findIndex(
      (event) =>
        event.runId === "run_pi_serial_2" &&
        event.type === "run.state" &&
        (event.payload as { status?: unknown }).status === "started",
    );
    expect(secondStart).toBeGreaterThan(firstTerminal);
  });

  it("never re-executes a tool-call ID recovered from the durable journal", async () => {
    const store = new MemorySessionStore();
    store.events.push(
      priorEvent(1, "message.user", {
        messageId: "prior_user",
        content: "Inspect once",
      }),
      priorEvent(2, "tool.requested", {
        toolCallId: "recovered_tool_call",
        toolName: tool.name,
        input: {},
        risk: "read",
      }),
      priorEvent(3, "tool.completed", {
        toolCallId: "recovered_tool_call",
        result: { ok: true },
      }),
    );
    let executions = 0;
    const runtime = new OpenDesignPiRuntime({
      modelGateway: new MockModelGateway([
        {
          blocks: [
            {
              id: "replayed_block",
              type: "tool_call",
              toolCallId: "recovered_tool_call",
              name: tool.name,
              input: {},
            },
          ],
          stopReason: "tool_use",
        },
        {
          blocks: [
            {
              id: "replay_complete",
              type: "text",
              text: "Used the recovered result.",
            },
          ],
        },
      ]),
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          executions += 1;
          yield { type: "completed", result: { content: { ok: true } } };
        },
      },
    });

    await collect(runtime, {
      ...request,
      runId: "run_pi_recovered_tool",
    });

    expect(executions).toBe(0);
    expect(
      store.events.filter(
        (event) =>
          event.runId === "run_pi_recovered_tool" &&
          event.type === "tool.requested",
      ),
    ).toHaveLength(0);
  });

  it("does not terminate a healthy multi-target tool loop at the old sixteen-turn limit", async () => {
    const store = new MemorySessionStore();
    const toolTurns = Array.from({ length: 20 }, (_, index) => ({
      blocks: [
        {
          id: `suite_probe_block_${index}`,
          type: "tool_call" as const,
          toolCallId: `suite_probe_call_${index}`,
          name: tool.name,
          input: {},
        },
      ],
      stopReason: "tool_use" as const,
    }));
    let executions = 0;
    const runtime = new OpenDesignPiRuntime({
      modelGateway: new MockModelGateway([
        ...toolTurns,
        {
          blocks: [
            {
              id: "suite_complete",
              type: "text",
              text: "The requested suite is complete.",
            },
          ],
        },
      ]),
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          executions += 1;
          yield { type: "completed", result: { content: { ok: true } } };
        },
      },
    });

    const events = await collect(runtime, {
      ...request,
      runId: "run_pi_multi_target_budget",
    });

    expect(executions).toBe(20);
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });
  });
});

class AbortableGateway implements ModelGateway {
  readonly started: Promise<void>;
  #markStarted!: () => void;

  constructor() {
    this.started = new Promise((resolve) => {
      this.#markStarted = resolve;
    });
  }

  async *stream(
    modelRequest: ModelRequest,
  ): AsyncIterable<CanonicalStreamEvent> {
    this.#markStarted();
    yield attemptStarted(modelRequest);
    await waitForAbort(modelRequest.signal);
    yield {
      type: "attempt.failed",
      attemptId: modelRequest.attemptId,
      error: {
        code: "cancelled",
        message: "Request cancelled",
        retryable: false,
      },
    };
  }
}

class OrderedGateway implements ModelGateway {
  readonly firstStarted: Promise<void>;
  readonly requestRunIds: string[] = [];
  #markFirstStarted!: () => void;
  #release!: () => void;
  readonly #firstGate: Promise<void>;

  constructor() {
    this.firstStarted = new Promise((resolve) => {
      this.#markFirstStarted = resolve;
    });
    this.#firstGate = new Promise((resolve) => {
      this.#release = resolve;
    });
  }

  releaseFirst(): void {
    this.#release();
  }

  async *stream(
    modelRequest: ModelRequest,
  ): AsyncIterable<CanonicalStreamEvent> {
    const runId = modelRequest.attemptId.replace(/_attempt_\d+$/, "");
    this.requestRunIds.push(runId);
    if (this.requestRunIds.length === 1) {
      this.#markFirstStarted();
      await this.#firstGate;
    }
    yield attemptStarted(modelRequest);
    yield {
      type: "block.started",
      attemptId: modelRequest.attemptId,
      blockId: `${runId}_text`,
      kind: "text",
    };
    yield {
      type: "block.completed",
      attemptId: modelRequest.attemptId,
      block: { id: `${runId}_text`, type: "text", text: "Complete" },
    };
    yield {
      type: "attempt.completed",
      attemptId: modelRequest.attemptId,
      stopReason: "complete",
      usage: emptyUsage(),
    };
  }
}

function attemptStarted(
  modelRequest: ModelRequest,
): Extract<CanonicalStreamEvent, { type: "attempt.started" }> {
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

function emptyUsage() {
  return {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function priorEvent(
  sequence: number,
  type: JournalEvent["type"],
  payload: unknown,
): JournalEvent {
  return {
    eventId: `prior_event_${sequence}`,
    sessionId: request.sessionId,
    runId: "run_prior",
    sequence,
    type,
    createdAt: new Date(sequence).toISOString(),
    payload,
  };
}

async function collect(
  runtime: OpenDesignPiRuntime,
  runRequest: AgentRunRequest,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runtime.run(runRequest)) events.push(event);
  return events;
}
