import type { AgentRequest } from "@opendesign/agent-contracts";
import type { ModelProviderHost } from "../model/model-provider-host.js";
import type { AgentContinuationScheduler } from "./agent-continuation-scheduler.js";
import type { AgentHost } from "./agent-host.js";
import type { AgentReferenceHost } from "./agent-reference-host.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

export interface AgentRunStarterDependencies {
  agentHost: AgentHost;
  continuationScheduler: AgentContinuationScheduler;
  conversationIdByRunId: Map<string, string>;
  globalTaskCoordinator: GlobalTaskCoordinator;
  modelProviderHost: ModelProviderHost;
  referenceHost: AgentReferenceHost;
}

export async function startAgentRun(
  request: RunStartRequest,
  dependencies: AgentRunStarterDependencies,
): Promise<void> {
  const {
    agentHost,
    continuationScheduler,
    conversationIdByRunId,
    globalTaskCoordinator,
    modelProviderHost,
    referenceHost,
  } = dependencies;
  await globalTaskCoordinator.registerRun(request);
  referenceHost.registerRun(request);
  continuationScheduler.registerRun(request);
  conversationIdByRunId.set(request.runId, request.sessionId);
  try {
    agentHost.send({
      ...request,
      modelContext: modelProviderHost.resolveModelContext(
        request.modelSelection,
      ),
    });
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
