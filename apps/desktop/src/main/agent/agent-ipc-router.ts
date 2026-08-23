import {
  isAgentRequest,
  type AgentEvent,
  type AgentRequest,
} from "@opendesign/agent-contracts";
import type { IpcMainInvokeEvent } from "electron";
import { channels } from "@/shared/desktop-api.js";
import type { DiagnosticContext } from "@/shared/diagnostics.js";
import { handleAgentApprovalRequest } from "./agent-approval-handler.js";
import type { AgentHost } from "./agent-host.js";
import type { AgentRunCoordinator } from "./agent-run-coordinator.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

type AgentIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface AgentIpcRegistrar {
  handle(channel: string, listener: AgentIpcHandler): void;
}

export interface AgentIpcRouterOptions {
  agentHost: AgentHost;
  getCoordinator(): GlobalTaskCoordinator | null;
  observeEvent(event: AgentEvent, context: DiagnosticContext | undefined): void;
  publish(event: AgentEvent): void;
  runCoordinator: AgentRunCoordinator;
}

/**
 * Owns Renderer↔Agent request/event routing and ephemeral Conversation
 * correlations. Run state, provider state and design state stay in their
 * existing owners and are resolved for every request or event.
 */
export class AgentIpcRouter {
  readonly #options: AgentIpcRouterOptions;
  readonly #conversationIdByRequestId = new Map<string, string>();
  #detachAgentListener: (() => void) | null = null;

  constructor(options: AgentIpcRouterOptions) {
    this.#options = options;
  }

  register(options: {
    assertRenderer(event: IpcMainInvokeEvent, message?: string): void;
    ipc: AgentIpcRegistrar;
  }): void {
    if (this.#detachAgentListener) {
      throw new Error("Agent IPC router is already registered");
    }
    options.ipc.handle(channels.agentRequest, (event, ...args) => {
      options.assertRenderer(event, "Agent request from unknown renderer");
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isAgentRequest(request)) {
        throw new TypeError("Invalid Agent request");
      }
      return this.#handleRequest(request);
    });
    this.#detachAgentListener = this.#options.agentHost.on((event) => {
      this.#handleEvent(event);
    });
  }

  clear(): void {
    this.#conversationIdByRequestId.clear();
  }

  dispose(): void {
    this.clear();
    this.#detachAgentListener?.();
    this.#detachAgentListener = null;
  }

  async #handleRequest(request: AgentRequest): Promise<void> {
    if (request.type === "handshake") {
      throw new TypeError("Agent handshake is host-internal");
    }
    if (request.type === "approval.resolve") {
      const coordinator = this.#requireCoordinator();
      handleAgentApprovalRequest(request, {
        agentHost: this.#options.agentHost,
        globalTaskCoordinator: coordinator,
      });
      return;
    }
    if (request.type === "run.start" || request.type === "run.cancel") {
      await this.#options.runCoordinator.handleRequest(request);
      return;
    }
    if (request.type === "session.history") {
      this.#conversationIdByRequestId.set(request.requestId, request.sessionId);
    }
    try {
      this.#options.agentHost.send(request);
    } catch (error) {
      if (request.type === "session.history") {
        this.#conversationIdByRequestId.delete(request.requestId);
      }
      throw error;
    }
  }

  #handleEvent(event: AgentEvent): void {
    const context = this.#diagnosticContext(event);
    this.#options.observeEvent(event, context);
    if (event.type === "session.history") {
      this.#conversationIdByRequestId.delete(event.requestId);
    }
    if (event.type === "agent.error" && event.requestId) {
      this.#conversationIdByRequestId.delete(event.requestId);
    }
    this.#options.runCoordinator.handleEvent(event);
    this.#options.publish(event);
  }

  #diagnosticContext(event: AgentEvent): DiagnosticContext | undefined {
    const runId = "runId" in event ? event.runId : undefined;
    const requestId =
      "requestId" in event
        ? event.requestId
        : event.type === "agent.error"
          ? event.failure?.modelRequestId
          : undefined;
    const toolCallId = "toolCallId" in event ? event.toolCallId : undefined;
    const conversationId = runId
      ? this.#options.runCoordinator.conversationIdForRun(runId)
      : requestId
        ? this.#conversationIdByRequestId.get(requestId)
        : event.type === "session.history"
          ? event.sessionId
          : undefined;
    if (!conversationId && !runId && !requestId && !toolCallId) {
      return undefined;
    }
    return {
      ...(conversationId ? { conversationId } : {}),
      ...(runId ? { runId } : {}),
      ...(requestId ? { requestId } : {}),
      ...(toolCallId ? { toolCallId } : {}),
    };
  }

  #requireCoordinator(): GlobalTaskCoordinator {
    const coordinator = this.#options.getCoordinator();
    if (!coordinator) {
      throw new Error("Global Task services are not initialized");
    }
    return coordinator;
  }
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}
