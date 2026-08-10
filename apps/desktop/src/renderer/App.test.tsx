import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AgentEvent,
  AgentRequest,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import {
  createEmptyDesignDocument,
  createWelcomeDocument,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import type {
  LeaferEngineCallbacks,
  LeaferEngineSyncInput,
} from "@opendesign/leafer-engine";
import {
  PROJECT_MANIFEST_VERSION,
  type ConversationDescriptor,
  type GlobalTaskLifecycle,
  type GlobalTaskProjection,
  type ProjectManifest,
} from "@opendesign/workspace-contracts";
import { TooltipProvider } from "@opendesign/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  EditorRuntimeProvider,
  useEditorRuntime,
  useEditorSnapshot,
} from "./editor-runtime";
import { I18nProvider } from "./i18n";
import type { RendererDesignToolRequest } from "../shared/design-tool-bridge";

const leaferHarness = vi.hoisted(() => ({
  callbacks: null as LeaferEngineCallbacks | null,
  input: null as LeaferEngineSyncInput | null,
  sync: vi.fn(),
}));

vi.mock("@opendesign/leafer-engine", () => ({
  createLeaferEngineAdapter: vi.fn(
    (host: HTMLElement, callbacks: LeaferEngineCallbacks) => {
      leaferHarness.callbacks = callbacks;
      host.dataset.engine = "leafer";
      const canvas = document.createElement("canvas");
      canvas.className = "leafer-canvas-view";
      host.append(canvas);
      return Promise.resolve({
        dispose: () => canvas.remove(),
        sync: (input: LeaferEngineSyncInput) => {
          leaferHarness.input = input;
          leaferHarness.sync(input);
        },
      });
    },
  ),
}));

let emitAgentEvent: ((event: AgentEvent) => void) | undefined;
let requestOpenSettings: (() => void) | undefined;
let observedRuntime: EditorRuntime | undefined;
let requestDesignTool:
  ((request: RendererDesignToolRequest) => void) | undefined;

beforeEach(() => {
  emitAgentEvent = undefined;
  requestOpenSettings = undefined;
  observedRuntime = undefined;
  requestDesignTool = undefined;
  leaferHarness.callbacks = null;
  leaferHarness.input = null;
  leaferHarness.sync.mockClear();
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    },
    releasePointerCapture: {
      configurable: true,
      value: vi.fn(),
    },
    setPointerCapture: {
      configurable: true,
      value: vi.fn(),
    },
  });
  window.desktop = {
    getPlatformInfo: vi
      .fn()
      .mockResolvedValue({ platform: "darwin", version: "0.0.0" }),
    getPendingDiagnostics: vi.fn().mockResolvedValue([]),
    reportDiagnostic: vi.fn().mockResolvedValue(undefined),
    onDiagnosticEvent: vi.fn().mockReturnValue(() => undefined),
    onOpenSettings: vi.fn().mockImplementation((listener: () => void) => {
      requestOpenSettings = listener;
      return () => undefined;
    }),
    getLocale: vi.fn().mockResolvedValue("en"),
    setLocale: vi.fn().mockImplementation((locale) => Promise.resolve(locale)),
    onLocaleChange: vi.fn().mockReturnValue(() => undefined),
    getTheme: vi.fn().mockResolvedValue("dark"),
    setTheme: vi.fn().mockImplementation((theme) => Promise.resolve(theme)),
    getModelProviderCatalog: vi.fn().mockResolvedValue({
      version: 1,
      providers: [
        {
          providerId: "provider_1",
          name: "Primary",
          enabled: true,
          apiFormat: "openai-responses",
          authMode: "bearer",
          baseUrl: "https://api.openai.com/v1",
          models: [
            {
              modelId: "design-model",
              name: "Design model",
              contextWindow: 200_000,
              maxOutputTokens: 16_384,
              capabilities: {
                toolUse: true,
                imageInput: false,
                reasoning: true,
              },
              reasoningEfforts: ["off", "medium", "high"],
            },
          ],
          hasApiKey: false,
          updatedAt: null,
        },
      ],
      defaultSelection: {
        providerId: "provider_1",
        modelId: "design-model",
        reasoningEffort: "medium",
      },
    }),
    saveModelProviderProfile: vi.fn(),
    deleteModelProviderProfile: vi.fn(),
    testModelProviderConnection: vi.fn(),
    onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
    selectAgentAttachments: vi.fn().mockResolvedValue([]),
    importAgentAttachments: vi.fn().mockResolvedValue([]),
    getAgentAttachmentPreview: vi.fn(),
    onDesignToolRequest: vi
      .fn()
      .mockImplementation(
        (listener: (request: RendererDesignToolRequest) => void) => {
          requestDesignTool = listener;
          return () => undefined;
        },
      ),
    onDesignToolCancel: vi.fn().mockReturnValue(() => undefined),
    resolveDesignToolRequest: vi.fn().mockResolvedValue(undefined),
    windowAction: vi.fn().mockResolvedValue(undefined),
    onNativeThemeChange: vi.fn().mockReturnValue(() => undefined),
    openDesignFile: vi.fn().mockResolvedValue(null),
    saveDesignFile: vi.fn().mockResolvedValue(null),
    createProject: vi.fn().mockResolvedValue(null),
    openProject: vi.fn().mockResolvedValue(null),
    openRecentProject: vi.fn(),
    listRecentProjects: vi.fn().mockResolvedValue([]),
    removeRecentProject: vi.fn().mockResolvedValue([]),
    revealRecentProject: vi.fn().mockResolvedValue(undefined),
    listOpenProjects: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn(),
    listProjectConversations: vi.fn().mockResolvedValue([]),
    listGlobalTasks: vi.fn().mockResolvedValue([]),
    createProjectDesignFile: vi.fn(),
    readProjectDesignFile: vi.fn(),
    saveProjectDesignFile: vi.fn(),
    sendAgentRequest: vi.fn().mockResolvedValue(undefined),
    onAgentEvent: vi
      .fn()
      .mockImplementation((listener: (event: AgentEvent) => void) => {
        emitAgentEvent = listener;
        return () => undefined;
      }),
  };
});

function RuntimeObserver() {
  const { runtime } = useEditorRuntime();
  const snapshot = useEditorSnapshot();
  observedRuntime = runtime;
  return (
    <output
      aria-label="Runtime state"
      data-dirty={String(snapshot.state.dirty)}
      data-revision={snapshot.document.revision}
      data-selection={snapshot.state.selection.nodeIds.join(",")}
      data-tool={snapshot.state.tool}
      data-zoom={snapshot.state.viewport.zoom}
    />
  );
}

function renderApp(initialView: "workspace" | "editor" = "editor") {
  return render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <EditorRuntimeProvider>
          <App initialView={initialView} />
          <RuntimeObserver />
        </EditorRuntimeProvider>
      </I18nProvider>
    </TooltipProvider>,
  );
}

function runtime() {
  if (!observedRuntime) throw new Error("EditorRuntime observer is missing");
  return observedRuntime;
}

