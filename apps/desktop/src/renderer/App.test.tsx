import {
  act,
  createEvent,
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
  documentToScreen,
  getNodeBounds,
  getWorldTransform,
  transformPoint,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import type { SvgInterchangeIssue } from "@opendesign/import-export-service";
import type { VectorNode } from "@opendesign/design-contracts";
import type {
  LeaferEngineCallbacks,
  LeaferEngineSyncInput,
} from "@opendesign/leafer-engine";
import {
  PROJECT_MANIFEST_VERSION,
  WORKSPACE_CONTRACT_VERSION,
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
import * as designCapture from "./design-capture";
import * as rasterExport from "./raster-export";
import * as svgInterchange from "./svg-interchange";
import type { SuccessfulSvgImportResult } from "./svg-interchange-contract";
import type { RendererDesignToolRequest } from "../shared/design-tool-bridge";
import type { TextLayoutRequest } from "@opendesign/text-service";
import type { ProjectDesignFile } from "../shared/desktop-api";
import type { DiagnosticEvent } from "../shared/diagnostics";
import {
  DESIGN_PLAN_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  type DesignPlanToolInput,
} from "../shared/design-agent-tools";

const leaferHarness = vi.hoisted(() => ({
  callbacks: null as LeaferEngineCallbacks | null,
  input: null as LeaferEngineSyncInput | null,
  finishGenerationPresentation: vi.fn(),
  cancelImageCrop: vi.fn(() => true),
  finishImageCrop: vi.fn(() => true),
  resetImageCrop: vi.fn(() => true),
  startImageCrop: vi.fn((nodeId: string) => nodeId === "hero_image"),
  updateImageCropZoom: vi.fn(() => true),
  sync: vi.fn(),
  retryBooleanGeometry: vi.fn(() => true),
  setVectorPointMode: vi.fn(() => true),
  measureText: vi.fn((request: TextLayoutRequest) => ({
    ok: true as const,
    provider: "test-text-layout",
    providerVersion: "1",
    size: {
      width:
        request.mode === "auto-height"
          ? (request.width ?? 240)
          : Math.max(1, request.content.length * request.fontSize * 0.6),
      height: request.lineHeight,
    },
    warnings: [],
  })),
  inspectFont: vi.fn(
    (descriptor: { fontFamily: string; fontWeight: number }) => ({
      status:
        descriptor.fontFamily === "Inter"
          ? ("missing" as const)
          : ("available" as const),
      provider: "test-text-layout",
      providerVersion: "1",
      message: `${descriptor.fontFamily} availability`,
    }),
  ),
}));

vi.mock("@opendesign/leafer-engine", () => ({
  resolveDesignTextRuns: (
    document: { documentId: string; revision: number },
    pageId: string,
  ) => ({
    projection: {
      documentId: document.documentId,
      pageId,
      revision: document.revision,
      resultsByNodeId: new Map(),
    },
    warnings: [],
  }),
  createLeaferEngineAdapter: vi.fn(
    (host: HTMLElement, callbacks: LeaferEngineCallbacks) => {
      leaferHarness.callbacks = callbacks;
      host.dataset.engine = "leafer";
      const canvas = document.createElement("canvas");
      canvas.className = "leafer-canvas-view";
      host.append(canvas);
      return Promise.resolve({
        cancelImageCrop: leaferHarness.cancelImageCrop,
        dispose: () => canvas.remove(),
        finishGenerationPresentation:
          leaferHarness.finishGenerationPresentation,
        finishImageCrop: leaferHarness.finishImageCrop,
        resetImageCrop: leaferHarness.resetImageCrop,
        retryBooleanGeometry: leaferHarness.retryBooleanGeometry,
        setVectorPointMode: leaferHarness.setVectorPointMode,
        startImageCrop: leaferHarness.startImageCrop,
        textLayoutProvider: {
          id: "test-text-layout",
          version: "1",
          inspectFont: leaferHarness.inspectFont,
          measure: leaferHarness.measureText,
        },
        textRunLayoutProvider: {
          id: "test-text-runs",
          version: "1",
          layout: vi.fn(),
        },
        sync: (input: LeaferEngineSyncInput) => {
          leaferHarness.input = input;
          leaferHarness.sync(input);
        },
        updateImageCropZoom: leaferHarness.updateImageCropZoom,
        updateTextEditingStyle: vi.fn(() => true),
      });
    },
  ),
}));

vi.mock("./svg-interchange", { spy: true });
vi.mock("./design-capture", { spy: true });
vi.mock("./raster-export", { spy: true });

const svgHarness = {
  runImport: vi.mocked(svgInterchange.runSvgImportInWorker),
  runExport: vi.mocked(svgInterchange.runSvgExportInWorker),
};
const captureHarness = {
  capture: vi.mocked(designCapture.captureDesignTarget),
};
const rasterHarness = {
  export: vi.mocked(rasterExport.exportDesignRaster),
};

let emitAgentEvent: ((event: AgentEvent) => void) | undefined;
let requestOpenSettings: (() => void) | undefined;
let requestImportSvg: (() => void) | undefined;
let requestExportSvg: (() => void) | undefined;
let observedRuntime: EditorRuntime | undefined;
let requestDesignTool:
  ((request: RendererDesignToolRequest) => void) | undefined;
let emitDiagnosticEvent: ((event: DiagnosticEvent) => void) | undefined;

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1_280,
    writable: true,
  });
  emitAgentEvent = undefined;
  requestOpenSettings = undefined;
  requestImportSvg = undefined;
  requestExportSvg = undefined;
  observedRuntime = undefined;
  requestDesignTool = undefined;
  emitDiagnosticEvent = undefined;
  leaferHarness.callbacks = null;
  leaferHarness.input = null;
  leaferHarness.finishGenerationPresentation.mockClear();
  leaferHarness.cancelImageCrop.mockClear();
  leaferHarness.finishImageCrop.mockClear();
  leaferHarness.resetImageCrop.mockClear();
  leaferHarness.startImageCrop.mockClear();
  leaferHarness.updateImageCropZoom.mockClear();
  leaferHarness.sync.mockClear();
  leaferHarness.retryBooleanGeometry.mockClear();
  leaferHarness.setVectorPointMode.mockClear();
  leaferHarness.measureText.mockClear();
  leaferHarness.inspectFont.mockClear();
  svgHarness.runImport.mockReset();
  svgHarness.runExport.mockReset();
  captureHarness.capture.mockReset();
  rasterHarness.export.mockReset();
  rasterHarness.export.mockResolvedValue({
    bytes: new Uint8Array([4, 5, 6]),
    height: 720,
    mimeType: "image/png",
    width: 1_200,
  });
  captureHarness.capture.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    height: 720,
    mimeType: "image/jpeg",
    width: 1_200,
  });
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
    getProfessionalFixtureSmoke: vi.fn().mockResolvedValue(null),
    reportProfessionalFixtureSmoke: vi.fn().mockResolvedValue(undefined),
    getPlatformInfo: vi
      .fn()
      .mockResolvedValue({ platform: "darwin", version: "0.0.0" }),
    getPendingDiagnostics: vi.fn().mockResolvedValue([]),
    reportDiagnostic: vi.fn().mockResolvedValue(undefined),
    onDiagnosticEvent: vi
      .fn()
      .mockImplementation((listener: (event: DiagnosticEvent) => void) => {
        emitDiagnosticEvent = listener;
        return () => undefined;
      }),
    onOpenSettings: vi.fn().mockImplementation((listener: () => void) => {
      requestOpenSettings = listener;
      return () => undefined;
    }),
    onImportSvgCommand: vi.fn().mockImplementation((listener: () => void) => {
      requestImportSvg = listener;
      return () => undefined;
    }),
    onExportSvgCommand: vi.fn().mockImplementation((listener: () => void) => {
      requestExportSvg = listener;
      return () => undefined;
    }),
    getLocale: vi.fn().mockResolvedValue("en"),
    setLocale: vi.fn().mockImplementation((locale) => Promise.resolve(locale)),
    onLocaleChange: vi.fn().mockReturnValue(() => undefined),
    getTheme: vi.fn().mockResolvedValue("dark"),
    setTheme: vi.fn().mockImplementation((theme) => Promise.resolve(theme)),
    getModelProviderCatalog: vi.fn().mockResolvedValue({
      version: 3,
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
    getGlobalImageGenerationSettings: vi.fn().mockResolvedValue({
      version: 1,
      enabled: false,
      apiFormat: "openai-images",
      authMode: "bearer",
      baseUrl: "https://api.openai.com/v1",
      modelId: "",
      hasApiKey: false,
      updatedAt: null,
    }),
    saveGlobalImageGenerationSettings: vi.fn(),
    saveModelProviderProfile: vi.fn(),
    deleteModelProviderProfile: vi.fn(),
    testModelProviderConnection: vi.fn(),
    onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
    selectAgentAttachments: vi.fn().mockResolvedValue([]),
    importAgentAttachments: vi.fn().mockResolvedValue([]),
    getAgentAttachmentPreview: vi.fn(),
    selectDesignImage: vi.fn().mockResolvedValue(null),
    editDesignImage: vi.fn(),
    cancelDesignImageEdit: vi.fn().mockResolvedValue(false),
    selectFontBinaries: vi.fn().mockResolvedValue([]),
    listFontBinaries: vi.fn().mockResolvedValue([]),
    readFontBinary: vi.fn(),
    onDesignToolRequest: vi
      .fn()
      .mockImplementation(
        (listener: (request: RendererDesignToolRequest) => void) => {
          requestDesignTool = listener;
          return () => undefined;
        },
      ),
    onDesignToolCancel: vi.fn().mockReturnValue(() => undefined),
    reportDesignToolProgress: vi.fn().mockResolvedValue(true),
    resolveDesignToolRequest: vi.fn().mockResolvedValue(undefined),
    windowAction: vi.fn().mockResolvedValue(undefined),
    onNativeThemeChange: vi.fn().mockReturnValue(() => undefined),
    openDesignFile: vi.fn().mockResolvedValue(null),
    saveDesignFile: vi.fn().mockResolvedValue(null),
    openSvgFile: vi.fn().mockResolvedValue(null),
    saveSvgFile: vi.fn().mockResolvedValue(null),
    saveRasterFile: vi.fn().mockResolvedValue(null),
    createProject: vi.fn().mockResolvedValue(null),
    openProject: vi.fn().mockResolvedValue(null),
    openRecentProject: vi.fn(),
    listRecentProjects: vi.fn().mockResolvedValue([]),
    removeRecentProject: vi.fn().mockResolvedValue([]),
    revealRecentProject: vi.fn().mockResolvedValue(undefined),
    listOpenProjects: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    listConversations: vi.fn().mockResolvedValue([]),
    resolveConversationOpenContext: vi.fn().mockResolvedValue({
      kind: "target-unavailable",
      conversationId: "conversation_mobile",
      reason: "no-target",
    }),
    listGlobalTasks: vi.fn().mockResolvedValue([]),
    createProjectDesignFile: vi.fn(),
    readProjectDesignFile: vi.fn(),
    saveProjectDesignFile: vi.fn(),
    renameProjectDesignFile: vi.fn(),
    publishProjectLibrary: vi.fn(),
    listProjectLibraries: vi.fn().mockResolvedValue({
      version: 1,
      libraries: [],
      enabledLibraryIdsByDesignFileId: {},
      acceptedReleaseIdsByDesignFileId: {},
      ignoredReleaseIdsByDesignFileId: {},
    }),
    readProjectLibraryRelease: vi.fn(),
    setProjectLibraryEnabled: vi.fn(),
    setProjectLibraryUpdateIgnored: vi.fn(),
    setProjectLibraryUpdateAccepted: vi.fn(),
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

function mockConversationTargetResolution(manifest: ProjectManifest) {
  vi.mocked(window.desktop!.resolveConversationOpenContext).mockImplementation(
    ({ conversationId }) =>
      Promise.resolve({
        kind: "target-available",
        conversationId,
        source: "filed-project",
        target: {
          targetId: `target_${conversationId}`,
          projectId: manifest.projectId,
          designFileId: "design_mobile",
          documentId: "document_mobile",
          pageId: "page_welcome",
          selectedNodeIds: [],
          baseRevision: 0,
        },
      }),
  );
}

function mockProjectDesignFileRead(manifest: ProjectManifest) {
  const descriptor = manifest.designFiles[0];
  if (!descriptor) throw new Error("Mobile design file is missing");
  const document = structuredClone(createWelcomeDocument());
  document.documentId = descriptor.documentId;
  vi.mocked(window.desktop!.readProjectDesignFile).mockResolvedValue({
    descriptor,
    document,
  });
  return { descriptor, document };
}

async function openProjectWithConversations(
  conversations: ConversationDescriptor[],
) {
  const user = userEvent.setup();
  const manifest = projectManifest();
  mockProjectDesignFileRead(manifest);
  mockConversationTargetResolution(manifest);
  vi.mocked(window.desktop!.listRecentProjects).mockResolvedValueOnce([
    { projectId: manifest.projectId, name: manifest.name, lastOpenedAt: now },
  ]);
  vi.mocked(window.desktop!.openRecentProject).mockResolvedValueOnce(manifest);
  vi.mocked(window.desktop!.listConversations).mockResolvedValueOnce(
    conversations,
  );
  vi.mocked(window.desktop!.saveProjectDesignFile).mockImplementation(
    (request) => {
      const savedDescriptor = manifest.designFiles.find(
        (candidate) => candidate.designFileId === request.designFileId,
      );
      if (!savedDescriptor) {
        return Promise.reject(new Error("Design file descriptor is missing"));
      }
      return Promise.resolve({
        descriptor: {
          ...savedDescriptor,
          updatedAt: "2026-08-07T12:00:01.000Z",
        },
        document: request.document,
      });
    },
  );
  renderApp("workspace");
  await user.click(await screen.findByRole("button", { name: /^Acme Design/ }));
  return { user, manifest };
}

async function openProjectConversation() {
  const conversation = conversationDescriptor();
  const { user, manifest } = await openProjectWithConversations([conversation]);
  await user.click(
    await screen.findByRole("button", { name: conversation.title }),
  );
  await screen.findByRole("main", { name: "Design canvas" });
  return { user, manifest, conversation };
}

const now = "2026-08-07T12:00:00.000Z";

function importedSvgResult(
  issues: SvgInterchangeIssue[] = [],
): SuccessfulSvgImportResult {
  return {
    ok: true,
    version: 1,
    rootNodeId: "svg_fixture_root",
    nodes: [
      {
        id: "svg_fixture_root",
        kind: "group",
        name: "Imported brand",
        parentId: null,
        childIds: ["svg_fixture_mark"],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0],
        size: { width: 120, height: 80 },
        exportSettings: [],
        opacity: 1,
        properties: {},
        extensions: {},
      },
      {
        id: "svg_fixture_mark",
        kind: "rectangle",
        name: "Brand mark",
        parentId: "svg_fixture_root",
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0],
        size: { width: 120, height: 80 },
        exportSettings: [],
        opacity: 1,
        properties: {
          cornerRadius: 8,
          fills: [{ type: "solid", color: "#356df3", opacity: 1 }],
          strokes: [],
          strokeWidth: 0,
        },
        extensions: {},
      },
    ],
    sourceViewport: { x: 0, y: 0, width: 120, height: 80 },
    issues,
  };
}

