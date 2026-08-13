import { app, utilityProcess, type UtilityProcess } from "electron";
import {
  AGENT_PROTOCOL_VERSION,
  isAgentEvent,
  type AgentEvent,
  type AgentRequest,
} from "@opendesign/agent-contracts";
import type {
  CanonicalStreamEvent,
  ModelRequest,
} from "@opendesign/model-gateway";
import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolFailure,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import { join } from "node:path";
import {
  isModelBridgeCancel,
  isModelBridgeRequest,
  modelBridgeRequestId,
  modelBridgeRequestValidationError,
  type ModelBridgeResponse,
} from "../../shared/model-bridge";
import {
  designToolBridgeRequestId,
  isDesignToolBridgeCancel,
  isDesignToolBridgeRequest,
  isTrustedToolFailure,
  type DesignToolBridgeProgress,
  type DesignToolBridgeResponse,
} from "../../shared/design-tool-bridge";
import { trustedDesignWorkflowFailure } from "./design-workflow-failure";

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
  #process: UtilityProcess | null = null;
  readonly #listeners = new Set<AgentHostListener>();
  #ready = false;
  #stopping = false;
  #modelRequestHandler: ModelRequestHandler | null = null;
  readonly #modelRequests = new Map<string, AbortController>();
  #designToolRequestHandler: DesignToolRequestHandler | null = null;
  readonly #designToolRequests = new Map<string, AbortController>();
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

  setModelRequestHandler(handler: ModelRequestHandler | null): void {
    this.#modelRequestHandler = handler;
  }

  setDesignToolRequestHandler(handler: DesignToolRequestHandler | null): void {
    this.#designToolRequestHandler = handler;
  }

  start(): void {
    if (this.#process) return;
    this.#stopping = false;
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
    this.#process = child;
    child.on("message", (message: unknown) => this.onMessage(message));
    child.on("exit", (code) => {
      const wasRunning = this.#process === child;
      const expected = this.#stopping;
      this.#ready = false;
      this.abortModelRequests();
      this.abortDesignToolRequests();
      this.#toolRequests.clear();
      this.#pendingApprovals.clear();
      this.#process = null;
      this.#stopping = false;
      if (wasRunning && !expected) {
        this.emit({
          type: "agent.error",
          code: "process_exited",
          message: `Agent process exited with code ${code}`,
        });
      }
    });
    child.on("error", (type, location) => {
      this.emit({
        type: "agent.error",
        code: "process_error",
        message: `${type} at ${location}`,
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      console.error(`[agent] ${chunk.toString().trimEnd()}`);
    });
  }

  send(request: AgentRequest): void {
    if (!this.#process) throw new Error("Agent process is not running");
    if (!this.#ready && request.type !== "handshake") {
      throw new Error("Agent process is not ready");
    }
    if (
      request.type === "approval.resolve" &&
      !this.#pendingApprovals.get(request.approvalId)?.resolutionSent
    ) {
      throw new Error("Approval resolution was not authorized by Main");
    }
    this.#process.postMessage(request);
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

  stop(): void {
    const child = this.#process;
    if (!child) return;
    this.#stopping = true;
    this.#ready = false;
    this.abortModelRequests();
    this.abortDesignToolRequests();
    this.#toolRequests.clear();
    this.#pendingApprovals.clear();
    child.kill();
  }

  private onMessage(message: unknown): void {
    if (isDesignToolBridgeRequest(message)) {
      void this.handleDesignToolRequest(
        message.requestId,
        message.call,
        message.context,
      );
      return;
    }
    const rejectedDesignToolRequestId = designToolBridgeRequestId(message);
    if (rejectedDesignToolRequestId) {
      console.error("Rejected invalid design tool request");
      this.#process?.postMessage({
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
      void this.handleModelRequest(message.requestId, message.request);
      return;
    }
    const rejectedModelRequestId = modelBridgeRequestId(message);
    if (rejectedModelRequestId) {
      const error = modelBridgeRequestValidationError(message);
      console.error(`Rejected invalid model request: ${error}`);
      this.#process?.postMessage({
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
    if (!isAgentEvent(message)) {
      console.error("Rejected invalid Agent event");
      const run = candidateRunId(message);
      if (run.runId) {
        this.#process?.postMessage({
          type: "run.cancel",
          runId: run.runId,
        } satisfies AgentRequest);
      }
      this.emit({
        type: "agent.error",
        code: "invalid_event",
        message: "Agent returned an invalid event",
        ...run,
      });
      return;
    }
    const event = message;
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
        this.#process?.postMessage({
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
    if (event.type === "agent.ready") {
      if (event.protocolVersion !== AGENT_PROTOCOL_VERSION) {
        this.emit({
          type: "agent.error",
          code: "protocol_mismatch",
          message: `Agent protocol mismatch: ${event.protocolVersion} != ${AGENT_PROTOCOL_VERSION}`,
        });
        this.stop();
        return;
      }
      this.#process?.postMessage({
        type: "handshake",
        protocolVersion: AGENT_PROTOCOL_VERSION,
        clientVersion: app.getVersion(),
      } satisfies AgentRequest);
    }
    if (event.type === "agent.connected") {
      if (event.protocolVersion !== AGENT_PROTOCOL_VERSION) {
        this.emit({
          type: "agent.error",
          code: "protocol_mismatch",
          message: `Agent protocol mismatch: ${event.protocolVersion} != ${AGENT_PROTOCOL_VERSION}`,
        });
        this.stop();
        return;
      }
      this.#ready = true;
    }
    this.emit(event);
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  private async handleModelRequest(
    requestId: string,
    request: Omit<ModelRequest, "signal">,
  ): Promise<void> {
    const child = this.#process;
    const handler = this.#modelRequestHandler;
    if (!child) return;
    if (!handler) {
      child.postMessage({
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
        if (this.#process !== child || controller.signal.aborted) return;
        child.postMessage({
          type: "model.event",
          requestId,
          event,
        } satisfies ModelBridgeResponse);
      }
      if (this.#process !== child || controller.signal.aborted) return;
      child.postMessage({
        type: "model.response",
        requestId,
        ok: true,
      } satisfies ModelBridgeResponse);
    } catch (error) {
      if (this.#process !== child || controller.signal.aborted) return;
      child.postMessage({
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
  ): Promise<void> {
    const child = this.#process;
    const handler = this.#designToolRequestHandler;
    if (!child) return;
    if (!handler) {
      child.postMessage({
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
          if (this.#process !== child || controller.signal.aborted) return;
          child.postMessage({
            type: "design-tool.progress",
            requestId,
            message,
            progress,
          } satisfies DesignToolBridgeProgress);
        },
      );
      if (this.#process !== child || controller.signal.aborted) return;
      child.postMessage({
        type: "design-tool.response",
        requestId,
        ok: true,
        result,
      } satisfies DesignToolBridgeResponse);
    } catch (error) {
      if (this.#process !== child || controller.signal.aborted) return;
      child.postMessage({
        type: "design-tool.response",
        requestId,
        ok: false,
        error: trustedToolFailureFromError(error),
      } satisfies DesignToolBridgeResponse);
      if (error instanceof FatalAgentRunError) {
        child.postMessage({
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

  private abortDesignToolRequests(): void {
    for (const controller of this.#designToolRequests.values()) {
      controller.abort();
    }
    this.#designToolRequests.clear();
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
  if (error instanceof Error) {
    const workflowFailure = trustedDesignWorkflowFailure(error);
    if (workflowFailure) return workflowFailure;
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

function candidateRunId(value: unknown): { runId?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const runId = (value as { runId?: unknown }).runId;
  return typeof runId === "string" && runId.length > 0 && runId.length <= 256
    ? { runId }
    : {};
}
