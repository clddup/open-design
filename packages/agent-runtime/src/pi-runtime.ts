import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import type { Model, Api } from "@earendil-works/pi-ai";
import type { SessionStore } from "@opendesign/session-store";
import {
  type AgentRunRequest,
  type AgentRuntimeLimits,
  type AgentRuntimeOptions,
  type AgentToolDefinition,
  type ToolCatalogPort,
} from "./index.js";
import { createOpenDesignPiAgent } from "./pi-core-adapter.js";
import { prepareOpenDesignPiContext } from "./pi-context-adapter.js";
import {
  createPiModelFailurePort,
  createPiModelGatewayStreamFn,
} from "./pi-model-gateway-adapter.js";
import { PiRunEventAdapter } from "./pi-run-event-adapter.js";

const DEFAULT_LIMITS: AgentRuntimeLimits = {
  // A requested design suite may require an independent capture/review/
  // refinement cycle per target. The total-token budget remains the hard
  // runaway bound; these structural limits must not terminate an otherwise
  // healthy multi-target delivery after the first few screens.
  maxTurns: 160,
  maxToolCalls: 320,
  maxGeneratedTokens: 200_000,
  maxCompletionGuardRejections: 32,
  maxContextCharacters: 240_000,
};

const EMPTY_TOOL_CATALOG: ToolCatalogPort = { listTools: () => [] };

interface ActivePiRun {
  abortController: AbortController;
  agent?: ReturnType<typeof createOpenDesignPiAgent>;
}

/**
 * Unique production Agent runner backed by Pi's implemented headless loop.
 *
 * OpenDesign continues to own the journal, context projection, model gateway,
 * tool execution, approval, revision and completion policy. Pi owns only the
 * ephemeral message/tool loop and cancellation lifecycle.
 */
export class OpenDesignPiRuntime {
  readonly #activeRuns = new Map<string, ActivePiRun>();
  readonly #limits: AgentRuntimeLimits;
  readonly #now: () => Date;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#limits = { ...DEFAULT_LIMITS, ...options.limits };
    if (
      !Number.isInteger(this.#limits.maxTurns) ||
      this.#limits.maxTurns < 1 ||
      !Number.isInteger(this.#limits.maxToolCalls) ||
      this.#limits.maxToolCalls < 0 ||
      !Number.isInteger(this.#limits.maxGeneratedTokens) ||
      this.#limits.maxGeneratedTokens < 1 ||
      !Number.isInteger(this.#limits.maxCompletionGuardRejections) ||
      this.#limits.maxCompletionGuardRejections < 0 ||
      !Number.isInteger(this.#limits.maxContextCharacters) ||
      this.#limits.maxContextCharacters < 1
    ) {
      throw new RangeError("Agent runtime limits are invalid");
    }
  }

  async *run(input: AgentRunRequest): AsyncIterable<AgentEvent> {
    const request = snapshotRequest(input);
    if (this.#activeRuns.has(request.runId)) {
      throw new Error(`Run already active: ${request.runId}`);
    }
    const active: ActivePiRun = { abortController: new AbortController() };
    this.#activeRuns.set(request.runId, active);
    const events = new AgentEventChannel();
    const producer = this.#execute(request, active, (event) => {
      events.push(event);
    }).then(
      () => events.close(),
      (error: unknown) => events.fail(error),
    );

    try {
      for await (const event of events) yield event;
      await producer;
    } finally {
      if (!events.closed) this.cancel(request.runId);
      await producer.catch(() => undefined);
    }
  }

  cancel(runId: string): boolean {
    const active = this.#activeRuns.get(runId);
    if (active === undefined) return false;
    active.abortController.abort();
    active.agent?.abort();
    return true;
  }

  async loadSessionHistory(sessionId: string): Promise<SessionTimelineItem[]> {
    return (await this.options.sessionStore.readTimeline(
      sessionId,
    )) as SessionTimelineItem[];
  }

  async #execute(
    request: AgentRunRequest,
    active: ActivePiRun,
    emit: (event: AgentEvent) => void,
  ): Promise<void> {
    let releaseSession: (() => void) | undefined;
    try {
      releaseSession = await acquireSessionLock(
        this.options.sessionStore,
        request.sessionId,
      );
      const toolDefinitions = await this.#loadSafeTools();
      const systemPrompt =
        this.options.systemPrompt ??
        "You are the OpenDesign design agent. Use only the provided tools and respect the host-bound modification scope.";
      const model = createPiModel(request);
      const prepared = await prepareOpenDesignPiContext({
        request,
        sessionStore: this.options.sessionStore,
        systemPrompt,
        toolDefinitions,
        model,
        maxContextCharacters: this.#limits.maxContextCharacters,
        now: this.#now,
      });
      const agentReference: {
        current?: ReturnType<typeof createOpenDesignPiAgent>;
      } = {};
      const modelFailurePort = createPiModelFailurePort();
      const adapter = new PiRunEventAdapter({
        request,
        sessionStore: this.options.sessionStore,
        emit,
        toolDefinitions,
        ...(this.options.toolExecutor === undefined
          ? {}
          : { toolExecutor: this.options.toolExecutor }),
        ...(this.options.approvalPort === undefined
          ? {}
          : { approvalPort: this.options.approvalPort }),
        ...(this.options.completionGuard === undefined
          ? {}
          : { completionGuard: this.options.completionGuard }),
        contextFailurePort: prepared.context,
        modelFailurePort,
        requestContinuation: (message) =>
          agentReference.current?.steer(message),
        maxToolCalls: this.#limits.maxToolCalls,
        maxTurns: this.#limits.maxTurns,
        maxGeneratedTokens: this.#limits.maxGeneratedTokens,
        maxCompletionGuardRejections: this.#limits.maxCompletionGuardRejections,
        priorToolCallIds: prepared.priorToolCallIds,
        now: this.#now,
      });
      let attempt = 0;
      const agent = createOpenDesignPiAgent({
        initialState: {
          messages: prepared.initialMessages,
          model,
          systemPrompt: prepared.systemPrompt,
          thinkingLevel: request.modelSelection.reasoningEffort ?? "off",
          tools: [...adapter.tools],
        },
        sessionId: request.sessionId,
        streamFn: createPiModelGatewayStreamFn({
          modelGateway: this.options.modelGateway,
          contextProjection: prepared.context,
          failurePort: modelFailurePort,
          nextAttemptId: () => `${request.runId}_attempt_${++attempt}`,
          now: () => this.#now().getTime(),
        }),
        transformContext: prepared.context.transformContext,
        beforeToolCall: adapter.beforeToolCall,
        shouldStopAfterTurn: adapter.shouldStopAfterTurn,
      });
      active.agent = agent;
      agentReference.current = agent;
      const unsubscribe = agent.subscribe((event) => adapter.accept(event));
      try {
        const run = agent.prompt(prepared.promptMessage);
        if (active.abortController.signal.aborted) agent.abort();
        await run;
      } finally {
        unsubscribe();
        agent.abort();
        await agent.waitForIdle();
      }
    } finally {
      releaseSession?.();
      this.#activeRuns.delete(request.runId);
    }
  }

  async #loadSafeTools(): Promise<AgentToolDefinition[]> {
    const catalog = this.options.toolCatalog ?? EMPTY_TOOL_CATALOG;
    const tools = await catalog.listTools();
    const safe: AgentToolDefinition[] = [];
    const names = new Set<string>();
    for (const tool of tools) {
      if (!isSafeToolDefinition(tool) || names.has(tool.name)) continue;
      names.add(tool.name);
      safe.push(tool);
    }
    return safe;
  }
}

