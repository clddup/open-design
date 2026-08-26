import type { AgentEvent, AgentRequest } from "@opendesign/agent-contracts";
import {
  isDesignDocument,
  type DesignDocument,
  type LibraryReleaseSnapshot,
} from "@opendesign/design-contracts";
import {
  isConversationDescriptor,
  isDesignTarget,
  isDesignFileDescriptor,
  isGlobalTaskProjection,
  isProjectManifest,
  isStableId,
  type ConversationDescriptor,
  type DesignFileDescriptor,
  type DesignTarget,
  type GlobalTaskProjection,
  type ProjectManifest,
} from "@opendesign/workspace-contracts";
import { isAppLocale, type AppLocale } from "./i18n/locale";
import type {
  RendererDesignToolRequest,
  RendererDesignToolCancel,
  RendererDesignToolProgress,
  RendererDesignToolResponse,
} from "./design-tool-bridge";
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
  isTestModelProviderConnectionRequest,
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
  type TestModelProviderConnectionRequest,
} from "./provider-config-contract";
import type {
  DeleteModelProviderProfileRequest,
  GlobalImageGenerationSettings,
  ModelProviderCatalog,
  ProviderConnectionResult,
  SaveGlobalImageGenerationSettingsRequest,
  SaveModelProviderProfileRequest,
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

export type PlatformInfo = { platform: NodeJS.Platform; version: string };

export type WindowAction = "minimize" | "toggle-maximize" | "close";

export type CreateProjectRequest = {
  projectId: string;
};

export type OpenRecentProjectRequest = {
  projectId: string;
};

export type RecentProject = {
  projectId: string;
  name: string;
  lastOpenedAt: string;
};

export type CreateConversationRequest = {
  conversationId: string;
  filedProjectId: string;
  title: string;
};

export type DeleteConversationRequest = {
  conversationId: string;
};

export type ConversationOpenContext =
  | {
      kind: "target-available";
      conversationId: string;
      source: "active-task" | "recent-task" | "filed-project";
      target: DesignTarget;
    }
  | {
      kind: "target-unavailable";
      conversationId: string;
      reason:
        | "project-unavailable"
        | "design-file-unavailable"
        | "page-unavailable"
        | "no-target";
      target?: DesignTarget;
    };

export type CreateProjectDesignFileRequest = {
  projectId: string;
  descriptor: DesignFileDescriptor;
  document: DesignDocument;
};

export type ProjectDesignFileRequest = {
  projectId: string;
  designFileId: string;
};

export type SaveProjectDesignFileRequest = ProjectDesignFileRequest & {
  document: DesignDocument;
};

export type RenameProjectDesignFileRequest = ProjectDesignFileRequest & {
  name: string;
};

export type ProjectDesignFile = {
  descriptor: DesignFileDescriptor;
  document: DesignDocument;
};

export interface DesktopApi {
  getPlatformInfo: () => Promise<PlatformInfo>;
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
    request: DeleteConversationRequest,
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
  sendAgentRequest: (request: AgentRequest) => Promise<void>;
  onAgentEvent: (listener: (event: AgentEvent) => void) => () => void;
}

export const channels = {
  platformInfo: "app:platform-info",
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

export function isCreateProjectRequest(
  value: unknown,
): value is CreateProjectRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return isStableId(request.projectId) && hasExactKeys(request, ["projectId"]);
}

export function isOpenRecentProjectRequest(
  value: unknown,
): value is OpenRecentProjectRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return isStableId(request.projectId) && hasExactKeys(request, ["projectId"]);
}

export function isCreateConversationRequest(
  value: unknown,
): value is CreateConversationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    isStableId(request.conversationId) &&
    isStableId(request.filedProjectId) &&
    isTitle(request.title) &&
    hasExactKeys(request, ["conversationId", "filedProjectId", "title"])
  );
}

export function isDeleteConversationRequest(
  value: unknown,
): value is DeleteConversationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    isStableId(request.conversationId) &&
    hasExactKeys(request, ["conversationId"])
  );
}

export function isConversationDescriptorResult(
  value: unknown,
): value is ConversationDescriptor {
  return isConversationDescriptor(value);
}

export function isConversationOpenContext(
  value: unknown,
): value is ConversationOpenContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  if (
    !isStableId(context.conversationId) ||
    (context.kind !== "target-available" &&
      context.kind !== "target-unavailable")
  ) {
    return false;
  }
  if (context.kind === "target-available") {
    return (
      (context.source === "active-task" ||
        context.source === "recent-task" ||
        context.source === "filed-project") &&
      isDesignTarget(context.target) &&
      hasExactKeys(context, ["kind", "conversationId", "source", "target"])
    );
  }
  const reason = context.reason;
  return (
    (reason === "project-unavailable" ||
      reason === "design-file-unavailable" ||
      reason === "page-unavailable" ||
      reason === "no-target") &&
    (context.target === undefined || isDesignTarget(context.target)) &&
    hasExactKeys(
      context,
      context.target === undefined
        ? ["kind", "conversationId", "reason"]
        : ["kind", "conversationId", "reason", "target"],
    )
  );
}

export function isGlobalTaskProjectionResult(
  value: unknown,
): value is GlobalTaskProjection {
  return isGlobalTaskProjection(value);
}

export function isCreateProjectDesignFileRequest(
  value: unknown,
): value is CreateProjectDesignFileRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    isStableId(request.projectId) &&
    isDesignFileDescriptor(request.descriptor) &&
    isDesignDocument(request.document) &&
    request.descriptor.documentId === request.document.documentId &&
    hasExactKeys(request, ["projectId", "descriptor", "document"])
  );
}

export function isProjectDesignFileRequest(
  value: unknown,
): value is ProjectDesignFileRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    isStableId(request.projectId) &&
    isStableId(request.designFileId) &&
    hasExactKeys(request, ["projectId", "designFileId"])
  );
}

export function isSaveProjectDesignFileRequest(
  value: unknown,
): value is SaveProjectDesignFileRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    isStableId(request.projectId) &&
    isStableId(request.designFileId) &&
    isDesignDocument(request.document) &&
    hasExactKeys(request, ["projectId", "designFileId", "document"])
  );
}

export function isRenameProjectDesignFileRequest(
  value: unknown,
): value is RenameProjectDesignFileRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    isStableId(request.projectId) &&
    isStableId(request.designFileId) &&
    isDisplayName(request.name) &&
    request.name === request.name.trim() &&
    hasExactKeys(request, ["projectId", "designFileId", "name"])
  );
}

export function isProjectDesignFile(
  value: unknown,
): value is ProjectDesignFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Record<string, unknown>;
  return (
    isDesignFileDescriptor(file.descriptor) &&
    isDesignDocument(file.document) &&
    file.descriptor.documentId === file.document.documentId &&
    hasExactKeys(file, ["descriptor", "document"])
  );
}

export function isDesignFileDescriptorResult(
  value: unknown,
): value is DesignFileDescriptor {
  return isDesignFileDescriptor(value);
}

export function isRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Record<string, unknown>;
  return (
    isStableId(project.projectId) &&
    isDisplayName(project.name) &&
    typeof project.lastOpenedAt === "string" &&
    Number.isFinite(Date.parse(project.lastOpenedAt)) &&
    hasExactKeys(project, ["projectId", "name", "lastOpenedAt"])
  );
}

export function isProjectManifestResult(
  value: unknown,
): value is ProjectManifest {
  return isProjectManifest(value);
}

function isDisplayName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !hasControlCharacter(value)
  );
}

function isTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2_000 &&
    !hasControlCharacter(value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}
