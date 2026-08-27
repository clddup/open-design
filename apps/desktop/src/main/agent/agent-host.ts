import { app, utilityProcess } from "electron";
import {
  agentEventRequestId,
  agentEventRunId,
  designToolBridgeRequestId,
  formatRuntimeContractFailure,
  isDesignToolBridgeCancel,
  isDesignToolBridgeRequest,
  isTrustedToolFailure,
  type AgentEvent,
  type AgentRequest,
  type DesignToolBridgeProgress,
  type DesignToolBridgeResponse,
  type ToolCallRequest,
  type TrustedToolContext,
  type TrustedToolFailure,
  type TrustedToolResult,
  type RuntimeContractResult,
} from "@opendesign/agent-contracts";
import type {
  CanonicalStreamEvent,
  ModelRequest,
} from "@opendesign/model-gateway";
import { join } from "node:path";
import {
  isModelBridgeCancel,
  isModelBridgeRequest,
  modelBridgeRequestId,
  modelBridgeRequestValidationError,
  type ModelBridgeResponse,
} from "@/shared/model-bridge";
import { validateDesignAgentToolInput } from "@/shared/design-agent-tools";
import {
  isSessionStoreBridgeRequest,
  isSessionStoreBridgeResponse,
  sessionStoreBridgeRequestId,
  sessionStoreBridgeRequestOperation,
  sessionStoreBridgeResponseValidationError,
  type SessionStoreBridgeRequest,
  type SessionStoreBridgeResponse,
} from "@/shared/session-store-bridge";
import { AgentSupervisor } from "./agent-supervisor";

export interface AgentHostListener {
  (event: AgentEvent): void;
}

export interface ModelRequestHandler {
  (
    request: Omit<ModelRequest, "signal">,
    signal: AbortSignal,
  ): AsyncIterable<CanonicalStreamEvent>;
}

export interface DesignToolRequestHandler {
  (
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
    reportProgress: (message: string, progress: number) => void,
  ): Promise<TrustedToolResult>;
}

export interface SessionStoreRequestHandler {
  (
    request: SessionStoreBridgeRequest,
    signal: AbortSignal,
  ): Promise<SessionStoreBridgeResponse>;
}

export type PendingAgentApproval = {
  approvalId: string;
  input: unknown;
  runId: string;
  toolCallId: string;
  toolName: string;
  risk: "read" | "design_write" | "external" | "destructive";
};

export class FatalAgentRunError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FatalAgentRunError";
  }
}

const AGENT_ENVIRONMENT_ALLOWLIST = [
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TZ",
] as const;

