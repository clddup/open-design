import type {
  AgentRequest,
  ToolCallRequest,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  nativeImage,
  safeStorage,
  shell,
} from "electron";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { AgentHost, FatalAgentRunError } from "./agent/agent-host";
import { AgentAttachmentHost } from "./agent/agent-attachment-host";
import { AgentReferenceHost } from "./agent/agent-reference-host";
import { AgentSvgExportHost } from "./agent/agent-svg-export-host";
import { AgentSvgImportHost } from "./agent/agent-svg-import-host";
import { AgentRasterExportHost } from "./agent/agent-raster-export-host";
import { AgentSessionStoreBinding } from "./agent/agent-session-store-binding";
import { RendererDesignToolHost } from "./agent/renderer-design-tool-host";
import {
  DesignGenerationPerformanceTracker,
  designGenerationPerformanceDiagnostic,
} from "./agent/design-generation-performance";
import { reportAgentDiagnostic } from "./agent/agent-diagnostic-reporter";
import { prepareInitialDesignInspection } from "./agent/agent-initial-design-inspection";
import { AgentIpcRouter } from "./agent/agent-ipc-router";
import { AgentRunCoordinator } from "./agent/agent-run-coordinator";
import { handleDesignPlanTool } from "./agent/design-plan-tool-handler";
import { handleDeliveryScopeTool } from "./agent/delivery-scope-tool-handler";
import { handleDesignFirstSliceTool } from "./agent/design-first-slice-tool-handler";
import {
  handleDesignCheckpointTool,
  handleFirstSliceCheckpoint,
} from "./agent/design-checkpoint-tool-handler";
import {
  MainDesignToolRuntime,
  mainDesignToolAuditDiagnostic,
} from "./agent/main-design-tool-runtime";
import { createApplicationMenuTemplate } from "./application-menu";
import { ApplicationLifecycle } from "./application-lifecycle";
import { ApplicationPreferencesHost } from "./application-preferences-host";
import {
  DesktopApplication,
  type DesktopApplicationStartContext,
} from "./desktop-application";
import {
  DesktopWindowHost,
  resolveApplicationIconPath,
} from "./desktop-window-host";
import { GlobalTaskCoordinator } from "./agent/global-task-coordinator";
import { ProjectHost } from "./project/project-host";
import { ProjectIpcService } from "./project/project-ipc";
import { registerProjectIpc } from "./project/project-ipc-registration";
import { WorkspaceStore } from "./project/workspace-store";
import { registerSvgFileIpc } from "./svg/svg-file-ipc";
import { SvgFileService } from "./svg/svg-file-service";
import { registerRasterFileIpc } from "./raster/raster-file-ipc";
import { RasterFileService } from "./raster/raster-file-service";
import { FontBinaryMainService } from "./font/font-binary-main";
import type { RasterExportFormat } from "@opendesign/import-export-service/raster";
import { ModelProviderHost } from "./model/model-provider-host";
import { registerModelServiceIpc } from "./model/model-service-ipc";
import { ImageGenerationHost } from "./model/image-generation-host";
import { prepareGlobalWorkspaceDatabase } from "./global-data";
import { DiagnosticLog } from "./diagnostics/diagnostic-log";
import { DiagnosticHost } from "./diagnostics/diagnostic-host";
import { MediaInputIpcHost } from "./media-input-ipc";
import { StandaloneDesignFileIpcHost } from "./standalone-design-file-ipc";
import { IpcRegistrationScope } from "./ipc-registration-scope";
import type { RendererDesignCaptureTarget } from "@/shared/design-tool-bridge";
import { registerRendererDesignToolIpc } from "./agent/renderer-design-tool-ipc";
import { channels } from "@/shared/desktop-api";
import { handleDesignSystemTool } from "./agent/design-system-tool-handler.js";
import { handleDesignVectorTool } from "./agent/design-vector-tool-handler.js";
import { handleEditDesignTool } from "./agent/design-edit-tool-handler.js";
import { handleDesignTypographyTool } from "./agent/design-typography-tool-handler.js";
import { DesignImageEditService } from "./agent/design-image-edit-service.js";
import { handleDesignImageTool } from "./agent/design-image-tool-handler.js";
import { createDesignCaptureReviewSession } from "./agent/design-capture-review-tool-handler.js";
import { handleDesignImportExportTool } from "./agent/design-import-export-tool-handler.js";
import {
  designPageToolPreauthorization,
  handleDesignPageTool,
} from "./agent/design-page-tool-handler.js";
import { handleDesignComponentTool } from "./agent/design-component-tool-handler.js";
import { translate } from "@/shared/i18n/messages";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_CHECKPOINT_TOOL_NAME,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  DesignApplyContract,
  DeliveryScopeContract,
  type DesignApplyToolInput,
} from "@/shared/design-agent-tools";

