import { MessageProvider } from "@opendesign/ui";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ThemePreference } from "../shared/desktop-api";
import { AgentTimeline } from "./components/AgentTimeline";
import { ConversationDeleteDialog } from "./components/ConversationDeleteDialog";
import { ConversationHome } from "./components/ConversationHome";
import { DiagnosticNotifications } from "./components/DiagnosticNotifications";
import { ProjectHome } from "./components/ProjectHome";
import { SettingsPage } from "./components/SettingsPage";
import { WorkspaceHome } from "./components/WorkspaceHome";
import { useEditorRuntime, useEditorSnapshot } from "./editor-runtime";
import { useI18n } from "./i18n";
import { useAgentConversationRuntime } from "./features/agent-conversation/use-agent-conversation-runtime";
import { useConversationLifecycleState } from "./features/agent-conversation/use-conversation-lifecycle-state";
import { useConversationNavigationController } from "./features/agent-conversation/use-conversation-navigation-controller";
import { useProjectNavigationController } from "./features/project/use-project-navigation-controller";
import { useProjectWorkspaceState } from "./features/project/use-project-workspace-state";
import { useDiagnosticNotificationsController } from "./features/diagnostics/use-diagnostic-notifications-controller";
import { EditorWorkbenchFeature } from "./features/editor-workbench/EditorWorkbenchFeature";
import { AppNavigator } from "./features/app-navigation/app-navigator";
import { useRendererDesignToolHost } from "./use-renderer-design-tool-host";
import { useProfessionalFixtureSmoke } from "./use-professional-fixture-smoke";
import { useFontBinaryRuntime } from "./use-font-binary-runtime";
type AppInitialView = "workspace" | "editor";

