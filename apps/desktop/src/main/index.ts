import { isAgentRequest, type AgentEvent } from "@opendesign/agent-contracts";
import { JsonlSessionStore } from "@opendesign/session-store";
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
import { pathToFileURL } from "node:url";
import { AgentHost, FatalAgentRunError } from "./agent/agent-host";
import { AgentAttachmentHost } from "./agent/agent-attachment-host";
import { AgentReferenceHost } from "./agent/agent-reference-host";
import { AgentSvgExportHost } from "./agent/agent-svg-export-host";
import { AgentSvgImportHost } from "./agent/agent-svg-import-host";
import { RendererDesignToolHost } from "./agent/renderer-design-tool-host";
import { createApplicationMenuTemplate } from "./application-menu";
import { GlobalTaskCoordinator } from "./agent/global-task-coordinator";
import {
  isAllowedRendererNavigation,
  isExternalHttpUrl,
} from "./navigation-policy";
import { ProjectHost } from "./project/project-host";
import { ProjectIpcService } from "./project/project-ipc";
import { WorkspaceStore } from "./project/workspace-store";
import { registerSvgFileIpc } from "./svg/svg-file-ipc";
import { SvgFileService } from "./svg/svg-file-service";
import { ModelProviderHost } from "./model/model-provider-host";
import { ImageGenerationHost } from "./model/image-generation-host";
import { prepareGlobalWorkspaceDatabase } from "./global-data";
import { DiagnosticLog } from "./diagnostics/diagnostic-log";
import { resolveRendererUrl } from "./renderer-url";
import { isRendererDesignToolResponse } from "../shared/design-tool-bridge";
import {
  channels,
  isDeleteModelProviderProfileRequest,
  isSaveGlobalImageGenerationSettingsRequest,
  isRendererDiagnosticReport,
  isAgentAttachmentImport,
  isAgentAttachmentPreviewRequest,
  isLocalePreference,
  isSaveModelProviderProfileRequest,
  isTestModelProviderConnectionRequest,
  isSaveDesignFileRequest,
  isThemePreference,
  isWindowAction,
  type ThemePreference,
} from "../shared/desktop-api";
import type {
  DiagnosticContext,
  DiagnosticEvent,
  DiagnosticInput,
} from "../shared/diagnostics";
import { DEFAULT_APP_LOCALE, type AppLocale } from "../shared/i18n/locale";
import { translate } from "../shared/i18n/messages";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  isDesignApplyToolInput,
  isDesignPlanToolInput,
  isDesignVisualReviewToolInput,
  isGenerateImageToolInput,
  isExportSvgToolInput,
  isImportSvgToolInput,
  isPlaceImageToolInput,
  isReadImageToolInput,
  isUpdateImageToolInput,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  READ_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
} from "../shared/design-agent-tools";

const applicationId = "design.open.app";
const applicationName = "OpenDesign";

app.setName(applicationName);
if (process.platform === "win32") app.setAppUserModelId(applicationId);

let mainWindow: BrowserWindow | null = null;
const agentHost = new AgentHost();
const rendererDesignToolHost = new RendererDesignToolHost(
  (request) => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) {
      throw new Error("Renderer is unavailable for design tool execution");
    }
    window.webContents.send(channels.designToolRequest, request);
  },
  (request) => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    window.webContents.send(channels.designToolCancel, request);
  },
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
let agentAttachmentHost: AgentAttachmentHost | null = null;
let agentReferenceHost: AgentReferenceHost | null = null;
let agentSvgExportHost: AgentSvgExportHost | null = null;
let agentSvgImportHost: AgentSvgImportHost | null = null;
let svgFileService: SvgFileService | null = null;
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
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    window.webContents.send(channels.diagnosticEvent, event);
    return;
  }
  if (event.presentation === "toast") {
    pendingDiagnosticEvents.push(event);
    if (pendingDiagnosticEvents.length > 20) pendingDiagnosticEvents.shift();
  }
}

