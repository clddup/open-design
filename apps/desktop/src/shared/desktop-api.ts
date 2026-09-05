import type { AgentEvent, AgentRequest } from "@opendesign/agent-contracts";
import type { LibraryReleaseSnapshot } from "@opendesign/design-contracts";
import {
  ConversationDescriptorContract,
  ConversationIdentityRequestContract,
  CreateConversationRequestContract,
  isGlobalTaskProjection,
  type ConversationDescriptor,
  type ConversationIdentityRequest,
  type CreateConversationRequest,
  type DeleteConversationRequest,
  type DesignFileDescriptor,
  type GlobalTaskProjection,
  type ProjectManifest,
} from "@opendesign/workspace-contracts";
import {
  ConversationOpenContextContract,
  type ConversationOpenContext,
} from "./conversation-contract";
import { isAppLocale, type AppLocale } from "./i18n/locale";
import type {
  RendererDesignToolRequest,
  RendererDesignToolCancel,
  RendererDesignToolProgress,
  RendererDesignToolResponse,
} from "./design-tool-bridge";
import type { AgentRequestResult } from "./agent-request-contract";
export type { AgentRequestResult } from "./agent-request-contract";
import type { DiagnosticEvent, RendererDiagnosticReport } from "./diagnostics";
import type {
  FontBinaryDescriptor,
  FontBinaryPayload,
  FontBinaryReadRequest,
} from "./font-binary-contract";
export {
  isFontBinaryDescriptor,
  isFontBinaryPayload,
  isFontBinaryReadRequest,
  type FontBinaryDescriptor,
  type FontBinaryPayload,
  type FontBinaryReadRequest,
} from "./font-binary-contract";
export {
  GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION,
  isDeleteModelProviderProfileRequest,
  isGlobalImageGenerationSettings,
  isModelProviderCatalog,
  isModelProviderProfile,
  isModelSelection,
  isProviderConnectionResult,
  isSaveGlobalImageGenerationSettingsRequest,
  isSaveModelProviderProfileRequest,
  isSaveVisualCriticSelectionRequest,
  isTestModelProviderConnectionRequest,
  isVisualCriticSelectionAvailable,
  MODEL_PROVIDER_CATALOG_VERSION,
  normalizeProviderBaseUrl,
  type DeleteModelProviderProfileRequest,
  type GlobalImageGenerationSettings,
  type ImageGenerationApiFormat,
  type ModelCapabilities,
  type ModelProfile,
  type ModelProviderCatalog,
  type ModelProviderProfile,
  type ProviderConnectionResult,
  type SaveGlobalImageGenerationSettingsRequest,
  type SaveModelProviderProfileRequest,
  type SaveVisualCriticSelectionRequest,
  type TestModelProviderConnectionRequest,
} from "./provider-config-contract";
import type {
  DeleteModelProviderProfileRequest,
  GlobalImageGenerationSettings,
  ModelProviderCatalog,
  ProviderConnectionResult,
  SaveGlobalImageGenerationSettingsRequest,
  SaveModelProviderProfileRequest,
  SaveVisualCriticSelectionRequest,
  TestModelProviderConnectionRequest,
} from "./provider-config-contract";
import type {
  OpenDesignFile,
  OpenSvgFile,
  SaveDesignFileRequest,
  SaveDesignFileResult,
  SaveRasterFileRequest,
  SaveRasterFileResult,
  SaveSvgFileRequest,
  SaveSvgFileResult,
} from "./native-file-contract";

