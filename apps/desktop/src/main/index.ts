import {
  isAgentRequest,
  type AgentEvent,
  type AgentRequest,
} from "@opendesign/agent-contracts";
import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import { JsonlSessionStore } from "@opendesign/session-store";
import type {
  DesignAsset,
  ImageAssetDerivation,
  ImageLightingPreset,
  ImagePlacement,
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
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { AgentHost, FatalAgentRunError } from "./agent/agent-host";
import { AgentAttachmentHost } from "./agent/agent-attachment-host";
import { AgentReferenceHost } from "./agent/agent-reference-host";
import { AgentSvgExportHost } from "./agent/agent-svg-export-host";
import { AgentSvgImportHost } from "./agent/agent-svg-import-host";
import { AgentRasterExportHost } from "./agent/agent-raster-export-host";
import { RendererDesignToolHost } from "./agent/renderer-design-tool-host";
import {
  DesignGenerationPerformanceTracker,
  designGenerationPerformanceDiagnostic,
} from "./agent/design-generation-performance";
import { reportAgentDiagnostic } from "./agent/agent-diagnostic-reporter";
import { handleAgentApprovalRequest } from "./agent/agent-approval-handler";
import { AgentContinuationScheduler } from "./agent/agent-continuation-scheduler";
import { prepareAgentContinuation } from "./agent/agent-continuation-host";
import { handleAgentRunControlRequest } from "./agent/agent-run-starter";
import { prepareInitialDesignInspection } from "./agent/agent-initial-design-inspection";
import { handleDesignPlanTool } from "./agent/design-plan-tool-handler";
import { handleDesignFirstSliceTool } from "./agent/design-first-slice-tool-handler";
import {
  handleDesignCheckpointTool,
  handleFirstSliceCheckpoint,
} from "./agent/design-checkpoint-tool-handler";
import { requireCanvasCaptureLayoutQuality } from "./agent/canvas-capture-quality";
import {
  requireDesignVisualCriticAttachment,
  runIndependentDesignVisualCritic,
} from "./agent/design-visual-critic";
import { createApplicationMenuTemplate } from "./application-menu";
import { ApplicationLifecycle } from "./application-lifecycle";
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
import { configureFixtureSmoke } from "./professional-fixture-smoke";
import type { RendererDesignCaptureTarget } from "../shared/design-tool-bridge";
import { registerRendererDesignToolIpc } from "./agent/renderer-design-tool-ipc";
import {
  channels,
  isDeleteModelProviderProfileRequest,
  isSaveGlobalImageGenerationSettingsRequest,
  isRendererDiagnosticReport,
  isAgentAttachmentImport,
  isAgentAttachmentPreviewRequest,
  isCancelDesignImageEditRequest,
  isDesignImageEditRequest,
  isLocalePreference,
  isSaveModelProviderProfileRequest,
  isTestModelProviderConnectionRequest,
  isSaveDesignFileRequest,
  isThemePreference,
  type DesignImageAreaSelection,
  type DesignImageExpansion,
  type ThemePreference,
} from "../shared/desktop-api";
import type {
  DiagnosticContext,
  DiagnosticEvent,
  DiagnosticInput,
} from "../shared/diagnostics";
import { DEFAULT_APP_LOCALE, type AppLocale } from "../shared/i18n/locale";
import { handleDesignSystemTool } from "./agent/design-system-tool-handler.js";
import { translate } from "../shared/i18n/messages";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_CHECKPOINT_TOOL_NAME,
  DESIGN_COMPONENT_TOOL_NAME,
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
  normalizeDesignApplyToolInput,
  isDesignComponentToolInput,
  isDesignFontToolInput,
  isDesignTextRangeToolInput,
  normalizeDesignPageToolInput,
  isDesignVectorToolInput,
  isPageStructureAccessToolInput,
  normalizeDesignVisualReviewToolInput,
  isGenerateImageToolInput,
  isEditImageToolInput,
  isExportSvgToolInput,
  isExportRasterToolInput,
  isImportSvgToolInput,
  isPlaceImageToolInput,
  isReadImageToolInput,
  isUpdateImageToolInput,
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
} from "../shared/design-agent-tools";
import {
  componentToolIsMaterialWrite,
  materialTargetRefsForComponentTool,
} from "./agent/component-tool-policy";

const applicationLifecycle = new ApplicationLifecycle();
const designGenerationPerformance = new DesignGenerationPerformanceTracker();
const agentContinuationScheduler = new AgentContinuationScheduler();
app.setName("OpenDesign");
if (process.platform === "win32") app.setAppUserModelId("design.open.app");

