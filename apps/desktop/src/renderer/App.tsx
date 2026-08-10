import type {
  AgentAttachment,
  AgentEvent,
  AgentRequest,
  SelectionScope,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import type { ModelSelection } from "@opendesign/model-gateway";
import type {
  DesignDocument,
  DesignOperation,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";
import {
  canGroupNodes,
  canReorderNodes,
  canUngroupNode,
  getArrangementSelectionMetrics,
  getNodeBounds,
  getSelectionBounds,
  getWorldTransform,
  invertTransform,
  planArrangeNodes,
  planGroupNodes,
  planReparentNodes,
  planReorderNodes,
  planUngroupNode,
  screenToDocument,
  type ArrangeOperation,
  type LayerOrderAction,
} from "@opendesign/editor-runtime";
import type {
  ConversationDescriptor,
  GlobalTaskProjection,
  ProjectManifest,
} from "@opendesign/workspace-contracts";
import { ResizeHandle } from "@opendesign/ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  DiagnosticContext,
  DiagnosticEvent,
  RecentProject,
  ThemePreference,
} from "../shared/desktop-api";
import type { MessageKey } from "../shared/i18n/messages";
import { AgentTimeline } from "./components/AgentTimeline";
import { Canvas, type CanvasPreviewCapture } from "./components/Canvas";
import { DiagnosticNotifications } from "./components/DiagnosticNotifications";
import { DesignFileTabs } from "./components/DesignFileTabs";
import {
  LeftSidebar,
  type LayerReparentRequest,
  type LayerReparentResult,
} from "./components/LeftSidebar";
import { ProjectHome } from "./components/ProjectHome";
import { SettingsPage } from "./components/SettingsPage";
import {
  PropertiesPanel,
  type UpdatePropertiesPatch,
} from "./components/PropertiesPanel";
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
import { executeDesignToolRequest } from "./design-tool-execution";
import { isTool, type SidebarTab, type Tool } from "./state/editor";

const LAYER_ORDER_ACTIONS: readonly LayerOrderAction[] = [
  "bring-forward",
  "bring-to-front",
  "send-backward",
  "send-to-back",
];

const LAYER_ORDER_HISTORY_KEYS: Record<LayerOrderAction, MessageKey> = {
  "bring-forward": "history.bringForward",
  "bring-to-front": "history.bringToFront",
  "send-backward": "history.sendBackward",
  "send-to-back": "history.sendToBack",
};

type AppView = "workspace" | "project" | "editor" | "settings";

const nodeKindKeys: Record<string, MessageKey> = {
  frame: "node.frame",
  group: "node.group",
  rectangle: "node.rectangle",
  ellipse: "node.ellipse",
  text: "node.text",
  image: "node.image",
  vector: "node.vector",
  path: "node.path",
  instance: "node.instance",
};

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

export function App({ initialView }: { initialView?: AppView } = {}) {
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
  const [leftWidth, setLeftWidth] = useState(236);
  const [utilityWidth, setUtilityWidth] = useState(320);
  const [utilityTab, setUtilityTab] = useState<UtilityDockTab>("agent");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("layers");
  const [conversationsByProjectId, setConversationsByProjectId] = useState<
    Readonly<Record<string, ConversationDescriptor[]>>
  >({});
  const [activeConversationIdByProjectId, setActiveConversationIdByProjectId] =
    useState<Readonly<Record<string, string>>>({});
  const [agentByConversationId, setAgentByConversationId] = useState<
    Readonly<Record<string, ConversationAgentState>>
  >({});
  const [globalTasks, setGlobalTasks] = useState<GlobalTaskProjection[]>([]);
  const [agentRuntimeError, setAgentRuntimeError] = useState<string | null>(
    null,
  );
  const [editorError, setEditorError] = useState<string | null>(null);
  const [diagnosticEvents, setDiagnosticEvents] = useState<DiagnosticEvent[]>(
    [],
  );
  const runCounter = useRef(0);
  const settingsReturnView = useRef<Exclude<AppView, "settings">>("workspace");
  const transactionCounter = useRef(0);
  const conversationIdByRunId = useRef(new Map<string, string>());
  const conversationIdByHistoryRequestId = useRef(new Map<string, string>());
  const latestHistoryRequestId = useRef(new Map<string, string>());
  const designToolControllers = useRef(new Map<string, AbortController>());
  const canvasPreviewCapture = useRef<CanvasPreviewCapture | null>(null);
  const { document: designDocument, state } = snapshot;
  const tool: Tool = isTool(state.tool) ? state.tool : "select";
  const selectedNode =
    state.selection.nodeIds.length === 1
      ? designDocument.nodesById[state.selection.nodeIds[0] ?? ""]
      : undefined;
  const canGroupSelection = canGroupNodes(
    designDocument,
    activePageId,
    state.selection.nodeIds,
  );
  const canUngroupSelection = canUngroupNode(
    designDocument,
    activePageId,
    state.selection.nodeIds,
  );
  const layerOrderAvailability = Object.fromEntries(
    LAYER_ORDER_ACTIONS.map((action) => [
      action,
      canReorderNodes(
        designDocument,
        activePageId,
        state.selection.nodeIds,
        action,
      ),
    ]),
  ) as Record<LayerOrderAction, boolean>;
  const arrangementMetrics = getArrangementSelectionMetrics(
    designDocument,
    activePageId,
    state.selection.nodeIds,
  );
  const projectConversations = activeProject
    ? (conversationsByProjectId[activeProject.projectId] ?? [])
    : [];
  const activeConversationId = activeProject
    ? (activeConversationIdByProjectId[activeProject.projectId] ?? null)
    : null;
  const activeConversation =
    projectConversations.find(
      (conversation) => conversation.conversationId === activeConversationId,
    ) ?? null;
  const activeAgentState = activeConversation
    ? (agentByConversationId[activeConversation.conversationId] ??
      EMPTY_AGENT_STATE)
    : EMPTY_AGENT_STATE;

  const requestConversationHistory = useCallback(
    async (conversationId: string) => {
      if (!window.desktop) return;
      const requestId = `history_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`;
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
      if (!active || event.presentation !== "toast") return;
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
              events: activeRunId
                ? previous.events.filter(
                    (candidate) =>
                      "runId" in candidate && candidate.runId === activeRunId,
                  )
                : [],
              error: null,
            };
          }),
        );
        return;
      }

      const runId = "runId" in event ? event.runId : undefined;
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
        setConversationsByProjectId((current) =>
          touchConversationCollections(current, conversationId, activityAt),
        );
      }

      if (
        event.type === "run.started" ||
        event.type === "run.completed" ||
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
          events: [...previous.events.slice(-199), event],
          activeRunId:
            event.type === "run.completed" || event.type === "agent.error"
              ? previous.activeRunId === runId
                ? null
                : previous.activeRunId
              : event.type === "run.started"
                ? event.runId
                : previous.activeRunId,
          error: event.type === "agent.error" ? event.message : previous.error,
        })),
      );
      if (event.type === "run.completed" || event.type === "agent.error") {
        if (event.type === "run.completed") {
          void requestConversationHistory(conversationId);
        }
        if (runId) conversationIdByRunId.current.delete(runId);
        if (event.type === "agent.error" && event.requestId) {
          conversationIdByHistoryRequestId.current.delete(event.requestId);
        }
      }
    });
  }, [requestConversationHistory]);

  useEffect(() => {
    const desktop = window.desktop;
    if (
      !desktop ||
      typeof desktop.onDesignToolRequest !== "function" ||
      typeof desktop.resolveDesignToolRequest !== "function"
    ) {
      return;
    }
    const unsubscribeRequest = desktop.onDesignToolRequest((request) => {
      const controller = new AbortController();
      designToolControllers.current.set(request.requestId, controller);
      void Promise.resolve()
        .then(() =>
          executeDesignToolRequest(request, runtime, activePageId, {
            captureCanvas: async () => {
              const capture = canvasPreviewCapture.current;
              if (!capture) throw new Error("Canvas preview is not ready");
              const preview = await capture();
              const selected = await desktop.importAgentAttachments([
                {
                  name: `OpenDesign canvas r${runtime.getSnapshot().document.revision}.jpg`,
                  bytes: preview.bytes,
                },
              ]);
              const attachment = selected[0];
              if (
                !attachment ||
                !attachment.attachmentId.startsWith("image_") ||
                attachment.mimeType !== preview.mimeType
              ) {
                throw new Error("Canvas preview attachment import failed");
              }
              return {
                attachment: {
                  attachmentId: attachment.attachmentId,
                  name: attachment.name,
                  mimeType: attachment.mimeType,
                  byteSize: attachment.byteSize,
                },
                height: preview.height,
                width: preview.width,
              };
            },
            signal: controller.signal,
          }),
        )
        .then(
          (response) => desktop.resolveDesignToolRequest(response),
          (error: unknown) => {
            const message = reportRendererError(
              "design_tool_execution_failed",
              error,
              "Design tool execution failed",
              {
                conversationId: request.context.sessionId,
                runId: request.context.runId,
                requestId: request.requestId,
                toolCallId: request.call.toolCallId,
              },
              "silent",
              "warning",
            );
            return desktop.resolveDesignToolRequest({
              requestId: request.requestId,
              ok: false,
              error: message,
            });
          },
        )
        .finally(() => {
          if (
            designToolControllers.current.get(request.requestId) === controller
          ) {
            designToolControllers.current.delete(request.requestId);
          }
        });
    });
    const unsubscribeCancel = desktop.onDesignToolCancel?.(({ requestId }) => {
      designToolControllers.current.get(requestId)?.abort();
    });
    return () => {
      unsubscribeRequest();
      unsubscribeCancel?.();
      for (const controller of designToolControllers.current.values()) {
        controller.abort();
      }
      designToolControllers.current.clear();
    };
  }, [activePageId, runtime]);

  const applyCommands = useCallback(
    (label: string, commands: DesignOperation[]) => {
      const current = runtime.getSnapshot().document;
      const result = runtime.apply({
        transactionId: `transaction_renderer_${Date.now()}_${++transactionCounter.current}`,
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "local-user" },
        label,
        commands,
      });
      setEditorError(result.ok ? null : result.error.message);
      return result.ok;
    },
    [runtime],
  );

  const updateNode = useCallback(
    (nodeId: string, updates: UpdatePropertiesPatch) => {
      const command: UpdatePropertiesCommand = {
        commandId: `update_${nodeId}`,
        type: "update_properties",
        nodeId,
        ...updates,
      };
      applyCommands(t("history.updateProperties"), [command]);
    },
    [applyCommands, t],
  );

  const deleteNodes = useCallback(
    (nodeIds: readonly string[]) => {
      const current = runtime.getSnapshot();
      const roots = filterTopLevelNodeIds(current.document, nodeIds);
      if (roots.length === 0) return false;
      const deleted = applyCommands(
        t("history.deleteLayers", { count: roots.length }),
        roots.map((nodeId, index) => ({
          commandId: `delete_${nodeId}_${index}`,
          type: "delete_element" as const,
          nodeId,
        })),
      );
      if (deleted) runtime.setSelection([]);
      return deleted;
    },
    [applyCommands, runtime, t],
  );

  const duplicateSelection = useCallback(() => {
    const current = runtime.getSnapshot();
    const duplicated = duplicateNodes(
      current.document,
      activePageId,
      current.state.selection.nodeIds,
      Date.now(),
    );
    if (duplicated.commands.length === 0) return;
    if (
      applyCommands(
        t("history.duplicateLayers", { count: duplicated.rootIds.length }),
        duplicated.commands,
      )
    ) {
      runtime.setSelection(duplicated.rootIds, duplicated.rootIds.at(-1));
    }
  }, [activePageId, applyCommands, runtime, t]);

  const groupSelection = useCallback(() => {
    const current = runtime.getSnapshot();
    const operationId = `group_${Date.now()}_${++transactionCounter.current}`;
    const plan = planGroupNodes(
      current.document,
      activePageId,
      current.state.selection.nodeIds,
      {
        groupId: operationId,
        name: t("canvas.newNode", { kind: t("node.group") }),
        commandPrefix: operationId,
      },
    );
    if (!plan.ok) {
      setEditorError(plan.message);
      return;
    }
    if (applyCommands(t("history.groupLayers"), plan.commands)) {
      runtime.setSelection(plan.selectionNodeIds, plan.selectionNodeIds.at(-1));
    }
  }, [activePageId, applyCommands, runtime, t]);

  const ungroupSelection = useCallback(() => {
    const current = runtime.getSnapshot();
    const groupId = current.state.selection.nodeIds[0];
    if (!groupId) return;
    const operationId = `ungroup_${Date.now()}_${++transactionCounter.current}`;
    const plan = planUngroupNode(
      current.document,
      activePageId,
      groupId,
      operationId,
    );
    if (!plan.ok) {
      setEditorError(plan.message);
      return;
    }
    if (applyCommands(t("history.ungroupLayers"), plan.commands)) {
      runtime.setSelection(plan.selectionNodeIds, plan.selectionNodeIds.at(-1));
    }
  }, [activePageId, applyCommands, runtime, t]);

  const reorderSelection = useCallback(
    (action: LayerOrderAction) => {
      const current = runtime.getSnapshot();
      const operationId = `reorder_${action}_${Date.now()}_${++transactionCounter.current}`;
      const plan = planReorderNodes(
        current.document,
        activePageId,
        current.state.selection.nodeIds,
        action,
        operationId,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      applyCommands(t(LAYER_ORDER_HISTORY_KEYS[action]), plan.commands);
    },
    [activePageId, applyCommands, runtime, t],
  );

  const reparentLayers = useCallback(
    (request: LayerReparentRequest): LayerReparentResult => {
      const current = runtime.getSnapshot();
      const operationId = `reparent_${Date.now()}_${++transactionCounter.current}`;
      const plan = planReparentNodes(
        current.document,
        activePageId,
        request.nodeIds,
        {
          parentId: request.parentId,
          index: request.index,
          commandPrefix: operationId,
        },
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return { ok: false, error: plan.message };
      }
      if (
        !applyCommands(
          t(
            plan.selectionNodeIds.length === 1
              ? "history.reparentLayer"
              : "history.reparentLayers",
            { count: plan.selectionNodeIds.length },
          ),
          plan.commands,
        )
      ) {
        return { ok: false, error: t("sidebar.dropApplyFailed") };
      }
      runtime.setSelection(plan.selectionNodeIds, plan.selectionNodeIds.at(-1));
      return {
        ok: true,
        ...(plan.warnings?.length ? { warning: plan.warnings.join(" ") } : {}),
      };
    },
    [activePageId, applyCommands, runtime, t],
  );

  const arrangeSelection = useCallback(
    (operation: ArrangeOperation) => {
      const current = runtime.getSnapshot();
      const operationId = `arrange_${operation.action}_${Date.now()}_${++transactionCounter.current}`;
      const plan = planArrangeNodes(
        current.document,
        activePageId,
        current.state.selection.nodeIds,
        operation,
        operationId,
      );
      if (!plan.ok) {
        setEditorError(plan.code === "no-op" ? null : plan.message);
        return;
      }
      const historyKey = operation.action.startsWith("align-")
        ? "history.alignLayers"
        : operation.action.startsWith("distribute-")
          ? "history.distributeLayers"
          : "history.setLayerSpacing";
      applyCommands(t(historyKey), plan.commands);
    },
    [activePageId, applyCommands, runtime, t],
  );

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

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) runtime.redo();
        else runtime.undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (modifier && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
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
        state.selection.nodeIds.length > 0
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
        t: "text",
      };
      const next = tools[event.key.toLowerCase()];
      if (next && !modifier && !event.altKey) runtime.setTool(next);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    changeZoom,
    deleteNodes,
    duplicateSelection,
    fitCanvas,
    groupSelection,
    platform,
    reorderSelection,
    runtime,
    state.selection.nodeIds,
    ungroupSelection,
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

  const loadProjectConversations = useCallback(
    async (projectId: string, preferredConversationId?: string) => {
      if (!window.desktop) return;
      try {
        const conversations = await window.desktop.listProjectConversations({
          homeProjectId: projectId,
        });
        setConversationsByProjectId((current) => ({
          ...current,
          [projectId]: conversations,
        }));
        const requestedId =
          preferredConversationId ?? activeConversationIdByProjectId[projectId];
        const selectedId = conversations.some(
          ({ conversationId }) => conversationId === requestedId,
        )
          ? requestedId
          : conversations[0]?.conversationId;
        setActiveConversationIdByProjectId((current) => {
          if (!selectedId) {
            const remaining = { ...current };
            delete remaining[projectId];
            return remaining;
          }
          return { ...current, [projectId]: selectedId };
        });
        if (selectedId) void requestConversationHistory(selectedId);
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "project_conversations_load_failed",
            error,
            t("error.loadProjectConversations"),
            { projectId },
          ),
        );
      }
    },
    [activeConversationIdByProjectId, requestConversationHistory, t],
  );

  const showProject = useCallback(
    (manifest: ProjectManifest, preferredConversationId?: string) => {
      setProjectsById((projects) => ({
        ...projects,
        [manifest.projectId]: manifest,
      }));
      setActiveProject(manifest);
      setWorkspaceError(null);
      setView("project");
      void loadProjectConversations(
        manifest.projectId,
        preferredConversationId,
      );
    },
    [loadProjectConversations],
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
          homeProjectId: activeProject.projectId,
          title: title.trim(),
        });
        setConversationsByProjectId((current) => ({
          ...current,
          [activeProject.projectId]: [
            conversation,
            ...(current[activeProject.projectId] ?? []),
          ],
        }));
        setActiveConversationIdByProjectId((current) => ({
          ...current,
          [activeProject.projectId]: conversation.conversationId,
        }));
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

  const selectConversation = useCallback(
    (conversationId: string) => {
      if (!activeProject) return;
      const exists = (
        conversationsByProjectId[activeProject.projectId] ?? []
      ).some((conversation) => conversation.conversationId === conversationId);
      if (!exists) return;
      setActiveConversationIdByProjectId((current) => ({
        ...current,
        [activeProject.projectId]: conversationId,
      }));
      void requestConversationHistory(conversationId);
    },
    [activeProject, conversationsByProjectId, requestConversationHistory],
  );

  const openGlobalTask = useCallback(
    async (task: GlobalTaskProjection) => {
      if (!window.desktop) return;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const manifest = await window.desktop.openRecentProject({
          projectId: task.homeProjectId,
        });
        showProject(manifest, task.conversationId);
        await refreshRecentProjects();
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "agent_task_open_failed",
            error,
            t("error.openAgentTask"),
            {
              projectId: task.homeProjectId,
              conversationId: task.conversationId,
              runId: task.runId,
            },
          ),
        );
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [refreshRecentProjects, showProject, t],
  );

  const openProjectDesignFile = useCallback(
    async (designFileId: string) => {
      if (!window.desktop || !activeProject) return;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const file = await window.desktop.readProjectDesignFile({
          projectId: activeProject.projectId,
          designFileId,
        });
        const identity = {
          projectId: activeProject.projectId,
          designFileId: file.descriptor.designFileId,
          name: file.descriptor.name,
        };
        if (
          workspaceSnapshot.openFileKeys.length === 1 &&
          workspaceSnapshot.activeProjectId === LOCAL_PROJECT_ID &&
          !runtime.getSnapshot().state.dirty
        ) {
          workspace.replaceActiveFile(identity, file.document);
        } else {
          openFile(identity, file.document);
        }
        setFileName(file.descriptor.name);
        setView("editor");
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
    [activeProject, openFile, runtime, t, workspace, workspaceSnapshot],
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
      mutationTarget: activePageId
        ? { kind: "page", pageId: activePageId }
        : { kind: "document" },
      modelSelection,
    };
    conversationIdByRunId.current.set(runId, conversationId);
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
      setConversationsByProjectId((conversations) =>
        touchConversationCollections(conversations, conversationId, createdAt),
      );
      void refreshGlobalTasks();
      return true;
    } catch (error) {
      conversationIdByRunId.current.delete(runId);
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

  const dismissDiagnostic = useCallback((eventId: string) => {
    setDiagnosticEvents((current) =>
      current.filter((event) => event.eventId !== eventId),
    );
  }, []);

  const notifications = (
    <DiagnosticNotifications
      events={diagnosticEvents}
      onDismiss={dismissDiagnostic}
    />
  );

  if (view === "settings") {
    return (
      <>
        <SettingsPage
          onClose={() => setView(settingsReturnView.current)}
          onThemeChange={changeTheme}
          theme={theme}
        />
        {notifications}
      </>
    );
  }

  if (view === "workspace") {
    return (
      <>
        <WorkspaceHome
          busy={workspaceBusy}
          error={workspaceError}
          globalTasks={globalTasks}
          onCreateProject={createProject}
          onOpenDesignFile={() => void openDocument()}
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
          conversations={projectConversations}
          error={workspaceError}
          manifest={activeProject}
          onBack={() => setView("workspace")}
          onCreateConversation={createConversation}
          onOpenDesignFile={(designFileId) =>
            void openProjectDesignFile(designFileId)
          }
          onSelectConversation={selectConversation}
          onSettings={openSettings}
          onThemeChange={changeTheme}
          platform={platform}
          theme={theme}
        />
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
          dirty={state.dirty}
          documentName={documentName}
          onOpen={activeProject ? undefined : () => void openDocument()}
          onProject={activeProject ? () => setView("project") : undefined}
          onSave={() => void saveDocument(false)}
          onSaveAs={activeProject ? undefined : () => void saveDocument(true)}
          onSettings={openSettings}
          onThemeChange={changeTheme}
          onWorkspace={() => setView("workspace")}
          pageName={pageName}
          platform={platform}
          projectName={activeProject?.name}
          theme={theme}
        />
        <Toolbar
          canHierarchyAction={canUngroupSelection || canGroupSelection}
          canReorder={layerOrderAvailability}
          canDelete={state.selection.nodeIds.length > 0}
          canDuplicate={state.selection.nodeIds.length > 0}
          canRedo={state.history.canRedo}
          canUndo={state.history.canUndo}
          hierarchyAction={selectedNode?.kind === "group" ? "ungroup" : "group"}
          onDelete={() => deleteNodes(state.selection.nodeIds)}
          onDuplicate={duplicateSelection}
          onGroup={groupSelection}
          onReorder={reorderSelection}
          onRedo={() => runtime.redo()}
          onToolChange={(next) => runtime.setTool(next)}
          onUndo={() => runtime.undo()}
          onUngroup={ungroupSelection}
          platform={platform}
          tool={tool}
        />
        <div className="workspace">
          <LeftSidebar
            activePageId={activePageId}
            document={designDocument}
            onPageChange={activatePage}
            onDelete={(nodeId) => deleteNodes([nodeId])}
            onReparent={reparentLayers}
            onSelect={(nodeId) => runtime.setSelection([nodeId], nodeId)}
            onTabChange={setSidebarTab}
            onToggleLock={(nodeId) => {
              const node = designDocument.nodesById[nodeId];
              if (node) updateNode(nodeId, { locked: !node.locked });
            }}
            onToggleVisibility={(nodeId) => {
              const node = designDocument.nodesById[nodeId];
              if (node) updateNode(nodeId, { visible: !node.visible });
            }}
            selectedNodeIds={state.selection.nodeIds}
            tab={sidebarTab}
          />
          <ResizeHandle
            label={t("resize.documentSidebar")}
            max={360}
            min={184}
            onChange={setLeftWidth}
            orientation="vertical"
            value={leftWidth}
          />
          <div className="workspace__center">
            <DesignFileTabs
              onActivate={activateDesignFile}
              snapshot={workspaceSnapshot}
            />
            <Canvas
              activePageId={activePageId}
              captureRef={canvasPreviewCapture}
              onTransactionError={setEditorError}
              runtime={runtime}
              snapshot={snapshot}
            />
          </div>
          <ResizeHandle
            invert
            label={t("resize.utilityDock")}
            max={400}
            min={280}
            onChange={setUtilityWidth}
            orientation="vertical"
            value={utilityWidth}
          />
          <UtilityDock
            activeTab={utilityTab}
            agent={
              <AgentTimeline
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
                onSelectConversation={selectConversation}
                onStop={stopAgentTask}
                onSubmit={submitAgentTask}
                scope={
                  state.selection.nodeIds.length > 0
                    ? {
                        kind: "selection",
                        count: state.selection.nodeIds.length,
                      }
                    : { kind: "page", ...(pageName ? { name: pageName } : {}) }
                }
                timeline={activeAgentState.timeline}
              />
            }
            agentRunning={Boolean(activeAgentState.activeRunId)}
            onTabChange={setUtilityTab}
            properties={
              <PropertiesPanel
                arrangement={arrangementMetrics}
                node={selectedNode}
                onArrange={arrangeSelection}
                onDelete={() => deleteNodes(state.selection.nodeIds)}
                onDuplicate={duplicateSelection}
                onUpdate={(updates) => {
                  if (selectedNode) updateNode(selectedNode.id, updates);
                }}
                selectionCount={state.selection.nodeIds.length}
              />
            }
          />
        </div>
        <footer className="statusbar">
          <span
            className={editorError ? "statusbar__error" : undefined}
            role="status"
          >
            <i />
            {editorError ??
              (state.dirty ? t("title.unsaved") : t("status.allSaved"))}
          </span>
          <span className="statusbar__center">
            {selectedNode
              ? t("status.selectedNode", {
                  name: selectedNode.name,
                  kind: t(nodeKindKeys[selectedNode.kind] ?? "node.frame"),
                })
              : state.selection.nodeIds.length > 1
                ? t("status.layersSelected", {
                    count: state.selection.nodeIds.length,
                  })
                : t("status.revision", { revision: designDocument.revision })}
          </span>
          <span>
            {t("status.canvas")}{" "}
            <button
              aria-label={t("status.fitPage")}
              onClick={() => fitCanvas("page")}
            >
              {t("status.fit")}
            </button>
            {state.selection.nodeIds.length > 0 && (
              <button
                aria-label={t("status.fitSelection")}
                onClick={() => fitCanvas("selection")}
              >
                {t("status.selection")}
              </button>
            )}
            <button
              aria-label={t("status.zoomOut")}
              onClick={() => changeZoom(state.viewport.zoom * 0.9)}
            >
              −
            </button>
            <button
              aria-label={t("status.zoomReset")}
              className="zoom-value"
              onClick={() => changeZoom(1)}
            >
              {Math.round(state.viewport.zoom * 100)}%
            </button>
            <button
              aria-label={t("status.zoomIn")}
              onClick={() => changeZoom(state.viewport.zoom * 1.1)}
            >
              +
            </button>
          </span>
        </footer>
        {notifications}
      </div>
    </>
  );
}

function filterTopLevelNodeIds(
  document: DesignDocument,
  nodeIds: readonly string[],
): string[] {
  const selected = new Set(nodeIds);
  return [...new Set(nodeIds)].filter((nodeId) => {
    if (!document.nodesById[nodeId]) return false;
    let parentId = document.nodesById[nodeId]?.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = document.nodesById[parentId]?.parentId;
    }
    return true;
  });
}

function duplicateNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  seed: number,
): { commands: DesignOperation[]; rootIds: string[] } {
  const roots = filterTopLevelNodeIds(document, nodeIds);
  const idMap = new Map<string, string>();
  let idSequence = 0;
  const collect = (nodeId: string) => {
    if (idMap.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;
    idMap.set(nodeId, `${node.kind}_${seed}_${++idSequence}`);
    node.childIds.forEach(collect);
  };
  roots.forEach(collect);

  const commands: DesignOperation[] = [];
  const appendedByParent = new Map<string, number>();
  const emit = (nodeId: string, root: boolean, childIndex = 0) => {
    const node = document.nodesById[nodeId];
    const nextId = idMap.get(nodeId);
    if (!node || !nextId) return;
    const parentId = idMap.get(node.parentId ?? "") ?? node.parentId;
    const clone = structuredClone(node);
    clone.id = nextId;
    clone.parentId = parentId ?? null;
    clone.childIds = [];
    clone.name = `${node.name} copy`.trim();
    if (root) {
      const delta = documentDeltaToParent(document, node.parentId, {
        x: 24,
        y: 24,
      });
      clone.transform[4] += delta.x;
      clone.transform[5] += delta.y;
    }
    const target = parentId
      ? document.nodesById[parentId]?.childIds
      : document.pagesById[pageId]?.rootNodeIds;
    const parentKey = parentId ?? `page:${pageId}`;
    const appended = appendedByParent.get(parentKey) ?? 0;
    const index = root ? (target?.length ?? 0) + appended : childIndex;
    if (root) appendedByParent.set(parentKey, appended + 1);
    commands.push({
      commandId: `duplicate_${nextId}`,
      type: "insert_element",
      pageId,
      parentId: parentId ?? null,
      index,
      node: clone,
    });
    node.childIds.forEach((childId, index) => emit(childId, false, index));
  };
  roots.forEach((nodeId) => emit(nodeId, true));
  return {
    commands,
    rootIds: roots.flatMap((nodeId) => {
      const nextId = idMap.get(nodeId);
      return nextId ? [nextId] : [];
    }),
  };
}

function documentDeltaToParent(
  document: DesignDocument,
  parentId: string | null,
  delta: { x: number; y: number },
) {
  if (!parentId) return delta;
  const transform = getWorldTransform(document, parentId);
  const inverse = transform ? invertTransform(transform) : null;
  if (!inverse) return delta;
  return {
    x: inverse[0] * delta.x + inverse[2] * delta.y,
    y: inverse[1] * delta.x + inverse[3] * delta.y,
  };
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

function touchConversationCollections(
  current: Readonly<Record<string, ConversationDescriptor[]>>,
  conversationId: string,
  updatedAt: string,
): Readonly<Record<string, ConversationDescriptor[]>> {
  let changed = false;
  const collections = Object.fromEntries(
    Object.entries(current).map(([projectId, conversations]) => {
      const conversation = conversations.find(
        (candidate) => candidate.conversationId === conversationId,
      );
      if (!conversation || conversation.updatedAt >= updatedAt) {
        return [projectId, conversations];
      }
      changed = true;
      return [
        projectId,
        conversations
          .map((candidate) =>
            candidate.conversationId === conversationId
              ? { ...candidate, updatedAt }
              : candidate,
          )
          .sort(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) ||
              left.conversationId.localeCompare(right.conversationId),
          ),
      ];
    }),
  );
  return changed ? collections : current;
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

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
    .trim();
  if (
    !message ||
    /(?:SQLITE_|UNIQUE constraint failed|FOREIGN KEY constraint failed)/i.test(
      message,
    )
  ) {
    return fallback;
  }
  return message;
}

function reportRendererError(
  code: string,
  error: unknown,
  fallback: string,
  context?: DiagnosticContext,
  presentation: "silent" | "toast" = "toast",
  level: "warning" | "error" = "error",
): string {
  const message = errorMessage(error, fallback);
  void window.desktop
    ?.reportDiagnostic?.({
      level,
      presentation,
      code,
      message,
      ...(context ? { context } : {}),
    })
    .catch(() => undefined);
  return message;
}