export function createAgentEnvironment(
  source: NodeJS.ProcessEnv,
  nodeEnvironment: "development" | "production",
): Record<string, string> {
  const environment: Record<string, string> = {
    NODE_ENV: nodeEnvironment,
  };
  for (const name of AGENT_ENVIRONMENT_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  if (source.OPENDESIGN_AGENT_SMOKE === "1") {
    environment.OPENDESIGN_AGENT_SMOKE = "1";
  }
  return environment;
}

export class AgentHost {
  readonly #supervisor: AgentSupervisor;
  readonly #listeners = new Set<AgentHostListener>();
  #modelRequestHandler: ModelRequestHandler | null = null;
  readonly #modelRequests = new Map<string, AbortController>();
  #designToolRequestHandler: DesignToolRequestHandler | null = null;
  readonly #designToolRequests = new Map<string, AbortController>();
  #sessionStoreRequestHandler: SessionStoreRequestHandler | null = null;
  readonly #sessionStoreRequests = new Map<string, AbortController>();
  readonly #toolRequests = new Map<
    string,
    {
      input: unknown;
      runId: string;
      toolName: string;
      risk: PendingAgentApproval["risk"];
    }
  >();
  readonly #pendingApprovals = new Map<
    string,
    PendingAgentApproval & { resolutionSent: boolean }
  >();

  constructor() {
    this.#supervisor = new AgentSupervisor({
      clientVersion: app.getVersion(),
      fork: () => {
        const child = utilityProcess.fork(
          join(__dirname, "../agent/index.cjs"),
          [],
          {
            serviceName: "OpenDesign Agent",
            stdio: "pipe",
            env: createAgentEnvironment(
              process.env,
              app.isPackaged ? "production" : "development",
            ),
          },
        );
        child.stderr?.on("data", (chunk: Buffer) => {
          console.error(`[agent] ${chunk.toString().trimEnd()}`);
        });
        return child;
      },
      forceKill: (pid) => process.kill(pid, "SIGKILL"),
      onFailure: (failure) => {
        this.emit({
          type: "agent.error",
          code: failure.code,
          message: failure.message,
        });
      },
      onMessage: (message, generation, agentEventResult) =>
        this.onMessage(message, generation, agentEventResult),
      onProcessTerminated: () => this.resetProcessState(),
    });
  }

  setModelRequestHandler(handler: ModelRequestHandler | null): void {
    this.#modelRequestHandler = handler;
  }

  setDesignToolRequestHandler(handler: DesignToolRequestHandler | null): void {
    this.#designToolRequestHandler = handler;
  }

  setSessionStoreRequestHandler(
    handler: SessionStoreRequestHandler | null,
  ): void {
    this.#sessionStoreRequestHandler = handler;
  }

  start(): Promise<void> {
    return this.#supervisor.start();
  }

  send(request: AgentRequest): void {
    if (
      request.type === "approval.resolve" &&
      !this.#pendingApprovals.get(request.approvalId)?.resolutionSent
    ) {
      throw new Error("Approval resolution was not authorized by Main");
    }
    this.#supervisor.send(request);
  }

  prepareApprovalResolution(
    request: Extract<AgentRequest, { type: "approval.resolve" }>,
  ): PendingAgentApproval {
    const pending = this.#pendingApprovals.get(request.approvalId);
    if (
      !pending ||
      pending.runId !== request.runId ||
      pending.toolCallId !== request.toolCallId ||
      pending.resolutionSent
    ) {
      throw new Error("Approval resolution does not match a pending request");
    }
    pending.resolutionSent = true;
    return {
      approvalId: pending.approvalId,
      input: structuredClone(pending.input),
      runId: pending.runId,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      risk: pending.risk,
    };
  }

  rollbackApprovalResolution(approvalId: string): void {
    const pending = this.#pendingApprovals.get(approvalId);
    if (pending) pending.resolutionSent = false;
  }

  on(listener: AgentHostListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  stop(): Promise<void> {
    this.resetProcessState();
    return this.#supervisor.stop();
  }

  private onMessage(
    message: unknown,
    generation: number,
    agentEventResult: RuntimeContractResult<AgentEvent>,
  ): void {
    if (isSessionStoreBridgeRequest(message)) {
      void this.handleSessionStoreRequest(message, generation);
      return;
    }
    const rejectedSessionRequestId = sessionStoreBridgeRequestId(message);
    const rejectedSessionOperation =
      sessionStoreBridgeRequestOperation(message);
    if (rejectedSessionRequestId && rejectedSessionOperation) {
      this.#supervisor.postMessageForGeneration(generation, {
        type: "session-store.response",
        requestId: rejectedSessionRequestId,
        operation: rejectedSessionOperation,
        ok: false,
        error: "Session Store request rejected by Main",
      } satisfies SessionStoreBridgeResponse);
      return;
    }
    if (isDesignToolBridgeRequest(message, validateDesignAgentToolInput)) {
      void this.handleDesignToolRequest(
        message.requestId,
        message.call,
        message.context,
        generation,
      );
      return;
    }
    const rejectedDesignToolRequestId = designToolBridgeRequestId(message);
    if (rejectedDesignToolRequestId) {
      console.error("Rejected invalid design tool request");
      this.#supervisor.postMessageForGeneration(generation, {
        type: "design-tool.response",
        requestId: rejectedDesignToolRequestId,
        ok: false,
        error: {
          code: "invalid_tool_request",
          message: "Design tool request rejected by the host",
          retryable: false,
          recoverable: false,
        },
      } satisfies DesignToolBridgeResponse);
      return;
    }
    if (isDesignToolBridgeCancel(message)) {
      const controller = this.#designToolRequests.get(message.requestId);
      controller?.abort();
      if (this.#designToolRequests.get(message.requestId) === controller) {
        this.#designToolRequests.delete(message.requestId);
      }
      return;
    }
    if (isModelBridgeRequest(message)) {
      void this.handleModelRequest(
        message.requestId,
        message.request,
        generation,
      );
      return;
    }
    const rejectedModelRequestId = modelBridgeRequestId(message);
    if (rejectedModelRequestId) {
      const error = modelBridgeRequestValidationError(message);
      console.error(`Rejected invalid model request: ${error}`);
      this.#supervisor.postMessageForGeneration(generation, {
        type: "model.response",
        requestId: rejectedModelRequestId,
        ok: false,
        error: `Model request rejected by the host: ${error}`,
      } satisfies ModelBridgeResponse);
      return;
    }
    if (isModelBridgeCancel(message)) {
      const controller = this.#modelRequests.get(message.requestId);
      controller?.abort();
      if (this.#modelRequests.get(message.requestId) === controller) {
        this.#modelRequests.delete(message.requestId);
      }
      return;
    }
    if (!agentEventResult.ok) {
      const validationError = formatRuntimeContractFailure(
        "Agent event",
        agentEventResult.issues,
      );
      console.error(`Rejected invalid Agent event: ${validationError}`);
      const runId = agentEventRunId(message);
      const requestId = agentEventRequestId(message);
      if (runId) {
        this.#supervisor.postMessageForGeneration(generation, {
          type: "run.cancel",
          runId,
        } satisfies AgentRequest);
      }
      this.emit({
        type: "agent.error",
        code: "invalid_event",
        message: `Agent returned an invalid event: ${validationError}`,
        ...(runId ? { runId } : {}),
        ...(requestId ? { requestId } : {}),
      });
      return;
    }
    const event = agentEventResult.value;
    if (event.type === "tool.requested") {
      this.#toolRequests.set(`${event.runId}:${event.toolCallId}`, {
        input: structuredClone(event.input),
        runId: event.runId,
        toolName: event.toolName,
        risk: event.risk,
      });
    }
    if (event.type === "approval.requested") {
      const tool = this.#toolRequests.get(`${event.runId}:${event.toolCallId}`);
      if (!tool) {
        this.emit({
          type: "agent.error",
          code: "approval_sequence_invalid",
          message: "Agent requested approval for an unknown tool call",
          runId: event.runId,
        });
        this.#supervisor.postMessageForGeneration(generation, {
          type: "run.cancel",
          runId: event.runId,
        } satisfies AgentRequest);
        return;
      }
      this.#pendingApprovals.set(event.approvalId, {
        approvalId: event.approvalId,
        input: structuredClone(tool.input),
        runId: event.runId,
        toolCallId: event.toolCallId,
        toolName: tool.toolName,
        risk: tool.risk,
        resolutionSent: false,
      });
    }
    if (event.type === "approval.resolved") {
      this.#pendingApprovals.delete(event.approvalId);
    }
    if (event.type === "run.completed" || event.type === "agent.error") {
      const runId = event.runId;
      if (runId) {
        for (const [key, tool] of this.#toolRequests) {
          if (tool.runId === runId) this.#toolRequests.delete(key);
        }
        for (const [approvalId, approval] of this.#pendingApprovals) {
          if (approval.runId === runId) {
            this.#pendingApprovals.delete(approvalId);
          }
        }
      }
    }
    this.emit(event);
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  private async handleModelRequest(
    requestId: string,
    request: Omit<ModelRequest, "signal">,
    generation: number,
  ): Promise<void> {
    const handler = this.#modelRequestHandler;
    if (!handler) {
      this.#supervisor.postMessageForGeneration(generation, {
        type: "model.response",
        requestId,
        ok: false,
        error: "Model provider is not initialized",
      } satisfies ModelBridgeResponse);
      return;
    }
    if (this.#modelRequests.has(requestId)) {
      console.error(`Rejected duplicate model request: ${requestId}`);
      return;
    }
    const controller = new AbortController();
    this.#modelRequests.set(requestId, controller);
    try {
      for await (const event of handler(request, controller.signal)) {
        if (controller.signal.aborted) return;
        if (
          !this.#supervisor.postMessageForGeneration(generation, {
            type: "model.event",
            requestId,
            event,
          } satisfies ModelBridgeResponse)
        )
          return;
      }
      if (controller.signal.aborted) return;
      this.#supervisor.postMessageForGeneration(generation, {
        type: "model.response",
        requestId,
        ok: true,
      } satisfies ModelBridgeResponse);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.#supervisor.postMessageForGeneration(generation, {
        type: "model.response",
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : "Model request failed",
      } satisfies ModelBridgeResponse);
    } finally {
      if (this.#modelRequests.get(requestId) === controller) {
        this.#modelRequests.delete(requestId);
      }
    }
  }

  private abortModelRequests(): void {
    for (const controller of this.#modelRequests.values()) controller.abort();
    this.#modelRequests.clear();
  }

  private async handleDesignToolRequest(
    requestId: string,
    call: ToolCallRequest,
    context: TrustedToolContext,
    generation: number,
  ): Promise<void> {
    const handler = this.#designToolRequestHandler;
    if (!handler) {
      this.#supervisor.postMessageForGeneration(generation, {
        type: "design-tool.response",
        requestId,
        ok: false,
        error: {
          code: "tool_host_unavailable",
          message: "Design tool host is not initialized",
          retryable: false,
          recoverable: false,
        },
      } satisfies DesignToolBridgeResponse);
      return;
    }
    if (this.#designToolRequests.has(requestId)) {
      console.error(`Rejected duplicate design tool request: ${requestId}`);
      return;
    }
    const controller = new AbortController();
    this.#designToolRequests.set(requestId, controller);
    try {
      const result = await handler(
        call,
        context,
        controller.signal,
        (message, progress) => {
          if (controller.signal.aborted) return;
          this.#supervisor.postMessageForGeneration(generation, {
            type: "design-tool.progress",
            requestId,
            message,
            progress,
          } satisfies DesignToolBridgeProgress);
        },
      );
      if (controller.signal.aborted) return;
      this.#supervisor.postMessageForGeneration(generation, {
        type: "design-tool.response",
        requestId,
        ok: true,
        result,
      } satisfies DesignToolBridgeResponse);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.#supervisor.postMessageForGeneration(generation, {
        type: "design-tool.response",
        requestId,
        ok: false,
        error: trustedToolFailureFromError(error),
      } satisfies DesignToolBridgeResponse);
      if (error instanceof FatalAgentRunError) {
        this.#supervisor.postMessageForGeneration(generation, {
          type: "run.cancel",
          runId: context.runId,
        } satisfies AgentRequest);
        this.emit({
          type: "agent.error",
          code: error.code,
          message: error.message,
          runId: context.runId,
        });
      }
    } finally {
      if (this.#designToolRequests.get(requestId) === controller) {
        this.#designToolRequests.delete(requestId);
      }
    }
  }

  private async handleSessionStoreRequest(
    request: SessionStoreBridgeRequest,
    generation: number,
  ): Promise<void> {
    const handler = this.#sessionStoreRequestHandler;
    if (!handler) {
      this.#supervisor.postMessageForGeneration(generation, {
        type: "session-store.response",
        requestId: request.requestId,
        operation: request.operation,
        ok: false,
        error: "Session Store host is not initialized",
      } satisfies SessionStoreBridgeResponse);
      return;
    }
    if (this.#sessionStoreRequests.has(request.requestId)) {
      this.#supervisor.postMessageForGeneration(generation, {
        type: "session-store.response",
        requestId: request.requestId,
        operation: request.operation,
        ok: false,
        error: "Duplicate Session Store request",
      } satisfies SessionStoreBridgeResponse);
      return;
    }
    const controller = new AbortController();
    this.#sessionStoreRequests.set(request.requestId, controller);
    try {
      const response = await handler(request, controller.signal);
      if (controller.signal.aborted) return;
      if (!isSessionStoreBridgeResponse(response)) {
        throw new TypeError(
          sessionStoreBridgeResponseValidationError(response) ??
            "Session Store handler returned an invalid response",
        );
      }
      if (
        response.requestId !== request.requestId ||
        response.operation !== request.operation
      ) {
        throw new TypeError(
          "Session Store handler returned the wrong response",
        );
      }
      this.#supervisor.postMessageForGeneration(generation, response);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.#supervisor.postMessageForGeneration(generation, {
        type: "session-store.response",
        requestId: request.requestId,
        operation: request.operation,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Session Store request failed",
      } satisfies SessionStoreBridgeResponse);
    } finally {
      if (this.#sessionStoreRequests.get(request.requestId) === controller) {
        this.#sessionStoreRequests.delete(request.requestId);
      }
    }
  }

  private abortDesignToolRequests(): void {
    for (const controller of this.#designToolRequests.values()) {
      controller.abort();
    }
    this.#designToolRequests.clear();
  }

  private resetProcessState(): void {
    this.abortModelRequests();
    this.abortDesignToolRequests();
    for (const controller of this.#sessionStoreRequests.values()) {
      controller.abort();
    }
    this.#sessionStoreRequests.clear();
    this.#toolRequests.clear();
    this.#pendingApprovals.clear();
  }
}

function trustedToolFailureFromError(error: unknown): TrustedToolFailure {
  if (
    error instanceof Error &&
    "cause" in error &&
    isTrustedToolFailure(error.cause)
  ) {
    return error.cause;
  }
  const fatal = error instanceof FatalAgentRunError;
  return {
    code: fatal ? error.code : "tool_error",
    message:
      error instanceof Error ? error.message : "Design tool request failed",
    retryable: false,
    recoverable: !fatal,
  };
}
