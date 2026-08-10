import type {
  AgentEvent,
  AgentRequest,
  DesignMutationTarget,
  SelectionScope,
} from "@opendesign/agent-contracts";
import type { TrustedToolContext } from "@opendesign/agent-runtime";
import type { DesignDocument } from "@opendesign/design-contracts";
import {
  WORKSPACE_CONTRACT_VERSION,
  type GlobalTaskLifecycle,
  type GlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import type { ProjectHost } from "../project/project-host.js";
import type { WorkspaceStore } from "../project/workspace-store.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;
type RunScopedEvent = AgentEvent & { runId: string };

const activeLifecycles = new Set<GlobalTaskLifecycle>([
  "queued",
  "running",
  "waiting_approval",
]);

export class GlobalTaskCoordinator {
  readonly #tasksByRunId = new Map<string, GlobalTaskProjection>();
  readonly #toolBindingsByRunId = new Map<
    string,
    {
      conversationId: string;
      documentId: string;
      revision: number;
      scope: SelectionScope;
      mutationTarget: DesignMutationTarget;
    }
  >();

  constructor(
    private readonly projectHost: ProjectHost,
    private readonly workspaceStore: WorkspaceStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  reconcileInterruptedTasks(): void {
    const timestamp = this.now().toISOString();
    for (const task of this.workspaceStore.listGlobalTasks()) {
      if (!activeLifecycles.has(task.lifecycle)) continue;
      this.workspaceStore.saveGlobalTask({
        ...task,
        lifecycle: "interrupted",
        updatedAt: timestamp,
      });
      this.#touchConversation(task.conversationId, timestamp);
    }
  }

  async registerRun(request: RunStartRequest): Promise<GlobalTaskProjection> {
    if (
      this.#tasksByRunId.has(request.runId) ||
      this.workspaceStore
        .listGlobalTasks()
        .some((task) => task.runId === request.runId)
    ) {
      throw new Error("Agent run ID is already registered");
    }
    const conversation = this.workspaceStore.getConversation(request.sessionId);
    if (!conversation || conversation.lifecycle !== "active") {
      throw new Error("Agent run requires an active Conversation");
    }
    const matches = this.projectHost
      .listOpenProjects()
      .flatMap((project) =>
        project.designFiles
          .filter((file) => file.documentId === request.documentId)
          .map((file) => ({ project, file })),
      );
    if (matches.length !== 1) {
      throw new Error(
        "Agent run document identity is unavailable or ambiguous",
      );
    }
    const match = matches[0];
    if (!match) throw new Error("Agent run document identity is unavailable");
    if (match.project.projectId !== conversation.homeProjectId) {
      throw new Error("Cross-project Agent targets require an explicit grant");
    }
    const opened = await this.projectHost.readDesignFile(
      match.project.projectId,
      match.file.designFileId,
    );
    if (request.revision < opened.document.revision) {
      throw new Error("Agent run revision is stale");
    }
    const pageId =
      request.mutationTarget.kind === "page"
        ? request.mutationTarget.pageId
        : (request.scope.pageId ?? opened.document.pageOrder[0]);
    if (!pageId || !opened.document.pagesById[pageId]) {
      throw new Error("Agent run requires a valid target page");
    }
    if (
      request.revision === opened.document.revision &&
      request.scope.selectedNodeIds.some(
        (nodeId) => !nodeBelongsToPage(opened.document, pageId, nodeId),
      )
    ) {
      throw new Error("Agent run selection is outside the target page");
    }
    const timestamp = this.now().toISOString();
    const primaryTarget = {
      targetId: `target_${request.runId}`,
      projectId: match.project.projectId,
      designFileId: match.file.designFileId,
      documentId: match.file.documentId,
      pageId,
      selectedNodeIds: [...request.scope.selectedNodeIds],
      ...(request.scope.primaryNodeId
        ? { primaryNodeId: request.scope.primaryNodeId }
        : {}),
      baseRevision: request.revision,
    };
    const task: GlobalTaskProjection = {
      version: WORKSPACE_CONTRACT_VERSION,
      taskId: `task_${request.runId}`,
      conversationId: conversation.conversationId,
      homeProjectId: conversation.homeProjectId,
      runId: request.runId,
      title: conversation.title,
      lifecycle: "queued",
      targetSet: { targets: [primaryTarget], primaryTarget },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.workspaceStore.saveConversation({
      ...conversation,
      updatedAt: timestamp,
    });
    this.workspaceStore.saveGlobalTask(task);
    this.#tasksByRunId.set(request.runId, task);
    this.#toolBindingsByRunId.set(request.runId, {
      conversationId: request.sessionId,
      documentId: request.documentId,
      revision: request.revision,
      scope: structuredClone(request.scope),
      mutationTarget: structuredClone(request.mutationTarget),
    });
    return task;
  }

  assertDesignToolContext(context: TrustedToolContext): void {
    const binding = this.#toolBindingsByRunId.get(context.runId);
    if (!binding) {
      throw new Error("Design tool requires an active registered Run");
    }
    if (
      binding.conversationId !== context.sessionId ||
      binding.documentId !== context.documentId ||
      !sameScope(binding.scope, context.scope) ||
      !sameMutationTarget(binding.mutationTarget, context.mutationTarget)
    ) {
      throw new Error("Design tool context does not match its registered Run");
    }
    if (binding.revision !== context.revision) {
      throw new Error(
        `Design tool revision conflict: expected ${binding.revision}, received ${context.revision}`,
      );
    }
  }

  handleAgentEvent(event: AgentEvent): void {
    if (event.type === "agent.error" && event.runId === undefined) {
      this.#interruptActiveTasks();
      return;
    }
    const runId = "runId" in event ? event.runId : undefined;
    if (!runId) return;
    if (event.type === "tool.completed" && event.revision !== undefined) {
      const binding = this.#toolBindingsByRunId.get(runId);
      if (binding && event.revision > binding.revision) {
        this.#toolBindingsByRunId.set(runId, {
          ...binding,
          revision: event.revision,
        });
      }
    }
    const task = this.#tasksByRunId.get(runId);
    if (!task) return;
    const activityAt = conversationActivityAt(event, this.now);
    if (activityAt) this.#touchConversation(task.conversationId, activityAt);
    const lifecycle = projectLifecycle({ ...event, runId }, task.lifecycle);
    if (lifecycle === task.lifecycle) return;
    const updated: GlobalTaskProjection = {
      ...task,
      lifecycle,
      updatedAt: this.now().toISOString(),
    };
    this.workspaceStore.saveGlobalTask(updated);
    if (activeLifecycles.has(lifecycle)) {
      this.#tasksByRunId.set(runId, updated);
    } else {
      this.#tasksByRunId.delete(runId);
    }
    if (event.type === "run.completed" || event.type === "agent.error") {
      this.#toolBindingsByRunId.delete(runId);
    }
  }

  #interruptActiveTasks(): void {
    const timestamp = this.now().toISOString();
    for (const [runId, task] of this.#tasksByRunId) {
      this.workspaceStore.saveGlobalTask({
        ...task,
        lifecycle: "interrupted",
        updatedAt: timestamp,
      });
      this.#tasksByRunId.delete(runId);
      this.#toolBindingsByRunId.delete(runId);
      this.#touchConversation(task.conversationId, timestamp);
    }
  }

  #touchConversation(conversationId: string, updatedAt: string): void {
    const conversation = this.workspaceStore.getConversation(conversationId);
    if (!conversation || conversation.updatedAt >= updatedAt) return;
    this.workspaceStore.saveConversation({ ...conversation, updatedAt });
  }
}

