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
import {
  AgentRuntime,
  type AgentRunRequest,
  type AgentToolDefinition,
  type ToolExecutionEvent,
  type TrustedToolContext,
} from "./index.js";

const request: AgentRunRequest = {
  runId: "run_1",
  sessionId: "session_1",
  prompt: "Move the selected layer",
  documentId: "document_trusted",
  revision: 4,
  scope: {
    kind: "selection",
    selectedNodeIds: ["node_trusted"],
    primaryNodeId: "node_trusted",
    pageId: "page_trusted",
  },
  mutationTarget: { kind: "page", pageId: "page_trusted" },
  modelSelection: {
    providerId: "mock",
    modelId: "design",
    reasoningEffort: "medium",
  },
};

const tool: AgentToolDefinition = {
  name: "design.move",
  description: "Moves nodes in the trusted modification scope",
  inputSchema: {
    type: "object",
    properties: { dx: { type: "number" } },
    required: ["dx"],
    additionalProperties: false,
  },
  risk: "design_write",
  approval: "never",
  validateInput: (input) =>
    typeof input === "object" &&
    input !== null &&
    typeof (input as { dx?: unknown }).dx === "number",
};

class MemorySessionStore implements SessionStore {
  readonly events: JournalEvent[] = [];
  failNextRead = false;

  append<T>(event: JournalEvent<T>): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  read(sessionId: string): Promise<JournalEvent[]> {
    if (this.failNextRead) {
      this.failNextRead = false;
      return Promise.reject(new Error("read failed"));
    }
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
    const lastSequence = this.events
      .filter((event) => event.sessionId === sessionId)
      .reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
    const event = createEvent(lastSequence + 1);
    this.events.push(event);
    return Promise.resolve(event);
  }

  async project(sessionId: string): Promise<SessionProjection> {
    const events = await this.read(sessionId);
    let latestRevision: number | undefined;
    for (const event of events) {
      if (event.type !== "design.revision") continue;
      const payload = event.payload as { revision?: unknown };
      if (typeof payload.revision === "number") {
        latestRevision = payload.revision;
      }
    }
    return {
      sessionId,
      lastSequence: events.at(-1)?.sequence ?? 0,
      ...(latestRevision === undefined ? {} : { latestRevision }),
      messageCount: events.filter((event) => event.type.startsWith("message."))
        .length,
      toolCallCount: events.filter((event) => event.type === "tool.requested")
        .length,
      compactedRanges: [],
    };
  }
}

class RecordingGateway implements ModelGateway {
  readonly requests: Array<{
    tools: ModelRequest["tools"];
    messages: ModelRequest["messages"];
    system: string;
  }> = [];

  constructor(private readonly delegate: ModelGateway) {}

  stream(modelRequest: ModelRequest) {
    this.requests.push({
      tools: modelRequest.tools,
      messages: structuredClone(modelRequest.messages),
      system: modelRequest.system,
    });
    return this.delegate.stream(modelRequest);
  }
}

async function collect(
  runtime: AgentRuntime,
  run = request,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runtime.run(run)) events.push(event);
  return events;
}

