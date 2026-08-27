import type {
  AgentEvent as PiAgentEvent,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AgentRunFailure,
  RunStopReason,
} from "@opendesign/agent-contracts";
import type { SessionStore } from "@opendesign/session-store";
import type { UserMessage } from "@earendil-works/pi-ai";
import type {
  AgentToolCallRecord,
  CompletionGuardPort,
} from "./completion-guard.js";
import type { AgentRunRequest, ModelToolSurface } from "./run-request.js";
import type {
  AgentToolDefinition,
  ApprovalPort,
  ToolExecutorPort,
} from "./runtime-ports.js";
import { OpenDesignPiToolAdapter } from "./pi-tool-adapter.js";
import type { PiContextFailurePort } from "./pi-context-adapter.js";
import type { PiModelFailurePort } from "./pi-model-gateway-adapter.js";
import { PiRunMessageController } from "./pi-run-message-controller.js";
import { terminalRunFailure } from "./pi-terminal-failure.js";
import { toRunStopReason } from "./pi-run-event-messages.js";
import { appendRunJournalEvent } from "./run-journal-writer.js";
import { PiRunToolEventBridge } from "./pi-run-tool-events.js";
export interface PiRunEventAdapterOptions {
  request: AgentRunRequest;
  sessionStore: SessionStore;
  emit: (event: AgentEvent) => Promise<void> | void;
  toolDefinitions?: readonly AgentToolDefinition[];
  toolExecutor?: ToolExecutorPort;
  approvalPort?: ApprovalPort;
  completionGuard?: CompletionGuardPort;
  contextFailurePort?: PiContextFailurePort;
  modelFailurePort?: PiModelFailurePort;
  isCancellationRequested?: () => boolean;
  requestContinuation?: (message: UserMessage) => void;
  maxToolCalls?: number;
  maxTurns?: number;
  maxGeneratedTokens?: number;
  maxCompletionGuardRejections?: number;
  priorToolCallIds?: readonly string[];
  initialModelToolSurface?: ModelToolSurface;
  now?: () => Date;
}

/**
 * Projects Pi's ephemeral loop events into OpenDesign's versioned renderer
 * events and durable Conversation journal.
 *
 * Model and tool lifecycle events reuse OpenDesign's existing AgentEvent,
 * ToolExecutor, approval, revision, attachment and journal semantics. The
 * adapter never creates a Pi session or a second durable transcript.
 */
export class PiRunEventAdapter {
  readonly #emit: PiRunEventAdapterOptions["emit"];
  readonly #contextFailurePort: PiContextFailurePort | undefined;
  readonly #messages: PiRunMessageController;
  readonly #modelFailurePort: PiModelFailurePort | undefined;
  readonly #isCancellationRequested: (() => boolean) | undefined;
  readonly #now: () => Date;
  readonly #request: AgentRunRequest;
  readonly #sessionStore: SessionStore;
  #ended = false;
  #forcedError: AgentRunFailure | undefined;
  #forcedStopReason: RunStopReason | undefined;
  #started = false;
  #startedAt = "";
  readonly #toolAdapter: OpenDesignPiToolAdapter | undefined;
  readonly #toolEvents: PiRunToolEventBridge | undefined;