const designGenerationPerformance = new DesignGenerationPerformanceTracker();
app.setName("OpenDesign");
if (process.platform === "win32") app.setAppUserModelId("design.open.app");

const getApplicationIconPath = () =>
  resolveApplicationIconPath({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
const desktopWindowHost = new DesktopWindowHost({
  createWindow: (options) => new BrowserWindow(options),
  environment: process.env,
  getAllWindows: () => BrowserWindow.getAllWindows(),
  getBackgroundColor: () =>
    nativeTheme.shouldUseDarkColors ? "#191a1b" : "#f4f4f2",
  getIconPath: getApplicationIconPath,
  isPackaged: app.isPackaged,
  openExternal: (url) => shell.openExternal(url),
  packagedRendererPath: join(__dirname, "../renderer/index.html"),
  preloadPath: join(__dirname, "../preload/index.cjs"),
  showWindow: (window) => window.show(),
});

const agentHost = new AgentHost();
const rendererDesignToolHost = new RendererDesignToolHost(
  (request) => {
    if (!desktopWindowHost.send(channels.designToolRequest, request)) {
      throw new Error("Renderer is unavailable for design tool execution");
    }
  },
  (request) => {
    desktopWindowHost.send(channels.designToolCancel, request);
  },
);
rendererDesignToolHost.setPerformanceObserver((sample) =>
  designGenerationPerformance.recordRendererTool(sample),
);
let workspaceStore: WorkspaceStore | null = null;
let projectHost: ProjectHost | null = null;
let projectIpc: ProjectIpcService | null = null;
let globalTaskCoordinator: GlobalTaskCoordinator | null = null;
let modelProviderHost: ModelProviderHost | null = null;
let imageGenerationHost: ImageGenerationHost | null = null;
let agentAttachmentHost: AgentAttachmentHost | null = null;
let agentReferenceHost: AgentReferenceHost | null = null;
let agentSvgExportHost: AgentSvgExportHost | null = null;
let agentSvgImportHost: AgentSvgImportHost | null = null;
let agentRasterExportHost: AgentRasterExportHost | null = null;
let svgFileService: SvgFileService | null = null;
let rasterFileService: RasterFileService | null = null;
const diagnosticHost = new DiagnosticHost({
  fallback: (input) => {
    console.error(`[${input.source}:${input.code}] ${input.message}`);
  },
  send: (event) => desktopWindowHost.send(channels.diagnosticEvent, event),
});
const applicationPreferences = new ApplicationPreferencesHost({
  installMenu: installApplicationMenu,
  persistLocale: (locale) => workspaceStore?.setPreference("locale", locale),
  publishLocale: (locale) => {
    desktopWindowHost.send(channels.localeChanged, locale);
  },
  publishTheme: (isDark) => {
    desktopWindowHost.send(channels.themeChanged, isDark);
  },
  setNativeTheme: (theme) => {
    nativeTheme.themeSource = theme;
  },
});
const designImageEditService = new DesignImageEditService({
  getAttachmentHost: requireAgentAttachmentHost,
  getImageGenerationHost: requireImageGenerationHost,
});
const mediaInputIpcHost = new MediaInputIpcHost({
  decodeImageSize: (bytes) => nativeImage.createFromBuffer(bytes).getSize(),
  editImage: designImageEditService.edit,
  getAttachmentHost: requireAgentAttachmentHost,
  getLocale: () => applicationPreferences.locale(),
  getWindow: () => desktopWindowHost.current(),
  openDialog: (window, options) => dialog.showOpenDialog(window, options),
});
const standaloneDesignFileIpcHost = new StandaloneDesignFileIpcHost({
  getLocale: () => applicationPreferences.locale(),
  getWindow: () => desktopWindowHost.current(),
  openDialog: (window, options) => dialog.showOpenDialog(window, options),
  saveDialog: (window, options) => dialog.showSaveDialog(window, options),
});
const agentRunCoordinator = new AgentRunCoordinator({
  agentHost,
  forgetRun: (runId) => {
    rendererDesignToolHost.forgetRun(runId);
    designGenerationPerformance.forgetRun(runId);
  },
  getServices: () => ({
    globalTaskCoordinator,
    modelProviderHost,
    projectHost,
    referenceHost: agentReferenceHost,
  }),
  prepareInitialDesignInspection: prepareInitialInspectionForRun,
  publish: (event) => desktopWindowHost.send(channels.agentEvent, event),
});
const agentIpcRouter = new AgentIpcRouter({
  agentHost,
  getCoordinator: () => globalTaskCoordinator,
  observeEvent: (event, context) => {
    reportAgentDiagnostic(event, diagnosticHost.publish, () => context);
    const performanceSummary =
      designGenerationPerformance.recordAgentEvent(event);
    if (performanceSummary) {
      diagnosticHost.publish(
        designGenerationPerformanceDiagnostic(
          performanceSummary,
          context?.conversationId,
        ),
      );
    }
  },
  publish: (event) => desktopWindowHost.send(channels.agentEvent, event),
  runCoordinator: agentRunCoordinator,
});
const applicationLifecycle = new ApplicationLifecycle({
  exit: (code) => app.exit(code),
  platform: process.platform,
  quit: () => app.quit(),
  reportShutdownError: (error) => {
    console.error(
      `Application shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  },
  resources: {
    abortActiveWork: () => {
      mediaInputIpcHost.abortAll("OpenDesign is shutting down");
      agentRunCoordinator.quiesceAndCancelAll();
    },
    stopAgent: () => agentHost.stop(),
    detachAgentHandlers: () => {
      agentHost.setModelRequestHandler(null);
      agentHost.setDesignToolRequestHandler(null);
      agentRunCoordinator.dispose();
      agentIpcRouter.dispose();
    },
    rejectRendererTools: () =>
      rendererDesignToolHost.rejectAll("OpenDesign is shutting down"),
    closeWorkspace: () => workspaceStore?.close(),
    clearCorrelations: () => agentIpcRouter.clear(),
    flushDiagnostics: () => diagnosticHost.flush(),
    clearServices: () => {
      clearMainServices();
      diagnosticHost.clear();
    },
  },
});
const desktopApplication = new DesktopApplication({
  exit: (code) => app.exit(code),
  reportStartupError: (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Application startup failed: ${message}`);
    diagnosticHost.publish({
      level: "error",
      source: "main",
      presentation: "silent",
      code: "application_startup_failed",
      message,
    });
  },
});

function assertMainRenderer(event: Electron.IpcMainInvokeEvent) {
  desktopWindowHost.assertRenderer(event);
}

function requireAgentAttachmentHost(): AgentAttachmentHost {
  if (!agentAttachmentHost) {
    throw new Error("Agent attachment services are not initialized");
  }
  return agentAttachmentHost;
}

function requireAgentReferenceHost(): AgentReferenceHost {
  if (!agentReferenceHost) {
    throw new Error("Agent reference services are not initialized");
  }
  return agentReferenceHost;
}

async function prepareInitialInspectionForRun(
  request: Extract<AgentRequest, { type: "run.start" }>,
  signal: AbortSignal,
) {
  const coordinator = globalTaskCoordinator;
  if (!coordinator) return undefined;
  try {
    return await prepareInitialDesignInspection(
      request,
      { coordinator, renderer: rendererDesignToolHost },
      signal,
    );
  } catch (error) {
    if (signal.aborted) {
      designGenerationPerformance.forgetRun(request.runId);
      return undefined;
    }
    console.warn(
      `Initial design inspection unavailable; falling back to the public tool: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function requireAgentSvgExportHost(): AgentSvgExportHost {
  if (!agentSvgExportHost) {
    throw new Error("Agent SVG export services are not initialized");
  }
  return agentSvgExportHost;
}

function requireAgentRasterExportHost(): AgentRasterExportHost {
  if (!agentRasterExportHost) {
    throw new Error("Agent raster export services are not initialized");
  }
  return agentRasterExportHost;
}

function requireAgentSvgImportHost(): AgentSvgImportHost {
  if (!agentSvgImportHost) {
    throw new Error("Agent SVG import services are not initialized");
  }
  return agentSvgImportHost;
}

async function selectProjectDirectory(
  purpose: "create" | "open",
): Promise<string | null> {
  const window = desktopWindowHost.current();
  if (!window) return null;
  const result = await dialog.showOpenDialog(window, {
    title:
      purpose === "create"
        ? translate(applicationPreferences.locale(), "main.createProjectTitle")
        : translate(applicationPreferences.locale(), "main.openProjectTitle"),
    buttonLabel:
      purpose === "create"
        ? translate(applicationPreferences.locale(), "main.createHere")
        : translate(applicationPreferences.locale(), "main.openProjectButton"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length !== 1) return null;
  return result.filePaths[0] ?? null;
}

async function selectSvgOpenFile(): Promise<string | null> {
  const window = desktopWindowHost.current();
  if (!window) return null;
  const result = await dialog.showOpenDialog(window, {
    title: translate(applicationPreferences.locale(), "main.openSvgTitle"),
    buttonLabel: translate(
      applicationPreferences.locale(),
      "main.openSvgButton",
    ),
    properties: ["openFile"],
    filters: [
      {
        name: translate(applicationPreferences.locale(), "main.svgFilter"),
        extensions: ["svg"],
      },
    ],
  });
  if (result.canceled || result.filePaths.length !== 1) return null;
  return result.filePaths[0] ?? null;
}

async function selectSvgSaveFile(
  suggestedName: string,
): Promise<string | null> {
  const window = desktopWindowHost.current();
  if (!window) return null;
  const result = await dialog.showSaveDialog(window, {
    title: translate(applicationPreferences.locale(), "main.saveSvgTitle"),
    buttonLabel: translate(
      applicationPreferences.locale(),
      "main.saveSvgButton",
    ),
    defaultPath: suggestedName,
    filters: [
      {
        name: translate(applicationPreferences.locale(), "main.svgFilter"),
        extensions: ["svg"],
      },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

async function selectRasterSaveFile(
  suggestedName: string,
  format: RasterExportFormat,
): Promise<string | null> {
  const window = desktopWindowHost.current();
  if (!window) return null;
  const extensions = format === "jpeg" ? ["jpg", "jpeg"] : [format];
  const result = await dialog.showSaveDialog(window, {
    title: translate(applicationPreferences.locale(), "main.saveRasterTitle"),
    buttonLabel: translate(
      applicationPreferences.locale(),
      "main.saveRasterButton",
    ),
    defaultPath: suggestedName,
    filters: [
      {
        name: translate(applicationPreferences.locale(), "main.rasterFilter", {
          format: format.toUpperCase(),
        }),
        extensions,
      },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

function installApplicationMenu() {
  const template = createApplicationMenuTemplate(
    "OpenDesign",
    process.platform,
    {
      onOpenSettings: () => {
        desktopWindowHost.send(channels.openSettings);
      },
      onImportSvg: () => {
        desktopWindowHost.send(channels.importSvgCommand);
      },
      onExportSvg: () => {
        desktopWindowHost.send(channels.exportSvgCommand);
      },
      settingsLabel: translate(
        applicationPreferences.locale(),
        "settings.menuItem",
      ),
      fileLabel: translate(applicationPreferences.locale(), "main.fileMenu"),
      importSvgLabel: translate(
        applicationPreferences.locale(),
        "main.importSvgMenu",
      ),
      exportSvgLabel: translate(
        applicationPreferences.locale(),
        "main.exportSvgMenu",
      ),
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function requireProjectIpc(): ProjectIpcService {
  if (!projectIpc) throw new Error("Project services are not initialized");
  return projectIpc;
}

function requireModelProviderHost(): ModelProviderHost {
  if (!modelProviderHost) throw new Error("Model provider is not initialized");
  return modelProviderHost;
}

function requireImageGenerationHost(): ImageGenerationHost {
  if (!imageGenerationHost) {
    throw new Error("Global image generation is not initialized");
  }
  return imageGenerationHost;
}

function clearMainServices(): void {
  projectIpc = null;
  globalTaskCoordinator = null;
  projectHost = null;
  modelProviderHost = null;
  imageGenerationHost = null;
  agentAttachmentHost = null;
  agentReferenceHost = null;
  agentSvgExportHost = null;
  agentRasterExportHost = null;
  agentSvgImportHost = null;
  svgFileService = null;
  rasterFileService = null;
  workspaceStore = null;
  standaloneDesignFileIpcHost.clear();
}

function clearIpcServices(): void {
  agentSvgExportHost = null;
  agentRasterExportHost = null;
  agentSvgImportHost = null;
  svgFileService = null;
  rasterFileService = null;
}

function registerIpc(fontBinaryService: FontBinaryMainService): () => void {
  const ipc = new IpcRegistrationScope(ipcMain);
  const handleNativeThemeUpdated = () => {
    applicationPreferences.publishNativeThemeUpdated(
      nativeTheme.shouldUseDarkColors,
    );
  };
  let nativeThemeRegistered = false;
  const dispose = () => {
    const failures: Error[] = [];
    const attempt = (label: string, action: () => void) => {
      try {
        action();
      } catch (error) {
        failures.push(
          new Error(
            `${label}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
        );
      }
    };
    if (nativeThemeRegistered) {
      attempt("native theme listener", () => {
        nativeTheme.off("updated", handleNativeThemeUpdated);
      });
      nativeThemeRegistered = false;
    }
    attempt("Agent IPC router", () => agentIpcRouter.dispose());
    attempt("IPC handlers", () => ipc.dispose());
    attempt("Renderer design tools", () => {
      rendererDesignToolHost.rejectAll("Desktop startup was rolled back");
    });
    clearIpcServices();
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "IPC services rollback was incomplete",
      );
    }
  };
  svgFileService = new SvgFileService({
    selectOpenFile: selectSvgOpenFile,
    selectSaveFile: selectSvgSaveFile,
  });
  rasterFileService = new RasterFileService({
    selectSaveFile: selectRasterSaveFile,
  });
  agentRasterExportHost = new AgentRasterExportHost(
    rendererDesignToolHost,
    rasterFileService,
  );
  agentSvgExportHost = new AgentSvgExportHost(
    rendererDesignToolHost,
    svgFileService,
  );
  agentSvgImportHost = new AgentSvgImportHost(
    rendererDesignToolHost,
    requireAgentReferenceHost(),
  );
  try {
    registerProjectIpc({
      ipc,
      assertRenderer: assertMainRenderer,
      getService: requireProjectIpc,
    });
    registerRendererDesignToolIpc({
      ipc,
      assertRenderer: assertMainRenderer,
      host: rendererDesignToolHost,
    });
    registerModelServiceIpc({
      ipc,
      assertRenderer: assertMainRenderer,
      getImageGenerationHost: requireImageGenerationHost,
      getModelProviderHost: requireModelProviderHost,
      publishModelProviderCatalog: (catalog) => {
        desktopWindowHost.send(channels.modelProviderCatalogChanged, catalog);
      },
    });
    diagnosticHost.registerIpc({ ipc, assertRenderer: assertMainRenderer });
    applicationPreferences.registerIpc({
      ipc,
      assertRenderer: assertMainRenderer,
    });
    mediaInputIpcHost.registerIpc({ ipc, assertRenderer: assertMainRenderer });
    standaloneDesignFileIpcHost.registerIpc({
      ipc,
      assertRenderer: assertMainRenderer,
    });
    desktopWindowHost.registerIpc(ipc);
    registerSvgFileIpc({
      ipc,
      assertRenderer: assertMainRenderer,
      service: svgFileService,
    });
    registerRasterFileIpc({
      ipc,
      assertRenderer: assertMainRenderer,
      service: rasterFileService,
    });
    fontBinaryService.register(ipc, assertMainRenderer, () =>
      desktopWindowHost.current(),
    );
    ipc.handle(channels.platformInfo, () => ({
      platform: process.platform,
      version: app.getVersion(),
    }));
    agentIpcRouter.register({
      ipc,
      assertRenderer: (event, message) =>
        desktopWindowHost.assertRenderer(event, message),
    });
    nativeTheme.on("updated", handleNativeThemeUpdated);
    nativeThemeRegistered = true;
  } catch (error) {
    try {
      dispose();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "IPC registration and rollback failed",
      );
    }
    throw error;
  }
  return dispose;
}

