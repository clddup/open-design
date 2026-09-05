import type {
  AgentEvent,
  AgentInitialDesignInspection,
  AgentRequest,
  AgentRunFailure,
} from "@opendesign/agent-contracts";
import { appendRunJournalEvent } from "@opendesign/agent-runtime";
import type { SessionStore } from "@opendesign/session-store";
import type { ModelProviderHost } from "../model/model-provider-host.js";
import type { AgentContinuationScheduler } from "./agent-continuation-scheduler.js";
import type { AgentHost } from "./agent-host.js";
import type { AgentReferenceHost } from "./agent-reference-host.js";
import { AgentRunAdmissionError } from "./agent-run-admission-error.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

export interface AgentRunStarterDependencies {
  agentHost: Pick<AgentHost, "send" | "start">;
  continuationScheduler: AgentContinuationScheduler;
  conversationIdByRunId: Map<string, string>;
  globalTaskCoordinator: GlobalTaskCoordinator;
  initialInspectionControllers: Map<string, AbortController>;
  modelProviderHost: ModelProviderHost;
  sessionStore: SessionStore;
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
    if (request.continuation === undefined) {
      for (const runId of dependencies.continuationScheduler.supersedeAutomaticContinuations(
        request.sessionId,
      )) {
        dependencies.initialInspectionControllers.get(runId)?.abort();
        try {
          dependencies.agentHost.send({ type: "run.cancel", runId });
        } catch {
          // A crashed generation has already lost this Run. The new Run below
          // starts a fresh generation instead of inheriting that failure.
        }
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
  const trustedRequest: RunStartRequest = { ...request };
  try {
    await agentHost.start();
    continuationScheduler.registerRun(trustedRequest);
    await globalTaskCoordinator.registerRun(trustedRequest);
    if (continuationScheduler.isCancellationRequested(request.runId)) {
      const completed = cancelledRun(request.runId);
      await persistUnsentRun(dependencies.sessionStore, request, completed);
      globalTaskCoordinator.handleAgentEvent(completed);
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
      const completed = cancelledRun(request.runId);
      await persistUnsentRun(dependencies.sessionStore, request, completed);
      globalTaskCoordinator.handleAgentEvent(completed);
      continuationScheduler.forgetRun(request.runId);
      return false;
    }
    await globalTaskCoordinator.assertRunRevisionCurrent(request.runId);
    referenceHost.registerRun(
      trustedRequest,
      globalTaskCoordinator.referenceAttachmentsForRun(request.runId),
    );
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
    const failure = requestFailure(error);
    const completed = failedRun(request.runId);
    try {
      await persistUnsentRun(
        dependencies.sessionStore,
        request,
        completed,
        failure,
      );
    } catch (journalError) {
      console.error("Failed to persist rejected Agent Run", journalError);
    }
    globalTaskCoordinator.handleAgentEvent({
      type: "agent.error",
      code: failure.code,
      message: failure.message,
      runId: request.runId,
      failure,
    });
    globalTaskCoordinator.handleAgentEvent(completed);
    throw error;
  }
}

async function persistUnsentRun(
  store: SessionStore,
  request: RunStartRequest,
  completed: Extract<AgentEvent, { type: "run.completed" }>,
  failure?: AgentRunFailure,
): Promise<void> {
  const timestamp = completed.finishedAt;
  await appendRunJournalEvent(
    store,
    request,
    "message.user",
    {
      messageId: `${request.runId}_user`,
      content: request.prompt,
      ...(request.attachments === undefined
        ? {}
        : { attachments: request.attachments }),
      documentId: request.documentId,
      revision: request.revision,
      scope: request.scope,
      mutationTarget: request.mutationTarget,
    },
    timestamp,
  );
  await appendRunJournalEvent(
    store,
    request,
    "run.state",
    {
      status: completed.stopReason,
      startedAt: timestamp,
      finishedAt: timestamp,
      stopReason: completed.stopReason,
      ...(failure ? { failure } : {}),
    },
    timestamp,
  );
}

function requestFailure(error: unknown): AgentRunFailure {
  return {
    code:
      error instanceof AgentRunAdmissionError ? error.code : "request_rejected",
    message: error instanceof Error ? error.message : "Agent request failed",
    retryable: true,
  };
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

function failedRun(
  runId: string,
): Extract<AgentEvent, { type: "run.completed" }> {
  return {
    type: "run.completed",
    runId,
    finishedAt: new Date().toISOString(),
    stopReason: "error",
  };
}
