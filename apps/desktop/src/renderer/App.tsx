import type {
  AgentAttachment,
  AgentEvent,
  AgentRequest,
  SelectionScope,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import type { ModelSelection } from "@opendesign/model-gateway";
import type {
  LeaferTextRangeSelection,
  LeaferTextStyleUpdate,
} from "@opendesign/leafer-engine";
import type { TextLayoutProvider } from "@opendesign/text-service";
import type { ImageAreaSelection } from "@opendesign/image-service";
import type {
  ComponentOverridePatch,
  DesignAsset,
  DesignDocument,
  ImageFilters,
  ImagePaint,
  ImagePlacement,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";
import {
  getNodeBounds,
  getSelectionBounds,
  planImageNodeUpdate,
  planImagePaintFilterUpdate,
  screenToDocument,
} from "@opendesign/editor-runtime";
import type {
  ConversationDescriptor,
  GlobalTaskProjection,
  ProjectManifest,
} from "@opendesign/workspace-contracts";
import { MessageProvider, ResizeHandle, useMessage } from "@opendesign/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  DesignImageEditAction,
  DesignImageEditRequest,
  DiagnosticEvent,
  ProjectDesignFile,
  RecentProject,
  ThemePreference,
} from "../shared/desktop-api";
import { AgentTimeline } from "./components/AgentTimeline";
import { ConversationDeleteDialog } from "./components/ConversationDeleteDialog";
import { ConversationHome } from "./components/ConversationHome";
import { Canvas } from "./components/Canvas";
import { CanvasSelectionActions } from "./components/CanvasSelectionActions";
import {
  DiagnosticNotifications,
  isTaskScopedDiagnostic,
} from "./components/DiagnosticNotifications";
import { DesignFileTabs } from "./components/DesignFileTabs";
import { LeftSidebar } from "./components/LeftSidebar";
import { RenameLayersDialog } from "./components/RenameLayersDialog";
import { ProjectHome } from "./components/ProjectHome";
import { SettingsPage } from "./components/SettingsPage";
import { Statusbar } from "./components/Statusbar";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Titlebar } from "./components/Titlebar";
import { Toolbar } from "./components/Toolbar";
import { UtilityDock, type UtilityDockTab } from "./components/UtilityDock";
import { WorkspaceHome } from "./components/WorkspaceHome";
import {
  LOCAL_PROJECT_ID,
  useEditorRuntime,
  useEditorSnapshot,
} from "./editor-runtime";
import { useI18n } from "./i18n";
import type { LayerHoverTarget } from "./layer-hover-target";
import {
  canAddSelectionToVariantSet,
  createComponentInspectorContext,
} from "./component-inspector-context";
import {
  ProjectAutosaveCoordinator,
  type ProjectAutosaveTarget,
} from "./project-autosave";
import {
  EMPTY_GENERATION_PLAN_PRESENTATION_STATE,
  clearGenerationPlanPresentationRun,
  generationActivityFromAcceptedPlan,
  generationActivityMessageKey,
  projectGenerationPlanPresentationEvent,
} from "./generation-presentation";
import { isTool, type SidebarTab, type Tool } from "./state/editor";
import { useDesignAssetActions } from "./use-design-asset-actions";
import { useComponentActions } from "./use-component-actions";
import { useProjectLibraryActions } from "./use-project-library-actions";
import { useImportExportWorkflow } from "./features/import-export/use-import-export-workflow";
import { layoutInspectorMode } from "./features/editor/auto-layout-shortcut";
import { useDocumentCommandControllers } from "./use-document-command-controllers";
import { useLayerCommandController } from "./features/editor/use-layer-command-controller";
import { useLayerRenameWorkflow } from "./features/editor/use-layer-rename-workflow";
import {
  projectAgentActiveRunId,
  projectAgentRunFileBinding,
} from "./features/agent-conversation/continuation-binding";
import { projectAgentRunExperience } from "./features/agent-conversation/agent-run-experience";
import { reportRendererError } from "./diagnostics";
import { useRendererDesignToolHost } from "./use-renderer-design-tool-host";
import { useProfessionalFixtureSmoke } from "./use-professional-fixture-smoke";
import { useFontInspectorContext } from "./use-font-inspector-context";
import { useFontBinaryRuntime } from "./use-font-binary-runtime";
const HISTORY_SYNC_DEBOUNCE_MS = 80;
const NAVIGATOR_AUTO_COLLAPSE_WIDTH = 960;
const UTILITY_AUTO_COLLAPSE_WIDTH = 760;
const WORKBENCH_PANEL_STORAGE_PREFIX = "opendesign.workbench.panel";
type AppView = "workspace" | "project" | "conversation" | "editor" | "settings";

type ConversationAgentState = {
  timeline: SessionTimelineItem[];
  events: AgentEvent[];
  activeRunId: string | null;
  error: string | null;
};

const EMPTY_AGENT_STATE: ConversationAgentState = {
  timeline: [],
  events: [],
  activeRunId: null,
  error: null,
};

function resolveTheme(preference: ThemePreference) {
  if (preference !== "system") return preference;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readPanelVisibility(panel: "navigator" | "utility"): boolean {
  try {
    return (
      window.localStorage.getItem(
        `${WORKBENCH_PANEL_STORAGE_PREFIX}.${panel}`,
      ) !== "hidden"
    );
  } catch {
    return true;
  }
}

function persistPanelVisibility(
  panel: "navigator" | "utility",
  visible: boolean,
) {
  try {
    window.localStorage.setItem(
      `${WORKBENCH_PANEL_STORAGE_PREFIX}.${panel}`,
      visible ? "visible" : "hidden",
    );
  } catch {
    // Session persistence is best-effort and never blocks the editor shell.
  }
}

function readPanelWidth(
  panel: "navigator" | "utility",
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const stored = window.localStorage.getItem(
      `${WORKBENCH_PANEL_STORAGE_PREFIX}.${panel}.width`,
    );
    if (stored === null) return fallback;
    const value = Number(stored);
    return Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  } catch {
    return fallback;
  }
}

