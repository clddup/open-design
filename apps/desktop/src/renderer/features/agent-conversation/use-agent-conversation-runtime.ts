import type {
  AgentAttachment,
  AgentRequest,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import type { DesignDocument } from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { ModelSelection } from "@opendesign/model-gateway";
import type {
  ConversationDescriptor,
  GlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import type { AgentRequestErrorCode } from "@/shared/agent-request-contract";
import { reportRendererError } from "../diagnostics/diagnostics";
import {
  EMPTY_GENERATION_PLAN_PRESENTATION_STATE,
  clearGenerationPlanPresentationRun,
  generationActivityFromAcceptedPlan,
  generationActivityMessageKey,
  projectGenerationPlanPresentationEvent,
} from "@/renderer/features/canvas";
import type {
  WorkspaceRuntime,
  WorkspaceSnapshot,
} from "../../state/workspace-runtime";
import {
  EMPTY_AGENT_STATE,
  agentEventActivityAt,
  appendLiveAgentEvent,
  isDurableAgentCheckpoint,
  mergeDurableTimeline,
  pruneLiveEventsCoveredByTimeline,
  selectionScope,
  touchConversationList,
  updateConversationAgentState,
  type ConversationAgentState,
} from "./conversation-runtime-state";
import {
  projectAgentActiveRunId,
  projectAgentRunFileBinding,
} from "./continuation-binding";

const HISTORY_SYNC_DEBOUNCE_MS = 80;

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useAgentConversationRuntime({
  activeConversation,
  activePageId,
  designDocument,
  runtime,
  setConversations,
  setWorkspaceError,
  t,
  workspace,
  workspaceSnapshot,
}: {
  activeConversation: ConversationDescriptor | null;
  activePageId: string;
  designDocument: DesignDocument;
  runtime: EditorRuntime;
  setConversations: Dispatch<SetStateAction<ConversationDescriptor[]>>;
  setWorkspaceError: (error: string | null) => void;
  t: Translate;
  workspace: WorkspaceRuntime;
  workspaceSnapshot: WorkspaceSnapshot;
}) {
  const [agentByConversationId, setAgentByConversationId] = useState<
    Readonly<Record<string, ConversationAgentState>>
  >({});
  const [generationPlanPresentation, setGenerationPlanPresentation] = useState(
    EMPTY_GENERATION_PLAN_PRESENTATION_STATE,
  );
  const [globalTasks, setGlobalTasks] = useState<GlobalTaskProjection[]>([]);
  const [agentRuntimeError, setAgentRuntimeError] = useState<string | null>(
    null,
  );
  const runCounter = useRef(0);
  const conversationIdByRunId = useRef(new Map<string, string>());
  const designFileByRunId = useRef(
    new Map<
      string,
      { projectId: string; designFileId: string; documentId: string }
    >(),
  );
  const conversationIdByHistoryRequestId = useRef(new Map<string, string>());
  const latestHistoryRequestId = useRef(new Map<string, string>());
  const historySyncTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );

  const storedActiveAgentState = activeConversation
    ? (agentByConversationId[activeConversation.conversationId] ??
      EMPTY_AGENT_STATE)
    : EMPTY_AGENT_STATE;
  const authoritativeActiveRunId = activeConversation
    ? activeGlobalTaskRunId(globalTasks, activeConversation.conversationId)
    : null;
  const activeAgentState =
    !storedActiveAgentState.activeRunId && authoritativeActiveRunId
      ? {
          ...storedActiveAgentState,
          activeRunId: authoritativeActiveRunId,
        }
      : storedActiveAgentState;
  const activeCanvasAgentRunId = (() => {
    const runId = activeAgentState.activeRunId;
    if (!runId) return null;
    return designFileByRunId.current.get(runId)?.documentId ===
      designDocument.documentId
      ? runId
      : null;
  })();
  const generationActivity = useMemo(() => {
    const runId = activeCanvasAgentRunId;
    if (!runId) return undefined;
    const projected = generationActivityFromAcceptedPlan(
      generationPlanPresentation.acceptedByRunId[runId],
      generationPlanPresentation.activityByRunId[runId],
      designDocument,
      activePageId,
    );
    if (!projected) return undefined;
    const stage = t(generationActivityMessageKey(projected.phase));
    return {
      ...projected,
      label:
        projected.progress === undefined
          ? `AI · ${stage}`
          : `AI · ${stage} · ${Math.round(projected.progress * 100)}%`,
    };
  }, [
    activeCanvasAgentRunId,
    activePageId,
    designDocument,
    generationPlanPresentation.acceptedByRunId,
    generationPlanPresentation.activityByRunId,
    t,
  ]);
  const refreshGlobalTasks = useCallback(async () => {
    const tasks = await window.desktop?.listGlobalTasks();
    if (tasks) setGlobalTasks(tasks);
  }, []);

  const requestConversationHistory = useCallback(
    async (conversationId: string) => {
      if (!window.desktop) return;
      const pendingSync = historySyncTimers.current.get(conversationId);
      if (pendingSync !== undefined) {
        clearTimeout(pendingSync);
        historySyncTimers.current.delete(conversationId);
      }
      const requestId = `history_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`;
      const previousRequestId =
        latestHistoryRequestId.current.get(conversationId);
      if (previousRequestId) {
        conversationIdByHistoryRequestId.current.delete(previousRequestId);
      }
      latestHistoryRequestId.current.set(conversationId, requestId);
      conversationIdByHistoryRequestId.current.set(requestId, conversationId);
      setAgentByConversationId((current) =>
        updateConversationAgentState(current, conversationId, (previous) => ({
          ...previous,
          error: null,
        })),
      );
      try {
        await sendAgentRequest({
          type: "session.history",
          requestId,
          sessionId: conversationId,
        });
      } catch (error) {
        conversationIdByHistoryRequestId.current.delete(requestId);
        if (latestHistoryRequestId.current.get(conversationId) !== requestId)
          return;
        latestHistoryRequestId.current.delete(conversationId);
        setAgentByConversationId((current) =>
          updateConversationAgentState(current, conversationId, (previous) => ({
            ...previous,
            error: reportRendererError(
              "conversation_history_load_failed",
              error,
              t("error.loadConversationHistory"),
              { conversationId, requestId },
            ),
          })),
        );
      }
    },
    [t],
  );

  const scheduleConversationHistory = useCallback(
    (conversationId: string) => {
      const current = historySyncTimers.current.get(conversationId);
      if (current !== undefined) clearTimeout(current);
      historySyncTimers.current.set(
        conversationId,
        setTimeout(() => {
          historySyncTimers.current.delete(conversationId);
          void requestConversationHistory(conversationId);
        }, HISTORY_SYNC_DEBOUNCE_MS),
      );
    },
    [requestConversationHistory],
  );

  const forgetConversation = useCallback((conversationId: string) => {
    setAgentByConversationId((current) => {
      const remaining = { ...current };
      delete remaining[conversationId];
      return remaining;
    });
    const pendingSync = historySyncTimers.current.get(conversationId);
    if (pendingSync !== undefined) clearTimeout(pendingSync);
    historySyncTimers.current.delete(conversationId);
    const historyRequestId = latestHistoryRequestId.current.get(conversationId);
    if (historyRequestId) {
      conversationIdByHistoryRequestId.current.delete(historyRequestId);
    }
    latestHistoryRequestId.current.delete(conversationId);
    for (const [runId, mappedConversationId] of conversationIdByRunId.current) {
      if (mappedConversationId === conversationId) {
        conversationIdByRunId.current.delete(runId);
      }
    }
  }, []);

  useEffect(
    () => () => {
      historySyncTimers.current.forEach((timer) => clearTimeout(timer));
      historySyncTimers.current.clear();
    },
    [],
  );

  useEffect(() => {
    void window.desktop
      ?.listGlobalTasks()
      .then(setGlobalTasks)
      .catch((error: unknown) => {
        setWorkspaceError(
          reportRendererError(
            "global_tasks_load_failed",
            error,
            t("error.loadGlobalTasks"),
          ),
        );
      });
  }, [setWorkspaceError, t]);

  useEffect(() => {
    return window.desktop?.onAgentEvent((event) => {
      if (event.type === "agent.ready" || event.type === "agent.connected") {
        setAgentRuntimeError(null);
        return;
      }
      if (event.type === "session.history") {
        if (
          latestHistoryRequestId.current.get(event.sessionId) !==
          event.requestId
        ) {
          conversationIdByHistoryRequestId.current.delete(event.requestId);
          return;
        }
        latestHistoryRequestId.current.delete(event.sessionId);
        conversationIdByHistoryRequestId.current.delete(event.requestId);
        setAgentByConversationId((current) =>
          updateConversationAgentState(current, event.sessionId, (previous) => {
            const activeRunId = previous.activeRunId;
            const timeline = mergeDurableTimeline(
              previous.timeline,
              event.timeline,
            );
            return {
              ...previous,
              timeline,
              events: pruneLiveEventsCoveredByTimeline(
                previous.events,
                timeline,
                activeRunId,
              ),
              error: null,
            };
          }),
        );
        return;
      }

      setGenerationPlanPresentation((current) =>
        projectGenerationPlanPresentationEvent(current, event),
      );
      if (event.type === "agent.error") {
        void refreshGlobalTasks().catch(() => undefined);
      }

      const runId = projectAgentRunFileBinding(
        event,
        conversationIdByRunId.current,
        designFileByRunId.current,
        workspace,
      );
      const conversationId = runId
        ? conversationIdByRunId.current.get(runId)
        : event.type === "agent.error" && event.requestId
          ? conversationIdByHistoryRequestId.current.get(event.requestId)
          : undefined;
      if (!conversationId) {
        if (event.type === "agent.error") {
          setAgentRuntimeError(event.message);
          if (event.runId === undefined && event.requestId === undefined) {
            setAgentByConversationId((current) =>
              Object.fromEntries(
                Object.entries(current).map(([id, state]) => [
                  id,
                  state.activeRunId
                    ? { ...state, activeRunId: null, error: event.message }
                    : state,
                ]),
              ),
            );
          }
        }
        return;
      }

      const activityAt = agentEventActivityAt(event);
      if (activityAt) {
        setConversations((current) =>
          touchConversationList(current, conversationId, activityAt),
        );
      }

      if (
        event.type === "run.started" ||
        event.type === "run.completed" ||
        event.type === "run.continuation" ||
        event.type === "approval.requested" ||
        event.type === "approval.resolved" ||
        event.type === "tool.failed"
      ) {
        void refreshGlobalTasks().catch(() => undefined);
      }

      setAgentByConversationId((current) =>
        updateConversationAgentState(current, conversationId, (previous) => ({
          ...previous,
          events: appendLiveAgentEvent(previous.events, event),
          activeRunId: projectAgentActiveRunId(
            previous.activeRunId,
            event,
            runId,
          ),
          error:
            event.type === "agent.error"
              ? event.message
              : event.type === "run.started" ||
                  (event.type === "run.continuation" &&
                    event.status === "scheduled")
                ? null
                : previous.error,
        })),
      );
      if (isDurableAgentCheckpoint(event)) {
        scheduleConversationHistory(conversationId);
      }
      if (event.type === "run.completed" || event.type === "agent.error") {
        if (event.type === "run.completed") {
          void requestConversationHistory(conversationId);
          conversationIdByRunId.current.delete(event.runId);
        }
        if (event.type === "agent.error" && event.requestId) {
          conversationIdByHistoryRequestId.current.delete(event.requestId);
        }
      }
    });
  }, [
    refreshGlobalTasks,
    requestConversationHistory,
    scheduleConversationHistory,
    setConversations,
    workspace,
  ]);

  const submitAgentTask = useCallback(
    async (
      prompt: string,
      modelSelection: ModelSelection,
      attachments: readonly AgentAttachment[],
      conversationOverride?: ConversationDescriptor,
    ) => {
      const targetConversation = conversationOverride ?? activeConversation;
      const targetAgentState = targetConversation
        ? (agentByConversationId[targetConversation.conversationId] ??
          EMPTY_AGENT_STATE)
        : EMPTY_AGENT_STATE;
      if (
        !window.desktop ||
        !targetConversation ||
        targetAgentState.activeRunId ||
        activeGlobalTaskRunId(globalTasks, targetConversation.conversationId)
      ) {
        return false;
      }
      const current = runtime.getSnapshot();
      const runId = `run_${Date.now()}_${++runCounter.current}`;
      const conversationId = targetConversation.conversationId;
      const activeFile =
        workspaceSnapshot.files[workspaceSnapshot.activeFileKey];
      if (!activeFile) return false;
      const createdAt = new Date().toISOString();
      const optimisticItemId = `message:${runId}_user`;
      const request: AgentRequest = {
        type: "run.start",
        runId,
        sessionId: conversationId,
        prompt,
        ...(attachments.length === 0
          ? {}
          : {
              attachments: attachments.map((attachment) => ({
                ...attachment,
              })),
            }),
        documentId: current.document.documentId,
        revision: current.document.revision,
        scope: selectionScope(current, activePageId),
        mutationTarget: { kind: "page", pageId: activePageId },
        modelSelection,
        generationMode: "fast",
      };
      conversationIdByRunId.current.set(runId, conversationId);
      workspace.retainFileForRun(
        activeFile.projectId,
        activeFile.designFileId,
        runId,
      );
      designFileByRunId.current.set(runId, {
        projectId: activeFile.projectId,
        designFileId: activeFile.designFileId,
        documentId: current.document.documentId,
      });
      setAgentByConversationId((currentState) =>
        updateConversationAgentState(
          currentState,
          conversationId,
          (previous) => {
            const maximumSequence = previous.timeline.reduce(
              (maximum, item) => Math.max(maximum, item.sequence),
              0,
            );
            const optimisticMessage: SessionTimelineItem = {
              itemId: optimisticItemId,
              sessionId: conversationId,
              runId,
              sequence: maximumSequence + 1,
              createdAt,
              updatedAt: createdAt,
              type: "user.message",
              messageId: `${runId}_user`,
              content: prompt,
              ...(attachments.length === 0
                ? {}
                : {
                    attachments: attachments.map((attachment) => ({
                      ...attachment,
                    })),
                  }),
              documentId: current.document.documentId,
              revision: current.document.revision,
              scope: request.scope,
              mutationTarget: request.mutationTarget,
            };
            return {
              ...previous,
              timeline: [
                ...previous.timeline.filter(
                  (item) => item.itemId !== optimisticMessage.itemId,
                ),
                optimisticMessage,
              ],
              activeRunId: runId,
              error: null,
            };
          },
        ),
      );
      try {
        await sendAgentRequest(request);
        setConversations((current) =>
          touchConversationList(current, conversationId, createdAt),
        );
        void refreshGlobalTasks();
        return true;
      } catch (error) {
        const reportedError = localizeAgentRequestError(error, t);
        conversationIdByRunId.current.delete(runId);
        workspace.releaseFileForRun(
          activeFile.projectId,
          activeFile.designFileId,
          runId,
        );
        designFileByRunId.current.delete(runId);
        setAgentByConversationId((currentState) =>
          updateConversationAgentState(
            currentState,
            conversationId,
            (previous) => ({
              ...previous,
              timeline: previous.timeline.filter(
                (item) => item.itemId !== optimisticItemId,
              ),
              activeRunId:
                previous.activeRunId === runId ? null : previous.activeRunId,
              error: reportRendererError(
                "agent_request_failed",
                reportedError,
                t("error.agentRuntime"),
                { conversationId, runId },
              ),
            }),
          ),
        );
        return false;
      }
    },
    [
      activeConversation,
      activePageId,
      agentByConversationId,
      globalTasks,
      refreshGlobalTasks,
      runtime,
      setConversations,
      t,
      workspace,
      workspaceSnapshot.activeFileKey,
      workspaceSnapshot.files,
    ],
  );

  const stopAgentTask = useCallback(async () => {
    const runId = activeAgentState.activeRunId;
    if (!runId || !activeConversation || !window.desktop) return false;
    const conversationId = activeConversation.conversationId;
    try {
      await sendAgentRequest({ type: "run.cancel", runId });
      setGenerationPlanPresentation((current) =>
        clearGenerationPlanPresentationRun(current, runId),
      );
      return true;
    } catch (error) {
      setAgentByConversationId((current) =>
        updateConversationAgentState(current, conversationId, (previous) => ({
          ...previous,
          error: reportRendererError(
            "agent_cancel_failed",
            error,
            t("error.stopAgent"),
            { conversationId, runId },
          ),
        })),
      );
      return false;
    }
  }, [activeAgentState.activeRunId, activeConversation, t]);

  const resolveAgentApproval = useCallback(
    async (resolution: {
      runId: string;
      toolCallId: string;
      approvalId: string;
      decision: "allow_once" | "deny";
    }) => {
      if (!window.desktop) return false;
      const conversationId = conversationIdByRunId.current.get(
        resolution.runId,
      );
      if (!conversationId) return false;
      try {
        await sendAgentRequest({
          type: "approval.resolve",
          ...resolution,
        });
        return true;
      } catch (error) {
        setAgentByConversationId((current) =>
          updateConversationAgentState(current, conversationId, (previous) => ({
            ...previous,
            error: reportRendererError(
              "agent_approval_failed",
              error,
              t("error.resolveAgentApproval"),
              {
                conversationId,
                runId: resolution.runId,
                toolCallId: resolution.toolCallId,
              },
            ),
          })),
        );
        return false;
      }
    },
    [t],
  );

  return {
    activeAgentState,
    activeCanvasAgentRunId,
    agentRuntimeError,
    conversationDeleteBlockedIds: globalTasks
      .filter((task) =>
        ["queued", "running", "waiting_approval"].includes(task.lifecycle),
      )
      .map((task) => task.conversationId),
    forgetConversation,
    generationActivity,
    globalTasks,
    refreshGlobalTasks,
    requestConversationHistory,
    resolveAgentApproval,
    stopAgentTask,
    submitAgentTask,
  };
}

function activeGlobalTaskRunId(
  tasks: readonly GlobalTaskProjection[],
  conversationId: string,
): string | null {
  return (
    tasks.find(
      (task) =>
        task.conversationId === conversationId &&
        ["queued", "running", "waiting_approval"].includes(task.lifecycle),
    )?.runId ?? null
  );
}

class AgentRequestRejectedError extends Error {
  constructor(
    readonly code: AgentRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentRequestRejectedError";
  }
}

async function sendAgentRequest(request: AgentRequest): Promise<void> {
  const desktop = window.desktop;
  if (!desktop) throw new Error("Agent request bridge is unavailable");
  const result = await desktop.sendAgentRequest(request);
  if (!result.ok) {
    throw new AgentRequestRejectedError(
      result.error.code,
      result.error.message,
    );
  }
}

function localizeAgentRequestError(error: unknown, t: Translate): unknown {
  if (!(error instanceof AgentRequestRejectedError)) return error;
  if (error.code === "conversation_busy") {
    return new Error(t("agent.conversationBusy"));
  }
  if (error.code === "preflight_stale") {
    return new Error(t("agent.preflightStale"));
  }
  return error;
}
