import type {
  AgentEvent,
  ToolExecutionEvent,
} from "@opendesign/agent-contracts";
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
import { createOpenDesignPiAgent } from "./pi-core-adapter.js";
import { prepareOpenDesignPiContext } from "./pi-context-adapter.js";
import {
  createPiModelGatewayStreamFn,
  projectPiMessagesToCanonical,
} from "./pi-model-gateway-adapter.js";
import { PiRunEventAdapter } from "./pi-run-event-adapter.js";
import type {
  AgentRunRequest,
  AgentToolDefinition,
  ToolExecutorPort,
} from "./index.js";

const request: AgentRunRequest = {
  runId: "run_pi_context",
  sessionId: "conversation_pi_context",
  prompt: "Inspect the current composition",
  documentId: "document_pi_context",
  revision: 12,
  scope: { kind: "document", selectedNodeIds: [] },
  mutationTarget: { kind: "document" },
  modelSelection: {
    providerId: "configured",
    modelId: "design-model",
    reasoningEffort: "medium",
  },
};

const model = {
  id: request.modelSelection.modelId,
  name: "Design model",
  api: "openai-responses" as const,
  provider: request.modelSelection.providerId,
  baseUrl: "https://provider.invalid/v1",
  reasoning: true,
  input: ["text", "image"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 16_384,
};

const probeTool: AgentToolDefinition = {
  name: "opendesign_probe_context",
  description: "Returns a content-addressed visual reference.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  risk: "read",
  approval: "never",
  validateInputIssues: (input) =>
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? []
      : [{ path: "/", message: "Expected an object" }],
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
    const lastSequence = this.events
      .filter((event) => event.sessionId === sessionId)
      .reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
    const event = createEvent(lastSequence + 1);
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

class RecordingGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly delegate: ModelGateway) {}

  stream(modelRequest: ModelRequest) {
    this.requests.push(structuredCloneRequest(modelRequest));
    return this.delegate.stream(modelRequest);
  }
}