void app.whenReady().then(() => {
  void desktopApplication.start(startDesktopApplication).catch(() => undefined);
});

async function startDesktopApplication(
  startup: DesktopApplicationStartContext,
): Promise<void> {
  if (
    process.platform === "darwin" &&
    process.env.OPENDESIGN_AGENT_SMOKE !== "1"
  ) {
    app.dock?.setIcon(getApplicationIconPath());
  }

  if (process.env.OPENDESIGN_AGENT_SMOKE === "1") {
    try {
      await verifyPackagedAttachmentPipeline();
      console.log("Attachment smoke passed: PDF extraction");
    } catch (error) {
      throw new Error(
        `Attachment smoke failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const smokeRoot = await mkdtemp(join(tmpdir(), "opendesign-agent-smoke-"));
    const sessionStoreBinding = new AgentSessionStoreBinding(
      agentHost,
      join(smokeRoot, "events.jsonl"),
    );
    let finished = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: () => void = () => undefined;
    const disposeSmoke = async () => {
      if (timeout) clearTimeout(timeout);
      timeout = null;
      unsubscribe();
      await agentHost.stop();
      sessionStoreBinding.dispose();
      await rm(smokeRoot, { recursive: true, force: true });
    };
    startup.defer("Packaged Agent smoke", disposeSmoke);
    const finish = (code: number, message: string) => {
      if (finished) return;
      finished = true;
      if (code === 0) console.log(message);
      else console.error(message);
      void disposeSmoke().finally(() => app.exit(code));
    };
    timeout = setTimeout(() => {
      finish(1, "Agent smoke timed out");
    }, 10_000);
    unsubscribe = agentHost.on((event) => {
      if (event.type === "agent.error") {
        finish(1, `Agent smoke failed: ${event.message}`);
      }
      if (event.type === "agent.connected") {
        agentHost.send({
          type: "run.start",
          runId: "run_smoke",
          sessionId: `smoke_${Date.now()}`,
          prompt: "Verify the OpenDesign Agent event stream.",
          documentId: "smoke_document",
          revision: 0,
          scope: { kind: "document", selectedNodeIds: [] },
          mutationTarget: { kind: "document" },
          modelSelection: {
            providerId: "smoke",
            modelId: "smoke",
            reasoningEffort: "off",
          },
          modelContext: {
            contextWindow: 200_000,
            maxOutputTokens: 16_384,
          },
        });
      }
      if (event.type === "run.completed") {
        finish(
          event.stopReason === "complete" ? 0 : 1,
          `Agent smoke ${event.stopReason === "complete" ? "passed" : "failed"}: ${event.runId} ${event.stopReason}`,
        );
      }
    });
    await agentHost.start();
    startup.commit();
    return;
  }

  startup.defer("Main service references", () => clearMainServices());

  const workspaceDatabase = await prepareGlobalWorkspaceDatabase(
    homedir(),
    app.getPath("userData"),
  );
  diagnosticHost.initialize(
    new DiagnosticLog(join(app.getPath("userData"), "diagnostics"), {
      appVersion: app.getVersion(),
      platform: process.platform,
    }),
  );
  startup.defer("diagnostic host", async () => {
    await diagnosticHost.flush();
    diagnosticHost.clear();
  });
  const openedWorkspaceStore = new WorkspaceStore(workspaceDatabase);
  workspaceStore = openedWorkspaceStore;
  startup.defer("workspace store", () => {
    openedWorkspaceStore.close();
    if (workspaceStore === openedWorkspaceStore) workspaceStore = null;
  });
  agentAttachmentHost = new AgentAttachmentHost(
    join(homedir(), ".opendesign", "attachments"),
  );
  const fontBinaryService = new FontBinaryMainService(
    join(homedir(), ".opendesign", "fonts"),
  );
  agentReferenceHost = new AgentReferenceHost(agentAttachmentHost);
  const agentSessionStoreBinding = new AgentSessionStoreBinding(
    agentHost,
    join(homedir(), ".opendesign", "sessions", "events.jsonl"),
  );
  const agentSessionStore = agentSessionStoreBinding.store;
  const persistedLocale = workspaceStore.getPreference("locale");
  applicationPreferences.restoreLocale(persistedLocale);
  const previousMenu = Menu.getApplicationMenu();
  installApplicationMenu();
  startup.defer("application menu", () => {
    Menu.setApplicationMenu(previousMenu);
  });
  const credentialCipher = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value: string) => safeStorage.encryptString(value),
    decrypt: (value: Buffer) => safeStorage.decryptString(value),
  };
  imageGenerationHost = new ImageGenerationHost(
    workspaceStore,
    credentialCipher,
    globalThis.fetch,
  );
  imageGenerationHost.getSettings();
  modelProviderHost = new ModelProviderHost(
    workspaceStore,
    credentialCipher,
    globalThis.fetch,
    {
      resolve: (attachmentId) =>
        requireAgentAttachmentHost().resolveModelAttachment(attachmentId),
    },
  );
  modelProviderHost.setPerformanceObserver((sample) =>
    designGenerationPerformance.recordModelProvider(sample),
  );
  agentHost.setModelRequestHandler((request, signal) =>
    requireModelProviderHost().stream(request, signal),
  );
  startup.defer("Agent handlers", () => {
    agentHost.setModelRequestHandler(null);
    agentHost.setDesignToolRequestHandler(null);
    agentSessionStoreBinding.dispose();
  });
  const mainDesignToolRuntime = new MainDesignToolRuntime({
    dispatch: async (call, context, signal, reportProgress) => {
      if (!globalTaskCoordinator) {
        throw new FatalAgentRunError(
          "run_services_unavailable",
          "Global Task services are not initialized",
        );
      }
      try {
        globalTaskCoordinator.assertDesignToolContext(context);
      } catch (error) {
        throw new FatalAgentRunError(
          "run_context_invalid",
          error instanceof Error
            ? error.message
            : "Design tool Run context is invalid",
        );
      }
      const executionContext =
        globalTaskCoordinator.resolveExecutionContext(context);
      const executeRendererTool = (
        rendererCall: ToolCallRequest,
        options: {
          captureTarget?: RendererDesignCaptureTarget;
          reportProgress?: (message: string, progress: number) => void;
        } = {},
      ) =>
        rendererDesignToolHost.execute(rendererCall, executionContext, signal, {
          ...(options.captureTarget
            ? { captureTarget: options.captureTarget }
            : {}),
          reportProgress: options.reportProgress ?? reportProgress,
        });
      const executeDesignApply = async (
        applyCall: ToolCallRequest,
        input: DesignApplyToolInput,
        stageProgress?: (message: string, progress: number) => void,
      ): Promise<TrustedToolResult> => {
        const parsedInput = DesignApplyContract.parse(input, {
          canonical: true,
        });
        if (!parsedInput.ok) {
          throw new TypeError("Invalid design apply tool input");
        }
        const normalizedInput = parsedInput.value;
        globalTaskCoordinator!.assertVisualReviewBeforeWrite(context);
        const authorization = globalTaskCoordinator!.assertDesignPlanForApply(
          context,
          normalizedInput,
        );
        const resolvedInput = authorization?.input ?? normalizedInput;
        const result = await executeRendererTool(
          {
            ...applyCall,
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              ...resolvedInput,
              ...(authorization?.rebaseGuard
                ? { rebaseGuard: authorization.rebaseGuard }
                : {}),
            },
          },
          stageProgress ? { reportProgress: stageProgress } : {},
        );
        globalTaskCoordinator!.assertDesignApplyResult(
          context,
          authorization,
          result,
        );
        globalTaskCoordinator!.recordDesignApplyCompleted(
          context.runId,
          resolvedInput,
          authorization,
          result.designRevision?.revision,
        );
        return withDesignDelivery(result, context.runId);
      };
      const captureReviewSession = createDesignCaptureReviewSession({
        context,
        signal,
        coordinator: globalTaskCoordinator,
        execute: executeRendererTool,
        getModelProviderHost: requireModelProviderHost,
      });
      const designPageResult = await handleDesignPageTool({
        call,
        context,
        coordinator: globalTaskCoordinator,
        execute: executeRendererTool,
      });
      if (designPageResult) return designPageResult;
      if (call.toolName === DESIGN_DELIVERY_SCOPE_TOOL_NAME) {
        return handleDeliveryScopeTool(globalTaskCoordinator, call, context);
      }
      if (call.toolName === DESIGN_FIRST_SLICE_TOOL_NAME) {
        return await handleFirstSliceCheckpoint(
          {
            firstSlice: (stageProgress) =>
              handleDesignFirstSliceTool(
                globalTaskCoordinator!,
                rendererDesignToolHost,
                call,
                context,
                executionContext,
                signal,
                stageProgress,
              ),
            capture: (stageProgress) =>
              captureReviewSession.capture(
                {
                  ...call,
                  toolCallId: `${call.toolCallId.slice(0, 248)}_capture`,
                  toolName: DESIGN_CAPTURE_TOOL_NAME,
                  input: {},
                },
                stageProgress,
              ),
            getDelivery: () =>
              globalTaskCoordinator!.getDeliveryLedger(context.runId),
          },
          reportProgress,
        );
      }
      if (call.toolName === DESIGN_CHECKPOINT_TOOL_NAME) {
        return await handleDesignCheckpointTool(
          call,
          {
            apply: executeDesignApply,
            assertRefinementReady: () =>
              globalTaskCoordinator!.assertDesignRefinementReady(context),
            capture: (captureCall, stageProgress) =>
              captureReviewSession.capture(captureCall, stageProgress),
            getDelivery: () =>
              globalTaskCoordinator!.getDeliveryLedger(context.runId),
          },
          reportProgress,
        );
      }
      if (call.toolName === DESIGN_PLAN_TOOL_NAME) {
        return await handleDesignPlanTool(
          globalTaskCoordinator,
          rendererDesignToolHost,
          call,
          context,
          executionContext,
          signal,
          reportProgress,
        );
      }
      const captureReviewResult = await captureReviewSession.handle(call);
      if (captureReviewResult) return captureReviewResult;
      const importExportResult = await handleDesignImportExportTool({
        call,
        context,
        executionContext,
        signal,
        coordinator: globalTaskCoordinator,
        getSvgExportHost: requireAgentSvgExportHost,
        getRasterExportHost: requireAgentRasterExportHost,
        getSvgImportHost: requireAgentSvgImportHost,
        withDelivery: (result) => withDesignDelivery(result, context.runId),
      });
      if (importExportResult) return importExportResult;
      const designImageResult = await handleDesignImageTool({
        call,
        context,
        executionContext,
        signal,
        coordinator: globalTaskCoordinator,
        getAttachmentHost: requireAgentAttachmentHost,
        getReferenceHost: requireAgentReferenceHost,
        getImageGenerationHost: requireImageGenerationHost,
        imageEditService: designImageEditService,
        execute: executeRendererTool,
        withDelivery: withDesignDelivery,
      });
      if (designImageResult) return designImageResult;
      const editDesignResult = await handleEditDesignTool({
        call,
        context,
        coordinator: globalTaskCoordinator,
        execute: executeRendererTool,
        withDelivery: withDesignDelivery,
      });
      if (editDesignResult) return editDesignResult;
      const designTypographyResult = await handleDesignTypographyTool({
        call,
        context,
        coordinator: globalTaskCoordinator,
        execute: executeRendererTool,
        withDelivery: withDesignDelivery,
      });
      if (designTypographyResult) return designTypographyResult;
      const designComponentResult = await handleDesignComponentTool({
        call,
        context,
        coordinator: globalTaskCoordinator,
        execute: executeRendererTool,
        withDelivery: withDesignDelivery,
      });
      if (designComponentResult) return designComponentResult;
      const designSystemResult = await handleDesignSystemTool({
        call,
        context,
        coordinator: globalTaskCoordinator,
        execute: executeRendererTool,
        withDelivery: withDesignDelivery,
      });
      if (designSystemResult) return designSystemResult;
      const designVectorResult = await handleDesignVectorTool({
        call,
        context,
        coordinator: globalTaskCoordinator,
        execute: executeRendererTool,
        withDelivery: withDesignDelivery,
      });
      if (designVectorResult) return designVectorResult;
      const result = await executeRendererTool(call);
      if (call.toolName === DESIGN_INSPECT_TOOL_NAME) {
        globalTaskCoordinator.recordDocumentInspection(context, result);
        const unfinishedDelivery =
          globalTaskCoordinator.getRecoverableDelivery(context);
        if (unfinishedDelivery) {
          if (!isRecordValue(result.content)) {
            throw new TypeError(
              "Document inspection must be structured before attaching recovery state",
            );
          }
          return {
            ...result,
            content: { ...result.content, unfinishedDelivery },
          };
        }
      }
      return result;
    },
    isPreauthorized: (call, context) => {
      if (call.toolName === DESIGN_DELIVERY_SCOPE_TOOL_NAME) {
        const parsed = DeliveryScopeContract.parse(call.input);
        return (
          parsed.ok &&
          (globalTaskCoordinator?.hasDeliveryScopeAuthorization(
            context.runId,
            call.toolCallId,
            parsed.value,
          ) ??
            false)
        );
      }
      return (
        designPageToolPreauthorization(call, context, globalTaskCoordinator) ??
        true
      );
    },
    recordAudit: (event) =>
      diagnosticHost.publish(mainDesignToolAuditDiagnostic(event)),
  });
  agentHost.setDesignToolRequestHandler((call, context, signal, progress) =>
    mainDesignToolRuntime.execute(call, context, signal, progress),
  );
  projectHost = new ProjectHost(workspaceStore);
  globalTaskCoordinator = new GlobalTaskCoordinator(
    projectHost,
    workspaceStore,
  );
  projectIpc = new ProjectIpcService(
    projectHost,
    workspaceStore,
    selectProjectDirectory,
    (rootPath) => shell.showItemInFolder(rootPath),
    (conversationId) =>
      agentRunCoordinator.hasActiveConversationRun(conversationId),
  );
  globalTaskCoordinator.reconcileInterruptedTasks();
  try {
    const recovered = await agentSessionStore.reconcileInterruptedRuns();
    if (recovered.recoveredRuns > 0) {
      console.info(
        `Recovered ${recovered.recoveredRuns} interrupted Agent run(s) and ${recovered.recoveredTools} tool call(s)`,
      );
      diagnosticHost.publish({
        level: "info",
        source: "storage",
        presentation: "toast",
        code: "agent_runs_recovered",
        message: `Recovered ${recovered.recoveredRuns} interrupted Agent run(s) and ${recovered.recoveredTools} tool call(s).`,
      });
    }
  } catch (error) {
    console.error(
      `Agent session recovery failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    diagnosticHost.publish({
      level: "error",
      source: "storage",
      presentation: "toast",
      code: "agent_session_recovery_failed",
      message:
        error instanceof Error
          ? error.message
          : "Agent session recovery failed",
    });
  }
  const disposeIpc = registerIpc(fontBinaryService);
  startup.defer("IPC registrations", disposeIpc);
  startup.defer("Agent process", () => agentHost.stop());
  void agentHost.start().catch(() => undefined);
  await desktopWindowHost.createAndLoad();
  startup.defer("desktop window", () => desktopWindowHost.dispose());
  const activate = () => desktopWindowHost.activate();
  app.on("activate", activate);
  startup.defer("application activation", () => {
    app.off("activate", activate);
  });
  desktopWindowHost.publish();
  startup.commit();
}

async function verifyPackagedAttachmentPipeline(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "opendesign-attachment-smoke-"));
  try {
    const source = join(root, "brief.pdf");
    await writeFile(source, smokePdf("OpenDesign attachment smoke"));
    const host = new AgentAttachmentHost(join(root, "attachments"));
    const selected = await host.importFiles([source]);
    const attachment = selected[0];
    if (!attachment) throw new Error("PDF import returned no attachment");
    const resolved = await host.resolve(attachment.attachmentId);
    if (
      resolved.kind !== "document" ||
      !resolved.text.includes("OpenDesign attachment smoke")
    ) {
      throw new Error("PDF text extraction did not return expected content");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function smokePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function withDesignDelivery(
  result: TrustedToolResult,
  runId: string,
): TrustedToolResult {
  const delivery = globalTaskCoordinator?.getDeliveryLedger(runId);
  if (!delivery) return result;
  if (!isRecordValue(result.content)) {
    throw new TypeError(
      "Design workflow result must be structured before attaching delivery progress",
    );
  }
  return {
    ...result,
    content: {
      ...result.content,
      delivery,
      deliveryStage: globalTaskCoordinator?.getDeliveryStageContext(runId),
    },
  };
}

app.on("before-quit", () => {
  applicationLifecycle.handleBeforeQuit();
});

app.on("will-quit", (event) => {
  void applicationLifecycle.handleWillQuit(event);
});

app.on("window-all-closed", () => {
  applicationLifecycle.handleWindowAllClosed();
});