const fixtureSmoke = configureFixtureSmoke(app, process.env, homedir());
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
  showWindow: (window) => fixtureSmoke.show(window),
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
const designFileExtension = ".opendesign";
const maxDesignFileBytes = 64 * 1024 * 1024;
let activeDesignFilePath: string | null = null;
let themePreference: ThemePreference = "system";
let localePreference: AppLocale = DEFAULT_APP_LOCALE;
let workspaceStore: WorkspaceStore | null = null;
let projectHost: ProjectHost | null = null;
let projectIpc: ProjectIpcService | null = null;
let globalTaskCoordinator: GlobalTaskCoordinator | null = null;
let modelProviderHost: ModelProviderHost | null = null;
let imageGenerationHost: ImageGenerationHost | null = null;
const designImageEditControllers = new Map<string, AbortController>();
let agentAttachmentHost: AgentAttachmentHost | null = null;
let agentReferenceHost: AgentReferenceHost | null = null;
let agentSvgExportHost: AgentSvgExportHost | null = null;
let agentSvgImportHost: AgentSvgImportHost | null = null;
let agentRasterExportHost: AgentRasterExportHost | null = null;
let svgFileService: SvgFileService | null = null;
let rasterFileService: RasterFileService | null = null;
let diagnosticLog: DiagnosticLog | null = null;
const pendingDiagnosticEvents: DiagnosticEvent[] = [];
const conversationIdByRunId = new Map<string, string>();
const conversationIdByRequestId = new Map<string, string>();

function publishDiagnostic(input: DiagnosticInput): void {
  const event = diagnosticLog?.record(input);
  if (!event) {
    console.error(`[${input.source}:${input.code}] ${input.message}`);
    return;
  }
  if (desktopWindowHost.send(channels.diagnosticEvent, event)) return;
  if (event.presentation === "toast") {
    pendingDiagnosticEvents.push(event);
    if (pendingDiagnosticEvents.length > 20) pendingDiagnosticEvents.shift();
  }
}

