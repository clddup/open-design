import {
  isAgentRequest,
  type AgentInitialDesignInspection,
  type AgentEvent,
  type AgentRequest,
} from "@opendesign/agent-contracts";
import type { IpcMainInvokeEvent } from "electron";
import { channels } from "../../shared/desktop-api.js";
import type { DiagnosticContext } from "../../shared/diagnostics.js";
import type { ModelProviderHost } from "../model/model-provider-host.js";
import type { ProjectHost } from "../project/project-host.js";
import { handleAgentApprovalRequest } from "./agent-approval-handler.js";
import type { AgentContinuationScheduler } from "./agent-continuation-scheduler.js";
import { prepareAgentContinuation } from "./agent-continuation-host.js";
import type { AgentHost } from "./agent-host.js";
import type { AgentReferenceHost } from "./agent-reference-host.js";
import { handleAgentRunControlRequest } from "./agent-run-starter.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

type AgentIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface AgentIpcRegistrar {
  handle(channel: string, listener: AgentIpcHandler): void;
}

export interface AgentRouterServices {
  globalTaskCoordinator: GlobalTaskCoordinator | null;
  modelProviderHost: ModelProviderHost | null;
  projectHost: ProjectHost | null;
  referenceHost: AgentReferenceHost | null;
}

export interface AgentIpcRouterOptions {
  agentHost: AgentHost;
  continuationScheduler: AgentContinuationScheduler;
  forgetRendererRun(runId: string): void;
  getServices(): AgentRouterServices;
  observeEvent(event: AgentEvent, context: DiagnosticContext | undefined): void;
  prepareInitialDesignInspection(
    request: Extract<AgentRequest, { type: "run.start" }>,
    signal: AbortSignal,
  ): Promise<AgentInitialDesignInspection | undefined>;
  publish(event: AgentEvent): void;
}

/**
 * Owns Renderer↔Agent request/event routing and ephemeral Conversation
 * correlations. Run state, provider state and design state stay in their
 * existing owners and are resolved for every request or event.
 */
export class AgentIpcRouter {
  readonly #options: AgentIpcRouterOptions;
  readonly #conversationIdByRunId = new Map<string, string>();
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
    this.#conversationIdByRunId.clear();
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
      const services = this.#requireRunServices();
      const handled = await handleAgentRunControlRequest(request, {
        agentHost: this.#options.agentHost,
        continuationScheduler: this.#options.continuationScheduler,
        conversationIdByRunId: this.#conversationIdByRunId,
        globalTaskCoordinator: services.globalTaskCoordinator,
        modelProviderHost: services.modelProviderHost,
        ...(request.type === "run.start"
          ? {
              prepareInitialDesignInspection: (runRequest, signal) =>
                this.#options.prepareInitialDesignInspection(
                  runRequest,
                  signal,
                ),
            }
          : {}),
        publish: (agentEvent) => this.#options.publish(agentEvent),
        referenceHost: services.referenceHost,
      });
      if (handled) return;
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
    if (event.type === "run.completed") {
      this.#options.forgetRendererRun(event.runId);
    }

    const services = this.#options.getServices();
    prepareAgentContinuation(event, {
      continuationScheduler: this.#options.continuationScheduler,
      publish: (continuationEvent) => this.#options.publish(continuationEvent),
      projectHost: services.projectHost,
      starter:
        services.globalTaskCoordinator &&
        services.modelProviderHost &&
        services.referenceHost
          ? {
              agentHost: this.#options.agentHost,
              continuationScheduler: this.#options.continuationScheduler,
              conversationIdByRunId: this.#conversationIdByRunId,
              globalTaskCoordinator: services.globalTaskCoordinator,
              modelProviderHost: services.modelProviderHost,
              prepareInitialDesignInspection: (request, signal) =>
                this.#options.prepareInitialDesignInspection(request, signal),
              referenceHost: services.referenceHost,
            }
          : null,
    });
    if (event.type === "run.completed") {
      services.referenceHost?.releaseRun(event.runId);
      this.#conversationIdByRunId.delete(event.runId);
    }
    services.globalTaskCoordinator?.handleAgentEvent(event);
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
      ? this.#conversationIdByRunId.get(runId)
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
    const coordinator = this.#options.getServices().globalTaskCoordinator;
    if (!coordinator) {
      throw new Error("Global Task services are not initialized");
    }
    return coordinator;
  }

  #requireRunServices(): {
    globalTaskCoordinator: GlobalTaskCoordinator;
    modelProviderHost: ModelProviderHost;
    referenceHost: AgentReferenceHost;
  } {
    const services = this.#options.getServices();
    if (
      !services.globalTaskCoordinator ||
      !services.modelProviderHost ||
      !services.referenceHost
    ) {
      throw new Error("Global Task services are not initialized");
    }
    return {
      globalTaskCoordinator: services.globalTaskCoordinator,
      modelProviderHost: services.modelProviderHost,
      referenceHost: services.referenceHost,
    };
  }
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}
