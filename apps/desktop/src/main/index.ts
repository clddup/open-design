import type {
  AgentRequest,
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import type {
  DesignAsset,
  ImageAssetDerivation,
  Size,
} from "@opendesign/design-contracts";
import { resolveImageUpscaleSize } from "@opendesign/image-service";
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
import { createHash } from "node:crypto";
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
import { requireCanvasCaptureLayoutQuality } from "./agent/canvas-capture-quality";
import {
  requireDesignVisualCriticAttachment,
  runIndependentDesignVisualCritic,
} from "./agent/design-visual-critic";
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
import {
  ERASE_OBJECT_PROMPT,
  EXPAND_IMAGE_PROMPT,
  ISOLATE_OBJECT_PROMPT,
  ImageGenerationHost,
} from "./model/image-generation-host";
import { createImageEditMaskPng } from "./model/image-edit-mask";
import {
  compositeProtectedImageExpansion,
  createImageExpansionRaster,
  type PreparedImageExpansionRaster,
} from "./model/image-expand-raster";
import { prepareGlobalWorkspaceDatabase } from "./global-data";
import { DiagnosticLog } from "./diagnostics/diagnostic-log";
import { DiagnosticHost } from "./diagnostics/diagnostic-host";
import {
  MediaInputIpcHost,
  type DesignImageEditInput,
} from "./media-input-ipc";
import { StandaloneDesignFileIpcHost } from "./standalone-design-file-ipc";
import { IpcRegistrationScope } from "./ipc-registration-scope";
import type { RendererDesignCaptureTarget } from "@/shared/design-tool-bridge";
import { registerRendererDesignToolIpc } from "./agent/renderer-design-tool-ipc";
import { channels } from "@/shared/desktop-api";
import { handleDesignSystemTool } from "./agent/design-system-tool-handler.js";
import { translate } from "@/shared/i18n/messages";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_CHECKPOINT_TOOL_NAME,
  DESIGN_COMPONENT_TOOL_NAME,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  DESIGN_FONT_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_TEXT_RANGE_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  EDIT_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_READ_IMAGE_SOURCE_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  DesignApplyContract,
  DeliveryScopeContract,
  DesignVisualReviewContract,
  EditImageContract,
  GenerateImageContract,
  PlaceImageContract,
  ReadImageContract,
  UpdateImageContract,
  isDesignComponentToolInput,
  isDesignFontToolInput,
  isDesignTextRangeToolInput,
  normalizeDesignPageToolInput,
  isDesignVectorToolInput,
  isPageStructureAccessToolInput,
  isExportSvgToolInput,
  isExportRasterToolInput,
  isImportSvgToolInput,
  isPreparedImageEditSource,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  READ_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
  type DesignArrangeToolInput,
  type DesignApplyToolInput,
  type DesignHierarchyToolInput,
  type DesignVisualReviewToolInput,
  type DesignVectorToolInput,
} from "@/shared/design-agent-tools";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import {
  componentToolIsMaterialWrite,
  materialTargetRefsForComponentTool,
} from "./agent/component-tool-policy";

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
const mediaInputIpcHost = new MediaInputIpcHost({
  decodeImageSize: (bytes) => nativeImage.createFromBuffer(bytes).getSize(),
  editImage: editDesignImageAsset,
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
      const recordVisualReview = (
        review: DesignVisualReviewToolInput,
      ): TrustedToolResult => {
        globalTaskCoordinator!.registerVisualReview(context, review);
        return {
          content: {
            ok: true,
            status: "accepted",
            refinements: review.refinements,
            delivery: globalTaskCoordinator!.getDeliveryLedger(context.runId),
          },
        };
      };
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
          authorization
            ? {
                ...applyCall,
                toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
                input: {
                  ...resolvedInput,
                  ...(authorization.rebaseGuard
                    ? { rebaseGuard: authorization.rebaseGuard }
                    : {}),
                },
              }
            : { ...applyCall, input: normalizedInput },
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
      const executeCanvasCapture = async (
        captureCall: ToolCallRequest,
        stageProgress?: (message: string, progress: number) => void,
      ): Promise<TrustedToolResult> => {
        const captureTarget =
          globalTaskCoordinator!.resolveCanvasCaptureTarget(context);
        const result = await executeRendererTool(captureCall, {
          captureTarget,
          ...(stageProgress ? { reportProgress: stageProgress } : {}),
        });
        if (!isRecordValue(result.content)) {
          throw new TypeError(
            "Canvas capture returned invalid structured content",
          );
        }
        const observedRevision = result.observedRevision;
        if (
          !Number.isSafeInteger(observedRevision) ||
          observedRevision == null
        ) {
          throw new Error(
            "design_workflow.capture_revision_invalid: Canvas capture did not return a valid document revision",
          );
        }
        const layoutQuality = requireCanvasCaptureLayoutQuality(
          result,
          context.documentId,
          captureTarget,
        );
        const inspection = await executeRendererTool({
          toolCallId: `${captureCall.toolCallId}_delivery_inspection`.slice(
            0,
            256,
          ),
          toolName: DESIGN_INSPECT_TOOL_NAME,
          input: {},
        });
        globalTaskCoordinator!.recordDocumentInspection(context, inspection);
        if (inspection.observedRevision !== observedRevision) {
          throw new Error(
            "design_workflow.capture_revision_invalid: The document changed between the rendered capture and its authoritative verification; capture the current target again",
          );
        }
        let visualCritic:
          | Awaited<ReturnType<typeof runIndependentDesignVisualCritic>>
          | undefined;
        if (layoutQuality === undefined || layoutQuality.errorCount === 0) {
          const attachment = requireDesignVisualCriticAttachment(
            result.content,
          );
          const criticContext =
            globalTaskCoordinator!.resolveVisualCriticContext(
              context,
              observedRevision,
              attachment,
            );
          if (criticContext) {
            stageProgress?.("Running independent visual critic", 0.94);
            visualCritic = await runIndependentDesignVisualCritic(
              requireModelProviderHost(),
              criticContext,
              signal,
            );
          }
        }
        const reviewWorkflow = globalTaskCoordinator!.recordCanvasCapture(
          context,
          observedRevision,
          layoutQuality,
          visualCritic,
        );
        return {
          ...result,
          content: {
            ...result.content,
            captureTarget,
            reviewWorkflow,
            delivery: globalTaskCoordinator!.getDeliveryLedger(context.runId),
          },
        };
      };
      if (call.toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME) {
        if (!isPageStructureAccessToolInput(call.input)) {
          throw new TypeError("Invalid Page structure access input");
        }
        if (!globalTaskCoordinator.hasPageStructureAccess(context.runId)) {
          throw new Error(
            "Page structure access was not approved for this Run",
          );
        }
        globalTaskCoordinator.assertDeliveryScopeReviewed(context);
        return {
          content: {
            ok: true,
            capability: "page-structure",
            scope: "current-design-file",
            expires: "run-end",
            actions: call.input.actions,
          },
        };
      }
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
              executeCanvasCapture(
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
            capture: executeCanvasCapture,
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
      if (call.toolName === DESIGN_REVIEW_TOOL_NAME) {
        const parsed = DesignVisualReviewContract.parse(call.input, {
          skillRefs:
            globalTaskCoordinator.resolveVisualReviewSkillRefs(context),
        });
        if (!parsed.ok) {
          throw new TypeError(
            formatValidationFailure("Visual Review", parsed.issues),
          );
        }
        return recordVisualReview(parsed.value);
      }
      if (call.toolName === EXPORT_SVG_TOOL_NAME) {
        if (!isExportSvgToolInput(call.input)) {
          throw new TypeError("Invalid SVG export tool input");
        }
        globalTaskCoordinator.assertDocumentInspected(context);
        return await requireAgentSvgExportHost().execute(
          call,
          executionContext,
          signal,
        );
      }
      if (call.toolName === EXPORT_RASTER_TOOL_NAME) {
        if (!isExportRasterToolInput(call.input)) {
          throw new TypeError("Invalid raster export tool input");
        }
        globalTaskCoordinator.assertDocumentInspected(context);
        return await requireAgentRasterExportHost().execute(
          call,
          executionContext,
          signal,
        );
      }
      if (call.toolName === IMPORT_SVG_TOOL_NAME) {
        if (!isImportSvgToolInput(call.input)) {
          throw new TypeError("Invalid SVG import tool input");
        }
        globalTaskCoordinator.assertDocumentInspected(context);
        globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
        const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(
          context,
          [],
          call.input.parentId,
        );
        const result = await requireAgentSvgImportHost().execute(
          call,
          executionContext,
          signal,
        );
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          targetIds,
          result.designRevision?.revision,
          importedNodeIdsFromResult(result),
        );
        return withDesignDelivery(result, context.runId);
      }
      if (call.toolName === READ_IMAGE_TOOL_NAME) {
        const parsed = ReadImageContract.parse(call.input);
        if (!parsed.ok) {
          throw new TypeError(
            formatValidationFailure("opendesign_read_image", parsed.issues),
          );
        }
        return await requireAgentReferenceHost().readImage(
          parsed.value,
          context,
          signal,
        );
      }
      if (call.toolName === GENERATE_IMAGE_TOOL_NAME) {
        const parsed = GenerateImageContract.parse(call.input);
        if (!parsed.ok) {
          throw new TypeError(
            formatValidationFailure("opendesign_generate_image", parsed.issues),
          );
        }
        globalTaskCoordinator.assertDesignPlanForRaster(
          context,
          parsed.value.role,
        );
        const generated = await requireImageGenerationHost().generateImage(
          parsed.value,
          signal,
        );
        const attachment = await requireAgentAttachmentHost().importImageBytes(
          `generated-image.${generated.outputFormat}`,
          generated.bytes,
        );
        const authorized = requireAgentReferenceHost().registerGeneratedImage(
          {
            attachmentId: attachment.attachmentId,
            name: attachment.name,
            mimeType: attachment.mimeType,
            byteSize: attachment.byteSize,
          },
          context,
        );
        globalTaskCoordinator.recordGeneratedRaster(
          context,
          authorized.attachmentId,
          parsed.value.role,
        );
        const intrinsic = nativeImage
          .createFromBuffer(Buffer.from(generated.bytes))
          .getSize();
        if (intrinsic.width <= 0 || intrinsic.height <= 0) {
          throw new TypeError("Generated image has invalid dimensions");
        }
        const digest = authorized.attachmentId.slice("image_".length);
        const assetId = `asset_${digest}`;
        const staged = await executeRendererTool({
          ...call,
          toolCallId: `${call.toolCallId.slice(0, 238)}_stage_asset`,
          toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
          input: {
            label: "Add generated image to Design File assets",
            executionMode: "atomic",
            commands: [
              {
                commandId: `${call.toolCallId.slice(0, 240)}_asset`,
                type: "put_asset",
                asset: {
                  id: assetId,
                  kind: "image",
                  name: authorized.name,
                  mimeType: authorized.mimeType,
                  source: {
                    type: "data",
                    value: Buffer.from(generated.bytes).toString("base64"),
                  },
                  size: {
                    width: intrinsic.width,
                    height: intrinsic.height,
                  },
                  extensions: {
                    attachmentId: authorized.attachmentId,
                    designRole: parsed.value.role,
                    generatedBy: "opendesign-agent",
                    staged: true,
                  },
                },
              },
            ],
          },
        });
        return {
          content: {
            ok: true,
            sourceKind: "generated",
            apiFormat: generated.apiFormat,
            modelId: generated.modelId,
            ...(generated.providerRequestId
              ? { providerRequestId: generated.providerRequestId }
              : {}),
            size: generated.size,
            quality: generated.quality,
            role: parsed.value.role,
            outputFormat: generated.outputFormat,
            attachment: authorized,
            attachments: [authorized],
            asset: {
              assetId,
              name: authorized.name,
              mimeType: authorized.mimeType,
              size: { width: intrinsic.width, height: intrinsic.height },
              role: parsed.value.role,
              scope: "design-file",
            },
          },
          ...(staged.designRevision
            ? { designRevision: staged.designRevision }
            : {}),
        };
      }
      if (call.toolName === PLACE_IMAGE_TOOL_NAME) {
        const parsed = PlaceImageContract.parse(call.input);
        if (!parsed.ok) {
          throw new TypeError(
            formatValidationFailure("Place Image", parsed.issues),
          );
        }
        const input = parsed.value;
        const attachmentId =
          "attachmentId" in input && input.attachmentId !== undefined
            ? requireAgentReferenceHost().hasAuthorizedImage(
                input.attachmentId,
                context,
              )
              ? input.attachmentId
              : globalTaskCoordinator.resolveGeneratedRasterAttachmentId(
                  context,
                  input.attachmentId,
                  input.role,
                )
            : undefined;
        globalTaskCoordinator.assertDesignPlanForImagePlacement(
          context,
          input.role,
          input.parentId,
          attachmentId,
          input.nodeId,
        );
        const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(
          context,
          [],
          input.parentId,
        );
        const image = attachmentId
          ? await requireAgentReferenceHost().materializeImage(
              attachmentId,
              context,
            )
          : undefined;
        const intrinsic = image
          ? nativeImage
              .createFromBuffer(Buffer.from(image.data, "base64"))
              .getSize()
          : undefined;
        const persistentAssetInput =
          "assetId" in input && input.assetId !== undefined ? input : undefined;
        const intrinsicWidth = Math.max(
          1,
          intrinsic?.width ?? persistentAssetInput?.width ?? 1,
        );
        const intrinsicHeight = Math.max(
          1,
          intrinsic?.height ?? persistentAssetInput?.height ?? 1,
        );
        const width =
          input.width ??
          (input.height
            ? (input.height * intrinsicWidth) / intrinsicHeight
            : intrinsicWidth);
        const height =
          input.height ??
          (input.width
            ? (input.width * intrinsicHeight) / intrinsicWidth
            : intrinsicHeight);
        const assetId = persistentAssetInput
          ? persistentAssetInput.assetId
          : attachmentId
            ? `asset_${attachmentId.slice("image_".length)}`
            : undefined;
        if (!assetId) throw new Error("Image placement source is missing");
        const assetCommand = image
          ? [
              {
                commandId: `${call.toolCallId}_asset`,
                type: "put_asset" as const,
                asset: {
                  id: assetId,
                  kind: "image" as const,
                  name: image.attachment.name,
                  mimeType: image.mimeType,
                  source: { type: "data" as const, value: image.data },
                  size: {
                    width: intrinsicWidth,
                    height: intrinsicHeight,
                  },
                  extensions: {
                    attachmentId: image.attachment.attachmentId,
                    designRole: input.role,
                  },
                },
              },
            ]
          : [];
        const result = await executeRendererTool({
          ...call,
          toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
          input: {
            label: `Place ${input.name}`,
            commands: [
              ...assetCommand,
              {
                commandId: `${call.toolCallId}_node`,
                type: "insert_element",
                pageId: input.pageId,
                parentId: input.parentId,
                index: input.index,
                node: {
                  id: input.nodeId,
                  kind: "image",
                  name: input.name,
                  parentId: input.parentId,
                  childIds: [],
                  visible: true,
                  locked: false,
                  transform: [1, 0, 0, 1, input.x, input.y],
                  size: { width, height },
                  exportSettings: [],
                  opacity: 1,
                  properties: {
                    assetId,
                    placement: input.placement ?? {
                      mode: "fill",
                      focalPoint: { x: 0.5, y: 0.5 },
                    },
                    altText: input.name,
                    cornerRadius: 0,
                  },
                  extensions: { designRole: input.role },
                },
              },
            ],
          },
        });
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          targetIds,
          result.designRevision?.revision,
          [input.nodeId],
        );
        return withDesignDelivery(result, context.runId);
      }
      if (call.toolName === UPDATE_IMAGE_TOOL_NAME) {
        const parsed = UpdateImageContract.parse(call.input);
        if (!parsed.ok) {
          throw new TypeError(
            formatValidationFailure("Update Image", parsed.issues),
          );
        }
        const input = parsed.value;
        if (
          executionContext.mutationTarget.kind === "page" &&
          executionContext.mutationTarget.pageId !== input.pageId
        ) {
          throw new Error(
            "Image update targets a Page outside the active mutation target",
          );
        }
        globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
        const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(
          context,
          [input.nodeId],
        );
        if (input.action === "replace-source") {
          const image = await requireAgentReferenceHost().materializeImage(
            input.attachmentId,
            context,
          );
          const intrinsic = nativeImage
            .createFromBuffer(Buffer.from(image.data, "base64"))
            .getSize();
          if (intrinsic.width <= 0 || intrinsic.height <= 0) {
            throw new TypeError("Replacement image has invalid dimensions");
          }
          const digest = image.attachment.attachmentId.slice("image_".length);
          const assetId = `asset_${digest}`;
          const result = await executeRendererTool({
            ...call,
            toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
            input: {
              action: "replace-source",
              label: input.label,
              pageId: input.pageId,
              nodeId: input.nodeId,
              asset: {
                id: assetId,
                kind: "image",
                name: image.attachment.name,
                mimeType: image.mimeType,
                source: { type: "data", value: image.data },
                size: { width: intrinsic.width, height: intrinsic.height },
                extensions: {
                  attachmentId: image.attachment.attachmentId,
                  importedBy: "agent-image-update",
                },
              },
              ...(input.placement === undefined
                ? {}
                : { placement: input.placement }),
            },
          });
          globalTaskCoordinator.recordMaterialDesignWriteCompleted(
            context.runId,
            targetIds,
            result.designRevision?.revision,
          );
          return withDesignDelivery(result, context.runId);
        }
        const result = await executeRendererTool({
          ...call,
          toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
          input,
        });
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          targetIds,
          result.designRevision?.revision,
        );
        return withDesignDelivery(result, context.runId);
      }
      if (call.toolName === EDIT_IMAGE_TOOL_NAME) {
        const parsed = EditImageContract.parse(call.input);
        if (!parsed.ok) {
          throw new TypeError(
            formatValidationFailure("Edit Image", parsed.issues),
          );
        }
        const input = parsed.value;
        if (
          executionContext.mutationTarget.kind === "page" &&
          executionContext.mutationTarget.pageId !== input.pageId
        ) {
          throw new Error(
            "Image edit targets a Page outside the active mutation target",
          );
        }
        globalTaskCoordinator.assertDocumentInspected(context);
        globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
        const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(
          context,
          [input.nodeId],
        );
        const prepared = await executeRendererTool({
          ...call,
          toolCallId: `${call.toolCallId}_read_source`.slice(0, 256),
          toolName: INTERNAL_READ_IMAGE_SOURCE_TOOL_NAME,
          input: {
            pageId: input.pageId,
            nodeId: input.nodeId,
            expectedAssetId: input.expectedAssetId,
          },
        });
        if (!isPreparedImageEditSource(prepared.content)) {
          throw new TypeError(
            "Image edit source preparation returned invalid data",
          );
        }
        const source = prepared.content.asset;
        const reference =
          input.action === "prompt-edit" && input.referenceAttachmentId
            ? await materializeAgentImageAsset(
                input.referenceAttachmentId,
                context,
                "agent-image-edit-reference",
              )
            : undefined;
        const derived = await editDesignImageAsset(
          input.action === "remove-background" || input.action === "upscale"
            ? {
                action: input.action,
                source,
                importedBy: "agent-image-edit",
              }
            : input.action === "prompt-edit" ||
                input.action === "replace-background"
              ? {
                  action: input.action,
                  source,
                  prompt: input.prompt,
                  ...(reference === undefined
                    ? {}
                    : { references: [reference] }),
                  importedBy: "agent-image-edit",
                }
              : input.action === "relight"
                ? {
                    action: input.action,
                    source,
                    lightingPreset: input.lightingPreset,
                    importedBy: "agent-image-edit",
                  }
                : input.action === "expand"
                  ? {
                      action: input.action,
                      source,
                      expansion: input.expansion,
                      placement: prepared.content.placement,
                      targetSize: prepared.content.targetSize,
                      importedBy: "agent-image-edit",
                    }
                  : {
                      action: input.action,
                      source,
                      selection: input.selection,
                      importedBy: "agent-image-edit",
                    },
          signal,
        );
        const result = await executeRendererTool({
          ...call,
          toolCallId: `${call.toolCallId}_commit_edit`.slice(0, 256),
          toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
          input: {
            action:
              input.action === "isolate-object"
                ? "derive-layer"
                : input.action === "expand"
                  ? "expand-source"
                  : input.action === "upscale"
                    ? "upscale-source"
                    : "derive-source",
            label: input.label,
            pageId: input.pageId,
            nodeId: input.nodeId,
            expectedAssetId: input.expectedAssetId,
            ...(input.action === "expand"
              ? {
                  expectedPlacement: prepared.content.placement,
                  expectedTargetSize: prepared.content.targetSize,
                  expansion: input.expansion,
                }
              : {}),
            ...(input.action === "upscale"
              ? (() => {
                  if (!source.size || !derived.asset.size) {
                    throw new TypeError(
                      "Image upscale requires exact source and target dimensions",
                    );
                  }
                  return {
                    expectedSourceSize: source.size,
                    targetSize: derived.asset.size,
                  };
                })()
              : {}),
            asset: derived.asset,
            derivation: derived.derivation,
            ...(input.action === "isolate-object"
              ? {
                  resultNodeId: input.resultNodeId,
                  resultNodeName: "Isolated object",
                }
              : {}),
            ...(derived.supportingAssets === undefined
              ? {}
              : { supportingAssets: derived.supportingAssets }),
          },
        });
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          targetIds,
          result.designRevision?.revision,
          input.action === "isolate-object" ? [input.resultNodeId] : undefined,
        );
        return withDesignDelivery(result, context.runId);
      }
      if (call.toolName === DESIGN_APPLY_TOOL_NAME) {
        const parsedInput = DesignApplyContract.parse(call.input);
        if (!parsedInput.ok) {
          throw new TypeError("Invalid design apply tool input");
        }
        return await executeDesignApply(call, parsedInput.value);
      }
      if (call.toolName === DESIGN_FONT_TOOL_NAME) {
        if (!isDesignFontToolInput(call.input)) {
          throw new TypeError("Invalid font tool input");
        }
        globalTaskCoordinator.assertDocumentInspected(context);
        globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
        const targetIds =
          globalTaskCoordinator.resolveMaterialTargetIdsIfPlanned(
            context,
            call.input.nodeIds,
          );
        const result = await executeRendererTool(call);
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          targetIds,
          result.designRevision?.revision,
        );
        return withDesignDelivery(result, context.runId);
      }
      if (call.toolName === DESIGN_TEXT_RANGE_TOOL_NAME) {
        if (!isDesignTextRangeToolInput(call.input)) {
          throw new TypeError("Invalid text range tool input");
        }
        globalTaskCoordinator.assertDocumentInspected(context);
        globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
        const targetIds =
          globalTaskCoordinator.resolveMaterialTargetIdsIfPlanned(context, [
            call.input.nodeId,
          ]);
        const result = await executeRendererTool(call);
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          targetIds,
          result.designRevision?.revision,
        );
        return withDesignDelivery(result, context.runId);
      }
      if (call.toolName === DESIGN_PAGE_TOOL_NAME) {
        const normalizedPageInput = normalizeDesignPageToolInput(call.input);
        if (!normalizedPageInput) {
          throw new TypeError("Invalid Page tool input");
        }
        globalTaskCoordinator.assertPageToolAccess(
          context,
          normalizedPageInput,
        );
        globalTaskCoordinator.assertPageLifecycleInspected(context);
        const result = await executeRendererTool({
          ...call,
          input: normalizedPageInput,
        });
        if (result.designRevision || normalizedPageInput.action === "clear") {
          globalTaskCoordinator.recordPageToolCompleted(
            context.runId,
            normalizedPageInput.action,
          );
        }
        if (normalizedPageInput.action === "clear") {
          globalTaskCoordinator.supersedeDesignDeliveryForClearedPage(
            context,
            normalizedPageInput.pageId,
          );
          if (!isRecordValue(result.content)) {
            throw new TypeError("Page clear result must be structured");
          }
          return {
            ...result,
            content: {
              ...result.content,
              deliveryDisposition: "superseded",
            },
          };
        }
        return result;
      }
      if (call.toolName === DESIGN_COMPONENT_TOOL_NAME) {
        if (!isDesignComponentToolInput(call.input)) {
          throw new TypeError("Invalid component tool input");
        }
        globalTaskCoordinator.assertComponentToolAccess(context, call.input);
        globalTaskCoordinator.assertDocumentInspected(context);
        const materialWrite = componentToolIsMaterialWrite(call.input);
        if (materialWrite) {
          globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
        }
        const result = await executeRendererTool(call);
        if (!materialWrite) return result;
        const targetRefs = materialTargetRefsForComponentTool(call.input);
        const targetIds =
          globalTaskCoordinator.resolveMaterialTargetIdsIfPlanned(
            context,
            targetRefs.nodeIds,
            targetRefs.parentId,
          );
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          targetIds,
          result.designRevision?.revision,
          targetRefs.createdNodeIds,
        );
        return withDesignDelivery(result, context.runId);
      }
      const designSystemResult = await handleDesignSystemTool({
        call,
        context,
        coordinator: globalTaskCoordinator,
        execute: executeRendererTool,
        withDelivery: withDesignDelivery,
      });
      if (designSystemResult) return designSystemResult;
      if (
        call.toolName === DESIGN_HIERARCHY_TOOL_NAME ||
        call.toolName === DESIGN_ARRANGE_TOOL_NAME ||
        call.toolName === DESIGN_VECTOR_TOOL_NAME
      ) {
        if (
          call.toolName === DESIGN_VECTOR_TOOL_NAME &&
          !isDesignVectorToolInput(call.input)
        ) {
          throw new TypeError("Invalid vector edit tool input");
        }
        globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
        const targetRefs = materialTargetRefsForStructuredTool(
          call.input as
            | DesignHierarchyToolInput
            | DesignArrangeToolInput
            | DesignVectorToolInput,
        );
        const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(
          context,
          targetRefs.nodeIds,
          targetRefs.parentId,
        );
        const result = await executeRendererTool(call);
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          targetIds,
          result.designRevision?.revision,
          createdNodeIdsForStructuredTool(
            call.input as
              | DesignHierarchyToolInput
              | DesignArrangeToolInput
              | DesignVectorToolInput,
          ),
        );
        return withDesignDelivery(result, context.runId);
      }
      if (call.toolName === DESIGN_CAPTURE_TOOL_NAME) {
        return await executeCanvasCapture(call);
      }
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
      if (
        call.toolName !== PAGE_STRUCTURE_ACCESS_TOOL_NAME ||
        !isPageStructureAccessToolInput(call.input)
      ) {
        return true;
      }
      return (
        globalTaskCoordinator?.hasPageStructureAuthorization(
          context.runId,
          call.toolCallId,
          call.input.actions,
        ) ?? false
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

function materialTargetRefsForStructuredTool(
  input:
    DesignHierarchyToolInput | DesignArrangeToolInput | DesignVectorToolInput,
): { nodeIds: string[]; parentId?: string | null } {
  if ("nodeId" in input) return { nodeIds: [input.nodeId] };
  if ("frameId" in input) return { nodeIds: [input.frameId] };
  if ("nodeIds" in input) {
    return {
      nodeIds: [...input.nodeIds],
      ...(input.action === "reparent" ? { parentId: input.parentId } : {}),
    };
  }
  if ("targets" in input) {
    return { nodeIds: input.targets.map((target) => target.nodeId) };
  }
  if ("maskNodeId" in input) return { nodeIds: [input.maskNodeId] };
  if ("groupId" in input) return { nodeIds: [input.groupId] };
  return { nodeIds: [input.booleanId] };
}

function createdNodeIdsForStructuredTool(
  input:
    DesignHierarchyToolInput | DesignArrangeToolInput | DesignVectorToolInput,
): string[] {
  if (input.action === "group") return [input.groupId];
  if (input.action === "create-mask") return [input.groupId];
  if (input.action === "create-boolean") return [input.booleanId];
  return [];
}

function importedNodeIdsFromResult(result: TrustedToolResult): string[] {
  if (!isRecordValue(result.content)) return [];
  const importedNodeIds = result.content.importedNodeIds;
  return Array.isArray(importedNodeIds)
    ? importedNodeIds.filter(
        (nodeId): nodeId is string =>
          typeof nodeId === "string" && nodeId.length > 0,
      )
    : [];
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
    content: { ...result.content, delivery },
  };
}

