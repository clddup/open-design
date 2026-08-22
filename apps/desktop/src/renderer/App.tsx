import type {
  ComponentOverridePatch,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";
import { MessageProvider, ResizeHandle, useMessage } from "@opendesign/ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ThemePreference } from "../shared/desktop-api";
import { AgentTimeline } from "./components/AgentTimeline";
import { ConversationDeleteDialog } from "./components/ConversationDeleteDialog";
import { ConversationHome } from "./components/ConversationHome";
import { Canvas } from "./components/Canvas";
import { CanvasSelectionActions } from "./components/CanvasSelectionActions";
import { DiagnosticNotifications } from "./components/DiagnosticNotifications";
import { DesignFileTabs } from "./components/DesignFileTabs";
import { LeftSidebar } from "./components/LeftSidebar";
import { RenameLayersDialog } from "./components/RenameLayersDialog";
import { ProjectHome } from "./components/ProjectHome";
import { SettingsPage } from "./components/SettingsPage";
import { Statusbar } from "./components/Statusbar";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Titlebar } from "./components/Titlebar";
import { Toolbar } from "./components/Toolbar";
import { UtilityDock } from "./components/UtilityDock";
import { WorkspaceHome } from "./components/WorkspaceHome";
import { useEditorRuntime, useEditorSnapshot } from "./editor-runtime";
import { useI18n } from "./i18n";
import {
  canAddSelectionToVariantSet,
  createComponentInspectorContext,
} from "./component-inspector-context";
import { isTool, type Tool } from "./state/editor";
import { useDesignAssetActions } from "./use-design-asset-actions";
import { useComponentActions } from "./use-component-actions";
import { useProjectLibraryActions } from "./use-project-library-actions";
import { useImportExportWorkflow } from "./features/import-export/use-import-export-workflow";
import { useImageEditWorkflow } from "./features/image/use-image-edit-workflow";
import { useWorkbenchLayoutController } from "./features/workbench/use-workbench-layout-controller";
import { useAgentConversationRuntime } from "./features/agent-conversation/use-agent-conversation-runtime";
import { useConversationLifecycleState } from "./features/agent-conversation/use-conversation-lifecycle-state";
import { useConversationNavigationController } from "./features/agent-conversation/use-conversation-navigation-controller";
import { useProjectNavigationController } from "./features/project/use-project-navigation-controller";
import { useProjectWorkspaceState } from "./features/project/use-project-workspace-state";
import { useCanvasWorkspaceController } from "./features/canvas/use-canvas-workspace-controller";
import { useDiagnosticNotificationsController } from "./features/diagnostics/use-diagnostic-notifications-controller";
import { layoutInspectorMode } from "./features/editor/auto-layout-shortcut";
import { useDocumentCommandControllers } from "./use-document-command-controllers";
import { useLayerCommandController } from "./features/editor/use-layer-command-controller";
import { useLayerRenameWorkflow } from "./features/editor/use-layer-rename-workflow";
import { useRendererDesignToolHost } from "./use-renderer-design-tool-host";
import { useProfessionalFixtureSmoke } from "./use-professional-fixture-smoke";
import { useFontInspectorContext } from "./use-font-inspector-context";
import { useFontBinaryRuntime } from "./use-font-binary-runtime";
type AppView = "workspace" | "project" | "conversation" | "editor" | "settings";