export {
  isAgentAttachmentImport,
  isAgentAttachmentPreviewRequest,
  isAgentAttachmentPreviewResult,
  isAgentAttachmentSelection,
  isCancelDesignImageEditRequest,
  isDesignImageAreaSelection,
  isDesignImageEditRequest,
  isDesignImageEditResult,
  isDesignImageExpansion,
  isDesignImageSelection,
  type AgentAttachmentImport,
  type AgentAttachmentPreviewRequest,
  type AgentAttachmentPreviewResult,
  type AgentAttachmentSelection,
  type CancelDesignImageEditRequest,
  type DesignImageAreaSelection,
  type DesignImageEditAction,
  type DesignImageEditRequest,
  type DesignImageEditResult,
  type DesignImageExpansion,
  type DesignImageSelection,
} from "./media-input-contract";
import type {
  AgentAttachmentImport,
  AgentAttachmentPreviewRequest,
  AgentAttachmentPreviewResult,
  AgentAttachmentSelection,
  CancelDesignImageEditRequest,
  DesignImageEditRequest,
  DesignImageEditResult,
  DesignImageSelection,
} from "./media-input-contract";
import type {
  ListProjectLibrariesRequest,
  ProjectLibraryCatalog,
  PublishProjectLibraryRequest,
  PublishProjectLibraryResult,
  ReadProjectLibraryReleaseRequest,
  SetProjectLibraryEnabledRequest,
  SetProjectLibraryUpdateAcceptedRequest,
  SetProjectLibraryUpdateIgnoredRequest,
} from "./project-library-contract";
import type {
  CreateProjectDesignFileRequest,
  CreateProjectRequest,
  OpenRecentProjectRequest,
  ProjectDesignFile,
  ProjectDesignFileRequest,
  RecentProject,
  RenameProjectDesignFileRequest,
  SaveProjectDesignFileRequest,
} from "./project-file-contract";

export {
  isListProjectLibrariesRequest,
  isProjectLibraryCatalog,
  isPublishProjectLibraryRequest,
  isPublishProjectLibraryResult,
  isReadProjectLibraryReleaseRequest,
  isSetProjectLibraryEnabledRequest,
  isSetProjectLibraryUpdateAcceptedRequest,
  isSetProjectLibraryUpdateIgnoredRequest,
  type ListProjectLibrariesRequest,
  type ProjectLibraryCatalog,
  type ProjectLibraryCatalogEntry,
  type PublishProjectLibraryRequest,
  type PublishProjectLibraryResult,
  type ReadProjectLibraryReleaseRequest,
  type SetProjectLibraryEnabledRequest,
  type SetProjectLibraryUpdateAcceptedRequest,
  type SetProjectLibraryUpdateIgnoredRequest,
} from "./project-library-contract";

export {
  CreateProjectDesignFileRequestContract,
  CreateProjectRequestContract,
  OpenRecentProjectRequestContract,
  ProjectDesignFileContract,
  ProjectDesignFileRequestContract,
  ProjectIdentityRequestContract,
  ProjectManifestListContract,
  ProjectManifestResponseContract,
  RecentProjectContract,
  RecentProjectListContract,
  RenameProjectDesignFileRequestContract,
  RenameProjectDesignFileResultContract,
  SaveProjectDesignFileRequestContract,
  isCreateProjectDesignFileRequest,
  isCreateProjectRequest,
  isDesignFileDescriptorResult,
  isOpenRecentProjectRequest,
  isProjectDesignFile,
  isProjectDesignFileRequest,
  isProjectManifestResult,
  isRecentProject,
  isRenameProjectDesignFileRequest,
  isSaveProjectDesignFileRequest,
  type CreateProjectDesignFileRequest,
  type CreateProjectRequest,
  type OpenRecentProjectRequest,
  type ProjectDesignFile,
  type ProjectDesignFileRequest,
  type RecentProject,
  type RenameProjectDesignFileRequest,
  type SaveProjectDesignFileRequest,
} from "./project-file-contract";

export {
  formatDiagnosticReport,
  isDiagnosticEvent,
  isRendererDiagnosticReport,
  type DiagnosticContext,
  type DiagnosticEvent,
  type DiagnosticLevel,
  type DiagnosticPresentation,
  type DiagnosticSource,
  type RendererDiagnosticReport,
} from "./diagnostics";

