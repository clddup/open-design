import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ThemePreference } from "@/shared/desktop-api";
import { ConversationDeleteDialog } from "../agent-conversation/components/ConversationDeleteDialog";
import { DiagnosticNotifications } from "../diagnostics/components/DiagnosticNotifications";
import {
  useEditorRuntime,
  useEditorSnapshot,
} from "../../state/editor-runtime";
import { useI18n } from "../../i18n";
import { useAgentConversationRuntime } from "../agent-conversation/use-agent-conversation-runtime";
import { useConversationLifecycleState } from "../agent-conversation/use-conversation-lifecycle-state";
import { useConversationNavigationController } from "../agent-conversation/use-conversation-navigation-controller";
import { useProjectNavigationController } from "../project/use-project-navigation-controller";
import { useProjectWorkspaceState } from "../project/use-project-workspace-state";
import { useDiagnosticNotificationsController } from "../diagnostics/use-diagnostic-notifications-controller";
import { useRendererDesignToolHost } from "../design-tools/use-renderer-design-tool-host";
import { useFontBinaryRuntime } from "../editor-workbench/hooks/use-font-binary-runtime";
import { AppNavigationCoordinator } from "../../router/app-navigation-coordinator";
import { appDestination, appRoute } from "../../router/app-route";
import type { AppRouteContext } from "../../router/route-context";

