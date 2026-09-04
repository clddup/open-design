import type { AgentEvent } from "@opendesign/agent-contracts";
import { terminalAgentRunId } from "@/shared/agent-run-lifecycle";
import type { WorkspaceRuntime } from "../../state/workspace-runtime";

export type AgentRunFileTarget = {
  projectId: string;
  designFileId: string;
  documentId: string;
};

export function projectAgentActiveRunId(
  previous: string | null,
  event: AgentEvent,
  eventRunId: string | undefined,
): string | null {
  if (terminalAgentRunId(event) !== undefined)
    return previous === eventRunId ? null : previous;
  if (event.type === "run.started") return event.runId;
  if (event.type !== "run.continuation" || !event.nextRunId) return previous;
  if (event.status === "scheduled") return event.nextRunId;
  return previous === event.nextRunId ? null : previous;
}

export function projectAgentRunFileBinding(
  event: AgentEvent,
  conversationIdByRunId: Map<string, string>,
  designFileByRunId: Map<string, AgentRunFileTarget>,
  workspace: Pick<WorkspaceRuntime, "releaseFileForRun" | "retainFileForRun">,
): string | undefined {
  const runId = "runId" in event ? event.runId : undefined;
  if (runId && terminalAgentRunId(event) === runId) {
    const target = designFileByRunId.get(runId);
    if (target) {
      workspace.releaseFileForRun(target.projectId, target.designFileId, runId);
      designFileByRunId.delete(runId);
    }
  }
  if (
    event.type === "run.continuation" &&
    event.status === "needs_attention" &&
    event.nextRunId
  ) {
    const target = designFileByRunId.get(event.nextRunId);
    if (target) {
      workspace.releaseFileForRun(
        target.projectId,
        target.designFileId,
        event.nextRunId,
      );
      designFileByRunId.delete(event.nextRunId);
    }
    conversationIdByRunId.delete(event.nextRunId);
  }
  if (
    event.type === "run.continuation" &&
    event.status === "scheduled" &&
    event.nextRunId
  ) {
    const conversationId = conversationIdByRunId.get(event.runId);
    if (conversationId) {
      conversationIdByRunId.set(event.nextRunId, conversationId);
    }
    const target = designFileByRunId.get(event.runId);
    if (target) {
      workspace.retainFileForRun(
        target.projectId,
        target.designFileId,
        event.nextRunId,
      );
      designFileByRunId.set(event.nextRunId, { ...target });
    }
  }
  return runId;
}
