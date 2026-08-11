import { contextBridge, ipcRenderer } from "electron";
import {
  isAgentEvent,
  isAgentRequest,
  type AgentEvent,
  type AgentRequest,
} from "@opendesign/agent-contracts";
import type {
  ConversationDescriptor,
  GlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import {
  channels,
  isAgentAttachmentPreviewRequest,
  isAgentAttachmentPreviewResult,
  isAgentAttachmentSelection,
  isAgentAttachmentImport,
  isDesignImageSelection,
  isDesignFileDescriptorResult,
  isConversationDescriptorResult,
  isCreateConversationRequest,
  isCreateProjectDesignFileRequest,
  isCreateProjectRequest,
  isGlobalTaskProjectionResult,
  isListProjectConversationsRequest,
  isModelProviderCatalog,
  isOpenRecentProjectRequest,
  isProviderConnectionResult,
  isProjectDesignFile,
  isProjectDesignFileRequest,
  isProjectManifestResult,
  isRenameProjectDesignFileRequest,
  isRecentProject,
  isOpenSvgFile,
  isSaveProjectDesignFileRequest,
  isSaveSvgFileRequest,
  isSaveSvgFileResult,
  isSaveRasterFileRequest,
  isSaveRasterFileResult,
  isLocalePreference,
  isSaveModelProviderProfileRequest,
  isGlobalImageGenerationSettings,
  isSaveGlobalImageGenerationSettingsRequest,
  isDeleteModelProviderProfileRequest,
  isDiagnosticEvent,
  isRendererDiagnosticReport,
  isTestModelProviderConnectionRequest,
  type CreateConversationRequest,
  type AgentAttachmentPreviewRequest,
  type AgentAttachmentPreviewResult,
  type AgentAttachmentSelection,
  type AgentAttachmentImport,
  type DesignImageSelection,
  type CreateProjectDesignFileRequest,
  type CreateProjectRequest,
  type DesktopApi,
  type ListProjectConversationsRequest,
  type OpenRecentProjectRequest,
  type ModelProviderCatalog,
  type GlobalImageGenerationSettings,
  type ProviderConnectionResult,
  type ProjectDesignFile,
  type ProjectDesignFileRequest,
  type RenameProjectDesignFileRequest,
  type RecentProject,
  type SaveDesignFileRequest,
  type OpenSvgFile,
  type SaveModelProviderProfileRequest,
  type SaveGlobalImageGenerationSettingsRequest,
  type DeleteModelProviderProfileRequest,
  type DiagnosticEvent,
  type RendererDiagnosticReport,
  type TestModelProviderConnectionRequest,
  type SaveProjectDesignFileRequest,
  type SaveSvgFileRequest,
  type SaveSvgFileResult,
  type SaveRasterFileRequest,
  type SaveRasterFileResult,
  type ThemePreference,
  type WindowAction,
} from "../shared/desktop-api";
import type { AppLocale } from "../shared/i18n/locale";
import {
  isRendererDesignToolCancel,
  isRendererDesignToolRequest,
  isRendererDesignToolResponse,
  type RendererDesignToolCancel,
  type RendererDesignToolRequest,
  type RendererDesignToolResponse,
} from "../shared/design-tool-bridge";

type Guard<T> = (value: unknown) => value is T;

function validate<T>(value: unknown, guard: Guard<T>, message: string): T {
  if (!guard(value)) throw new TypeError(message);
  return value;
}

function validateArray<T>(
  value: unknown,
  guard: Guard<T>,
  message: string,
): T[] {
  if (!Array.isArray(value) || !value.every(guard))
    throw new TypeError(message);
  return value;
}

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
  getModelProviderCatalog: async () => {
    const result: unknown = await ipcRenderer.invoke(
      channels.getModelProviderCatalog,
    );
    return validate<ModelProviderCatalog>(
      result,
      isModelProviderCatalog,
      "Invalid model provider catalog response",
    );
  },
  getGlobalImageGenerationSettings: async () => {
    const result: unknown = await ipcRenderer.invoke(
      channels.getGlobalImageGenerationSettings,
    );
    return validate<GlobalImageGenerationSettings>(
      result,
      isGlobalImageGenerationSettings,
      "Invalid global image-generation settings response",
    );
  },
  saveGlobalImageGenerationSettings: async (
    request: SaveGlobalImageGenerationSettingsRequest,
  ) => {
    validate(
      request,
      isSaveGlobalImageGenerationSettingsRequest,
      "Invalid global image-generation settings request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.saveGlobalImageGenerationSettings,
      request,
    );
    return validate<GlobalImageGenerationSettings>(
      result,
      isGlobalImageGenerationSettings,
      "Invalid global image-generation settings response",
    );
  },
  saveModelProviderProfile: async (
    request: SaveModelProviderProfileRequest,
  ) => {
    validate(
      request,
      isSaveModelProviderProfileRequest,
      "Invalid model provider profile request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.saveModelProviderProfile,
      request,
    );
    return validate<ModelProviderCatalog>(
      result,
      isModelProviderCatalog,
      "Invalid model provider catalog response",
    );
  },
  deleteModelProviderProfile: async (
    request: DeleteModelProviderProfileRequest,
  ) => {
    validate(
      request,
      isDeleteModelProviderProfileRequest,
      "Invalid model provider delete request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.deleteModelProviderProfile,
      request,
    );
    return validate<ModelProviderCatalog>(
      result,
      isModelProviderCatalog,
      "Invalid model provider catalog response",
    );
  },
  testModelProviderConnection: async (
    request: TestModelProviderConnectionRequest,
  ) => {
    validate(
      request,
      isTestModelProviderConnectionRequest,
      "Invalid model provider test request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.testModelProviderConnection,
      request,
    );
    return validate<ProviderConnectionResult>(
      result,
      isProviderConnectionResult,
      "Invalid model provider connection response",
    );
  },
  onModelProviderCatalogChange: (
    listener: (catalog: ModelProviderCatalog) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isModelProviderCatalog(value)) listener(value);
    };
    ipcRenderer.on(channels.modelProviderCatalogChanged, handler);
    return () =>
      ipcRenderer.removeListener(channels.modelProviderCatalogChanged, handler);
  },
  selectAgentAttachments: async () => {
    const result: unknown = await ipcRenderer.invoke(
      channels.selectAgentAttachments,
    );
    return validateArray<AgentAttachmentSelection>(
      result,
      isAgentAttachmentSelection,
      "Invalid Agent attachment selection response",
    );
  },
  importAgentAttachments: async (attachments: AgentAttachmentImport[]) => {
    if (
      !Array.isArray(attachments) ||
      attachments.length > 6 ||
      !attachments.every(isAgentAttachmentImport)
    ) {
      throw new TypeError("Invalid Agent attachment import request");
    }
    const result: unknown = await ipcRenderer.invoke(
      channels.importAgentAttachments,
      attachments,
    );
    return validateArray<AgentAttachmentSelection>(
      result,
      isAgentAttachmentSelection,
      "Invalid Agent attachment import response",
    );
  },
  getAgentAttachmentPreview: async (request: AgentAttachmentPreviewRequest) => {
    validate(
      request,
      isAgentAttachmentPreviewRequest,
      "Invalid Agent attachment preview request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.getAgentAttachmentPreview,
      request,
    );
    return validate<AgentAttachmentPreviewResult>(
      result,
      isAgentAttachmentPreviewResult,
      "Invalid Agent attachment preview response",
    );
  },
  selectDesignImage: async () => {
    const result: unknown = await ipcRenderer.invoke(
      channels.selectDesignImage,
    );
    if (result === null) return null;
    return validate<DesignImageSelection>(
      result,
      isDesignImageSelection,
      "Invalid design image selection response",
    );
  },
  onDesignToolRequest: (
    listener: (request: RendererDesignToolRequest) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isRendererDesignToolRequest(value)) listener(value);
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
  openDesignFile: () => ipcRenderer.invoke(channels.openDesignFile),
  saveDesignFile: (request: SaveDesignFileRequest) =>
    ipcRenderer.invoke(channels.saveDesignFile, request),
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
  createProject: async (request: CreateProjectRequest) => {
    validate(request, isCreateProjectRequest, "Invalid Project create request");
    const result: unknown = await ipcRenderer.invoke(
      channels.createProject,
      request,
    );
    return result === null
      ? null
      : validate(result, isProjectManifestResult, "Invalid Project response");
  },
  openProject: async () => {
    const result: unknown = await ipcRenderer.invoke(channels.openProject);
    return result === null
      ? null
      : validate(result, isProjectManifestResult, "Invalid Project response");
  },
  openRecentProject: async (request: OpenRecentProjectRequest) => {
    validate(
      request,
      isOpenRecentProjectRequest,
      "Invalid recent Project request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.openRecentProject,
      request,
    );
    return validate(
      result,
      isProjectManifestResult,
      "Invalid Project response",
    );
  },
  listRecentProjects: async () => {
    const result: unknown = await ipcRenderer.invoke(
      channels.listRecentProjects,
    );
    return validateArray<RecentProject>(
      result,
      isRecentProject,
      "Invalid recent Projects response",
    );
  },
  removeRecentProject: async (request: OpenRecentProjectRequest) => {
    validate(
      request,
      isOpenRecentProjectRequest,
      "Invalid recent Project remove request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.removeRecentProject,
      request,
    );
    return validateArray<RecentProject>(
      result,
      isRecentProject,
      "Invalid recent Projects response",
    );
  },
  revealRecentProject: async (request: OpenRecentProjectRequest) => {
    validate(
      request,
      isOpenRecentProjectRequest,
      "Invalid recent Project reveal request",
    );
    await ipcRenderer.invoke(channels.revealRecentProject, request);
  },
  listOpenProjects: async () => {
    const result: unknown = await ipcRenderer.invoke(channels.listOpenProjects);
    return validateArray(
      result,
      isProjectManifestResult,
      "Invalid open Projects response",
    );
  },
  createConversation: async (request: CreateConversationRequest) => {
    validate(
      request,
      isCreateConversationRequest,
      "Invalid Conversation create request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.createConversation,
      request,
    );
    return validate<ConversationDescriptor>(
      result,
      isConversationDescriptorResult,
      "Invalid Conversation response",
    );
  },
  listProjectConversations: async (
    request: ListProjectConversationsRequest,
  ) => {
    validate(
      request,
      isListProjectConversationsRequest,
      "Invalid Project Conversation list request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.listProjectConversations,
      request,
    );
    return validateArray<ConversationDescriptor>(
      result,
      isConversationDescriptorResult,
      "Invalid Project Conversations response",
    );
  },
  listGlobalTasks: async () => {
    const result: unknown = await ipcRenderer.invoke(channels.listGlobalTasks);
    return validateArray<GlobalTaskProjection>(
      result,
      isGlobalTaskProjectionResult,
      "Invalid Global Tasks response",
    );
  },
  createProjectDesignFile: async (request: CreateProjectDesignFileRequest) => {
    validate(
      request,
      isCreateProjectDesignFileRequest,
      "Invalid design file create request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.createProjectDesignFile,
      request,
    );
    return validate<ProjectDesignFile>(
      result,
      isProjectDesignFile,
      "Invalid design file response",
    );
  },
  readProjectDesignFile: async (request: ProjectDesignFileRequest) => {
    validate(
      request,
      isProjectDesignFileRequest,
      "Invalid design file read request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.readProjectDesignFile,
      request,
    );
    return validate<ProjectDesignFile>(
      result,
      isProjectDesignFile,
      "Invalid design file response",
    );
  },
  saveProjectDesignFile: async (request: SaveProjectDesignFileRequest) => {
    validate(
      request,
      isSaveProjectDesignFileRequest,
      "Invalid design file save request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.saveProjectDesignFile,
      request,
    );
    return validate<ProjectDesignFile>(
      result,
      isProjectDesignFile,
      "Invalid design file response",
    );
  },
  renameProjectDesignFile: async (request: RenameProjectDesignFileRequest) => {
    validate(
      request,
      isRenameProjectDesignFileRequest,
      "Invalid design file rename request",
    );
    const result: unknown = await ipcRenderer.invoke(
      channels.renameProjectDesignFile,
      request,
    );
    return validate(
      result,
      isDesignFileDescriptorResult,
      "Invalid design file rename response",
    );
  },
  onNativeThemeChange: (listener: (isDark: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isDark: boolean) =>
      listener(isDark);
    ipcRenderer.on(channels.themeChanged, handler);
    return () => ipcRenderer.removeListener(channels.themeChanged, handler);
  },
  sendAgentRequest: (request: AgentRequest) => {
    validate(request, isAgentRequest, "Invalid Agent request");
    return ipcRenderer.invoke(channels.agentRequest, request);
  },
  onAgentEvent: (listener: (event: AgentEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: unknown) => {
      if (isAgentEvent(event)) listener(event);
    };
    ipcRenderer.on(channels.agentEvent, handler);
    return () => ipcRenderer.removeListener(channels.agentEvent, handler);
  },
});

contextBridge.exposeInMainWorld("desktop", desktopApi);
