import type {
  ConversationDescriptor,
  ProjectManifest,
} from "@opendesign/workspace-contracts";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import { reportRendererError } from "../diagnostics/diagnostics";
import type {
  AppNavigationTransition,
  AppNavigationCoordinator,
} from "../../router/app-navigation-coordinator";
import type { AppDestination } from "../../router/app-route";
import type { ConversationOpenIssue } from "./use-conversation-lifecycle-state";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useConversationNavigationController({
  activeConversationId,
  activeProject,
  conversations,
  currentDestination,
  forgetConversation,
  navigator,
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
  t,
}: {
  activeConversationId: string | null;
  activeProject: ProjectManifest | null;
  conversations: ConversationDescriptor[];
  currentDestination: AppDestination;
  forgetConversation: (conversationId: string) => void;
  navigator: AppNavigationCoordinator;
  openProjectTarget: (
    target: {
      projectId: string;
      designFileId: string;
      pageId?: string;
    },
    transition?: AppNavigationTransition,
  ) => Promise<void>;
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
  t: Translate;
}) {
  const createConversation = useCallback(
    async (title: string) => {
      if (!window.desktop || !activeProject) return null;
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
        return conversation;
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "conversation_create_failed",
            error,
            t("error.createConversation"),
            { projectId: activeProject.projectId },
          ),
        );
        return null;
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [
      activeProject,
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
      const transition = navigator.begin({
        kind: "conversation",
        conversationId: conversation.conversationId,
      });
      selectConversation(conversation.conversationId);
      void requestConversationHistory(conversation.conversationId);
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const context = await window.desktop.resolveConversationOpenContext({
          conversationId: conversation.conversationId,
        });
        if (!navigator.isCurrent(transition)) return;
        if (context.kind === "target-unavailable") {
          setConversationOpenIssue(context.reason);
          navigator.commit(transition, {
            kind: "conversation",
            conversationId: conversation.conversationId,
          });
          return;
        }
        await openProjectTarget(context.target, transition);
        if (!navigator.isCurrent(transition)) return;
        setConversationOpenIssue(null);
        await refreshRecentProjects();
      } catch (error) {
        if (!navigator.isCurrent(transition)) return;
        setConversationOpenIssue("project-unavailable");
        navigator.commit(transition, {
          kind: "conversation",
          conversationId: conversation.conversationId,
        });
        setWorkspaceError(
          reportRendererError(
            "conversation_open_failed",
            error,
            t("error.openConversation"),
            { conversationId: conversation.conversationId },
          ),
        );
      } finally {
        if (navigator.isCurrent(transition)) setWorkspaceBusy(false);
      }
    },
    [
      openProjectTarget,
      navigator,
      refreshRecentProjects,
      requestConversationHistory,
      selectConversation,
      setConversationOpenIssue,
      setWorkspaceBusy,
      setWorkspaceError,
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
          currentDestination.kind === "conversation" &&
          currentDestination.conversationId === conversationId
        ) {
          setConversationOpenIssue(null);
          navigator.navigate({ kind: "workspace" });
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
      currentDestination,
      forgetConversation,
      requestConversationHistory,
      navigator,
      selectConversation,
      setConversationDeletionBusy,
      setConversationDeletionError,
      setConversationOpenIssue,
      setConversations,
      setPendingConversationDeletionId,
      t,
    ],
  );

  return {
    createConversation,
    deleteConversation,
    openConversation,
  };
}

function createConversationId() {
  return `conversation_${crypto.randomUUID().replaceAll("-", "")}`;
}