function resolveTheme(preference: ThemePreference) {
  if (preference !== "system") return preference;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function App({ initialView }: { initialView?: AppInitialView } = {}) {
  const { t } = useI18n();
  return (
    <MessageProvider
      dismissLabel={t("message.dismiss")}
      regionLabel={t("message.region")}
    >
      <AppContent initialView={initialView} />
    </MessageProvider>
  );
}

function AppContent({ initialView }: { initialView?: AppInitialView } = {}) {
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
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const [platform, setPlatform] = useState<NodeJS.Platform>("darwin");
  const [navigator] = useState(
    () =>
      new AppNavigator(
        initialView === "editor"
          ? { kind: "editor", fileKey: workspaceSnapshot.activeFileKey }
          : { kind: "workspace" },
      ),
  );
  const navigation = useSyncExternalStore(
    navigator.subscribe,
    navigator.getSnapshot,
  );
  const { destination } = navigation;
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
  useProfessionalFixtureSmoke({
    activatePage,
    desktop: window.desktop,
    replaceDocument,
    setView: () =>
      navigator.navigate({
        kind: "editor",
        fileKey: workspace.getSnapshot().activeFileKey,
      }),
  });
  const fontBinaryRuntime = useFontBinaryRuntime();
  useRendererDesignToolHost(
    workspace,
    projectAutosave,
    fontBinaryRuntime.provider,
  );
  const { document: designDocument } = snapshot;
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
    void window.desktop
      ?.getPlatformInfo()
      .then((info) => setPlatform(info.platform));
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
  const {
    createConversation,
    deleteConversation,
    openConversation,
    openGlobalTask,
  } = conversationNavigation;

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

  if (destination.kind === "settings") {
    return (
      <>
        <SettingsPage
          onClose={() => navigator.closeSettings()}
          onThemeChange={changeTheme}
          platform={platform}
          theme={theme}
        />
        {conversationDeleteDialog}
        {notifications}
      </>
    );
  }

  if (
    destination.kind === "workspace" ||
    destination.kind === "invalid" ||
    missingNavigationResource
  ) {
    return (
      <>
        <WorkspaceHome
          busy={workspaceBusy}
          conversations={conversations}
          error={
            destination.kind === "invalid"
              ? destination.reason
              : (missingNavigationResource ?? workspaceError)
          }
          globalTasks={globalTasks}
          onCreateProject={createProject}
          onRequestDeleteConversation={requestDeleteConversation}
          onOpenDesignFile={() => void openDocument()}
          onOpenConversation={(conversation) =>
            void openConversation(conversation)
          }
          onOpenGlobalTask={(task) => void openGlobalTask(task)}
          onOpenProject={() => void openProject()}
          onOpenRecentProject={(projectId) => void openRecentProject(projectId)}
          onRemoveRecentProject={removeRecentProject}
          onRevealRecentProject={revealRecentProject}
          onSettings={openSettings}
          onThemeChange={changeTheme}
          platform={platform}
          recentProjects={recentProjects}
          theme={theme}
        />
        {conversationDeleteDialog}
        {notifications}
      </>
    );
  }

  if (destination.kind === "project" && destinationProject) {
    return (
      <>
        <ProjectHome
          activeConversationId={activeConversationId}
          busy={workspaceBusy}
          conversationDeleteBlockedIds={conversationDeleteBlockedIds}
          conversations={projectConversations}
          error={workspaceError}
          manifest={destinationProject}
          onBack={() => navigator.navigate({ kind: "workspace" })}
          onCreateConversation={createConversation}
          onRequestDeleteConversation={requestDeleteConversation}
          onOpenDesignFile={(designFileId) =>
            void openProjectDesignFile(designFileId)
          }
          onOpenConversation={(conversationId) => {
            const conversation = conversations.find(
              (candidate) => candidate.conversationId === conversationId,
            );
            if (conversation) void openConversation(conversation);
          }}
          onSettings={openSettings}
          onThemeChange={changeTheme}
          platform={platform}
          theme={theme}
        />
        {conversationDeleteDialog}
        {notifications}
      </>
    );
  }

  if (destination.kind === "conversation" && destinationConversation) {
    return (
      <>
        <ConversationHome
          issue={destination.issue}
          onBack={() => navigator.navigate({ kind: "workspace" })}
          onSettings={openSettings}
          onThemeChange={changeTheme}
          platform={platform}
          theme={theme}
          title={destinationConversation.title}
        >
          <AgentTimeline
            activeRunId={activeAgentState.activeRunId}
            conversationId={destinationConversation.conversationId}
            conversationTitle={destinationConversation.title}
            conversations={conversations.filter(
              (conversation) => conversation.lifecycle === "active",
            )}
            error={activeAgentState.error ?? agentRuntimeError}
            events={activeAgentState.events}
            onRequestDeleteConversation={requestDeleteConversation}
            onResolveApproval={resolveAgentApproval}
            onSelectConversation={(conversationId) => {
              const conversation = conversations.find(
                (candidate) => candidate.conversationId === conversationId,
              );
              if (conversation) void openConversation(conversation);
            }}
            onStop={stopAgentTask}
            onSubmit={submitAgentTask}
            submissionAvailable={false}
            submissionBlockedMessage={t(
              "workspace.conversationTargetUnavailableComposer",
            )}
            timeline={activeAgentState.timeline}
          />
        </ConversationHome>
        {conversationDeleteDialog}
        {notifications}
      </>
    );
  }

  return (
    <EditorWorkbenchFeature
      activeProject={activeProject}
      agentRuntime={agentRuntime}
      changeTheme={changeTheme}
      conversationDeleteDialog={conversationDeleteDialog}
      conversationLifecycle={conversationLifecycle}
      conversationNavigation={conversationNavigation}
      editorError={editorError}
      fileName={fileName}
      fontBinaryRuntime={fontBinaryRuntime}
      navigator={navigator}
      notifications={notifications}
      openSettings={openSettings}
      platform={platform}
      projectConversations={projectConversations}
      projectNavigation={projectNavigation}
      projectsById={projectsById}
      setEditorError={setEditorError}
      theme={theme}
    />
  );
}
