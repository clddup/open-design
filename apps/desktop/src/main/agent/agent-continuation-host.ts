import type { AgentEvent } from "@opendesign/agent-contracts";
import type { DesignDocument } from "@opendesign/design-contracts";
import type { ProjectHost } from "../project/project-host.js";
import {
  AGENT_CONTINUATION_PROMPT,
  type AgentContinuationScheduler,
} from "./agent-continuation-scheduler.js";
import {
  startAgentRun,
  type AgentRunStarterDependencies,
} from "./agent-run-starter.js";

type ContinuationEvent = Extract<AgentEvent, { type: "run.continuation" }>;
type ContinuationProjectHost = {
  listOpenProjects(): Array<{
    projectId: string;
    designFiles: Array<{ designFileId: string; documentId: string }>;
  }>;
  readDesignFile(
    projectId: string,
    designFileId: string,
  ): Promise<{ document: DesignDocument }>;
};

export interface AgentContinuationHostDependencies {
  canStart?: () => boolean;
  continuationScheduler: AgentContinuationScheduler;
  publish: (event: AgentEvent) => void;
  projectHost: ProjectHost | null;
  starter: AgentRunStarterDependencies | null;
}

export function prepareAgentContinuation(
  event: AgentEvent,
  dependencies: AgentContinuationHostDependencies,
): void {
  const { canStart, continuationScheduler, projectHost, publish, starter } =
    dependencies;
  if (!projectHost || !starter) return;
  const eventRunId =
    "runId" in event && typeof event.runId === "string"
      ? event.runId
      : undefined;
  const decision = continuationScheduler.record(event);
  if (!decision) return;

  if (decision.kind === "needs-attention") {
    const needsAttention: ContinuationEvent = {
      type: "run.continuation",
      runId: eventRunId ?? "unavailable_run",
      status: "needs_attention",
      attempt: decision.attempt,
      maxAttempts: decision.maxAttempts,
      reason: decision.reason,
    };
    starter.globalTaskCoordinator.handleAgentEvent(needsAttention);
    publish(needsAttention);
    return;
  }

  const scheduled: ContinuationEvent = {
    type: "run.continuation",
    runId: decision.continuation.parentRunId,
    status: "scheduled",
    attempt: decision.continuation.attempt,
    maxAttempts: decision.continuation.maxAttempts,
    reason: decision.continuation.reason,
    nextRunId: decision.nextRunId,
  };
  starter.globalTaskCoordinator.handleAgentEvent(scheduled);
  const request = createContinuationRequest(decision, projectHost);
  publish(scheduled);
  void request
    .then(async (next) => {
      if (canStart && !canStart()) {
        continuationScheduler.forgetRun(next.runId);
        starter.globalTaskCoordinator.disposeRun(next.runId);
        publish({
          type: "run.completed",
          runId: next.runId,
          finishedAt: new Date().toISOString(),
          stopReason: "cancelled",
        });
        return;
      }
      const started = await startAgentRun(next, starter);
      if (started) return;
      publish({
        type: "run.completed",
        runId: next.runId,
        finishedAt: new Date().toISOString(),
        stopReason: "cancelled",
      });
    })
    .catch((error: unknown) => {
      continuationScheduler.forgetRun(decision.nextRunId);
      const failed: ContinuationEvent = {
        ...scheduled,
        status: "needs_attention",
      };
      starter.globalTaskCoordinator.handleAgentEvent(failed);
      console.error(
        `Agent continuation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      publish(failed);
    });
}

export async function createContinuationRequest(
  decision: Extract<
    ReturnType<AgentContinuationScheduler["record"]>,
    { kind: "schedule" }
  >,
  projectHost: ContinuationProjectHost,
) {
  const source = decision.source;
  const matches = projectHost
    .listOpenProjects()
    .flatMap((project) =>
      project.designFiles
        .filter((file) => file.documentId === source.documentId)
        .map((file) => ({ projectId: project.projectId, file })),
    );
  if (matches.length !== 1 || !matches[0]) {
    throw new Error("Agent continuation document identity is unavailable");
  }
  const match = matches[0];
  const opened = await projectHost.readDesignFile(
    match.projectId,
    match.file.designFileId,
  );
  const pageId =
    source.mutationTarget.kind === "page"
      ? source.mutationTarget.pageId
      : source.scope.pageId;
  if (pageId && !opened.document.pagesById[pageId]) {
    throw new Error("Agent continuation target Page no longer exists");
  }
  return {
    ...source,
    runId: decision.nextRunId,
    prompt: AGENT_CONTINUATION_PROMPT,
    revision: opened.document.revision,
    scope:
      source.mutationTarget.kind === "page"
        ? {
            kind: "page" as const,
            pageId: source.mutationTarget.pageId,
            selectedNodeIds: [],
          }
        : {
            kind: "document" as const,
            selectedNodeIds: [],
            ...(pageId ? { pageId } : {}),
          },
    continuation: decision.continuation,
  };
}