function diagnosticContextForAgentEvent(
  event: AgentEvent,
): DiagnosticContext | undefined {
  const runId = "runId" in event ? event.runId : undefined;
  const requestId = "requestId" in event ? event.requestId : undefined;
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

function recordAgentDiagnostic(event: AgentEvent): void {
  if (event.type === "agent.error") {
    publishDiagnostic({
      level: "error",
      source: "agent",
      presentation: "toast",
      code: event.code,
      message: event.message,
      ...(diagnosticContextForAgentEvent(event)
        ? { context: diagnosticContextForAgentEvent(event) }
        : {}),
    });
  }
  if (event.type === "tool.failed") {
    publishDiagnostic({
      level: "warning",
      source: "design-tool",
      presentation: "silent",
      code: event.code,
      message: event.message,
      context: diagnosticContextForAgentEvent(event),
    });
  }
}

function assertMainRenderer(event: Electron.IpcMainInvokeEvent) {
  if (event.sender !== mainWindow?.webContents) {
    throw new Error("Request from unknown renderer");
  }
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

function requireAgentSvgExportHost(): AgentSvgExportHost {
  if (!agentSvgExportHost) {
    throw new Error("Agent SVG export services are not initialized");
  }
  return agentSvgExportHost;
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
  const window = mainWindow;
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
  const window = mainWindow;
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
  const window = mainWindow;
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

function resolveApplicationIconPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(app.getAppPath(), "build/icon.png");
}

function installApplicationMenu() {
  const template = createApplicationMenuTemplate(
    applicationName,
    process.platform,
    {
      onOpenSettings: () => {
        mainWindow?.webContents.send(channels.openSettings);
      },
      onImportSvg: () => {
        mainWindow?.webContents.send(channels.importSvgCommand);
      },
      onExportSvg: () => {
        mainWindow?.webContents.send(channels.exportSvgCommand);
      },
      settingsLabel: translate(localePreference, "settings.menuItem"),
      fileLabel: translate(localePreference, "main.fileMenu"),
      importSvgLabel: translate(localePreference, "main.importSvgMenu"),
      exportSvgLabel: translate(localePreference, "main.exportSvgMenu"),
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 920,
    minHeight: 620,
    show: false,
    title: applicationName,
    icon: resolveApplicationIconPath(),
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: 15 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#191a1b" : "#f4f4f2",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  const rendererUrl = resolveRendererUrl(process.env);
  const packagedRendererPath = join(__dirname, "../renderer/index.html");
  const packagedRendererUrl = pathToFileURL(packagedRendererPath).toString();

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererNavigation(url, rendererUrl, packagedRendererUrl)) {
      event.preventDefault();
    }
  });

  if (rendererUrl) void mainWindow.loadURL(rendererUrl);
  else void mainWindow.loadFile(packagedRendererPath);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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

function registerProjectIpc() {
  ipcMain.handle(channels.createProject, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 1);
    return requireProjectIpc().createProject(args[0]);
  });
  ipcMain.handle(channels.openProject, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 0);
    return requireProjectIpc().openProject();
  });
  ipcMain.handle(channels.openRecentProject, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 1);
    return requireProjectIpc().openRecentProject(args[0]);
  });
  ipcMain.handle(channels.listRecentProjects, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 0);
    return requireProjectIpc().listRecentProjects();
  });
  ipcMain.handle(channels.removeRecentProject, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 1);
    return requireProjectIpc().removeRecentProject(args[0]);
  });
  ipcMain.handle(channels.revealRecentProject, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 1);
    return requireProjectIpc().revealRecentProject(args[0]);
  });
  ipcMain.handle(channels.listOpenProjects, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 0);
    return requireProjectIpc().listOpenProjects();
  });
  ipcMain.handle(channels.createConversation, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 1);
    return requireProjectIpc().createConversation(args[0]);
  });
  ipcMain.handle(
    channels.listProjectConversations,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      return requireProjectIpc().listProjectConversations(args[0]);
    },
  );
  ipcMain.handle(
    channels.resolveDesignToolRequest,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      const response = args[0];
      if (!isRendererDesignToolResponse(response)) {
        throw new TypeError("Invalid design tool response");
      }
      if (!rendererDesignToolHost.resolve(response)) {
        throw new Error("Design tool request is no longer active");
      }
    },
  );
  ipcMain.handle(channels.listGlobalTasks, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    assertArgumentCount(args, 0);
    return requireProjectIpc().listGlobalTasks();
  });
  ipcMain.handle(
    channels.createProjectDesignFile,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      return requireProjectIpc().createDesignFile(args[0]);
    },
  );
  ipcMain.handle(
    channels.readProjectDesignFile,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      return requireProjectIpc().readDesignFile(args[0]);
    },
  );
  ipcMain.handle(
    channels.saveProjectDesignFile,
    (event, ...args: unknown[]) => {
      assertMainRenderer(event);
      assertArgumentCount(args, 1);
      return requireProjectIpc().saveDesignFile(args[0]);
    },
  );
}