describe("OpenDesign Pi context adapter", () => {
  it("prepends a bounded trusted host inspection without changing the durable user prompt", async () => {
    const prepared = await prepareOpenDesignPiContext({
      request: {
        ...request,
        initialDesignInspection: {
          version: 1,
          observedRevision: request.revision,
          content: '{"pageId":"page_1","nodes":["frame_1"]}',
        },
      },
      sessionStore: new MemorySessionStore(),
      systemPrompt: "OpenDesign host-inspected planning",
      toolDefinitions: [],
      model,
    });

    expect(JSON.stringify(prepared.promptMessage)).toContain(
      "The host already inspected the exact bound document revision 12",
    );
    expect(JSON.stringify(prepared.promptMessage)).toContain("frame_1");
    expect(JSON.stringify(prepared.promptMessage)).toContain(request.prompt);
  });

  it("restores from the journal and persists cumulative checkpoints without creating a Pi session", async () => {
    const store = new MemorySessionStore();
    const priorPrompt = "PRIOR_DESIGN_REQUEST ".repeat(240);
    const priorResult = "PRIOR_DESIGN_OUTCOME ".repeat(240);
    store.events.push(
      journalEvent(1, "message.user", {
        messageId: "prior_user",
        content: priorPrompt,
      }),
      journalEvent(2, "message.assistant", {
        messageId: "prior_assistant",
        blocks: [{ blockId: "prior_text", type: "text", text: priorResult }],
      }),
      journalEvent(3, "run.state", {
        status: "completed",
        startedAt: new Date(1).toISOString(),
        finishedAt: new Date(2).toISOString(),
        stopReason: "complete",
      }),
    );

    const prepared = await prepareOpenDesignPiContext({
      request,
      sessionStore: store,
      systemPrompt: "OpenDesign context recovery",
      toolDefinitions: [],
      model,
      maxContextCharacters: 2_500,
      now: () => new Date(10),
    });

    expect(prepared.compactedThroughSequence).toBe(3);
    expect(
      store.events.filter((event) => event.type === "context.compacted"),
    ).toHaveLength(1);
    expect(JSON.stringify(prepared.initialMessages)).toContain(
      "OpenDesign context checkpoint",
    );
    expect(JSON.stringify(prepared.initialMessages)).not.toContain(priorPrompt);
    expect(JSON.stringify(store.events)).toContain(priorPrompt);
    expect(JSON.stringify(store.events)).toContain(priorResult);

    const restarted = await prepareOpenDesignPiContext({
      request: { ...request, runId: "run_pi_context_restarted" },
      sessionStore: store,
      systemPrompt: "OpenDesign context recovery",
      toolDefinitions: [],
      model,
      maxContextCharacters: 2_500,
    });
    expect(JSON.stringify(restarted.initialMessages)).toContain(
      "OpenDesign context checkpoint",
    );
    expect(
      store.events.filter((event) => event.type === "context.compacted"),
    ).toHaveLength(1);
  });

  it("fails visibly before provider I/O when the current prompt cannot fit", async () => {
    const store = new MemorySessionStore();
    const gateway = new RecordingGateway(new MockModelGateway("unused"));
    const oversizedRequest = {
      ...request,
      runId: "run_pi_context_oversized",
      prompt: "CURRENT_INPUT ".repeat(400),
    };
    const prepared = await prepareOpenDesignPiContext({
      request: oversizedRequest,
      sessionStore: store,
      systemPrompt: "OpenDesign context limit",
      toolDefinitions: [],
      model,
      maxContextCharacters: 1_000,
    });
    const result = await runPreparedPi({
      request: oversizedRequest,
      store,
      gateway,
      prepared,
      toolDefinitions: [],
    });

    expect(gateway.requests).toHaveLength(0);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "agent.error",
        code: "context_budget_exceeded",
      }),
    );
    expect(result.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "error",
    });
    expect(store.events).toContainEqual(
      expect.objectContaining({ type: "message.user" }),
    );
  });

  it("recalculates the fixed protocol budget when the disclosed tools expand", async () => {
    const store = new MemorySessionStore();
    const compactRequest = {
      ...request,
      runId: "run_pi_context_tool_expansion",
      modelContext: { contextWindow: 12_000, maxOutputTokens: 2_000 },
    };
    const compactModel = {
      ...model,
      contextWindow: 12_000,
      maxTokens: 2_000,
    };
    const prepared = await prepareOpenDesignPiContext({
      request: compactRequest,
      sessionStore: store,
      systemPrompt: "OpenDesign progressive tool disclosure",
      toolDefinitions: [],
      model: compactModel,
    });

    prepared.context.setTools([
      {
        name: "opendesign_expanded_probe",
        description: "Expanded professional tool",
        inputSchema: {
          type: "object",
          description: "x".repeat(80_000),
          properties: {},
          additionalProperties: false,
        },
      },
    ]);
    await prepared.context.transformContext([
      ...prepared.initialMessages,
      prepared.promptMessage,
    ]);

    expect(prepared.context.beforeProviderTurn()).toMatchObject({
      code: "model_context_incompatible",
    });
  });

  it("projects user and tool images as Main-resolved references without inline bytes", async () => {
    const store = new MemorySessionStore();
    const promptAttachment = {
      attachmentId: `image_${"a".repeat(64)}`,
      name: "reference.png",
      mimeType: "image/png" as const,
      byteSize: 2_048,
    };
    const toolAttachment = {
      attachmentId: `image_${"b".repeat(64)}`,
      name: "canvas-capture.png",
      mimeType: "image/png" as const,
      byteSize: 4_096,
    };
    const attachedRequest = {
      ...request,
      runId: "run_pi_context_images",
      attachments: [promptAttachment],
    };
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "capture_block",
              type: "tool_call",
              toolCallId: "capture_call",
              name: probeTool.name,
              input: {},
            },
          ],
          stopReason: "tool_use",
        },
        {
          blocks: [
            {
              id: "visual_references_complete",
              type: "text",
              text: "Visual references inspected.",
            },
          ],
        },
      ]),
    );
    const prepared = await prepareOpenDesignPiContext({
      request: attachedRequest,
      sessionStore: store,
      systemPrompt: "OpenDesign multimodal context",
      toolDefinitions: [probeTool],
      model,
    });
    const result = await runPreparedPi({
      request: attachedRequest,
      store,
      gateway,
      prepared,
      toolDefinitions: [probeTool],
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield {
            type: "completed",
            result: {
              content: {
                ok: true,
                attachments: [toolAttachment],
              },
            },
          };
        },
      },
    });

    expect(gateway.requests).toHaveLength(2);
    expect(
      hasImageReference(
        gateway.requests[0]?.messages ?? [],
        promptAttachment.attachmentId,
      ),
    ).toBe(true);
    expect(
      hasImageReference(
        gateway.requests[1]?.messages ?? [],
        toolAttachment.attachmentId,
      ),
    ).toBe(true);
    expect(JSON.stringify(result.agent.state.messages)).not.toContain(
      "data:image",
    );
    expect(JSON.stringify(store.events)).toContain(toolAttachment.attachmentId);
    expect(result.events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });

    const restarted = await prepareOpenDesignPiContext({
      request: {
        ...attachedRequest,
        runId: "run_pi_context_images_restarted",
        prompt: "Continue after restart",
        attachments: [],
      },
      sessionStore: store,
      systemPrompt: "OpenDesign multimodal context",
      toolDefinitions: [probeTool],
      model,
    });
    expect(
      hasImageReference(
        projectPiMessagesToCanonical(
          restarted.initialMessages,
          restarted.context,
        ),
        toolAttachment.attachmentId,
      ),
    ).toBe(true);
  });

  it("projects SVG attachments as run-scoped handles without XML or model attachment refs", async () => {
    const store = new MemorySessionStore();
    const svgAttachment = {
      attachmentId: `svg_${"c".repeat(64)}`,
      name: "brand-mark.svg",
      mimeType: "image/svg+xml" as const,
      byteSize: 4_096,
    };
    const svgRequest = {
      ...request,
      runId: "run_pi_context_svg",
      prompt: "Import the attached brand mark",
      attachments: [svgAttachment],
    };
    const gateway = new RecordingGateway(
      new MockModelGateway("I will import the attached SVG resource."),
    );
    const prepared = await prepareOpenDesignPiContext({
      request: svgRequest,
      sessionStore: store,
      systemPrompt: "OpenDesign SVG resource context",
      toolDefinitions: [],
      model,
    });

    const execution = await runPreparedPi({
      request: svgRequest,
      store,
      gateway,
      prepared,
      toolDefinitions: [],
    });

    expect(gateway.requests, JSON.stringify(execution.events)).toHaveLength(1);
    const serialized = JSON.stringify(gateway.requests[0]?.messages);
    expect(serialized).toContain(svgAttachment.attachmentId);
    expect(serialized).toContain("opendesign_import_svg");
    expect(serialized).not.toContain("image/svg+xml");
    expect(serialized).not.toContain("document_ref");
    expect(serialized).not.toContain("<svg");
    expect(JSON.stringify(store.events)).toContain(svgAttachment.attachmentId);
  });
});

