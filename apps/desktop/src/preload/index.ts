import { contextBridge, ipcRenderer } from "electron";
import {
  isLibraryReleaseSnapshot,
  type LibraryReleaseSnapshot,
} from "@opendesign/design-contracts";
import {
  isAgentRequest,
  type AgentEvent,
  type AgentRequest,
} from "@opendesign/agent-contracts";
import { projectAgentEvent } from "./agent-event";
import type { GlobalTaskProjection } from "@opendesign/workspace-contracts";
import { createConversationApi } from "./conversation-api";
import { AgentRequestResultContract } from "@/shared/agent-request-contract";
import {
  channels,
  isFontBinaryDescriptor,
  isFontBinaryPayload,
  isFontBinaryReadRequest,
  isGlobalTaskProjectionResult,
  isListProjectLibrariesRequest,
  isProjectLibraryCatalog,
  isPublishProjectLibraryRequest,
  isPublishProjectLibraryResult,
  isReadProjectLibraryReleaseRequest,
  isSetProjectLibraryEnabledRequest,
  isSetProjectLibraryUpdateAcceptedRequest,
  isSetProjectLibraryUpdateIgnoredRequest,
  isOpenDesignFile,
  isOpenSvgFile,
  isSaveDesignFileRequest,
  isSaveDesignFileResult,
  isSaveSvgFileRequest,
  isSaveSvgFileResult,
  isSaveRasterFileRequest,
  isSaveRasterFileResult,
  isLocalePreference,
  isDiagnosticEvent,
  isRendererDiagnosticReport,
  type FontBinaryDescriptor,
  type FontBinaryPayload,
  type FontBinaryReadRequest,
  type DesktopApi,
  type ListProjectLibrariesRequest,
  type ProjectLibraryCatalog,
  type PublishProjectLibraryRequest,
  type PublishProjectLibraryResult,
  type ReadProjectLibraryReleaseRequest,
  type SetProjectLibraryEnabledRequest,
  type SetProjectLibraryUpdateAcceptedRequest,
  type SetProjectLibraryUpdateIgnoredRequest,
  type SaveDesignFileRequest,
  type SaveDesignFileResult,
  type OpenDesignFile,
  type OpenSvgFile,
  type DiagnosticEvent,
  type RendererDiagnosticReport,
  type SaveSvgFileRequest,
  type SaveSvgFileResult,
  type SaveRasterFileRequest,
  type SaveRasterFileResult,
  type ThemePreference,
  type WindowAction,
} from "@/shared/desktop-api";
import type { AppLocale } from "@/shared/i18n/locale";
import {
  isRendererDesignToolCancel,
  isRendererDesignToolProgress,
  isRendererDesignToolRequest,
  isRendererDesignToolResponse,
  rendererDesignToolRequestId,
  type RendererDesignToolCancel,
  type RendererDesignToolProgress,
  type RendererDesignToolRequest,
  type RendererDesignToolResponse,
} from "@/shared/design-tool-bridge";
import { createMediaApi } from "./media-api";
import { createProjectApi } from "./project-api";
import { createProviderApi } from "./provider-api";
import { validate, validateArray } from "./value-parser";

