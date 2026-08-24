import type {
  AgentEvent,
  AgentInitialDesignInspection,
  AgentRequest,
} from "@opendesign/agent-contracts";
import type { ModelProviderHost } from "../model/model-provider-host.js";
import type { AgentContinuationScheduler } from "./agent-continuation-scheduler.js";
import type { AgentHost } from "./agent-host.js";
import type { AgentReferenceHost } from "./agent-reference-host.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import { resolveDeliveryScopeReview } from "./delivery-scope-review-policy.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

export interface AgentRunStarterDependencies {
  agentHost: AgentHost;
  continuationScheduler: AgentContinuationScheduler;
  conversationIdByRunId: Map<string, string>;
  globalTaskCoordinator: GlobalTaskCoordinator;
  initialInspectionControllers: Map<string, AbortController>;
  modelProviderHost: ModelProviderHost;
  prepareInitialDesignInspection?: (
    request: RunStartRequest,
    signal: AbortSignal,
  ) => Promise<AgentInitialDesignInspection | undefined>;
  referenceHost: AgentReferenceHost;
}

export async function handleAgentRunControlRequest(
  request: Extract<AgentRequest, { type: "run.start" | "run.cancel" }>,
  dependencies: AgentRunStarterDependencies & {
    publish: (event: AgentEvent) => void;
  },
): Promise<boolean> {
  if (request.type === "run.start") {
    if (request.modelContext !== undefined) {
      throw new TypeError("Renderer cannot supply model context metadata");
    }
    if (request.initialDesignInspection !== undefined) {
      throw new TypeError("Renderer cannot supply initial design inspection");
    }
    if (request.deliveryScopeReview !== undefined) {
      throw new TypeError("Renderer cannot supply delivery scope policy");
    }
    if (request.continuation === undefined) {
      for (const runId of dependencies.continuationScheduler.supersedeAutomaticContinuations(
        request.sessionId,
      )) {
        dependencies.initialInspectionControllers.get(runId)?.abort();
        dependencies.agentHost.send({ type: "run.cancel", runId });
      }
    }
    const started = await startAgentRun(request, dependencies);
    if (!started) dependencies.publish(cancelledRun(request.runId));
    return true;
  }
  // Cancellation intent is Main-owned. Redirect a late parent cancellation
  // to the latest scheduled child so Stop terminates the recovery chain.
  const cancellationTarget =
    dependencies.continuationScheduler.requestCancellation(request.runId);
  const initialInspection = cancellationTarget
    ? dependencies.initialInspectionControllers.get(cancellationTarget)
    : undefined;
  if (initialInspection) {
    initialInspection.abort();
    return true;
  }
  if (cancellationTarget && cancellationTarget !== request.runId) {
    dependencies.agentHost.send({ ...request, runId: cancellationTarget });
    return true;
  }
  return false;
}

export async function startAgentRun(
  request: RunStartRequest,
  dependencies: AgentRunStarterDependencies,
): Promise<boolean> {
  const {
    agentHost,
    continuationScheduler,
    conversationIdByRunId,
    globalTaskCoordinator,
    modelProviderHost,
    referenceHost,
  } = dependencies;
  const trustedRequest: RunStartRequest = {
    ...request,
    deliveryScopeReview: resolveDeliveryScopeReview(request),
  };
  continuationScheduler.registerRun(trustedRequest);
  try {
    await globalTaskCoordinator.registerRun(trustedRequest);
    if (continuationScheduler.isCancellationRequested(request.runId)) {
      globalTaskCoordinator.handleAgentEvent(cancelledRun(request.runId));
      continuationScheduler.forgetRun(request.runId);
      return false;
    }
    let initialDesignInspection: AgentInitialDesignInspection | undefined;
    if (dependencies.prepareInitialDesignInspection) {
      const controller = new AbortController();
      dependencies.initialInspectionControllers.set(request.runId, controller);
      try {
        if (continuationScheduler.isCancellationRequested(request.runId)) {
          controller.abort();
        } else {
          initialDesignInspection =
            await dependencies.prepareInitialDesignInspection(
              trustedRequest,
              controller.signal,
            );
        }
      } finally {
        if (
          dependencies.initialInspectionControllers.get(request.runId) ===
          controller
        ) {
          dependencies.initialInspectionControllers.delete(request.runId);
        }
      }
    }
    if (continuationScheduler.isCancellationRequested(request.runId)) {
      globalTaskCoordinator.handleAgentEvent(cancelledRun(request.runId));
      continuationScheduler.forgetRun(request.runId);
      return false;
    }
    referenceHost.registerRun(trustedRequest);
    conversationIdByRunId.set(request.runId, request.sessionId);
    agentHost.send({
      ...trustedRequest,
      ...(initialDesignInspection === undefined
        ? {}
        : { initialDesignInspection }),
      modelContext: modelProviderHost.resolveModelContext(
        request.modelSelection,
      ),
    });
    return true;
  } catch (error) {
    conversationIdByRunId.delete(request.runId);
    referenceHost.releaseRun(request.runId);
    continuationScheduler.forgetRun(request.runId);
    globalTaskCoordinator.handleAgentEvent({
      type: "agent.error",
      code: "request_rejected",
      message: error instanceof Error ? error.message : "Agent request failed",
      runId: request.runId,
    });
    throw error;
  }
}

function cancelledRun(
  runId: string,
): Extract<AgentEvent, { type: "run.completed" }> {
  return {
    type: "run.completed",
    runId,
    finishedAt: new Date().toISOString(),
    stopReason: "cancelled",
  };
}