async function runPreparedPi(options: {
  request: AgentRunRequest;
  store: SessionStore;
  gateway: ModelGateway;
  prepared: Awaited<ReturnType<typeof prepareOpenDesignPiContext>>;
  toolDefinitions: readonly AgentToolDefinition[];
  toolExecutor?: ToolExecutorPort;
}) {
  const events: AgentEvent[] = [];
  const agentReference: {
    current?: ReturnType<typeof createOpenDesignPiAgent>;
  } = {};
  const adapter = new PiRunEventAdapter({
    request: options.request,
    sessionStore: options.store,
    emit: (event) => {
      events.push(event);
    },
    toolDefinitions: options.toolDefinitions,
    ...(options.toolExecutor === undefined
      ? {}
      : { toolExecutor: options.toolExecutor }),
    contextFailurePort: options.prepared.context,
    requestContinuation: (message) => agentReference.current?.steer(message),
  });
  const agent = createOpenDesignPiAgent({
    initialState: {
      messages: options.prepared.initialMessages,
      model,
      systemPrompt: options.prepared.systemPrompt,
      thinkingLevel: "off",
      tools: [...adapter.tools],
    },
    sessionId: options.request.sessionId,
    streamFn: createPiModelGatewayStreamFn({
      modelGateway: options.gateway,
      contextProjection: options.prepared.context,
    }),
    transformContext: options.prepared.context.transformContext,
    beforeToolCall: adapter.beforeToolCall,
    shouldStopAfterTurn: adapter.shouldStopAfterTurn,
  });
  agentReference.current = agent;
  const unsubscribe = agent.subscribe((event) => adapter.accept(event));
  try {
    await agent.prompt(options.prepared.promptMessage);
  } finally {
    unsubscribe();
    agent.abort();
    await agent.waitForIdle();
  }
  return { agent, events };
}

function hasImageReference(
  messages: readonly ModelRequest["messages"][number][],
  attachmentId: string,
): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      Array.isArray(message.content) &&
      message.content.some(
        (block) =>
          block.type === "image_ref" && block.attachmentId === attachmentId,
      ),
  );
}

function journalEvent(
  sequence: number,
  type: JournalEvent["type"],
  payload: unknown,
): JournalEvent {
  return {
    eventId: `event_${sequence}`,
    sessionId: request.sessionId,
    runId: "run_prior",
    sequence,
    type,
    createdAt: new Date(sequence).toISOString(),
    payload,
  };
}

function structuredCloneRequest(modelRequest: ModelRequest): ModelRequest {
  return {
    ...modelRequest,
    modelSelection: { ...modelRequest.modelSelection },
    messages: structuredClone(modelRequest.messages),
    tools: structuredClone(modelRequest.tools),
  };
}
