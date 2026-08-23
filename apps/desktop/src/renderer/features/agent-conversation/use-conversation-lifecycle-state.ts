import type { ConversationDescriptor } from "@opendesign/workspace-contracts";
import { useCallback, useEffect, useState } from "react";
import type {
  MessageKey,
  MessageParameters,
} from "../../../shared/i18n/messages";
import { reportRendererError } from "../diagnostics/diagnostics";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export type ConversationOpenIssue =
  | "project-unavailable"
  | "design-file-unavailable"
  | "page-unavailable"
  | "no-target";

export function useConversationLifecycleState({
  setWorkspaceError,
  t,
}: {
  setWorkspaceError: (error: string | null) => void;
  t: Translate;
}) {
  const [conversations, setConversations] = useState<ConversationDescriptor[]>(
    [],
  );
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [conversationOpenIssue, setConversationOpenIssue] =
    useState<ConversationOpenIssue | null>(null);
  const [pendingConversationDeletionId, setPendingConversationDeletionId] =
    useState<string | null>(null);
  const [conversationDeletionBusy, setConversationDeletionBusy] =
    useState(false);
  const [conversationDeletionError, setConversationDeletionError] = useState<
    string | null
  >(null);

  useEffect(() => {
    let active = true;
    void window.desktop
      ?.listConversations()
      .then((loaded) => {
        if (active) setConversations(loaded);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setWorkspaceError(
          reportRendererError(
            "conversations_load_failed",
            error,
            t("error.loadConversations"),
          ),
        );
      });
    return () => {
      active = false;
    };
  }, [setWorkspaceError, t]);

  const activeConversation =
    conversations.find(
      (conversation) => conversation.conversationId === activeConversationId,
    ) ?? null;
  const pendingConversationDeletion =
    conversations.find(
      (conversation) =>
        conversation.conversationId === pendingConversationDeletionId,
    ) ?? null;

  const selectConversation = useCallback((conversationId: string | null) => {
    setActiveConversationId(conversationId);
  }, []);

  const requestDeleteConversation = useCallback((conversationId: string) => {
    setConversationDeletionError(null);
    setPendingConversationDeletionId(conversationId);
  }, []);

  const cancelDeleteConversation = useCallback(() => {
    if (conversationDeletionBusy) return;
    setConversationDeletionError(null);
    setPendingConversationDeletionId(null);
  }, [conversationDeletionBusy]);

  return {
    activeConversation,
    activeConversationId,
    cancelDeleteConversation,
    conversationDeletionBusy,
    conversationDeletionError,
    conversationOpenIssue,
    conversations,
    pendingConversationDeletion,
    pendingConversationDeletionId,
    requestDeleteConversation,
    selectConversation,
    setConversationDeletionBusy,
    setConversationDeletionError,
    setConversationOpenIssue,
    setConversations,
    setPendingConversationDeletionId,
  };
}