function conversationDescriptor(
  overrides: Partial<ConversationDescriptor> = {},
): ConversationDescriptor {
  return {
    conversationId: "conversation_mobile",
    originProjectId: "project_acme",
    filedProjectId: "project_acme",
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
  const primaryTarget = {
    targetId: `target_${runId}`,
    projectId: "project_acme",
    designFileId: "design_mobile",
    documentId: "document_mobile",
    pageId: "page_welcome",
    selectedNodeIds: [],
    baseRevision: 0,
  };
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    taskId: `task_${runId}`,
    conversationId,
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
  it("replaces every exact file-font match in one undoable transaction", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => runtime().setSelection(["title_welcome"], "title_welcome"));
    await user.click(screen.getByRole("tab", { name: "Properties" }));

    expect(
      await screen.findByText("Font missing — fallback rendered"),
    ).toBeVisible();
    await user.type(
      screen.getByLabelText("Replacement font family"),
      "IBM Plex Sans",
    );
    await user.tab();
    await user.click(
      screen.getByRole("button", { name: "Replace 2 matching layers" }),
    );

    await waitFor(() =>
      expect(runtime().getSnapshot().document.revision).toBe(1),
    );
    expect(
      runtime().getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      properties: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: null,
        fontWeight: 600,
        fontSlant: "normal",
      },
    });
    expect(
      runtime().getSnapshot().document.nodesById.subtitle_welcome,
    ).toMatchObject({
      properties: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: null,
        fontWeight: 600,
        fontSlant: "normal",
      },
    });
    expect(runtime().getSnapshot().state.history.undo).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      properties: {
        fontFamily: "Inter",
        fontStyleName: "Semi Bold",
        fontWeight: 600,
        fontSlant: "normal",
      },
    });
    expect(
      runtime().getSnapshot().document.nodesById.subtitle_welcome,
    ).toMatchObject({
      properties: {
        fontFamily: "Inter",
        fontStyleName: "Semi Bold",
        fontWeight: 600,
        fontSlant: "normal",
      },
    });
  });

  it("opens Settings without rebuilding the editor runtime", async () => {
    const user = userEvent.setup();
    renderApp();
    const editorRuntime = runtime();
    editorRuntime.setTool("rectangle");

    const settingsButton = screen.getByRole("button", {
      name: "Open Settings",
    });
    expect(
      settingsButton.querySelector('[data-icon="lucide:settings-2"]'),
    ).toBeInTheDocument();
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

  it("mounts editor command subscriptions only for the Editor destination", async () => {
    const unsubscribeImport = vi.fn();
    const unsubscribeExport = vi.fn();
    vi.mocked(window.desktop!.onImportSvgCommand).mockImplementation(
      (listener) => {
        requestImportSvg = listener;
        return unsubscribeImport;
      },
    );
    vi.mocked(window.desktop!.onExportSvgCommand).mockImplementation(
      (listener) => {
        requestExportSvg = listener;
        return unsubscribeExport;
      },
    );
    const { user } = await openProjectWithConversations([]);
    expect(window.desktop!.onImportSvgCommand).not.toHaveBeenCalled();
    expect(window.desktop!.onExportSvgCommand).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Mobile UI/ }));
    await screen.findByRole("main", { name: "Design canvas" });
    await waitFor(() => {
      expect(window.desktop!.onImportSvgCommand).toHaveBeenCalledOnce();
      expect(window.desktop!.onExportSvgCommand).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    await screen.findByRole("heading", { name: "Language and appearance" });
    expect(unsubscribeImport).toHaveBeenCalledOnce();
    expect(unsubscribeExport).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Close Settings" }));
    await screen.findByRole("main", { name: "Design canvas" });
    await waitFor(() => {
      expect(window.desktop!.onImportSvgCommand).toHaveBeenCalledTimes(2);
      expect(window.desktop!.onExportSvgCommand).toHaveBeenCalledTimes(2);
    });

    await user.click(
      screen.getByRole("button", { name: "Open Workspace Home" }),
    );
    await screen.findByRole("heading", { name: "Projects and Agent work" });
    expect(unsubscribeImport).toHaveBeenCalledTimes(2);
    expect(unsubscribeExport).toHaveBeenCalledTimes(2);
  });

  it("imports native SVG files as one editable, undoable document transaction", async () => {
    const user = userEvent.setup();
    vi.mocked(window.desktop!.openSvgFile).mockResolvedValueOnce({
      name: "Brand.svg",
      contents: '<svg viewBox="0 0 120 80" />',
    });
    svgHarness.runImport.mockResolvedValueOnce(
      importedSvgResult([
        {
          code: "effect-omitted",
          message: "A filter was omitted from the editable result",
          severity: "warning",
        },
      ]),
    );
    renderApp();

    act(() => requestImportSvg?.());

    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.nodesById.svg_fixture_root,
      ).toBeDefined(),
    );
    expect(window.desktop!.openSvgFile).toHaveBeenCalledOnce();
    const importCall = svgHarness.runImport.mock.calls[0];
    expect(importCall).toBeDefined();
    expect(importCall?.[0].svg).toBe('<svg viewBox="0 0 120 80" />');
    expect(importCall?.[0].name).toBe("Brand.svg");
    expect(importCall?.[0].idPrefix).toMatch(/^svg_[a-f\d]+$/);
    expect(importCall?.[1]).toBeInstanceOf(AbortSignal);
    expect(runtime().getSnapshot().document.revision).toBe(1);
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([
      "svg_fixture_root",
    ]);
    expect(
      runtime().getSnapshot().document.nodesById.svg_fixture_root?.parentId,
    ).toBeNull();
    expect(screen.getByText("Imported Brand.svg")).toBeVisible();
    expect(screen.getByText("effect-omitted")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.nodesById.svg_fixture_root,
    ).toBeUndefined();
  });

  it("exports a frozen explicit selection with controlled SVG settings", async () => {
    const user = userEvent.setup();
    svgHarness.runExport.mockResolvedValueOnce({
      svg: '<svg viewBox="0 0 304 220"><rect /></svg>',
      issues: [
        {
          code: "boolean-flattened",
          message: "Boolean geometry was exported as a standard path",
          severity: "warning",
        },
      ],
      exportedNodeIds: ["feature_one"],
      revision: 0,
      sourceBounds: { x: 0, y: 0, width: 304, height: 220 },
    });
    vi.mocked(window.desktop!.saveSvgFile).mockResolvedValueOnce({
      name: "Structured editing.svg",
    });
    renderApp();
    act(() => runtime().setSelection(["feature_one"], "feature_one"));
    await user.click(screen.getByRole("tab", { name: "Properties" }));
    await user.selectOptions(screen.getByLabelText("Format"), "svg");

    await user.click(screen.getByLabelText("Include layer IDs"));
    const padding = screen.getByLabelText("Padding");
    await user.clear(padding);
    await user.type(padding, "16");
    await user.tab();
    act(() => requestExportSvg?.());

    await waitFor(() => expect(window.desktop!.saveSvgFile).toHaveBeenCalled());
    const exportCall = svgHarness.runExport.mock.calls[0];
    expect(exportCall).toBeDefined();
    expect(exportCall?.[0].pageId).toBe("page_welcome");
    expect(exportCall?.[0].rootNodeIds).toEqual(["feature_one"]);
    expect(exportCall?.[0].settings).toEqual({
      includeLayerIds: true,
      padding: 16,
    });
    expect(exportCall?.[0].document.revision).toBe(0);
    expect(exportCall?.[1]).toBeInstanceOf(AbortSignal);
    expect(window.desktop!.saveSvgFile).toHaveBeenCalledWith({
      suggestedName: "Structured editing.svg",
      contents: '<svg viewBox="0 0 304 220"><rect /></svg>',
    });
    expect(screen.getByText("Exported Structured editing.svg")).toBeVisible();
    expect(screen.getByText("boolean-flattened")).toBeVisible();
    expect(runtime().getSnapshot().document.revision).toBe(0);
  });

  it("exports one frozen layer as a delivery PNG through the Main save bridge", async () => {
    const user = userEvent.setup();
    vi.mocked(window.desktop!.saveRasterFile).mockResolvedValueOnce({
      name: "Structured editing.png",
      byteSize: 3,
    });
    renderApp();
    act(() => runtime().setSelection(["feature_one"], "feature_one"));
    await user.click(screen.getByRole("tab", { name: "Properties" }));

    expect(screen.getByLabelText("Format")).toHaveValue("png");
    await user.selectOptions(screen.getByLabelText("Size"), "scale:2");
    await user.click(
      screen.getByRole("button", { name: "Export selection as PNG…" }),
    );

    await waitFor(() =>
      expect(window.desktop!.saveRasterFile).toHaveBeenCalledOnce(),
    );
    const call = rasterHarness.export.mock.calls[0];
    expect(call?.[0].revision).toBe(0);
    expect(call?.[1]).toMatchObject({
      version: 1,
      pageId: "page_welcome",
      rootNodeId: "feature_one",
      format: "png",
      size: { mode: "scale", value: 2 },
      background: { mode: "transparent" },
      resampling: "smooth",
    });
    expect(call?.[2]).toBeInstanceOf(AbortSignal);
    expect(window.desktop!.saveRasterFile).toHaveBeenCalledWith({
      suggestedName: "Structured editing",
      format: "png",
      mimeType: "image/png",
      bytes: new Uint8Array([4, 5, 6]),
      width: 1_200,
      height: 720,
    });
    expect(screen.getByText("Exported Structured editing.png")).toBeVisible();
    expect(screen.queryByText("PNG · 1200 × 720 px · 3 B")).toBeNull();
    expect(runtime().getSnapshot().document.revision).toBe(0);
  });

  it("cancels background SVG parsing without changing the document", async () => {
    const user = userEvent.setup();
    let workerSignal: AbortSignal | undefined;
    vi.mocked(window.desktop!.openSvgFile).mockResolvedValueOnce({
      name: "Large.svg",
      contents: "<svg />",
    });
    svgHarness.runImport.mockImplementationOnce(
      (_input: unknown, signal: AbortSignal | undefined) =>
        new Promise((_resolve, reject) => {
          workerSignal = signal;
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    renderApp();

    act(() => requestImportSvg?.());
    expect(await screen.findByText("Importing Large.svg")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(workerSignal?.aborted).toBe(true));
    await waitFor(() =>
      expect(screen.queryByText("Importing Large.svg")).toBeNull(),
    );
    expect(runtime().getSnapshot().document.revision).toBe(0);
    expect(window.desktop!.reportDiagnostic).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "svg_import_failed" }),
    );
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

  it("opens a Conversation directly from the Workspace Project tree", async () => {
    const user = userEvent.setup();
    const manifest = projectManifest();
    const conversation = conversationDescriptor();
    vi.mocked(window.desktop!.listRecentProjects).mockResolvedValueOnce([
      { projectId: manifest.projectId, name: manifest.name, lastOpenedAt: now },
    ]);
    vi.mocked(window.desktop!.listConversations).mockResolvedValueOnce([
      conversation,
    ]);
    vi.mocked(window.desktop!.openRecentProject).mockResolvedValueOnce(
      manifest,
    );
    mockConversationTargetResolution(manifest);
    mockProjectDesignFileRead(manifest);

    renderApp("workspace");
    await user.click(
      await screen.findByRole("button", {
        name: "Refine the mobile experience",
      }),
    );

    expect(window.desktop?.openRecentProject).toHaveBeenCalledOnce();
    expect(window.desktop?.openRecentProject).toHaveBeenCalledWith({
      projectId: manifest.projectId,
    });
    expect(
      await screen.findByRole("combobox", { name: "Conversation" }),
    ).toHaveTextContent("Refine the mobile experience");
    expect(historyRequests(conversation.conversationId)).toHaveLength(1);
  });

  it("keeps Conversation history readable and disables composition when its target is unavailable", async () => {
    const user = userEvent.setup();
    const conversation = conversationDescriptor({ filedProjectId: null });
    vi.mocked(window.desktop!.listConversations).mockResolvedValueOnce([
      conversation,
    ]);

    renderApp("workspace");
    await user.click(
      await screen.findByRole("button", { name: conversation.title }),
    );

    expect(await screen.findByText("Design target unavailable")).toBeVisible();
    expect(screen.getByLabelText("Continue the task")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(historyRequests(conversation.conversationId)).toHaveLength(1);
    expect(window.desktop?.openRecentProject).not.toHaveBeenCalled();
    expect(window.desktop?.readProjectDesignFile).not.toHaveBeenCalled();
  });

  it("deletes a terminal Conversation from Workspace without deleting its Project", async () => {
    const user = userEvent.setup();
    const manifest = projectManifest();
    const conversation = conversationDescriptor();
    vi.mocked(window.desktop!.listRecentProjects).mockResolvedValueOnce([
      { projectId: manifest.projectId, name: manifest.name, lastOpenedAt: now },
    ]);
    vi.mocked(window.desktop!.listConversations).mockResolvedValueOnce([
      conversation,
    ]);
    vi.mocked(window.desktop!.deleteConversation).mockResolvedValueOnce({
      ...conversation,
      lifecycle: "deleted",
      updatedAt: "2026-08-07T12:01:00.000Z",
    });

    renderApp("workspace");
    expect(
      await screen.findByRole("button", {
        name: "Refine the mobile experience",
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Actions for Refine the mobile experience",
      }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Delete Conversation" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(window.desktop?.deleteConversation).toHaveBeenCalledWith({
      conversationId: conversation.conversationId,
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "Refine the mobile experience",
        }),
      ).toBeNull(),
    );
    expect(screen.getByText(manifest.name)).toBeInTheDocument();
  });

  it("requires an active Conversation task to stop before deletion", async () => {
    const user = userEvent.setup();
    const manifest = projectManifest();
    const conversation = conversationDescriptor();
    vi.mocked(window.desktop!.listRecentProjects).mockResolvedValueOnce([
      { projectId: manifest.projectId, name: manifest.name, lastOpenedAt: now },
    ]);
    vi.mocked(window.desktop!.listConversations).mockResolvedValueOnce([
      conversation,
    ]);
    vi.mocked(window.desktop!.listGlobalTasks).mockResolvedValueOnce([
      globalTask("running", { conversationId: conversation.conversationId }),
    ]);

    renderApp("workspace");
    await screen.findByRole("button", { name: "Refine the mobile experience" });
    await user.click(
      screen.getByRole("button", {
        name: "Actions for Refine the mobile experience",
      }),
    );

    expect(
      screen.getByRole("menuitem", { name: "Stop the task before deleting" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(window.desktop?.deleteConversation).not.toHaveBeenCalled();
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
    vi.mocked(window.desktop!.listConversations).mockResolvedValueOnce([
      existing,
    ]);
    vi.mocked(window.desktop!.createConversation).mockResolvedValueOnce(
      created,
    );

    renderApp("workspace");
    await user.click(
      await screen.findByRole("button", { name: /^Acme Design/ }),
    );
    expect(window.desktop?.listConversations).toHaveBeenCalledWith();
    expect(
      await screen.findByRole("button", {
        name: "Refine the mobile experience",
      }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Conversation title"),
      "Design the website launch",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(window.desktop?.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        filedProjectId: manifest.projectId,
        title: "Design the website launch",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Design the website launch" }),
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
    await user.click(screen.getByRole("button", { name: "Conversation A" }));
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

    expect(await screen.findByText("History from A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Acme Design" }));
    await user.click(screen.getByRole("button", { name: "Conversation B" }));
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

    expect(await screen.findByText("History from B")).toBeInTheDocument();
    expect(screen.queryByText("History from A")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Acme Design" }));
    await user.click(screen.getByRole("button", { name: "Conversation A" }));
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
    await user.click(screen.getByRole("button", { name: "Conversation A" }));

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
    const canvas = screen.getByRole("main", { name: "Design canvas" });
    expect(
      within(canvas).queryByText("Preparing the first real design"),
    ).not.toBeInTheDocument();
    const runStatus = screen.getByRole("status", {
      name: "Design run status",
    });
    expect(runStatus).toHaveTextContent("Preparing the first real design");
    expect(runStatus).toHaveTextContent(
      "Waiting for the model · the canvas has not changed yet",
    );

    await user.click(screen.getByRole("button", { name: "Acme Design" }));
    await user.click(screen.getByRole("button", { name: "Conversation B" }));
    expect(screen.getByLabelText("Continue the task")).toBeEnabled();

    await user.type(screen.getByLabelText("Continue the task"), "Run B");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(runRequests(second.conversationId)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Acme Design" }));
    await user.click(screen.getByRole("button", { name: "Conversation A" }));

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
    await user.click(
      screen.getByRole("button", { name: "Recent Conversation" }),
    );
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

    await user.click(screen.getByRole("button", { name: "Conversation B" }));
    await user.click(screen.getByRole("button", { name: "Acme Design" }));
    await user.click(screen.getByRole("button", { name: "Conversation A" }));
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
    expect(await screen.findByText("Current history")).toBeInTheDocument();
    expect(screen.queryByText("Stale history")).not.toBeInTheDocument();
  });

  it("keeps completed messages visible through more than 200 live events and refreshes durable history during an active Run", async () => {
    const { user, conversation } = await openProjectConversation();
    const initialHistory = historyRequests(conversation.conversationId).at(-1);
    if (!initialHistory) throw new Error("Initial history request is missing");
    act(() => {
      emitAgentEvent?.({
        type: "session.history",
        requestId: initialHistory.requestId,
        sessionId: conversation.conversationId,
        timeline: [],
      });
    });

    await user.type(screen.getByLabelText("Continue the task"), "Keep history");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const run = runRequests(conversation.conversationId).at(-1);
    if (!run) throw new Error("Run request is missing");
    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: run.runId,
        startedAt: now,
      });
      emitAgentEvent?.({
        type: "message.completed",
        runId: run.runId,
        messageId: "message_first_completed",
        blocks: [
          {
            blockId: "block_first_completed",
            type: "text",
            text: "First completed response",
          },
        ],
      });
      for (let index = 0; index < 205; index += 1) {
        emitAgentEvent?.({
          type: "tool.progress",
          runId: run.runId,
          toolCallId: "tool_long_running",
          progress: index / 205,
          message: `progress ${index}`,
        });
      }
    });

    expect(screen.getByText("First completed response")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        historyRequests(conversation.conversationId).length,
      ).toBeGreaterThan(1),
    );
    const checkpointHistory = historyRequests(conversation.conversationId).at(
      -1,
    );
    if (!checkpointHistory) {
      throw new Error("Checkpoint history request is missing");
    }
    act(() => {
      emitAgentEvent?.({
        type: "session.history",
        requestId: checkpointHistory.requestId,
        sessionId: conversation.conversationId,
        timeline: [
          {
            itemId: "run:history_active",
            sessionId: conversation.conversationId,
            runId: run.runId,
            sequence: 1,
            createdAt: now,
            updatedAt: now,
            type: "run",
            status: "started",
            startedAt: now,
          },
          {
            itemId: "message:message_first_completed",
            sessionId: conversation.conversationId,
            runId: run.runId,
            sequence: 2,
            createdAt: now,
            updatedAt: now,
            type: "assistant.message",
            messageId: "message_first_completed",
            blocks: [
              {
                blockId: "block_first_completed",
                type: "text",
                text: "First completed response",
              },
            ],
          },
        ],
      });
    });

    expect(screen.getByText("First completed response")).toBeInTheDocument();
    expect(screen.getByText("Request in progress")).toBeInTheDocument();
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

  it("opens a Global Task at its primary target and Conversation", async () => {
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
    vi.mocked(window.desktop!.listConversations).mockResolvedValueOnce([
      first,
      second,
    ]);
    mockProjectDesignFileRead(manifest);

    const user = userEvent.setup();
    renderApp("workspace");
    await user.click(await screen.findByRole("button", { name: "Open" }));

    expect(window.desktop?.openRecentProject).toHaveBeenCalledWith({
      projectId: task.targetSet.primaryTarget.projectId,
    });
    expect(
      await screen.findByRole("combobox", { name: "Conversation" }),
    ).toHaveTextContent("Conversation B");
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

  it("automatically saves a changed Project Design File", async () => {
    await openProjectConversation();
    const current = runtime().getSnapshot().document;
    act(() => {
      const result = runtime().apply({
        transactionId: "user_autosave_change",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "local-user" },
        label: "Rename frame",
        commands: [
          {
            commandId: "rename_for_autosave",
            type: "update_properties",
            nodeId: "frame_welcome",
            name: "Autosaved workspace",
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
    });
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "true");

    await waitFor(
      () => {
        const request = vi
          .mocked(window.desktop!.saveProjectDesignFile)
          .mock.calls.at(-1)?.[0];
        expect(request?.projectId).toBe("project_acme");
        expect(request?.designFileId).toBe("design_mobile");
        expect(request?.document.revision).toBe(1);
        expect(runtimeOutput()).toHaveAttribute("data-dirty", "false");
      },
      { timeout: 2_000 },
    );
  });

  it("persists an inline Design File rename without saving document content", async () => {
    const { user, manifest } = await openProjectConversation();
    const descriptor = manifest.designFiles[0];
    if (!descriptor) throw new Error("Mobile design file is missing");
    vi.mocked(window.desktop!.renameProjectDesignFile).mockResolvedValueOnce({
      ...descriptor,
      name: "Launch poster",
      updatedAt: "2026-08-11T12:00:00.000Z",
    });

    await user.dblClick(screen.getByRole("tab", { name: descriptor.name }));
    const input = screen.getByRole("textbox", {
      name: `Rename ${descriptor.name}`,
    });
    await user.clear(input);
    await user.type(input, "Launch poster{Enter}");

    expect(window.desktop!.renameProjectDesignFile).toHaveBeenCalledWith({
      projectId: manifest.projectId,
      designFileId: descriptor.designFileId,
      name: "Launch poster",
    });
    expect(window.desktop!.saveProjectDesignFile).not.toHaveBeenCalled();
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "false");
    expect(await screen.findAllByText("Launch poster")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: manifest.name }));
    expect(
      await screen.findByRole("button", { name: /Launch poster/ }),
    ).toBeInTheDocument();
  });

  it("keeps inline Design File rename editable after persistence fails", async () => {
    const { user, manifest } = await openProjectConversation();
    const descriptor = manifest.designFiles[0];
    if (!descriptor) throw new Error("Mobile design file is missing");
    vi.mocked(window.desktop!.renameProjectDesignFile).mockRejectedValueOnce(
      new Error("Project manifest is read-only"),
    );

    await user.dblClick(screen.getByRole("tab", { name: descriptor.name }));
    const input = screen.getByRole("textbox", {
      name: `Rename ${descriptor.name}`,
    });
    await user.clear(input);
    await user.type(input, "Retry name{Enter}");

    expect(
      await screen.findByRole("textbox", { name: `Rename ${descriptor.name}` }),
    ).toHaveFocus();
    expect(
      await screen.findByText("Project manifest is read-only"),
    ).toBeInTheDocument();
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "false");
    await waitFor(() =>
      expect(window.desktop!.reportDiagnostic).toHaveBeenCalledWith({
        level: "error",
        presentation: "toast",
        code: "design_file_rename_failed",
        message: "Project manifest is read-only",
        context: {
          projectId: manifest.projectId,
          designFileId: descriptor.designFileId,
        },
      }),
    );
  });

  it("keeps a Project Design File dirty and reports autosave failures", async () => {
    await openProjectConversation();
    vi.mocked(window.desktop!.saveProjectDesignFile).mockRejectedValueOnce(
      new Error("Disk is read-only"),
    );
    const current = runtime().getSnapshot().document;
    act(() => {
      const result = runtime().apply({
        transactionId: "user_autosave_failure",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "local-user" },
        label: "Rename without persistence",
        commands: [
          {
            commandId: "rename_for_autosave_failure",
            type: "update_properties",
            nodeId: "frame_welcome",
            name: "Still dirty",
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
    });

    expect(await screen.findByText("Disk is read-only")).toBeInTheDocument();
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "true");
    await waitFor(() =>
      expect(window.desktop!.reportDiagnostic).toHaveBeenCalledWith({
        level: "error",
        presentation: "toast",
        code: "design_autosave_failed",
        message: "Disk is read-only",
        context: {
          projectId: "project_acme",
          designFileId: "design_mobile",
        },
      }),
    );
  });

  it("does not silently overwrite an independently opened design document", async () => {
    renderApp();
    const current = runtime().getSnapshot().document;
    act(() => {
      const result = runtime().apply({
        transactionId: "external_document_change",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "local-user" },
        label: "Edit external document",
        commands: [
          {
            commandId: "rename_external_document_frame",
            type: "update_properties",
            nodeId: "frame_welcome",
            name: "Explicit save required",
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(window.desktop!.saveProjectDesignFile).not.toHaveBeenCalled();
    expect(window.desktop!.saveDesignFile).not.toHaveBeenCalled();
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "true");
  });

  it("flushes a pending Project Design File before closing the window", async () => {
    const { manifest } = await openProjectConversation();
    const descriptor = manifest.designFiles[0];
    if (!descriptor) throw new Error("Mobile design file is missing");
    let finishSave!: (saved: ProjectDesignFile) => void;
    const pendingSave = new Promise<ProjectDesignFile>((resolve) => {
      finishSave = resolve;
    });
    vi.mocked(window.desktop!.saveProjectDesignFile).mockReturnValueOnce(
      pendingSave,
    );
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const current = runtime().getSnapshot().document;
    act(() => {
      const result = runtime().apply({
        transactionId: "user_change_before_close",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "local-user" },
        label: "Rename before close",
        commands: [
          {
            commandId: "rename_before_close",
            type: "update_properties",
            nodeId: "frame_welcome",
            name: "Saved before close",
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
    });

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    let closeAllowed = true;
    act(() => {
      closeAllowed = window.dispatchEvent(beforeUnload);
    });

    expect(closeAllowed).toBe(false);
    expect(beforeUnload.defaultPrevented).toBe(true);
    await waitFor(() => {
      const request = vi
        .mocked(window.desktop!.saveProjectDesignFile)
        .mock.calls.at(-1)?.[0];
      expect(request?.projectId).toBe(manifest.projectId);
      expect(request?.designFileId).toBe(descriptor.designFileId);
      expect(request?.document.revision).toBe(1);
    });
    expect(close).not.toHaveBeenCalled();

    finishSave({
      descriptor: {
        ...descriptor,
        updatedAt: "2026-08-11T12:00:00.000Z",
      },
      document: runtime().getSnapshot().document,
    });
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    close.mockRestore();
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

  it("switches tools through EditorRuntime and exposes Pen by toolbar and P", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Rectangle (R)" }));
    expect(
      screen.getByRole("button", { name: "Rectangle (R)" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Pen (P)" }));
    expect(screen.getByRole("button", { name: "Pen (P)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(window, { code: "KeyV", key: "v" });
    expect(runtimeOutput()).toHaveAttribute("data-tool", "select");
    fireEvent.keyDown(window, { code: "KeyP", key: "p" });
    expect(runtimeOutput()).toHaveAttribute("data-tool", "pen");
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

  it("creates, names, duplicates, and deletes Pages through EditorRuntime", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "Create Page" }));
    const pageName = screen.getByRole("textbox", { name: "Rename Page 2" });
    expect(pageName).toHaveFocus();
    await user.clear(pageName);
    await user.type(pageName, "Research{Enter}");

    expect(runtime().getSnapshot().document.pageOrder).toHaveLength(2);
    expect(
      Object.values(runtime().getSnapshot().document.pagesById).map(
        (page) => page.name,
      ),
    ).toEqual(["Welcome", "Research"]);
    expect(runtimeOutput()).toHaveAttribute("data-revision", "2");
    expect(screen.getByRole("button", { name: "Research" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(
      screen.getByRole("button", { name: "Actions for Research" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(runtime().getSnapshot().document.pageOrder).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Copy of Research" }),
    ).toHaveAttribute("aria-current", "page");

    await user.click(
      screen.getByRole("button", { name: "Actions for Copy of Research" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(runtime().getSnapshot().document.pageOrder).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Copy of Research" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Research" })).toHaveAttribute(
      "aria-current",
      "page",
    );
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
      generationMode: "fast",
    });
  });

  it("always starts the Run on the current Page without a persistent write-scope control", async () => {
    const { user } = await openProjectConversation();
    expect(
      screen.queryByRole("combobox", { name: "Agent write scope" }),
    ).not.toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Continue the task"),
      "Create a Research page",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    const request = vi
      .mocked(window.desktop!.sendAgentRequest)
      .mock.calls.find(([candidate]) => candidate.type === "run.start")?.[0];
    expect(request).toMatchObject({
      type: "run.start",
      documentId: "document_mobile",
      scope: {
        kind: "page",
        pageId: "page_welcome",
        selectedNodeIds: [],
      },
      mutationTarget: { kind: "page", pageId: "page_welcome" },
    });
  });

  it.each([
    { button: "Allow this task", decision: "allow_once" as const },
    { button: "Don’t allow", decision: "deny" as const },
  ])(
    "sends an exact $decision response for contextual Page access",
    async ({ button, decision }) => {
      const { user, conversation } = await openProjectConversation();
      await user.type(
        screen.getByLabelText("Continue the task"),
        "Create a Research page",
      );
      await user.click(screen.getByRole("button", { name: "Send" }));
      const request = runRequests(conversation.conversationId).at(-1);
      if (!request) throw new Error("Agent run request is missing");

      act(() => {
        emitAgentEvent?.({
          type: "tool.requested",
          runId: request.runId,
          toolCallId: "tool_page_access",
          toolName: PAGE_STRUCTURE_ACCESS_TOOL_NAME,
          input: {
            actions: ["create-page"],
            reason: "Create the requested Research Page.",
          },
          risk: "design_write",
        });
        emitAgentEvent?.({
          type: "approval.requested",
          runId: request.runId,
          toolCallId: "tool_page_access",
          approvalId: "approval_page_access",
          title: "Allow Page structure changes",
          summary: "Allow this task to create a Page.",
        });
      });

      expect(
        await screen.findByText("Modify Mobile UI Page structure?"),
      ).toBeInTheDocument();
      vi.mocked(window.desktop!.sendAgentRequest).mockClear();
      await user.click(screen.getByRole("button", { name: button }));
      expect(window.desktop!.sendAgentRequest).toHaveBeenCalledWith({
        type: "approval.resolve",
        runId: request.runId,
        toolCallId: "tool_page_access",
        approvalId: "approval_page_access",
        decision,
      });
    },
  );

  it("submits reference images as safe metadata and shows them in the optimistic message", async () => {
    const attachmentId = `image_${"b".repeat(64)}`;
    const previewDataUrl = "data:image/png;base64,aW1hZ2U=";
    vi.mocked(window.desktop!.getModelProviderCatalog).mockResolvedValue({
      version: 3,
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

  it("creates clicked text as Auto Width and dragged text as Fixed size", async () => {
    const user = userEvent.setup();
    renderApp();
    const before = new Set(
      Object.keys(runtime().getSnapshot().document.nodesById),
    );

    await user.click(screen.getByRole("button", { name: "Text (T)" }));
    act(() => {
      leaferCallbacks().onCreate({
        dragged: false,
        height: 1,
        pageId: "page_welcome",
        parentId: "frame_welcome",
        tool: "text",
        width: 1,
        x: 420,
        y: 236,
      });
    });
    let snapshot = runtime().getSnapshot();
    const autoTextId = Object.keys(snapshot.document.nodesById).find(
      (nodeId) => !before.has(nodeId),
    );
    const autoText = snapshot.document.nodesById[autoTextId ?? ""];
    expect(autoText).toMatchObject({
      kind: "text",
      size: { height: 32 },
      properties: {
        textResize: "auto-width",
        textWrap: "none",
        textOverflow: "visible",
      },
    });
    expect(autoText?.size.width).toBeCloseTo(115.2, 6);
    expect(leaferHarness.measureText).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Text (T)" }));
    act(() => {
      leaferCallbacks().onCreate({
        dragged: true,
        height: 96,
        pageId: "page_welcome",
        parentId: "frame_welcome",
        tool: "text",
        width: 320,
        x: 620,
        y: 236,
      });
    });
    snapshot = runtime().getSnapshot();
    const fixedTextId = Object.keys(snapshot.document.nodesById).find(
      (nodeId) => !before.has(nodeId) && nodeId !== autoTextId,
    );
    expect(snapshot.document.nodesById[fixedTextId ?? ""]).toMatchObject({
      kind: "text",
      size: { width: 320, height: 96 },
      properties: {
        textResize: "fixed",
        textWrap: "word",
        textOverflow: "clip",
      },
    });
    expect(leaferHarness.measureText).toHaveBeenCalledTimes(1);
  });

  it("creates editable Line and Arrow nodes from toolbar and keyboard tools", async () => {
    const user = userEvent.setup();
    renderApp();
    const before = new Set(
      Object.keys(runtime().getSnapshot().document.nodesById),
    );

    await user.click(screen.getByRole("button", { name: "Line (L)" }));
    expect(runtimeOutput()).toHaveAttribute("data-tool", "line");
    act(() => {
      leaferCallbacks().onCreate({
        dragged: true,
        height: 0,
        pageId: "page_welcome",
        parentId: "frame_welcome",
        tool: "line",
        width: 180,
        x: 420,
        y: 236,
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
      });
    });
    let snapshot = runtime().getSnapshot();
    const lineId = Object.keys(snapshot.document.nodesById).find(
      (nodeId) => !before.has(nodeId),
    );
    expect(snapshot.document.nodesById[lineId ?? ""]).toMatchObject({
      kind: "line",
      size: { width: 180, height: 0 },
      properties: {
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        startEndpoint: "none",
        endEndpoint: "none",
      },
    });
    expect(snapshot.state.selection.nodeIds).toEqual([lineId]);
    expect(snapshot.state.tool).toBe("select");

    fireEvent.keyDown(window, { code: "KeyL", key: "L", shiftKey: true });
    expect(runtimeOutput()).toHaveAttribute("data-tool", "arrow");
    act(() => {
      leaferCallbacks().onCreate({
        dragged: true,
        height: 90,
        pageId: "page_welcome",
        parentId: "frame_welcome",
        tool: "arrow",
        width: 140,
        x: 600,
        y: 260,
        start: { x: 1, y: 1 },
        end: { x: 0, y: 0 },
      });
    });
    snapshot = runtime().getSnapshot();
    const arrowId = Object.keys(snapshot.document.nodesById).find(
      (nodeId) => !before.has(nodeId) && nodeId !== lineId,
    );
    expect(snapshot.document.nodesById[arrowId ?? ""]).toMatchObject({
      kind: "line",
      size: { width: 140, height: 90 },
      properties: {
        start: { x: 1, y: 1 },
        end: { x: 0, y: 0 },
        startEndpoint: "none",
        endEndpoint: "line-arrow",
      },
    });
    expect(snapshot.state.selection.nodeIds).toEqual([arrowId]);
    expect(snapshot.state.tool).toBe("select");
    expect(snapshot.document.revision).toBe(2);

    fireEvent.keyDown(window, { code: "KeyL", key: "l" });
    expect(runtimeOutput()).toHaveAttribute("data-tool", "line");
  });

  it("commits one editable Pen vector transaction without leaving the Pen tool", async () => {
    const user = userEvent.setup();
    renderApp();
    const before = new Set(
      Object.keys(runtime().getSnapshot().document.nodesById),
    );

    await user.click(screen.getByRole("button", { name: "Pen (P)" }));
    act(() => {
      leaferCallbacks().onCreateVector({
        closed: false,
        height: 100,
        network: {
          vertices: [
            { id: "vertex_1", x: 0, y: 0 },
            { id: "vertex_2", x: 120, y: 40 },
            { id: "vertex_3", x: 80, y: 100 },
          ],
          segments: [
            {
              id: "segment_1",
              startVertexId: "vertex_1",
              endVertexId: "vertex_2",
              tangentStart: { x: 30, y: 0 },
              tangentEnd: { x: -20, y: -10 },
            },
            {
              id: "segment_2",
              startVertexId: "vertex_2",
              endVertexId: "vertex_3",
            },
          ],
          paths: [
            {
              id: "path_1",
              closed: false,
              segments: [
                { segmentId: "segment_1", reversed: false },
                { segmentId: "segment_2", reversed: false },
              ],
            },
          ],
          regions: [],
        },
        pageId: "page_welcome",
        parentId: "frame_welcome",
        width: 120,
        x: 360,
        y: 220,
      });
    });

    const snapshot = runtime().getSnapshot();
    const vectorId = Object.keys(snapshot.document.nodesById).find(
      (nodeId) => !before.has(nodeId),
    );
    const insertedVector = snapshot.document.nodesById[vectorId ?? ""];
    expect(insertedVector).toMatchObject({
      kind: "vector",
      parentId: "frame_welcome",
      size: { width: 120, height: 100 },
      transform: [1, 0, 0, 1, 360, 220],
      properties: {
        fills: [],
        strokes: [{ type: "solid", color: "#151515", opacity: 1 }],
      },
    });
    if (
      !insertedVector ||
      insertedVector.kind !== "vector" ||
      !("network" in insertedVector.properties)
    ) {
      throw new Error("Missing inserted editable vector");
    }
    expect(
      insertedVector.properties.network.vertices.map(({ id }) => id),
    ).toContain("vertex_1");
    expect(insertedVector.properties.network.paths[0]?.closed).toBe(false);
    expect(snapshot.document.revision).toBe(1);
    expect(snapshot.state.selection.nodeIds).toEqual([vectorId]);
    expect(snapshot.state.tool).toBe("pen");
  });

  it("creates semantic Polygon and Star nodes as undoable document transactions", async () => {
    const user = userEvent.setup();
    renderApp();
    const before = new Set(
      Object.keys(runtime().getSnapshot().document.nodesById),
    );

    await user.click(screen.getByRole("button", { name: "Polygon" }));
    expect(runtimeOutput()).toHaveAttribute("data-tool", "polygon");
    act(() => {
      leaferCallbacks().onCreate({
        dragged: true,
        height: 120,
        pageId: "page_welcome",
        parentId: "frame_welcome",
        tool: "polygon",
        width: 160,
        x: 420,
        y: 236,
      });
    });
    let snapshot = runtime().getSnapshot();
    const polygonId = Object.keys(snapshot.document.nodesById).find(
      (nodeId) => !before.has(nodeId),
    );
    expect(snapshot.document.nodesById[polygonId ?? ""]).toMatchObject({
      kind: "polygon",
      parentId: "frame_welcome",
      size: { width: 160, height: 120 },
      properties: { pointCount: 3, cornerRadius: 0 },
    });
    expect(snapshot.state.selection.nodeIds).toEqual([polygonId]);
    expect(snapshot.state.tool).toBe("select");

    await user.click(screen.getByRole("button", { name: "Star" }));
    act(() => {
      leaferCallbacks().onCreate({
        dragged: true,
        height: 140,
        pageId: "page_welcome",
        parentId: "frame_welcome",
        tool: "star",
        width: 140,
        x: 620,
        y: 236,
      });
    });
    snapshot = runtime().getSnapshot();
    const starId = Object.keys(snapshot.document.nodesById).find(
      (nodeId) => !before.has(nodeId) && nodeId !== polygonId,
    );
    expect(snapshot.document.nodesById[starId ?? ""]).toMatchObject({
      kind: "star",
      parentId: "frame_welcome",
      size: { width: 140, height: 140 },
      properties: {
        pointCount: 5,
        innerRadius: 0.382,
        cornerRadius: 0,
      },
    });
    expect(snapshot.document.revision).toBe(2);

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.nodesById[starId ?? ""],
    ).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(
      runtime().getSnapshot().document.nodesById[starId ?? ""],
    ).toMatchObject({
      kind: "star",
    });
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
        selectionNodeIds: ["feature_one"],
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

  it("uses constraints for single populated Frame canvas resize", () => {
    renderApp();
    const current = runtime().getSnapshot().document;
    const setConstraints = current.nodesById.title_welcome;
    if (!setConstraints) throw new Error("missing title");
    act(() => {
      runtime().apply({
        transactionId: "set_title_constraints",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "test" },
        commands: [
          {
            commandId: "set_constraints",
            type: "update_properties",
            nodeId: "title_welcome",
            constraints: { horizontal: "left-right", vertical: "top" },
          },
        ],
      });
      runtime().setSelection(["frame_welcome"], "frame_welcome");
    });
    act(() => {
      leaferCallbacks().onOperations({
        kind: "resize",
        selectionNodeIds: ["frame_welcome"],
        operations: [
          {
            commandId: "resize_frame",
            type: "update_properties",
            nodeId: "frame_welcome",
            size: { width: 1600, height: 900 },
          },
          {
            commandId: "leafer_scaled_title",
            type: "update_properties",
            nodeId: "title_welcome",
            size: { width: 1028, height: 90 },
          },
        ],
      });
    });
    const resized = runtime().getSnapshot();
    expect(resized.document.nodesById.frame_welcome?.size).toEqual({
      width: 1600,
      height: 900,
    });
    expect(resized.document.nodesById.title_welcome?.size).toEqual({
      width: 1200,
      height: 72,
    });
    expect(resized.document.revision).toBe(2);
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

  it("edits non-destructive image crop properties and replaces the source atomically", async () => {
    const user = userEvent.setup();
    renderApp();
    const oldAssetId = `asset_${"a".repeat(64)}`;
    const newAssetId = `asset_${"b".repeat(64)}`;
    act(() => {
      const current = runtime().getSnapshot().document;
      const result = runtime().apply({
        transactionId: "insert_image_fixture",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "test" },
        commands: [
          {
            commandId: "put_old_image",
            type: "put_asset",
            asset: {
              id: oldAssetId,
              kind: "image",
              name: "Old hero",
              mimeType: "image/png",
              source: { type: "data", value: "aW1hZ2U=" },
              size: { width: 800, height: 600 },
              extensions: {},
            },
          },
          {
            commandId: "insert_hero_image",
            type: "insert_element",
            pageId: "page_welcome",
            parentId: null,
            index: 1,
            node: {
              id: "hero_image",
              kind: "image",
              name: "Hero image",
              parentId: null,
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, 100, 120],
              size: { width: 400, height: 300 },
              exportSettings: [],
              opacity: 1,
              properties: {
                assetId: oldAssetId,
                placement: { mode: "fit" },
                altText: "Hero",
                cornerRadius: 0,
              },
              extensions: {},
            },
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      runtime().setSelection(["hero_image"], "hero_image");
    });
    await user.click(screen.getByRole("tab", { name: "Properties" }));

    await user.click(screen.getByRole("button", { name: "Crop on canvas" }));
    expect(leaferHarness.startImageCrop).toHaveBeenCalledWith("hero_image");

    act(() => {
      leaferCallbacks().onImageCropStateChange?.({
        nodeId: "hero_image",
        placement: {
          mode: "crop",
          focalPoint: { x: 0.5, y: 0.5 },
          zoom: 1.2,
          rotation: 0,
          flipHorizontal: false,
          flipVertical: false,
        },
      });
    });
    expect(screen.getByText("Cropping Hero image")).toBeVisible();
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), {
      target: { value: "150" },
    });
    expect(leaferHarness.updateImageCropZoom).toHaveBeenCalledWith(1.5);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(leaferHarness.resetImageCrop).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("main", { name: "Design canvas" }), {
      key: "Escape",
    });
    expect(leaferHarness.cancelImageCrop).toHaveBeenCalledTimes(1);
    act(() => leaferCallbacks().onImageCropStateChange?.(null));
    expect(screen.queryByText("Cropping Hero image")).toBeNull();

    const beforeCanvasCrop = runtime().getSnapshot().document.revision;
    let cropAccepted = false;
    act(() => {
      cropAccepted =
        leaferCallbacks().onImageCropCommit?.({
          nodeId: "hero_image",
          placement: {
            mode: "crop",
            focalPoint: { x: 0.45, y: 0.55 },
            zoom: 1.2,
            rotation: 0,
            flipHorizontal: false,
            flipVertical: false,
          },
        }) ?? false;
    });
    expect(cropAccepted).toBe(true);
    expect(runtime().getSnapshot().document.revision).toBe(
      beforeCanvasCrop + 1,
    );

    fireEvent.change(screen.getByLabelText("Placement"), {
      target: { value: "crop" },
    });
    expect(runtime().getSnapshot().document.nodesById.hero_image).toMatchObject(
      {
        properties: {
          placement: {
            mode: "crop",
            focalPoint: { x: 0.45, y: 0.55 },
            zoom: 1.2,
            rotation: 0,
            flipHorizontal: false,
            flipVertical: false,
          },
        },
      },
    );

    const zoom = screen.getByLabelText("Crop zoom");
    await user.clear(zoom);
    await user.type(zoom, "140");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Flip H" }));

    const exposure = screen.getByRole("slider", { name: "Exposure" });
    fireEvent.change(exposure, { target: { value: "20" } });
    fireEvent.pointerUp(exposure, { target: { value: "20" } });
    expect(runtime().getSnapshot().document.nodesById.hero_image).toMatchObject(
      { properties: { filters: { exposure: 0.2 } } },
    );

    vi.mocked(window.desktop!.selectDesignImage).mockResolvedValueOnce({
      asset: {
        id: newAssetId,
        kind: "image",
        name: "New hero",
        mimeType: "image/webp",
        source: { type: "data", value: "bmV3LWltYWdl" },
        size: { width: 1600, height: 900 },
        extensions: { importedBy: "design-image-picker" },
      },
    });
    await user.click(screen.getByRole("button", { name: "Replace image…" }));
    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.nodesById.hero_image,
      ).toMatchObject({
        properties: {
          assetId: newAssetId,
          placement: {
            mode: "crop",
            zoom: 1.4,
            flipHorizontal: true,
          },
          filters: { exposure: 0.2 },
        },
      }),
    );
    expect(
      runtime().getSnapshot().document.assetsById[oldAssetId],
    ).toBeDefined();
    expect(
      runtime().getSnapshot().document.assetsById[newAssetId],
    ).toBeDefined();
    expect(
      Object.values(runtime().getSnapshot().document.imageAssetDerivationsById),
    ).toEqual([
      expect.objectContaining({
        sourceAssetId: oldAssetId,
        resultAssetId: newAssetId,
        operation: "replacement",
      }),
    ]);

    expect(screen.getByLabelText("Version")).toHaveValue(newAssetId);
    await user.click(screen.getByRole("button", { name: "Restore original" }));
    expect(runtime().getSnapshot().document.nodesById.hero_image).toMatchObject(
      { properties: { assetId: oldAssetId } },
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(runtime().getSnapshot().document.nodesById.hero_image).toMatchObject(
      { properties: { assetId: newAssetId } },
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(runtime().getSnapshot().document.nodesById.hero_image).toMatchObject(
      { properties: { assetId: oldAssetId } },
    );
    expect(
      runtime().getSnapshot().document.assetsById[oldAssetId],
    ).toBeDefined();
    expect(
      runtime().getSnapshot().document.assetsById[newAssetId],
    ).toBeUndefined();
  });

  it("keeps shared image assets and leaves the document unchanged on cancel or picker failure", async () => {
    const user = userEvent.setup();
    renderApp();
    const oldAssetId = `asset_${"c".repeat(64)}`;
    const newAssetId = `asset_${"d".repeat(64)}`;
    act(() => {
      const current = runtime().getSnapshot().document;
      const result = runtime().apply({
        transactionId: "insert_shared_image_fixture",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "test" },
        commands: [
          {
            commandId: "put_shared_image",
            type: "put_asset",
            asset: {
              id: oldAssetId,
              kind: "image",
              name: "Shared source",
              mimeType: "image/png",
              source: { type: "data", value: "c2hhcmVk" },
              size: { width: 1200, height: 800 },
              extensions: {},
            },
          },
          ...["shared_hero", "shared_thumbnail"].map((nodeId, index) => ({
            commandId: `insert_${nodeId}`,
            type: "insert_element" as const,
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 4 + index,
            node: {
              id: nodeId,
              kind: "image" as const,
              name:
                nodeId === "shared_hero" ? "Shared hero" : "Shared thumbnail",
              parentId: "frame_welcome",
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, 100 + index * 340, 120] as const,
              size: { width: 320, height: 240 },
              exportSettings: [],
              opacity: 1,
              properties: {
                assetId: oldAssetId,
                placement: { mode: "fit" as const },
                altText: "",
                cornerRadius: 0,
              },
              extensions: {},
            },
          })),
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      runtime().setSelection(["shared_hero"], "shared_hero");
    });
    await user.click(screen.getByRole("tab", { name: "Properties" }));
    const replace = screen.getByRole("button", { name: "Replace image…" });

    const beforeCancel = runtime().getSnapshot().document.revision;
    await user.click(replace);
    expect(runtime().getSnapshot().document.revision).toBe(beforeCancel);

    vi.mocked(window.desktop!.selectDesignImage).mockRejectedValueOnce(
      new Error("picker failed"),
    );
    await user.click(replace);
    expect(
      await screen.findByText("Could not replace the image"),
    ).toBeVisible();
    expect(runtime().getSnapshot().document.revision).toBe(beforeCancel);

    vi.mocked(window.desktop!.selectDesignImage).mockResolvedValueOnce({
      asset: {
        id: newAssetId,
        kind: "image",
        name: "Replacement",
        mimeType: "image/webp",
        source: { type: "data", value: "cmVwbGFjZW1lbnQ=" },
        size: { width: 1600, height: 900 },
        extensions: {},
      },
    });
    await user.click(replace);
    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.nodesById.shared_hero,
      ).toMatchObject({ properties: { assetId: newAssetId } }),
    );
    expect(
      runtime().getSnapshot().document.nodesById.shared_thumbnail,
    ).toMatchObject({ properties: { assetId: oldAssetId } });
    expect(
      runtime().getSnapshot().document.assetsById[oldAssetId],
    ).toBeDefined();
  });

  it("applies trusted image edits as recoverable source transactions", async () => {
    const user = userEvent.setup();
    renderApp();
    const sourceAssetId = `asset_${"1".repeat(64)}`;
    const resultAssetId = `asset_${"2".repeat(64)}`;
    act(() => {
      const current = runtime().getSnapshot().document;
      const result = runtime().apply({
        transactionId: "insert_background_removal_fixture",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "test" },
        commands: [
          {
            commandId: "put_background_source",
            type: "put_asset",
            asset: {
              id: sourceAssetId,
              kind: "image",
              name: "Portrait",
              mimeType: "image/png",
              source: { type: "data", value: "aW1hZ2U=" },
              size: { width: 800, height: 600 },
              extensions: {},
            },
          },
          {
            commandId: "insert_background_image",
            type: "insert_element",
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 4,
            node: {
              id: "background_image",
              kind: "image",
              name: "Portrait",
              parentId: "frame_welcome",
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, 100, 120],
              size: { width: 400, height: 300 },
              exportSettings: [],
              opacity: 1,
              properties: {
                assetId: sourceAssetId,
                placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
                filters: { contrast: 0.2 },
                altText: "Portrait",
                cornerRadius: 12,
              },
              extensions: {},
            },
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      runtime().setSelection(["background_image"], "background_image");
    });
    vi.mocked(window.desktop!.editDesignImage).mockImplementationOnce(
      (request) =>
        Promise.resolve({
          requestId: request.requestId,
          action: "remove-background",
          sourceAssetId,
          asset: {
            id: resultAssetId,
            kind: "image",
            name: "Portrait — Background removed.png",
            mimeType: "image/png",
            source: { type: "data", value: "ZWRpdGVk" },
            size: { width: 800, height: 600 },
            extensions: { importedBy: "inspector-image-edit" },
          },
          derivation: {
            id: "remove_background_result",
            sourceAssetId,
            resultAssetId,
            operation: "remove-background",
            referenceAssetIds: [],
            extensions: { modelId: "gpt-image-2" },
          },
        }),
    );

    await user.click(screen.getByRole("tab", { name: "Properties" }));
    await user.click(
      screen.getByRole("button", { name: "More image actions" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Remove background" }),
    );
    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.nodesById.background_image,
      ).toMatchObject({
        properties: {
          assetId: resultAssetId,
          placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
          filters: { contrast: 0.2 },
          cornerRadius: 12,
        },
      }),
    );
    expect(
      runtime().getSnapshot().document.imageAssetDerivationsById
        .remove_background_result,
    ).toMatchObject({ operation: "remove-background" });
    expect(
      runtime().getSnapshot().document.assetsById[sourceAssetId],
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.nodesById.background_image,
    ).toMatchObject({
      properties: { assetId: sourceAssetId },
    });
    expect(
      runtime().getSnapshot().document.assetsById[resultAssetId],
    ).toBeUndefined();

    const referenceAssetId = `asset_${"3".repeat(64)}`;
    const promptResultAssetId = `asset_${"4".repeat(64)}`;
    vi.mocked(window.desktop!.selectDesignImage).mockResolvedValueOnce({
      asset: {
        id: referenceAssetId,
        kind: "image",
        name: "Lighting reference.png",
        mimeType: "image/png",
        source: { type: "data", value: "cmVmZXJlbmNl" },
        size: { width: 1024, height: 1024 },
        extensions: { importedBy: "design-image-picker" },
      },
    });
    vi.mocked(window.desktop!.editDesignImage).mockImplementationOnce(
      (request) => {
        if (request.action !== "prompt-edit") {
          throw new Error("Expected a prompt image edit request");
        }
        expect(request).toMatchObject({
          action: "prompt-edit",
          prompt: "Use the reference lighting and preserve the portrait",
          reference: { id: referenceAssetId },
        });
        return Promise.resolve({
          requestId: request.requestId,
          action: "prompt-edit",
          sourceAssetId,
          asset: {
            id: promptResultAssetId,
            kind: "image",
            name: "Portrait — Edited.png",
            mimeType: "image/png",
            source: { type: "data", value: "ZWRpdGVkLXByb21wdA==" },
            size: { width: 800, height: 600 },
            extensions: { importedBy: "inspector-image-edit" },
          },
          supportingAssets: [request.reference!],
          derivation: {
            id: "prompt_edit_result",
            sourceAssetId,
            resultAssetId: promptResultAssetId,
            operation: "prompt-edit",
            prompt: request.prompt,
            referenceAssetIds: [referenceAssetId],
            extensions: { modelId: "gpt-image-2" },
          },
        });
      },
    );
    await user.click(screen.getByRole("button", { name: "Edit with prompt…" }));
    await user.type(
      screen.getByRole("textbox", { name: "Edit prompt" }),
      "Use the reference lighting and preserve the portrait",
    );
    await user.click(screen.getByRole("button", { name: "Add reference…" }));
    await screen.findByText("Lighting reference.png");
    await user.click(screen.getByRole("button", { name: "Edit image" }));
    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.nodesById.background_image,
      ).toMatchObject({
        properties: {
          assetId: promptResultAssetId,
          placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
          filters: { contrast: 0.2 },
          cornerRadius: 12,
        },
      }),
    );
    expect(
      runtime().getSnapshot().document.assetsById[referenceAssetId],
    ).toBeDefined();
    expect(
      runtime().getSnapshot().document.imageAssetDerivationsById
        .prompt_edit_result,
    ).toMatchObject({
      operation: "prompt-edit",
      referenceAssetIds: [referenceAssetId],
    });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.assetsById[referenceAssetId],
    ).toBeUndefined();
    expect(
      runtime().getSnapshot().document.assetsById[promptResultAssetId],
    ).toBeUndefined();

    const backgroundResultAssetId = `asset_${"8".repeat(64)}`;
    vi.mocked(window.desktop!.editDesignImage).mockImplementationOnce(
      (request) => {
        if (request.action !== "replace-background") {
          throw new Error("Expected a background replacement request");
        }
        expect(request).toMatchObject({
          action: "replace-background",
          prompt: "A quiet cobalt studio with a concrete floor",
        });
        expect(request).not.toHaveProperty("reference");
        return Promise.resolve({
          requestId: request.requestId,
          action: request.action,
          sourceAssetId,
          asset: {
            id: backgroundResultAssetId,
            kind: "image",
            name: "Portrait — Background replaced.png",
            mimeType: "image/png",
            source: { type: "data", value: "YmFja2dyb3VuZA==" },
            size: { width: 800, height: 600 },
            extensions: { importedBy: "inspector-image-edit" },
          },
          derivation: {
            id: "replace_background_result",
            sourceAssetId,
            resultAssetId: backgroundResultAssetId,
            operation: "replace-background",
            prompt: request.prompt,
            referenceAssetIds: [],
            extensions: { modelId: "gpt-image-2" },
          },
        });
      },
    );
    await user.click(
      screen.getByRole("button", { name: "More image actions" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Replace background…" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "New background" }),
      "A quiet cobalt studio with a concrete floor",
    );
    expect(screen.queryByText("No reference image")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Replace background" }),
    );
    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.nodesById.background_image,
      ).toMatchObject({
        transform: [1, 0, 0, 1, 100, 120],
        size: { width: 400, height: 300 },
        properties: {
          assetId: backgroundResultAssetId,
          placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
          filters: { contrast: 0.2 },
          cornerRadius: 12,
        },
      }),
    );
    expect(
      runtime().getSnapshot().document.imageAssetDerivationsById
        .replace_background_result,
    ).toMatchObject({
      operation: "replace-background",
      prompt: "A quiet cobalt studio with a concrete floor",
      referenceAssetIds: [],
    });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.assetsById[backgroundResultAssetId],
    ).toBeUndefined();

    const relightResultAssetId = `asset_${"7".repeat(64)}`;
    vi.mocked(window.desktop!.editDesignImage).mockImplementationOnce(
      (request) => {
        if (request.action !== "relight") {
          throw new Error("Expected a relighting request");
        }
        expect(request).toMatchObject({
          action: "relight",
          lightingPreset: "neon",
        });
        expect(request).not.toHaveProperty("prompt");
        return Promise.resolve({
          requestId: request.requestId,
          action: request.action,
          sourceAssetId,
          asset: {
            id: relightResultAssetId,
            kind: "image",
            name: "Portrait — Lighting changed.png",
            mimeType: "image/png",
            source: { type: "data", value: "cmVsaWdodA==" },
            size: { width: 800, height: 600 },
            extensions: { importedBy: "inspector-image-edit" },
          },
          derivation: {
            id: "relight_result",
            sourceAssetId,
            resultAssetId: relightResultAssetId,
            operation: "relight",
            lightingPreset: request.lightingPreset,
            referenceAssetIds: [],
            extensions: { modelId: "gpt-image-2" },
          },
        });
      },
    );
    await user.click(
      screen.getByRole("button", { name: "More image actions" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Change lighting…" }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Lighting" }),
      "neon",
    );
    await user.click(screen.getByRole("button", { name: "Change lighting" }));
    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.nodesById.background_image,
      ).toMatchObject({
        transform: [1, 0, 0, 1, 100, 120],
        size: { width: 400, height: 300 },
        properties: {
          assetId: relightResultAssetId,
          placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
          filters: { contrast: 0.2 },
          cornerRadius: 12,
        },
      }),
    );
    expect(
      runtime().getSnapshot().document.imageAssetDerivationsById.relight_result,
    ).toMatchObject({ operation: "relight", lightingPreset: "neon" });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.assetsById[relightResultAssetId],
    ).toBeUndefined();

    const maskAssetId = `asset_${"5".repeat(64)}`;
    const isolatedAssetId = `asset_${"6".repeat(64)}`;
    vi.mocked(window.desktop!.editDesignImage).mockImplementationOnce(
      (request) => {
        if (request.action !== "isolate-object") {
          throw new Error("Expected an isolated area image edit request");
        }
        expect(request.selection.points.length).toBeGreaterThanOrEqual(3);
        return Promise.resolve({
          requestId: request.requestId,
          action: request.action,
          sourceAssetId,
          asset: {
            id: isolatedAssetId,
            kind: "image",
            name: "Portrait — Object isolated.png",
            mimeType: "image/png",
            source: { type: "data", value: "aXNvbGF0ZWQ=" },
            size: { width: 800, height: 600 },
            extensions: { importedBy: "inspector-image-edit" },
          },
          supportingAssets: [
            {
              id: maskAssetId,
              kind: "image",
              name: "Portrait — Area mask.png",
              mimeType: "image/png",
              source: { type: "data", value: "bWFzaw==" },
              size: { width: 800, height: 600 },
              extensions: { role: "image-edit-mask" },
            },
          ],
          derivation: {
            id: "isolate_object_result",
            sourceAssetId,
            resultAssetId: isolatedAssetId,
            operation: "isolate-object",
            prompt: "Isolate the selected object",
            maskAssetId,
            referenceAssetIds: [],
            extensions: { modelId: "gpt-image-2" },
          },
        });
      },
    );
    expect(
      screen.getByRole("toolbar", { name: "Canvas selection actions" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Select area…" }));
    expect(
      screen.queryByRole("toolbar", { name: "Canvas selection actions" }),
    ).toBeNull();
    const areaOverlay = screen.getByRole("application", {
      name: "Select image area",
    });
    let capturedPointer: number | null = null;
    vi.spyOn(areaOverlay, "setPointerCapture").mockImplementation(
      (pointerId) => {
        capturedPointer = pointerId;
      },
    );
    vi.spyOn(areaOverlay, "hasPointerCapture").mockImplementation(
      (pointerId) => capturedPointer === pointerId,
    );
    vi.spyOn(areaOverlay, "releasePointerCapture").mockImplementation(() => {
      capturedPointer = null;
    });
    const areaSource = runtime().getSnapshot();
    const imageWorld = getWorldTransform(
      areaSource.document,
      "background_image",
    );
    if (!imageWorld) throw new Error("Missing image transform");
    const areaPoints = [
      { x: 80, y: 70 },
      { x: 260, y: 70 },
      { x: 260, y: 210 },
      { x: 80, y: 210 },
    ].map((point) =>
      documentToScreen(
        transformPoint(point, imageWorld),
        areaSource.state.viewport,
      ),
    );
    fireEvent.pointerDown(areaOverlay, {
      button: 0,
      clientX: areaPoints[0].x,
      clientY: areaPoints[0].y,
      pointerId: 7,
    });
    for (const point of areaPoints.slice(1)) {
      fireEvent.pointerMove(areaOverlay, {
        clientX: point.x,
        clientY: point.y,
        pointerId: 7,
      });
    }
    fireEvent.pointerUp(areaOverlay, {
      clientX: areaPoints.at(-1)!.x,
      clientY: areaPoints.at(-1)!.y,
      pointerId: 7,
    });
    await user.click(await screen.findByRole("button", { name: "Isolate" }));
    await waitFor(() =>
      expect(
        Object.values(runtime().getSnapshot().document.nodesById).find(
          (node) => node.properties && node.name === "Isolated object",
        ),
      ).toMatchObject({
        kind: "image",
        properties: {
          assetId: isolatedAssetId,
          placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
          filters: { contrast: 0.2 },
          cornerRadius: 12,
        },
      }),
    );
    expect(
      runtime().getSnapshot().document.nodesById.background_image,
    ).toMatchObject({ properties: { assetId: sourceAssetId } });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.assetsById[isolatedAssetId],
    ).toBeUndefined();
    expect(
      runtime().getSnapshot().document.assetsById[maskAssetId],
    ).toBeUndefined();
    act(() => runtime().setSelection(["background_image"], "background_image"));
    await user.click(screen.getByRole("button", { name: "Select area…" }));
    fireEvent.keyDown(
      screen.getByRole("application", { name: "Select image area" }),
      { key: "Escape" },
    );
    expect(
      screen.queryByRole("application", { name: "Select image area" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Select area…" }));
    expect(
      screen.getByRole("application", { name: "Select image area" }),
    ).toBeVisible();
    act(() => {
      const current = runtime().getSnapshot().document;
      const result = runtime().apply({
        transactionId: "stale_image_area_selection",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "test" },
        commands: [
          {
            commandId: "update_unrelated_node",
            type: "update_properties",
            nodeId: "feature_one",
            properties: { cornerRadius: 15 },
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("application", { name: "Select image area" }),
      ).toBeNull(),
    );
    act(() => {
      expect(runtime().undo().ok).toBe(true);
      runtime().setSelection(["background_image"], "background_image");
    });

    const expandMaskAssetId = `asset_${"7".repeat(64)}`;
    const expandedAssetId = `asset_${"8".repeat(64)}`;
    vi.mocked(window.desktop!.editDesignImage).mockImplementationOnce(
      (request) => {
        if (request.action !== "expand") {
          throw new Error("Expected an image expansion request");
        }
        expect(request).toMatchObject({
          expansion: { top: 50, right: 0, bottom: 50, left: 0 },
          placement: { mode: "fill" },
          targetSize: { width: 400, height: 300 },
        });
        return Promise.resolve({
          requestId: request.requestId,
          action: "expand",
          sourceAssetId,
          asset: {
            id: expandedAssetId,
            kind: "image",
            name: "Portrait — Expanded.png",
            mimeType: "image/png",
            source: { type: "data", value: "ZXhwYW5kZWQ=" },
            size: { width: 1024, height: 1024 },
            extensions: { importedBy: "inspector-image-edit" },
          },
          supportingAssets: [
            {
              id: expandMaskAssetId,
              kind: "image",
              name: "Portrait — Expansion mask.png",
              mimeType: "image/png",
              source: { type: "data", value: "bWFzaw==" },
              size: { width: 1024, height: 1024 },
              extensions: { role: "image-edit-mask" },
            },
          ],
          derivation: {
            id: "expand_image_result",
            sourceAssetId,
            resultAssetId: expandedAssetId,
            operation: "expand",
            prompt: "Extend the image naturally",
            maskAssetId: expandMaskAssetId,
            referenceAssetIds: [],
            extensions: { modelId: "gpt-image-2" },
          },
        });
      },
    );
    await user.click(screen.getByRole("button", { name: "Expand image…" }));
    expect(
      screen.getByRole("application", { name: "Expand image" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("toolbar", { name: "Canvas selection actions" }),
    ).toBeNull();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Aspect ratio" }),
      "1:1",
    );
    await user.click(screen.getByRole("button", { name: "Expand" }));
    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.nodesById.background_image,
      ).toMatchObject({
        transform: [1, 0, 0, 1, 100, 70],
        size: { width: 400, height: 400 },
        properties: {
          assetId: expandedAssetId,
          placement: { mode: "stretch" },
          filters: { contrast: 0.2 },
          cornerRadius: 12,
        },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.nodesById.background_image,
    ).toMatchObject({
      transform: [1, 0, 0, 1, 100, 120],
      size: { width: 400, height: 300 },
      properties: {
        assetId: sourceAssetId,
        placement: { mode: "fill" },
      },
    });
    expect(
      runtime().getSnapshot().document.assetsById[expandedAssetId],
    ).toBeUndefined();
    expect(
      runtime().getSnapshot().document.assetsById[expandMaskAssetId],
    ).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Expand image…" }));
    const cancelledExpandOverlay = screen.getByRole("application", {
      name: "Expand image",
    });
    fireEvent.keyDown(cancelledExpandOverlay, { key: "Escape" });
    expect(cancelledExpandOverlay).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand image…" }));
    act(() => {
      const current = runtime().getSnapshot().document;
      const result = runtime().apply({
        transactionId: "stale_image_expand_session",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "test" },
        commands: [
          {
            commandId: "update_unrelated_after_expand",
            type: "update_properties",
            nodeId: "feature_one",
            properties: { cornerRadius: 16 },
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("application", { name: "Expand image" }),
      ).toBeNull(),
    );
    act(() => {
      expect(runtime().undo().ok).toBe(true);
      runtime().setSelection(["background_image"], "background_image");
    });

    const upscaledAssetId = `asset_${"9".repeat(64)}`;
    vi.mocked(window.desktop!.editDesignImage).mockImplementationOnce(
      (request) => {
        if (request.action !== "upscale") {
          throw new Error("Expected a resolution boost request");
        }
        expect(request).not.toHaveProperty("scale");
        return Promise.resolve({
          requestId: request.requestId,
          action: "upscale",
          sourceAssetId,
          asset: {
            id: upscaledAssetId,
            kind: "image",
            name: "Portrait — Resolution boosted.png",
            mimeType: "image/png",
            source: { type: "data", value: "dXBzY2FsZWQ=" },
            size: { width: 1_600, height: 1_200 },
            extensions: { importedBy: "inspector-image-edit" },
          },
          derivation: {
            id: "upscale_image_result",
            sourceAssetId,
            resultAssetId: upscaledAssetId,
            operation: "upscale",
            referenceAssetIds: [],
            extensions: { modelId: "gpt-image-2" },
          },
        });
      },
    );
    await user.click(
      screen.getByRole("button", { name: "More image actions" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Boost resolution" }),
    );
    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.nodesById.background_image,
      ).toMatchObject({
        transform: [1, 0, 0, 1, 100, 120],
        size: { width: 400, height: 300 },
        properties: {
          assetId: upscaledAssetId,
          placement: { mode: "fill" },
          filters: { contrast: 0.2 },
          cornerRadius: 12,
        },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.nodesById.background_image,
    ).toMatchObject({
      size: { width: 400, height: 300 },
      properties: { assetId: sourceAssetId, placement: { mode: "fill" } },
    });
    expect(
      runtime().getSnapshot().document.assetsById[upscaledAssetId],
    ).toBeUndefined();

    let rejectEdit: ((reason: Error) => void) | undefined;
    vi.mocked(window.desktop!.editDesignImage).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectEdit = reject;
        }),
    );
    const beforeCancelledEdit = runtime().getSnapshot().document.revision;
    await user.click(
      screen.getByRole("button", { name: "More image actions" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Remove background" }),
    );
    expect(await screen.findByText("Editing Portrait")).toBeVisible();
    act(() => runtime().setSelection(["feature_one"], "feature_one"));
    expect(screen.getByText("Editing Portrait")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      vi.mocked(window.desktop!.cancelDesignImageEdit).mock.calls[0]?.[0]
        .requestId,
    ).toMatch(/^image_edit_/);
    act(() => rejectEdit?.(new Error("Image editing cancelled")));
    act(() => runtime().setSelection(["background_image"], "background_image"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "More image actions" }),
      ).toBeEnabled(),
    );
    expect(runtime().getSnapshot().document.revision).toBe(beforeCancelledEdit);
    expect(screen.queryByText("Image editing cancelled")).toBeNull();
  }, 15_000);

  it("manages current-file image assets through import, placement, file-wide replacement, and safe deletion", async () => {
    const user = userEvent.setup();
    renderApp();
    const importedId = `asset_${"e".repeat(64)}`;
    const replacementId = `asset_${"f".repeat(64)}`;
    await user.click(screen.getByRole("tab", { name: "Assets" }));
    expect(screen.getByText("No image assets")).toBeInTheDocument();

    vi.mocked(window.desktop!.selectDesignImage).mockResolvedValueOnce({
      asset: {
        id: importedId,
        kind: "image",
        name: "Library hero",
        mimeType: "image/png",
        source: { type: "data", value: "aW1hZ2U=" },
        size: { width: 1200, height: 800 },
        extensions: {},
      },
    });
    await user.click(
      screen.getByRole("button", { name: "Import image asset" }),
    );
    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.assetsById[importedId],
      ).toBeDefined(),
    );
    expect(runtime().getSnapshot().document.revision).toBe(1);
    expect(screen.getByText("Unused · 1200 × 800")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Place Library hero on canvas" }),
    );
    const placed = Object.values(
      runtime().getSnapshot().document.nodesById,
    ).find(
      (node) => node.kind === "image" && node.properties.assetId === importedId,
    );
    expect(placed).toBeDefined();
    expect(runtime().getSnapshot().document.revision).toBe(2);
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([
      placed?.id,
    ]);

    vi.mocked(window.desktop!.selectDesignImage).mockResolvedValueOnce({
      asset: {
        id: replacementId,
        kind: "image",
        name: "Retouched hero",
        mimeType: "image/webp",
        source: { type: "data", value: "cmV0b3VjaGVk" },
        size: { width: 1600, height: 900 },
        extensions: {},
      },
    });
    await user.click(
      screen.getByRole("button", { name: "Actions for Library hero" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Replace all uses…" }),
    );
    await waitFor(() =>
      expect(
        runtime().getSnapshot().document.assetsById[replacementId],
      ).toBeDefined(),
    );
    expect(
      runtime().getSnapshot().document.assetsById[importedId],
    ).toBeDefined();
    expect(
      runtime().getSnapshot().document.nodesById[placed!.id],
    ).toMatchObject({
      properties: { assetId: replacementId, placement: { mode: "fit" } },
    });
    expect(runtime().getSnapshot().document.revision).toBe(3);

    await user.click(
      screen.getByRole("button", { name: "Delete selection (Delete)" }),
    );
    expect(
      runtime().getSnapshot().document.nodesById[placed!.id],
    ).toBeUndefined();
    expect(
      screen.getByText("Unused · 1600 × 900 · Replacement · 2 versions"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Actions for Retouched hero" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Delete source history" }),
    );
    expect(
      runtime().getSnapshot().document.assetsById[replacementId],
    ).toBeUndefined();
    expect(
      runtime().getSnapshot().document.assetsById[importedId],
    ).toBeUndefined();
    expect(screen.getByText("No image assets")).toBeInTheDocument();
    expect(runtime().getSnapshot().document.revision).toBe(5);

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      runtime().getSnapshot().document.assetsById[replacementId],
    ).toBeDefined();
  });

  it("keeps image asset import cancellation and picker failure revision-free", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("tab", { name: "Assets" }));
    const importButton = screen.getByRole("button", {
      name: "Import image asset",
    });
    const before = runtime().getSnapshot().document.revision;
    await user.click(importButton);
    await waitFor(() =>
      expect(window.desktop!.selectDesignImage).toHaveBeenCalledTimes(1),
    );
    const importAfterCancel = screen.getByRole("button", {
      name: "Import image asset",
    });
    await waitFor(() => expect(importAfterCancel).toBeEnabled());
    expect(runtime().getSnapshot().document.revision).toBe(before);

    vi.mocked(window.desktop!.selectDesignImage).mockRejectedValueOnce(
      new Error("picker failed"),
    );
    await user.click(importAfterCancel);
    await waitFor(() =>
      expect(window.desktop!.selectDesignImage).toHaveBeenCalledTimes(2),
    );
    expect(
      await screen.findAllByText("Could not update the image asset"),
    ).toHaveLength(2);
    expect(runtime().getSnapshot().document.revision).toBe(before);
  });

  it("accepts only internal asset-ID drops and places them at exact canvas coordinates", () => {
    renderApp();
    const assetId = `asset_${"9".repeat(64)}`;
    act(() => {
      const current = runtime().getSnapshot().document;
      const result = runtime().apply({
        transactionId: "add_drag_asset",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "test" },
        commands: [
          {
            commandId: "put_drag_asset",
            type: "put_asset",
            asset: {
              id: assetId,
              kind: "image",
              name: "Dragged image",
              mimeType: "image/png",
              source: { type: "data", value: "aW1hZ2U=" },
              size: { width: 640, height: 480 },
              extensions: {},
            },
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      runtime().setViewport({
        width: 1000,
        height: 800,
        zoom: 1.25,
        panX: 40,
        panY: 30,
      });
    });
    const frame = runtime().getSnapshot().document.nodesById.frame_welcome;
    const frameTransform = getWorldTransform(
      runtime().getSnapshot().document,
      "frame_welcome",
    );
    if (!frame || !frameTransform) throw new Error("Missing Frame fixture");
    const documentPoint = transformPoint({ x: 220, y: 160 }, frameTransform);
    const screenPoint = documentToScreen(
      documentPoint,
      runtime().getSnapshot().state.viewport,
    );
    const canvas = screen.getByRole("main", { name: "Design canvas" });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 12,
      y: 18,
      left: 12,
      top: 18,
      right: 1012,
      bottom: 818,
      width: 1000,
      height: 800,
      toJSON: () => undefined,
    });

    const external = {
      types: ["Files"],
      dropEffect: "none",
      getData: vi.fn(() => assetId),
    };
    fireEvent.dragOver(canvas, { dataTransfer: external });
    expect(screen.queryByText("Drop to place image")).toBeNull();
    const before = runtime().getSnapshot().document.revision;
    fireEvent.drop(canvas, { dataTransfer: external });
    expect(runtime().getSnapshot().document.revision).toBe(before);

    const internal = {
      types: ["application/x-opendesign-image-asset-id"],
      dropEffect: "none",
      getData: vi.fn(() => assetId),
    };
    const dragOver = createEvent.dragOver(canvas, { dataTransfer: internal });
    fireEvent(canvas, dragOver);
    expect(screen.getByText("Drop to place image")).toBeInTheDocument();
    const drop = createEvent.drop(canvas, { dataTransfer: internal });
    Object.defineProperties(drop, {
      clientX: { value: screenPoint.x + 12 },
      clientY: { value: screenPoint.y + 18 },
    });
    fireEvent(canvas, drop);

    const placed = Object.values(
      runtime().getSnapshot().document.nodesById,
    ).find(
      (node) =>
        node.kind === "image" &&
        node.properties.assetId === assetId &&
        node.parentId === frame.id,
    );
    expect(placed).toBeDefined();
    if (!placed) return;
    const placedTransform = getWorldTransform(
      runtime().getSnapshot().document,
      placed.id,
    );
    expect(placedTransform).not.toBeNull();
    expect(
      transformPoint(
        { x: placed.size.width / 2, y: placed.size.height / 2 },
        placedTransform!,
      ),
    ).toEqual(documentPoint);
    expect(runtime().getSnapshot().document.revision).toBe(before + 1);
    expect(screen.queryByText("Drop to place image")).toBeNull();
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

  it("toggles Figma lock and visibility shortcuts as one transaction per selection", () => {
    renderApp();
    act(() =>
      runtime().setSelection(
        ["title_welcome", "subtitle_welcome"],
        "title_welcome",
      ),
    );

    fireEvent.keyDown(window, {
      code: "KeyL",
      key: "L",
      metaKey: true,
      shiftKey: true,
    });
    let snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById.title_welcome?.locked).toBe(true);
    expect(snapshot.document.nodesById.subtitle_welcome?.locked).toBe(true);
    expect(snapshot.document.revision).toBe(1);
    expect(snapshot.state.history.undo).toHaveLength(1);

    fireEvent.keyDown(window, {
      code: "KeyH",
      key: "H",
      metaKey: true,
      shiftKey: true,
    });
    snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById.title_welcome?.visible).toBe(false);
    expect(snapshot.document.nodesById.subtitle_welcome?.visible).toBe(false);
    expect(snapshot.document.revision).toBe(2);
    expect(snapshot.state.history.undo).toHaveLength(2);
  });

  it("previews and commits Figma-style bulk layer rename as one undo entry", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() =>
      runtime().setSelection(
        ["title_welcome", "subtitle_welcome"],
        "title_welcome",
      ),
    );

    fireEvent.keyDown(window, {
      code: "KeyR",
      key: "r",
      metaKey: true,
    });
    expect(
      screen.getByRole("dialog", { name: "Rename layers" }),
    ).toBeInTheDocument();
    const renameTo = screen.getByRole("textbox", { name: "Rename to" });
    await user.clear(renameTo);
    await user.type(renameTo, "Heading ");
    await user.click(screen.getByRole("button", { name: "Number ↑" }));
    await user.click(screen.getByRole("button", { name: "Rename 2" }));

    let snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById.title_welcome?.name).toBe("Heading 1");
    expect(snapshot.document.nodesById.subtitle_welcome?.name).toBe(
      "Heading 2",
    );
    expect(snapshot.document.revision).toBe(1);
    expect(snapshot.state.history.undo).toHaveLength(1);

    act(() => {
      runtime().undo();
    });
    snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById.title_welcome?.name).toBe("Title");
    expect(snapshot.document.nodesById.subtitle_welcome?.name).toBe("Subtitle");
  });

  it("groups and ungroups the current selection as undoable transactions", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() =>
      runtime().setSelection(
        ["title_welcome", "subtitle_welcome"],
        "title_welcome",
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "Group selection (⌘G)" }),
    );
    let snapshot = runtime().getSnapshot();
    const group = Object.values(snapshot.document.nodesById).find(
      (node) =>
        node.kind === "group" && node.childIds.includes("title_welcome"),
    );
    expect(group?.childIds).toEqual(["title_welcome", "subtitle_welcome"]);
    expect(snapshot.state.selection.nodeIds).toEqual([group?.id]);
    expect(snapshot.document.revision).toBe(1);

    await user.click(
      screen.getByRole("button", { name: "Ungroup selection (⇧⌘G)" }),
    );
    snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById[group?.id ?? "missing"]).toBeUndefined();
    expect(snapshot.state.selection.nodeIds).toEqual([
      "title_welcome",
      "subtitle_welcome",
    ]);
    expect(snapshot.document.revision).toBe(2);
    expect(snapshot.state.history.undo).toHaveLength(2);
  });

  it("creates and removes a contained mask with the Figma shortcut", () => {
    renderApp();
    act(() =>
      runtime().setSelection(
        ["title_welcome", "subtitle_welcome"],
        "subtitle_welcome",
      ),
    );

    fireEvent.keyDown(window, {
      code: "KeyM",
      key: "m",
      ctrlKey: true,
      metaKey: true,
    });
    let snapshot = runtime().getSnapshot();
    const groupId = snapshot.state.selection.nodeIds[0];
    expect(snapshot.document.nodesById[groupId ?? ""]).toMatchObject({
      kind: "group",
      childIds: ["title_welcome", "subtitle_welcome"],
    });
    expect(snapshot.document.nodesById.title_welcome?.maskMode).toBe("alpha");
    expect(snapshot.state.history.undo).toHaveLength(1);

    fireEvent.keyDown(window, {
      code: "KeyM",
      key: "m",
      ctrlKey: true,
      metaKey: true,
    });
    snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById[groupId ?? ""]).toBeDefined();
    expect(snapshot.document.nodesById.title_welcome?.maskMode).toBe("none");
    expect(snapshot.state.history.undo).toHaveLength(2);
  });

  it("creates a non-destructive Boolean from the toolbar, changes it in the inspector, and ungroups it", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() =>
      runtime().setSelection(["feature_one", "feature_two"], "feature_one"),
    );

    await user.click(
      screen.getByRole("button", { name: "Boolean operations" }),
    );
    expect(screen.getByText("⌥⇧U")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Union" }));

    let snapshot = runtime().getSnapshot();
    const booleanNode = Object.values(snapshot.document.nodesById).find(
      (node) =>
        node.kind === "boolean" && node.childIds.includes("feature_one"),
    );
    expect(booleanNode).toMatchObject({
      kind: "boolean",
      childIds: ["feature_one", "feature_two"],
      properties: { operation: "union" },
    });
    expect(snapshot.state.selection.nodeIds).toEqual([booleanNode?.id]);
    expect(snapshot.document.revision).toBe(1);

    await user.click(screen.getByRole("tab", { name: "Properties" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Operation" }),
      "intersect",
    );
    snapshot = runtime().getSnapshot();
    expect(
      snapshot.document.nodesById[booleanNode?.id ?? "missing"],
    ).toMatchObject({ properties: { operation: "intersect" } });
    expect(snapshot.document.revision).toBe(2);

    await user.click(
      screen.getByRole("button", { name: "Ungroup selection (⇧⌘G)" }),
    );
    snapshot = runtime().getSnapshot();
    expect(
      snapshot.document.nodesById[booleanNode?.id ?? "missing"],
    ).toBeUndefined();
    expect(snapshot.state.selection.nodeIds).toEqual([
      "feature_one",
      "feature_two",
    ]);
    expect(snapshot.document.revision).toBe(3);
    expect(snapshot.state.history.undo).toHaveLength(3);
  });

  it("uses Windows Boolean shortcuts without stealing editable input", async () => {
    vi.mocked(window.desktop!.getPlatformInfo).mockResolvedValueOnce({
      platform: "win32",
      version: "0.0.0",
    });
    renderApp();
    act(() =>
      runtime().setSelection(["feature_one", "feature_two"], "feature_one"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Boolean operations" }),
      ).toBeEnabled(),
    );

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "u", altKey: true, shiftKey: true });
    input.remove();
    expect(runtime().getSnapshot().document.revision).toBe(0);

    fireEvent.keyDown(window, { key: "s", altKey: true, shiftKey: true });
    let snapshot = runtime().getSnapshot();
    const booleanNode = Object.values(snapshot.document.nodesById).find(
      (node) => node.kind === "boolean",
    );
    expect(booleanNode).toMatchObject({
      properties: { operation: "subtract" },
    });

    fireEvent.keyDown(window, { key: "i", altKey: true, shiftKey: true });
    snapshot = runtime().getSnapshot();
    expect(
      snapshot.document.nodesById[booleanNode?.id ?? "missing"],
    ).toMatchObject({ properties: { operation: "intersect" } });
    expect(snapshot.document.revision).toBe(2);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Boolean operations" }));
    expect(screen.getByText("Alt+Shift+U")).toBeInTheDocument();
  });

  it("edits Boolean source geometry through canvas nesting, exposes read-only lock state, and exits cleanly", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() =>
      runtime().setSelection(["feature_one", "feature_two"], "feature_one"),
    );
    await user.click(
      screen.getByRole("button", { name: "Boolean operations" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Union" }));
    const created = runtime().getSnapshot();
    const booleanNode = Object.values(created.document.nodesById).find(
      (node) => node.kind === "boolean",
    );
    if (!booleanNode || booleanNode.kind !== "boolean") {
      throw new Error("Missing Boolean fixture");
    }

    const canvas = screen.getByRole("main", { name: "Design canvas" });
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([
      "feature_two",
    ]);
    await waitFor(() =>
      expect(leaferHarness.input?.booleanEditScope).toEqual({
        booleanId: booleanNode.id,
        readOnly: false,
        selectedOperandIds: ["feature_two"],
      }),
    );
    expect(screen.getByText(`Editing ${booleanNode.name}`)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Properties" }));
    expect(
      screen.getByText("Appearance is controlled by the Boolean group"),
    ).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Opacity" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Blend mode" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Mask mode" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Fill" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stroke" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Effects" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete layer" })).toBeDisabled();
    const revisionBeforeDelete = runtime().getSnapshot().document.revision;
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(runtime().getSnapshot().document.revision).toBe(
      revisionBeforeDelete,
    );

    act(() => {
      leaferCallbacks().onOperations({
        kind: "move",
        operations: [
          {
            commandId: "move_boolean_operand",
            type: "update_properties",
            nodeId: "feature_two",
            transform: [1, 0, 0, 1, 320, 12],
          },
        ],
      });
    });
    expect(
      runtime().getSnapshot().document.nodesById.feature_two?.transform,
    ).toEqual([1, 0, 0, 1, 320, 12]);
    expect(runtime().getSnapshot().document.revision).toBe(2);

    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Tab", shiftKey: true });
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([
      "feature_one",
    ]);
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([]);
    expect(
      screen.queryByText(`Editing ${booleanNode.name}`),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Atomic changes" }));
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([
      "feature_two",
    ]);
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Enter", shiftKey: true });
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([
      booleanNode.id,
    ]);

    fireEvent.doubleClick(canvas);
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([
      "feature_two",
    ]);
    await user.click(
      screen.getByRole("button", { name: "Finish editing Boolean sources" }),
    );
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([
      booleanNode.id,
    ]);

    await user.click(
      screen.getByRole("button", { name: `Lock ${booleanNode.name}` }),
    );
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(
      screen.getByText("Read-only · The Boolean group is locked"),
    ).toBeInTheDocument();
    expect(leaferHarness.input?.booleanEditScope).toMatchObject({
      booleanId: booleanNode.id,
      readOnly: true,
    });
  });

  it("surfaces Boolean fidelity warnings with source-edit and provider-retry recovery", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() =>
      runtime().setSelection(["feature_one", "feature_two"], "feature_one"),
    );
    await user.click(
      screen.getByRole("button", { name: "Boolean operations" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Subtract" }));
    const booleanNode = Object.values(
      runtime().getSnapshot().document.nodesById,
    ).find((node) => node.kind === "boolean");
    if (!booleanNode || booleanNode.kind !== "boolean") {
      throw new Error("Missing Boolean fixture");
    }

    act(() => {
      leaferCallbacks().onWarningsChange?.([
        {
          code: "boolean-geometry-provider-failed",
          message: "Boolean geometry provider failed to load: WASM unavailable",
          nodeId: booleanNode.id,
        },
      ]);
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Boolean result unavailable",
    );
    expect(screen.getByRole("alert").textContent).toContain("WASM unavailable");

    await user.click(screen.getByRole("button", { name: "Retry rendering" }));
    expect(leaferHarness.retryBooleanGeometry).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Edit sources" }));
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([
      "feature_two",
    ]);
    expect(screen.getByText(`Editing ${booleanNode.name}`)).toBeInTheDocument();
  });

  it("enters editable vector points, exposes point modes, and commits through one Runtime transaction", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => {
      const current = runtime().getSnapshot();
      const result = runtime().apply({
        transactionId: "insert_editable_vector",
        documentId: current.document.documentId,
        baseRevision: current.document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Insert editable vector",
        commands: [
          {
            commandId: "insert_editable_vector",
            type: "insert_element",
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 0,
            node: {
              id: "editable_vector",
              name: "Logo curve",
              parentId: "frame_welcome",
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, 40, 40],
              size: { width: 120, height: 60 },
              exportSettings: [],
              opacity: 1,
              extensions: {},
              kind: "vector",
              properties: {
                network: {
                  vertices: [
                    {
                      id: "vertex_a",
                      x: 0,
                      y: 0,
                      handleMode: "corner",
                    },
                    {
                      id: "vertex_b",
                      x: 60,
                      y: 60,
                      handleMode: "corner",
                    },
                    {
                      id: "vertex_c",
                      x: 120,
                      y: 0,
                      handleMode: "corner",
                    },
                  ],
                  segments: [
                    {
                      id: "segment_ab",
                      startVertexId: "vertex_a",
                      endVertexId: "vertex_b",
                    },
                    {
                      id: "segment_bc",
                      startVertexId: "vertex_b",
                      endVertexId: "vertex_c",
                    },
                  ],
                  paths: [
                    {
                      id: "path_open",
                      closed: false,
                      segments: [
                        { segmentId: "segment_ab", reversed: false },
                        { segmentId: "segment_bc", reversed: false },
                      ],
                    },
                  ],
                  regions: [],
                },
                fills: [],
                strokes: [{ type: "solid", color: "#151515", opacity: 1 }],
                strokeWidth: 2,
              },
            },
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      runtime().setSelection(["editable_vector"], "editable_vector");
    });

    const canvas = screen.getByRole("main", { name: "Design canvas" });
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Enter" });
    await waitFor(() =>
      expect(leaferHarness.input?.vectorEditScope).toEqual({
        activeNodeId: "editable_vector",
        nodes: [
          {
            nodeId: "editable_vector",
            readOnly: false,
            selectedSegmentIds: [],
            selectedVertexIds: [],
          },
        ],
        tool: "move",
      }),
    );
    expect(screen.getByText("Editing Logo curve")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Smooth" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(canvas, { key: "x", code: "KeyX" });
    await waitFor(() =>
      expect(leaferHarness.input?.vectorEditScope?.tool).toBe("cut"),
    );
    expect(
      screen.getByText(
        "Click a point or path to create a break, or drag across the object to divide it into layers",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cut" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(canvas, { key: "q", code: "KeyQ" });
    await waitFor(() =>
      expect(leaferHarness.input?.vectorEditScope?.tool).toBe("lasso"),
    );
    expect(
      screen.getByText(
        "Draw around vector points and paths · Hold Shift to toggle enclosed content",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lasso" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(canvas, { key: "v", code: "KeyV" });
    await waitFor(() =>
      expect(leaferHarness.input?.vectorEditScope?.tool).toBe("move"),
    );

    act(() => {
      leaferCallbacks().onVectorEditSelectionChange?.("editable_vector", {
        segmentIds: [],
        vertexIds: ["vertex_b"],
      });
    });
    await waitFor(() =>
      expect(
        leaferHarness.input?.vectorEditScope?.nodes[0]?.selectedVertexIds,
      ).toEqual(["vertex_b"]),
    );
    expect(screen.getByRole("button", { name: "Corner" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Close path" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Smooth" }));
    expect(leaferHarness.setVectorPointMode).toHaveBeenCalledWith("smooth");

    const beforeDisconnectRevision = runtime().getSnapshot().document.revision;
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(runtime().getSnapshot().document.revision).toBe(
      beforeDisconnectRevision + 1,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(runtime().getSnapshot().document.revision).toBe(
      beforeDisconnectRevision + 2,
    );
    const reconnectedNode =
      runtime().getSnapshot().document.nodesById.editable_vector;
    if (
      !reconnectedNode ||
      reconnectedNode.kind !== "vector" ||
      !("network" in reconnectedNode.properties)
    ) {
      throw new Error("Missing reconnected vector fixture");
    }
    expect(reconnectedNode.properties.network.paths).toHaveLength(1);
    expect(reconnectedNode.properties.network.vertices).toHaveLength(3);

    const beforeCloseRevision = runtime().getSnapshot().document.revision;
    await user.click(screen.getByRole("button", { name: "Close path" }));
    expect(runtime().getSnapshot().document.revision).toBe(
      beforeCloseRevision + 1,
    );
    const closedNode =
      runtime().getSnapshot().document.nodesById.editable_vector;
    if (
      !closedNode ||
      closedNode.kind !== "vector" ||
      !("network" in closedNode.properties)
    ) {
      throw new Error("Missing closed vector fixture");
    }
    expect(closedNode.properties.network.paths[0]?.closed).toBe(true);
    expect(screen.getByRole("button", { name: "Open path" })).toBeEnabled();

    const beforeReverse = structuredClone(closedNode.properties.network);
    await user.click(screen.getByRole("button", { name: "Reverse" }));
    const reversedNode =
      runtime().getSnapshot().document.nodesById.editable_vector;
    if (
      !reversedNode ||
      reversedNode.kind !== "vector" ||
      !("network" in reversedNode.properties)
    ) {
      throw new Error("Missing reversed vector fixture");
    }
    expect(reversedNode.properties.network.paths[0]?.segments).toEqual(
      [...(beforeReverse.paths[0]?.segments ?? [])]
        .reverse()
        .map((reference) => ({ ...reference, reversed: !reference.reversed })),
    );
    expect(runtime().getSnapshot().state.selection.nodeIds).toEqual([
      "editable_vector",
    ]);
    expect(document.activeElement).toBe(canvas);

    const beforeCutRevision = runtime().getSnapshot().document.revision;
    let cutResponse:
      ReturnType<NonNullable<LeaferEngineCallbacks["onVectorCut"]>> | undefined;
    act(() => {
      cutResponse = leaferCallbacks().onVectorCut?.({
        at: { kind: "segment", segmentId: "segment_ab", t: 0.5 },
        nodeId: "editable_vector",
        pathId: "path_open",
      });
    });
    expect(cutResponse).toMatchObject({
      ok: true,
      selectedVertexIds: ["vertex_edit_1", "vertex_edit_2"],
    });
    expect(runtime().getSnapshot().document.revision).toBe(
      beforeCutRevision + 1,
    );
    const cutNode = runtime().getSnapshot().document.nodesById.editable_vector;
    if (
      !cutNode ||
      cutNode.kind !== "vector" ||
      !("network" in cutNode.properties)
    ) {
      throw new Error("Missing cut vector fixture");
    }
    expect(cutNode.properties.network.paths[0]?.closed).toBe(false);
    await waitFor(() =>
      expect(
        leaferHarness.input?.vectorEditScope?.nodes[0]?.selectedVertexIds,
      ).toEqual(["vertex_edit_1", "vertex_edit_2"]),
    );
    expect(screen.getByRole("button", { name: "Close path" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reverse" })).toBeEnabled();

    const beforeEditRevision = runtime().getSnapshot().document.revision;
    const currentNode =
      runtime().getSnapshot().document.nodesById.editable_vector;
    if (
      !currentNode ||
      currentNode.kind !== "vector" ||
      !("network" in currentNode.properties)
    ) {
      throw new Error("Missing editable vector fixture");
    }
    const editedNetwork = structuredClone(currentNode.properties.network);
    editedNetwork.vertices[1] = {
      ...editedNetwork.vertices[1],
      x: 72,
      y: 48,
      handleMode: "smooth",
    };
    act(() => {
      expect(
        leaferCallbacks().onVectorEdit?.({
          deleteNode: false,
          edits: [{ network: editedNetwork, nodeId: "editable_vector" }],
        }),
      ).toBe(true);
    });
    expect(runtime().getSnapshot().document.revision).toBe(
      beforeEditRevision + 1,
    );
    expect(runtime().getSnapshot().state.history.undo.at(-1)?.label).toBe(
      "Edit vector points",
    );

    act(() => leaferCallbacks().onVectorEditExit?.());
    expect(screen.queryByText("Editing Logo curve")).not.toBeInTheDocument();
  });

  it("enters multi-Vector edit and divides every crossed layer in one Canvas transaction", async () => {
    renderApp();
    act(() => {
      const current = runtime().getSnapshot();
      const result = runtime().apply({
        transactionId: "insert_closed_vector",
        documentId: current.document.documentId,
        baseRevision: current.document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Insert closed vector",
        commands: [
          {
            commandId: "insert_closed_vector",
            type: "insert_element",
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 0,
            node: {
              id: "closed_vector",
              name: "Badge contour",
              parentId: "frame_welcome",
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, 40, 40],
              size: { width: 100, height: 100 },
              exportSettings: [],
              opacity: 1,
              extensions: {},
              kind: "vector",
              properties: {
                network: {
                  vertices: [
                    { id: "vertex_a", x: 0, y: 0 },
                    { id: "vertex_b", x: 100, y: 0 },
                    { id: "vertex_c", x: 100, y: 100 },
                    { id: "vertex_d", x: 0, y: 100 },
                  ],
                  segments: [
                    {
                      id: "segment_ab",
                      startVertexId: "vertex_a",
                      endVertexId: "vertex_b",
                    },
                    {
                      id: "segment_bc",
                      startVertexId: "vertex_b",
                      endVertexId: "vertex_c",
                    },
                    {
                      id: "segment_cd",
                      startVertexId: "vertex_c",
                      endVertexId: "vertex_d",
                    },
                    {
                      id: "segment_da",
                      startVertexId: "vertex_d",
                      endVertexId: "vertex_a",
                    },
                  ],
                  paths: [
                    {
                      id: "path_closed",
                      closed: true,
                      segments: [
                        { segmentId: "segment_ab", reversed: false },
                        { segmentId: "segment_bc", reversed: false },
                        { segmentId: "segment_cd", reversed: false },
                        { segmentId: "segment_da", reversed: false },
                      ],
                    },
                  ],
                  regions: [
                    {
                      id: "region_face",
                      windingRule: "nonzero",
                      loops: [{ pathId: "path_closed", reversed: false }],
                    },
                  ],
                },
                fills: [{ type: "solid", color: "#151515", opacity: 1 }],
                strokes: [],
                strokeWidth: 0,
              },
            },
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      const afterFirst = runtime().getSnapshot();
      const first = afterFirst.document.nodesById.closed_vector;
      if (!first) throw new Error("Missing first closed Vector fixture");
      const second = structuredClone(first);
      second.id = "open_vector_second";
      second.name = "Open badge stroke";
      second.transform = [1, 0, 0, 1, 220, 40];
      if (second.kind !== "vector" || !("network" in second.properties)) {
        throw new Error("Missing second Vector network fixture");
      }
      second.properties.network.segments =
        second.properties.network.segments.filter(
          (segment) => segment.id !== "segment_da",
        );
      second.properties.network.paths = [
        {
          id: "path_closed",
          closed: false,
          segments: [
            { segmentId: "segment_ab", reversed: false },
            { segmentId: "segment_bc", reversed: false },
            { segmentId: "segment_cd", reversed: false },
          ],
        },
      ];
      second.properties.network.regions = [];
      second.properties.fills = [];
      second.properties.strokes = [
        { type: "solid", color: "#151515", opacity: 1 },
      ];
      second.properties.strokeWidth = 2;
      const secondResult = runtime().apply({
        transactionId: "insert_second_open_vector",
        documentId: afterFirst.document.documentId,
        baseRevision: afterFirst.document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Insert second open vector",
        commands: [
          {
            commandId: "insert_second_open_vector",
            type: "insert_element",
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 1,
            node: second,
          },
        ],
      });
      if (!secondResult.ok) throw new Error(secondResult.error.message);
      runtime().setSelection(
        ["closed_vector", "open_vector_second"],
        "open_vector_second",
      );
    });
    const canvas = screen.getByRole("main", { name: "Design canvas" });
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Enter" });
    await waitFor(() =>
      expect(leaferHarness.input?.vectorEditScope).toMatchObject({
        activeNodeId: "open_vector_second",
        nodes: [
          { nodeId: "closed_vector", readOnly: false },
          { nodeId: "open_vector_second", readOnly: false },
        ],
      }),
    );
    expect(screen.getByText("Editing Open badge stroke")).toBeInTheDocument();
    expect(screen.getByText(/2 vector layers/)).toBeInTheDocument();

    act(() => {
      leaferCallbacks().onVectorEditScopeChange?.({
        mode: "toggle",
        nodeId: "open_vector_second",
      });
    });
    await waitFor(() =>
      expect(leaferHarness.input?.vectorEditScope?.nodes).toEqual([
        expect.objectContaining({ nodeId: "closed_vector" }),
      ]),
    );
    expect(runtime().getSnapshot().state.selection).toEqual({
      nodeIds: ["closed_vector"],
      anchorNodeId: "closed_vector",
    });
    act(() => {
      leaferCallbacks().onVectorEditScopeChange?.({
        mode: "add",
        nodeId: "open_vector_second",
      });
    });
    await waitFor(() =>
      expect(leaferHarness.input?.vectorEditScope?.nodes).toHaveLength(2),
    );

    act(() => {
      leaferCallbacks().onVectorEditActiveNodeChange?.("closed_vector");
    });
    expect(screen.getByText("Editing Badge contour")).toBeInTheDocument();

    const beforeRevision = runtime().getSnapshot().document.revision;
    let response:
      | ReturnType<NonNullable<LeaferEngineCallbacks["onVectorLineCut"]>>
      | undefined;
    act(() => {
      response = leaferCallbacks().onVectorLineCut?.({
        end: { x: 450, y: 144 },
        nodeIds: ["closed_vector", "open_vector_second"],
        start: { x: 100, y: 144 },
      });
    });
    expect(response).toMatchObject({ ok: true });
    if (!response?.ok) throw new Error("Missing vector divide response");
    const firstResultNodeId = response.resultNodeIds[1];
    const secondResultNodeId = response.resultNodeIds[3];
    expect(firstResultNodeId).toMatch(/^vector_cut_[a-f0-9]{32}$/);
    expect(secondResultNodeId).toMatch(/^vector_cut_[a-f0-9]{32}$/);
    expect(runtime().getSnapshot().document.revision).toBe(beforeRevision + 1);
    expect(runtime().getSnapshot().state.selection).toEqual({
      nodeIds: [
        "closed_vector",
        firstResultNodeId,
        "open_vector_second",
        secondResultNodeId,
      ],
      anchorNodeId: secondResultNodeId,
    });
    const retained = runtime().getSnapshot().document.nodesById.closed_vector;
    const extracted =
      runtime().getSnapshot().document.nodesById[firstResultNodeId];
    const secondExtracted =
      runtime().getSnapshot().document.nodesById[secondResultNodeId];
    expect(retained?.size).toEqual({ width: 100, height: 40 });
    expect(extracted?.size).toEqual({ width: 100, height: 60 });
    expect(secondExtracted?.size).toEqual({ width: 100, height: 60 });
    const secondRetained =
      runtime().getSnapshot().document.nodesById.open_vector_second;
    for (const node of [secondRetained, secondExtracted]) {
      if (!node || node.kind !== "vector" || !("network" in node.properties)) {
        throw new Error("Missing divided open Vector fixture");
      }
      expect(node.properties.network.paths.every((path) => !path.closed)).toBe(
        true,
      );
      expect(node.properties.network.regions).toEqual([]);
    }
    expect(screen.queryByText("Editing Badge contour")).not.toBeInTheDocument();
    expect(runtime().getSnapshot().state.history.undo.at(-1)?.label).toBe(
      "Edit vector points",
    );
    expect(runtime().undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime().getSnapshot().document.nodesById[firstResultNodeId],
    ).toBeUndefined();
    expect(
      runtime().getSnapshot().document.nodesById[secondResultNodeId],
    ).toBeUndefined();
  });

  it("keeps an uncut compound hole with its Canvas-created sibling", async () => {
    renderApp();
    act(() => {
      const current = runtime().getSnapshot();
      const result = runtime().apply({
        transactionId: "insert_compound_vector",
        documentId: current.document.documentId,
        baseRevision: current.document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Insert compound vector",
        commands: [
          {
            commandId: "insert_compound_vector",
            type: "insert_element",
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 0,
            node: compoundCanvasVector("frame_welcome"),
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      runtime().setSelection(["compound_vector"], "compound_vector");
    });
    const canvas = screen.getByRole("main", { name: "Design canvas" });
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Enter" });
    await waitFor(() =>
      expect(leaferHarness.input?.vectorEditScope).toMatchObject({
        activeNodeId: "compound_vector",
        nodes: [{ nodeId: "compound_vector", readOnly: false }],
      }),
    );

    const beforeRevision = runtime().getSnapshot().document.revision;
    let response:
      | ReturnType<NonNullable<LeaferEngineCallbacks["onVectorLineCut"]>>
      | undefined;
    act(() => {
      response = leaferCallbacks().onVectorLineCut?.({
        end: { x: 260, y: 114 },
        nodeIds: ["compound_vector"],
        start: { x: 100, y: 114 },
      });
    });
    expect(response).toMatchObject({ ok: true });
    if (!response?.ok) throw new Error("Missing compound vector Cut response");
    const resultNodeId = response.resultNodeIds[1];
    expect(resultNodeId).toMatch(/^vector_cut_[a-f0-9]{32}$/);
    expect(runtime().getSnapshot().document.revision).toBe(beforeRevision + 1);
    const retained = runtime().getSnapshot().document.nodesById.compound_vector;
    const extracted = runtime().getSnapshot().document.nodesById[resultNodeId];
    if (
      !retained ||
      retained.kind !== "vector" ||
      !("network" in retained.properties) ||
      !extracted ||
      extracted.kind !== "vector" ||
      !("network" in extracted.properties)
    ) {
      throw new Error("Missing divided compound Vector fixtures");
    }
    expect(retained.properties.network.regions[0]?.loops).toEqual([
      { pathId: "compound_outer_path", reversed: false },
    ]);
    expect(extracted.properties.network.regions[0]?.loops).toEqual([
      { pathId: "path_edit_1", reversed: false },
      { pathId: "compound_hole_path", reversed: true },
    ]);
    expect(runtime().getSnapshot().state.selection).toEqual({
      nodeIds: ["compound_vector", resultNodeId],
      anchorNodeId: resultNodeId,
    });
    expect(runtime().getSnapshot().state.history.undo.at(-1)?.label).toBe(
      "Edit vector points",
    );
    expect(runtime().undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime().getSnapshot().document.nodesById[resultNodeId],
    ).toBeUndefined();
  });

  it("stitches a crossed compound hole through the Canvas host in one undo step", async () => {
    renderApp();
    act(() => {
      const current = runtime().getSnapshot();
      const result = runtime().apply({
        transactionId: "insert_crossed_compound_vector",
        documentId: current.document.documentId,
        baseRevision: current.document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Insert crossed compound vector",
        commands: [
          {
            commandId: "insert_crossed_compound_vector",
            type: "insert_element",
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 0,
            node: compoundCanvasVector("frame_welcome"),
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      runtime().setSelection(["compound_vector"], "compound_vector");
    });
    const canvas = screen.getByRole("main", { name: "Design canvas" });
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Enter" });
    await waitFor(() =>
      expect(leaferHarness.input?.vectorEditScope).toMatchObject({
        activeNodeId: "compound_vector",
        nodes: [{ nodeId: "compound_vector", readOnly: false }],
      }),
    );

    const beforeRevision = runtime().getSnapshot().document.revision;
    let response:
      | ReturnType<NonNullable<LeaferEngineCallbacks["onVectorLineCut"]>>
      | undefined;
    act(() => {
      response = leaferCallbacks().onVectorLineCut?.({
        end: { x: 260, y: 144 },
        nodeIds: ["compound_vector"],
        start: { x: 100, y: 144 },
      });
    });
    expect(response).toMatchObject({ ok: true });
    if (!response?.ok) throw new Error("Missing crossed-hole Cut response");
    const resultNodeId = response.resultNodeIds[1];
    for (const nodeId of ["compound_vector", resultNodeId]) {
      const node = runtime().getSnapshot().document.nodesById[nodeId];
      if (!node || node.kind !== "vector" || !("network" in node.properties)) {
        throw new Error("Missing Canvas crossed-hole result");
      }
      expect(node.properties.network.paths).toHaveLength(1);
      expect(node.properties.network.regions).toHaveLength(1);
      expect(node.properties.network.regions[0]?.loops).toEqual([
        expect.objectContaining({ reversed: false }),
      ]);
    }
    expect(runtime().getSnapshot().document.revision).toBe(beforeRevision + 1);
    expect(runtime().getSnapshot().state.selection).toEqual({
      nodeIds: ["compound_vector", resultNodeId],
      anchorNodeId: resultNodeId,
    });
    expect(runtime().getSnapshot().state.history.undo.at(-1)?.label).toBe(
      "Edit vector points",
    );
    expect(runtime().undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime().getSnapshot().document.nodesById[resultNodeId],
    ).toBeUndefined();
  });

  it("keeps one retained and two extracted concave components editable from Canvas", async () => {
    renderApp();
    act(() => {
      const current = runtime().getSnapshot();
      const result = runtime().apply({
        transactionId: "insert_concave_vector",
        documentId: current.document.documentId,
        baseRevision: current.document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Insert concave vector",
        commands: [
          {
            commandId: "insert_concave_vector",
            type: "insert_element",
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 0,
            node: concaveCanvasVector("frame_welcome"),
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      runtime().setSelection(["concave_vector"], "concave_vector");
    });
    const canvas = screen.getByRole("main", { name: "Design canvas" });
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Enter" });
    await waitFor(() =>
      expect(leaferHarness.input?.vectorEditScope).toMatchObject({
        activeNodeId: "concave_vector",
        nodes: [{ nodeId: "concave_vector", readOnly: false }],
      }),
    );

    let response:
      | ReturnType<NonNullable<LeaferEngineCallbacks["onVectorLineCut"]>>
      | undefined;
    act(() => {
      response = leaferCallbacks().onVectorLineCut?.({
        end: { x: 260, y: 154 },
        nodeIds: ["concave_vector"],
        start: { x: 100, y: 154 },
      });
    });
    expect(response).toMatchObject({ ok: true });
    if (!response?.ok) throw new Error("Missing concave Cut response");
    const resultNodeId = response.resultNodeIds[1];
    const retained = runtime().getSnapshot().document.nodesById.concave_vector;
    const extracted = runtime().getSnapshot().document.nodesById[resultNodeId];
    if (
      !retained ||
      retained.kind !== "vector" ||
      !("network" in retained.properties) ||
      !extracted ||
      extracted.kind !== "vector" ||
      !("network" in extracted.properties)
    ) {
      throw new Error("Missing Canvas concave Cut result");
    }
    expect(retained.properties.network.paths.map((path) => path.id)).toEqual([
      "path_concave",
    ]);
    expect(extracted.properties.network.paths.map((path) => path.id)).toEqual([
      "path_edit_1",
      "path_edit_2",
    ]);
    expect(extracted.properties.network.regions).toHaveLength(2);
    expect(runtime().getSnapshot().state.selection).toEqual({
      nodeIds: ["concave_vector", resultNodeId],
      anchorNodeId: resultNodeId,
    });
    expect(runtime().undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime().getSnapshot().document.nodesById[resultNodeId],
    ).toBeUndefined();
  });

  it("reorders selected siblings from the layer-order menu and macOS shortcuts", async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => runtime().setSelection(["title_welcome"], "title_welcome"));

    await user.click(screen.getByRole("button", { name: "Layer order" }));
    await user.click(screen.getByRole("menuitem", { name: "Bring forward" }));
    expect(
      runtime().getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual([
      "shape_accent",
      "subtitle_welcome",
      "title_welcome",
      "feature_group",
    ]);
    expect(runtime().getSnapshot().state.selection).toEqual({
      nodeIds: ["title_welcome"],
      anchorNodeId: "title_welcome",
    });

    fireEvent.keyDown(window, {
      key: "]",
      code: "BracketRight",
      metaKey: true,
      altKey: true,
    });
    expect(
      runtime().getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual([
      "shape_accent",
      "subtitle_welcome",
      "feature_group",
      "title_welcome",
    ]);

    fireEvent.keyDown(window, {
      key: "[",
      code: "BracketLeft",
      metaKey: true,
      altKey: true,
    });
    const snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById.frame_welcome?.childIds).toEqual([
      "title_welcome",
      "shape_accent",
      "subtitle_welcome",
      "feature_group",
    ]);
    expect(snapshot.document.revision).toBe(3);
    expect(snapshot.state.history.undo).toHaveLength(3);
  });

  it("uses Windows layer-order shortcuts without stealing editable input", async () => {
    vi.mocked(window.desktop!.getPlatformInfo).mockResolvedValueOnce({
      platform: "win32",
      version: "0.0.0",
    });
    renderApp();
    act(() => runtime().setSelection(["title_welcome"], "title_welcome"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Layer order" })).toBeEnabled(),
    );

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, {
      key: "}",
      code: "BracketRight",
      ctrlKey: true,
      shiftKey: true,
    });
    input.remove();
    expect(runtime().getSnapshot().document.revision).toBe(0);

    fireEvent.keyDown(window, {
      key: "}",
      code: "BracketRight",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(
      runtime().getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual([
      "shape_accent",
      "subtitle_welcome",
      "feature_group",
      "title_welcome",
    ]);
    expect(runtime().getSnapshot().document.revision).toBe(1);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Layer order" }));
    expect(screen.getByText("Ctrl+Shift+[")).toBeInTheDocument();
  });

  it.each(["darwin", "win32"] as const)(
    "reparents a layer from the tree atomically on %s and restores it with one undo",
    async (platform) => {
      vi.mocked(window.desktop!.getPlatformInfo).mockResolvedValueOnce({
        platform,
        version: "0.0.0",
      });
      const user = userEvent.setup();
      renderApp();
      const before = runtime().getSnapshot();
      const beforeWorld = getWorldTransform(before.document, "title_welcome");
      act(() => runtime().setSelection(["title_welcome"], "title_welcome"));
      const source = screen.getByRole("button", { name: "Title" });
      const target = screen
        .getByRole("button", { name: "Capabilities" })
        .closest('[role="treeitem"]');
      if (!target) throw new Error("Missing target layer row");
      vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
        top: 100,
        bottom: 128,
        left: 0,
        right: 220,
        width: 220,
        height: 28,
        x: 0,
        y: 100,
        toJSON: () => undefined,
      });
      const dataTransfer = {
        dropEffect: "none",
        effectAllowed: "none",
        setData: vi.fn(),
      };

      fireEvent.dragStart(source, { dataTransfer });
      const dragOver = createEvent.dragOver(target, { dataTransfer });
      Object.defineProperty(dragOver, "clientY", { value: 114 });
      fireEvent(target, dragOver);
      expect(screen.getByText("Inside")).toBeInTheDocument();
      const drop = createEvent.drop(target, { dataTransfer });
      Object.defineProperty(drop, "clientY", { value: 114 });
      fireEvent(target, drop);

      const moved = runtime().getSnapshot();
      expect(moved.document.nodesById.title_welcome?.parentId).toBe(
        "feature_group",
      );
      expect(getWorldTransform(moved.document, "title_welcome")).toEqual(
        beforeWorld,
      );
      expect(moved.state.selection).toEqual({
        nodeIds: ["title_welcome"],
        anchorNodeId: "title_welcome",
      });
      expect(moved.document.revision).toBe(1);
      expect(moved.state.history.undo).toHaveLength(1);

      await user.click(screen.getByRole("button", { name: "Undo" }));
      const restored = runtime().getSnapshot();
      expect(restored.document.nodesById.title_welcome?.parentId).toBe(
        "frame_welcome",
      );
      expect(getWorldTransform(restored.document, "title_welcome")).toEqual(
        beforeWorld,
      );
      expect(restored.document.revision).toBe(2);
    },
  );

  it("rejects cyclic tree drops without mutating the document or leaving drop chrome", () => {
    renderApp();
    const source = screen.getByRole("button", { name: "Welcome canvas" });
    const target = screen
      .getByRole("button", { name: "Capabilities" })
      .closest('[role="treeitem"]');
    if (!target) throw new Error("Missing target layer row");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 128,
      left: 0,
      right: 220,
      width: 220,
      height: 28,
      x: 0,
      y: 100,
      toJSON: () => undefined,
    });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
    };

    fireEvent.dragStart(source, { dataTransfer });
    const dragOver = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(dragOver, "clientY", { value: 114 });
    fireEvent(target, dragOver);
    expect(screen.getByText("Inside")).toBeInTheDocument();
    const drop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(drop, "clientY", { value: 114 });
    fireEvent(target, drop);

    const snapshot = runtime().getSnapshot();
    expect(snapshot.document.revision).toBe(0);
    expect(snapshot.state.history.undo).toHaveLength(0);
    expect(snapshot.document.pagesById.page_welcome?.rootNodeIds).toEqual([
      "frame_welcome",
    ]);
    expect(screen.queryByText("Inside")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        "A layer cannot be moved into itself or one of its descendants",
      ),
    ).not.toHaveLength(0);
  });

  it("uses Windows hierarchy shortcuts and labels without stealing text input", async () => {
    vi.mocked(window.desktop!.getPlatformInfo).mockResolvedValueOnce({
      platform: "win32",
      version: "0.0.0",
    });
    renderApp();
    act(() =>
      runtime().setSelection(
        ["title_welcome", "subtitle_welcome"],
        "title_welcome",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Group selection (Ctrl+G)" }),
      ).toBeEnabled(),
    );

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "g", ctrlKey: true });
    input.remove();
    expect(runtime().getSnapshot().document.revision).toBe(0);

    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    let snapshot = runtime().getSnapshot();
    const group = Object.values(snapshot.document.nodesById).find(
      (node) =>
        node.kind === "group" && node.childIds.includes("title_welcome"),
    );
    expect(snapshot.state.selection.nodeIds).toEqual([group?.id]);

    fireEvent.keyDown(window, { key: "g", ctrlKey: true, shiftKey: true });
    snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById[group?.id ?? "missing"]).toBeUndefined();
    expect(snapshot.state.selection.nodeIds).toEqual([
      "title_welcome",
      "subtitle_welcome",
    ]);
  });

  it("uses the Windows mask shortcut without stealing editable input", async () => {
    vi.mocked(window.desktop!.getPlatformInfo).mockResolvedValueOnce({
      platform: "win32",
      version: "0.0.0",
    });
    renderApp();
    act(() =>
      runtime().setSelection(
        ["title_welcome", "subtitle_welcome"],
        "subtitle_welcome",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Layer order" })).toBeEnabled(),
    );

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, {
      code: "KeyM",
      key: "m",
      altKey: true,
      ctrlKey: true,
    });
    input.remove();
    expect(runtime().getSnapshot().document.revision).toBe(0);

    fireEvent.keyDown(window, {
      code: "KeyM",
      key: "m",
      altKey: true,
      ctrlKey: true,
    });
    const snapshot = runtime().getSnapshot();
    expect(snapshot.document.nodesById.title_welcome?.maskMode).toBe("alpha");
    expect(snapshot.state.history.undo).toHaveLength(1);
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
    expect(getNodeBounds(snapshot.document, "feature_two")?.x).toBeCloseTo(
      getNodeBounds(snapshot.document, "feature_one")?.x ?? Number.NaN,
      9,
    );
    expect(snapshot.document.revision).toBe(2);
  });

  it.each(["darwin", "win32"] as const)(
    "distributes and sets exact negative spacing from the inspector on %s",
    async (platform) => {
      vi.mocked(window.desktop!.getPlatformInfo).mockResolvedValueOnce({
        platform,
        version: "0.0.0",
      });
      const user = userEvent.setup();
      renderApp();
      act(() =>
        runtime().setSelection(
          ["feature_one", "feature_two", "feature_three"],
          "feature_one",
        ),
      );
      const before = runtime().getSnapshot();
      const firstWorld = getWorldTransform(before.document, "feature_one");
      const thirdWorld = getWorldTransform(before.document, "feature_three");

      await user.click(screen.getByRole("tab", { name: "Properties" }));
      const distribute = screen.getByRole("button", {
        name: "Distribute horizontal spacing",
      });
      expect(distribute).toBeEnabled();
      expect(
        distribute.querySelector(
          '[data-icon="lucide:align-horizontal-distribute-center"]',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Distribute vertical spacing" }),
      ).toBeDisabled();
      expect(screen.getByLabelText("Horizontal space between")).toHaveAttribute(
        "placeholder",
        "Mixed",
      );

      await user.click(distribute);
      let snapshot = runtime().getSnapshot();
      expect(snapshot.document.revision).toBe(1);
      expect(snapshot.state.history.undo).toHaveLength(1);
      expect(snapshot.document.nodesById.feature_group?.size).toEqual({
        width: 892,
        height: 220,
      });
      expect(getNodeBounds(snapshot.document, "feature_two")?.x).toBe(504);
      expect(getWorldTransform(snapshot.document, "feature_one")).toEqual(
        firstWorld,
      );
      expect(getWorldTransform(snapshot.document, "feature_three")).toEqual(
        thirdWorld,
      );

      const spacing = screen.getByLabelText("Horizontal space between");
      await user.clear(spacing);
      await user.type(spacing, "-20{Enter}");
      snapshot = runtime().getSnapshot();
      expect(snapshot.document.revision).toBe(2);
      expect(snapshot.state.history.undo).toHaveLength(2);
      expect(snapshot.document.nodesById.feature_group?.size.width).toBe(740);
      expect(getNodeBounds(snapshot.document, "feature_two")?.x).toBe(428);
      expect(getNodeBounds(snapshot.document, "feature_three")?.x).toBe(712);
      expect(snapshot.state.selection.nodeIds).toEqual([
        "feature_one",
        "feature_two",
        "feature_three",
      ]);

      await user.click(screen.getByRole("button", { name: "Undo" }));
      expect(
        runtime().getSnapshot().document.nodesById.feature_group?.size.width,
      ).toBe(892);
    },
  );

  it.each(["darwin", "win32"] as const)(
    "tidies an inferred row from the inspector on %s",
    async (platform) => {
      vi.mocked(window.desktop!.getPlatformInfo).mockResolvedValueOnce({
        platform,
        version: "0.0.0",
      });
      const user = userEvent.setup();
      renderApp();
      act(() =>
        runtime().setSelection(
          ["feature_one", "feature_two", "feature_three"],
          "feature_one",
        ),
      );

      await user.click(screen.getByRole("tab", { name: "Properties" }));
      const tidyUp = screen.getByRole("button", {
        name: "Tidy up horizontal row",
      });
      expect(tidyUp).toBeEnabled();
      expect(
        tidyUp.querySelector('[data-icon="lucide:panels-top-left"]'),
      ).toBeInTheDocument();
      await user.click(tidyUp);

      const snapshot = runtime().getSnapshot();
      expect(snapshot.document.revision).toBe(1);
      expect(snapshot.state.history.undo).toHaveLength(1);
      expect(getNodeBounds(snapshot.document, "feature_three")?.x).toBe(816);
      expect(snapshot.state.selection.nodeIds).toEqual([
        "feature_one",
        "feature_two",
        "feature_three",
      ]);
      await user.click(screen.getByRole("button", { name: "Undo" }));
      expect(
        getNodeBounds(runtime().getSnapshot().document, "feature_three")?.x,
      ).toBe(864);
    },
  );

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
    expect(
      size.closest('[role="group"][aria-label="Typography"]'),
    ).not.toBeNull();
    await user.clear(size);
    await user.type(size, "64{Enter}");

    expect(
      runtime().getSnapshot().document.nodesById.title_welcome?.properties,
    ).toMatchObject({ content: "Poster headline", fontSize: 64 });
  });

  it("reflows text from the inspector and switches Auto Size to Fixed on manual width", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.click(screen.getByRole("tab", { name: "Properties" }));
    const before = runtime().getSnapshot().document.nodesById.title_welcome;
    if (!before || before.kind !== "text") throw new Error("Missing title");

    await user.selectOptions(
      screen.getByLabelText("Text resizing"),
      "auto-height",
    );
    expect(
      runtime().getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      size: { width: before.size.width, height: before.properties.lineHeight },
      properties: {
        textResize: "auto-height",
        textWrap: "word",
        textOverflow: "visible",
      },
    });

    const width = screen.getByLabelText("Width");
    await user.clear(width);
    await user.type(width, "480{Enter}");
    expect(
      runtime().getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      size: { width: 480 },
      properties: { textResize: "fixed" },
    });
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

  it("keeps the active utility tab stable and shows one primary run status", async () => {
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
      agentTab.querySelector(
        '[data-agent-activity-badge][data-running="true"]',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Design run status" }),
    ).toHaveAttribute("data-canvas-agent-status");

    await user.click(agentTab);
    expect(
      document.querySelector("[data-canvas-agent-status]"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Design run status" }),
    ).not.toHaveAttribute("data-canvas-agent-status");
    expect(screen.getByText("Request in progress")).toBeInTheDocument();
    expect(screen.getByLabelText("Continue the task")).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Send" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();

    await user.click(
      screen.getByRole("button", {
        name: "Toggle Agent and properties panel",
      }),
    );
    expect(document.querySelector(".workspace")).toHaveAttribute(
      "data-utility-panel",
      "hidden",
    );
    expect(
      document.querySelector("[data-canvas-agent-status]"),
    ).toHaveAttribute("data-canvas-agent-status");
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

  it("returns navigator and utility space to the canvas on demand", async () => {
    const user = userEvent.setup();
    renderApp();
    const workspace = document.querySelector(".workspace");
    const navigatorSlot = document.querySelector(".workspace__navigator");
    const centerSlot = document.querySelector(".workspace__center");
    const utilitySlot = document.querySelector(".workspace__utility");
    expect(workspace).toHaveAttribute("data-left-panel", "visible");
    expect(workspace).toHaveAttribute("data-utility-panel", "visible");
    expect(navigatorSlot).not.toHaveAttribute("hidden");
    expect(utilitySlot).not.toHaveAttribute("hidden");
    expect(centerSlot).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Toggle navigator panel" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Toggle Agent and properties panel",
      }),
    );
    expect(workspace).toHaveAttribute("data-left-panel", "hidden");
    expect(workspace).toHaveAttribute("data-utility-panel", "hidden");
    expect(navigatorSlot).toHaveAttribute("hidden");
    expect(utilitySlot).toHaveAttribute("hidden");
    expect(centerSlot).not.toHaveAttribute("hidden");
  });

  it("toggles workbench panels from keyboard without stealing editable input", () => {
    renderApp();
    const workspace = document.querySelector(".workspace");

    fireEvent.keyDown(window, {
      code: "Digit1",
      key: "1",
      metaKey: true,
      shiftKey: true,
    });
    fireEvent.keyDown(window, {
      code: "Digit2",
      key: "2",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(workspace).toHaveAttribute("data-left-panel", "hidden");
    expect(workspace).toHaveAttribute("data-utility-panel", "hidden");
    expect(
      window.localStorage.getItem("opendesign.workbench.panel.navigator"),
    ).toBe("hidden");
    expect(
      window.localStorage.getItem("opendesign.workbench.panel.utility"),
    ).toBe("hidden");

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, {
      code: "Digit1",
      key: "1",
      metaKey: true,
      shiftKey: true,
    });
    expect(workspace).toHaveAttribute("data-left-panel", "hidden");
    input.remove();
  });

  it("collapses panels once at narrow breakpoints while preserving manual control", () => {
    renderApp();
    const workspace = document.querySelector(".workspace");

    window.innerWidth = 900;
    fireEvent(window, new Event("resize"));
    expect(workspace).toHaveAttribute("data-left-panel", "hidden");
    expect(workspace).toHaveAttribute("data-utility-panel", "visible");

    window.innerWidth = 740;
    fireEvent(window, new Event("resize"));
    expect(workspace).toHaveAttribute("data-utility-panel", "hidden");

    fireEvent.keyDown(window, {
      code: "Digit1",
      key: "1",
      metaKey: true,
      shiftKey: true,
    });
    window.innerWidth = 739;
    fireEvent(window, new Event("resize"));
    expect(workspace).toHaveAttribute("data-left-panel", "visible");
  });

  it("persists keyboard-resized panel widths without changing the document", () => {
    renderApp();
    const revision = runtime().getSnapshot().document.revision;
    const navigatorResize = screen.getByRole("separator", {
      name: "Resize document sidebar",
    });

    fireEvent.keyDown(navigatorResize, { key: "ArrowRight" });

    expect(navigatorResize).toHaveAttribute("aria-valuenow", "244");
    expect(
      window.localStorage.getItem("opendesign.workbench.panel.navigator.width"),
    ).toBe("244");
    expect(runtime().getSnapshot().document.revision).toBe(revision);
  });

  it("opens hidden Properties directly from the canvas selection actions", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(
      screen.getByRole("button", {
        name: "Toggle Agent and properties panel",
      }),
    );
    act(() => runtime().setSelection(["shape_accent"], "shape_accent"));

    const workspace = document.querySelector(".workspace");
    expect(workspace).toHaveAttribute("data-utility-panel", "hidden");
    await user.click(
      screen.getByRole("button", { name: "Open selection properties" }),
    );

    expect(workspace).toHaveAttribute("data-utility-panel", "visible");
    expect(screen.getByRole("tab", { name: "Properties" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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

    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: request.runId,
        startedAt: "2026-08-07T10:42:08.000Z",
      });
      emitAgentEvent?.({
        type: "message.completed",
        runId: request.runId,
        messageId: "message_1",
        blocks: [
          {
            blockId: "block_1",
            type: "text",
            text: "Prepared a structured edit plan.",
          },
        ],
      });
      emitAgentEvent?.({
        type: "run.completed",
        runId: request.runId,
        finishedAt: "2026-08-07T10:42:11.000Z",
        stopReason: "complete",
      });
    });

    expect(
      await screen.findByText("Prepared a structured edit plan."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Task completed")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Continue the task")).toBeEnabled();
  });

  it("keeps an accepted typed plan off canvas until real design exists", async () => {
    const { user, conversation } = await openProjectConversation();
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Create an editorial poster",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    const request = runRequests(conversation.conversationId).at(-1);
    if (!request) throw new Error("Agent run request is missing");
    const plan = rendererGenerationPlan();

    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: request.runId,
        startedAt: now,
      });
      emitAgentEvent?.({
        type: "tool.requested",
        runId: request.runId,
        toolCallId: "tool_plan_poster",
        toolName: DESIGN_PLAN_TOOL_NAME,
        input: plan,
        risk: "read",
      });
    });
    expect(leaferHarness.input?.generationSkeleton).toBeUndefined();

    act(() => {
      emitAgentEvent?.({
        type: "tool.completed",
        runId: request.runId,
        toolCallId: "tool_plan_poster",
        result: rendererAcceptedPlanResult(plan),
      });
    });
    await waitFor(() =>
      expect(leaferHarness.input?.generationSkeleton).toBeUndefined(),
    );
    expect(leaferHarness.input?.generationActivity).toBeUndefined();
    expect(screen.queryByText("AI · Structuring the layout")).toBeNull();

    act(() => {
      emitAgentEvent?.({
        type: "tool.requested",
        runId: request.runId,
        toolCallId: "tool_apply_poster",
        toolName: "opendesign_apply_transaction",
        input: { label: "Build poster", commands: [] },
        risk: "design_write",
      });
      emitAgentEvent?.({
        type: "tool.progress",
        runId: request.runId,
        toolCallId: "tool_apply_poster",
        message: "Untrusted progress prose",
        progress: 0.15,
      });
    });
    expect(leaferHarness.input?.generationActivity).toBeUndefined();
    expect(screen.queryByText("Untrusted progress prose")).toBeNull();

    act(() => {
      emitAgentEvent?.({
        type: "tool.completed",
        runId: request.runId,
        toolCallId: "tool_apply_poster",
        result: { ok: true },
      });
    });
    expect(leaferHarness.input?.generationActivity).toBeUndefined();
    expect(screen.queryByText("Untrusted progress prose")).toBeNull();

    act(() => {
      emitAgentEvent?.({
        type: "run.completed",
        runId: request.runId,
        finishedAt: now,
        stopReason: "complete",
      });
    });
    await waitFor(() =>
      expect(leaferHarness.input?.generationSkeleton).toBeUndefined(),
    );
    expect(leaferHarness.input?.generationActivity).toBeUndefined();
    expect(
      screen.queryByText("AI · Structuring the layout"),
    ).not.toBeInTheDocument();
  });

  it("keeps plan-only canvas presentation absent when the user stops", async () => {
    const { user, conversation } = await openProjectConversation();
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Create an editorial poster",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    const request = runRequests(conversation.conversationId).at(-1);
    if (!request) throw new Error("Agent run request is missing");
    const plan = rendererGenerationPlan();

    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: request.runId,
        startedAt: now,
      });
      emitAgentEvent?.({
        type: "tool.requested",
        runId: request.runId,
        toolCallId: "tool_plan_stop",
        toolName: DESIGN_PLAN_TOOL_NAME,
        input: plan,
        risk: "read",
      });
      emitAgentEvent?.({
        type: "tool.completed",
        runId: request.runId,
        toolCallId: "tool_plan_stop",
        result: rendererAcceptedPlanResult(plan),
      });
    });
    await waitFor(() =>
      expect(leaferHarness.input?.generationSkeleton).toBeUndefined(),
    );
    expect(leaferHarness.input?.generationActivity).toBeUndefined();

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(window.desktop?.sendAgentRequest).toHaveBeenCalledWith({
      type: "run.cancel",
      runId: request.runId,
    });
    await waitFor(() =>
      expect(leaferHarness.input?.generationSkeleton).toBeUndefined(),
    );
    expect(leaferHarness.input?.generationActivity).toBeUndefined();
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
    const { user, conversation } = await openProjectConversation();
    const historyCountBeforeRun = historyRequests(
      conversation.conversationId,
    ).length;
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
        type: "message.delta",
        runId: request.runId,
        messageId: "message_interrupted",
        blockId: "block_interrupted",
        delta: "Partial design response",
      });
    });
    expect(document.querySelectorAll("[data-agent-caret]")).toHaveLength(1);
    expect(screen.getByText("Partial design response")).toBeVisible();
    act(() => {
      emitAgentEvent?.({
        type: "agent.error",
        code: "provider_timeout",
        runId: request.runId,
        message:
          "Model provider timed out after 180000 ms waiting for a response",
        failure: {
          code: "provider_timeout",
          message:
            "Model provider timed out after 180000 ms waiting for a response",
          retryable: true,
          provider: "provider_1",
          modelRequestId: "model_timeout_1",
          timeout: { phase: "first-response", thresholdMs: 180_000 },
        },
      });
    });

    expect(
      screen.getByText("Model did not start responding"),
    ).toBeInTheDocument();
    const retryPrompt = screen.getByLabelText("Continue the task");
    expect(retryPrompt).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Stop" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector("[data-agent-caret]")).toBeNull();

    act(() => {
      emitAgentEvent?.({
        type: "run.completed",
        runId: request.runId,
        finishedAt: now,
        stopReason: "error",
      });
    });
    await waitFor(() =>
      expect(historyRequests(conversation.conversationId)).toHaveLength(
        historyCountBeforeRun + 1,
      ),
    );

    await user.type(retryPrompt, "Retry with a simpler plan");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Send" }));
    const retry = runRequests(conversation.conversationId).at(-1);
    if (!retry || retry.runId === request.runId) {
      throw new Error("Retry run request is missing");
    }
    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: retry.runId,
        startedAt: now,
      });
      emitAgentEvent?.({
        type: "message.delta",
        runId: retry.runId,
        messageId: "message_retry",
        blockId: "block_retry",
        delta: "Retry response",
      });
    });
    expect(document.querySelectorAll("[data-agent-caret]")).toHaveLength(1);
    expect(screen.getByText("Partial design response")).toBeVisible();
    expect(screen.getByText("Retry response")).toBeVisible();
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
        type: "message.delta",
        runId: request.runId,
        messageId: "message_process_exit",
        blockId: "block_process_exit",
        delta: "Interrupted by process exit",
      });
    });
    expect(document.querySelectorAll("[data-agent-caret]")).toHaveLength(1);
    expect(screen.getByText("Interrupted by process exit")).toBeVisible();
    act(() => {
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
    expect(document.querySelector("[data-agent-caret]")).toBeNull();
    await waitFor(() =>
      expect(leaferHarness.finishGenerationPresentation).toHaveBeenCalledTimes(
        1,
      ),
    );
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
    const { conversation, manifest } = await openProjectConversation();
    const descriptor = manifest.designFiles[0];
    if (!descriptor) throw new Error("Mobile design file is missing");
    let finishSave!: (saved: ProjectDesignFile) => void;
    const pendingSave = new Promise<ProjectDesignFile>((resolve) => {
      finishSave = resolve;
    });
    vi.mocked(window.desktop!.saveProjectDesignFile).mockReturnValueOnce(
      pendingSave,
    );
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
          sessionId: conversation.conversationId,
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
    await waitFor(() => {
      const request = vi
        .mocked(window.desktop!.saveProjectDesignFile)
        .mock.calls.find(
          ([candidate]) => candidate.designFileId === "design_mobile",
        )?.[0];
      expect(request?.projectId).toBe("project_acme");
      expect(request?.document.documentId).toBe("document_mobile");
      expect(request?.document.revision).toBe(1);
    });
    expect(
      resolveDesignToolRequest.mock.calls.some(
        ([response]) => response.requestId === "renderer_tool_1",
      ),
    ).toBe(false);

    finishSave({
      descriptor: {
        ...descriptor,
        updatedAt: "2026-08-11T12:00:00.000Z",
      },
      document: runtime().getSnapshot().document,
    });
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

  it("does not report an Agent design write as successful when autosave fails", async () => {
    const { conversation } = await openProjectConversation();
    vi.mocked(window.desktop!.saveProjectDesignFile).mockRejectedValueOnce(
      new Error("Disk is read-only"),
    );
    const current = runtime().getSnapshot().document;
    if (!requestDesignTool) throw new Error("Design tool listener is missing");

    act(() => {
      requestDesignTool?.({
        requestId: "renderer_tool_autosave_failure",
        call: {
          toolCallId: "tool_call_autosave_failure",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Rename without persistence",
            commands: [
              {
                commandId: "rename_without_persistence",
                type: "update_properties",
                nodeId: "frame_welcome",
                name: "Dirty Agent result",
              },
            ],
          },
        },
        context: {
          runId: "run_autosave_failure",
          sessionId: conversation.conversationId,
          documentId: current.documentId,
          revision: current.revision,
          scope: { kind: "document", selectedNodeIds: [] },
          mutationTarget: { kind: "document" },
        },
      });
    });

    await waitFor(() => {
      const response = vi
        .mocked(window.desktop!.resolveDesignToolRequest)
        .mock.calls.find(
          ([candidate]) =>
            candidate.requestId === "renderer_tool_autosave_failure",
        )?.[0];
      expect(response?.ok).toBe(false);
      if (response?.ok === false)
        expect(response.error).toMatchObject({
          code: "design_tool_execution_failed",
          message: "Disk is read-only",
          recoverable: true,
          retryable: false,
        });
    });
    expect(runtimeOutput()).toHaveAttribute("data-dirty", "true");
    expect(await screen.findByText("Disk is read-only")).toBeInTheDocument();
  });

  it("keeps a Run bound to file A while the user works in file B", async () => {
    const { user, manifest, conversation } = await openProjectConversation();
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Refine file A in the background",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    const run = runRequests(conversation.conversationId).at(-1);
    if (!run) throw new Error("Agent run request is missing");
    const plan = rendererGenerationPlan();
    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: run.runId,
        startedAt: now,
      });
      emitAgentEvent?.({
        type: "tool.requested",
        runId: run.runId,
        toolCallId: "tool_background_plan_a",
        toolName: DESIGN_PLAN_TOOL_NAME,
        input: plan,
        risk: "read",
      });
      emitAgentEvent?.({
        type: "tool.completed",
        runId: run.runId,
        toolCallId: "tool_background_plan_a",
        result: rendererAcceptedPlanResult(plan),
      });
    });
    await waitFor(() =>
      expect(leaferHarness.input?.generationSkeleton).toBeUndefined(),
    );
    const mobileTab = screen.getByRole("tab", { name: /Mobile UI/ });
    expect(
      within(mobileTab).getByLabelText("Used by a background task"),
    ).toBeInTheDocument();

    const websiteDescriptor = manifest.designFiles[1];
    if (!websiteDescriptor) throw new Error("Website design file is missing");
    const websiteDocument = structuredClone(createWelcomeDocument());
    websiteDocument.documentId = websiteDescriptor.documentId;
    vi.mocked(window.desktop!.readProjectDesignFile).mockResolvedValueOnce({
      descriptor: websiteDescriptor,
      document: websiteDocument,
    });
    await user.click(screen.getByRole("button", { name: "Acme Design" }));
    await user.click(screen.getByRole("button", { name: /Website/ }));
    expect(runtime().getSnapshot().document.documentId).toBe(
      "document_website",
    );
    expect(runtime().getSnapshot().document.revision).toBe(0);
    expect(leaferHarness.input?.generationSkeleton).toBeUndefined();
    expect(leaferHarness.input?.generationActivity).toBeUndefined();

    if (!requestDesignTool) throw new Error("Design tool listener is missing");
    act(() => {
      requestDesignTool?.({
        requestId: "renderer_background_file_a",
        call: {
          toolCallId: "tool_background_file_a",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Refine file A",
            commands: [
              {
                commandId: "rename_file_a_frame",
                type: "update_properties",
                nodeId: "frame_welcome",
                name: "Agent-updated file A",
              },
            ],
          },
        },
        context: {
          runId: run.runId,
          sessionId: conversation.conversationId,
          documentId: "document_mobile",
          revision: 0,
          scope: {
            kind: "page",
            pageId: "page_welcome",
            selectedNodeIds: [],
          },
          mutationTarget: { kind: "page", pageId: "page_welcome" },
        },
      });
    });

    const resolveDesignToolRequest = vi.mocked(
      window.desktop!.resolveDesignToolRequest,
    );
    await vi.waitFor(() => {
      const response = resolveDesignToolRequest.mock.calls.find(
        ([candidate]) => candidate.requestId === "renderer_background_file_a",
      )?.[0];
      expect(response?.ok).toBe(true);
      if (!response?.ok) return;
      expect(response.result.designRevision?.revision).toBe(1);
    });
    const backgroundSave = vi
      .mocked(window.desktop!.saveProjectDesignFile)
      .mock.calls.find(
        ([request]) => request.designFileId === "design_mobile",
      )?.[0];
    expect(backgroundSave?.projectId).toBe(manifest.projectId);
    expect(backgroundSave?.document.documentId).toBe("document_mobile");
    expect(backgroundSave?.document.revision).toBe(1);
    expect(
      vi
        .mocked(window.desktop!.saveProjectDesignFile)
        .mock.calls.some(
          ([request]) => request.designFileId === "design_website",
        ),
    ).toBe(false);
    expect(runtime().getSnapshot().document.documentId).toBe(
      "document_website",
    );
    expect(runtime().getSnapshot().document.revision).toBe(0);
    expect(runtime().getSnapshot().document.nodesById.frame_welcome?.name).toBe(
      "Welcome canvas",
    );

    const captureAttachmentId = `image_${"d".repeat(64)}`;
    vi.mocked(window.desktop!.importAgentAttachments).mockResolvedValueOnce([
      {
        attachmentId: captureAttachmentId,
        name: "OpenDesign frame r1.jpg",
        mimeType: "image/jpeg",
        byteSize: 3,
      },
    ]);
    const captureTarget = {
      kind: "frame" as const,
      pageId: "page_welcome",
      nodeId: "frame_welcome",
    };
    act(() => {
      requestDesignTool?.({
        requestId: "renderer_background_capture_a",
        call: {
          toolCallId: "tool_background_capture_a",
          toolName: "opendesign_capture_canvas",
          input: {},
        },
        context: {
          runId: run.runId,
          sessionId: conversation.conversationId,
          documentId: "document_mobile",
          revision: 1,
          scope: {
            kind: "page",
            pageId: "page_welcome",
            selectedNodeIds: [],
          },
          mutationTarget: { kind: "page", pageId: "page_welcome" },
        },
        captureTarget,
      });
    });
    await vi.waitFor(() => {
      const [capturedDocument, capturedTarget] =
        captureHarness.capture.mock.calls.at(-1) ?? [];
      expect(capturedDocument?.documentId).toBe("document_mobile");
      expect(capturedDocument?.revision).toBe(1);
      expect(capturedTarget).toEqual(captureTarget);
      const response = resolveDesignToolRequest.mock.calls.find(
        ([candidate]) =>
          candidate.requestId === "renderer_background_capture_a",
      )?.[0];
      expect(response?.ok).toBe(true);
      if (!response?.ok) return;
      expect(response.result.observedRevision).toBe(1);
    });
    expect(runtime().getSnapshot().document.documentId).toBe(
      "document_website",
    );
    expect(runtime().getSnapshot().document.revision).toBe(0);

    await user.click(screen.getByRole("tab", { name: /Mobile UI/ }));
    expect(runtime().getSnapshot().document.documentId).toBe("document_mobile");
    expect(runtime().getSnapshot().document.revision).toBe(1);
    expect(runtime().getSnapshot().document.nodesById.frame_welcome?.name).toBe(
      "Agent-updated file A",
    );

    act(() => {
      emitAgentEvent?.({
        type: "run.completed",
        runId: run.runId,
        finishedAt: now,
        stopReason: "complete",
      });
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole("tab", { name: /Mobile UI/ })).queryByLabelText(
          "Used by a background task",
        ),
      ).toBeNull(),
    );
  });

  it("captures the trusted design target without consuming viewport presentation", async () => {
    const attachmentId = `image_${"c".repeat(64)}`;
    vi.mocked(window.desktop!.importAgentAttachments).mockResolvedValueOnce([
      {
        attachmentId,
        name: "OpenDesign page r0.jpg",
        mimeType: "image/jpeg",
        byteSize: 3,
      },
    ]);
    const { user, conversation } = await openProjectConversation();
    await user.type(
      screen.getByLabelText("Continue the task"),
      "Create an editorial poster",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    const run = runRequests(conversation.conversationId).at(-1);
    if (!run) throw new Error("Agent run request is missing");
    const plan = rendererGenerationPlan();
    act(() => {
      emitAgentEvent?.({
        type: "run.started",
        runId: run.runId,
        startedAt: now,
      });
      emitAgentEvent?.({
        type: "tool.requested",
        runId: run.runId,
        toolCallId: "tool_plan_capture",
        toolName: DESIGN_PLAN_TOOL_NAME,
        input: plan,
        risk: "read",
      });
      emitAgentEvent?.({
        type: "tool.completed",
        runId: run.runId,
        toolCallId: "tool_plan_capture",
        result: rendererAcceptedPlanResult(plan),
      });
    });
    await waitFor(() =>
      expect(leaferHarness.input?.generationSkeleton).toBeUndefined(),
    );
    expect(leaferHarness.input?.generationActivity).toBeUndefined();
    if (!requestDesignTool) throw new Error("Design tool listener is missing");
    leaferHarness.finishGenerationPresentation.mockClear();
    const current = runtime().getSnapshot().document;
    const captureTarget = { kind: "page" as const, pageId: "page_welcome" };

    act(() => {
      requestDesignTool?.({
        requestId: "renderer_capture_final_presentation",
        call: {
          toolCallId: "tool_capture_final_presentation",
          toolName: "opendesign_capture_canvas",
          input: {},
        },
        context: {
          runId: run.runId,
          sessionId: conversation.conversationId,
          documentId: current.documentId,
          revision: current.revision,
          scope: { kind: "document", selectedNodeIds: [] },
          mutationTarget: { kind: "document" },
        },
        captureTarget,
      });
    });

    await vi.waitFor(() => {
      expect(captureHarness.capture).toHaveBeenCalledTimes(1);
      const captureCall = captureHarness.capture.mock.calls[0];
      expect(captureCall?.[0]).toBe(current);
      expect(captureCall?.[1]).toEqual(captureTarget);
      expect(captureCall?.[2]).toBeInstanceOf(AbortSignal);
      expect(typeof captureCall?.[3]?.onStage).toBe("function");
      expect(leaferHarness.finishGenerationPresentation).not.toHaveBeenCalled();
      expect(window.desktop!.resolveDesignToolRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "renderer_capture_final_presentation",
          ok: true,
        }),
      );
    });
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

  it("positions diagnostic notifications in the editor workspace instead of the Agent composer", () => {
    renderApp();
    if (!emitDiagnosticEvent) throw new Error("Diagnostic listener is missing");

    act(() => {
      emitDiagnosticEvent?.({
        version: 3,
        eventId: "diagnostic_revision_conflict",
        occurredAt: now,
        level: "error",
        source: "main",
        presentation: "toast",
        code: "request_failed",
        message: "Run revision 136 is stale",
        appVersion: "0.0.0",
        platform: "darwin",
        context: { requestId: "request_revision_conflict" },
      });
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Run revision 136 is stale");
    const notifications = alert.closest("aside");
    expect(notifications).toHaveAttribute("data-placement", "editor");
    expect(notifications?.parentElement).toHaveClass("app-shell");
    expect(alert.closest("[data-agent-prompt]")).toBeNull();
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

function rendererGenerationPlan(): DesignPlanToolInput {
  return {
    version: 1,
    deliverable: "poster",
    objective: "Create an editorial launch poster",
    outputMode: "editable-composition",
    targets: [
      {
        targetId: "poster",
        label: "Launch poster",
        pageId: "page_welcome",
        objective: "Create an editorial launch poster",
        artboard: {
          mode: "create",
          frameId: "poster_artboard",
          x: 1_240,
          y: 80,
          width: 800,
          height: 1_000,
        },
        composition: {
          direction: "Asymmetric editorial composition",
          hierarchy: ["Hero visual", "Launch typography"],
          regions: [
            {
              nodeId: "poster_hero",
              name: "Hero visual",
              role: "graphic",
              x: 48,
              y: 80,
              width: 704,
              height: 560,
            },
            {
              nodeId: "poster_title",
              name: "Launch typography",
              role: "typography",
              x: 48,
              y: 688,
              width: 704,
              height: 200,
            },
          ],
          assetIntegration:
            "Use editable vector artwork with intentional overlap and negative space",
          spacingRhythm: "8/16/24/48 px editorial rhythm",
        },
        editableLayers: ["Hero visual", "Title", "Supporting copy"],
        implementationSteps: [
          "Create the artboard",
          "Build the planned regions",
          "Refine depth and hierarchy",
        ],
        validationChecks: ["Check silhouette", "Check type hierarchy"],
        qualityProfile: { kind: "graphic" },
      },
    ],
    visualSystem: {
      avoidances: ["No generic text slab", "No centered card stack"],
      formLanguage: "Sharp editorial geometry with one organic hero",
      palette: ["#111111", "#F4F0E8", "#7C6EE6"],
      surfaceAndDepth: "Overlap and tonal contrast without generic cards",
      typography: ["Display 72/76", "Body 18/26"],
      effects: ["Tight outer glow"],
    },
    rasterAssetRoles: [],
    componentStrategy: {
      summary: "A single poster does not need a reusable component.",
      candidates: [],
    },
    briefFidelity: {
      requiredContent: ["Editorial launch poster"],
      preservedSemantics: [],
      prohibitedAdditions: ["No unrequested product capability"],
      assumptions: ["Use a portrait poster format"],
    },
    designIntent: {
      subject: "An editorial poster for a focused product launch",
      audience: "Design-aware launch viewers",
      primaryJob: "Recognize the launch identity and message immediately",
      visualThesis:
        "An asymmetric editorial collision makes the launch message memorable.",
      signatureMotif:
        "One organic hero silhouette cuts through a rigid typographic grid.",
      typographyLanguage:
        "Large editorial display type contrasts with controlled supporting copy.",
      colorMaterialLanguage:
        "Warm paper, deep ink, and one violet signal create tactile contrast.",
      compositionTension:
        "Cropping, overlap, and asymmetric mass create a decisive focal path.",
      antiPatterns: [
        "No generic centered text slab",
        "No repeated rounded cards",
        "No decorative gradient without purpose",
      ],
    },
    skillRefs: [],
  };
}

function rendererAcceptedPlanResult(plan: DesignPlanToolInput) {
  return {
    ok: true,
    status: "accepted",
    version: plan.version,
    deliverable: plan.deliverable,
    outputMode: plan.outputMode,
    targets: plan.targets,
    rasterAssetRoles: plan.rasterAssetRoles,
  };
}

function compoundCanvasVector(parentId: string): VectorNode {
  return {
    id: "compound_vector",
    name: "Compound badge",
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 40, 40],
    size: { width: 100, height: 100 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "vector",
    properties: {
      network: {
        vertices: [
          { id: "compound_outer_a", x: 0, y: 0 },
          { id: "compound_outer_b", x: 100, y: 0 },
          { id: "compound_outer_c", x: 100, y: 100 },
          { id: "compound_outer_d", x: 0, y: 100 },
          { id: "compound_hole_a", x: 30, y: 30 },
          { id: "compound_hole_b", x: 70, y: 30 },
          { id: "compound_hole_c", x: 70, y: 70 },
          { id: "compound_hole_d", x: 30, y: 70 },
        ],
        segments: [
          {
            id: "compound_outer_ab",
            startVertexId: "compound_outer_a",
            endVertexId: "compound_outer_b",
          },
          {
            id: "compound_outer_bc",
            startVertexId: "compound_outer_b",
            endVertexId: "compound_outer_c",
          },
          {
            id: "compound_outer_cd",
            startVertexId: "compound_outer_c",
            endVertexId: "compound_outer_d",
          },
          {
            id: "compound_outer_da",
            startVertexId: "compound_outer_d",
            endVertexId: "compound_outer_a",
          },
          {
            id: "compound_hole_ab",
            startVertexId: "compound_hole_a",
            endVertexId: "compound_hole_b",
          },
          {
            id: "compound_hole_bc",
            startVertexId: "compound_hole_b",
            endVertexId: "compound_hole_c",
          },
          {
            id: "compound_hole_cd",
            startVertexId: "compound_hole_c",
            endVertexId: "compound_hole_d",
          },
          {
            id: "compound_hole_da",
            startVertexId: "compound_hole_d",
            endVertexId: "compound_hole_a",
          },
        ],
        paths: [
          {
            id: "compound_outer_path",
            closed: true,
            segments: [
              { segmentId: "compound_outer_ab", reversed: false },
              { segmentId: "compound_outer_bc", reversed: false },
              { segmentId: "compound_outer_cd", reversed: false },
              { segmentId: "compound_outer_da", reversed: false },
            ],
          },
          {
            id: "compound_hole_path",
            closed: true,
            segments: [
              { segmentId: "compound_hole_ab", reversed: false },
              { segmentId: "compound_hole_bc", reversed: false },
              { segmentId: "compound_hole_cd", reversed: false },
              { segmentId: "compound_hole_da", reversed: false },
            ],
          },
        ],
        regions: [
          {
            id: "compound_region",
            windingRule: "nonzero",
            loops: [
              { pathId: "compound_outer_path", reversed: false },
              { pathId: "compound_hole_path", reversed: true },
            ],
          },
        ],
      },
      fills: [{ type: "solid", color: "#151515", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
  };
}

function concaveCanvasVector(parentId: string): VectorNode {
  const points = [
    [0, 0],
    [100, 0],
    [100, 100],
    [70, 100],
    [70, 30],
    [30, 30],
    [30, 100],
    [0, 100],
  ] as const;
  const vertexIds = points.map((_point, index) => `vertex_concave_${index}`);
  const segmentIds = points.map((_point, index) => `segment_concave_${index}`);
  return {
    id: "concave_vector",
    name: "Concave badge",
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 40, 40],
    size: { width: 100, height: 100 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "vector",
    properties: {
      network: {
        vertices: points.map(([x, y], index) => ({
          id: vertexIds[index],
          x,
          y,
        })),
        segments: points.map((_point, index) => ({
          id: segmentIds[index],
          startVertexId: vertexIds[index],
          endVertexId: vertexIds[(index + 1) % vertexIds.length],
        })),
        paths: [
          {
            id: "path_concave",
            closed: true,
            segments: segmentIds.map((segmentId) => ({
              segmentId,
              reversed: false,
            })),
          },
        ],
        regions: [
          {
            id: "region_concave",
            windingRule: "nonzero",
            loops: [{ pathId: "path_concave", reversed: false }],
          },
        ],
      },
      fills: [{ type: "solid", color: "#151515", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
  };
}

function leaferCallbacks(): LeaferEngineCallbacks {
  if (!leaferHarness.callbacks)
    throw new Error("Leafer adapter is not mounted");
  return leaferHarness.callbacks;
}