function persistPanelWidth(panel: "navigator" | "utility", width: number) {
  try {
    window.localStorage.setItem(
      `${WORKBENCH_PANEL_STORAGE_PREFIX}.${panel}.width`,
      String(Math.round(width)),
    );
  } catch {
    // Panel sizing remains usable when persistence is unavailable.
  }
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
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectManifest | null>(
    null,
  );
  const [projectsById, setProjectsById] = useState<
    Readonly<Record<string, ProjectManifest>>
  >({});
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [fileName, setFileName] = useState(() => t("file.untitled"));
  const [leftWidth, setLeftWidth] = useState(() =>
    readPanelWidth("navigator", 236, 184, 360),
  );
  const [utilityWidth, setUtilityWidth] = useState(() =>
    readPanelWidth("utility", 320, 280, 400),
  );
  const [leftPanelVisible, setLeftPanelVisible] = useState(() =>
    readPanelVisibility("navigator"),
  );
  const [utilityPanelVisible, setUtilityPanelVisible] = useState(() =>
    readPanelVisibility("utility"),
  );
  const [utilityTab, setUtilityTab] = useState<UtilityDockTab>("agent");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("layers");
  const [conversations, setConversations] = useState<ConversationDescriptor[]>(
    [],
  );
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [conversationOpenIssue, setConversationOpenIssue] = useState<
    | "project-unavailable"
    | "design-file-unavailable"
    | "page-unavailable"
    | "no-target"
    | null
  >(null);
  const [pendingConversationDeletionId, setPendingConversationDeletionId] =
    useState<string | null>(null);
  const [conversationDeletionBusy, setConversationDeletionBusy] =
    useState(false);
  const [conversationDeletionError, setConversationDeletionError] = useState<
    string | null
  >(null);
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
  const [editorError, setEditorError] = useState<string | null>(null);
  const [imageEdit, setImageEdit] = useState<{
    requestId: string;
    nodeId: string;
    action: DesignImageEditAction;
    status: "running" | "cancelling";
  } | null>(null);
  const cancelledImageEditRequestIds = useRef(new Set<string>());
  const [layerHoverTarget, setLayerHoverTarget] =
    useState<LayerHoverTarget | null>(null);
  const [textRangeSelection, setTextRangeSelection] =
    useState<LeaferTextRangeSelection | null>(null);
  const textEditingStyleController = useRef<
    ((style: LeaferTextStyleUpdate) => boolean) | null
  >(null);
  const imageCropController = useRef<((nodeId: string) => boolean) | null>(
    null,
  );
  const imageAreaSelectionController = useRef<
    ((nodeId: string) => boolean) | null
  >(null);
  const [textLayoutProviderEpoch, setTextLayoutProviderEpoch] = useState(0);
  const [diagnosticEvents, setDiagnosticEvents] = useState<DiagnosticEvent[]>(
    [],
  );
  const runCounter = useRef(0);
  const settingsReturnView = useRef<Exclude<AppView, "settings">>("workspace");
  const transactionCounter = useRef(0);
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
  const autosaveCallbacks = useRef<{
    onError: (target: ProjectAutosaveTarget, error: unknown) => void;
    onSaved: (target: ProjectAutosaveTarget, saved: ProjectDesignFile) => void;
  }>({ onError: () => undefined, onSaved: () => undefined });
  const projectAutosave = useMemo(
    () =>
      new ProjectAutosaveCoordinator({
        save: async (projectId, designFileId, document) => {
          const desktop = window.desktop;
          if (!desktop) throw new Error("Desktop autosave is unavailable");
          return await desktop.saveProjectDesignFile({
            projectId,
            designFileId,
            document,
          });
        },
        onError: (target, error) =>
          autosaveCallbacks.current.onError(target, error),
        onSaved: (target, saved) =>
          autosaveCallbacks.current.onSaved(target, saved),
      }),
    [],
  );
  const handleTextLayoutProviderReady = useCallback(
    (provider: TextLayoutProvider) => {
      workspace.setTextLayoutProvider(provider);
      setTextLayoutProviderEpoch((current) => current + 1);
    },
    [workspace],
  );
  const handleTextEditingStyleControllerChange = useCallback(
    (controller: ((style: LeaferTextStyleUpdate) => boolean) | null) => {
      textEditingStyleController.current = controller;
    },
    [],
  );
  const updateTextEditingStyle = useCallback(
    (style: LeaferTextStyleUpdate) =>
      textEditingStyleController.current?.(style) ?? false,
    [],
  );
  const handleImageCropControllerChange = useCallback(
    (controller: ((nodeId: string) => boolean) | null) => {
      imageCropController.current = controller;
    },
    [],
  );
  const handleImageAreaSelectionControllerChange = useCallback(
    (controller: ((nodeId: string) => boolean) | null) => {
      imageAreaSelectionController.current = controller;
    },
    [],
  );
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
  autosaveCallbacks.current = {
    onError: (target, error) => {
      setEditorError(
        reportRendererError(
          "design_autosave_failed",
          error,
          t("error.autosaveDesignFile"),
          {
            projectId: target.projectId,
            designFileId: target.designFileId,
          },
        ),
      );
    },
    onSaved: (target, saved) => {
      const updateManifest = (project: ProjectManifest): ProjectManifest => ({
        ...project,
        updatedAt: saved.descriptor.updatedAt,
        designFiles: project.designFiles.map((file) =>
          file.designFileId === saved.descriptor.designFileId
            ? saved.descriptor
            : file,
        ),
      });
      setProjectsById((projects) => {
        const project = projects[target.projectId];
        return project
          ? { ...projects, [target.projectId]: updateManifest(project) }
          : projects;
      });
      setActiveProject((project) =>
        project?.projectId === target.projectId
          ? updateManifest(project)
          : project,
      );
      workspace.renameFile(
        target.projectId,
        target.designFileId,
        saved.descriptor.name,
      );
      if (designDocument.documentId === target.documentId) {
        setFileName(saved.descriptor.name);
      }
    },
  };
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
  useEffect(
    () => setLayerHoverTarget(null),
    [activePageId, designDocument.documentId],
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
  const conversationDeleteBlockedIds = globalTasks
    .filter((task) =>
      ["queued", "running", "waiting_approval"].includes(task.lifecycle),
    )
    .map((task) => task.conversationId);
  const activeConversation =
    conversations.find(
      (conversation) => conversation.conversationId === activeConversationId,
    ) ?? null;
  const activeAgentState = activeConversation
    ? (agentByConversationId[activeConversation.conversationId] ??
      EMPTY_AGENT_STATE)
    : EMPTY_AGENT_STATE;
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
  const activeCanvasRunExperience = useMemo(
    () =>
      activeCanvasAgentRunId
        ? projectAgentRunExperience({
            activeRunId: activeCanvasAgentRunId,
            events: activeAgentState.events,
            timeline: activeAgentState.timeline,
            error: activeAgentState.error,
          })
        : null,
    [
      activeAgentState.error,
      activeAgentState.events,
      activeAgentState.timeline,
      activeCanvasAgentRunId,
    ],
  );

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
        await window.desktop.sendAgentRequest({
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

  useEffect(
    () => () => {
      historySyncTimers.current.forEach((timer) => clearTimeout(timer));
      historySyncTimers.current.clear();
    },
    [],
  );

  useEffect(() => {
    void window.desktop?.getTheme().then(setTheme);
    void window.desktop
      ?.getPlatformInfo()
      .then((info) => setPlatform(info.platform));
    void window.desktop
      ?.listRecentProjects()
      .then(setRecentProjects)
      .catch((error: unknown) => {
        setWorkspaceError(
          reportRendererError(
            "recent_projects_load_failed",
            error,
            t("error.loadRecentProjects"),
          ),
        );
      });
    void window.desktop
      ?.listConversations()
      .then(setConversations)
      .catch((error: unknown) => {
        setWorkspaceError(
          reportRendererError(
            "conversations_load_failed",
            error,
            t("error.loadConversations"),
          ),
        );
      });
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
  }, [t]);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop || typeof desktop.onDiagnosticEvent !== "function") return;
    let active = true;
    const receive = (event: DiagnosticEvent) => {
      if (
        !active ||
        event.presentation !== "toast" ||
        isTaskScopedDiagnostic(event)
      ) {
        return;
      }
      setDiagnosticEvents((current) =>
        [
          ...current.filter((candidate) => candidate.eventId !== event.eventId),
          event,
        ].slice(-4),
      );
    };
    const unsubscribe = desktop.onDiagnosticEvent(receive);
    if (typeof desktop.getPendingDiagnostics === "function") {
      void desktop
        .getPendingDiagnostics()
        .then((events) => events.forEach(receive))
        .catch(() => undefined);
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    return () => projectAutosave.dispose();
  }, [projectAutosave]);

  useEffect(() => {
    let closeAfterFlush = false;
    let flushing = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (closeAfterFlush || !projectAutosave.hasPendingWork()) return;
      event.preventDefault();
      event.returnValue = false;
      if (flushing) return;
      flushing = true;
      void projectAutosave.flushAll().then(
        () => {
          closeAfterFlush = true;
          window.close();
        },
        () => {
          flushing = false;
        },
      );
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [projectAutosave]);

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
            return {
              ...previous,
              timeline: event.timeline,
              events: pruneLiveEventsCoveredByTimeline(
                previous.events,
                event.timeline,
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
        void window.desktop
          ?.listGlobalTasks()
          .then(setGlobalTasks)
          .catch(() => undefined);
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
  }, [requestConversationHistory, scheduleConversationHistory, workspace]);

  const { editorCommands, pageActions, styleActions, variableActions } =
    useDocumentCommandControllers({
      runtime,
      selectedNodeId: selectedNode?.id,
      setEditorError,
      t,
      transactionCounter,
    });
  const { applyCommands, resizeFrame, updateNode } = editorCommands;
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

  const replaceSelectedImage = useCallback(async () => {
    const selected = runtime.getSnapshot().state.selection.nodeIds;
    const nodeId = selected.length === 1 ? selected[0] : undefined;
    const before = nodeId
      ? runtime.getSnapshot().document.nodesById[nodeId]
      : undefined;
    if (!nodeId || !before || before.kind !== "image") return;
    try {
      const selection = await window.desktop?.selectDesignImage();
      if (!selection) return;
      const current = runtime.getSnapshot().document;
      const image = current.nodesById[nodeId];
      if (!image || image.kind !== "image") {
        setEditorError(t("error.replaceImage"));
        return;
      }
      const plan = planImageNodeUpdate(
        current,
        {
          action: "replace-source",
          pageId: activePageId,
          nodeId,
          asset: selection.asset,
        },
        `replace_image_${crypto.randomUUID().replaceAll("-", "")}_${nodeId}`,
      );
      if (!plan.ok) {
        if (plan.code !== "no-op") setEditorError(t("error.replaceImage"));
        return;
      }
      applyCommands(t("history.replaceImage"), plan.commands);
    } catch {
      setEditorError(t("error.replaceImage"));
    }
  }, [activePageId, applyCommands, runtime, t]);

  const runImageEdit = useCallback(
    async (
      nodeId: string,
      edit:
        | { action: "remove-background" }
        | {
            action: "prompt-edit";
            prompt: string;
            reference?: DesignAsset;
          }
        | {
            action: "erase-object" | "isolate-object";
            selection: ImageAreaSelection;
          },
    ) => {
      if (imageEdit) return;
      const snapshot = runtime.getSnapshot();
      const node = snapshot.document.nodesById[nodeId];
      if (!node || node.kind !== "image") return;
      const source = snapshot.document.assetsById[node.properties.assetId];
      if (
        !source ||
        source.kind !== "image" ||
        source.source.type !== "data" ||
        (source.mimeType !== "image/png" &&
          source.mimeType !== "image/jpeg" &&
          source.mimeType !== "image/webp")
      ) {
        setEditorError(t("error.imageEditUnsupported"));
        return;
      }
      const requestId = `image_edit_${crypto.randomUUID()}`;
      const resultNodeId =
        edit.action === "isolate-object"
          ? `isolated_image_${crypto.randomUUID().replaceAll("-", "")}`
          : undefined;
      const expectedAssetId = node.properties.assetId;
      setImageEdit({
        requestId,
        nodeId,
        action: edit.action,
        status: "running",
      });
      setEditorError(null);
      try {
        const requestBase = {
          requestId,
          pageId: activePageId,
          nodeId,
          expectedAssetId,
          source,
        };
        const editRequest: DesignImageEditRequest =
          edit.action === "erase-object" || edit.action === "isolate-object"
            ? {
                ...requestBase,
                action: edit.action,
                selection: {
                  points: edit.selection.points.map((point) => ({ ...point })),
                },
              }
            : edit.action === "prompt-edit"
              ? { ...requestBase, ...edit }
              : { ...requestBase, action: edit.action };
        const edited = await window.desktop?.editDesignImage(editRequest);
        if (!edited) throw new Error("Image editing is unavailable");
        if (cancelledImageEditRequestIds.current.has(requestId)) {
          throw new DOMException("Image editing cancelled", "AbortError");
        }
        if (
          edited.requestId !== requestId ||
          edited.action !== edit.action ||
          edited.sourceAssetId !== expectedAssetId ||
          (edit.action === "prompt-edit" &&
            (edited.derivation.prompt !== edit.prompt.trim() ||
              edited.derivation.referenceAssetIds[0] !== edit.reference?.id ||
              edited.derivation.referenceAssetIds.length !==
                (edit.reference === undefined ? 0 : 1)))
        ) {
          throw new Error(
            "Image edit response did not match the current request",
          );
        }
        const current = runtime.getSnapshot().document;
        const plan = planImageNodeUpdate(
          current,
          edit.action === "isolate-object" && resultNodeId
            ? {
                action: "derive-layer",
                pageId: activePageId,
                nodeId,
                expectedAssetId,
                resultNodeId,
                resultNodeName: t("canvas.imageAreaIsolatedLayer"),
                asset: edited.asset,
                derivation: edited.derivation,
                ...(edited.supportingAssets === undefined
                  ? {}
                  : { supportingAssets: edited.supportingAssets }),
              }
            : {
                action: "derive-source",
                pageId: activePageId,
                nodeId,
                expectedAssetId,
                asset: edited.asset,
                derivation: edited.derivation,
                ...(edited.supportingAssets === undefined
                  ? {}
                  : { supportingAssets: edited.supportingAssets }),
              },
          `image_edit_${requestId}`,
        );
        if (!plan.ok) throw new Error(plan.message);
        if (
          !applyCommands(
            t(
              edit.action === "remove-background"
                ? "history.removeImageBackground"
                : edit.action === "prompt-edit"
                  ? "history.editImageWithPrompt"
                  : edit.action === "erase-object"
                    ? "history.eraseImageObject"
                    : "history.isolateImageObject",
            ),
            plan.commands,
          )
        ) {
          throw new Error("Image edit transaction was rejected");
        }
        const latestSelection = runtime.getSnapshot().state.selection.nodeIds;
        if (
          resultNodeId &&
          latestSelection.length === 1 &&
          latestSelection[0] === nodeId
        ) {
          runtime.setSelection([resultNodeId], resultNodeId);
        }
      } catch (error) {
        if (
          !cancelledImageEditRequestIds.current.has(requestId) &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setEditorError(
            error instanceof Error ? error.message : t("error.editImage"),
          );
        }
      } finally {
        cancelledImageEditRequestIds.current.delete(requestId);
        setImageEdit((current) =>
          current?.requestId === requestId ? null : current,
        );
      }
    },
    [activePageId, applyCommands, imageEdit, runtime, t],
  );

  const runSelectedImageEdit = useCallback(
    (
      edit:
        | { action: "remove-background" }
        | {
            action: "prompt-edit";
            prompt: string;
            reference?: DesignAsset;
          },
    ) => {
      const selected = runtime.getSnapshot().state.selection.nodeIds;
      if (selected.length === 1) void runImageEdit(selected[0], edit);
    },
    [runImageEdit, runtime],
  );

  const selectImageEditReference = useCallback(async () => {
    try {
      const selection = await window.desktop?.selectDesignImage();
      return selection?.asset ?? null;
    } catch {
      setEditorError(t("error.selectImageEditReference"));
      return null;
    }
  }, [t]);

  const cancelSelectedImageEdit = useCallback(() => {
    if (!imageEdit || imageEdit.status === "cancelling") return;
    cancelledImageEditRequestIds.current.add(imageEdit.requestId);
    setImageEdit({ ...imageEdit, status: "cancelling" });
    void window.desktop
      ?.cancelDesignImageEdit({ requestId: imageEdit.requestId })
      .catch(() => undefined);
  }, [imageEdit]);

  const switchSelectedImageSource = useCallback(
    (nodeId: string, assetId: string, expectedAssetId: string) => {
      const current = runtime.getSnapshot();
      const plan = planImageNodeUpdate(current.document, {
        action: "switch-source",
        pageId: activePageId,
        nodeId,
        expectedAssetId,
        assetId,
      });
      if (!plan.ok) {
        if (plan.code !== "no-op") setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.switchImageSource"), plan.commands);
    },
    [activePageId, applyCommands, runtime, setEditorError, t],
  );

  const updateSelectedImageFilters = useCallback(
    (filters: ImageFilters) => {
      const current = runtime.getSnapshot();
      const selected = current.state.selection.nodeIds;
      const nodeId = selected.length === 1 ? selected[0] : undefined;
      if (!nodeId) return;
      const plan = planImageNodeUpdate(current.document, {
        action: "set-filters",
        pageId: activePageId,
        nodeId,
        filters,
      });
      if (!plan.ok) {
        if (plan.code !== "no-op") setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.adjustImage"), plan.commands);
    },
    [activePageId, applyCommands, runtime, setEditorError, t],
  );

  const updateSelectedImagePlacement = useCallback(
    (placement: ImagePlacement) => {
      const current = runtime.getSnapshot();
      const selected = current.state.selection.nodeIds;
      const nodeId = selected.length === 1 ? selected[0] : undefined;
      if (!nodeId) return;
      const plan = planImageNodeUpdate(current.document, {
        action: "set-placement",
        pageId: activePageId,
        nodeId,
        placement,
      });
      if (!plan.ok) {
        if (plan.code !== "no-op") setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.updateImagePlacement"), plan.commands);
    },
    [activePageId, applyCommands, runtime, setEditorError, t],
  );

  const updateImagePaintFilters = useCallback(
    (
      nodeId: string,
      paintField: "fills" | "strokes",
      paintIndex: number,
      expectedPaint: ImagePaint,
      filters: ImageFilters,
    ) => {
      const current = runtime.getSnapshot();
      const plan = planImagePaintFilterUpdate(current.document, {
        pageId: activePageId,
        nodeId,
        paintField,
        paintIndex,
        expectedPaint,
        filters,
      });
      if (!plan.ok) {
        if (plan.code !== "no-op") setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.adjustImage"), plan.commands);
    },
    [activePageId, applyCommands, runtime, setEditorError, t],
  );

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

  const changeZoom = useCallback(
    (zoom: number) => {
      const viewport = runtime.getSnapshot().state.viewport;
      const nextZoom = Math.min(8, Math.max(0.1, zoom));
      const anchor = { x: viewport.width / 2, y: viewport.height / 2 };
      const documentAnchor = screenToDocument(anchor, viewport);
      runtime.setViewport({
        zoom: nextZoom,
        panX: anchor.x - documentAnchor.x * nextZoom,
        panY: anchor.y - documentAnchor.y * nextZoom,
      });
    },
    [runtime],
  );

  const fitCanvas = useCallback(
    (target: "page" | "selection") => {
      const current = runtime.getSnapshot();
      const bounds =
        target === "selection"
          ? getSelectionBounds(
              current.document,
              current.state.selection.nodeIds,
            )
          : pageBounds(current.document, activePageId);
      if (!bounds) return;
      const { width, height } = current.state.viewport;
      if (width <= 0 || height <= 0) return;
      const padding = 64;
      const zoom = Math.min(
        8,
        Math.max(
          0.1,
          Math.min(
            (width - padding * 2) / Math.max(bounds.width, 1),
            (height - padding * 2) / Math.max(bounds.height, 1),
          ),
        ),
      );
      runtime.setViewport({
        zoom,
        panX: width / 2 - (bounds.x + bounds.width / 2) * zoom,
        panY: height / 2 - (bounds.y + bounds.height / 2) * zoom,
      });
    },
    [activePageId, runtime],
  );

  const toggleLeftPanel = useCallback(() => {
    setLeftPanelVisible((current) => {
      const next = !current;
      persistPanelVisibility("navigator", next);
      return next;
    });
  }, []);

  const toggleUtilityPanel = useCallback(() => {
    setUtilityPanelVisible((current) => {
      const next = !current;
      persistPanelVisibility("utility", next);
      return next;
    });
  }, []);

  const showUtilityTab = useCallback((tab: UtilityDockTab) => {
    setUtilityTab(tab);
    setUtilityPanelVisible(true);
    persistPanelVisibility("utility", true);
  }, []);

  const resizeLeftPanel = useCallback((width: number) => {
    setLeftWidth(width);
    persistPanelWidth("navigator", width);
  }, []);

  const resizeUtilityPanel = useCallback((width: number) => {
    setUtilityWidth(width);
    persistPanelWidth("utility", width);
  }, []);

  useEffect(() => {
    let previousWidth = Number.POSITIVE_INFINITY;
    const prioritizeCanvas = () => {
      const width = window.innerWidth;
      if (
        previousWidth > NAVIGATOR_AUTO_COLLAPSE_WIDTH &&
        width <= NAVIGATOR_AUTO_COLLAPSE_WIDTH
      ) {
        setLeftPanelVisible(false);
      }
      if (
        previousWidth > UTILITY_AUTO_COLLAPSE_WIDTH &&
        width <= UTILITY_AUTO_COLLAPSE_WIDTH
      ) {
        setUtilityPanelVisible(false);
      }
      previousWidth = width;
    };
    prioritizeCanvas();
    window.addEventListener("resize", prioritizeCanvas);
    return () => window.removeEventListener("resize", prioritizeCanvas);
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (
        view === "editor" &&
        modifier &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyR"
      ) {
        event.preventDefault();
        if (!isEditableTarget(event.target) && canRenameSelection) {
          openRenameLayers();
        }
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (event.key === "Escape" && state.selection.nodeIds.length > 0) {
        event.preventDefault();
        runtime.setSelection([]);
        return;
      }
      if (
        modifier &&
        event.shiftKey &&
        !event.altKey &&
        (event.code === "Digit1" || event.code === "Digit2")
      ) {
        event.preventDefault();
        if (event.code === "Digit1") toggleLeftPanel();
        else toggleUtilityPanel();
        return;
      }
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) runtime.redo();
        else runtime.undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectionAction();
        return;
      }
      if (modifier && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      const maskShortcut =
        event.code === "KeyM" &&
        !event.shiftKey &&
        (platform === "darwin"
          ? event.metaKey && event.ctrlKey && !event.altKey
          : event.ctrlKey && event.altKey && !event.metaKey);
      if (maskShortcut) {
        event.preventDefault();
        if (canToggleMaskSelection) toggleMaskSelection();
        return;
      }
      if (
        modifier &&
        event.shiftKey &&
        !event.altKey &&
        (event.code === "KeyL" || event.code === "KeyH")
      ) {
        event.preventDefault();
        toggleSelectedLayerState(event.code === "KeyL" ? "locked" : "visible");
        return;
      }
      const booleanShortcut =
        (
          {
            KeyU: "union",
            KeyS: "subtract",
            KeyI: "intersect",
            KeyE: "exclude",
          } as const
        )[event.code as "KeyU" | "KeyS" | "KeyI" | "KeyE"] ??
        (
          {
            u: "union",
            s: "subtract",
            i: "intersect",
            e: "exclude",
          } as const
        )[event.key.toLowerCase() as "u" | "s" | "i" | "e"];
      if (
        booleanShortcut &&
        event.altKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        applyBooleanOperation(booleanShortcut);
        return;
      }
      const bracket =
        event.code === "BracketRight" || event.key === "]" || event.key === "}"
          ? "right"
          : event.code === "BracketLeft" ||
              event.key === "[" ||
              event.key === "{"
            ? "left"
            : null;
      if (
        modifier &&
        bracket &&
        (platform === "darwin" ? !event.shiftKey : !event.altKey)
      ) {
        event.preventDefault();
        const terminal = platform === "darwin" ? event.altKey : event.shiftKey;
        reorderSelection(
          bracket === "right"
            ? terminal
              ? "bring-to-front"
              : "bring-forward"
            : terminal
              ? "send-to-back"
              : "send-backward",
        );
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        canDeleteSelection
      ) {
        event.preventDefault();
        deleteNodes(state.selection.nodeIds);
        return;
      }
      if (event.shiftKey && (event.key === "1" || event.key === "2")) {
        event.preventDefault();
        fitCanvas(event.key === "1" ? "page" : "selection");
        return;
      }
      if (modifier && ["=", "+", "-", "0"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "0") changeZoom(1);
        else {
          const zoom = runtime.getSnapshot().state.viewport.zoom;
          changeZoom(zoom * (event.key === "-" ? 0.9 : 1.1));
        }
        return;
      }
      const tools: Record<string, Tool> = {
        v: "select",
        f: "frame",
        r: "rectangle",
        o: "ellipse",
        l: event.shiftKey ? "arrow" : "line",
        p: "pen",
        t: "text",
      };
      const next = tools[event.key.toLowerCase()];
      if (next && !modifier && !event.altKey) runtime.setTool(next);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    canDeleteSelection,
    canRenameSelection,
    canToggleMaskSelection,
    changeZoom,
    applyBooleanOperation,
    deleteNodes,
    duplicateSelectionAction,
    fitCanvas,
    groupSelection,
    openRenameLayers,
    platform,
    reorderSelection,
    runtime,
    state.selection.nodeIds,
    toggleLeftPanel,
    toggleMaskSelection,
    toggleSelectedLayerState,
    toggleUtilityPanel,
    ungroupSelection,
    view,
  ]);

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

  const activateDesignFile = useCallback(
    (projectId: string, designFileId: string) => {
      activateFile(projectId, designFileId);
      setActiveProject(projectsById[projectId] ?? null);
    },
    [activateFile, projectsById],
  );

  const refreshRecentProjects = useCallback(async () => {
    const projects = await window.desktop?.listRecentProjects();
    if (projects) setRecentProjects(projects);
  }, []);

  const refreshGlobalTasks = useCallback(async () => {
    const tasks = await window.desktop?.listGlobalTasks();
    if (tasks) setGlobalTasks(tasks);
  }, []);

  const showProject = useCallback(
    (manifest: ProjectManifest, preferredConversationId?: string) => {
      setProjectsById((projects) => ({
        ...projects,
        [manifest.projectId]: manifest,
      }));
      setActiveProject(manifest);
      setWorkspaceError(null);
      setView("project");
      const conversationId =
        preferredConversationId ??
        conversations.find(
          (conversation) =>
            conversation.lifecycle === "active" &&
            conversation.filedProjectId === manifest.projectId,
        )?.conversationId;
      if (conversationId) {
        setActiveConversationId(conversationId);
        void requestConversationHistory(conversationId);
      }
    },
    [conversations, requestConversationHistory],
  );

  const createProject = useCallback(
    async (name: string) => {
      if (!window.desktop) return false;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const manifest = await window.desktop.createProject({
          projectId: createProjectId(),
          name: name.trim(),
        });
        if (!manifest) return false;
        showProject(manifest);
        await refreshRecentProjects();
        return true;
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "project_create_failed",
            error,
            t("error.createProject"),
          ),
        );
        return false;
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [refreshRecentProjects, showProject, t],
  );

  const openProject = useCallback(async () => {
    if (!window.desktop) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const manifest = await window.desktop.openProject();
      if (!manifest) return;
      showProject(manifest);
      await refreshRecentProjects();
    } catch (error) {
      setWorkspaceError(
        reportRendererError(
          "project_open_failed",
          error,
          t("error.openProject"),
        ),
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }, [refreshRecentProjects, showProject, t]);

  const openRecentProject = useCallback(
    async (projectId: string) => {
      if (!window.desktop) return;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const manifest = await window.desktop.openRecentProject({ projectId });
        showProject(manifest);
        await refreshRecentProjects();
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "recent_project_open_failed",
            error,
            t("error.reopenProject"),
            { projectId },
          ),
        );
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [refreshRecentProjects, showProject, t],
  );

  const removeRecentProject = useCallback(
    async (projectId: string) => {
      if (!window.desktop) return false;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const projects = await window.desktop.removeRecentProject({
          projectId,
        });
        setRecentProjects(projects);
        return true;
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "recent_project_remove_failed",
            error,
            t("error.removeProject"),
            { projectId },
          ),
        );
        return false;
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [t],
  );

  const revealRecentProject = useCallback(
    (projectId: string) => {
      setWorkspaceError(null);
      void window.desktop
        ?.revealRecentProject({ projectId })
        .catch((error: unknown) => {
          setWorkspaceError(
            reportRendererError(
              "recent_project_reveal_failed",
              error,
              t("error.revealProject"),
              { projectId },
            ),
          );
        });
    },
    [t],
  );

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
        setActiveConversationId(conversation.conversationId);
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
    [activeProject, requestConversationHistory, t],
  );

  const requestDeleteConversation = useCallback((conversationId: string) => {
    setConversationDeletionError(null);
    setPendingConversationDeletionId(conversationId);
  }, []);

  const cancelDeleteConversation = useCallback(() => {
    if (conversationDeletionBusy) return;
    setConversationDeletionError(null);
    setPendingConversationDeletionId(null);
  }, [conversationDeletionBusy]);

  const openProjectTarget = useCallback(
    async (target: {
      projectId: string;
      designFileId: string;
      pageId?: string;
    }) => {
      const desktop = window.desktop;
      if (!desktop) throw new Error("Desktop Project services are unavailable");
      const manifest =
        projectsById[target.projectId] ??
        (activeProject?.projectId === target.projectId
          ? activeProject
          : await desktop.openRecentProject({ projectId: target.projectId }));
      const file = await desktop.readProjectDesignFile({
        projectId: target.projectId,
        designFileId: target.designFileId,
      });
      const identity = {
        projectId: target.projectId,
        designFileId: file.descriptor.designFileId,
        name: file.descriptor.name,
      };
      let openedRuntime;
      if (
        workspaceSnapshot.openFileKeys.length === 1 &&
        workspaceSnapshot.activeProjectId === LOCAL_PROJECT_ID &&
        !runtime.getSnapshot().state.dirty
      ) {
        openedRuntime = workspace.replaceActiveFile(identity, file.document);
      } else {
        openedRuntime = openFile(identity, file.document);
      }
      projectAutosave.track({
        projectId: identity.projectId,
        designFileId: identity.designFileId,
        documentId: file.document.documentId,
        runtime: openedRuntime,
      });
      setProjectsById((projects) => ({
        ...projects,
        [manifest.projectId]: manifest,
      }));
      setActiveProject(manifest);
      setFileName(file.descriptor.name);
      if (target.pageId && file.document.pagesById[target.pageId]) {
        activatePage(target.pageId);
      }
      setUtilityTab("agent");
      setUtilityPanelVisible(true);
      setConversationOpenIssue(null);
      setView("editor");
    },
    [
      activatePage,
      activeProject,
      openFile,
      projectAutosave,
      projectsById,
      runtime,
      workspace,
      workspaceSnapshot.activeProjectId,
      workspaceSnapshot.openFileKeys.length,
    ],
  );

  const openConversation = useCallback(
    async (conversation: ConversationDescriptor) => {
      if (!window.desktop || conversation.lifecycle !== "active") return;
      setActiveConversationId(conversation.conversationId);
      void requestConversationHistory(conversation.conversationId);
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const context = await window.desktop.resolveConversationOpenContext({
          conversationId: conversation.conversationId,
        });
        if (context.kind === "target-unavailable") {
          setConversationOpenIssue(context.reason);
          setView("conversation");
          return;
        }
        await openProjectTarget(context.target);
        await refreshRecentProjects();
      } catch (error) {
        setConversationOpenIssue("project-unavailable");
        setView("conversation");
        setWorkspaceError(
          reportRendererError(
            "conversation_open_failed",
            error,
            t("error.openConversation"),
            {
              conversationId: conversation.conversationId,
            },
          ),
        );
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [openProjectTarget, refreshRecentProjects, requestConversationHistory, t],
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
        setAgentByConversationId((current) => {
          const remaining = { ...current };
          delete remaining[conversationId];
          return remaining;
        });
        setActiveConversationId((current) =>
          current === conversationId
            ? (replacement?.conversationId ?? null)
            : current,
        );
        if (
          activeConversationId === conversationId &&
          view === "conversation"
        ) {
          setConversationOpenIssue(null);
          setView("workspace");
        }
        const pendingSync = historySyncTimers.current.get(conversationId);
        if (pendingSync !== undefined) clearTimeout(pendingSync);
        historySyncTimers.current.delete(conversationId);
        const historyRequestId =
          latestHistoryRequestId.current.get(conversationId);
        if (historyRequestId) {
          conversationIdByHistoryRequestId.current.delete(historyRequestId);
        }
        latestHistoryRequestId.current.delete(conversationId);
        for (const [
          runId,
          mappedConversationId,
        ] of conversationIdByRunId.current) {
          if (mappedConversationId === conversationId) {
            conversationIdByRunId.current.delete(runId);
          }
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
    [activeConversationId, conversations, requestConversationHistory, t, view],
  );

  const openGlobalTask = useCallback(
    async (task: GlobalTaskProjection) => {
      if (!window.desktop) return;
      setActiveConversationId(task.conversationId);
      void requestConversationHistory(task.conversationId);
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        await openProjectTarget(task.targetSet.primaryTarget);
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
    [openProjectTarget, refreshRecentProjects, requestConversationHistory, t],
  );

  const renameProjectDesignFile = useCallback(
    async (projectId: string, designFileId: string, nextName: string) => {
      const desktop = window.desktop;
      const targetProject = projectsById[projectId];
      const targetFile = Object.values(workspaceSnapshot.files).find(
        (file) =>
          file.projectId === projectId && file.designFileId === designFileId,
      );
      if (!desktop || !targetProject || !targetFile) return false;
      const name = nextName.trim();
      if (name.length === 0 || name.length > 256) return false;
      setEditorError(null);
      try {
        const descriptor = await desktop.renameProjectDesignFile({
          projectId,
          designFileId,
          name,
        });
        if (
          descriptor.designFileId !== designFileId ||
          descriptor.documentId !== targetFile.documentId ||
          descriptor.name !== name
        ) {
          throw new Error(
            "Design file rename response identity does not match",
          );
        }
        const updateManifest = (project: ProjectManifest): ProjectManifest => ({
          ...project,
          updatedAt: descriptor.updatedAt,
          designFiles: project.designFiles.map((file) =>
            file.designFileId === designFileId ? descriptor : file,
          ),
        });
        setProjectsById((projects) => {
          const project = projects[projectId];
          return project
            ? { ...projects, [projectId]: updateManifest(project) }
            : projects;
        });
        setActiveProject((project) =>
          project?.projectId === projectId ? updateManifest(project) : project,
        );
        workspace.renameFile(projectId, designFileId, descriptor.name);
        if (
          workspaceSnapshot.activeProjectId === projectId &&
          workspaceSnapshot.activeDesignFileId === designFileId
        ) {
          setFileName(descriptor.name);
        }
        return true;
      } catch (error) {
        setEditorError(
          reportRendererError(
            "design_file_rename_failed",
            error,
            t("error.renameDesignFile"),
            { projectId, designFileId },
          ),
        );
        return false;
      }
    },
    [projectsById, t, workspace, workspaceSnapshot],
  );

  const openProjectDesignFile = useCallback(
    async (designFileId: string) => {
      if (!activeProject) return;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        await openProjectTarget({
          projectId: activeProject.projectId,
          designFileId,
        });
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "design_file_open_failed",
            error,
            t("error.openDesignFile"),
            { projectId: activeProject.projectId, designFileId },
          ),
        );
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [activeProject, openProjectTarget, t],
  );

  const openDocument = async () => {
    setEditorError(null);
    try {
      const file = await window.desktop?.openDesignFile();
      if (!file) return;
      const value: unknown = JSON.parse(file.contents);
      replaceDocument(value, file.name);
      setActiveProject(null);
      setFileName(file.name);
      setView("editor");
    } catch (error) {
      setEditorError(
        reportRendererError(
          "design_document_open_failed",
          error,
          t("error.openDesignDocument"),
        ),
      );
    }
  };

  const saveDocument = async (saveAs: boolean) => {
    setEditorError(null);
    try {
      const current = runtime.getSnapshot();
      const targetProject =
        projectsById[workspaceSnapshot.activeProjectId] ?? null;
      if (targetProject) {
        const saved = await window.desktop?.saveProjectDesignFile({
          projectId: workspaceSnapshot.activeProjectId,
          designFileId: workspaceSnapshot.activeDesignFileId,
          document: current.document,
        });
        if (!saved) return;
        const updatedProject = {
          ...targetProject,
          updatedAt: saved.descriptor.updatedAt,
          designFiles: targetProject.designFiles.map((file) =>
            file.designFileId === saved.descriptor.designFileId
              ? saved.descriptor
              : file,
          ),
        };
        setProjectsById((projects) => ({
          ...projects,
          [updatedProject.projectId]: updatedProject,
        }));
        setActiveProject((project) =>
          project?.projectId === updatedProject.projectId
            ? updatedProject
            : project,
        );
        runtime.checkpoint(t("history.saved", { name: saved.descriptor.name }));
        return;
      }

      const result = await window.desktop?.saveDesignFile({
        suggestedName: fileName,
        contents: JSON.stringify(current.document, null, 2),
        ...(saveAs ? { saveAs: true } : {}),
      });
      if (!result) return;
      setFileName(result.name);
      workspace.renameFile(
        workspaceSnapshot.activeProjectId,
        workspaceSnapshot.activeDesignFileId,
        result.name,
      );
      runtime.checkpoint(t("history.saved", { name: result.name }));
    } catch (error) {
      setEditorError(
        reportRendererError(
          "design_document_save_failed",
          error,
          t("error.saveDesignDocument"),
          {
            projectId: workspaceSnapshot.activeProjectId,
            designFileId: workspaceSnapshot.activeDesignFileId,
          },
        ),
      );
    }
  };

  const submitAgentTask = async (
    prompt: string,
    modelSelection: ModelSelection,
    attachments: readonly AgentAttachment[],
  ) => {
    if (
      !window.desktop ||
      !activeConversation ||
      activeAgentState.activeRunId
    ) {
      return false;
    }
    const current = runtime.getSnapshot();
    const runId = `run_${Date.now()}_${++runCounter.current}`;
    const conversationId = activeConversation.conversationId;
    const activeFile = workspaceSnapshot.files[workspaceSnapshot.activeFileKey];
    if (!activeFile) return false;
    const createdAt = new Date().toISOString();
    const request: AgentRequest = {
      type: "run.start",
      runId,
      sessionId: conversationId,
      prompt,
      ...(attachments.length === 0
        ? {}
        : {
            attachments: attachments.map((attachment) => ({ ...attachment })),
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
      updateConversationAgentState(currentState, conversationId, (previous) => {
        const maximumSequence = previous.timeline.reduce(
          (maximum, item) => Math.max(maximum, item.sequence),
          0,
        );
        const optimisticMessage: SessionTimelineItem = {
          itemId: `message:${runId}_user`,
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
      }),
    );
    try {
      await window.desktop.sendAgentRequest(request);
      setConversations((current) =>
        touchConversationList(current, conversationId, createdAt),
      );
      void refreshGlobalTasks();
      return true;
    } catch (error) {
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
            activeRunId:
              previous.activeRunId === runId ? null : previous.activeRunId,
            error: reportRendererError(
              "agent_request_failed",
              error,
              t("error.agentRuntime"),
              { conversationId, runId },
            ),
          }),
        ),
      );
      return false;
    }
  };

  const stopAgentTask = async () => {
    const runId = activeAgentState.activeRunId;
    if (!runId || !activeConversation || !window.desktop) return false;
    const conversationId = activeConversation.conversationId;
    try {
      await window.desktop.sendAgentRequest({ type: "run.cancel", runId });
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
  };

  const resolveAgentApproval = async (resolution: {
    runId: string;
    toolCallId: string;
    approvalId: string;
    decision: "allow_once" | "deny";
  }) => {
    if (!window.desktop) return false;
    const conversationId = conversationIdByRunId.current.get(resolution.runId);
    if (!conversationId) return false;
    try {
      await window.desktop.sendAgentRequest({
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
  };

  const dismissDiagnostic = useCallback((eventId: string) => {
    setDiagnosticEvents((current) =>
      current.filter((event) => event.eventId !== eventId),
    );
  }, []);

  const notifications = (
    <DiagnosticNotifications
      events={diagnosticEvents}
      onDismiss={dismissDiagnostic}
      placement={view === "editor" ? "editor" : "window"}
    />
  );
  const pendingConversationDeletion =
    conversations.find(
      (conversation) =>
        conversation.conversationId === pendingConversationDeletionId,
    ) ?? null;
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
                  return (
                    imageCropController.current?.(selectedNode.id) ?? false
                  );
                }}
                onSelectImageArea={() => {
                  if (selectedNode?.kind !== "image") return false;
                  const started =
                    imageAreaSelectionController.current?.(selectedNode.id) ??
                    false;
                  if (!started) {
                    setEditorError(t("error.imageAreaSelectionUnavailable"));
                  }
                  return started;
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

function pageBounds(document: DesignDocument, pageId: string) {
  const page = document.pagesById[pageId];
  if (!page) return null;
  const bounds = page.rootNodeIds
    .map((nodeId) => getNodeBounds(document, nodeId))
    .filter((value): value is NonNullable<typeof value> => value !== null);
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map((rect) => rect.x));
  const minY = Math.min(...bounds.map((rect) => rect.y));
  const maxX = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...bounds.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function selectionScope(
  snapshot: ReturnType<typeof useEditorSnapshot>,
  pageId: string,
): SelectionScope {
  const { selection } = snapshot.state;
  if (selection.nodeIds.length > 0) {
    return {
      kind: "selection",
      selectedNodeIds: [...selection.nodeIds],
      ...(selection.anchorNodeId
        ? { primaryNodeId: selection.anchorNodeId }
        : {}),
      ...(pageId ? { pageId } : {}),
    };
  }
  if (pageId) {
    return { kind: "page", pageId, selectedNodeIds: [] };
  }
  return { kind: "document", selectedNodeIds: [] };
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest(
          '[role="combobox"], [role="listbox"], [role="option"]',
        ) !== null))
  );
}

function createProjectId() {
  return `project_${crypto.randomUUID().replaceAll("-", "")}`;
}

function createConversationId() {
  return `conversation_${crypto.randomUUID().replaceAll("-", "")}`;
}

function updateConversationAgentState(
  current: Readonly<Record<string, ConversationAgentState>>,
  conversationId: string,
  update: (state: ConversationAgentState) => ConversationAgentState,
): Readonly<Record<string, ConversationAgentState>> {
  return {
    ...current,
    [conversationId]: update(current[conversationId] ?? EMPTY_AGENT_STATE),
  };
}

function touchConversationList(
  current: ConversationDescriptor[],
  conversationId: string,
  updatedAt: string,
): ConversationDescriptor[] {
  const conversation = current.find(
    (candidate) => candidate.conversationId === conversationId,
  );
  if (!conversation || conversation.updatedAt >= updatedAt) return current;
  return current
    .map((candidate) =>
      candidate.conversationId === conversationId
        ? { ...candidate, updatedAt }
        : candidate,
    )
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.conversationId.localeCompare(right.conversationId),
    );
}

function appendLiveAgentEvent(
  events: readonly AgentEvent[],
  event: AgentEvent,
): AgentEvent[] {
  if (event.type === "message.delta") {
    const index = events.findIndex(
      (candidate) =>
        candidate.type === "message.delta" &&
        candidate.runId === event.runId &&
        candidate.messageId === event.messageId &&
        candidate.blockId === event.blockId,
    );
    if (index >= 0) {
      return events.map((candidate, candidateIndex) =>
        candidateIndex === index && candidate.type === "message.delta"
          ? { ...candidate, delta: `${candidate.delta}${event.delta}` }
          : candidate,
      );
    }
  }
  if (event.type === "tool.progress") {
    return [
      ...events.filter(
        (candidate) =>
          candidate.type !== "tool.progress" ||
          candidate.toolCallId !== event.toolCallId,
      ),
      event,
    ];
  }
  if (event.type === "message.completed") {
    return [
      ...events.filter(
        (candidate) =>
          !(
            candidate.type === "message.delta" &&
            candidate.runId === event.runId &&
            candidate.messageId === event.messageId
          ),
      ),
      event,
    ];
  }
  if (event.type === "tool.completed" || event.type === "tool.failed") {
    return [
      ...events.filter(
        (candidate) =>
          candidate.type !== "tool.progress" ||
          candidate.toolCallId !== event.toolCallId,
      ),
      event,
    ];
  }
  return [...events, event];
}

function pruneLiveEventsCoveredByTimeline(
  events: readonly AgentEvent[],
  timeline: readonly SessionTimelineItem[],
  activeRunId: string | null,
): AgentEvent[] {
  const durableMessages = new Set(
    timeline.flatMap((item) =>
      item.type === "assistant.message" ? [item.messageId] : [],
    ),
  );
  const durableTools = new Map(
    timeline.flatMap((item) =>
      item.type === "tool" ? [[item.toolCallId, item.status] as const] : [],
    ),
  );
  const durableApprovals = new Map(
    timeline.flatMap((item) =>
      item.type === "approval" ? [[item.approvalId, item.status] as const] : [],
    ),
  );
  const durableRuns = new Map(
    timeline.flatMap((item) =>
      item.type === "run" ? [[item.runId, item.status] as const] : [],
    ),
  );
  return events.filter((event) => {
    if ("runId" in event && event.runId !== activeRunId) return false;
    if (
      (event.type === "message.delta" || event.type === "message.completed") &&
      durableMessages.has(event.messageId)
    ) {
      return false;
    }
    if (
      event.type === "tool.requested" ||
      event.type === "tool.progress" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed"
    ) {
      const status = durableTools.get(event.toolCallId);
      if (status === "completed" || status === "failed") return false;
    }
    if (event.type === "approval.requested") {
      return !durableApprovals.has(event.approvalId);
    }
    if (event.type === "approval.resolved") {
      return durableApprovals.get(event.approvalId) !== "resolved";
    }
    if (event.type === "run.started") {
      return !durableRuns.has(event.runId);
    }
    if (event.type === "run.completed") {
      const status = durableRuns.get(event.runId);
      return status === undefined || status === "started";
    }
    return true;
  });
}

function isDurableAgentCheckpoint(event: AgentEvent): boolean {
  return (
    event.type === "run.started" ||
    event.type === "message.completed" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "approval.requested" ||
    event.type === "approval.resolved"
  );
}

function agentEventActivityAt(event: AgentEvent): string | null {
  if (event.type === "run.started") return event.startedAt;
  if (event.type === "run.completed") return event.finishedAt;
  if (
    event.type === "message.completed" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "agent.error"
  ) {
    return new Date().toISOString();
  }
  return null;
}