function registerIpc() {
  svgFileService = new SvgFileService({
    selectOpenFile: selectSvgOpenFile,
    selectSaveFile: selectSvgSaveFile,
  });
  agentSvgExportHost = new AgentSvgExportHost(
    rendererDesignToolHost,
    svgFileService,
  );
  agentSvgImportHost = new AgentSvgImportHost(
    rendererDesignToolHost,
    requireAgentReferenceHost(),
  );
  registerProjectIpc();
  registerSvgFileIpc({
    ipc: ipcMain,
    assertRenderer: assertMainRenderer,
    service: svgFileService,
  });
  ipcMain.handle(channels.platformInfo, () => ({
    platform: process.platform,
    version: app.getVersion(),
  }));
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
    mainWindow?.webContents.send(channels.localeChanged, locale);
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
      mainWindow?.webContents.send(
        channels.modelProviderCatalogChanged,
        catalog,
      );
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
      mainWindow?.webContents.send(
        channels.modelProviderCatalogChanged,
        catalog,
      );
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
    const window = mainWindow;
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
    const window = mainWindow;
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
  ipcMain.handle(channels.openDesignFile, async (event) => {
    assertMainRenderer(event);
    const window = mainWindow;
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
      const window = mainWindow;
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
    if (event.sender !== mainWindow?.webContents) {
      throw new Error("Agent request from unknown renderer");
    }
    assertArgumentCount(args, 1);
    const request = args[0];
    if (!isAgentRequest(request)) throw new TypeError("Invalid Agent request");
    if (request.type === "handshake") {
      throw new TypeError("Agent handshake is host-internal");
    }
    if (request.type === "run.start") {
      if (request.modelContext !== undefined) {
        throw new TypeError("Renderer cannot supply model context metadata");
      }
      if (!globalTaskCoordinator) {
        throw new Error("Global Task services are not initialized");
      }
      await globalTaskCoordinator.registerRun(request);
      requireAgentReferenceHost().registerRun(request);
      conversationIdByRunId.set(request.runId, request.sessionId);
      try {
        agentHost.send({
          ...request,
          modelContext: requireModelProviderHost().resolveModelContext(
            request.modelSelection,
          ),
        });
      } catch (error) {
        conversationIdByRunId.delete(request.runId);
        requireAgentReferenceHost().releaseRun(request.runId);
        globalTaskCoordinator.handleAgentEvent({
          type: "agent.error",
          code: "request_rejected",
          message:
            error instanceof Error ? error.message : "Agent request failed",
          runId: request.runId,
        });
        throw error;
      }
      return;
    }
    if (request.type === "session.history") {
      conversationIdByRequestId.set(request.requestId, request.sessionId);
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
    recordAgentDiagnostic(event);
    if (event.type === "session.history") {
      conversationIdByRequestId.delete(event.requestId);
    }
    if (event.type === "agent.error" && event.requestId) {
      conversationIdByRequestId.delete(event.requestId);
    }
    if (event.type === "run.completed") {
      agentReferenceHost?.releaseRun(event.runId);
      conversationIdByRunId.delete(event.runId);
    }
    globalTaskCoordinator?.handleAgentEvent(event);
    mainWindow?.webContents.send(channels.agentEvent, event);
  });
  ipcMain.handle(channels.windowAction, (event, value: unknown) => {
    if (!isWindowAction(value)) throw new TypeError("Invalid window action");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window !== mainWindow) return;
    if (value === "minimize") window.minimize();
    if (value === "toggle-maximize") {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    }
    if (value === "close") window.close();
  });
  nativeTheme.on("updated", () => {
    mainWindow?.webContents.send(
      channels.themeChanged,
      nativeTheme.shouldUseDarkColors,
    );
  });
}