const desktopApi: DesktopApi = Object.freeze({
  getPlatformInfo: () => ipcRenderer.invoke(channels.platformInfo),
  getPendingDiagnostics: async () => {
    const result: unknown = await ipcRenderer.invoke(
      channels.getPendingDiagnostics,
    );
    return validateArray<DiagnosticEvent>(
      result,
      isDiagnosticEvent,
      "Invalid pending diagnostics response",
    );
  },
  reportDiagnostic: async (report: RendererDiagnosticReport) => {
    validate(report, isRendererDiagnosticReport, "Invalid diagnostic report");
    await ipcRenderer.invoke(channels.reportDiagnostic, report);
  },
  onDiagnosticEvent: (listener: (event: DiagnosticEvent) => void) => {
    const subscription = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ) => {
      if (isDiagnosticEvent(value)) listener(value);
    };
    ipcRenderer.on(channels.diagnosticEvent, subscription);
    return () =>
      ipcRenderer.removeListener(channels.diagnosticEvent, subscription);
  },
  onOpenSettings: (listener: () => void) => {
    const subscription = () => listener();
    ipcRenderer.on(channels.openSettings, subscription);
    return () =>
      ipcRenderer.removeListener(channels.openSettings, subscription);
  },
  onImportSvgCommand: (listener: () => void) => {
    const subscription = () => listener();
    ipcRenderer.on(channels.importSvgCommand, subscription);
    return () =>
      ipcRenderer.removeListener(channels.importSvgCommand, subscription);
  },
  onExportSvgCommand: (listener: () => void) => {
    const subscription = () => listener();
    ipcRenderer.on(channels.exportSvgCommand, subscription);
    return () =>
      ipcRenderer.removeListener(channels.exportSvgCommand, subscription);
  },
  getLocale: async () => {
    const locale: unknown = await ipcRenderer.invoke(channels.getLocale);
    return validate(locale, isLocalePreference, "Invalid locale response");
  },
  setLocale: async (locale: AppLocale) => {
    validate(locale, isLocalePreference, "Invalid locale preference");
    const result: unknown = await ipcRenderer.invoke(
      channels.setLocale,
      locale,
    );
    return validate(result, isLocalePreference, "Invalid locale response");
  },
  onLocaleChange: (listener: (locale: AppLocale) => void) => {
    const subscription = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ) => {
      if (isLocalePreference(value)) listener(value);
    };
    ipcRenderer.on(channels.localeChanged, subscription);
    return () =>
      ipcRenderer.removeListener(channels.localeChanged, subscription);
  },
  getTheme: () => ipcRenderer.invoke(channels.getTheme),
  setTheme: (theme: ThemePreference) =>
    ipcRenderer.invoke(channels.setTheme, theme),
  ...createProviderApi(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (channel, listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) =>
        listener(value);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  ),
  ...createMediaApi((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
  selectFontBinaries: async () => {
    const result: unknown = await ipcRenderer.invoke(
      channels.selectFontBinaries,
    );
    return validateArray<FontBinaryDescriptor>(
      result,
      isFontBinaryDescriptor,
      "Invalid font binary selection response",
    );
  },
  listFontBinaries: async () => {
    const result: unknown = await ipcRenderer.invoke(channels.listFontBinaries);
    return validateArray<FontBinaryDescriptor>(
      result,
      isFontBinaryDescriptor,
      "Invalid font binary list response",
    );
  },
  readFontBinary: async (request: FontBinaryReadRequest) => {
    validate(
      request,
      isFontBinaryReadRequest,
      "Invalid font binary read request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.readFontBinary,
      request,
    );
    return validate<FontBinaryPayload>(
      result,
      isFontBinaryPayload,
      "Invalid font binary read response",
    );
  },
  onDesignToolRequest: (
    listener: (request: RendererDesignToolRequest) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isRendererDesignToolRequest(value)) {
        listener(value);
        return;
      }
      const requestId = rendererDesignToolRequestId(value);
      if (requestId) {
        void ipcRenderer.invoke(channels.resolveDesignToolRequest, {
          requestId,
          ok: false,
          error: {
            code: "renderer_request_invalid",
            message: "Main sent an invalid Renderer design tool request",
            retryable: false,
            recoverable: true,
          },
        });
      }
    };
    ipcRenderer.on(channels.designToolRequest, handler);
    return () =>
      ipcRenderer.removeListener(channels.designToolRequest, handler);
  },
  onDesignToolCancel: (
    listener: (request: RendererDesignToolCancel) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isRendererDesignToolCancel(value)) listener(value);
    };
    ipcRenderer.on(channels.designToolCancel, handler);
    return () => ipcRenderer.removeListener(channels.designToolCancel, handler);
  },
  reportDesignToolProgress: async (progress: RendererDesignToolProgress) => {
    validate(
      progress,
      isRendererDesignToolProgress,
      "Invalid design tool progress",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.designToolProgress,
      progress,
    );
    if (typeof result !== "boolean") {
      throw new TypeError("Invalid design tool progress response");
    }
    return result;
  },
  resolveDesignToolRequest: async (response: RendererDesignToolResponse) => {
    validate(
      response,
      isRendererDesignToolResponse,
      "Invalid design tool response",
    );
    await ipcRenderer.invoke(channels.resolveDesignToolRequest, response);
  },
  windowAction: (action: WindowAction) =>
    ipcRenderer.invoke(channels.windowAction, action),
  openDesignFile: async () => {
    const result: unknown = await ipcRenderer.invoke(channels.openDesignFile);
    if (result === null) return null;
    return validate<OpenDesignFile>(
      result,
      isOpenDesignFile,
      "Invalid Design File response",
    );
  },
  saveDesignFile: async (request: SaveDesignFileRequest) => {
    validate(request, isSaveDesignFileRequest, "Invalid Design File request");
    const result: unknown = await ipcRenderer.invoke(
      channels.saveDesignFile,
      request,
    );
    if (result === null) return null;
    return validate<SaveDesignFileResult>(
      result,
      isSaveDesignFileResult,
      "Invalid Design File save response",
    );
  },
  openSvgFile: async () => {
    const result: unknown = await ipcRenderer.invoke(channels.openSvgFile);
    if (result === null) return null;
    return validate<OpenSvgFile>(
      result,
      isOpenSvgFile,
      "Invalid SVG file response",
    );
  },
  saveSvgFile: async (request: SaveSvgFileRequest) => {
    validate(request, isSaveSvgFileRequest, "Invalid SVG save request");
    const result: unknown = await ipcRenderer.invoke(
      channels.saveSvgFile,
      request,
    );
    if (result === null) return null;
    return validate<SaveSvgFileResult>(
      result,
      isSaveSvgFileResult,
      "Invalid SVG save response",
    );
  },
  saveRasterFile: async (request: SaveRasterFileRequest) => {
    validate(request, isSaveRasterFileRequest, "Invalid raster save request");
    const result: unknown = await ipcRenderer.invoke(
      channels.saveRasterFile,
      request,
    );
    if (result === null) return null;
    return validate<SaveRasterFileResult>(
      result,
      isSaveRasterFileResult,
      "Invalid raster save response",
    );
  },
  ...createProjectApi((channel, ...args) =>
    ipcRenderer.invoke(channel, ...args),
  ),
  ...createConversationApi((channel, ...args) =>
    ipcRenderer.invoke(channel, ...args),
  ),
  listGlobalTasks: async () => {
    const result: unknown = await ipcRenderer.invoke(channels.listGlobalTasks);
    return validateArray<GlobalTaskProjection>(
      result,
      isGlobalTaskProjectionResult,
      "Invalid Global Tasks response",
    );
  },
  publishProjectLibrary: async (request: PublishProjectLibraryRequest) => {
    validate(
      request,
      isPublishProjectLibraryRequest,
      "Invalid Project Library publish request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.publishProjectLibrary,
      request,
    );
    return validate<PublishProjectLibraryResult>(
      result,
      isPublishProjectLibraryResult,
      "Invalid Project Library publish response",
    );
  },
  listProjectLibraries: async (request: ListProjectLibrariesRequest) => {
    validate(
      request,
      isListProjectLibrariesRequest,
      "Invalid Project Library list request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.listProjectLibraries,
      request,
    );
    return validate<ProjectLibraryCatalog>(
      result,
      isProjectLibraryCatalog,
      "Invalid Project Library catalog response",
    );
  },
  readProjectLibraryRelease: async (
    request: ReadProjectLibraryReleaseRequest,
  ) => {
    validate(
      request,
      isReadProjectLibraryReleaseRequest,
      "Invalid Project Library release request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.readProjectLibraryRelease,
      request,
    );
    return validate<LibraryReleaseSnapshot>(
      result,
      isLibraryReleaseSnapshot,
      "Invalid Project Library release response",
    );
  },
  setProjectLibraryEnabled: async (
    request: SetProjectLibraryEnabledRequest,
  ) => {
    validate(
      request,
      isSetProjectLibraryEnabledRequest,
      "Invalid Project Library enable request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.setProjectLibraryEnabled,
      request,
    );
    return validate<ProjectLibraryCatalog>(
      result,
      isProjectLibraryCatalog,
      "Invalid Project Library catalog response",
    );
  },
  setProjectLibraryUpdateIgnored: async (
    request: SetProjectLibraryUpdateIgnoredRequest,
  ) => {
    validate(
      request,
      isSetProjectLibraryUpdateIgnoredRequest,
      "Invalid Project Library ignore request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.setProjectLibraryUpdateIgnored,
      request,
    );
    return validate<ProjectLibraryCatalog>(
      result,
      isProjectLibraryCatalog,
      "Invalid Project Library catalog response",
    );
  },
  setProjectLibraryUpdateAccepted: async (
    request: SetProjectLibraryUpdateAcceptedRequest,
  ) => {
    validate(
      request,
      isSetProjectLibraryUpdateAcceptedRequest,
      "Invalid Project Library accept request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.setProjectLibraryUpdateAccepted,
      request,
    );
    return validate<ProjectLibraryCatalog>(
      result,
      isProjectLibraryCatalog,
      "Invalid Project Library catalog response",
    );
  },
  onNativeThemeChange: (listener: (isDark: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isDark: boolean) =>
      listener(isDark);
    ipcRenderer.on(channels.themeChanged, handler);
    return () => ipcRenderer.removeListener(channels.themeChanged, handler);
  },
  sendAgentRequest: async (request: AgentRequest) => {
    validate(request, isAgentRequest, "Invalid Agent request");
    const result: unknown = await ipcRenderer.invoke(
      channels.agentRequest,
      request,
    );
    const parsed = AgentRequestResultContract.parse(result);
    if (!parsed.ok) throw new TypeError("Invalid Agent request result");
    return parsed.value;
  },
  onAgentEvent: (listener: (event: AgentEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: unknown) => {
      listener(projectAgentEvent(event));
    };
    ipcRenderer.on(channels.agentEvent, handler);
    return () => ipcRenderer.removeListener(channels.agentEvent, handler);
  },
});

contextBridge.exposeInMainWorld("desktop", desktopApi);