function diagnosticContextForAgentEvent(
  event: AgentEvent,
): DiagnosticContext | undefined {
  const runId = "runId" in event ? event.runId : undefined;
  const requestId =
    "requestId" in event
      ? event.requestId
      : event.type === "agent.error"
        ? event.failure?.modelRequestId
        : undefined;
  const toolCallId = "toolCallId" in event ? event.toolCallId : undefined;
  const conversationId = runId
    ? conversationIdByRunId.get(runId)
    : requestId
      ? conversationIdByRequestId.get(requestId)
      : event.type === "session.history"
        ? event.sessionId
        : undefined;
  if (!conversationId && !runId && !requestId && !toolCallId) return undefined;
  return {
    ...(conversationId ? { conversationId } : {}),
    ...(runId ? { runId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  };
}

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

function assertDesignFilePath(path: string) {
  if (extname(path).toLowerCase() !== designFileExtension) {
    throw new TypeError("OpenDesign files must use the .opendesign extension");
  }
}

async function writeDesignFile(path: string, contents: string) {
  assertDesignFilePath(path);
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function selectProjectDirectory(
  purpose: "create" | "open",
): Promise<string | null> {
  const window = desktopWindowHost.current();
  if (!window) return null;
  const result = await dialog.showOpenDialog(window, {
    title:
      purpose === "create"
        ? translate(localePreference, "main.createProjectTitle")
        : translate(localePreference, "main.openProjectTitle"),
    buttonLabel:
      purpose === "create"
        ? translate(localePreference, "main.createHere")
        : translate(localePreference, "main.openProjectButton"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length !== 1) return null;
  return result.filePaths[0] ?? null;
}

async function selectSvgOpenFile(): Promise<string | null> {
  const window = desktopWindowHost.current();
  if (!window) return null;
  const result = await dialog.showOpenDialog(window, {
    title: translate(localePreference, "main.openSvgTitle"),
    buttonLabel: translate(localePreference, "main.openSvgButton"),
    properties: ["openFile"],
    filters: [
      {
        name: translate(localePreference, "main.svgFilter"),
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
    title: translate(localePreference, "main.saveSvgTitle"),
    buttonLabel: translate(localePreference, "main.saveSvgButton"),
    defaultPath: suggestedName,
    filters: [
      {
        name: translate(localePreference, "main.svgFilter"),
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
    title: translate(localePreference, "main.saveRasterTitle"),
    buttonLabel: translate(localePreference, "main.saveRasterButton"),
    defaultPath: suggestedName,
    filters: [
      {
        name: translate(localePreference, "main.rasterFilter", {
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
      settingsLabel: translate(localePreference, "settings.menuItem"),
      fileLabel: translate(localePreference, "main.fileMenu"),
      importSvgLabel: translate(localePreference, "main.importSvgMenu"),
      exportSvgLabel: translate(localePreference, "main.exportSvgMenu"),
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

function assertArgumentCount(args: unknown[], count: number) {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}

function registerIpc(fontBinaryService: FontBinaryMainService) {
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
  registerProjectIpc({
    ipc: ipcMain,
    assertRenderer: assertMainRenderer,
    getService: requireProjectIpc,
  });
  registerRendererDesignToolIpc({
    ipc: ipcMain,
    assertRenderer: assertMainRenderer,
    host: rendererDesignToolHost,
  });
  desktopWindowHost.registerIpc(ipcMain);
  registerSvgFileIpc({
    ipc: ipcMain,
    assertRenderer: assertMainRenderer,
    service: svgFileService,
  });
  registerRasterFileIpc({
    ipc: ipcMain,
    assertRenderer: assertMainRenderer,
    service: rasterFileService,
  });
  fontBinaryService.register(ipcMain, assertMainRenderer, () =>
    desktopWindowHost.current(),
  );
  ipcMain.handle(channels.platformInfo, () => ({
    platform: process.platform,
    version: app.getVersion(),
  }));
  fixtureSmoke.register(ipcMain, assertMainRenderer, () =>
    desktopWindowHost.current(),
  );
  ipcMain.handle(
    channels.getPendingDiagnostics,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 0);
      return pendingDiagnosticEvents.splice(0);
    },
  );
  ipcMain.handle(channels.reportDiagnostic, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 1);
    const report = args[0];
    if (!isRendererDiagnosticReport(report)) {
      throw new TypeError("Invalid diagnostic report");
    }
    publishDiagnostic({ ...report, source: "renderer" });
  });
  ipcMain.handle(channels.getLocale, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 0);
    return localePreference;
  });
  ipcMain.handle(channels.setLocale, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 1);
    const locale = args[0];
    if (!isLocalePreference(locale)) {
      throw new TypeError("Invalid locale preference");
    }
    localePreference = locale;
    workspaceStore?.setPreference("locale", locale);
    installApplicationMenu();
    desktopWindowHost.send(channels.localeChanged, locale);
    return localePreference;
  });
  ipcMain.handle(channels.getTheme, () => themePreference);
  ipcMain.handle(channels.setTheme, (_event, value: unknown) => {
    if (!isThemePreference(value))
      throw new TypeError("Invalid theme preference");
    themePreference = value;
    nativeTheme.themeSource = value;
    return themePreference;
  });
  ipcMain.handle(
    channels.getModelProviderCatalog,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 0);
      return requireModelProviderHost().getCatalog();
    },
  );
  ipcMain.handle(
    channels.getGlobalImageGenerationSettings,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 0);
      return requireImageGenerationHost().getSettings();
    },
  );
  ipcMain.handle(
    channels.saveGlobalImageGenerationSettings,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isSaveGlobalImageGenerationSettingsRequest(request)) {
        throw new TypeError("Invalid global image-generation settings");
      }
      return requireImageGenerationHost().saveSettings(request);
    },
  );
  ipcMain.handle(
    channels.saveModelProviderProfile,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isSaveModelProviderProfileRequest(request)) {
        throw new TypeError("Invalid model provider profile");
      }
      const catalog = requireModelProviderHost().saveProfile(request);
      desktopWindowHost.send(channels.modelProviderCatalogChanged, catalog);
      return catalog;
    },
  );
  ipcMain.handle(
    channels.deleteModelProviderProfile,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isDeleteModelProviderProfileRequest(request)) {
        throw new TypeError("Invalid model provider delete request");
      }
      const catalog = requireModelProviderHost().deleteProfile(request);
      desktopWindowHost.send(channels.modelProviderCatalogChanged, catalog);
      return catalog;
    },
  );
  ipcMain.handle(
    channels.testModelProviderConnection,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isTestModelProviderConnectionRequest(request)) {
        throw new TypeError("Invalid model provider test request");
      }
      return requireModelProviderHost().testConnection(request);
    },
  );
  ipcMain.handle(channels.selectAgentAttachments, async (event, ...args) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 0);
    const window = desktopWindowHost.current();
    if (!window) return [];
    const result = await dialog.showOpenDialog(window, {
      title: translate(localePreference, "main.selectAttachmentsTitle"),
      buttonLabel: translate(localePreference, "main.selectAttachmentsButton"),
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: translate(localePreference, "main.attachmentFilter"),
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
            "svg",
            "pdf",
            "docx",
            "txt",
            "md",
            "markdown",
            "csv",
            "html",
            "htm",
            "json",
            "yaml",
            "yml",
          ],
        },
      ],
    });
    if (result.canceled) return [];
    return requireAgentAttachmentHost().importFiles(result.filePaths);
  });
  ipcMain.handle(
    channels.importAgentAttachments,
    async (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      const attachments = args[0];
      if (
        !Array.isArray(attachments) ||
        attachments.length > 6 ||
        !attachments.every(isAgentAttachmentImport)
      ) {
        throw new TypeError("Invalid Agent attachment import request");
      }
      const totalBytes = attachments.reduce(
        (total, attachment) => total + attachment.bytes.byteLength,
        0,
      );
      if (totalBytes > 32 * 1024 * 1024) {
        throw new RangeError("Attachments exceed the 32 MB total limit");
      }
      return await Promise.all(
        attachments.map((attachment) =>
          requireAgentAttachmentHost().importBytes(
            attachment.name,
            attachment.bytes,
          ),
        ),
      );
    },
  );
  ipcMain.handle(
    channels.getAgentAttachmentPreview,
    async (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isAgentAttachmentPreviewRequest(request)) {
        throw new TypeError("Invalid Agent attachment preview request");
      }
      return {
        attachmentId: request.attachmentId,
        previewDataUrl: await requireAgentAttachmentHost().preview(
          request.attachmentId,
        ),
      };
    },
  );
  ipcMain.handle(channels.selectDesignImage, async (event, ...args) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 0);
    const window = desktopWindowHost.current();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: translate(localePreference, "main.selectDesignImageTitle"),
      buttonLabel: translate(localePreference, "main.selectDesignImageButton"),
      properties: ["openFile"],
      filters: [
        {
          name: translate(localePreference, "main.imageFilter"),
          extensions: ["png", "jpg", "jpeg", "webp", "gif"],
        },
      ],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    const selected = (
      await requireAgentAttachmentHost().importFiles([path])
    )[0];
    if (!selected || !selected.attachmentId.startsWith("image_")) {
      throw new TypeError("Selected design asset is not an image");
    }
    const resolved = await requireAgentAttachmentHost().resolve(
      selected.attachmentId,
    );
    if (resolved.kind !== "image") {
      throw new TypeError("Selected design asset is not an image");
    }
    const intrinsic = nativeImage
      .createFromBuffer(Buffer.from(resolved.data, "base64"))
      .getSize();
    if (intrinsic.width <= 0 || intrinsic.height <= 0) {
      throw new TypeError("Selected design image has invalid dimensions");
    }
    const digest = selected.attachmentId.slice("image_".length);
    return {
      asset: {
        id: `asset_${digest}`,
        kind: "image",
        name: selected.name,
        mimeType: resolved.mimeType,
        source: { type: "data", value: resolved.data },
        size: { width: intrinsic.width, height: intrinsic.height },
        extensions: { importedBy: "design-image-picker" },
      },
    };
  });
  ipcMain.handle(
    channels.editDesignImage,
    async (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isDesignImageEditRequest(request)) {
        throw new TypeError("Invalid design image edit request");
      }
      if (designImageEditControllers.has(request.requestId)) {
        throw new Error(`Image edit ${request.requestId} is already running`);
      }
      const controller = new AbortController();
      designImageEditControllers.set(request.requestId, controller);
      try {
        const result = await editDesignImageAsset(
          request.action === "remove-background" || request.action === "upscale"
            ? {
                action: request.action,
                source: request.source,
                importedBy: "inspector-image-edit",
              }
            : request.action === "replace-background"
              ? {
                  action: request.action,
                  source: request.source,
                  prompt: request.prompt,
                  importedBy: "inspector-image-edit",
                }
              : request.action === "relight"
                ? {
                    action: request.action,
                    source: request.source,
                    lightingPreset: request.lightingPreset,
                    importedBy: "inspector-image-edit",
                  }
                : request.action === "prompt-edit"
                  ? {
                      action: request.action,
                      source: request.source,
                      prompt: request.prompt,
                      ...(request.reference === undefined
                        ? {}
                        : { references: [request.reference] }),
                      importedBy: "inspector-image-edit",
                    }
                  : request.action === "expand"
                    ? {
                        action: request.action,
                        source: request.source,
                        expansion: request.expansion,
                        placement: request.placement,
                        targetSize: request.targetSize,
                        importedBy: "inspector-image-edit",
                      }
                    : {
                        action: request.action,
                        source: request.source,
                        selection: request.selection,
                        importedBy: "inspector-image-edit",
                      },
          controller.signal,
        );
        return {
          requestId: request.requestId,
          action: request.action,
          sourceAssetId: request.expectedAssetId,
          ...result,
        };
      } finally {
        designImageEditControllers.delete(request.requestId);
      }
    },
  );
  ipcMain.handle(
    channels.cancelDesignImageEdit,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      const request = args[0];
      if (!isCancelDesignImageEditRequest(request)) {
        throw new TypeError("Invalid design image edit cancellation request");
      }
      const controller = designImageEditControllers.get(request.requestId);
      if (!controller) return false;
      controller.abort(
        new DOMException("Image editing cancelled", "AbortError"),
      );
      return true;
    },
  );
  ipcMain.handle(channels.openDesignFile, async (event) => {
    assertMainRenderer(event);
    const window = desktopWindowHost.current();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: translate(localePreference, "main.openDocumentTitle"),
      buttonLabel: translate(localePreference, "main.openDocumentButton"),
      properties: ["openFile"],
      filters: [
        {
          name: translate(localePreference, "main.documentFilter"),
          extensions: ["opendesign"],
        },
      ],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const path = result.filePaths[0];
    if (!path) return null;
    assertDesignFilePath(path);
    const file = await stat(path);
    if (!file.isFile() || file.size > maxDesignFileBytes) {
      throw new RangeError("OpenDesign document exceeds the 64 MB limit");
    }
    const contents = await readFile(path, "utf8");
    activeDesignFilePath = path;
    return { name: basename(path), contents };
  });
  ipcMain.handle(channels.saveDesignFile, async (event, request: unknown) => {
    assertMainRenderer(event);
    if (!isSaveDesignFileRequest(request)) {
      throw new TypeError("Invalid OpenDesign save request");
    }
    if (Buffer.byteLength(request.contents, "utf8") > maxDesignFileBytes) {
      throw new RangeError("OpenDesign document exceeds the 64 MB limit");
    }
    let path = request.saveAs ? null : activeDesignFilePath;
    if (!path) {
      const window = desktopWindowHost.current();
      if (!window) return null;
      const suggestedName = request.suggestedName.endsWith(designFileExtension)
        ? request.suggestedName
        : `${request.suggestedName}${designFileExtension}`;
      const result = await dialog.showSaveDialog(window, {
        title: translate(localePreference, "main.saveDocumentTitle"),
        buttonLabel: translate(localePreference, "main.saveDocumentButton"),
        defaultPath: suggestedName,
        filters: [
          {
            name: translate(localePreference, "main.documentFilter"),
            extensions: ["opendesign"],
          },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      path = result.filePath;
    }
    assertDesignFilePath(path);
    await writeDesignFile(path, request.contents);
    activeDesignFilePath = path;
    return { name: basename(path) };
  });
  ipcMain.handle(channels.agentRequest, async (event, ...args: unknown[]) => {
    desktopWindowHost.assertRenderer(
      event,
      "Agent request from unknown renderer",
    );
    assertArgumentCount(args, 1);
    const request = args[0];
    if (!isAgentRequest(request)) throw new TypeError("Invalid Agent request");
    if (request.type === "handshake") {
      throw new TypeError("Agent handshake is host-internal");
    }
    if (request.type === "approval.resolve") {
      if (!globalTaskCoordinator) {
        throw new Error("Global Task services are not initialized");
      }
      handleAgentApprovalRequest(request, {
        agentHost,
        globalTaskCoordinator,
      });
      return;
    }
    if (request.type === "run.start") {
      if (!globalTaskCoordinator) {
        throw new Error("Global Task services are not initialized");
      }
      await handleAgentRunControlRequest(request, {
        agentHost,
        continuationScheduler: agentContinuationScheduler,
        conversationIdByRunId,
        globalTaskCoordinator,
        modelProviderHost: requireModelProviderHost(),
        prepareInitialDesignInspection: prepareInitialInspectionForRun,
        referenceHost: requireAgentReferenceHost(),
        publish: (agentEvent) =>
          desktopWindowHost.send(channels.agentEvent, agentEvent),
      });
      return;
    }
    if (request.type === "session.history") {
      conversationIdByRequestId.set(request.requestId, request.sessionId);
    }
    if (request.type === "run.cancel") {
      if (!globalTaskCoordinator) {
        throw new Error("Global Task services are not initialized");
      }
      const handled = await handleAgentRunControlRequest(request, {
        agentHost,
        continuationScheduler: agentContinuationScheduler,
        conversationIdByRunId,
        globalTaskCoordinator,
        modelProviderHost: requireModelProviderHost(),
        referenceHost: requireAgentReferenceHost(),
        publish: (agentEvent) =>
          desktopWindowHost.send(channels.agentEvent, agentEvent),
      });
      if (handled) return;
    }
    try {
      agentHost.send(request);
    } catch (error) {
      if (request.type === "session.history") {
        conversationIdByRequestId.delete(request.requestId);
      }
      throw error;
    }
  });
  agentHost.on((event) => {
    reportAgentDiagnostic(
      event,
      publishDiagnostic,
      diagnosticContextForAgentEvent,
    );
    const performanceSummary =
      designGenerationPerformance.recordAgentEvent(event);
    if (performanceSummary)
      publishDiagnostic(
        designGenerationPerformanceDiagnostic(
          performanceSummary,
          conversationIdByRunId.get(performanceSummary.runId),
        ),
      );
    if (event.type === "session.history")
      conversationIdByRequestId.delete(event.requestId);
    if (event.type === "agent.error" && event.requestId)
      conversationIdByRequestId.delete(event.requestId);
    if (event.type === "run.completed") {
      rendererDesignToolHost.forgetRun(event.runId);
    }
    prepareAgentContinuation(event, {
      continuationScheduler: agentContinuationScheduler,
      publish: (continuationEvent) =>
        desktopWindowHost.send(channels.agentEvent, continuationEvent),
      projectHost,
      starter:
        globalTaskCoordinator && modelProviderHost && agentReferenceHost
          ? {
              agentHost,
              continuationScheduler: agentContinuationScheduler,
              conversationIdByRunId,
              globalTaskCoordinator,
              modelProviderHost,
              prepareInitialDesignInspection: prepareInitialInspectionForRun,
              referenceHost: agentReferenceHost,
            }
          : null,
    });
    if (event.type === "run.completed") {
      agentReferenceHost?.releaseRun(event.runId);
      conversationIdByRunId.delete(event.runId);
    }
    globalTaskCoordinator?.handleAgentEvent(event);
    desktopWindowHost.send(channels.agentEvent, event);
  });
  nativeTheme.on("updated", () => {
    desktopWindowHost.send(
      channels.themeChanged,
      nativeTheme.shouldUseDarkColors,
    );
  });
}

void app.whenReady().then(async () => {
  if (
    process.platform === "darwin" &&
    process.env.OPENDESIGN_AGENT_SMOKE !== "1" &&
    !fixtureSmoke.active
  ) {
    app.dock?.setIcon(getApplicationIconPath());
  }

  if (process.env.OPENDESIGN_AGENT_SMOKE === "1") {
    try {
      await verifyPackagedAttachmentPipeline();
      console.log("Attachment smoke passed: PDF extraction");
    } catch (error) {
      console.error(
        `Attachment smoke failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      app.exit(1);
      return;
    }
    const timeout = setTimeout(() => {
      console.error("Agent smoke timed out");
      app.exit(1);
    }, 10_000);
    agentHost.on((event) => {
      if (event.type === "agent.error") {
        clearTimeout(timeout);
        console.error(`Agent smoke failed: ${event.message}`);
        app.exit(1);
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
        clearTimeout(timeout);
        console.log(`Agent smoke passed: ${event.runId} ${event.stopReason}`);
        agentHost.stop();
        app.exit(event.stopReason === "complete" ? 0 : 1);
      }
    });
    agentHost.start();
    return;
  }

  fixtureSmoke.startTimeout();

  const workspaceDatabase = await prepareGlobalWorkspaceDatabase(
    fixtureSmoke.home,
    app.getPath("userData"),
  );
  diagnosticLog = new DiagnosticLog(
    join(app.getPath("userData"), "diagnostics"),
    { appVersion: app.getVersion(), platform: process.platform },
  );
  workspaceStore = new WorkspaceStore(workspaceDatabase);
  agentAttachmentHost = new AgentAttachmentHost(
    fixtureSmoke.path(".opendesign", "attachments"),
  );
  const fontBinaryService = new FontBinaryMainService(
    fixtureSmoke.path(".opendesign", "fonts"),
  );
  agentReferenceHost = new AgentReferenceHost(agentAttachmentHost);
  const persistedLocale = workspaceStore.getPreference("locale");
  if (isLocalePreference(persistedLocale)) localePreference = persistedLocale;
  installApplicationMenu();
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
  agentHost.setDesignToolRequestHandler(
    async (call, context, signal, reportProgress) => {
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
        const normalizedInput = normalizeDesignApplyToolInput(input);
        if (!normalizedInput) {
          throw new TypeError("Invalid design apply tool input");
        }
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
        const review = normalizeDesignVisualReviewToolInput(call.input);
        if (!review) {
          throw new TypeError("Invalid visual review tool input");
        }
        return recordVisualReview(review);
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
        if (!isReadImageToolInput(call.input)) {
          throw new TypeError("Invalid read image tool input");
        }
        return await requireAgentReferenceHost().readImage(
          call.input,
          context,
          signal,
        );
      }
      if (call.toolName === GENERATE_IMAGE_TOOL_NAME) {
        if (!isGenerateImageToolInput(call.input)) {
          throw new TypeError("Invalid generate image tool input");
        }
        globalTaskCoordinator.assertDesignPlanForRaster(
          context,
          call.input.role,
        );
        const generated = await requireImageGenerationHost().generateImage(
          call.input,
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
          call.input.role,
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
                  size: { width: intrinsic.width, height: intrinsic.height },
                  extensions: {
                    attachmentId: authorized.attachmentId,
                    designRole: call.input.role,
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
            role: call.input.role,
            outputFormat: generated.outputFormat,
            attachment: authorized,
            attachments: [authorized],
            asset: {
              assetId,
              name: authorized.name,
              mimeType: authorized.mimeType,
              size: { width: intrinsic.width, height: intrinsic.height },
              role: call.input.role,
              scope: "design-file",
            },
          },
          ...(staged.designRevision
            ? { designRevision: staged.designRevision }
            : {}),
        };
      }
      if (call.toolName === PLACE_IMAGE_TOOL_NAME) {
        if (!isPlaceImageToolInput(call.input)) {
          throw new TypeError("Invalid place image tool input");
        }
        const attachmentId =
          "attachmentId" in call.input && call.input.attachmentId !== undefined
            ? requireAgentReferenceHost().hasAuthorizedImage(
                call.input.attachmentId,
                context,
              )
              ? call.input.attachmentId
              : globalTaskCoordinator.resolveGeneratedRasterAttachmentId(
                  context,
                  call.input.attachmentId,
                  call.input.role,
                )
            : undefined;
        globalTaskCoordinator.assertDesignPlanForImagePlacement(
          context,
          call.input.role,
          call.input.parentId,
          attachmentId,
          call.input.nodeId,
        );
        const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(
          context,
          [],
          call.input.parentId,
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
          "assetId" in call.input && call.input.assetId !== undefined
            ? call.input
            : undefined;
        const intrinsicWidth = Math.max(
          1,
          intrinsic?.width ?? persistentAssetInput?.width ?? 1,
        );
        const intrinsicHeight = Math.max(
          1,
          intrinsic?.height ?? persistentAssetInput?.height ?? 1,
        );
        const width =
          call.input.width ??
          (call.input.height
            ? (call.input.height * intrinsicWidth) / intrinsicHeight
            : intrinsicWidth);
        const height =
          call.input.height ??
          (call.input.width
            ? (call.input.width * intrinsicHeight) / intrinsicWidth
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
                    designRole: call.input.role,
                  },
                },
              },
            ]
          : [];
        const result = await executeRendererTool({
          ...call,
          toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
          input: {
            label: `Place ${call.input.name}`,
            commands: [
              ...assetCommand,
              {
                commandId: `${call.toolCallId}_node`,
                type: "insert_element",
                pageId: call.input.pageId,
                parentId: call.input.parentId,
                index: call.input.index,
                node: {
                  id: call.input.nodeId,
                  kind: "image",
                  name: call.input.name,
                  parentId: call.input.parentId,
                  childIds: [],
                  visible: true,
                  locked: false,
                  transform: [1, 0, 0, 1, call.input.x, call.input.y],
                  size: { width, height },
                  exportSettings: [],
                  opacity: 1,
                  properties: {
                    assetId,
                    placement: call.input.placement ?? {
                      mode: "fill",
                      focalPoint: { x: 0.5, y: 0.5 },
                    },
                    altText: call.input.name,
                    cornerRadius: 0,
                  },
                  extensions: { designRole: call.input.role },
                },
              },
            ],
          },
        });
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          targetIds,
          result.designRevision?.revision,
          [call.input.nodeId],
        );
        return withDesignDelivery(result, context.runId);
      }
      if (call.toolName === UPDATE_IMAGE_TOOL_NAME) {
        if (!isUpdateImageToolInput(call.input)) {
          throw new TypeError("Invalid update image tool input");
        }
        if (
          executionContext.mutationTarget.kind === "page" &&
          executionContext.mutationTarget.pageId !== call.input.pageId
        ) {
          throw new Error(
            "Image update targets a Page outside the active mutation target",
          );
        }
        globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
        const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(
          context,
          [call.input.nodeId],
        );
        if (call.input.action === "replace-source") {
          const image = await requireAgentReferenceHost().materializeImage(
            call.input.attachmentId,
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
              label: call.input.label,
              pageId: call.input.pageId,
              nodeId: call.input.nodeId,
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
              ...(call.input.placement === undefined
                ? {}
                : { placement: call.input.placement }),
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
          input: call.input,
        });
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          targetIds,
          result.designRevision?.revision,
        );
        return withDesignDelivery(result, context.runId);
      }
      if (call.toolName === EDIT_IMAGE_TOOL_NAME) {
        if (!isEditImageToolInput(call.input)) {
          throw new TypeError("Invalid edit image tool input");
        }
        if (
          executionContext.mutationTarget.kind === "page" &&
          executionContext.mutationTarget.pageId !== call.input.pageId
        ) {
          throw new Error(
            "Image edit targets a Page outside the active mutation target",
          );
        }
        globalTaskCoordinator.assertDocumentInspected(context);
        globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
        const targetIds = globalTaskCoordinator.resolveMaterialTargetIds(
          context,
          [call.input.nodeId],
        );
        const prepared = await executeRendererTool({
          ...call,
          toolCallId: `${call.toolCallId}_read_source`.slice(0, 256),
          toolName: INTERNAL_READ_IMAGE_SOURCE_TOOL_NAME,
          input: {
            pageId: call.input.pageId,
            nodeId: call.input.nodeId,
            expectedAssetId: call.input.expectedAssetId,
          },
        });
        if (!isPreparedImageEditSource(prepared.content)) {
          throw new TypeError(
            "Image edit source preparation returned invalid data",
          );
        }
        const source = prepared.content.asset;
        const reference =
          call.input.action === "prompt-edit" &&
          call.input.referenceAttachmentId
            ? await materializeAgentImageAsset(
                call.input.referenceAttachmentId,
                context,
                "agent-image-edit-reference",
              )
            : undefined;
        const derived = await editDesignImageAsset(
          call.input.action === "remove-background" ||
            call.input.action === "upscale"
            ? {
                action: call.input.action,
                source,
                importedBy: "agent-image-edit",
              }
            : call.input.action === "prompt-edit" ||
                call.input.action === "replace-background"
              ? {
                  action: call.input.action,
                  source,
                  prompt: call.input.prompt,
                  ...(reference === undefined
                    ? {}
                    : { references: [reference] }),
                  importedBy: "agent-image-edit",
                }
              : call.input.action === "relight"
                ? {
                    action: call.input.action,
                    source,
                    lightingPreset: call.input.lightingPreset,
                    importedBy: "agent-image-edit",
                  }
                : call.input.action === "expand"
                  ? {
                      action: call.input.action,
                      source,
                      expansion: call.input.expansion,
                      placement: prepared.content.placement,
                      targetSize: prepared.content.targetSize,
                      importedBy: "agent-image-edit",
                    }
                  : {
                      action: call.input.action,
                      source,
                      selection: call.input.selection,
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
              call.input.action === "isolate-object"
                ? "derive-layer"
                : call.input.action === "expand"
                  ? "expand-source"
                  : call.input.action === "upscale"
                    ? "upscale-source"
                    : "derive-source",
            label: call.input.label,
            pageId: call.input.pageId,
            nodeId: call.input.nodeId,
            expectedAssetId: call.input.expectedAssetId,
            ...(call.input.action === "expand"
              ? {
                  expectedPlacement: prepared.content.placement,
                  expectedTargetSize: prepared.content.targetSize,
                  expansion: call.input.expansion,
                }
              : {}),
            ...(call.input.action === "upscale"
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
            ...(call.input.action === "isolate-object"
              ? {
                  resultNodeId: call.input.resultNodeId,
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
          call.input.action === "isolate-object"
            ? [call.input.resultNodeId]
            : undefined,
        );
        return withDesignDelivery(result, context.runId);
      }
      if (call.toolName === DESIGN_APPLY_TOOL_NAME) {
        if (!normalizeDesignApplyToolInput(call.input)) {
          throw new TypeError("Invalid design apply tool input");
        }
        return await executeDesignApply(
          call,
          call.input as DesignApplyToolInput,
        );
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
      Boolean(
        globalTaskCoordinator?.hasActiveConversationRun(conversationId) ||
        agentContinuationScheduler.hasActiveConversationRun(conversationId),
      ),
  );
  globalTaskCoordinator.reconcileInterruptedTasks();
  try {
    const recovered = await new JsonlSessionStore(
      fixtureSmoke.path(".opendesign", "sessions", "events.jsonl"),
    ).reconcileInterruptedRuns();
    if (recovered.recoveredRuns > 0) {
      console.info(
        `Recovered ${recovered.recoveredRuns} interrupted Agent run(s) and ${recovered.recoveredTools} tool call(s)`,
      );
      publishDiagnostic({
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
    publishDiagnostic({
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
  registerIpc(fontBinaryService);
  if (!fixtureSmoke.active) agentHost.start();
  desktopWindowHost.create();
  app.on("activate", () => desktopWindowHost.activate());
});

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

type DesignImageEditInput =
  | {
      action: "remove-background";
      source: DesignAsset;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "replace-background";
      source: DesignAsset;
      prompt: string;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "relight";
      source: DesignAsset;
      lightingPreset: ImageLightingPreset;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "prompt-edit";
      source: DesignAsset;
      prompt: string;
      references?: readonly DesignAsset[];
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "erase-object" | "isolate-object";
      source: DesignAsset;
      selection: DesignImageAreaSelection;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "expand";
      source: DesignAsset;
      expansion: DesignImageExpansion;
      placement: ImagePlacement;
      targetSize: Size;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    }
  | {
      action: "upscale";
      source: DesignAsset;
      importedBy: "agent-image-edit" | "inspector-image-edit";
    };

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
  applicationLifecycle.markQuitRequested();
});

app.on("will-quit", () => {
  for (const controller of designImageEditControllers.values()) {
    controller.abort(
      new DOMException("OpenDesign is shutting down", "AbortError"),
    );
  }
  designImageEditControllers.clear();
  agentHost.stop();
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
  agentHost.setModelRequestHandler(null);
  agentHost.setDesignToolRequestHandler(null);
  rendererDesignToolHost.rejectAll("OpenDesign is shutting down");
  workspaceStore?.close();
  workspaceStore = null;
  conversationIdByRunId.clear();
  conversationIdByRequestId.clear();
});

app.on("window-all-closed", () => {
  if (applicationLifecycle.shouldQuitAfterLastWindow(process.platform)) {
    app.quit();
  }
});