function sameMutationTarget(
  left: DesignMutationTarget,
  right: DesignMutationTarget,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== "page" ||
      (right.kind === "page" && left.pageId === right.pageId))
  );
}

function conversationActivityAt(
  event: AgentEvent,
  now: () => Date,
): string | null {
  if (event.type === "run.started") return event.startedAt;
  if (event.type === "run.completed") return event.finishedAt;
  if (
    event.type === "message.completed" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "agent.error"
  ) {
    return now().toISOString();
  }
  return null;
}

function sameScope(left: SelectionScope, right: SelectionScope): boolean {
  if (left.kind !== right.kind) return false;
  const leftPageId = "pageId" in left ? left.pageId : undefined;
  const rightPageId = "pageId" in right ? right.pageId : undefined;
  if (leftPageId !== rightPageId) return false;
  const leftPrimaryNodeId =
    "primaryNodeId" in left ? left.primaryNodeId : undefined;
  const rightPrimaryNodeId =
    "primaryNodeId" in right ? right.primaryNodeId : undefined;
  if (leftPrimaryNodeId !== rightPrimaryNodeId) return false;
  return (
    left.selectedNodeIds.length === right.selectedNodeIds.length &&
    left.selectedNodeIds.every(
      (nodeId, index) => nodeId === right.selectedNodeIds[index],
    )
  );
}

function projectLifecycle(
  event: RunScopedEvent,
  current: GlobalTaskLifecycle,
): GlobalTaskLifecycle {
  if (event.type === "run.started") return "running";
  if (event.type === "approval.requested") return "waiting_approval";
  if (event.type === "approval.resolved") return "running";
  if (event.type === "tool.failed" && isConflictCode(event.code)) {
    return "conflict";
  }
  if (event.type === "agent.error") return "failed";
  if (event.type !== "run.completed") return current;
  if (event.stopReason === "complete") return "completed";
  if (event.stopReason === "cancelled") return "cancelled";
  return "failed";
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const page = document.pagesById[pageId];
  if (!page) return false;
  const pending = [...page.rootNodeIds];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === nodeId) return true;
    visited.add(current);
    const node = document.nodesById[current];
    if (node) pending.push(...node.childIds);
  }
  return false;
}

function isConflictCode(code: string): boolean {
  return ["conflict", "revision", "stale"].some((part) =>
    code.toLowerCase().includes(part),
  );
}