async function editDesignImageAsset(
  input: DesignImageEditInput,
  signal: AbortSignal,
): Promise<{
  asset: DesignAsset;
  derivation: ImageAssetDerivation;
  supportingAssets?: DesignAsset[];
}> {
  const source = toImageEditSource(input.source);
  const references =
    input.action === "prompt-edit" ? (input.references ?? []) : [];
  if (
    references.length > 1 ||
    references.some((reference) => reference.id === input.source.id)
  ) {
    throw new TypeError(
      "Image editing supports at most one distinct reference image",
    );
  }
  let pendingMask:
    | {
        bytes: Uint8Array;
        name: string;
        size: { width: number; height: number };
      }
    | undefined;
  let pendingExpansion: PreparedImageExpansionRaster | undefined;
  let pendingUpscale:
    | { sourceSize: Size; targetSize: Size; preserveTransparency: boolean }
    | undefined;
  const edited = await (async () => {
    if (input.action === "remove-background") {
      return requireImageGenerationHost().removeBackground(source, signal);
    }
    if (input.action === "prompt-edit") {
      return requireImageGenerationHost().editWithPrompt(
        {
          source,
          prompt: input.prompt,
          references: references.map(toImageEditSource),
        },
        signal,
      );
    }
    if (input.action === "replace-background") {
      return requireImageGenerationHost().replaceBackground(
        { source, prompt: input.prompt },
        signal,
      );
    }
    if (input.action === "relight") {
      return requireImageGenerationHost().changeLighting(
        { source, lightingPreset: input.lightingPreset },
        signal,
      );
    }
    const decodedSource = nativeImage.createFromBuffer(
      Buffer.from(source.bytes),
    );
    const intrinsic = decodedSource.getSize();
    if (intrinsic.width <= 0 || intrinsic.height <= 0) {
      throw new TypeError("Image editing source could not be decoded");
    }
    if (input.action === "upscale") {
      if (
        !input.source.size ||
        input.source.size.width !== intrinsic.width ||
        input.source.size.height !== intrinsic.height
      ) {
        throw new TypeError(
          "Image upscale source dimensions do not match the embedded asset",
        );
      }
      const targetSize = resolveImageUpscaleSize(intrinsic);
      const preserveTransparency = nativeImageHasTransparentPixels(
        decodedSource.toBitmap(),
      );
      pendingUpscale = {
        sourceSize: intrinsic,
        targetSize,
        preserveTransparency,
      };
      return requireImageGenerationHost().boostResolution(
        {
          source: {
            bytes: decodedSource.toPNG(),
            mimeType: "image/png",
            name: `${input.source.name.replace(/\.[^.]+$/, "")} — Upscale source.png`,
          },
          size: `${targetSize.width}x${targetSize.height}`,
          preserveTransparency,
        },
        signal,
      );
    }
    if (input.action === "expand") {
      pendingExpansion = createImageExpansionRaster({
        expansion: input.expansion,
        placement: input.placement,
        source: {
          bgra: decodedSource.toBitmap(),
          size: intrinsic,
        },
        targetSize: input.targetSize,
      });
      const providerSize = pendingExpansion.geometry.outputSize;
      const preparedSourceBytes = nativeImage
        .createFromBitmap(Buffer.from(pendingExpansion.sourceCanvas.bgra), {
          width: providerSize.width,
          height: providerSize.height,
        })
        .toPNG();
      const maskName = `${input.source.name.replace(/\.[^.]+$/, "")} — Expansion mask.png`;
      pendingMask = {
        bytes: pendingExpansion.maskPng,
        name: maskName,
        size: providerSize,
      };
      return requireImageGenerationHost().expandImage(
        {
          source: {
            bytes: preparedSourceBytes,
            mimeType: "image/png",
            name: `${input.source.name.replace(/\.[^.]+$/, "")} — Expansion source.png`,
          },
          mask: {
            bytes: pendingExpansion.maskPng,
            mimeType: "image/png",
            name: maskName,
          },
          size: `${providerSize.width}x${providerSize.height}`,
        },
        signal,
      );
    }
    const maskBytes = createImageEditMaskPng({
      width: intrinsic.width,
      height: intrinsic.height,
      points: input.selection.points,
    });
    const normalizedSourceBytes = decodedSource.toPNG();
    const maskName = `${input.source.name.replace(/\.[^.]+$/, "")} — Area mask.png`;
    pendingMask = {
      bytes: maskBytes,
      name: maskName,
      size: intrinsic,
    };
    const maskedInput = {
      source: {
        bytes: normalizedSourceBytes,
        mimeType: "image/png" as const,
        name: `${input.source.name.replace(/\.[^.]+$/, "")}.png`,
      },
      mask: {
        bytes: maskBytes,
        mimeType: "image/png" as const,
        name: maskName,
      },
    };
    return input.action === "erase-object"
      ? requireImageGenerationHost().eraseObject(maskedInput, signal)
      : requireImageGenerationHost().isolateObject(maskedInput, signal);
  })();
  let bytes: Buffer = Buffer.from(edited.bytes);
  let editedNativeImage = nativeImage.createFromBuffer(bytes);
  let intrinsic = editedNativeImage.getSize();
  if (pendingExpansion) {
    const composite = compositeProtectedImageExpansion({
      generated: {
        bgra: editedNativeImage.toBitmap(),
        size: intrinsic,
      },
      prepared: pendingExpansion,
    });
    bytes = nativeImage
      .createFromBitmap(Buffer.from(composite.bgra), {
        width: composite.size.width,
        height: composite.size.height,
      })
      .toPNG();
    editedNativeImage = nativeImage.createFromBuffer(bytes);
    intrinsic = editedNativeImage.getSize();
  }
  if (
    intrinsic.width <= 0 ||
    intrinsic.height <= 0 ||
    ((input.action === "remove-background" ||
      input.action === "isolate-object") &&
      !nativeImageHasTransparentPixels(editedNativeImage.toBitmap()))
  ) {
    throw new TypeError(
      input.action === "remove-background"
        ? "Background removal did not return a valid image with transparent pixels"
        : input.action === "isolate-object"
          ? "Object isolation did not return a valid image with transparent pixels"
          : "Image editing did not return a valid image",
    );
  }
  const supportingMaskAsset: DesignAsset | undefined = pendingMask
    ? {
        id: `asset_${createHash("sha256").update(pendingMask.bytes).digest("hex")}`,
        kind: "image",
        name: pendingMask.name,
        mimeType: "image/png",
        source: {
          type: "data",
          value: Buffer.from(pendingMask.bytes).toString("base64"),
        },
        size: pendingMask.size,
        extensions: {
          importedBy: input.importedBy,
          role: "image-edit-mask",
        },
      }
    : undefined;
  const attachment = await requireAgentAttachmentHost().importImageBytes(
    `${input.source.name.replace(/\.[^.]+$/, "")} — ${
      input.action === "remove-background"
        ? "Background removed"
        : input.action === "replace-background"
          ? "Background replaced"
          : input.action === "relight"
            ? "Lighting changed"
            : input.action === "erase-object"
              ? "Object erased"
              : input.action === "isolate-object"
                ? "Object isolated"
                : input.action === "expand"
                  ? "Expanded"
                  : input.action === "upscale"
                    ? "Resolution boosted"
                    : "Edited"
    }.png`,
    bytes,
  );
  const digest = attachment.attachmentId.slice("image_".length);
  const asset: DesignAsset = {
    id: `asset_${digest}`,
    kind: "image",
    name: attachment.name,
    mimeType: attachment.mimeType,
    source: { type: "data", value: bytes.toString("base64") },
    size: intrinsic,
    extensions: { importedBy: input.importedBy },
  };
  return {
    asset,
    derivation: {
      id: `image_derivation_${crypto.randomUUID()}`.slice(0, 256),
      sourceAssetId: input.source.id,
      resultAssetId: asset.id,
      operation: input.action,
      ...(input.action === "prompt-edit"
        ? { prompt: input.prompt.trim() }
        : input.action === "replace-background"
          ? { prompt: input.prompt.trim() }
          : input.action === "relight"
            ? { lightingPreset: input.lightingPreset }
            : input.action === "erase-object"
              ? { prompt: ERASE_OBJECT_PROMPT }
              : input.action === "isolate-object"
                ? { prompt: ISOLATE_OBJECT_PROMPT }
                : input.action === "expand"
                  ? { prompt: EXPAND_IMAGE_PROMPT }
                  : {}),
      ...(supportingMaskAsset ? { maskAssetId: supportingMaskAsset.id } : {}),
      referenceAssetIds: references.map((reference) => reference.id),
      extensions: {
        provider: edited.apiFormat,
        modelId: edited.modelId,
        ...(edited.providerRequestId
          ? { providerRequestId: edited.providerRequestId }
          : {}),
        ...(input.action === "erase-object" || input.action === "isolate-object"
          ? { selectionPointCount: input.selection.points.length }
          : {}),
        ...(input.action === "expand" && pendingExpansion
          ? {
              expansion: { ...input.expansion },
              sourcePlacement: structuredClone(input.placement),
              sourceTargetSize: { ...input.targetSize },
              providerCanvasSize: {
                ...pendingExpansion.geometry.outputSize,
              },
              providerSourceRect: {
                ...pendingExpansion.geometry.sourceRect,
              },
            }
          : {}),
        ...(input.action === "upscale" && pendingUpscale
          ? {
              sourceSize: { ...pendingUpscale.sourceSize },
              targetSize: { ...pendingUpscale.targetSize },
              preserveTransparency: pendingUpscale.preserveTransparency,
              pixelGain:
                (pendingUpscale.targetSize.width *
                  pendingUpscale.targetSize.height) /
                (pendingUpscale.sourceSize.width *
                  pendingUpscale.sourceSize.height),
            }
          : {}),
      },
    },
    ...(supportingMaskAsset
      ? { supportingAssets: [supportingMaskAsset] }
      : references.length === 0
        ? {}
        : { supportingAssets: [...references] }),
  };
}