  constructor(options: PiRunEventAdapterOptions) {
    this.#request = snapshotRequest(options.request);
    this.#sessionStore = options.sessionStore;
    this.#emit = options.emit;
    this.#now = options.now ?? (() => new Date());
    this.#contextFailurePort = options.contextFailurePort;
    this.#modelFailurePort = options.modelFailurePort;
    this.#isCancellationRequested = options.isCancellationRequested;
    const maxTurns = options.maxTurns ?? 8;
    const maxGeneratedTokens = options.maxGeneratedTokens ?? 200_000;
    const maxCompletionGuardRejections =
      options.maxCompletionGuardRejections ?? 3;
    if (
      !Number.isInteger(maxTurns) ||
      maxTurns < 1 ||
      !Number.isInteger(maxGeneratedTokens) ||
      maxGeneratedTokens < 1 ||
      !Number.isInteger(maxCompletionGuardRejections) ||
      maxCompletionGuardRejections < 0
    ) {
      throw new RangeError("Pi run limits are invalid");
    }
    if (
      options.completionGuard !== undefined &&
      options.requestContinuation === undefined
    ) {
      throw new TypeError(
        "Pi completion guard requires a trusted continuation queue",
      );
    }
    if (options.toolDefinitions !== undefined) {
      this.#toolAdapter = new OpenDesignPiToolAdapter({
        request: this.#request,
        definitions: options.toolDefinitions,
        ...(options.toolExecutor === undefined
          ? {}
          : { toolExecutor: options.toolExecutor }),
        ...(options.approvalPort === undefined
          ? {}
          : { approvalPort: options.approvalPort }),
        maxToolCalls: options.maxToolCalls ?? 32,
        initialInspection: this.#request.initialDesignInspection !== undefined,
        ...(options.initialModelToolSurface === undefined
          ? {}
          : { initialModelToolSurface: options.initialModelToolSurface }),
        ...(options.priorToolCallIds === undefined
          ? {}
          : { priorToolCallIds: options.priorToolCallIds }),
        now: this.#now,
        lifecycle: {
          approvalRequested: async (approval) => {
            if (!this.#toolEvents) {
              throw new Error("Pi tool event bridge is unavailable");
            }
            await this.#toolEvents.approvalRequested(approval);
          },
          approvalResolved: async (approval) => {
            if (!this.#toolEvents) {
              throw new Error("Pi tool event bridge is unavailable");
            }
            await this.#toolEvents.approvalResolved(approval);
          },
        },
      });
      this.#toolEvents = new PiRunToolEventBridge(
        this.#toolAdapter,
        this.#request,
        (type, payload, createdAt) => this.#append(type, payload, createdAt),
        (event) => this.#publish(event),
      );
    }
    this.#messages = new PiRunMessageController({
      append: (type, payload, createdAt) =>
        this.#append(type, payload, createdAt),
      ...(options.completionGuard
        ? { completionGuard: options.completionGuard }
        : {}),
      currentRevision: () =>
        this.#toolAdapter?.currentRevision ?? this.#request.revision,
      maxCompletionGuardRejections,
      maxGeneratedTokens,
      maxTurns,
      now: this.#now,
      publish: (event) => this.#publish(event),
      request: this.#request,
      ...(options.requestContinuation
        ? { requestContinuation: options.requestContinuation }
        : {}),
      toolCallRecords: () => this.#toolAdapter?.toolCallRecords ?? [],
      toolsEnabled: this.#toolAdapter !== undefined,
      unresolvedDesignWriteFailure: () =>
        this.#toolAdapter?.unresolvedDesignWriteFailure,
    });
  }
  get tools(): readonly AgentTool[] {
    return this.#toolAdapter?.tools ?? [];
  }
  get modelTools(): readonly AgentTool[] {
    return this.#toolAdapter?.modelTools ?? [];
  }
  get toolCallRecords(): readonly AgentToolCallRecord[] {
    return this.#toolAdapter?.toolCallRecords ?? [];
  }
  get unresolvedDesignWriteFailure() {
    return this.#toolAdapter?.unresolvedDesignWriteFailure;
  }
  readonly beforeToolCall = (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    if (this.#toolAdapter === undefined) return Promise.resolve(undefined);
    return this.#toolAdapter.beforeToolCall(context, signal);
  };

  readonly shouldStopAfterTurn = (): boolean =>
    this.#messages.stopAfterTurn ||
    this.#messages.forcedStopReason !== undefined ||
    this.#forcedStopReason !== undefined ||
    this.#toolAdapter?.forcedStopReason !== undefined;

  async accept(event: PiAgentEvent): Promise<void> {
    if (this.#ended) {
      throw new Error(`Pi emitted ${event.type} after agent_end`);
    }
    if (event.type === "agent_start") {
      await this.#startRun();
      return;
    }
    if (!this.#started) {
      throw new Error(`Pi emitted ${event.type} before agent_start`);
    }

    if (event.type === "message_start") {
      this.#messages.start(event.message);
      return;
    }
    if (event.type === "message_update") {
      await this.#messages.update(event);
      return;
    }
    if (event.type === "message_end") {
      await this.#messages.end(event.message);
      return;
    }
    if (event.type === "turn_end") {
      await this.#messages.endTurn(event);
      return;
    }
    if (
      event.type === "tool_execution_start" ||
      event.type === "tool_execution_update" ||
      event.type === "tool_execution_end"
    ) {
      await this.#acceptToolEvent(event);
      return;
    }
    if (event.type === "agent_end") {
      await this.#endRun();
    }
  }

  async #startRun(): Promise<void> {
    if (this.#started) throw new Error("Pi emitted duplicate agent_start");
    this.#startedAt = this.#now().toISOString();
    const continuation = this.#request.continuation;
    await this.#append("message.user", {
      messageId: `${this.#request.runId}_user`,
      content: this.#request.prompt,
      ...(this.#request.attachments === undefined
        ? {}
        : { attachments: this.#request.attachments }),
      documentId: this.#request.documentId,
      revision: this.#request.revision,
      scope: this.#request.scope,
      mutationTarget: this.#request.mutationTarget,
    });
    await this.#append(
      "run.state",
      {
        status: "started",
        startedAt: this.#startedAt,
        modelSelection: this.#request.modelSelection,
        ...(continuation ? { continuation } : {}),
      },
      this.#startedAt,
    );
    this.#started = true;
    await this.#publish({
      type: "run.started",
      runId: this.#request.runId,
      startedAt: this.#startedAt,
      ...(continuation ? { continuation } : {}),
    });
  }

  async #endRun(): Promise<void> {
    const cancellationRequested = this.#isCancellationRequested?.() === true;
    await this.#messages.prepareEnd(cancellationRequested);
    if (!cancellationRequested) {
      this.#forcedStopReason = this.#messages.forcedStopReason;
      this.#forcedError = this.#messages.forcedError;
    }
    const contextFailure = this.#contextFailurePort?.consumeFailure();
    if (!cancellationRequested && contextFailure !== undefined) {
      this.#forcedStopReason = "error";
      this.#forcedError = { ...contextFailure, retryable: false };
    }
    const terminalFailure = terminalRunFailure(
      this.#modelFailurePort?.consumeFailure(),
      this.#toolAdapter?.forcedError,
    );
    if (!cancellationRequested && terminalFailure !== undefined) {
      this.#forcedStopReason = "error";
      this.#forcedError = terminalFailure;
    }
    const stopReason = cancellationRequested
      ? "cancelled"
      : (this.#forcedStopReason ??
        this.#messages.forcedStopReason ??
        this.#toolAdapter?.forcedStopReason ??
        toRunStopReason(
          this.#messages.lastAssistantStopReason,
          this.#messages.lastAssistantHadToolCalls,
        ));
    await this.#toolEvents?.finalizePending(stopReason);
    if (stopReason === "error") {
      const invalidToolStop =
        this.#messages.lastAssistantStopReason === "toolUse" &&
        !this.#messages.lastAssistantHadToolCalls;
      const failure: AgentRunFailure =
        this.#forcedError ??
        (invalidToolStop
          ? {
              code: "invalid_model_response",
              message: "Model stopped for tool use without a tool call",
              retryable: true,
            }
          : {
              code: "run_failed",
              message:
                this.#messages.lastAssistantError ?? "Pi Agent run failed",
              retryable: true,
            });
      this.#forcedError = failure;
      await this.#publish({
        type: "agent.error",
        code: failure.code,
        message: failure.message,
        runId: this.#request.runId,
        failure,
      });
    }
    const finishedAt = this.#now().toISOString();
    await this.#append(
      "run.state",
      {
        status: stopReason === "complete" ? "completed" : stopReason,
        startedAt: this.#startedAt,
        finishedAt,
        stopReason,
        ...(this.#forcedError === undefined
          ? {}
          : { failure: this.#forcedError }),
      },
      finishedAt,
    );
    await this.#publish({
      type: "run.completed",
      runId: this.#request.runId,
      finishedAt,
      stopReason,
    });
    this.#ended = true;
  }

  #append(
    type: Parameters<typeof appendRunJournalEvent>[2],
    payload: unknown,
    createdAt = this.#now().toISOString(),
  ): Promise<number> {
    return appendRunJournalEvent(
      this.#sessionStore,
      this.#request,
      type,
      payload,
      createdAt,
    );
  }

  async #publish(event: AgentEvent): Promise<void> {
    await this.#emit(event);
  }

  async #acceptToolEvent(
    event: Extract<
      PiAgentEvent,
      {
        type:
          | "tool_execution_start"
          | "tool_execution_update"
          | "tool_execution_end";
      }
    >,
  ): Promise<void> {
    const bridge = this.#toolEvents;
    if (!bridge) {
      throw new Error(
        "Pi tool events require the OpenDesign production tool adapter",
      );
    }
    await bridge.accept(event);
  }
}

function snapshotRequest(request: AgentRunRequest): AgentRunRequest {
  return structuredClone(request);
}