function createPiModel(request: AgentRunRequest): Model<Api> {
  return {
    id: request.modelSelection.modelId,
    name: request.modelSelection.modelId,
    api: "openai-responses",
    provider: request.modelSelection.providerId,
    baseUrl: "https://opendesign.invalid/model-gateway",
    reasoning: request.modelSelection.reasoningEffort !== undefined,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: request.modelContext?.contextWindow ?? 200_000,
    maxTokens: request.modelContext?.maxOutputTokens ?? 16_384,
  };
}

function isSafeToolDefinition(tool: AgentToolDefinition): boolean {
  return (
    tool.name.startsWith("opendesign_") &&
    tool.description.length > 0 &&
    tool.inputSchema.type === "object" &&
    tool.inputSchema.additionalProperties === false &&
    (tool.approvalPrompt === undefined ||
      (typeof tool.approvalPrompt.title === "string" &&
        typeof tool.approvalPrompt.summary === "string" &&
        tool.approvalPrompt.title.length > 0 &&
        tool.approvalPrompt.title.length <= 2_000 &&
        tool.approvalPrompt.summary.length <= 20_000)) &&
    typeof tool.validateInput === "function"
  );
}

function snapshotRequest(request: AgentRunRequest): AgentRunRequest {
  return structuredClone(request);
}

class AgentEventChannel implements AsyncIterable<AgentEvent> {
  readonly #queue: AgentEvent[] = [];
  #failure: Error | undefined;
  #resolve: (() => void) | undefined;
  #closed = false;

  get closed(): boolean {
    return this.#closed;
  }

  push(event: AgentEvent): void {
    if (this.#closed) throw new Error("Agent event channel is closed");
    this.#queue.push(event);
    this.#wake();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#wake();
  }

  fail(error: unknown): void {
    if (this.#closed) return;
    this.#failure =
      error instanceof Error ? error : new Error("Pi Agent runtime failed");
    this.#closed = true;
    this.#wake();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    while (true) {
      const event = this.#queue.shift();
      if (event !== undefined) {
        yield event;
        continue;
      }
      if (this.#closed) {
        if (this.#failure !== undefined) throw this.#failure;
        return;
      }
      await new Promise<void>((resolve) => {
        this.#resolve = resolve;
      });
    }
  }

  #wake(): void {
    const resolve = this.#resolve;
    this.#resolve = undefined;
    resolve?.();
  }
}

interface SessionLockState {
  tail: Promise<void>;
  pending: number;
}

const sessionLocks = new WeakMap<SessionStore, Map<string, SessionLockState>>();

async function acquireSessionLock(
  store: SessionStore,
  sessionId: string,
): Promise<() => void> {
  let locks = sessionLocks.get(store);
  if (locks === undefined) {
    locks = new Map();
    sessionLocks.set(store, locks);
  }
  const previous = locks.get(sessionId);
  const waitFor = previous?.tail ?? Promise.resolve();
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const state: SessionLockState = {
    tail: waitFor.then(() => gate),
    pending: (previous?.pending ?? 0) + 1,
  };
  locks.set(sessionId, state);
  await waitFor;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseGate();
    state.pending -= 1;
    if (state.pending === 0 && locks?.get(sessionId) === state) {
      locks.delete(sessionId);
    }
  };
}