function runtimeOutput() {
  return screen.getByLabelText("Runtime state");
}

async function openProjectWithConversations(
  conversations: ConversationDescriptor[],
) {
  const user = userEvent.setup();
  const manifest = projectManifest();
  const descriptor = manifest.designFiles[0];
  if (!descriptor) throw new Error("Mobile design file is missing");
  vi.mocked(window.desktop!.listRecentProjects).mockResolvedValueOnce([
    { projectId: manifest.projectId, name: manifest.name, lastOpenedAt: now },
  ]);
  vi.mocked(window.desktop!.openRecentProject).mockResolvedValueOnce(manifest);
  vi.mocked(window.desktop!.listProjectConversations).mockResolvedValueOnce(
    conversations,
  );
  const document = structuredClone(createWelcomeDocument());
  document.documentId = descriptor.documentId;
  vi.mocked(window.desktop!.readProjectDesignFile).mockResolvedValue({
    descriptor,
    document,
  });
  renderApp("workspace");
  await user.click(await screen.findByRole("button", { name: /^Acme Design/ }));
  return { user, manifest };
}

async function openProjectConversation() {
  const conversation = conversationDescriptor();
  const { user, manifest } = await openProjectWithConversations([conversation]);
  await user.click(await screen.findByRole("button", { name: /Mobile UI/ }));
  return { user, manifest, conversation };
}

const now = "2026-08-07T12:00:00.000Z";

function conversationDescriptor(
  overrides: Partial<ConversationDescriptor> = {},
): ConversationDescriptor {
  return {
    conversationId: "conversation_mobile",
    homeProjectId: "project_acme",
    title: "Refine the mobile experience",
    createdAt: now,
    updatedAt: now,
    lifecycle: "active",
    ...overrides,
  };
}

function projectManifest(): ProjectManifest {
  return {
    manifestVersion: PROJECT_MANIFEST_VERSION,
    projectId: "project_acme",
    name: "Acme Design",
    createdAt: now,
    updatedAt: now,
    lifecycle: "active",
    designFiles: [
      {
        designFileId: "design_mobile",
        documentId: "document_mobile",
        name: "Mobile UI",
        relativePath: "designs/mobile-ui.opendesign",
        createdAt: now,
        updatedAt: now,
        lifecycle: "active",
      },
      {
        designFileId: "design_website",
        documentId: "document_website",
        name: "Website",
        relativePath: "designs/website.opendesign",
        createdAt: now,
        updatedAt: now,
        lifecycle: "active",
      },
    ],
  };
}

function historyRequests(sessionId: string) {
  return vi
    .mocked(window.desktop!.sendAgentRequest)
    .mock.calls.flatMap(
      ([request]): Array<Extract<AgentRequest, { type: "session.history" }>> =>
        request.type === "session.history" && request.sessionId === sessionId
          ? [request]
          : [],
    );
}

function runRequests(sessionId: string) {
  return vi
    .mocked(window.desktop!.sendAgentRequest)
    .mock.calls.flatMap(
      ([request]): Array<Extract<AgentRequest, { type: "run.start" }>> =>
        request.type === "run.start" && request.sessionId === sessionId
          ? [request]
          : [],
    );
}

function historyMessage(
  sessionId: string,
  content: string,
  sequence = 1,
): SessionTimelineItem {
  return {
    itemId: `message:${sessionId}:${sequence}`,
    sessionId,
    sequence,
    createdAt: now,
    updatedAt: now,
    type: "user.message",
    messageId: `message_${sessionId}_${sequence}`,
    content,
    documentId: "document_mobile",
    revision: 0,
    scope: { kind: "document", selectedNodeIds: [] },
  };
}