function toImageEditSource(source: DesignAsset): {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  name: string;
} {
  if (
    source.kind !== "image" ||
    source.source.type !== "data" ||
    (source.mimeType !== "image/png" &&
      source.mimeType !== "image/jpeg" &&
      source.mimeType !== "image/webp")
  ) {
    throw new TypeError("Image edit source is not a supported embedded raster");
  }
  const bytes = Buffer.from(source.source.value, "base64");
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > 16 * 1024 * 1024 ||
    bytes.toString("base64") !== source.source.value
  ) {
    throw new TypeError("Image edit source has invalid image data");
  }
  const intrinsic = nativeImage.createFromBuffer(bytes).getSize();
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    throw new TypeError("Image edit source has invalid dimensions");
  }
  return { bytes, mimeType: source.mimeType, name: source.name };
}

async function materializeAgentImageAsset(
  attachmentId: string,
  context: TrustedToolContext,
  importedBy: string,
): Promise<DesignAsset> {
  const image = await requireAgentReferenceHost().materializeImage(
    attachmentId,
    context,
  );
  const bytes = Buffer.from(image.data, "base64");
  const intrinsic = nativeImage.createFromBuffer(bytes).getSize();
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    throw new TypeError("Image edit reference has invalid dimensions");
  }
  const digest = image.attachment.attachmentId.slice("image_".length);
  return {
    id: `asset_${digest}`,
    kind: "image",
    name: image.attachment.name,
    mimeType: image.mimeType,
    source: { type: "data", value: image.data },
    size: intrinsic,
    extensions: { attachmentId, importedBy },
  };
}

function nativeImageHasTransparentPixels(bitmap: Buffer): boolean {
  if (bitmap.byteLength === 0 || bitmap.byteLength % 4 !== 0) return false;
  for (let offset = 3; offset < bitmap.byteLength; offset += 4) {
    if (bitmap[offset] !== 0xff) return true;
  }
  return false;
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