export {
  isOpenDesignFile,
  isOpenSvgFile,
  isSaveDesignFileRequest,
  isSaveDesignFileResult,
  isSaveRasterFileRequest,
  isSaveRasterFileResult,
  isSaveSvgFileRequest,
  isSaveSvgFileResult,
  type OpenDesignFile,
  type OpenSvgFile,
  type SaveDesignFileRequest,
  type SaveDesignFileResult,
  type SaveRasterFileRequest,
  type SaveRasterFileResult,
  type SaveSvgFileRequest,
  type SaveSvgFileResult,
} from "./native-file-contract";

export {
  DEFAULT_APP_LOCALE,
  isAppLocale,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "./i18n/locale";

export type ThemePreference = "light" | "dark" | "system";

export type WindowAction = "minimize" | "toggle-maximize" | "close";

export type {
  ConversationIdentityRequest,
  ConversationOpenContext,
  CreateConversationRequest,
  DeleteConversationRequest,
};

export interface DesktopApi {
  readonly platform: NodeJS.Platform;
  getPendingDiagnostics: () => Promise<DiagnosticEvent[]>;
  reportDiagnostic: (report: RendererDiagnosticReport) => Promise<void>;
  onDiagnosticEvent: (listener: (event: DiagnosticEvent) => void) => () => void;
  onOpenSettings: (listener: () => void) => () => void;
  onImportSvgCommand: (listener: () => void) => () => void;
  onExportSvgCommand: (listener: () => void) => () => void;
  getLocale: () => Promise<AppLocale>;
  setLocale: (locale: AppLocale) => Promise<AppLocale>;
  onLocaleChange: (listener: (locale: AppLocale) => void) => () => void;
  getTheme: () => Promise<ThemePreference>;
  setTheme: (theme: ThemePreference) => Promise<ThemePreference>;
  getModelProviderCatalog: () => Promise<ModelProviderCatalog>;
  getGlobalImageGenerationSettings: () => Promise<GlobalImageGenerationSettings>;
  saveGlobalImageGenerationSettings: (
    request: SaveGlobalImageGenerationSettingsRequest,
  ) => Promise<GlobalImageGenerationSettings>;
  saveModelProviderProfile: (
    request: SaveModelProviderProfileRequest,
  ) => Promise<ModelProviderCatalog>;
  saveVisualCriticSelection: (
    request: SaveVisualCriticSelectionRequest,
  ) => Promise<ModelProviderCatalog>;
  deleteModelProviderProfile: (
    request: DeleteModelProviderProfileRequest,
  ) => Promise<ModelProviderCatalog>;
  testModelProviderConnection: (
    request: TestModelProviderConnectionRequest,
  ) => Promise<ProviderConnectionResult>;
  onModelProviderCatalogChange: (
    listener: (catalog: ModelProviderCatalog) => void,
  ) => () => void;
  selectAgentAttachments: () => Promise<AgentAttachmentSelection[]>;
  importAgentAttachments: (
    attachments: AgentAttachmentImport[],
  ) => Promise<AgentAttachmentSelection[]>;
  getAgentAttachmentPreview: (
    request: AgentAttachmentPreviewRequest,
  ) => Promise<AgentAttachmentPreviewResult>;
  selectDesignImage: () => Promise<DesignImageSelection | null>;
  editDesignImage: (
    request: DesignImageEditRequest,
  ) => Promise<DesignImageEditResult>;
  cancelDesignImageEdit: (
    request: CancelDesignImageEditRequest,
  ) => Promise<boolean>;
  selectFontBinaries: () => Promise<FontBinaryDescriptor[]>;
  listFontBinaries: () => Promise<FontBinaryDescriptor[]>;
  readFontBinary: (
    request: FontBinaryReadRequest,
  ) => Promise<FontBinaryPayload>;
  onDesignToolRequest: (
    listener: (request: RendererDesignToolRequest) => void,
  ) => () => void;
  onDesignToolCancel: (
    listener: (request: RendererDesignToolCancel) => void,
  ) => () => void;
  reportDesignToolProgress: (
    progress: RendererDesignToolProgress,
  ) => Promise<boolean>;
  resolveDesignToolRequest: (
    response: RendererDesignToolResponse,
  ) => Promise<void>;
  windowAction: (action: WindowAction) => Promise<void>;
  onNativeThemeChange: (listener: (isDark: boolean) => void) => () => void;
  openDesignFile: () => Promise<OpenDesignFile | null>;
  saveDesignFile: (
    request: SaveDesignFileRequest,
  ) => Promise<SaveDesignFileResult | null>;
  openSvgFile: () => Promise<OpenSvgFile | null>;
  saveSvgFile: (
    request: SaveSvgFileRequest,
  ) => Promise<SaveSvgFileResult | null>;
  saveRasterFile: (
    request: SaveRasterFileRequest,
  ) => Promise<SaveRasterFileResult | null>;
  createProject: (
    request: CreateProjectRequest,
  ) => Promise<ProjectManifest | null>;
  openProject: () => Promise<ProjectManifest | null>;
  openRecentProject: (
    request: OpenRecentProjectRequest,
  ) => Promise<ProjectManifest>;
  listRecentProjects: () => Promise<RecentProject[]>;
  removeRecentProject: (
    request: OpenRecentProjectRequest,
  ) => Promise<RecentProject[]>;
  revealRecentProject: (request: OpenRecentProjectRequest) => Promise<void>;
  listOpenProjects: () => Promise<ProjectManifest[]>;
  createConversation: (
    request: CreateConversationRequest,
  ) => Promise<ConversationDescriptor>;
  deleteConversation: (
    request: DeleteConversationRequest,
  ) => Promise<ConversationDescriptor>;
  resolveConversationOpenContext: (
    request: ConversationIdentityRequest,
  ) => Promise<ConversationOpenContext>;
  listConversations: () => Promise<ConversationDescriptor[]>;
  listGlobalTasks: () => Promise<GlobalTaskProjection[]>;
  createProjectDesignFile: (
    request: CreateProjectDesignFileRequest,
  ) => Promise<ProjectDesignFile>;
  readProjectDesignFile: (
    request: ProjectDesignFileRequest,
  ) => Promise<ProjectDesignFile>;
  saveProjectDesignFile: (
    request: SaveProjectDesignFileRequest,
  ) => Promise<ProjectDesignFile>;
  renameProjectDesignFile: (
    request: RenameProjectDesignFileRequest,
  ) => Promise<DesignFileDescriptor>;
  publishProjectLibrary: (
    request: PublishProjectLibraryRequest,
  ) => Promise<PublishProjectLibraryResult>;
  listProjectLibraries: (
    request: ListProjectLibrariesRequest,
  ) => Promise<ProjectLibraryCatalog>;
  readProjectLibraryRelease: (
    request: ReadProjectLibraryReleaseRequest,
  ) => Promise<LibraryReleaseSnapshot>;
  setProjectLibraryEnabled: (
    request: SetProjectLibraryEnabledRequest,
  ) => Promise<ProjectLibraryCatalog>;
  setProjectLibraryUpdateIgnored: (
    request: SetProjectLibraryUpdateIgnoredRequest,
  ) => Promise<ProjectLibraryCatalog>;
  setProjectLibraryUpdateAccepted: (
    request: SetProjectLibraryUpdateAcceptedRequest,
  ) => Promise<ProjectLibraryCatalog>;
  sendAgentRequest: (request: AgentRequest) => Promise<AgentRequestResult>;
  onAgentEvent: (listener: (event: AgentEvent) => void) => () => void;
}

export const channels = {
  getPendingDiagnostics: "diagnostic:get-pending",
  reportDiagnostic: "diagnostic:report",
  diagnosticEvent: "diagnostic:event",
  openSettings: "settings:open",
  importSvgCommand: "svg:import-command",
  exportSvgCommand: "svg:export-command",
  getLocale: "locale:get",
  setLocale: "locale:set",
  localeChanged: "locale:changed",
  getTheme: "theme:get",
  setTheme: "theme:set",
  themeChanged: "theme:changed",
  getModelProviderCatalog: "model-provider:get-catalog",
  getGlobalImageGenerationSettings: "image-generation:get-settings",
  saveGlobalImageGenerationSettings: "image-generation:save-settings",
  saveModelProviderProfile: "model-provider:save-profile",
  saveVisualCriticSelection: "model-provider:save-visual-critic-selection",
  deleteModelProviderProfile: "model-provider:delete-profile",
  testModelProviderConnection: "model-provider:test-connection",
  modelProviderCatalogChanged: "model-provider:catalog-changed",
  selectAgentAttachments: "agent-attachment:select",
  importAgentAttachments: "agent-attachment:import",
  getAgentAttachmentPreview: "agent-attachment:preview",
  selectDesignImage: "design-image:select",
  editDesignImage: "design-image:edit",
  cancelDesignImageEdit: "design-image:edit-cancel",
  selectFontBinaries: "font-binary:select",
  listFontBinaries: "font-binary:list",
  readFontBinary: "font-binary:read",
  designToolRequest: "design-tool:request",
  designToolCancel: "design-tool:cancel",
  designToolProgress: "design-tool:progress",
  resolveDesignToolRequest: "design-tool:resolve",
  windowAction: "window:action",
  openDesignFile: "design-file:open",
  saveDesignFile: "design-file:save",
  openSvgFile: "svg-file:open",
  saveSvgFile: "svg-file:save",
  saveRasterFile: "raster-file:save",
  createProject: "project:create",
  openProject: "project:open",
  openRecentProject: "project:open-recent",
  listRecentProjects: "project:list-recent",
  removeRecentProject: "project:remove-recent",
  revealRecentProject: "project:reveal-recent",
  listOpenProjects: "project:list-open",
  createConversation: "conversation:create",
  deleteConversation: "conversation:delete",
  resolveConversationOpenContext: "conversation:resolve-open-context",
  listConversations: "conversation:list",
  listGlobalTasks: "task:list-global",
  createProjectDesignFile: "project:design-file:create",
  readProjectDesignFile: "project:design-file:read",
  saveProjectDesignFile: "project:design-file:save",
  renameProjectDesignFile: "project:design-file:rename",
  publishProjectLibrary: "project:library:publish",
  listProjectLibraries: "project:library:list",
  readProjectLibraryRelease: "project:library:read-release",
  setProjectLibraryEnabled: "project:library:set-enabled",
  setProjectLibraryUpdateIgnored: "project:library:set-update-ignored",
  setProjectLibraryUpdateAccepted: "project:library:set-update-accepted",
  agentRequest: "agent:request",
  agentEvent: "agent:event",
} as const;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function isLocalePreference(value: unknown): value is AppLocale {
  return isAppLocale(value);
}

export function isWindowAction(value: unknown): value is WindowAction {
  return (
    value === "minimize" || value === "toggle-maximize" || value === "close"
  );
}

export function isCreateConversationRequest(
  value: unknown,
): value is CreateConversationRequest {
  return CreateConversationRequestContract.parse(value).ok;
}

export function isDeleteConversationRequest(
  value: unknown,
): value is DeleteConversationRequest {
  return ConversationIdentityRequestContract.parse(value).ok;
}

export function isConversationDescriptorResult(
  value: unknown,
): value is ConversationDescriptor {
  return ConversationDescriptorContract.parse(value).ok;
}

export function isConversationOpenContext(
  value: unknown,
): value is ConversationOpenContext {
  return ConversationOpenContextContract.parse(value).ok;
}

export function isGlobalTaskProjectionResult(
  value: unknown,
): value is GlobalTaskProjection {
  return isGlobalTaskProjection(value);
}