describe("AgentRuntime", () => {
  it("keeps a rejected completion provisional and feeds trusted review back privately", async () => {
    const store = new MemorySessionStore();
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "premature_completion",
              type: "text",
              text: "The first draft is finished.",
            },
          ],
        },
        {
          blocks: [
            {
              id: "reviewed_completion",
              type: "text",
              text: "The reviewed result is finished.",
            },
          ],
        },
      ]),
    );
    let reviews = 0;
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      completionGuard: {
        review: () =>
          ++reviews === 1
            ? {
                allow: false as const,
                message: "Capture and refine the rendered result first.",
              }
            : { allow: true as const },
      },
    });

    const events = await collect(runtime);
    const messages = store.events.filter(
      (event) => event.type === "message.assistant",
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "message.completed",
          messageId: "run_1_assistant_1",
          blocks: [],
        }),
        expect.objectContaining({
          type: "message.completed",
          messageId: "run_1_assistant_2",
          blocks: [
            expect.objectContaining({
              text: "The reviewed result is finished.",
            }),
          ],
        }),
      ]),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.payload).toMatchObject({
      blocks: [
        expect.objectContaining({ text: "The reviewed result is finished." }),
      ],
    });
    expect(gateway.requests[1]?.system).toContain(
      "Capture and refine the rendered result first.",
    );
    expect(
      gateway.requests[1]?.messages.some(
        (message) =>
          message.role === "user" &&
          message.content === "Capture and refine the rendered result first.",
      ),
    ).toBe(false);
  });

  it("preserves image references across Conversation runs", async () => {
    const store = new MemorySessionStore();
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "first_response",
              type: "text",
              text: "First response",
            },
          ],
        },
        {
          blocks: [
            {
              id: "second_response",
              type: "text",
              text: "Second response",
            },
          ],
        },
      ]),
    );
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
    });
    const attachment = {
      attachmentId: `image_${"a".repeat(64)}`,
      name: "inspiration.png",
      mimeType: "image/png" as const,
      byteSize: 1024,
    };
    const documentAttachment = {
      attachmentId: `file_${"b".repeat(64)}`,
      name: "product-brief.md",
      mimeType: "text/markdown" as const,
      byteSize: 2048,
    };

    await collect(runtime, {
      ...request,
      attachments: [attachment, documentAttachment],
    });
    await collect(runtime, {
      ...request,
      runId: "run_2",
      prompt: "Use the same visual direction",
    });

    expect(gateway.requests[0]?.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: request.prompt },
        { type: "image_ref", ...attachment },
        { type: "document_ref", ...documentAttachment },
      ],
    });
    expect(gateway.requests[1]?.messages[0]).toEqual(
      gateway.requests[0]?.messages[0],
    );
    expect(await runtime.loadSessionHistory(request.sessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "user.message",
          attachments: [attachment, documentAttachment],
        }),
      ]),
    );
  });

  it("feeds image attachments returned by tools back as multimodal input", async () => {
    const store = new MemorySessionStore();
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "read_block",
              type: "tool_call",
              toolCallId: "read_image_1",
              name: "opendesign_read_image",
              input: { source: "/tmp/reference.png" },
            },
          ],
          stopReason: "tool_use",
        },
        {
          blocks: [
            {
              id: "reference_text",
              type: "text",
              text: "I can now inspect the reference image.",
            },
          ],
        },
      ]),
    );
    const readTool: AgentToolDefinition = {
      name: "opendesign_read_image",
      description: "Read an explicit image reference",
      inputSchema: {
        type: "object",
        properties: { source: { type: "string" } },
        required: ["source"],
        additionalProperties: false,
      },
      risk: "read",
      approval: "never",
      validateInput: () => true,
    };
    const attachment = {
      attachmentId: `image_${"c".repeat(64)}`,
      name: "reference.png",
      mimeType: "image/png" as const,
      byteSize: 1024,
    };
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      toolCatalog: { listTools: () => [readTool] },
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield {
            type: "completed",
            result: {
              content: {
                ok: true,
                attachment,
                attachments: [attachment],
              },
            },
          };
        },
      },
    });

    await collect(runtime);

    const imageReferences = (gateway.requests[1]?.messages ?? []).flatMap(
      (message) =>
        message.role === "user" && Array.isArray(message.content)
          ? message.content.filter((block) => block.type === "image_ref")
          : [],
    );
    expect(imageReferences).toContainEqual({
      type: "image_ref",
      ...attachment,
    });
  });

  it("keeps oversized tool-result fields out of current and restored model context", async () => {
    const store = new MemorySessionStore();
    const oversizedValue = `data:image/png;base64,${"A".repeat(20_000)}`;
    const inspectTool: AgentToolDefinition = {
      name: "design.inspect",
      description: "Inspect a design",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      risk: "read",
      approval: "never",
      validateInput: () => true,
    };
    const firstGateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "inspect_block",
              type: "tool_call",
              toolCallId: "inspect_oversized_1",
              name: inspectTool.name,
              input: {},
            },
          ],
          stopReason: "tool_use",
        },
        { blocks: [{ id: "done", type: "text", text: "Inspected." }] },
      ]),
    );
    const runtime = new AgentRuntime({
      modelGateway: firstGateway,
      sessionStore: store,
      toolCatalog: { listTools: () => [inspectTool] },
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield {
            type: "completed",
            result: {
              content: {
                ok: true,
                document: {
                  assetsById: {
                    asset_large: {
                      source: { type: "data", value: oversizedValue },
                    },
                  },
                },
              },
            },
          };
        },
      },
    });

    await collect(runtime);
    const currentProjection = JSON.stringify(
      firstGateway.requests[1]?.messages,
    );
    expect(currentProjection).not.toContain(oversizedValue);
    expect(currentProjection).toContain("OpenDesign omitted");

    const restoredGateway = new RecordingGateway(
      new MockModelGateway({
        blocks: [{ id: "restored", type: "text", text: "Recovered." }],
      }),
    );
    const restoredRuntime = new AgentRuntime({
      modelGateway: restoredGateway,
      sessionStore: store,
      toolCatalog: { listTools: () => [inspectTool] },
    });
    await collect(restoredRuntime, {
      ...request,
      runId: "run_restored_after_oversized_tool",
      prompt: "Continue from the inspection",
    });

    const restoredProjection = JSON.stringify(
      restoredGateway.requests[0]?.messages,
    );
    expect(restoredProjection).not.toContain(oversizedValue);
    expect(restoredProjection).toContain("OpenDesign omitted");
  });

  it("persists cumulative context checkpoints without deleting original history", async () => {
    const store = new MemorySessionStore();
    const firstPrompt = "FIRST_REQUEST ".repeat(180);
    const secondPrompt = "SECOND_REQUEST ".repeat(90);
    const thirdPrompt = "THIRD_REQUEST ".repeat(90);
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "first_long_result",
              type: "text",
              text: "FIRST_RESULT ".repeat(180),
            },
          ],
        },
        {
          blocks: [
            {
              id: "second_long_result",
              type: "text",
              text: "SECOND_RESULT ".repeat(180),
            },
          ],
        },
        {
          blocks: [
            {
              id: "third_result",
              type: "text",
              text: "Third complete",
            },
          ],
        },
      ]),
    );
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      limits: { maxContextCharacters: 5_000 },
    });

    await collect(runtime, { ...request, prompt: firstPrompt });
    await collect(runtime, {
      ...request,
      runId: "run_context_2",
      prompt: secondPrompt,
    });
    await collect(runtime, {
      ...request,
      runId: "run_context_3",
      prompt: thirdPrompt,
    });

    const checkpoints = store.events.filter(
      (event) => event.type === "context.compacted",
    );
    expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    const checkpointRanges = checkpoints.map(
      (event) => event.payload as { fromSequence: number; toSequence: number },
    );
    expect(checkpointRanges.every((range) => range.fromSequence === 1)).toBe(
      true,
    );
    expect(checkpointRanges.at(-1)!.toSequence).toBeGreaterThan(
      checkpointRanges[0]!.toSequence,
    );

    const secondProjection = JSON.stringify(gateway.requests[1]?.messages);
    const thirdProjection = JSON.stringify(gateway.requests[2]?.messages);
    expect(secondProjection).toContain("OpenDesign context checkpoint");
    expect(thirdProjection).toContain("OpenDesign context checkpoint");
    expect(secondProjection).not.toContain(firstPrompt);
    expect(thirdProjection).not.toContain(firstPrompt);
    expect(thirdProjection.length).toBeLessThan(5_000);

    const originalFirstMessage = store.events.find(
      (event) =>
        event.type === "message.user" &&
        (event.payload as { content?: unknown }).content === firstPrompt,
    );
    expect(originalFirstMessage).toBeDefined();
    expect(await runtime.loadSessionHistory(request.sessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "user.message", content: firstPrompt }),
      ]),
    );
  });

  it("fails visibly before provider I/O when the current input cannot fit", async () => {
    const store = new MemorySessionStore();
    const gateway = new RecordingGateway(new MockModelGateway("unused"));
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      limits: { maxContextCharacters: 1_000 },
    });

    const events = await collect(runtime, {
      ...request,
      prompt: "CURRENT_INPUT ".repeat(200),
    });

    expect(gateway.requests).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent.error",
        code: "context_budget_exceeded",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.completed",
        stopReason: "error",
      }),
    );
    expect(store.events).toContainEqual(
      expect.objectContaining({ type: "message.user" }),
    );
  });

  it("uses a trusted model token budget instead of rejecting a fitting request by character count", async () => {
    const store = new MemorySessionStore();
    const gateway = new RecordingGateway(
      new MockModelGateway("Token-budgeted request accepted"),
    );
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      limits: { maxContextCharacters: 1_000 },
    });

    const events = await collect(runtime, {
      ...request,
      prompt: "X".repeat(250_000),
      modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
    });

    expect(gateway.requests).toHaveLength(1);
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "agent.error",
        code: "context_budget_exceeded",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.completed",
        stopReason: "complete",
      }),
    );
  });

  it("distinguishes an incompatible model window from conversation growth", async () => {
    const store = new MemorySessionStore();
    const gateway = new RecordingGateway(new MockModelGateway("unused"));
    const protocolHeavyTool: AgentToolDefinition = {
      ...tool,
      inputSchema: {
        type: "object",
        properties: {
          payload: {
            type: "string",
            description: "x".repeat(40_000),
          },
        },
        additionalProperties: false,
      },
    };
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      toolCatalog: { listTools: () => [protocolHeavyTool] },
    });

    const events = await collect(runtime, {
      ...request,
      prompt: "Short request",
      modelContext: { contextWindow: 8_192, maxOutputTokens: 2_048 },
    });

    expect(gateway.requests).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent.error",
        code: "model_context_incompatible",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "run.completed", stopReason: "error" }),
    );
  });

  it("stops before a later provider turn when current-run tool results exceed the context budget", async () => {
    const store = new MemorySessionStore();
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "large_tool_block",
              type: "tool_call",
              toolCallId: "large_tool_1",
              name: tool.name,
              input: { dx: 12 },
            },
          ],
          stopReason: "tool_use",
        },
        {
          blocks: [
            { id: "must_not_run", type: "text", text: "Unexpected turn" },
          ],
        },
      ]),
    );
    const chunks = Array.from(
      { length: 8 },
      (_, index) => `${index}:${"X".repeat(800)}`,
    );
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield {
            type: "completed",
            result: { content: { ok: true, chunks } },
          };
        },
      },
      limits: { maxContextCharacters: 4_000 },
    });

    const events = await collect(runtime);

    expect(gateway.requests).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent.error",
        code: "context_budget_exceeded",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.completed",
        stopReason: "error",
      }),
    );
    const completedTool = store.events.find(
      (event) => event.type === "tool.completed",
    );
    expect(completedTool).toBeDefined();
    expect((completedTool?.payload as { result?: unknown }).result).toEqual({
      ok: true,
      chunks,
    });
  });

  it("runs a multi-turn text/tool loop and persists a recoverable history", async () => {
    const store = new MemorySessionStore();
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "tool_block",
              type: "tool_call",
              toolCallId: "tool_move_1",
              name: "design.move",
              input: {
                dx: 12,
                documentId: "document_model_override",
                scope: { selectedNodeIds: ["node_model_override"] },
              },
            },
          ],
          stopReason: "tool_use",
        },
        {
          blocks: [
            {
              id: "text_block",
              type: "text",
              text: "The selected layer moved 12 pixels.",
            },
          ],
          stopReason: "complete",
        },
      ]),
    );
    const executions: Array<{
      input: unknown;
      context: TrustedToolContext;
    }> = [];
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        async *execute(call, context): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          executions.push({ input: call.input, context });
          yield { type: "progress", message: "Moving", progress: 0.5 };
          yield {
            type: "completed",
            result: {
              content: { moved: true },
              designRevision: {
                previousRevision: 4,
                revision: 5,
                transactionId: "transaction_move_1",
              },
            },
          };
        },
      },
      now: increasingClock(),
    });

    const events = await collect(runtime);
    const history = await runtime.loadSessionHistory("session_1");

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.completed",
      "tool.requested",
      "tool.progress",
      "tool.completed",
      "message.delta",
      "message.completed",
      "run.completed",
    ]);
    expect(executions).toHaveLength(1);
    expect(executions[0]?.input).toMatchObject({
      documentId: "document_model_override",
    });
    expect(executions[0]?.context).toEqual({
      runId: "run_1",
      sessionId: "session_1",
      documentId: "document_trusted",
      revision: 4,
      scope: request.scope,
      mutationTarget: request.mutationTarget,
    });
    expect(gateway.requests[0]?.tools).toEqual([
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
    ]);
    expect(
      gateway.requests[1]?.messages.map((message) => message.role),
    ).toEqual(["user", "assistant", "tool"]);
    expect(
      store.events.filter((event) => event.type === "design.revision"),
    ).toEqual([
      expect.objectContaining({
        payload: {
          documentId: "document_trusted",
          previousRevision: 4,
          revision: 5,
          transactionId: "transaction_move_1",
          toolCallId: "tool_move_1",
        },
      }),
    ]);
    expect(history.find((item) => item.type === "user.message")).toMatchObject({
      content: request.prompt,
      scope: request.scope,
      mutationTarget: request.mutationTarget,
    });
    expect(
      history.find(
        (item) => item.type === "assistant.message" && item.blocks.length > 0,
      ),
    ).toMatchObject({
      blocks: [{ type: "text", text: "The selected layer moved 12 pixels." }],
    });
    expect(history.find((item) => item.type === "tool")).toMatchObject({
      status: "completed",
      revision: 5,
      transactionId: "transaction_move_1",
    });
  });

  it("refreshes the trusted revision after a read before the next write", async () => {
    const store = new MemorySessionStore();
    const gateway = new MockModelGateway([
      {
        blocks: [
          {
            id: "inspect_block",
            type: "tool_call",
            toolCallId: "tool_inspect_1",
            name: "design.move",
            input: { dx: 0 },
          },
        ],
        stopReason: "tool_use",
      },
      {
        blocks: [
          {
            id: "apply_block",
            type: "tool_call",
            toolCallId: "tool_apply_1",
            name: "design.move",
            input: { dx: 12 },
          },
        ],
        stopReason: "tool_use",
      },
      {
        blocks: [
          {
            id: "complete_block",
            type: "text",
            text: "The live canvas is updated.",
          },
        ],
        stopReason: "complete",
      },
    ]);
    const contexts: TrustedToolContext[] = [];
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        async *execute(call, context): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          contexts.push(context);
          if (call.toolCallId === "tool_inspect_1") {
            yield {
              type: "completed",
              result: {
                content: { inspected: true, revision: 7 },
                observedRevision: 7,
              },
            };
            return;
          }
          yield {
            type: "completed",
            result: {
              content: { moved: true },
              designRevision: {
                previousRevision: 7,
                revision: 8,
                transactionId: "transaction_live_1",
              },
            },
          };
        },
      },
      now: increasingClock(),
    });

    const events = await collect(runtime);

    expect(contexts.map(({ revision }) => revision)).toEqual([4, 7]);
    expect(events.filter((event) => event.type === "tool.completed")).toEqual([
      expect.objectContaining({
        toolCallId: "tool_inspect_1",
        revision: 7,
      }),
      expect.objectContaining({
        toolCallId: "tool_apply_1",
        revision: 8,
        transactionId: "transaction_live_1",
      }),
    ]);
  });

  it("does not execute invalid or length-truncated tool calls", async () => {
    const store = new MemorySessionStore();
    let executions = 0;
    const runtime = new AgentRuntime({
      modelGateway: new MockModelGateway([
        {
          blocks: [
            {
              id: "invalid",
              type: "tool_call",
              toolCallId: "tool_invalid_1",
              name: "design.move",
              input: { dx: "far" },
            },
          ],
          stopReason: "tool_use",
        },
        {
          blocks: [
            {
              id: "truncated",
              type: "tool_call",
              toolCallId: "tool_truncated_1",
              name: "design.move",
              input: { dx: 20 },
            },
          ],
          stopReason: "length",
        },
      ]),
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        async *execute() {
          await Promise.resolve();
          executions += 1;
          yield {
            type: "completed" as const,
            result: { content: { moved: true } },
          };
        },
      },
    });

    const events = await collect(runtime);

    expect(executions).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        toolCallId: "tool_invalid_1",
        code: "invalid_tool_input",
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ toolCallId: "tool_truncated_1" }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "budget",
    });
  });

  it("returns recoverable tool execution errors to the model for replanning", async () => {
    const store = new MemorySessionStore();
    const requests: ModelRequest[] = [];
    const mockGateway = new MockModelGateway([
      {
        blocks: [
          {
            id: "missing_node_call",
            type: "tool_call",
            toolCallId: "tool_missing_node",
            name: "design.move",
            input: { dx: 12 },
          },
        ],
        stopReason: "tool_use",
      },
      {
        blocks: [
          {
            id: "replanned_reply",
            type: "text",
            text: "The target node no longer exists, so I did not modify the canvas.",
          },
        ],
        stopReason: "complete",
      },
    ]);
    const gateway: ModelGateway = {
      async *stream(modelRequest) {
        requests.push({
          ...modelRequest,
          messages: modelRequest.messages.map((message) => ({ ...message })),
        });
        yield* mockGateway.stream(modelRequest);
      },
    };
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        execute: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              await Promise.resolve();
              throw new Error("Target node no longer exists");
            },
          }),
        }),
      },
    });

    const events = await collect(runtime);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        toolCallId: "tool_missing_node",
        code: "tool_error",
        message: "Target node no longer exists",
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "tool_missing_node",
      isError: true,
      content: {
        code: "tool_error",
        message: "Target node no longer exists",
      },
    });
  });

  it("propagates cancellation to an active tool executor", async () => {
    const store = new MemorySessionStore();
    let executorSawAbort = false;
    const runtime = new AgentRuntime({
      modelGateway: new MockModelGateway({
        blocks: [
          {
            id: "tool",
            type: "tool_call",
            toolCallId: "tool_cancel_1",
            name: "design.move",
            input: { dx: 2 },
          },
          {
            id: "tool_pending",
            type: "tool_call",
            toolCallId: "tool_cancel_2",
            name: "design.move",
            input: { dx: 3 },
          },
        ],
        stopReason: "tool_use",
      }),
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        async *execute(_call, _context, signal) {
          yield { type: "progress" as const, message: "Started", progress: 0 };
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              executorSawAbort = true;
              resolve();
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                executorSawAbort = true;
                resolve();
              },
              { once: true },
            );
          });
          yield {
            type: "completed" as const,
            result: { content: { shouldNotBeUsed: true } },
          };
        },
      },
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run(request)) {
      events.push(event);
      if (event.type === "tool.progress") {
        queueMicrotask(() => runtime.cancel(request.runId));
      }
    }

    expect(executorSawAbort).toBe(true);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "tool.completed" }),
    );
    expect(
      events.flatMap((event) =>
        event.type === "tool.failed" && event.code === "run_cancelled"
          ? [event.toolCallId]
          : [],
      ),
    ).toEqual(["tool_cancel_1", "tool_cancel_2"]);
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "cancelled",
    });
    const history = await runtime.loadSessionHistory(request.sessionId);
    expect(
      history.flatMap((item) =>
        item.type === "tool" && item.status === "failed"
          ? [item.toolCallId]
          : [],
      ),
    ).toEqual(["tool_cancel_1", "tool_cancel_2"]);
    expect(
      history
        .filter((item) => item.type === "tool")
        .every((item) => item.error?.code === "run_cancelled"),
    ).toBe(true);
  });

  it("terminally closes a pending approval when cancellation interrupts it", async () => {
    const store = new MemorySessionStore();
    const approvalTool = { ...tool, approval: "required" as const };
    let executions = 0;
    const runtime = new AgentRuntime({
      modelGateway: new MockModelGateway({
        blocks: [
          {
            id: "approval_cancel",
            type: "tool_call",
            toolCallId: "tool_approval_cancel_1",
            name: "design.move",
            input: { dx: 2 },
          },
        ],
        stopReason: "tool_use",
      }),
      sessionStore: store,
      toolCatalog: { listTools: () => [approvalTool] },
      approvalPort: {
        requestApproval: async (_approval, _context, signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return "allow_once";
        },
      },
      toolExecutor: {
        async *execute() {
          await Promise.resolve();
          executions += 1;
          yield {
            type: "completed" as const,
            result: { content: { moved: true } },
          };
        },
      },
    });

    const runtimeEvents: AgentEvent[] = [];
    for await (const runtimeEvent of runtime.run(request)) {
      runtimeEvents.push(runtimeEvent);
      if (runtimeEvent.type === "approval.requested") {
        queueMicrotask(() => runtime.cancel(request.runId));
      }
    }
    const history = await runtime.loadSessionHistory(request.sessionId);

    expect(executions).toBe(0);
    expect(runtimeEvents).not.toContainEqual(
      expect.objectContaining({ type: "approval.resolved" }),
    );
    expect(runtimeEvents).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        toolCallId: "tool_approval_cancel_1",
        code: "run_cancelled",
      }),
    );
    expect(history).toContainEqual(
      expect.objectContaining({
        type: "approval",
        toolCallId: "tool_approval_cancel_1",
        status: "resolved",
      }),
    );
  });

  it("fails all requested tools honestly when a run errors mid-batch", async () => {
    const store = new MemorySessionStore();
    const approvalTool = { ...tool, approval: "required" as const };
    const runtime = new AgentRuntime({
      modelGateway: new MockModelGateway({
        blocks: [
          {
            id: "tool_error_1",
            type: "tool_call",
            toolCallId: "tool_error_1",
            name: "design.move",
            input: { dx: 1 },
          },
          {
            id: "tool_error_2",
            type: "tool_call",
            toolCallId: "tool_error_2",
            name: "design.move",
            input: { dx: 2 },
          },
        ],
        stopReason: "tool_use",
      }),
      sessionStore: store,
      toolCatalog: { listTools: () => [approvalTool] },
      approvalPort: {
        async requestApproval(request) {
          await Promise.resolve();
          if (request.toolCallId === "tool_error_1") return "allow_once";
          throw new Error("approval host failed");
        },
      },
      toolExecutor: {
        async *execute() {
          await Promise.resolve();
          yield {
            type: "completed" as const,
            result: { content: { moved: true } },
          };
        },
      },
    });

    const runtimeEvents = await collect(runtime);
    const history = await runtime.loadSessionHistory(request.sessionId);

    expect(runtimeEvents).toContainEqual(
      expect.objectContaining({ type: "agent.error", code: "run_failed" }),
    );
    expect(
      runtimeEvents.flatMap((event) =>
        event.type === "tool.failed" ? [event.code] : [],
      ),
    ).toEqual(["run_error"]);
    expect(
      history.find(
        (item) => item.type === "tool" && item.toolCallId === "tool_error_1",
      ),
    ).toMatchObject({ type: "tool", status: "completed" });
    expect(
      history.find(
        (item) => item.type === "tool" && item.toolCallId === "tool_error_2",
      ),
    ).toMatchObject({
      type: "tool",
      status: "failed",
      error: { code: "run_error", message: expect.any(String) as string },
    });
    expect(
      history.find(
        (item) =>
          item.type === "approval" && item.toolCallId === "tool_error_2",
      ),
    ).toMatchObject({ type: "approval", status: "resolved" });
    expect(runtimeEvents.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "error",
    });
  });

  it("never executes a tool call ID already present in recovered history", async () => {
    const store = new MemorySessionStore();
    store.events.push({
      eventId: "prior_tool",
      sessionId: request.sessionId,
      runId: "run_prior",
      sequence: 1,
      type: "tool.requested",
      createdAt: new Date(1).toISOString(),
      payload: {
        toolCallId: "tool_replayed_1",
        toolName: "design.move",
        input: { dx: 1 },
        risk: "design_write",
      },
    });
    let executions = 0;
    const runtime = new AgentRuntime({
      modelGateway: new MockModelGateway([
        {
          blocks: [
            {
              id: "replayed",
              type: "tool_call",
              toolCallId: "tool_replayed_1",
              name: "design.move",
              input: { dx: 10 },
            },
          ],
          stopReason: "tool_use",
        },
        { blocks: [{ id: "done", type: "text", text: "Skipped." }] },
      ]),
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        async *execute() {
          await Promise.resolve();
          executions += 1;
          yield {
            type: "completed" as const,
            result: { content: { moved: true } },
          };
        },
      },
    });

    await collect(runtime);

    expect(executions).toBe(0);
    expect(
      store.events.filter(
        (event) =>
          event.type === "tool.requested" &&
          (event.payload as { toolCallId?: unknown }).toolCallId ===
            "tool_replayed_1",
      ),
    ).toHaveLength(1);
  });

  it("restores multiple tool identities and results in model sequence order without replay", async () => {
    const store = new MemorySessionStore();
    const priorEvents: JournalEvent[] = [
      {
        eventId: "prior_user",
        sessionId: request.sessionId,
        runId: "run_prior",
        sequence: 1,
        type: "message.user",
        createdAt: new Date(1).toISOString(),
        payload: {
          messageId: "prior_user",
          content: "Move two layers",
          documentId: request.documentId,
          revision: request.revision,
          scope: request.scope,
        },
      },
      {
        eventId: "prior_assistant",
        sessionId: request.sessionId,
        runId: "run_prior",
        sequence: 2,
        type: "message.assistant",
        createdAt: new Date(2).toISOString(),
        payload: { messageId: "prior_assistant", blocks: [] },
      },
      {
        eventId: "tool_b_requested",
        sessionId: request.sessionId,
        runId: "run_prior",
        sequence: 4,
        type: "tool.requested",
        createdAt: new Date(4).toISOString(),
        payload: {
          toolCallId: "tool_b",
          toolName: "design.move",
          input: { dx: 2 },
          risk: "design_write",
        },
      },
      {
        eventId: "tool_a_requested",
        sessionId: request.sessionId,
        runId: "run_prior",
        sequence: 3,
        type: "tool.requested",
        createdAt: new Date(3).toISOString(),
        payload: {
          toolCallId: "tool_a",
          toolName: "design.move",
          input: { dx: 1 },
          risk: "design_write",
        },
      },
      {
        eventId: "tool_b_completed",
        sessionId: request.sessionId,
        runId: "run_prior",
        sequence: 5,
        type: "tool.completed",
        createdAt: new Date(5).toISOString(),
        payload: { toolCallId: "tool_b", result: { moved: "b" } },
      },
      {
        eventId: "tool_a_completed",
        sessionId: request.sessionId,
        runId: "run_prior",
        sequence: 6,
        type: "tool.completed",
        createdAt: new Date(6).toISOString(),
        payload: { toolCallId: "tool_a", result: { moved: "a" } },
      },
    ];
    store.events.push(...priorEvents);
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "repeat_b",
              type: "tool_call",
              toolCallId: "tool_b",
              name: "design.move",
              input: { dx: 20 },
            },
            {
              id: "repeat_a",
              type: "tool_call",
              toolCallId: "tool_a",
              name: "design.move",
              input: { dx: 10 },
            },
          ],
          stopReason: "tool_use",
        },
        {
          blocks: [{ id: "done", type: "text", text: "Already moved." }],
        },
      ]),
    );
    let executions = 0;
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
      toolCatalog: { listTools: () => [tool] },
      toolExecutor: {
        async *execute() {
          await Promise.resolve();
          executions += 1;
          yield {
            type: "completed" as const,
            result: { content: { moved: true } },
          };
        },
      },
    });

    await collect(runtime);

    expect(executions).toBe(0);
    expect(
      store.events.filter(
        (event) =>
          event.runId === request.runId && event.type === "tool.requested",
      ),
    ).toHaveLength(0);
    const restored = gateway.requests[0]!.messages;
    const restoredAssistant = restored.find(
      (message) =>
        message.role === "assistant" &&
        message.blocks.some((block) => block.type === "tool_call"),
    );
    expect(
      restoredAssistant?.role === "assistant"
        ? restoredAssistant.blocks.flatMap((block) =>
            block.type === "tool_call" ? [block.toolCallId] : [],
          )
        : [],
    ).toEqual(["tool_a", "tool_b"]);
    expect(
      restored.flatMap((message) =>
        message.role === "tool" ? [message.toolCallId] : [],
      ),
    ).toEqual(["tool_a", "tool_b"]);
  });

  it("journals host approval resolution without faking a decision", async () => {
    const store = new MemorySessionStore();
    let executions = 0;
    const approvalTool = { ...tool, approval: "required" as const };
    const runtime = new AgentRuntime({
      modelGateway: new MockModelGateway([
        {
          blocks: [
            {
              id: "approval",
              type: "tool_call",
              toolCallId: "tool_approval_1",
              name: "design.move",
              input: { dx: 3 },
            },
          ],
          stopReason: "tool_use",
        },
        { blocks: [{ id: "done", type: "text", text: "Denied." }] },
      ]),
      sessionStore: store,
      toolCatalog: { listTools: () => [approvalTool] },
      approvalPort: {
        requestApproval: async (_approval, context) => {
          await Promise.resolve();
          expect(context.documentId).toBe("document_trusted");
          return "deny";
        },
      },
      toolExecutor: {
        async *execute() {
          await Promise.resolve();
          executions += 1;
          yield {
            type: "completed" as const,
            result: { content: { moved: true } },
          };
        },
      },
    });

    const runtimeEvents = await collect(runtime);

    expect(executions).toBe(0);
    expect(runtimeEvents).toContainEqual(
      expect.objectContaining({
        type: "approval.resolved",
        decision: "deny",
      }),
    );
    expect(await runtime.loadSessionHistory(request.sessionId)).toContainEqual(
      expect.objectContaining({
        type: "approval",
        status: "resolved",
        decision: "deny",
      }),
    );
  });

  it("trusts the host-bound revision when journal history reached a higher revision", async () => {
    const store = new MemorySessionStore();
    store.events.push(
      {
        eventId: "known_user",
        sessionId: request.sessionId,
        runId: "run_prior",
        sequence: 1,
        type: "message.user",
        createdAt: new Date(1).toISOString(),
        payload: {
          messageId: "known_user",
          content: "Prior run",
          documentId: request.documentId,
          revision: 4,
          scope: request.scope,
        },
      },
      {
        eventId: "known_revision",
        sessionId: request.sessionId,
        runId: "run_prior",
        sequence: 2,
        type: "design.revision",
        createdAt: new Date(2).toISOString(),
        payload: {
          documentId: request.documentId,
          previousRevision: 4,
          revision: 7,
          transactionId: "known_transaction",
        },
      },
    );
    const gateway = new RecordingGateway(new MockModelGateway("Done"));
    const runtime = new AgentRuntime({
      modelGateway: gateway,
      sessionStore: store,
    });

    await expect(
      collect(runtime, { ...request, runId: "run_restored", revision: 6 }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        type: "run.completed",
        stopReason: "complete",
      }),
    );
    await expect(
      collect(runtime, {
        ...request,
        runId: "run_other_document",
        documentId: "document_other",
        revision: 1,
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        type: "run.completed",
        stopReason: "complete",
      }),
    );
    await expect(
      collect(runtime, {
        ...request,
        runId: "run_higher",
        revision: 9,
        scope: {
          kind: "selection",
          selectedNodeIds: ["node_host_new"],
          primaryNodeId: "node_host_new",
        },
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        type: "run.completed",
        stopReason: "complete",
      }),
    );
    expect(gateway.requests).toHaveLength(3);
    expect(
      store.events.find(
        (event) =>
          event.runId === "run_restored" && event.type === "message.user",
      ),
    ).toMatchObject({
      payload: {
        documentId: request.documentId,
        revision: 6,
      },
    });
    expect(
      store.events.find(
        (event) =>
          event.runId === "run_higher" && event.type === "message.user",
      ),
    ).toMatchObject({
      payload: {
        documentId: request.documentId,
        revision: 9,
        scope: { selectedNodeIds: ["node_host_new"] },
      },
    });
  });

  it("serializes concurrent starts from separate runtimes sharing a store", async () => {
    const store = new MemorySessionStore();
    const first = new AgentRuntime({
      modelGateway: new MockModelGateway("First"),
      sessionStore: store,
    });
    const second = new AgentRuntime({
      modelGateway: new MockModelGateway("Second"),
      sessionStore: store,
    });

    await Promise.all([
      collect(first, { ...request, runId: "run_concurrent_1" }),
      collect(second, { ...request, runId: "run_concurrent_2" }),
    ]);

    const sequences = store.events.map((event) => event.sequence);
    expect(sequences).toEqual(
      Array.from({ length: sequences.length }, (_, index) => index + 1),
    );
    const firstTerminalIndex = store.events.findIndex(
      (event) =>
        event.runId === "run_concurrent_1" &&
        event.type === "run.state" &&
        (event.payload as { status?: unknown }).status === "completed",
    );
    const secondStartIndex = store.events.findIndex(
      (event) =>
        event.runId === "run_concurrent_2" &&
        event.type === "run.state" &&
        (event.payload as { status?: unknown }).status === "started",
    );
    expect(secondStartIndex).toBeGreaterThan(firstTerminalIndex);
  });

  it("cleans up the active run when the initial store read fails", async () => {
    const store = new MemorySessionStore();
    store.failNextRead = true;
    const runtime = new AgentRuntime({
      modelGateway: new MockModelGateway("Recovered"),
      sessionStore: store,
    });

    await expect(collect(runtime)).rejects.toThrow("read failed");
    await expect(collect(runtime)).resolves.toContainEqual(
      expect.objectContaining({
        type: "run.completed",
        stopReason: "complete",
      }),
    );
  });
});

function increasingClock(): () => Date {
  let tick = 0;
  return () => new Date(++tick);
}
