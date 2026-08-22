import type {
  ConversationDescriptor,
  GlobalTaskProjection,
  ProjectManifest,
} from "@opendesign/workspace-contracts";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type {
  MessageKey,
  MessageParameters,
} from "../../../shared/i18n/messages";
import { reportRendererError } from "../../diagnostics";
import type { ConversationOpenIssue } from "./use-conversation-lifecycle-state";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useConversationNavigationController({
  activeConversationId,
  activeProject,
  conversations,
  forgetConversation,
  openProjectTarget,
  refreshRecentProjects,
  requestConversationHistory,
  selectConversation,
  setConversationDeletionBusy,
  setConversationDeletionError,
  setConversationOpenIssue,
  setConversations,
  setPendingConversationDeletionId,
  setWorkspaceBusy,
  setWorkspaceError,
  showView,
  t,
  view,
}: {
  activeConversationId: string | null;
  activeProject: ProjectManifest | null;
  conversations: ConversationDescriptor[];
  forgetConversation: (conversationId: string) => void;
  openProjectTarget: (target: {
    projectId: string;
    designFileId: string;
    pageId?: string;
  }) => Promise<void>;
  refreshRecentProjects: () => Promise<void>;
  requestConversationHistory: (conversationId: string) => Promise<void>;
  selectConversation: (conversationId: string | null) => void;
  setConversationDeletionBusy: (busy: boolean) => void;
  setConversationDeletionError: (error: string | null) => void;
  setConversationOpenIssue: (issue: ConversationOpenIssue | null) => void;
  setConversations: Dispatch<SetStateAction<ConversationDescriptor[]>>;
  setPendingConversationDeletionId: (conversationId: string | null) => void;
  setWorkspaceBusy: (busy: boolean) => void;
  setWorkspaceError: (error: string | null) => void;
  showView: (view: "workspace" | "conversation" | "editor") => void;
  t: Translate;
  view: "workspace" | "project" | "conversation" | "editor" | "settings";
}) {
  const createConversation = useCallback(
    async (title: string) => {
      if (!window.desktop || !activeProject) return false;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const conversation = await window.desktop.createConversation({
          conversationId: createConversationId(),
          filedProjectId: activeProject.projectId,
          title: title.trim(),
        });
        setConversations((current) => [
          conversation,
          ...current.filter(
            (candidate) =>
              candidate.conversationId !== conversation.conversationId,
          ),
        ]);
        selectConversation(conversation.conversationId);
        void requestConversationHistory(conversation.conversationId);
        return true;
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "conversation_create_failed",
            error,
            t("error.createConversation"),
            { projectId: activeProject.projectId },
          ),
        );
        return false;
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [
      activeProject,
      requestConversationHistory,
      selectConversation,
      setConversations,
      setWorkspaceBusy,
      setWorkspaceError,
      t,
    ],
  );

  const openConversation = useCallback(
    async (conversation: ConversationDescriptor) => {
      if (!window.desktop || conversation.lifecycle !== "active") return;
      selectConversation(conversation.conversationId);
      void requestConversationHistory(conversation.conversationId);
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const context = await window.desktop.resolveConversationOpenContext({
          conversationId: conversation.conversationId,
        });
        if (context.kind === "target-unavailable") {
          setConversationOpenIssue(context.reason);
          showView("conversation");
          return;
        }
        await openProjectTarget(context.target);
        setConversationOpenIssue(null);
        showView("editor");
        await refreshRecentProjects();
      } catch (error) {
        setConversationOpenIssue("project-unavailable");
        showView("conversation");
        setWorkspaceError(
          reportRendererError(
            "conversation_open_failed",
            error,
            t("error.openConversation"),
            { conversationId: conversation.conversationId },
          ),
        );
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [
      openProjectTarget,
      refreshRecentProjects,
      requestConversationHistory,
      selectConversation,
      setConversationOpenIssue,
      setWorkspaceBusy,
      setWorkspaceError,
      showView,
      t,
    ],
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      const desktop = window.desktop;
      const target = conversations.find(
        (conversation) => conversation.conversationId === conversationId,
      );
      if (!desktop || !target) return false;
      setConversationDeletionBusy(true);
      setConversationDeletionError(null);
      try {
        await desktop.deleteConversation({ conversationId });
        const replacement = conversations.find(
          (conversation) =>
            conversation.conversationId !== conversationId &&
            conversation.lifecycle === "active",
        );
        setConversations((current) =>
          current.filter(
            (conversation) => conversation.conversationId !== conversationId,
          ),
        );
        forgetConversation(conversationId);
        if (activeConversationId === conversationId) {
          selectConversation(replacement?.conversationId ?? null);
        }
        if (
          activeConversationId === conversationId &&
          view === "conversation"
        ) {
          setConversationOpenIssue(null);
          showView("workspace");
        }
        if (replacement) {
          void requestConversationHistory(replacement.conversationId);
        }
        setPendingConversationDeletionId(null);
        return true;
      } catch (error) {
        setConversationDeletionError(
          reportRendererError(
            "conversation_delete_failed",
            error,
            t("error.deleteConversation"),
            { conversationId },
          ),
        );
        return false;
      } finally {
        setConversationDeletionBusy(false);
      }
    },
    [
      activeConversationId,
      conversations,
      forgetConversation,
      requestConversationHistory,
      selectConversation,
      setConversationDeletionBusy,
      setConversationDeletionError,
      setConversationOpenIssue,
      setConversations,
      setPendingConversationDeletionId,
      showView,
      t,
      view,
    ],
  );

  const openGlobalTask = useCallback(
    async (task: GlobalTaskProjection) => {
      if (!window.desktop) return;
      selectConversation(task.conversationId);
      void requestConversationHistory(task.conversationId);
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        await openProjectTarget(task.targetSet.primaryTarget);
        setConversationOpenIssue(null);
        showView("editor");
        await refreshRecentProjects();
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "agent_task_open_failed",
            error,
            t("error.openAgentTask"),
            {
              projectId: task.targetSet.primaryTarget.projectId,
              conversationId: task.conversationId,
              runId: task.runId,
            },
          ),
        );
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [
      openProjectTarget,
      refreshRecentProjects,
      requestConversationHistory,
      selectConversation,
      setConversationOpenIssue,
      setWorkspaceBusy,
      setWorkspaceError,
      showView,
      t,
    ],
  );

  return {
    createConversation,
    deleteConversation,
    openConversation,
    openGlobalTask,
  };
}

function createConversationId() {
  return `conversation_${crypto.randomUUID().replaceAll("-", "")}`;
}