function resolveTheme(preference: ThemePreference) {
  if (preference !== "system") return preference;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function App({ initialView }: { initialView?: AppView } = {}) {
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

function AppContent({ initialView }: { initialView?: AppView } = {}) {
  const { t } = useI18n();
  const message = useMessage();
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
  const [view, setView] = useState<AppView>(initialView ?? "workspace");
  const [editorError, setEditorError] = useState<string | null>(null);
  const {
    activeProject,
    applySavedProjectFile,
    fileName,
    projectAutosave,
    projectsById,
    recentProjects,
    setActiveProject,
    setFileName,
    setProjectsById,
    setRecentProjects,
    setWorkspaceBusy,
    setWorkspaceError,
    workspaceBusy,
    workspaceError,
  } = useProjectWorkspaceState({ setEditorError, t, workspace });
  const {
    leftPanelVisible,
    leftWidth,
    resizeLeftPanel,
    resizeUtilityPanel,
    setSidebarTab,
    setUtilityTab,
    showUtilityTab,
    sidebarTab,
    toggleLeftPanel,
    toggleUtilityPanel,
    utilityPanelVisible,
    utilityTab,
    utilityWidth,
  } = useWorkbenchLayoutController();
  const {
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
  } = useConversationLifecycleState({ setWorkspaceError, t });
  const { dismiss: dismissDiagnostic, events: diagnosticEvents } =
    useDiagnosticNotificationsController();
  const settingsReturnView = useRef<Exclude<AppView, "settings">>("workspace");
  const transactionCounter = useRef(0);
  useProfessionalFixtureSmoke({
    activatePage,
    desktop: window.desktop,
    replaceDocument,
    setFileName,
    setView: () => setView("editor"),
  });
  const fontBinaryRuntime = useFontBinaryRuntime();
  useRendererDesignToolHost(
    workspace,
    projectAutosave,
    fontBinaryRuntime.provider,
  );
  const { document: designDocument, state } = snapshot;
  const tool: Tool = isTool(state.tool) ? state.tool : "select";
  const selectedNode =
    state.selection.nodeIds.length === 1
      ? designDocument.nodesById[state.selection.nodeIds[0] ?? ""]
      : undefined;
  const componentTargetActive = state.selection.componentTarget !== undefined;
  const selectedBooleanParent = selectedNode?.parentId
    ? designDocument.nodesById[selectedNode.parentId]
    : undefined;
  const selectedComponentContext = createComponentInspectorContext(
    designDocument,
    selectedNode,
    state.selection.componentTarget,
  );
  const selectedComponents = state.selection.nodeIds.flatMap((nodeId) => {
    const component = Object.values(designDocument.componentsById).find(
      (candidate) => candidate.rootNodeId === nodeId,
    );
    return component ? [component] : [];
  });
  const canCombineVariants =
    selectedComponents.length >= 2 &&
    selectedComponents.length === state.selection.nodeIds.length &&
    selectedComponents.every((component) => !component.variantSetId);
  const canAddToVariantSet = canAddSelectionToVariantSet(
    designDocument,
    state.selection.nodeIds,
  );
  const projectConversations = activeProject
    ? conversations.filter(
        (conversation) =>
          conversation.filedProjectId === activeProject.projectId &&
          conversation.lifecycle === "active",
      )
    : [];
  const {
    activeAgentState,
    activeCanvasAgentRunId,
    activeCanvasRunExperience,
    agentRuntimeError,
    conversationDeleteBlockedIds,
    forgetConversation,
    generationActivity,
    globalTasks,
    requestConversationHistory,
    resolveAgentApproval,
    stopAgentTask,
    submitAgentTask,
  } = useAgentConversationRuntime({
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

  const { editorCommands, pageActions, styleActions, variableActions } =
    useDocumentCommandControllers({
      runtime,
      selectedNodeId: selectedNode?.id,
      setEditorError,
      t,
      transactionCounter,
    });
  const { applyCommands, resizeFrame, updateNode } = editorCommands;
  const {
    cancelSelectedImageEdit,
    imageEdit,
    replaceSelectedImage,
    runImageEdit,
    runSelectedImageEdit,
    selectImageEditReference,
    switchSelectedImageSource,
    updateImagePaintFilters,
    updateSelectedImageFilters,
    updateSelectedImagePlacement,
  } = useImageEditWorkflow({
    activePageId,
    applyCommands,
    runtime,
    setEditorError,
    t,
  });
  const {
    applyBooleanOperation,
    arrangementMetrics,
    arrangeSelection,
    canChangeSelectedBoolean,
    canCreateBooleanSelection,
    canDeleteSelection,
    canGroupSelection,
    canToggleMaskSelection,
    canRenameSelection,
    canUngroupBooleanSelection,
    canUngroupSelection,
    deleteNodes,
    duplicateSelection,
    groupSelection,
    layerOrderAvailability,
    maskSelectionAction,
    reorderSelection,
    renameLayers,
    reparentLayers,
    toggleMaskSelection,
    ungroupSelection,
  } = useLayerCommandController({
    activePageId,
    applyCommands,
    componentTargetActive,
    document: designDocument,
    runtime,
    selectedNodeIds: state.selection.nodeIds,
    setEditorError,
    t,
    transactionCounter,
  });

  const importExport = useImportExportWorkflow({
    activeDesignFileId: workspaceSnapshot.activeDesignFileId,
    activePageId,
    activeProjectId: workspaceSnapshot.activeProjectId,
    applyCommands,
    editorActive: view === "editor",
    message,
    runtime,
    setEditorError,
    showProperties: () => setUtilityTab("properties"),
    t,
    textRunLayoutProvider: fontBinaryRuntime.provider,
  });

  const projectLibraries = useProjectLibraryActions({
    activeDesignFileId: workspaceSnapshot.activeDesignFileId,
    activePageId,
    activeProjectId: workspaceSnapshot.activeProjectId,
    applyCommands,
    document: designDocument,
    projectBacked: Boolean(projectsById[workspaceSnapshot.activeProjectId]),
    runtime,
    t,
    transactionCounter,
  });

  const {
    addSelectedComponentProperty,
    addSelectedComponentToVariantSet,
    combineSelectedComponentsAsVariants,
    componentPropertyActions,
    createComponentFromSelection,
    createSelectedComponentInstance,
    detachSelectedInstance,
    dissolveSelectedVariantSet,
    duplicateSelectedVariant,
    goToSelectedInstanceMain,
    locateComponentMain,
    placeComponentFromAssets,
    removeSelectedComponent,
    removeSelectedVariantFromSet,
    removeSelectedComponentProperty,
    renameSelectedComponentProperty,
    resetSelectedInstance,
    resetSelectedInstanceSource,
    resetSelectedInstanceComponentProperty,
    setSelectedInstanceComponentProperty,
    updateInstanceSource,
    updateSelectedInstanceSource,
  } = useComponentActions({
    activePageId,
    activatePage,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  });
  const duplicateSelectionAction =
    selectedComponentContext?.variantSet && selectedNode?.kind !== "instance"
      ? duplicateSelectedVariant
      : duplicateSelection;

  const {
    activeRename: activeLayerRename,
    apply: applyActiveLayerRename,
    close: closeLayerRename,
    openSelection: openRenameLayers,
    renameTarget: renameLayerTarget,
  } = useLayerRenameWorkflow({
    renameLayers,
    runtime,
    t,
    updateInstanceSource,
  });

  const toggleSelectedLayerState = useCallback(
    (field: "locked" | "visible") => {
      const current = runtime.getSnapshot();
      const componentTarget = current.state.selection.componentTarget;
      if (componentTarget) {
        const instance = current.document.nodesById[componentTarget.instanceId];
        const context = createComponentInspectorContext(
          current.document,
          instance,
          componentTarget,
        );
        const source = context?.sourceNodes.find(
          (candidate) =>
            candidate.sourcePath.length === componentTarget.sourcePath.length &&
            candidate.sourcePath.every(
              (value, index) => value === componentTarget.sourcePath[index],
            ),
        );
        if (!source) return false;
        updateInstanceSource(
          componentTarget.instanceId,
          componentTarget.sourcePath,
          field === "locked"
            ? { locked: !source.node.locked }
            : { visible: !source.node.visible },
        );
        return true;
      }
      const commands = current.state.selection.nodeIds.flatMap(
        (nodeId, index): UpdatePropertiesCommand[] => {
          const node = current.document.nodesById[nodeId];
          if (!node) return [];
          return [
            {
              commandId: `toggle_${field}_${index}_${nodeId}`,
              type: "update_properties",
              nodeId,
              ...(field === "locked"
                ? { locked: !node.locked }
                : { visible: !node.visible }),
            },
          ];
        },
      );
      if (commands.length === 0) return false;
      return applyCommands(
        t(
          field === "locked"
            ? "history.toggleLayerLock"
            : "history.toggleLayerVisibility",
        ),
        commands,
      );
    },
    [applyCommands, runtime, t, updateInstanceSource],
  );

  const {
    changeZoom,
    fitCanvas,
    handleImageAreaSelectionControllerChange,
    handleImageCropControllerChange,
    handleImageExpandControllerChange,
    handleTextEditingStyleControllerChange,
    handleTextLayoutProviderReady,
    layerHoverTarget,
    setLayerHoverTarget,
    setTextRangeSelection,
    startImageAreaSelection,
    startImageCrop,
    startImageExpand,
    textLayoutProviderEpoch,
    textRangeSelection,
    updateTextEditingStyle,
  } = useCanvasWorkspaceController({
    activePageId,
    applyBooleanOperation,
    canDeleteSelection,
    canRenameSelection,
    canToggleMaskSelection,
    deleteNodes,
    documentId: designDocument.documentId,
    duplicateSelection: duplicateSelectionAction,
    editorActive: view === "editor",
    groupSelection,
    openRenameLayers,
    platform,
    reorderSelection,
    runtime,
    setEditorError,
    t,
    toggleLeftPanel,
    toggleMaskSelection,
    toggleSelectedLayerState,
    toggleUtilityPanel,
    ungroupSelection,
    workspace,
  });

  const fontInspectorContext = useFontInspectorContext({
    applyCommands,
    document: designDocument,
    fontBinaryRuntime,
    runtime,
    selectedNode,
    t,
    textLayoutProviderEpoch,
    textRangeSelection,
    transactionCounter,
    updateTextEditingStyle,
  });

  const {
    deleteImageAsset,
    importImageAsset,
    locateImageAsset,
    placeImageAsset,
    placeImageAssetAtPoint,
    replaceImageAsset,
  } = useDesignAssetActions({
    activePageId,
    activatePage,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  });

  const changeTheme = (value: ThemePreference) => {
    setTheme(value);
    void window.desktop?.setTheme(value);
  };

  const openSettings = useCallback(() => {
    setView((current) => {
      if (current !== "settings") settingsReturnView.current = current;
      return "settings";
    });
  }, []);

  useEffect(() => window.desktop?.onOpenSettings(openSettings), [openSettings]);

  const {
    activateDesignFile,
    createProject,
    openDocument,
    openProject,
    openProjectDesignFile,
    openProjectTarget,
    openRecentProject,
    refreshRecentProjects,
    removeRecentProject,
    renameProjectDesignFile,
    revealRecentProject,
    saveDocument,
  } = useProjectNavigationController({
    activateFile,
    activatePage,
    activeProject,
    applySavedProjectFile,
    conversations,
    fileName,
    openFile,
    projectAutosave,
    projectsById,
    replaceDocument,
    requestConversationHistory,
    runtime,
    selectConversation,
    setActiveProject,
    setEditorError,
    setFileName,
    setProjectsById,
    setRecentProjects,
    setWorkspaceBusy,
    setWorkspaceError,
    showUtilityTab,
    showView: setView,
    t,
    workspace,
    workspaceSnapshot,
  });

  const {
    createConversation,
    deleteConversation,
    openConversation,
    openGlobalTask,
  } = useConversationNavigationController({
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
    showView: setView,
    t,
    view,
  });

  const notifications = (
    <DiagnosticNotifications
      events={diagnosticEvents}
      onDismiss={dismissDiagnostic}
      placement={view === "editor" ? "editor" : "window"}
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

  if (view === "settings") {
    return (
      <>
        <SettingsPage
          onClose={() => setView(settingsReturnView.current)}
          onThemeChange={changeTheme}
          platform={platform}
          theme={theme}
        />
        {conversationDeleteDialog}
        {notifications}
      </>
    );
  }

  if (view === "workspace") {
    return (
      <>
        <WorkspaceHome
          busy={workspaceBusy}
          conversations={conversations}
          error={workspaceError}
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

  if (view === "project" && activeProject) {
    return (
      <>
        <ProjectHome
          activeConversationId={activeConversationId}
          busy={workspaceBusy}
          conversationDeleteBlockedIds={conversationDeleteBlockedIds}
          conversations={projectConversations}
          error={workspaceError}
          manifest={activeProject}
          onBack={() => setView("workspace")}
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

  if (view === "conversation" && activeConversation) {
    return (
      <>
        <ConversationHome
          issue={conversationOpenIssue ?? "no-target"}
          onBack={() => setView("workspace")}
          onSettings={openSettings}
          onThemeChange={changeTheme}
          platform={platform}
          theme={theme}
          title={activeConversation.title}
        >
          <AgentTimeline
            activeRunId={activeAgentState.activeRunId}
            conversationId={activeConversation.conversationId}
            conversationTitle={activeConversation.title}
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

  const activeWorkspaceFile =
    workspaceSnapshot.files[workspaceSnapshot.activeFileKey];
  const documentName = activeWorkspaceFile?.name ?? fileName;
  const pageName = designDocument.pagesById[activePageId]?.name;

  return (
    <>
      <div
        className="app-shell"
        style={
          {
            "--left-width": `${leftWidth}px`,
            "--utility-width": `${utilityWidth}px`,
          } as CSSProperties
        }
      >
        <Titlebar
          canExportSvg={
            state.selection.nodeIds.length > 0 && !componentTargetActive
          }
          dirty={state.dirty}
          documentName={documentName}
          leftPanelVisible={leftPanelVisible}
          onExportSvg={() => void importExport.exportSelection()}
          onImportSvg={() => void importExport.importSvg()}
          onOpen={activeProject ? undefined : () => void openDocument()}
          onProject={activeProject ? () => setView("project") : undefined}
          onSave={() => void saveDocument(false)}
          onSaveAs={activeProject ? undefined : () => void saveDocument(true)}
          onSettings={openSettings}
          onToggleLeftPanel={toggleLeftPanel}
          onToggleUtilityPanel={toggleUtilityPanel}
          onThemeChange={changeTheme}
          onWorkspace={() => setView("workspace")}
          pageName={pageName}
          platform={platform}
          projectName={activeProject?.name}
          svgBusy={importExport.operation !== null}
          theme={theme}
          utilityPanelVisible={utilityPanelVisible}
        />
        <Toolbar
          booleanOperation={
            !componentTargetActive && selectedNode?.kind === "boolean"
              ? selectedNode.properties.operation
              : null
          }
          canBooleanAction={
            canCreateBooleanSelection || canChangeSelectedBoolean
          }
          canHierarchyAction={
            canUngroupBooleanSelection ||
            canUngroupSelection ||
            canGroupSelection
          }
          maskAction={maskSelectionAction}
          canReorder={layerOrderAvailability}
          canDelete={canDeleteSelection}
          canDuplicate={
            state.selection.nodeIds.length > 0 && !componentTargetActive
          }
          canRedo={state.history.canRedo}
          canUndo={state.history.canUndo}
          hierarchyAction={
            selectedNode?.kind === "group" || selectedNode?.kind === "boolean"
              ? "ungroup"
              : "group"
          }
          onBooleanOperation={applyBooleanOperation}
          onDelete={() => deleteNodes(state.selection.nodeIds)}
          onDuplicate={duplicateSelectionAction}
          onGroup={groupSelection}
          onToggleMask={toggleMaskSelection}
          onReorder={reorderSelection}
          onRedo={() => runtime.redo()}
          onToolChange={(next) => runtime.setTool(next)}
          onUndo={() => runtime.undo()}
          onUngroup={ungroupSelection}
          platform={platform}
          tool={tool}
        />
        <div
          className="workspace"
          data-left-panel={leftPanelVisible ? "visible" : "hidden"}
          data-utility-panel={utilityPanelVisible ? "visible" : "hidden"}
        >
          <LeftSidebar
            className="workspace__navigator"
            hidden={!leftPanelVisible}
            activePageId={activePageId}
            document={designDocument}
            onDeleteAsset={deleteImageAsset}
            onCreatePage={pageActions.createPage}
            onDeletePage={pageActions.deletePage}
            onDuplicatePage={pageActions.duplicatePage}
            onImportAsset={importImageAsset}
            onLocateAsset={locateImageAsset}
            onLocateComponent={locateComponentMain}
            onPageChange={activatePage}
            onPlaceAsset={placeImageAsset}
            onPlaceComponent={placeComponentFromAssets}
            onRenamePage={pageActions.renamePage}
            onReorderPage={pageActions.reorderPage}
            onReplaceAsset={replaceImageAsset}
            onLayerHoverChange={setLayerHoverTarget}
            onReparent={reparentLayers}
            onRenameLayer={renameLayerTarget}
            onSelect={(nodeIds, anchorNodeId, componentTarget) =>
              runtime.setSelection(nodeIds, anchorNodeId, componentTarget)
            }
            onTabChange={setSidebarTab}
            onToggleLock={(nodeId) => {
              const node = designDocument.nodesById[nodeId];
              if (node) updateNode(nodeId, { locked: !node.locked });
            }}
            onToggleVisibility={(nodeId) => {
              const node = designDocument.nodesById[nodeId];
              if (node) updateNode(nodeId, { visible: !node.visible });
            }}
            onUpdateComponentLayer={(target, patch) =>
              updateInstanceSource(target.instanceId, target.sourcePath, patch)
            }
            selectedNodeIds={state.selection.nodeIds}
            selectionAnchorNodeId={state.selection.anchorNodeId}
            selectionComponentTarget={state.selection.componentTarget}
            tab={sidebarTab}
            projectLibraries={projectLibraries}
            styleActions={styleActions}
            variableActions={variableActions}
          />
          <div
            className="workspace__navigator-resizer"
            hidden={!leftPanelVisible}
          >
            <ResizeHandle
              label={t("resize.documentSidebar")}
              max={360}
              min={184}
              onChange={resizeLeftPanel}
              orientation="vertical"
              value={leftWidth}
            />
          </div>
          <div className="workspace__center">
            <DesignFileTabs
              canRename={(projectId) => projectsById[projectId] !== undefined}
              onActivate={activateDesignFile}
              onRename={renameProjectDesignFile}
              snapshot={workspaceSnapshot}
            />
            <Canvas
              activeAgentRunId={activeCanvasAgentRunId}
              agentRunExperience={activeCanvasRunExperience ?? undefined}
              activePageId={activePageId}
              generationActivity={generationActivity}
              layerHoverTarget={layerHoverTarget ?? undefined}
              imageEditActivity={
                imageEdit
                  ? {
                      action: imageEdit.action,
                      nodeName:
                        designDocument.nodesById[imageEdit.nodeId]?.name ??
                        t("node.image"),
                      status: imageEdit.status,
                      onCancel: cancelSelectedImageEdit,
                    }
                  : undefined
              }
              onTransactionError={setEditorError}
              onAssetDrop={placeImageAssetAtPoint}
              onImageAreaEdit={(nodeId, action, selection) =>
                void runImageEdit(nodeId, { action, selection })
              }
              onImageAreaSelectionControllerChange={
                handleImageAreaSelectionControllerChange
              }
              onImageExpand={(nodeId, expansion) =>
                void runImageEdit(nodeId, { action: "expand", expansion })
              }
              onImageExpandControllerChange={handleImageExpandControllerChange}
              onImageCropControllerChange={handleImageCropControllerChange}
              onTextLayoutProviderReady={handleTextLayoutProviderReady}
              onTextEditingStyleControllerChange={
                handleTextEditingStyleControllerChange
              }
              onTextRangeSelectionChange={setTextRangeSelection}
              harfBuzzTextRunLayoutProvider={fontBinaryRuntime.provider}
              onResizeFrame={resizeFrame}
              onReorderGridTracks={editorCommands.reorderGridTracks}
              runtime={runtime}
              showAgentRunStatus={
                !utilityPanelVisible || utilityTab !== "agent"
              }
              selectionActions={
                state.selection.nodeIds.length > 0 ? (
                  <CanvasSelectionActions
                    canDelete={canDeleteSelection}
                    canDuplicate={!componentTargetActive}
                    canHierarchyAction={
                      canUngroupBooleanSelection ||
                      canUngroupSelection ||
                      canGroupSelection
                    }
                    canReorder={layerOrderAvailability}
                    count={state.selection.nodeIds.length}
                    hierarchyAction={
                      selectedNode?.kind === "group" ||
                      selectedNode?.kind === "boolean"
                        ? "ungroup"
                        : "group"
                    }
                    name={selectedNode?.name}
                    onDelete={() => deleteNodes(state.selection.nodeIds)}
                    onDuplicate={duplicateSelectionAction}
                    onGroup={groupSelection}
                    onOpenProperties={() => showUtilityTab("properties")}
                    onReorder={reorderSelection}
                    onUngroup={ungroupSelection}
                    platform={platform}
                  />
                ) : undefined
              }
              snapshot={snapshot}
            />
          </div>
          <div
            className="workspace__utility-resizer"
            hidden={!utilityPanelVisible}
          >
            <ResizeHandle
              invert
              label={t("resize.utilityDock")}
              max={400}
              min={280}
              onChange={resizeUtilityPanel}
              orientation="vertical"
              value={utilityWidth}
            />
          </div>
          <UtilityDock
            className="workspace__utility"
            hidden={!utilityPanelVisible}
            activeTab={utilityTab}
            agent={
              <AgentTimeline
                approvalResourceName={fileName}
                activeRunId={activeAgentState.activeRunId}
                conversationId={activeConversation?.conversationId ?? null}
                conversationTitle={activeConversation?.title ?? null}
                conversations={projectConversations}
                error={activeAgentState.error ?? agentRuntimeError}
                events={activeAgentState.events}
                onCreateConversation={
                  activeProject
                    ? () =>
                        createConversation(
                          t("agent.defaultConversationTitle", {
                            count: projectConversations.length + 1,
                          }),
                        )
                    : undefined
                }
                onRequestDeleteConversation={requestDeleteConversation}
                onSelectConversation={(conversationId) => {
                  const conversation = conversations.find(
                    (candidate) => candidate.conversationId === conversationId,
                  );
                  if (conversation) void openConversation(conversation);
                }}
                onResolveApproval={resolveAgentApproval}
                onStop={stopAgentTask}
                onSubmit={submitAgentTask}
                scope={
                  state.selection.nodeIds.length > 0
                    ? {
                        kind: "selection",
                        count: state.selection.nodeIds.length,
                      }
                    : {
                        kind: "page",
                        ...(pageName ? { name: pageName } : {}),
                      }
                }
                timeline={activeAgentState.timeline}
              />
            }
            agentRunning={Boolean(activeAgentState.activeRunId)}
            onTabChange={setUtilityTab}
            properties={
              <PropertiesPanel
                activePageId={activePageId}
                arrangement={arrangementMetrics}
                componentContext={selectedComponentContext}
                booleanOperationEditable={canChangeSelectedBoolean}
                booleanOperandParent={
                  selectedBooleanParent?.kind === "boolean"
                    ? {
                        id: selectedBooleanParent.id,
                        name: selectedBooleanParent.name,
                      }
                    : undefined
                }
                canDelete={canDeleteSelection}
                canAddToVariantSet={canAddToVariantSet}
                canCombineVariants={canCombineVariants}
                layoutMode={
                  componentTargetActive
                    ? null
                    : layoutInspectorMode(designDocument, selectedNode)
                }
                document={designDocument}
                node={selectedNode}
                onArrange={arrangeSelection}
                onBooleanOperationChange={applyBooleanOperation}
                onCancelSvgOperation={importExport.cancelOperation}
                onCreateComponent={createComponentFromSelection}
                onCreateComponentInstance={createSelectedComponentInstance}
                onCombineVariants={combineSelectedComponentsAsVariants}
                onAddToVariantSet={addSelectedComponentToVariantSet}
                onDelete={() => deleteNodes(state.selection.nodeIds)}
                onDetachComponentInstance={detachSelectedInstance}
                onDissolveVariantSet={dissolveSelectedVariantSet}
                onDuplicateVariant={duplicateSelectedVariant}
                onDismissSvgFeedback={importExport.dismissSvgFeedback}
                onDuplicate={duplicateSelectionAction}
                onGoToComponentMain={goToSelectedInstanceMain}
                onExportFormatChange={importExport.setExportFormat}
                onExportRaster={() => void importExport.exportRaster()}
                onExportStoredSetting={(setting) =>
                  void importExport.exportStoredSetting(setting)
                }
                onExportSvg={() => void importExport.exportSvg()}
                onCropImage={() => {
                  if (selectedNode?.kind !== "image") return false;
                  return startImageCrop(selectedNode.id);
                }}
                onSelectImageArea={() => {
                  if (selectedNode?.kind !== "image") return false;
                  return startImageAreaSelection(selectedNode.id);
                }}
                onExpandImage={() => {
                  if (selectedNode?.kind !== "image") return false;
                  return startImageExpand(selectedNode.id);
                }}
                onReplaceImage={() => void replaceSelectedImage()}
                imageEditStatus={
                  imageEdit && imageEdit.nodeId === selectedNode?.id
                    ? imageEdit.status
                    : null
                }
                imageEditAction={
                  imageEdit && imageEdit.nodeId === selectedNode?.id
                    ? imageEdit.action
                    : null
                }
                onRemoveImageBackground={() =>
                  void runSelectedImageEdit({ action: "remove-background" })
                }
                onReplaceImageBackground={(prompt) =>
                  void runSelectedImageEdit({
                    action: "replace-background",
                    prompt,
                  })
                }
                onRelightImage={(lightingPreset) =>
                  void runSelectedImageEdit({
                    action: "relight",
                    lightingPreset,
                  })
                }
                onUpscaleImage={() =>
                  void runSelectedImageEdit({ action: "upscale" })
                }
                onEditImageWithPrompt={(prompt, reference) =>
                  void runSelectedImageEdit({
                    action: "prompt-edit",
                    prompt,
                    ...(reference === undefined ? {} : { reference }),
                  })
                }
                onSelectImageEditReference={selectImageEditReference}
                onCancelImageEdit={cancelSelectedImageEdit}
                onSwitchImageSource={switchSelectedImageSource}
                onUpdateImageFilters={updateSelectedImageFilters}
                onUpdateImagePaintFilters={updateImagePaintFilters}
                onUpdateImagePlacement={updateSelectedImagePlacement}
                onRemoveComponent={removeSelectedComponent}
                onRemoveVariant={removeSelectedVariantFromSet}
                onAddComponentProperty={addSelectedComponentProperty}
                onRemoveComponentProperty={removeSelectedComponentProperty}
                onRenameComponentProperty={renameSelectedComponentProperty}
                onResetComponentInstance={resetSelectedInstance}
                onResetComponentProperty={
                  resetSelectedInstanceComponentProperty
                }
                onResetComponentSourceOverride={resetSelectedInstanceSource}
                onSetComponentProperty={setSelectedInstanceComponentProperty}
                {...componentPropertyActions}
                onSelectBooleanParent={(nodeId) =>
                  runtime.setSelection([nodeId], nodeId)
                }
                onSetConstraints={editorCommands.setNodeConstraints}
                onSetLayoutPositioning={editorCommands.setNodeLayoutPositioning}
                onSetFrameLayoutGuides={editorCommands.setFrameLayoutGuides}
                onReorderGridTracks={editorCommands.reorderGridTracks}
                onUpdate={(updates) => {
                  if (selectedNode) updateNode(selectedNode.id, updates);
                }}
                onUpdateComponentOverride={(
                  sourcePath: readonly string[],
                  patch: ComponentOverridePatch,
                ) => updateSelectedInstanceSource(sourcePath, patch)}
                onSetVariableBinding={variableActions.setBinding}
                onSetVariableMode={variableActions.setSelectedNodeMode}
                styleActions={styleActions}
                projectLibraries={projectLibraries}
                onSvgExportSettingsChange={importExport.setSvgExportSettings}
                onRasterExportSettingsChange={
                  importExport.setRasterExportSettings
                }
                fontContext={fontInspectorContext}
                exportFormat={importExport.exportFormat}
                rasterExportSettings={importExport.rasterExportSettings}
                selectionCount={state.selection.nodeIds.length}
                svgExportSettings={importExport.svgExportSettings}
                svgFeedback={importExport.svgFeedback}
                svgOperation={importExport.operation}
              />
            }
          />
        </div>
        <Statusbar
          dirty={state.dirty}
          error={editorError}
          onFitPage={() => fitCanvas("page")}
          onFitSelection={() => fitCanvas("selection")}
          onZoomChange={changeZoom}
          revision={designDocument.revision}
          selection={{
            count: state.selection.nodeIds.length,
            node: selectedNode
              ? { kind: selectedNode.kind, name: selectedNode.name }
              : undefined,
          }}
          zoom={state.viewport.zoom}
        />
        {conversationDeleteDialog}
        {activeLayerRename && (
          <RenameLayersDialog
            items={activeLayerRename.items}
            key={`${activeLayerRename.kind}:${activeLayerRename.baseRevision}:${activeLayerRename.items.map(({ id }) => id).join(":")}`}
            onClose={closeLayerRename}
            onRename={applyActiveLayerRename}
          />
        )}
        {notifications}
      </div>
    </>
  );
}