void app.whenReady().then(async () => {
  if (
    process.platform === "darwin" &&
    process.env.OPENDESIGN_AGENT_SMOKE !== "1"
  ) {
    app.dock?.setIcon(resolveApplicationIconPath());
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

  const workspaceDatabase = await prepareGlobalWorkspaceDatabase(
    homedir(),
    app.getPath("userData"),
  );
  diagnosticLog = new DiagnosticLog(
    join(app.getPath("userData"), "diagnostics"),
    { appVersion: app.getVersion(), platform: process.platform },
  );
  workspaceStore = new WorkspaceStore(workspaceDatabase);
  agentAttachmentHost = new AgentAttachmentHost(
    join(homedir(), ".opendesign", "attachments"),
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
  agentHost.setModelRequestHandler((request, signal) =>
    requireModelProviderHost().stream(request, signal),
  );
  agentHost.setDesignToolRequestHandler(async (call, context, signal) => {
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
    if (call.toolName === DESIGN_PLAN_TOOL_NAME) {
      if (!isDesignPlanToolInput(call.input)) {
        throw new TypeError("Invalid design plan tool input");
      }
      globalTaskCoordinator.registerDesignPlan(context, call.input);
      return {
        content: {
          ok: true,
          status: "accepted",
          version: call.input.version,
          deliverable: call.input.deliverable,
          outputMode: call.input.outputMode,
          pageId: call.input.pageId,
          artboard: call.input.artboard,
          regions: call.input.composition.regions,
          editableLayers: call.input.editableLayers,
          rasterAssetRoles: call.input.rasterAssetRoles,
        },
      };
    }
    if (call.toolName === DESIGN_REVIEW_TOOL_NAME) {
      if (!isDesignVisualReviewToolInput(call.input)) {
        throw new TypeError("Invalid visual review tool input");
      }
      globalTaskCoordinator.registerVisualReview(context, call.input);
      return {
        content: {
          ok: true,
          status: "accepted",
          refinements: call.input.refinements,
        },
      };
    }
    if (call.toolName === EXPORT_SVG_TOOL_NAME) {
      if (!isExportSvgToolInput(call.input)) {
        throw new TypeError("Invalid SVG export tool input");
      }
      globalTaskCoordinator.assertDocumentInspected(context);
      return await requireAgentSvgExportHost().execute(call, context, signal);
    }
    if (call.toolName === IMPORT_SVG_TOOL_NAME) {
      if (!isImportSvgToolInput(call.input)) {
        throw new TypeError("Invalid SVG import tool input");
      }
      globalTaskCoordinator.assertDocumentInspected(context);
      globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
      const result = await requireAgentSvgImportHost().execute(
        call,
        context,
        signal,
      );
      globalTaskCoordinator.recordMaterialDesignWriteCompleted(
        context.runId,
        result.designRevision?.revision,
      );
      return result;
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
      globalTaskCoordinator.assertDesignPlanForRaster(context, call.input.role);
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
        },
      };
    }
    if (call.toolName === PLACE_IMAGE_TOOL_NAME) {
      if (!isPlaceImageToolInput(call.input)) {
        throw new TypeError("Invalid place image tool input");
      }
      globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
      globalTaskCoordinator.assertDesignPlanForImagePlacement(
        context,
        call.input.role,
        call.input.parentId,
        call.input.attachmentId,
      );
      const image = await requireAgentReferenceHost().materializeImage(
        call.input.attachmentId,
        context,
      );
      const intrinsic = nativeImage
        .createFromBuffer(Buffer.from(image.data, "base64"))
        .getSize();
      const intrinsicWidth = Math.max(1, intrinsic.width);
      const intrinsicHeight = Math.max(1, intrinsic.height);
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
      const digest = image.attachment.attachmentId.slice("image_".length);
      const assetId = `asset_${digest}`;
      const result = await rendererDesignToolHost.execute(
        {
          ...call,
          toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
          input: {
            label: `Place ${call.input.name}`,
            commands: [
              {
                commandId: `${call.toolCallId}_asset`,
                type: "put_asset",
                asset: {
                  id: assetId,
                  kind: "image",
                  name: image.attachment.name,
                  mimeType: image.mimeType,
                  source: { type: "data", value: image.data },
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
        },
        context,
        signal,
      );
      globalTaskCoordinator.recordMaterialDesignWriteCompleted(
        context.runId,
        result.designRevision?.revision,
      );
      return result;
    }
    if (call.toolName === UPDATE_IMAGE_TOOL_NAME) {
      if (!isUpdateImageToolInput(call.input)) {
        throw new TypeError("Invalid update image tool input");
      }
      if (
        context.mutationTarget.kind === "page" &&
        context.mutationTarget.pageId !== call.input.pageId
      ) {
        throw new Error(
          "Image update targets a Page outside the active mutation target",
        );
      }
      globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
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
        const result = await rendererDesignToolHost.execute(
          {
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
          },
          context,
          signal,
        );
        globalTaskCoordinator.recordMaterialDesignWriteCompleted(
          context.runId,
          result.designRevision?.revision,
        );
        return result;
      }
      const result = await rendererDesignToolHost.execute(
        {
          ...call,
          toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
          input: call.input,
        },
        context,
        signal,
      );
      globalTaskCoordinator.recordMaterialDesignWriteCompleted(
        context.runId,
        result.designRevision?.revision,
      );
      return result;
    }
    if (call.toolName === DESIGN_APPLY_TOOL_NAME) {
      if (!isDesignApplyToolInput(call.input)) {
        throw new TypeError("Invalid design apply tool input");
      }
      globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
      globalTaskCoordinator.assertDesignPlanForApply(context, call.input);
      const result = await rendererDesignToolHost.execute(
        call,
        context,
        signal,
      );
      globalTaskCoordinator.recordDesignApplyCompleted(
        context.runId,
        call.input,
        result.designRevision?.revision,
      );
      return result;
    }
    if (
      call.toolName === DESIGN_HIERARCHY_TOOL_NAME ||
      call.toolName === DESIGN_ARRANGE_TOOL_NAME
    ) {
      globalTaskCoordinator.assertVisualReviewBeforeWrite(context);
      const result = await rendererDesignToolHost.execute(
        call,
        context,
        signal,
      );
      globalTaskCoordinator.recordMaterialDesignWriteCompleted(
        context.runId,
        result.designRevision?.revision,
      );
      return result;
    }
    const result = await rendererDesignToolHost.execute(call, context, signal);
    if (call.toolName === DESIGN_INSPECT_TOOL_NAME) {
      globalTaskCoordinator.recordDocumentInspection(context);
    }
    if (call.toolName === DESIGN_CAPTURE_TOOL_NAME) {
      const reviewWorkflow = globalTaskCoordinator.recordCanvasCapture(
        context,
        result.observedRevision,
      );
      if (!isRecordValue(result.content)) {
        throw new TypeError(
          "Canvas capture returned invalid structured content",
        );
      }
      return {
        ...result,
        content: {
          ...result.content,
          reviewWorkflow,
        },
      };
    }
    return result;
  });
  projectHost = new ProjectHost(workspaceStore);
  projectIpc = new ProjectIpcService(
    projectHost,
    workspaceStore,
    selectProjectDirectory,
    (rootPath) => shell.showItemInFolder(rootPath),
  );
  globalTaskCoordinator = new GlobalTaskCoordinator(
    projectHost,
    workspaceStore,
  );
  globalTaskCoordinator.reconcileInterruptedTasks();
  try {
    const recovered = await new JsonlSessionStore(
      join(homedir(), ".opendesign", "sessions", "events.jsonl"),
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
  registerIpc();
  agentHost.start();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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

app.on("before-quit", () => {
  agentHost.stop();
  projectIpc = null;
  globalTaskCoordinator = null;
  projectHost = null;
  modelProviderHost = null;
  imageGenerationHost = null;
  agentAttachmentHost = null;
  agentReferenceHost = null;
  agentSvgExportHost = null;
  agentSvgImportHost = null;
  svgFileService = null;
  agentHost.setModelRequestHandler(null);
  agentHost.setDesignToolRequestHandler(null);
  rendererDesignToolHost.rejectAll("OpenDesign is shutting down");
  workspaceStore?.close();
  workspaceStore = null;
  conversationIdByRunId.clear();
  conversationIdByRequestId.clear();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