function globalTask(
  lifecycle: GlobalTaskLifecycle,
  overrides: Partial<GlobalTaskProjection> = {},
): GlobalTaskProjection {
  const runId = overrides.runId ?? `run_${lifecycle}`;
  const conversationId = overrides.conversationId ?? "conversation_mobile";
  const homeProjectId = overrides.homeProjectId ?? "project_acme";
  const primaryTarget = {
    targetId: `target_${runId}`,
    projectId: homeProjectId,
    designFileId: "design_mobile",
    documentId: "document_mobile",
    pageId: "page_welcome",
    selectedNodeIds: [],
    baseRevision: 0,
  };
  return {
    version: 1,
    taskId: `task_${runId}`,
    conversationId,
    homeProjectId,
    runId,
    title: `Task ${lifecycle}`,
    lifecycle,
    targetSet: { targets: [primaryTarget], primaryTarget },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("App", () => {
  it("opens Settings without rebuilding the editor runtime", async () => {
    const user = userEvent.setup();
    renderApp();
    const editorRuntime = runtime();
    editorRuntime.setTool("rectangle");

    const settingsButton = screen.getByRole("button", {
      name: "Open Settings",
    });
    expect(settingsButton).toHaveTextContent("Settings");
    await user.click(settingsButton);
    expect(
      screen.getByRole("heading", { name: "Language and appearance" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "简体中文" }));
    await user.click(await screen.findByRole("button", { name: "关闭设置" }));

    expect(runtime()).toBe(editorRuntime);
    expect(runtimeOutput()).toHaveAttribute("data-tool", "rectangle");
    expect(screen.getByRole("main", { name: "设计画布" })).toBeVisible();
  });

  it("opens Settings from the native application command", () => {
    renderApp("workspace");

    act(() => requestOpenSettings?.());

    expect(
      screen.getByRole("heading", { name: "Language and appearance" }),
    ).toBeVisible();
  });

  it("starts at Workspace Home and opens recent Projects without exposing paths", async () => {
    const user = userEvent.setup();
    const recent = {
      projectId: "project_acme",
      name: "Acme Design",
      lastOpenedAt: "2026-08-07T12:00:00.000Z",
    };
    vi.mocked(window.desktop!.listRecentProjects).mockResolvedValueOnce([
      recent,
    ]);
    vi.mocked(window.desktop!.openRecentProject).mockResolvedValueOnce(
      projectManifest(),
    );

    renderApp("workspace");

    expect(
      screen.getByRole("heading", { name: "Projects and Agent work" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Acme Design")).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "Design canvas" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Acme Design/ }));

    expect(window.desktop?.openRecentProject).toHaveBeenCalledWith({
      projectId: "project_acme",
    });
    expect(
      await screen.findByRole("heading", { name: "Design Files" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Mobile UI/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Website/ })).toBeInTheDocument();
  });

  it("creates and switches durable Project Conversations", async () => {
    const user = userEvent.setup();
    const manifest = projectManifest();
    const existing = conversationDescriptor();
    const created = conversationDescriptor({
      conversationId: "conversation_website",
      title: "Design the website launch",
      updatedAt: "2026-08-07T13:00:00.000Z",
    });
    vi.mocked(window.desktop!.listRecentProjects).mockResolvedValueOnce([
      { projectId: manifest.projectId, name: manifest.name, lastOpenedAt: now },
    ]);
    vi.mocked(window.desktop!.openRecentProject).mockResolvedValueOnce(
      manifest,
    );
    vi.mocked(window.desktop!.listProjectConversations).mockResolvedValueOnce([
      existing,
    ]);
    vi.mocked(window.desktop!.createConversation).mockResolvedValueOnce(
      created,
    );

    renderApp("workspace");
    await user.click(
      await screen.findByRole("button", { name: /^Acme Design/ }),
    );
    expect(window.desktop?.listProjectConversations).toHaveBeenCalledWith({
      homeProjectId: manifest.projectId,
    });
    expect(
      await screen.findByRole("button", {
        name: /Refine the mobile experience/,
      }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Conversation title"),
      "Design the website launch",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(window.desktop?.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        homeProjectId: manifest.projectId,
        title: "Design the website launch",
      }),
    );
    expect(
      await screen.findByRole("button", { name: /Design the website launch/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(window.desktop?.sendAgentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.history",
        sessionId: created.conversationId,
      }),
    );
  });

  it("keeps durable history isolated when switching Conversations", async () => {
    const first = conversationDescriptor({
      conversationId: "conversation_a",
      title: "Conversation A",
    });
    const second = conversationDescriptor({
      conversationId: "conversation_b",
      title: "Conversation B",
    });
    const { user } = await openProjectWithConversations([first, second]);
    const firstHistory = historyRequests(first.conversationId).at(-1);
    if (!firstHistory)
      throw new Error("Conversation A history request is missing");
    act(() => {
      emitAgentEvent?.({
        type: "session.history",
        requestId: firstHistory.requestId,
        sessionId: first.conversationId,
        timeline: [historyMessage(first.conversationId, "History from A")],
      });
    });

    await user.click(screen.getByRole("button", { name: /Mobile UI/ }));
    expect(await screen.findByText("History from A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Acme Design" }));
    await user.click(screen.getByRole("button", { name: /Conversation B/ }));
    const secondHistory = historyRequests(second.conversationId).at(-1);
    if (!secondHistory) {
      throw new Error("Conversation B history request is missing");
    }
    act(() => {
      emitAgentEvent?.({
        type: "session.history",
        requestId: secondHistory.requestId,
        sessionId: second.conversationId,
        timeline: [historyMessage(second.conversationId, "History from B")],
      });
    });
    await user.click(screen.getByRole("button", { name: /Mobile UI/ }));

    expect(await screen.findByText("History from B")).toBeInTheDocument();
    expect(screen.queryByText("History from A")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Acme Design" }));
    await user.click(screen.getByRole("button", { name: /Conversation A/ }));
    await user.click(screen.getByRole("button", { name: /Mobile UI/ }));
    expect(await screen.findByText("History from A")).toBeInTheDocument();
    expect(screen.queryByText("History from B")).not.toBeInTheDocument();
  });

  it("preserves an active Run per Conversation and allows another Conversation to start", async () => {
    const first = conversationDescriptor({
      conversationId: "conversation_a",
      title: "Conversation A",
    });
    const second = conversationDescriptor({
      conversationId: "conversation_b",
      title: "Conversation B",
    });
    const { user } = await openProjectWithConversations([first, second]);
    await user.click(screen.getByRole("button", { name: /Mobile UI/ }));

    await user.type(screen.getByLabelText("Continue the task"), "Run A");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const firstRun = runRequests(first.conversationId).at(-1);
    if (!firstRun) throw new Error("Conversation A run request is missing");
    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: firstRun.runId,
        startedAt: now,
      });
    });

    await user.click(screen.getByRole("button", { name: "Acme Design" }));
    await user.click(screen.getByRole("button", { name: /Conversation B/ }));
    await user.click(screen.getByRole("button", { name: /Mobile UI/ }));
    expect(screen.getByLabelText("Continue the task")).toBeEnabled();

    await user.type(screen.getByLabelText("Continue the task"), "Run B");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(runRequests(second.conversationId)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Acme Design" }));
    await user.click(screen.getByRole("button", { name: /Conversation A/ }));
    await user.click(screen.getByRole("button", { name: /Mobile UI/ }));

    expect(screen.getByText("Request in progress")).toBeInTheDocument();
    const continuation = screen.getByLabelText("Continue the task");
    expect(continuation).toBeEnabled();
    await user.type(continuation, "Continue A after stopping");
    expect(
      screen.queryByRole("button", { name: "Send" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(window.desktop?.sendAgentRequest).toHaveBeenCalledWith({
      type: "run.cancel",
      runId: firstRun.runId,
    });
    act(() => {
      emitAgentEvent?.({
        type: "run.completed",
        runId: firstRun.runId,
        finishedAt: now,
        stopReason: "cancelled",
      });
    });

    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(runRequests(first.conversationId)).toHaveLength(2);
    expect(runRequests(first.conversationId).at(-1)).toEqual(
      expect.objectContaining({ prompt: "Continue A after stopping" }),
    );
  });

  it("moves the submitted Conversation to the front immediately", async () => {
    const recent = conversationDescriptor({
      conversationId: "conversation_recent",
      title: "Recent Conversation",
      updatedAt: "2026-08-08T12:00:00.000Z",
    });
    const older = conversationDescriptor({
      conversationId: "conversation_older",
      title: "Older Conversation",
      updatedAt: "2026-08-07T12:00:00.000Z",
    });
    const { user } = await openProjectWithConversations([recent, older]);
    await user.click(screen.getByRole("button", { name: /Mobile UI/ }));
    const conversationSelect = screen.getByRole("combobox", {
      name: "Conversation",
    });
    conversationSelect.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(conversationSelect).toHaveTextContent("Older Conversation");

    await user.type(screen.getByLabelText("Continue the task"), "Move me up");
    await user.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(conversationSelect);

    expect(
      [...document.querySelectorAll(".ui-select__item-text")].map((option) =>
        option.textContent?.trim(),
      ),
    ).toEqual(["Older Conversation", "Recent Conversation"]);
  });

  it("ignores an older history response after a newer request", async () => {
    const first = conversationDescriptor({
      conversationId: "conversation_a",
      title: "Conversation A",
    });
    const second = conversationDescriptor({
      conversationId: "conversation_b",
      title: "Conversation B",
    });
    const { user } = await openProjectWithConversations([first, second]);
    const oldRequest = historyRequests(first.conversationId).at(-1);
    if (!oldRequest) throw new Error("Initial history request is missing");

    await user.click(screen.getByRole("button", { name: /Conversation B/ }));
    await user.click(screen.getByRole("button", { name: /Conversation A/ }));
    const latestRequest = historyRequests(first.conversationId).at(-1);
    if (!latestRequest || latestRequest.requestId === oldRequest.requestId) {
      throw new Error("Newer history request is missing");
    }

    act(() => {
      emitAgentEvent?.({
        type: "session.history",
        requestId: oldRequest.requestId,
        sessionId: first.conversationId,
        timeline: [historyMessage(first.conversationId, "Stale history")],
      });
      emitAgentEvent?.({
        type: "session.history",
        requestId: latestRequest.requestId,
        sessionId: first.conversationId,
        timeline: [historyMessage(first.conversationId, "Current history")],
      });
    });
    await user.click(screen.getByRole("button", { name: /Mobile UI/ }));

    expect(await screen.findByText("Current history")).toBeInTheDocument();
    expect(screen.queryByText("Stale history")).not.toBeInTheDocument();
  });

  it("counts only active Global Tasks while retaining terminal history", async () => {
    vi.mocked(window.desktop!.listGlobalTasks).mockResolvedValueOnce([
      globalTask("running"),
      globalTask("completed"),
      globalTask("failed"),
    ]);

    renderApp("workspace");

    expect(await screen.findByText("1 active · 3 total")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(3);
  });

  it("opens a Global Task at its Home Project and Conversation", async () => {
    const manifest = projectManifest();
    const first = conversationDescriptor({
      conversationId: "conversation_a",
      title: "Conversation A",
    });
    const second = conversationDescriptor({
      conversationId: "conversation_b",
      title: "Conversation B",
    });
    const task = globalTask("completed", {
      conversationId: second.conversationId,
      title: "Completed website review",
    });
    vi.mocked(window.desktop!.listGlobalTasks).mockResolvedValueOnce([task]);
    vi.mocked(window.desktop!.openRecentProject).mockResolvedValueOnce(
      manifest,
    );
    vi.mocked(window.desktop!.listProjectConversations).mockResolvedValueOnce([
      first,
      second,
    ]);

    const user = userEvent.setup();
    renderApp("workspace");
    await user.click(await screen.findByRole("button", { name: "Open" }));

    expect(window.desktop?.openRecentProject).toHaveBeenCalledWith({
      projectId: task.homeProjectId,
    });
    expect(
      await screen.findByRole("button", { name: /Conversation B/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(historyRequests(second.conversationId)).toHaveLength(1);
  });

  it("disables Agent composition for a standalone document", () => {
    renderApp();

    expect(
      screen.getByText("Select or create a Conversation"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Continue the task")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("reports a recent Project loading failure without leaving Workspace Home", async () => {
    vi.mocked(window.desktop!.listRecentProjects).mockRejectedValueOnce(
      new Error("Recent Project index is unavailable"),
    );

    renderApp("workspace");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recent Project index is unavailable",
    );
    expect(
      screen.getByRole("heading", { name: "Projects and Agent work" }),
    ).toBeInTheDocument();
  });

  it("does not expose Electron or SQLite internals when Project creation fails", async () => {
    vi.mocked(window.desktop!.createProject).mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'project:create': Error: UNIQUE constraint failed: projects.root_path",
      ),
    );
    const user = userEvent.setup();

    renderApp("workspace");
    await user.click(screen.getByRole("button", { name: "Create Project" }));
    await user.type(screen.getByLabelText("Project name"), "Acme Design");
    await user.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create the Project",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "UNIQUE constraint",
    );
  });

  it("creates a Project, opens a structured design file, and saves by composite identity", async () => {
    const user = userEvent.setup();
    const manifest = projectManifest();
    const document = createEmptyDesignDocument(
      "document_mobile",
      "page_mobile",
    );
    vi.mocked(window.desktop!.createProject).mockResolvedValueOnce(manifest);
    const descriptor = manifest.designFiles[0];
    if (!descriptor) throw new Error("Mobile design file is missing");
    vi.mocked(window.desktop!.readProjectDesignFile).mockResolvedValueOnce({
      descriptor,
      document,
    });
    vi.mocked(window.desktop!.saveProjectDesignFile).mockImplementation(
      (request) => Promise.resolve({ descriptor, document: request.document }),
    );

    renderApp("workspace");
    await user.click(screen.getByRole("button", { name: "Create Project" }));
    await user.type(screen.getByLabelText("Project name"), "Acme Design");
    await user.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(window.desktop?.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme Design" }),
    );
    await user.click(await screen.findByRole("button", { name: /Mobile UI/ }));
    expect(window.desktop?.readProjectDesignFile).toHaveBeenCalledWith({
      projectId: "project_acme",
      designFileId: "design_mobile",
    });
    expect(
      await screen.findByRole("main", { name: "Design canvas" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.desktop?.saveProjectDesignFile).toHaveBeenCalledWith({
      projectId: "project_acme",
      designFileId: "design_mobile",
      document,
    });
    expect(window.desktop?.saveDesignFile).not.toHaveBeenCalled();
  });

  it("saves the active file to its own Project after switching across Projects", async () => {
    const user = userEvent.setup();
    const acme = projectManifest();
    const now = "2026-08-07T12:00:00.000Z";
    const beta: ProjectManifest = {
      ...acme,
      projectId: "project_beta",
      name: "Beta Studio",
      designFiles: [
        {
          designFileId: "design_brand",
          documentId: "document_brand",
          name: "Brand System",
          relativePath: "designs/brand-system.opendesign",
          createdAt: now,
          updatedAt: now,
          lifecycle: "active",
        },
      ],
    };
    const mobileDescriptor = acme.designFiles[0];
    const brandDescriptor = beta.designFiles[0];
    if (!mobileDescriptor || !brandDescriptor) {
      throw new Error("Cross-Project design files are missing");
    }
    const mobileDocument = createEmptyDesignDocument(
      mobileDescriptor.documentId,
      "page_mobile",
    );
    const brandDocument = createEmptyDesignDocument(
      brandDescriptor.documentId,
      "page_brand",
    );
    vi.mocked(window.desktop!.listRecentProjects).mockResolvedValue([
      { projectId: acme.projectId, name: acme.name, lastOpenedAt: now },
      { projectId: beta.projectId, name: beta.name, lastOpenedAt: now },
    ]);
    vi.mocked(window.desktop!.openRecentProject).mockImplementation((request) =>
      Promise.resolve(request.projectId === beta.projectId ? beta : acme),
    );
    vi.mocked(window.desktop!.readProjectDesignFile).mockImplementation(
      (request) =>
        Promise.resolve(
          request.projectId === beta.projectId
            ? { descriptor: brandDescriptor, document: brandDocument }
            : { descriptor: mobileDescriptor, document: mobileDocument },
        ),
    );
    vi.mocked(window.desktop!.saveProjectDesignFile).mockImplementation(
      (request) =>
        Promise.resolve({
          descriptor:
            request.projectId === beta.projectId
              ? brandDescriptor
              : mobileDescriptor,
          document: request.document,
        }),
    );

    renderApp("workspace");
    await user.click(
      await screen.findByRole("button", { name: /^Acme Design/ }),
    );
    await user.click(screen.getByRole("button", { name: /Mobile UI/ }));
    await user.click(
      screen.getByRole("button", { name: "Open Workspace Home" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^Beta Studio/ }),
    );
    await user.click(screen.getByRole("button", { name: /Brand System/ }));

    await user.click(screen.getByRole("tab", { name: "Mobile UI" }));
    expect(
      screen.getByRole("button", { name: "Acme Design" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.desktop?.saveProjectDesignFile).toHaveBeenLastCalledWith({
      projectId: acme.projectId,
      designFileId: mobileDescriptor.designFileId,
      document: mobileDocument,
    });
  });

  it("renders one owned editor shell with a full-height canvas and vertical utility dock", () => {
    const { container } = renderApp();
    expect(
      screen.getByRole("navigation", { name: "Design tools" }),
    ).toBeInTheDocument();
    const canvas = screen.getByRole("main", { name: "Design canvas" });
    expect(canvas).toBeInTheDocument();
    expect(canvas.parentElement).toHaveClass("workspace__center");
    expect(
      within(canvas.parentElement as HTMLElement).getByRole("tablist", {
        name: "Open design files",
      }),
    ).toBeInTheDocument();
    const canvases = container.querySelectorAll(".leafer-canvas-view");
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas).toHaveAttribute("data-engine", "leafer");
    expect(
      screen.getByRole("complementary", { name: "Document navigation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Utility dock" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Agent conversation" }),
    ).toBeInTheDocument();
    const separators = screen.getAllByRole("separator");
    expect(separators).toHaveLength(2);
    for (const separator of separators) {
      expect(separator).toHaveAttribute("aria-orientation", "vertical");
    }
    expect(
      screen.getByRole("separator", { name: "Resize utility dock" }),
    ).toHaveAttribute("aria-valuenow", "320");
    expect(
      screen.queryByRole("separator", { name: "Resize agent timeline" }),
    ).not.toBeInTheDocument();
  });

  it("switches tools through EditorRuntime and keeps unsupported pen disabled", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Rectangle (R)" }));
    expect(
      screen.getByRole("button", { name: "Rectangle (R)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", {
        name: "Pen (path editing unavailable) (P)",
      }),
    ).toBeDisabled();
  });

  it("routes layer selection, property edits, undo, and redo through one runtime", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(
      screen.getByRole("button", { name: "Structured editing" }),
    );
    expect(runtimeOutput()).toHaveAttribute("data-selection", "feature_one");
    await user.click(
      within(screen.getByRole("tablist", { name: "Utility views" })).getByRole(
        "tab",
        { name: "Properties" },
      ),
    );
    expect(screen.getByLabelText("X")).toHaveValue(0);

    const x = screen.getByLabelText("X");
    await user.clear(x);
    await user.type(x, "42");
    await user.tab();

    expect(
      runtime().getSnapshot().document.nodesById.feature_one?.transform[4],
    ).toBe(42);
    expect(runtimeOutput()).toHaveAttribute("data-revision", "1");
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "true");
    await waitFor(() =>
      expect(leaferHarness.input?.changes).toMatchObject({
        fromRevision: 0,
        toRevision: 1,
        changedNodeIds: ["feature_one"],
      }),
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.nodesById.feature_one?.transform[4],
    ).toBe(0);
    expect(runtimeOutput()).toHaveAttribute("data-revision", "2");

    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(
      runtime().getSnapshot().document.nodesById.feature_one?.transform[4],
    ).toBe(42);
    expect(runtimeOutput()).toHaveAttribute("data-revision", "3");
  });

  it("applies layer visibility as an undoable document transaction", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "Hide Subtitle" }));

    expect(
      runtime().getSnapshot().document.nodesById.subtitle_welcome?.visible,
    ).toBe(false);
    expect(runtimeOutput()).toHaveAttribute("data-revision", "1");
    expect(
      screen.getByRole("button", { name: "Show Subtitle" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("freezes selection as context while keeping the mutation target page-wide", async () => {
    const { user } = await openProjectConversation();
    act(() =>
      leaferCallbacks().onSelectionChange(["feature_one"], "feature_one"),
    );

    expect(runtimeOutput()).toHaveAttribute("data-selection", "feature_one");
    expect(
      screen.getByText("Structured editing · rectangle"),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Continue the task"),
      "Make it stronger",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    const request = vi
      .mocked(window.desktop!.sendAgentRequest)
      .mock.calls.find(([candidate]) => candidate.type === "run.start")?.[0];
    expect(request).toMatchObject({
      type: "run.start",
      sessionId: "conversation_mobile",
      documentId: "document_mobile",
      revision: 0,
      scope: {
        kind: "selection",
        pageId: "page_welcome",
        primaryNodeId: "feature_one",
        selectedNodeIds: ["feature_one"],
      },
      mutationTarget: { kind: "page", pageId: "page_welcome" },
    });
  });

  it("submits reference images as safe metadata and shows them in the optimistic message", async () => {
    const attachmentId = `image_${"b".repeat(64)}`;
    const previewDataUrl = "data:image/png;base64,aW1hZ2U=";
    vi.mocked(window.desktop!.getModelProviderCatalog).mockResolvedValue({
      version: 1,
      providers: [
        {
          providerId: "provider_1",
          name: "Primary",
          enabled: true,
          apiFormat: "openai-responses",
          authMode: "bearer",
          baseUrl: "https://api.openai.com/v1",
          models: [
            {
              modelId: "vision-model",
              name: "Vision model",
              contextWindow: 200_000,
              maxOutputTokens: 16_384,
              capabilities: {
                toolUse: true,
                imageInput: true,
                reasoning: false,
              },
              reasoningEfforts: ["off"],
            },
          ],
          hasApiKey: true,
          updatedAt: now,
        },
      ],
      defaultSelection: {
        providerId: "provider_1",
        modelId: "vision-model",
        reasoningEffort: "off",
      },
    });
    vi.mocked(window.desktop!.selectAgentAttachments).mockResolvedValue([
      {
        attachmentId,
        name: "reference.png",
        mimeType: "image/png",
        byteSize: 1024,
        previewDataUrl,
      },
    ]);
    vi.mocked(window.desktop!.getAgentAttachmentPreview).mockResolvedValue({
      attachmentId,
      previewDataUrl,
    });
    const { user, conversation } = await openProjectConversation();

    await user.click(
      await screen.findByRole("button", { name: "Add attachments" }),
    );
    expect(
      await screen.findByRole("img", { name: "reference.png" }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Use this visual direction",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    const request = runRequests(conversation.conversationId).at(-1);
    expect(request).toMatchObject({
      type: "run.start",
      prompt: "Use this visual direction",
      attachments: [
        {
          attachmentId,
          name: "reference.png",
          mimeType: "image/png",
          byteSize: 1024,
        },
      ],
    });
    expect(JSON.stringify(request)).not.toContain("previewDataUrl");
    expect(JSON.stringify(request)).not.toContain("base64");
    expect(window.desktop!.getAgentAttachmentPreview).toHaveBeenCalledWith({
      attachmentId,
    });
    expect(
      await screen.findByRole("img", { name: "reference.png" }),
    ).toBeInTheDocument();
  });

  it("inserts one editable node with one revision and returns to select", async () => {
    const user = userEvent.setup();
    renderApp();
    const before = Object.keys(runtime().getSnapshot().document.nodesById);

    await user.click(screen.getByRole("button", { name: "Rectangle (R)" }));
    act(() => {
      leaferCallbacks().onCreate({
        dragged: false,
        height: 1,
        pageId: "page_welcome",
        parentId: "frame_welcome",
        tool: "rectangle",
        width: 1,
        x: 420,
        y: 236,
      });
    });

    const snapshot = runtime().getSnapshot();
    const insertedIds = Object.keys(snapshot.document.nodesById).filter(
      (nodeId) => !before.includes(nodeId),
    );
    expect(insertedIds).toHaveLength(1);
    expect(snapshot.document.nodesById[insertedIds[0] ?? ""]).toMatchObject({
      kind: "rectangle",
      parentId: "frame_welcome",
    });
    expect(snapshot.document.revision).toBe(1);
    expect(snapshot.state.selection.nodeIds).toEqual(insertedIds);
    expect(snapshot.state.tool).toBe("select");
  });

  it("draws a sized shape as one transaction", async () => {
    const user = userEvent.setup();
    renderApp();
    const before = Object.keys(runtime().getSnapshot().document.nodesById);

    await user.click(screen.getByRole("button", { name: "Rectangle (R)" }));
    expect(runtime().getSnapshot().document.revision).toBe(0);
    act(() => {
      leaferCallbacks().onCreate({
        dragged: true,
        height: 80,
        pageId: "page_welcome",
        parentId: "frame_welcome",
        tool: "rectangle",
        width: 120,
        x: 420,
        y: 236,
      });
    });
    const snapshot = runtime().getSnapshot();
    const insertedId = Object.keys(snapshot.document.nodesById).find(
      (nodeId) => !before.includes(nodeId),
    );
    expect(snapshot.document.nodesById[insertedId ?? ""]).toMatchObject({
      kind: "rectangle",
      size: { width: 120, height: 80 },
    });
    expect(snapshot.document.revision).toBe(1);
  });

  it("keeps drag movement transient until pointer-up commits one revision", () => {
    renderApp();
    expect(runtime().getSnapshot().document.revision).toBe(0);
    expect(
      runtime().getSnapshot().document.nodesById.feature_one?.transform,
    ).toEqual([1, 0, 0, 1, 0, 0]);

    act(() => {
      leaferCallbacks().onOperations({
        kind: "move",
        operations: [
          {
            commandId: "leafer_move_feature_one",
            type: "update_properties",
            nodeId: "feature_one",
            transform: [1, 0, 0, 1, 20, 20],
          },
        ],
      });
    });

    expect(runtime().getSnapshot().document.revision).toBe(1);
    expect(
      runtime().getSnapshot().document.nodesById.feature_one?.transform,
    ).toEqual([1, 0, 0, 1, 20, 20]);
  });

  it("projects Leafer viewport changes into session state without editing the document", async () => {
    renderApp();
    act(() =>
      leaferCallbacks().onViewportChange({
        panX: -20,
        panY: -10,
        zoom: 1.25,
        width: 900,
        height: 640,
      }),
    );

    expect(runtime().getSnapshot().state.viewport.zoom).toBe(1.25);
    expect(runtime().getSnapshot().document.revision).toBe(0);
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "false");
    await waitFor(() => expect(leaferHarness.input?.viewport.zoom).toBe(1.25));
  });

  it("resizes a selected layer with a transient handle preview", () => {
    renderApp();
    act(() => runtime().setSelection(["feature_one"], "feature_one"));
    expect(
      runtime().getSnapshot().document.nodesById.feature_one?.size,
    ).toEqual({ width: 304, height: 220 });
    expect(runtime().getSnapshot().document.revision).toBe(0);

    act(() => {
      leaferCallbacks().onOperations({
        kind: "resize",
        operations: [
          {
            commandId: "leafer_resize_feature_one",
            type: "update_properties",
            nodeId: "feature_one",
            size: { width: 344, height: 240 },
          },
        ],
      });
    });
    expect(
      runtime().getSnapshot().document.nodesById.feature_one?.size,
    ).toEqual({ width: 344, height: 240 });
    expect(runtime().getSnapshot().document.revision).toBe(1);
  });

  it("deletes layers and edits fills through the native color input", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(
      screen.getByRole("button", { name: "Structured editing" }),
    );
    await user.click(screen.getByRole("tab", { name: "Properties" }));

    const color = screen.getByLabelText("Paint 1 preview color");
    expect(color).toHaveAttribute("type", "color");
    fireEvent.change(color, { target: { value: "#ff0000" } });
    expect(
      runtime().getSnapshot().document.nodesById.feature_one?.properties,
    ).toMatchObject({ fills: [{ color: "#ff0000" }] });

    await user.click(screen.getByRole("button", { name: "Delete layer" }));
    expect(
      runtime().getSnapshot().document.nodesById.feature_one,
    ).toBeUndefined();
  });

  it("edits gradients, glow, blend mode and masks through design transactions", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(
      screen.getByRole("button", { name: "Structured editing" }),
    );
    await user.click(screen.getByRole("tab", { name: "Properties" }));

    fireEvent.change(screen.getByLabelText("Paint 1 type"), {
      target: { value: "linear-gradient" },
    });
    fireEvent.change(screen.getByLabelText("Add effect"), {
      target: { value: "outer-glow" },
    });
    fireEvent.change(screen.getByLabelText("Blend mode"), {
      target: { value: "screen" },
    });
    fireEvent.change(screen.getByLabelText("Mask mode"), {
      target: { value: "alpha" },
    });

    expect(
      runtime().getSnapshot().document.nodesById.feature_one,
    ).toMatchObject({
      blendMode: "screen",
      maskMode: "alpha",
      effects: [
        {
          type: "outer-glow",
          color: "#4f7fff",
          radius: 24,
        },
      ],
      properties: {
        fills: [
          {
            type: "linear-gradient",
            stops: [
              { offset: 0, color: "#ffffff" },
              { offset: 1, color: "#ffffff" },
            ],
          },
        ],
      },
    });
    expect(runtime().getSnapshot().document.revision).toBe(4);
  });

  it("duplicates a complete layer subtree through one transaction", async () => {
    const user = userEvent.setup();
    renderApp();
    const before = Object.keys(runtime().getSnapshot().document.nodesById);

    await user.click(screen.getByRole("button", { name: "Capabilities" }));
    await user.click(
      screen.getByRole("button", { name: "Duplicate selection (⌘D)" }),
    );

    const snapshot = runtime().getSnapshot();
    const inserted = Object.values(snapshot.document.nodesById).filter(
      (node) => !before.includes(node.id),
    );
    const duplicatedGroup = inserted.find(
      (node) => node.kind === "group" && node.name === "Capabilities copy",
    );
    expect(inserted).toHaveLength(4);
    expect(duplicatedGroup?.childIds).toHaveLength(3);
    expect(snapshot.document.revision).toBe(1);
    expect(snapshot.state.selection.nodeIds).toEqual([duplicatedGroup?.id]);
  });

  it("moves and aligns multiple selected layers in single transactions", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() =>
      runtime().setSelection(["feature_one", "feature_two"], "feature_one"),
    );

    act(() => {
      leaferCallbacks().onOperations({
        kind: "move",
        operations: [
          {
            commandId: "leafer_move_feature_one",
            type: "update_properties",
            nodeId: "feature_one",
            transform: [1, 0, 0, 1, 20, 20],
          },
          {
            commandId: "leafer_move_feature_two",
            type: "update_properties",
            nodeId: "feature_two",
            transform: [1, 0, 0, 1, 356, 20],
          },
        ],
      });
    });

    let snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById.feature_one?.transform.slice(4)).toEqual(
      [20, 20],
    );
    expect(snapshot.document.nodesById.feature_two?.transform.slice(4)).toEqual(
      [356, 20],
    );
    expect(snapshot.document.revision).toBe(1);

    await user.click(screen.getByRole("tab", { name: "Properties" }));
    await user.click(screen.getByRole("button", { name: "Align left" }));
    snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById.feature_two?.transform[4]).toBe(20);
    expect(snapshot.document.revision).toBe(2);
  });

  it("edits text content and typography through the inspector", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.click(screen.getByRole("tab", { name: "Properties" }));

    const content = screen.getByLabelText("Text content");
    await user.clear(content);
    await user.type(content, "Poster headline");
    fireEvent.blur(content);
    const size = screen.getByLabelText("Font size");
    await user.clear(size);
    await user.type(size, "64{Enter}");

    expect(
      runtime().getSnapshot().document.nodesById.title_welcome?.properties,
    ).toMatchObject({ content: "Poster headline", fontSize: 64 });
  });

  it("accepts Leafer pan state without editing the document", () => {
    renderApp();
    const viewport = runtime().getSnapshot().state.viewport;
    act(() =>
      leaferCallbacks().onViewportChange({
        ...viewport,
        panX: 50,
        panY: 35,
      }),
    );

    expect(runtime().getSnapshot().state.viewport).toMatchObject({
      panX: 50,
      panY: 35,
    });
    expect(runtime().getSnapshot().document.revision).toBe(0);
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "false");
  });

  it("switches utility tabs with pointer and keyboard while preserving the Agent draft", async () => {
    const { user } = await openProjectConversation();
    const utilityTabs = screen.getByRole("tablist", { name: "Utility views" });
    const agentTab = within(utilityTabs).getByRole("tab", { name: "Agent" });
    const propertiesTab = within(utilityTabs).getByRole("tab", {
      name: "Properties",
    });
    const prompt = screen.getByLabelText("Continue the task");

    expect(agentTab).toHaveAttribute("aria-selected", "true");
    expect(propertiesTab).toHaveAttribute("aria-selected", "false");
    await user.type(prompt, "Keep this draft");
    await user.click(propertiesTab);

    expect(propertiesTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Properties" })).toBeVisible();
    expect(prompt).not.toBeVisible();

    await user.keyboard("{ArrowLeft}");
    expect(agentTab).toHaveFocus();
    expect(agentTab).toHaveAttribute("aria-selected", "true");
    expect(prompt).toBeVisible();
    expect(prompt).toHaveValue("Keep this draft");

    await user.keyboard("{End}");
    expect(propertiesTab).toHaveFocus();
    expect(propertiesTab).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(agentTab).toHaveFocus();
    expect(agentTab).toHaveAttribute("aria-selected", "true");
  });

  it("does not trigger canvas tool shortcuts while a desktop select has focus", async () => {
    await openProjectConversation();
    runtime().setTool("select");

    const modelSelect = await screen.findByRole("combobox", { name: "Model" });
    modelSelect.focus();
    fireEvent.keyDown(modelSelect, { key: "r" });

    expect(runtimeOutput()).toHaveAttribute("data-tool", "select");
  });

  it("keeps the active utility tab stable and preserves Agent activity and run state", async () => {
    const { user } = await openProjectConversation();
    const utilityTabs = screen.getByRole("tablist", { name: "Utility views" });
    const agentTab = within(utilityTabs).getByRole("tab", { name: "Agent" });
    const propertiesTab = within(utilityTabs).getByRole("tab", {
      name: "Properties",
    });

    await user.click(propertiesTab);
    await user.click(
      screen.getByRole("button", { name: "Structured editing" }),
    );
    expect(propertiesTab).toHaveAttribute("aria-selected", "true");

    await user.click(agentTab);
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Background run",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    const request = vi
      .mocked(window.desktop!.sendAgentRequest)
      .mock.calls.find(([candidate]) => candidate.type === "run.start")?.[0];
    if (!request || request.type !== "run.start") {
      throw new Error("Agent run request is missing");
    }
    await user.click(propertiesTab);
    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: request.runId,
        startedAt: "2026-08-07T10:42:08.000Z",
      });
    });
    expect(propertiesTab).toHaveAttribute("aria-selected", "true");
    expect(agentTab).toHaveAccessibleDescription("Agent request in progress");
    expect(
      agentTab.querySelector(".utility-dock__activity-badge.is-running"),
    ).toBeInTheDocument();

    await user.click(agentTab);
    expect(screen.getByText("Request in progress")).toBeInTheDocument();
    expect(screen.getByLabelText("Continue the task")).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Send" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
  });

  it("shows an honest multi-selection state in Properties", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => {
      runtime().setSelection(["feature_one", "feature_two"], "feature_two");
    });
    const utilityTabs = screen.getByRole("tablist", { name: "Utility views" });
    await user.click(
      within(utilityTabs).getByRole("tab", { name: "Properties" }),
    );

    const properties = screen.getByRole("region", { name: "Properties" });
    expect(
      within(properties).getByText("2 layers selected"),
    ).toBeInTheDocument();
    expect(
      within(properties).queryByText("No selection"),
    ).not.toBeInTheDocument();
  });

  it("sends a host-bound document scope and renders streamed Agent events", async () => {
    const { user, conversation } = await openProjectConversation();

    await user.type(
      screen.getByLabelText("Continue the task"),
      "Increase the hierarchy of the selected card",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(window.desktop?.sendAgentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run.start",
        sessionId: conversation.conversationId,
        prompt: "Increase the hierarchy of the selected card",
        documentId: "document_mobile",
        revision: 0,
        scope: {
          kind: "page",
          pageId: "page_welcome",
          selectedNodeIds: [],
        },
        mutationTarget: { kind: "page", pageId: "page_welcome" },
      }),
    );
    const request = vi
      .mocked(window.desktop!.sendAgentRequest)
      .mock.calls.find(([candidate]) => candidate.type === "run.start")?.[0];
    expect(request?.type).toBe("run.start");
    if (!request || request.type !== "run.start") return;

    emitAgentEvent?.({
      type: "run.started",
      runId: request.runId,
      startedAt: "2026-08-07T10:42:08.000Z",
    });
    emitAgentEvent?.({
      type: "message.delta",
      runId: request.runId,
      messageId: "message_1",
      blockId: "block_1",
      delta: "Prepared a structured edit plan.",
    });
    emitAgentEvent?.({
      type: "run.completed",
      runId: request.runId,
      finishedAt: "2026-08-07T10:42:11.000Z",
      stopReason: "complete",
    });

    expect(
      await screen.findByText("Prepared a structured edit plan."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Continue the task")).toBeEnabled();
  });

  it("keeps the prompt and reports an Agent connection error", async () => {
    const { user } = await openProjectConversation();
    vi.mocked(window.desktop!.sendAgentRequest).mockImplementationOnce(
      (request) =>
        request.type === "run.start"
          ? Promise.reject(new Error("Agent process is not ready"))
          : Promise.resolve(),
    );

    const prompt = screen.getByLabelText("Continue the task");
    await user.type(prompt, "Create a pricing card");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Agent process is not ready"),
    ).toBeInTheDocument();
    expect(prompt).toHaveValue("Create a pricing card");
  });

  it("unlocks the composer when a production model stream times out", async () => {
    const { user } = await openProjectConversation();
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Design a profile page",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    const request = runRequests("conversation_mobile").at(-1);
    if (!request) throw new Error("Agent run request is missing");

    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: request.runId,
        startedAt: now,
      });
      emitAgentEvent?.({
        type: "agent.error",
        code: "run_failed",
        runId: request.runId,
        message:
          "Model provider timed out after 180000 ms waiting for a response",
      });
    });

    expect(
      screen.getByText("The model took too long to respond. Try again."),
    ).toBeInTheDocument();
    const retryPrompt = screen.getByLabelText("Continue the task");
    expect(retryPrompt).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Stop" }),
    ).not.toBeInTheDocument();
    await user.type(retryPrompt, "Retry with a simpler plan");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("unlocks every active Conversation when the Agent process exits", async () => {
    const { user } = await openProjectConversation();
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Design a profile page",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    const request = runRequests("conversation_mobile").at(-1);
    if (!request) throw new Error("Agent run request is missing");

    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: request.runId,
        startedAt: now,
      });
      emitAgentEvent?.({
        type: "agent.error",
        code: "process_exited",
        message: "Agent process exited with code 1",
      });
    });

    expect(
      screen.getByText("Agent process exited with code 1"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Continue the task")).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Stop" }),
    ).not.toBeInTheDocument();
  });

  it("saves the structured document and checkpoints only on success", async () => {
    const user = userEvent.setup();
    vi.mocked(window.desktop!.saveDesignFile).mockResolvedValueOnce({
      name: "Welcome.opendesign",
    });
    renderApp();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.desktop?.saveDesignFile).toHaveBeenCalledTimes(1);
    const saveRequest = vi.mocked(window.desktop!.saveDesignFile).mock
      .calls[0]?.[0];
    expect(saveRequest?.suggestedName).toBe("Untitled.opendesign");
    expect(saveRequest?.contents).toContain('"documentId": "document_welcome"');
    expect(await screen.findAllByText("Welcome.opendesign")).toHaveLength(2);
  });

  it("keeps dirty state when saving fails", async () => {
    const user = userEvent.setup();
    vi.mocked(window.desktop!.saveDesignFile).mockRejectedValueOnce(
      new Error("Disk is read-only"),
    );
    renderApp();

    await user.click(screen.getByRole("button", { name: "Hide Subtitle" }));
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "true");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Disk is read-only")).toBeInTheDocument();
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "true");
    expect(runtime().getSnapshot().state.checkpointRevision).toBe(0);
  });

  it("applies a native Agent tool transaction through the active EditorRuntime", async () => {
    renderApp();
    const current = runtime().getSnapshot().document;
    if (!requestDesignTool) throw new Error("Design tool listener is missing");

    act(() => {
      requestDesignTool?.({
        requestId: "renderer_tool_1",
        call: {
          toolCallId: "tool_call_1",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Rename welcome frame",
            commands: [
              {
                commandId: "rename_welcome",
                type: "update_properties",
                nodeId: "frame_welcome",
                name: "Agent-updated canvas",
              },
            ],
          },
        },
        context: {
          runId: "run_1",
          sessionId: "conversation_1",
          documentId: current.documentId,
          revision: current.revision,
          scope: { kind: "document", selectedNodeIds: [] },
          mutationTarget: { kind: "document" },
        },
      });
    });

    const resolveDesignToolRequest = vi.mocked(
      window.desktop!.resolveDesignToolRequest,
    );
    await vi.waitFor(() => {
      const response = resolveDesignToolRequest.mock.calls.at(-1)?.[0];
      expect(response?.requestId).toBe("renderer_tool_1");
      expect(response?.ok).toBe(true);
      if (!response?.ok) return;
      expect(response.result.designRevision?.revision).toBe(1);
    });
    expect(runtime().getSnapshot().document.revision).toBe(1);
    expect(runtime().getSnapshot().document.nodesById.frame_welcome?.name).toBe(
      "Agent-updated canvas",
    );
  });

  it("reports Leafer failures without corrupting the document", () => {
    renderApp();
    const before = runtime().getSnapshot();

    act(() => leaferCallbacks().onError(new Error("Canvas context was lost")));

    expect(screen.getByRole("alert")).toHaveTextContent("Canvas unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Canvas context was lost",
    );
    expect(runtime().getSnapshot().document).toBe(before.document);
    expect(runtime().getSnapshot().document.revision).toBe(0);
  });

  it("keeps the current document when an opened file is malformed", async () => {
    const user = userEvent.setup();
    vi.mocked(window.desktop!.openDesignFile).mockResolvedValueOnce({
      name: "Broken.opendesign",
      contents: "{broken",
    });
    renderApp();

    await user.click(screen.getByRole("button", { name: "File actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Open…" }));

    expect(
      await screen.findByText(/Expected property name/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Untitled.opendesign")).toHaveLength(2);
    expect(screen.getByText("Welcome canvas")).toBeInTheDocument();
  });

  it("replaces the runtime only after a valid file is parsed", async () => {
    const user = userEvent.setup();
    const opened = structuredClone(createWelcomeDocument());
    opened.documentId = "document_opened";
    const frame = opened.nodesById.frame_welcome;
    if (!frame) throw new Error("Welcome document frame is missing");
    frame.name = "Opened canvas";
    vi.mocked(window.desktop!.openDesignFile).mockResolvedValueOnce({
      name: "Opened.opendesign",
      contents: JSON.stringify(opened),
    });
    renderApp();

    await user.click(screen.getByRole("button", { name: "File actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Open…" }));

    expect(await screen.findAllByText("Opened.opendesign")).toHaveLength(2);
    expect(screen.getByText("Opened canvas")).toBeInTheDocument();
  });
});

function leaferCallbacks(): LeaferEngineCallbacks {
  if (!leaferHarness.callbacks)
    throw new Error("Leafer adapter is not mounted");
  return leaferHarness.callbacks;
}
