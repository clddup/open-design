import { act, renderHook, waitFor } from "@testing-library/react";
import type {
  AgentEvent,
  AgentRequest,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import {
  WORKSPACE_CONTRACT_VERSION,
  type ConversationDescriptor,
  type GlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@/shared/desktop-api";
import { WorkspaceRuntime } from "../../state/workspace-runtime";
import { useAgentConversationRuntime } from "./use-agent-conversation-runtime";

const now = "2026-09-04T00:00:00.000Z";
const conversation: ConversationDescriptor = {
  conversationId: "conversation_running",
  originProjectId: "project_acme",
  filedProjectId: "project_acme",
  title: "Running design",
  lifecycle: "active",
  createdAt: now,
  updatedAt: now,
};

afterEach(() => {
  delete window.desktop;
});

describe("useAgentConversationRuntime remount recovery", () => {
  it("restores Run ownership from Global Tasks after remount and synchronizes terminal events", async () => {
    const listeners = new Set<(event: AgentEvent) => void>();
    const task = runningTask();
    const tasks = [task];
    window.desktop = desktopApi({ listeners, tasks });

    const first = renderRuntimeHook();
    await waitFor(() =>
      expect(first.result.current.globalTasks).toEqual([task]),
    );
    first.unmount();

    const remounted = renderRuntimeHook();
    await waitFor(() =>
      expect(remounted.result.current.activeAgentState.activeRunId).toBe(
        task.runId,
      ),
    );
    const taskRefreshesBeforeCompletion = vi.mocked(
      window.desktop.listGlobalTasks,
    ).mock.calls.length;

    act(() => {
      emit(listeners, {
        type: "message.delta",
        runId: task.runId!,
        messageId: "assistant_1",
        blockId: "text_1",
        blockType: "text",
        blockIndex: 0,
        delta: "仍在生成",
      });
    });

    expect(remounted.result.current.activeAgentState.events).toContainEqual(
      expect.objectContaining({
        type: "message.delta",
        runId: task.runId,
        delta: "仍在生成",
      }),
    );

    tasks.length = 0;
    act(() => {
      emit(listeners, {
        type: "run.completed",
        runId: task.runId!,
        finishedAt: now,
        stopReason: "complete",
      });
    });

    await waitFor(() => {
      expect(historyRequests()).toHaveLength(1);
      expect(window.desktop!.listGlobalTasks).toHaveBeenCalledTimes(
        taskRefreshesBeforeCompletion + 1,
      );
    });
    expect(historyRequests()[0]?.sessionId).toBe(conversation.conversationId);
    await waitFor(() =>
      expect(remounted.result.current.activeAgentState.activeRunId).toBeNull(),
    );
  });

  it("restores Run ownership from requested session history without guessing the selected Conversation", async () => {
    const listeners = new Set<(event: AgentEvent) => void>();
    window.desktop = desktopApi({ listeners, tasks: [] });
    const selectedConversation = {
      ...conversation,
      conversationId: "conversation_selected",
      title: "Unrelated selected Conversation",
    };
    const hook = renderRuntimeHook(selectedConversation);

    await act(() =>
      hook.result.current.requestConversationHistory(
        conversation.conversationId,
      ),
    );
    const request = historyRequests()[0];
    if (!request) throw new Error("Expected a session history request");

    act(() => {
      emit(listeners, {
        type: "session.history",
        requestId: request.requestId,
        sessionId: conversation.conversationId,
        timeline: [startedRunTimelineItem()],
      });
      emit(listeners, {
        type: "message.delta",
        runId: "run_from_history",
        messageId: "assistant_history",
        blockId: "text_history",
        blockType: "text",
        blockIndex: 0,
        delta: "历史 Run 的实时消息",
      });
    });

    expect(hook.result.current.activeAgentState.events).toEqual([]);
    hook.rerender({ activeConversation: conversation });
    expect(hook.result.current.activeAgentState.events).toContainEqual(
      expect.objectContaining({
        runId: "run_from_history",
        delta: "历史 Run 的实时消息",
      }),
    );
  });
});

function renderRuntimeHook(
  initialActiveConversation: ConversationDescriptor = conversation,
) {
  const document = createWelcomeDocument();
  const workspace = new WorkspaceRuntime({
    projectId: "project_acme",
    designFileId: "design_mobile",
    name: "Mobile",
    document,
  });
  const setConversations = vi.fn();
  const setWorkspaceError = vi.fn();
  return renderHook(
    ({ activeConversation }: { activeConversation: ConversationDescriptor }) =>
      useAgentConversationRuntime({
        activeConversation,
        activePageId: "page_welcome",
        designDocument: document,
        runtime: workspace.getActiveRuntime(),
        setConversations,
        setWorkspaceError,
        t: translate,
        workspace,
        workspaceSnapshot: workspace.getSnapshot(),
      }),
    { initialProps: { activeConversation: initialActiveConversation } },
  );
}

function translate(key: string): string {
  return key;
}

function desktopApi({
  listeners,
  tasks,
}: {
  listeners: Set<(event: AgentEvent) => void>;
  tasks: GlobalTaskProjection[];
}): DesktopApi {
  return {
    listGlobalTasks: vi.fn(() => Promise.resolve([...tasks])),
    sendAgentRequest: vi.fn().mockResolvedValue({ ok: true }),
    onAgentEvent: vi.fn((listener: (event: AgentEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as unknown as DesktopApi;
}

function runningTask(): GlobalTaskProjection {
  const primaryTarget = {
    targetId: "target_running",
    projectId: "project_acme",
    designFileId: "design_mobile",
    documentId: "document_welcome",
    pageId: "page_welcome",
    selectedNodeIds: [],
    baseRevision: 0,
  };
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    taskId: "task_running",
    conversationId: conversation.conversationId,
    runId: "run_running",
    title: conversation.title,
    lifecycle: "running",
    targetSet: { targets: [primaryTarget], primaryTarget },
    createdAt: now,
    updatedAt: now,
  };
}

function startedRunTimelineItem(): SessionTimelineItem {
  return {
    itemId: "run:run_from_history",
    sessionId: conversation.conversationId,
    runId: "run_from_history",
    sequence: 1,
    createdAt: now,
    updatedAt: now,
    type: "run",
    status: "started",
    startedAt: now,
  };
}

function emit(
  listeners: ReadonlySet<(event: AgentEvent) => void>,
  event: AgentEvent,
): void {
  listeners.forEach((listener) => listener(event));
}

function historyRequests() {
  return vi
    .mocked(window.desktop!.sendAgentRequest)
    .mock.calls.flatMap(
      ([request]): Array<Extract<AgentRequest, { type: "session.history" }>> =>
        request.type === "session.history" ? [request] : [],
    );
}
