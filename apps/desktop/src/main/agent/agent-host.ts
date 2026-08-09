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
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import { join } from "node:path";
import {
  isModelBridgeCancel,
  isModelBridgeRequest,
  type ModelBridgeResponse,
} from "../../shared/model-bridge";
import {
  isDesignToolBridgeCancel,
  isDesignToolBridgeRequest,
  type DesignToolBridgeResponse,
} from "../../shared/design-tool-bridge";

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
  ): Promise<TrustedToolResult>;
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
    this.#process.postMessage(request);
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
      return;
    }
    const event = message;
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
        error: "Design tool host is not initialized",
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
      const result = await handler(call, context, controller.signal);
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
        error:
          error instanceof Error ? error.message : "Design tool request failed",
      } satisfies DesignToolBridgeResponse);
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