function resolveTheme(preference: ThemePreference) {
  if (preference !== "system") return preference;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useAppRouteContext() {
  const { t } = useI18n();
  const {
    activePageId,
    activateFile,
    activatePage,
    openFile,
    runtime,
    replaceDocument,
    workspace,
    workspaceSnapshot,
  } = useEditorRuntime();
  const snapshot = useEditorSnapshot();
  const location = useLocation();
  const routeNavigate = useNavigate();
  const routeNavigateRef = useRef(routeNavigate);
  routeNavigateRef.current = routeNavigate;
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const platform = window.desktop?.platform ?? "darwin";
  const [navigator] = useState(
    () =>
      new AppNavigationCoordinator({
        back: () => {
          void routeNavigateRef.current(-1);
        },
        navigate: (destination) => {
          const target = appRoute(destination);
          void routeNavigateRef.current(target.to, { state: target.state });
        },
      }),
  );
  const destination = appDestination(location.pathname, location.state);
  const [editorError, setEditorError] = useState<string | null>(null);
  const {
    applySavedProjectFile,
    projectAutosave,
    projectsById,
    recentProjects,
    setProjectsById,
    setRecentProjects,
    setWorkspaceBusy,
    setWorkspaceError,
    workspaceBusy,
    workspaceError,
  } = useProjectWorkspaceState({ setEditorError, t, workspace });
  const activeWorkspaceFile =
    workspaceSnapshot.files[workspaceSnapshot.activeFileKey];
  const fileName = activeWorkspaceFile?.name ?? t("file.untitled");
  const workspaceProject =
    projectsById[workspaceSnapshot.activeProjectId] ?? null;
  const conversationLifecycle = useConversationLifecycleState({
    setWorkspaceError,
    t,
  });
  const {
    activeConversation,
    activeConversationId,
    cancelDeleteConversation,
    conversationDeletionBusy,
    conversationDeletionError,
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
  } = conversationLifecycle;
  const { dismiss: dismissDiagnostic, events: diagnosticEvents } =
    useDiagnosticNotificationsController();
  const { document: designDocument } = snapshot;
  const fontBinaryRuntime = useFontBinaryRuntime(designDocument);
  useRendererDesignToolHost(
    workspace,
    projectAutosave,
    fontBinaryRuntime.provider,
    fontBinaryRuntime.ensureDocumentFonts,
  );
  const destinationProject =
    destination.kind === "project"
      ? (projectsById[destination.projectId] ?? null)
      : null;
  const destinationConversation =
    destination.kind === "conversation"
      ? (conversations.find(
          (conversation) =>
            conversation.conversationId === destination.conversationId,
        ) ?? null)
      : null;
  const activeProject = destinationProject ?? workspaceProject;
  const conversationProject = activeProject;
  const projectConversations = conversationProject
    ? conversations.filter(
        (conversation) =>
          conversation.filedProjectId === conversationProject.projectId &&
          conversation.lifecycle === "active",
      )
    : [];
  const agentRuntime = useAgentConversationRuntime({
    activeConversation,
    activePageId,
    designDocument,
    runtime,
    setConversations,
    setWorkspaceError,
    t,
    workspace,
    workspaceSnapshot,
  });
  const {
    activeAgentState,
    agentRuntimeError,
    conversationDeleteBlockedIds,
    forgetConversation,
    globalTasks,
    requestConversationHistory,
    resolveAgentApproval,
    stopAgentTask,
    submitAgentTask,
  } = agentRuntime;

  useEffect(() => {
    void window.desktop?.getTheme().then(setTheme);
  }, []);

  useEffect(() => {
    return window.desktop?.onNativeThemeChange((isDark) => {
      if (theme === "system") {
        document.documentElement.dataset.theme = isDark ? "dark" : "light";
      }
    });
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(theme);
  }, [theme]);

  const changeTheme = (value: ThemePreference) => {
    setTheme(value);
    void window.desktop?.setTheme(value);
  };

  const openSettings = useCallback(() => {
    navigator.openSettings();
  }, [navigator]);

  useEffect(() => window.desktop?.onOpenSettings(openSettings), [openSettings]);

  const projectNavigation = useProjectNavigationController({
    activateFile,
    activatePage,
    applySavedProjectFile,
    conversations,
    openFile,
    navigator,
    projectAutosave,
    projectContextId:
      destination.kind === "project"
        ? destination.projectId
        : workspaceSnapshot.activeProjectId,
    projectsById,
    replaceDocument,
    requestConversationHistory,
    runtime,
    selectConversation,
    setEditorError,
    setProjectsById,
    setRecentProjects,
    setWorkspaceBusy,
    setWorkspaceError,
    t,
    workspace,
    workspaceSnapshot,
  });
  const {
    createProject,
    openDocument,
    openProject,
    openProjectDesignFile,
    openProjectTarget,
    openRecentProject,
    refreshRecentProjects,
    removeRecentProject,
    revealRecentProject,
  } = projectNavigation;

  const conversationNavigation = useConversationNavigationController({
    activeConversationId,
    activeProject,
    conversations,
    currentDestination: destination,
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
  });
  const { deleteConversation, openConversation } = conversationNavigation;

  const notifications = (
    <DiagnosticNotifications
      events={diagnosticEvents}
      onDismiss={dismissDiagnostic}
      placement={destination.kind === "editor" ? "editor" : "window"}
    />
  );
  const conversationDeleteDialog = (
    <ConversationDeleteDialog
      busy={conversationDeletionBusy}
      conversation={pendingConversationDeletion}
      error={conversationDeletionError}
      onCancel={cancelDeleteConversation}
      onConfirm={() => {
        if (pendingConversationDeletionId) {
          void deleteConversation(pendingConversationDeletionId);
        }
      }}
    />
  );
  const missingNavigationResource =
    destination.kind === "project" && !destinationProject
      ? t("error.openProject")
      : destination.kind === "conversation" && !destinationConversation
        ? t("error.openConversation")
        : null;

  const routeContext: AppRouteContext = {
    destination,
    invalidError:
      destination.kind === "invalid"
        ? destination.reason
        : (missingNavigationResource ?? workspaceError),
    workspace: {
      busy: workspaceBusy,
      conversations,
      error: workspaceError,
      globalTasks,
      onCreateProject: createProject,
      onRequestDeleteConversation: requestDeleteConversation,
      onOpenDesignFile: () => void openDocument(),
      onOpenConversation: (conversation) => void openConversation(conversation),
      onOpenProject: () => void openProject(),
      onOpenRecentProject: (projectId) => void openRecentProject(projectId),
      onRemoveRecentProject: removeRecentProject,
      onRevealRecentProject: revealRecentProject,
      onSettings: openSettings,
      onThemeChange: changeTheme,
      platform,
      recentProjects,
      theme,
    },
    project: destinationProject
      ? {
          activeConversationId,
          busy: workspaceBusy,
          conversationDeleteBlockedIds,
          conversations: projectConversations,
          error: workspaceError,
          manifest: destinationProject,
          onBack: () => navigator.navigate({ kind: "workspace" }),
          onRequestDeleteConversation: requestDeleteConversation,
          onOpenDesignFile: (designFileId) =>
            void openProjectDesignFile(designFileId),
          onOpenConversation: (conversationId) => {
            const conversation = conversations.find(
              (candidate) => candidate.conversationId === conversationId,
            );
            if (conversation) void openConversation(conversation);
          },
          onSettings: openSettings,
          onThemeChange: changeTheme,
          platform,
          theme,
        }
      : null,
    conversation: destinationConversation
      ? {
          home: {
            issue: conversationLifecycle.conversationOpenIssue ?? "no-target",
            onBack: () => navigator.navigate({ kind: "workspace" }),
            onSettings: openSettings,
            onThemeChange: changeTheme,
            platform,
            theme,
            title: destinationConversation.title,
          },
          timeline: {
            activeRunId: activeAgentState.activeRunId,
            conversationId: destinationConversation.conversationId,
            conversationTitle: destinationConversation.title,
            conversations: conversations.filter(
              (conversation) => conversation.lifecycle === "active",
            ),
            error: activeAgentState.error ?? agentRuntimeError,
            events: activeAgentState.events,
            onRequestDeleteConversation: requestDeleteConversation,
            onResolveApproval: resolveAgentApproval,
            onSelectConversation: (conversationId) => {
              const conversation = conversations.find(
                (candidate) => candidate.conversationId === conversationId,
              );
              if (conversation) void openConversation(conversation);
            },
            onStop: stopAgentTask,
            onSubmit: submitAgentTask,
            submissionAvailable: false,
            submissionBlockedMessage: t(
              "workspace.conversationTargetUnavailableComposer",
            ),
            timeline: activeAgentState.timeline,
          },
        }
      : null,
    settings: {
      onClose: () => navigator.closeSettings(),
      onThemeChange: changeTheme,
      platform,
      theme,
    },
    editor: {
      activeProject,
      agentRuntime,
      changeTheme,
      conversationDeleteDialog,
      conversationLifecycle,
      conversationNavigation,
      editorError,
      fileName,
      fontBinaryRuntime,
      navigator,
      notifications,
      openSettings,
      platform,
      projectConversations,
      projectNavigation,
      projectsById,
      setEditorError,
      theme,
    },
    overlays: { conversationDeleteDialog, notifications },
  };

  return {
    conversationDeleteDialog,
    destination,
    notifications,
    routeContext,
  };
}
