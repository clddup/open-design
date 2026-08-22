import type {
  AgentEvent,
  AgentInitialDesignInspection,
  AgentRequest,
} from "@opendesign/agent-contracts";
import type { ModelProviderHost } from "../model/model-provider-host.js";
import type { ProjectHost } from "../project/project-host.js";
import { prepareAgentContinuation } from "./agent-continuation-host.js";
import { AgentContinuationScheduler } from "./agent-continuation-scheduler.js";
import type { AgentHost } from "./agent-host.js";
import type { AgentReferenceHost } from "./agent-reference-host.js";
import { handleAgentRunControlRequest } from "./agent-run-starter.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

type RunControlRequest = Extract<
  AgentRequest,
  { type: "run.start" | "run.cancel" }
>;
type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

export interface AgentRunCoordinatorServices {
  globalTaskCoordinator: GlobalTaskCoordinator | null;
  modelProviderHost: ModelProviderHost | null;
  projectHost: ProjectHost | null;
  referenceHost: AgentReferenceHost | null;
}

type AvailableAgentRunCoordinatorServices = {
  globalTaskCoordinator: GlobalTaskCoordinator;
  modelProviderHost: ModelProviderHost;
  projectHost: ProjectHost;
  referenceHost: AgentReferenceHost;
};

export interface AgentRunCoordinatorOptions {
  agentHost: AgentHost;
  forgetRun(runId: string): void;
  getServices(): AgentRunCoordinatorServices;
  prepareInitialDesignInspection(
    request: RunStartRequest,
    signal: AbortSignal,
  ): Promise<AgentInitialDesignInspection | undefined>;
  publish(event: AgentEvent): void;
}

/**
 * Owns Main-side Run leases across preflight, utility-process execution,
 * automatic continuation and reference authorization.
 */
export class AgentRunCoordinator {
  readonly #options: AgentRunCoordinatorOptions;
  readonly #continuations = new AgentContinuationScheduler();
  readonly #conversationIdByRunId = new Map<string, string>();
  readonly #initialInspectionControllers = new Map<string, AbortController>();
  #continuationEpoch = 0;
  #quiescing = false;

  constructor(options: AgentRunCoordinatorOptions) {
    this.#options = options;
  }

  async handleRequest(request: RunControlRequest): Promise<void> {
    if (request.type === "run.start" && this.#quiescing) {
      throw new Error("Agent Run coordinator is shutting down");
    }
    const services = this.#requireRunServices();
    const handled = await handleAgentRunControlRequest(request, {
      ...this.#starter(services),
      publish: (event) => this.#options.publish(event),
    });
    if (!handled) this.#options.agentHost.send(request);
  }

  handleEvent(event: AgentEvent): void {
    const services = this.#options.getServices();
    const continuationEpoch = this.#continuationEpoch;
    prepareAgentContinuation(event, {
      canStart: () =>
        !this.#quiescing && this.#continuationEpoch === continuationEpoch,
      continuationScheduler: this.#continuations,
      publish: (continuationEvent) => this.#options.publish(continuationEvent),
      projectHost: services.projectHost,
      starter: this.#completeServices(services)
        ? this.#starter(services)
        : null,
    });

    if (event.type === "run.completed") {
      services.referenceHost?.releaseRun(event.runId);
      this.#options.forgetRun(event.runId);
      this.#conversationIdByRunId.delete(event.runId);
      this.#initialInspectionControllers.delete(event.runId);
    } else if (event.type === "agent.error" && event.runId === undefined) {
      this.#releaseAllRunLeases(services.referenceHost);
    }
    services.globalTaskCoordinator?.handleAgentEvent(event);
  }

  conversationIdForRun(runId: string): string | undefined {
    return this.#conversationIdByRunId.get(runId);
  }

  hasActiveConversationRun(conversationId: string): boolean {
    return this.#continuations.hasActiveConversationRun(conversationId);
  }

  quiesceAndCancelAll(): void {
    if (this.#quiescing) return;
    this.#quiescing = true;
    this.#continuationEpoch += 1;
    for (const runId of this.#continuations.activeRunIds()) {
      const targetRunId = this.#continuations.requestCancellation(runId);
      if (!targetRunId) continue;
      const preflight = this.#initialInspectionControllers.get(targetRunId);
      if (preflight) {
        preflight.abort();
        continue;
      }
      try {
        this.#options.agentHost.send({
          type: "run.cancel",
          runId: targetRunId,
        });
      } catch {
        // The Supervisor may already be stopping; dispose releases the lease.
      }
    }
  }

  dispose(): void {
    this.quiesceAndCancelAll();
    this.#releaseAllRunLeases(this.#options.getServices().referenceHost);
  }

  #starter(services: AvailableAgentRunCoordinatorServices) {
    return {
      agentHost: this.#options.agentHost,
      continuationScheduler: this.#continuations,
      conversationIdByRunId: this.#conversationIdByRunId,
      globalTaskCoordinator: services.globalTaskCoordinator,
      initialInspectionControllers: this.#initialInspectionControllers,
      modelProviderHost: services.modelProviderHost,
      prepareInitialDesignInspection: (
        request: RunStartRequest,
        signal: AbortSignal,
      ) => this.#options.prepareInitialDesignInspection(request, signal),
      referenceHost: services.referenceHost,
    };
  }

  #requireRunServices(): AvailableAgentRunCoordinatorServices {
    const services = this.#options.getServices();
    if (!this.#completeServices(services)) {
      throw new Error("Global Task services are not initialized");
    }
    return services;
  }

  #completeServices(
    services: AgentRunCoordinatorServices,
  ): services is AvailableAgentRunCoordinatorServices {
    return Boolean(
      services.globalTaskCoordinator &&
      services.modelProviderHost &&
      services.projectHost &&
      services.referenceHost,
    );
  }

  #releaseAllRunLeases(referenceHost: AgentReferenceHost | null): void {
    this.#continuationEpoch += 1;
    const runIds = new Set([
      ...this.#continuations.activeRunIds(),
      ...this.#conversationIdByRunId.keys(),
      ...this.#initialInspectionControllers.keys(),
    ]);
    for (const controller of this.#initialInspectionControllers.values()) {
      controller.abort();
    }
    this.#initialInspectionControllers.clear();
    this.#conversationIdByRunId.clear();
    for (const runId of runIds) {
      referenceHost?.releaseRun(runId);
      this.#options.forgetRun(runId);
      this.#continuations.forgetRun(runId);
    }
  }
}
