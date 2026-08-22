import type {
  AgentAttachment,
  AgentEvent,
  AgentRequest,
} from "@opendesign/agent-contracts";
import type {
  ModelApiFormat,
  ModelAuthMode,
  ModelReasoningEffort,
  ModelSelection,
} from "@opendesign/model-gateway";
import { SVG_MAX_CHARACTERS } from "@opendesign/import-export-service/limits";
import {
  RASTER_EXPORT_MAX_ENCODED_BYTES,
  isRasterExportFormat,
  rasterExportMimeType,
  type RasterExportFormat,
  type RasterExportMimeType,
} from "@opendesign/import-export-service/raster";
import {
  isDesignAsset,
  isImageAssetDerivation,
  isImagePlacement,
  isDesignDocument,
  type DesignAsset,
  type ImageAssetDerivation,
  type ImagePlacement,
  type Size,
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
import type {
  ProfessionalFixtureSmokeBootstrap,
  ProfessionalFixtureSmokeResult,
} from "./professional-fixture-smoke";
import { isAppLocale, type AppLocale } from "./i18n/locale";
import type {
  RendererDesignToolRequest,
  RendererDesignToolCancel,
  RendererDesignToolProgress,
  RendererDesignToolResponse,
} from "./design-tool-bridge";
import type { DiagnosticEvent, RendererDiagnosticReport } from "./diagnostics";
import { isPortableFileName } from "./portable-file-name";
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
  isProviderConnectionResult,
  type ProviderConnectionResult,
} from "./provider-connection";
import type { ProviderConnectionResult } from "./provider-connection";
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
  DEFAULT_APP_LOCALE,
  isAppLocale,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "./i18n/locale";

export type ThemePreference = "light" | "dark" | "system";

export type PlatformInfo = { platform: NodeJS.Platform; version: string };

export type WindowAction = "minimize" | "toggle-maximize" | "close";

export type OpenDesignFile = {
  name: string;
  contents: string;
};

export type SaveDesignFileRequest = {
  suggestedName: string;
  contents: string;
  saveAs?: boolean;
};

export type SaveDesignFileResult = { name: string };

export type OpenSvgFile = {
  name: string;
  contents: string;
};

export type SaveSvgFileRequest = {
  suggestedName: string;
  contents: string;
};

export type SaveSvgFileResult = {
  name: string;
};

export type SaveRasterFileRequest = {
  suggestedName: string;
  format: RasterExportFormat;
  mimeType: RasterExportMimeType;
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type SaveRasterFileResult = {
  name: string;
  byteSize: number;
};

export const MODEL_PROVIDER_CATALOG_VERSION = 3 as const;
export const GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION = 1 as const;

export type ImageGenerationApiFormat = "openai-images";

export type ModelCapabilities = {
  toolUse: boolean;
  imageInput: boolean;
  reasoning: boolean;
};

export type ModelProfile = {
  modelId: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  reasoningEfforts: ModelReasoningEffort[];
};

export type ModelProviderProfile = {
  providerId: string;
  name: string;
  enabled: boolean;
  apiFormat: ModelApiFormat;
  authMode: ModelAuthMode;
  baseUrl: string;
  models: ModelProfile[];
  hasApiKey: boolean;
  updatedAt: string | null;
};

export type ModelProviderCatalog = {
  version: typeof MODEL_PROVIDER_CATALOG_VERSION;
  providers: ModelProviderProfile[];
  defaultSelection?: ModelSelection;
};

export type SaveModelProviderProfileRequest = {
  providerId: string;
  name: string;
  enabled: boolean;
  apiFormat: ModelApiFormat;
  authMode: ModelAuthMode;
  baseUrl: string;
  models: ModelProfile[];
  apiKey?: string;
  clearApiKey?: boolean;
  setAsDefault?: boolean;
};

export type DeleteModelProviderProfileRequest = { providerId: string };

export type GlobalImageGenerationSettings = {
  version: typeof GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION;
  enabled: boolean;
  apiFormat: ImageGenerationApiFormat;
  authMode: ModelAuthMode;
  baseUrl: string;
  modelId: string;
  hasApiKey: boolean;
  updatedAt: string | null;
};

export type SaveGlobalImageGenerationSettingsRequest = {
  enabled: boolean;
  apiFormat: ImageGenerationApiFormat;
  authMode: ModelAuthMode;
  baseUrl: string;
  modelId: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

export type TestModelProviderConnectionRequest = ModelSelection;

export type AgentAttachmentSelection = AgentAttachment & {
  previewDataUrl?: string;
};

export type AgentAttachmentImport = {
  name: string;
  bytes: Uint8Array;
};

export type AgentAttachmentPreviewRequest = { attachmentId: string };

export type AgentAttachmentPreviewResult = AgentAttachmentPreviewRequest & {
  previewDataUrl: string | null;
};

export type DesignImageSelection = {
  asset: DesignAsset;
};

export type DesignImageAreaSelection = {
  points: Array<{ x: number; y: number }>;
};

export type DesignImageExpansion = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type DesignImageEditAction =
  | "remove-background"
  | "prompt-edit"
  | "erase-object"
  | "isolate-object"
  | "expand"
  | "upscale";

type DesignImageEditRequestBase = {
  requestId: string;
  pageId: string;
  nodeId: string;
  expectedAssetId: string;
  source: DesignAsset;
};

export type DesignImageEditRequest = DesignImageEditRequestBase &
  (
    | { action: "remove-background" }
    | { action: "upscale" }
    | {
        action: "prompt-edit";
        prompt: string;
        reference?: DesignAsset;
      }
    | {
        action: "erase-object" | "isolate-object";
        selection: DesignImageAreaSelection;
      }
    | {
        action: "expand";
        expansion: DesignImageExpansion;
        placement: ImagePlacement;
        targetSize: Size;
      }
  );

export type DesignImageEditResult = {
  requestId: string;
  action: DesignImageEditAction;
  sourceAssetId: string;
  asset: DesignAsset;
  derivation: ImageAssetDerivation;
  supportingAssets?: DesignAsset[];
};

export type CancelDesignImageEditRequest = { requestId: string };

export type CreateProjectRequest = {
  projectId: string;
  name: string;
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
  getProfessionalFixtureSmoke: () => Promise<ProfessionalFixtureSmokeBootstrap | null>;
  reportProfessionalFixtureSmoke: (
    result: ProfessionalFixtureSmokeResult,
  ) => Promise<void>;
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
  professionalFixtureSmokeGet: "professional-fixture-smoke:get",
  professionalFixtureSmokeReport: "professional-fixture-smoke:report",
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

export function isAgentAttachmentPreviewRequest(
  value: unknown,
): value is AgentAttachmentPreviewRequest {
  return (
    isRecord(value) &&
    isAgentAttachmentId(value.attachmentId) &&
    Object.keys(value).every((key) => key === "attachmentId")
  );
}

export function isAgentAttachmentSelection(
  value: unknown,
): value is AgentAttachmentSelection {
  if (!isRecord(value) || !isAgentAttachment(value)) return false;
  const preview = value.previewDataUrl;
  const isImage = value.attachmentId.startsWith("image_");
  return (
    (isImage
      ? typeof preview === "string" &&
        preview.startsWith(`data:${value.mimeType};base64,`) &&
        preview.length <= 24_000_000
      : preview === undefined) &&
    Object.keys(value).every((key) =>
      [
        "attachmentId",
        "name",
        "mimeType",
        "byteSize",
        "previewDataUrl",
      ].includes(key),
    )
  );
}

export function isAgentAttachmentImport(
  value: unknown,
): value is AgentAttachmentImport {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 255 &&
    value.bytes instanceof Uint8Array &&
    value.bytes.byteLength > 0 &&
    value.bytes.byteLength <= 16 * 1024 * 1024 &&
    Object.keys(value).every((key) => key === "name" || key === "bytes")
  );
}

export function isAgentAttachmentPreviewResult(
  value: unknown,
): value is AgentAttachmentPreviewResult {
  return (
    isRecord(value) &&
    isAgentAttachmentId(value.attachmentId) &&
    (value.previewDataUrl === null ||
      (typeof value.previewDataUrl === "string" &&
        /^data:image\/(png|jpeg|webp|gif);base64,/.test(value.previewDataUrl) &&
        value.previewDataUrl.length <= 24_000_000)) &&
    Object.keys(value).every((key) =>
      ["attachmentId", "previewDataUrl"].includes(key),
    )
  );
}

export function isDesignImageSelection(
  value: unknown,
): value is DesignImageSelection {
  if (!isRecord(value) || !isDesignAsset(value.asset)) return false;
  const { asset } = value;
  return (
    asset.kind === "image" &&
    /^asset_[a-f0-9]{64}$/.test(asset.id) &&
    asset.source.type === "data" &&
    asset.source.value.length > 0 &&
    asset.source.value.length <= 24_000_000 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(asset.source.value) &&
    asset.size !== undefined &&
    asset.size.width > 0 &&
    asset.size.height > 0 &&
    Object.keys(value).every((key) => key === "asset")
  );
}

export function isDesignImageEditRequest(
  value: unknown,
): value is DesignImageEditRequest {
  if (!(
    isRecord(value) &&
    isStableId(value.requestId) &&
    isStableId(value.pageId) &&
    isStableId(value.nodeId) &&
    isStableId(value.expectedAssetId) &&
    isEmbeddedEditableImageAsset(value.source) &&
    value.source.id === value.expectedAssetId
  )) {
    return false;
  }
  if (value.action === "remove-background" || value.action === "upscale") {
    return hasExactKeys(value, [
      "requestId",
      "action",
      "pageId",
      "nodeId",
      "expectedAssetId",
      "source",
    ]);
  }
  if (value.action === "erase-object" || value.action === "isolate-object") {
    return (
      isDesignImageAreaSelection(value.selection) &&
      hasExactKeys(value, [
        "requestId",
        "action",
        "pageId",
        "nodeId",
        "expectedAssetId",
        "source",
        "selection",
      ])
    );
  }
  if (value.action === "expand") {
    return (
      isDesignImageExpansion(value.expansion) &&
      isImagePlacement(value.placement) &&
      isPositiveSize(value.targetSize) &&
      hasExactKeys(value, [
        "requestId",
        "action",
        "pageId",
        "nodeId",
        "expectedAssetId",
        "source",
        "expansion",
        "placement",
        "targetSize",
      ])
    );
  }
  return (
    value.action === "prompt-edit" &&
    typeof value.prompt === "string" &&
    value.prompt.trim().length > 0 &&
    value.prompt.length <= 32_000 &&
    (value.reference === undefined ||
      (isEmbeddedEditableImageAsset(value.reference) &&
        value.reference.id !== value.source.id)) &&
    hasExactKeys(value, [
      "requestId",
      "action",
      "pageId",
      "nodeId",
      "expectedAssetId",
      "source",
      "prompt",
      ...(value.reference === undefined ? [] : ["reference"]),
    ])
  );
}

export function isDesignImageEditResult(
  value: unknown,
): value is DesignImageEditResult {
  if (
    !isRecord(value) ||
    !isStableId(value.requestId) ||
    (value.action !== "remove-background" &&
      value.action !== "prompt-edit" &&
      value.action !== "erase-object" &&
      value.action !== "isolate-object" &&
      value.action !== "expand" &&
      value.action !== "upscale") ||
    !isStableId(value.sourceAssetId) ||
    !isEmbeddedEditableImageAsset(value.asset) ||
    !isImageAssetDerivation(value.derivation) ||
    value.derivation.sourceAssetId !== value.sourceAssetId ||
    value.derivation.resultAssetId !== value.asset.id ||
    value.derivation.operation !== value.action
  ) {
    return false;
  }
  const asset = value.asset;
  const derivation = value.derivation;
  const supportingAssets = value.supportingAssets ?? [];
  const derivationInputIds = [
    ...derivation.referenceAssetIds,
    ...(derivation.maskAssetId ? [derivation.maskAssetId] : []),
  ];
  if (
    !Array.isArray(supportingAssets) ||
    supportingAssets.length > 1 ||
    !supportingAssets.every(isEmbeddedEditableImageAsset) ||
    supportingAssets.some(
      (supportingAsset) =>
        supportingAsset.id === value.sourceAssetId ||
        supportingAsset.id === asset.id,
    ) ||
    supportingAssets.length !== derivationInputIds.length ||
    supportingAssets.some(
      (supportingAsset, index) =>
        supportingAsset.id !== derivationInputIds[index],
    )
  ) {
    return false;
  }
  if (
    value.action === "remove-background" &&
    (supportingAssets.length !== 0 ||
      derivation.prompt !== undefined ||
      derivation.maskAssetId !== undefined)
  ) {
    return false;
  }
  if (
    value.action === "upscale" &&
    (supportingAssets.length !== 0 ||
      derivation.prompt !== undefined ||
      derivation.maskAssetId !== undefined ||
      derivation.referenceAssetIds.length !== 0 ||
      value.asset.mimeType !== "image/png")
  ) {
    return false;
  }
  if (
    value.action === "prompt-edit" &&
    (typeof derivation.prompt !== "string" ||
      derivation.prompt.trim().length === 0 ||
      derivation.maskAssetId !== undefined)
  ) {
    return false;
  }
  if (
    (value.action === "erase-object" ||
      value.action === "isolate-object" ||
      value.action === "expand") &&
    (typeof derivation.prompt !== "string" ||
      derivation.prompt.trim().length === 0 ||
      derivation.referenceAssetIds.length !== 0 ||
      supportingAssets.length !== 1 ||
      supportingAssets[0]?.mimeType !== "image/png" ||
      derivation.maskAssetId !== supportingAssets[0]?.id ||
      (value.action === "expand" && value.asset.mimeType !== "image/png"))
  ) {
    return false;
  }
  return hasExactKeys(value, [
    "requestId",
    "action",
    "sourceAssetId",
    "asset",
    "derivation",
    ...(value.supportingAssets === undefined ? [] : ["supportingAssets"]),
  ]);
}

export function isDesignImageAreaSelection(
  value: unknown,
): value is DesignImageAreaSelection {
  return (
    isRecord(value) &&
    Array.isArray(value.points) &&
    value.points.length >= 3 &&
    value.points.length <= 512 &&
    value.points.every(
      (point) =>
        isRecord(point) &&
        typeof point.x === "number" &&
        Number.isFinite(point.x) &&
        point.x >= 0 &&
        point.x <= 1 &&
        typeof point.y === "number" &&
        Number.isFinite(point.y) &&
        point.y >= 0 &&
        point.y <= 1 &&
        hasExactKeys(point, ["x", "y"]),
    ) &&
    hasExactKeys(value, ["points"])
  );
}

export function isDesignImageExpansion(
  value: unknown,
): value is DesignImageExpansion {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["top", "right", "bottom", "left"])
  ) {
    return false;
  }
  const values = [value.top, value.right, value.bottom, value.left];
  return (
    values.some(
      (candidate) => typeof candidate === "number" && candidate > 0,
    ) &&
    values.every(
      (candidate) =>
        typeof candidate === "number" &&
        Number.isFinite(candidate) &&
        candidate >= 0 &&
        candidate <= 1_000_000,
    )
  );
}

function isPositiveSize(value: unknown): value is Size {
  return (
    isRecord(value) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.height > 0 &&
    hasExactKeys(value, ["width", "height"])
  );
}

export function isCancelDesignImageEditRequest(
  value: unknown,
): value is CancelDesignImageEditRequest {
  return (
    isRecord(value) &&
    isStableId(value.requestId) &&
    hasExactKeys(value, ["requestId"])
  );
}

function isEmbeddedEditableImageAsset(value: unknown): value is DesignAsset {
  return (
    isDesignAsset(value) &&
    value.kind === "image" &&
    /^asset_[a-f0-9]{64}$/.test(value.id) &&
    (value.mimeType === "image/png" ||
      value.mimeType === "image/jpeg" ||
      value.mimeType === "image/webp") &&
    value.source.type === "data" &&
    value.source.value.length > 0 &&
    value.source.value.length <= 24_000_000 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value.source.value) &&
    value.size !== undefined &&
    value.size.width > 0 &&
    value.size.height > 0
  );
}

export function isLocalePreference(value: unknown): value is AppLocale {
  return isAppLocale(value);
}

export function isModelProviderCatalog(
  value: unknown,
): value is ModelProviderCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const catalog = value as Record<string, unknown>;
  const allowedKeys = ["version", "providers", "defaultSelection"];
  const providers = catalog.providers;
  const defaultSelection = catalog.defaultSelection;
  return (
    catalog.version === MODEL_PROVIDER_CATALOG_VERSION &&
    Array.isArray(providers) &&
    providers.length <= 64 &&
    providers.every(isModelProviderProfile) &&
    new Set(providers.map((provider) => provider.providerId)).size ===
      providers.length &&
    (defaultSelection === undefined ||
      (isModelSelection(defaultSelection) &&
        providers.some(
          (provider) =>
            provider.enabled &&
            provider.providerId === defaultSelection.providerId &&
            provider.models.some(
              (model) =>
                model.modelId === defaultSelection.modelId &&
                model.capabilities.toolUse,
            ),
        ))) &&
    Object.keys(catalog).every((key) => allowedKeys.includes(key))
  );
}

export function migrateModelProviderCatalog(
  value: unknown,
): ModelProviderCatalog | null {
  if (isModelProviderCatalog(value)) return snapshotCatalog(value);
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) {
    return null;
  }
  if (!Array.isArray(value.providers) || value.providers.length > 64) {
    return null;
  }
  const providers = value.providers.map(
    value.version === 1 ? migrateV1Provider : migrateV2Provider,
  );
  if (providers.some((provider) => provider === null)) return null;
  const candidate = {
    version: MODEL_PROVIDER_CATALOG_VERSION,
    providers: providers as ModelProviderProfile[],
    ...(value.defaultSelection === undefined
      ? {}
      : { defaultSelection: value.defaultSelection }),
  };
  const allowedKeys =
    value.version === 1
      ? ["version", "providers", "defaultSelection"]
      : [
          "version",
          "providers",
          "defaultSelection",
          "defaultImageGenerationSelection",
        ];
  if (
    !Object.keys(value).every((key) => allowedKeys.includes(key)) ||
    !isModelProviderCatalog(candidate)
  ) {
    return null;
  }
  return snapshotCatalog(candidate);
}

export function isModelProviderProfile(
  value: unknown,
): value is ModelProviderProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return (
    isProviderId(profile.providerId) &&
    isDisplayName(profile.name) &&
    typeof profile.enabled === "boolean" &&
    isModelApiFormat(profile.apiFormat) &&
    isModelAuthMode(profile.authMode) &&
    isProviderBaseUrl(profile.baseUrl) &&
    Array.isArray(profile.models) &&
    profile.models.length <= 128 &&
    profile.models.every(isModelProfile) &&
    new Set(profile.models.map((model) => model.modelId)).size ===
      profile.models.length &&
    typeof profile.hasApiKey === "boolean" &&
    isNullableTimestamp(profile.updatedAt) &&
    Object.keys(profile).every((key) =>
      [
        "providerId",
        "name",
        "enabled",
        "apiFormat",
        "authMode",
        "baseUrl",
        "models",
        "hasApiKey",
        "updatedAt",
      ].includes(key),
    )
  );
}

export function isSaveModelProviderProfileRequest(
  value: unknown,
): value is SaveModelProviderProfileRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  const allowedKeys = [
    "providerId",
    "name",
    "enabled",
    "apiFormat",
    "authMode",
    "baseUrl",
    "models",
    "apiKey",
    "clearApiKey",
    "setAsDefault",
  ];
  return (
    isProviderId(request.providerId) &&
    isDisplayName(request.name) &&
    typeof request.enabled === "boolean" &&
    isModelApiFormat(request.apiFormat) &&
    isModelAuthMode(request.authMode) &&
    isProviderBaseUrl(request.baseUrl) &&
    Array.isArray(request.models) &&
    request.models.length > 0 &&
    request.models.length <= 128 &&
    request.models.every(isModelProfile) &&
    new Set(request.models.map((model) => model.modelId)).size ===
      request.models.length &&
    (request.apiKey === undefined || isApiKey(request.apiKey)) &&
    (request.clearApiKey === undefined ||
      typeof request.clearApiKey === "boolean") &&
    (request.setAsDefault === undefined ||
      typeof request.setAsDefault === "boolean") &&
    !(request.apiKey !== undefined && request.clearApiKey === true) &&
    Object.keys(request).every((key) => allowedKeys.includes(key))
  );
}

export function isDeleteModelProviderProfileRequest(
  value: unknown,
): value is DeleteModelProviderProfileRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    isProviderId(request.providerId) && hasExactKeys(request, ["providerId"])
  );
}

export function isModelSelection(value: unknown): value is ModelSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const selection = value as Record<string, unknown>;
  const allowedKeys = ["providerId", "modelId", "reasoningEffort"];
  return (
    isProviderId(selection.providerId) &&
    isModelName(selection.modelId, false) &&
    (selection.reasoningEffort === undefined ||
      isModelReasoningEffort(selection.reasoningEffort)) &&
    Object.keys(selection).every((key) => allowedKeys.includes(key))
  );
}

export const isTestModelProviderConnectionRequest = isModelSelection;

export function isGlobalImageGenerationSettings(
  value: unknown,
): value is GlobalImageGenerationSettings {
  if (!isRecord(value)) return false;
  return (
    value.version === GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION &&
    typeof value.enabled === "boolean" &&
    isImageGenerationApiFormat(value.apiFormat) &&
    isModelAuthMode(value.authMode) &&
    isProviderBaseUrl(value.baseUrl) &&
    isModelName(value.modelId, !value.enabled) &&
    typeof value.hasApiKey === "boolean" &&
    isNullableTimestamp(value.updatedAt) &&
    hasExactKeys(value, [
      "version",
      "enabled",
      "apiFormat",
      "authMode",
      "baseUrl",
      "modelId",
      "hasApiKey",
      "updatedAt",
    ])
  );
}

export function isSaveGlobalImageGenerationSettingsRequest(
  value: unknown,
): value is SaveGlobalImageGenerationSettingsRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.enabled === "boolean" &&
    isImageGenerationApiFormat(value.apiFormat) &&
    isModelAuthMode(value.authMode) &&
    isProviderBaseUrl(value.baseUrl) &&
    isModelName(value.modelId, !value.enabled) &&
    (value.apiKey === undefined || isApiKey(value.apiKey)) &&
    (value.clearApiKey === undefined ||
      typeof value.clearApiKey === "boolean") &&
    !(value.apiKey !== undefined && value.clearApiKey === true) &&
    Object.keys(value).every((key) =>
      [
        "enabled",
        "apiFormat",
        "authMode",
        "baseUrl",
        "modelId",
        "apiKey",
        "clearApiKey",
      ].includes(key),
    )
  );
}

export function normalizeProviderBaseUrl(value: string): string {
  const url = new URL(value.trim());
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function isWindowAction(value: unknown): value is WindowAction {
  return (
    value === "minimize" || value === "toggle-maximize" || value === "close"
  );
}

export function isSaveDesignFileRequest(
  value: unknown,
): value is SaveDesignFileRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.suggestedName === "string" &&
    request.suggestedName.length > 0 &&
    request.suggestedName.length <= 255 &&
    !request.suggestedName.includes("/") &&
    !request.suggestedName.includes("\\") &&
    !hasControlCharacter(request.suggestedName) &&
    typeof request.contents === "string" &&
    request.contents.length > 0 &&
    request.contents.length <= 64 * 1024 * 1024 &&
    (request.saveAs === undefined || typeof request.saveAs === "boolean") &&
    Object.keys(request).every((key) =>
      ["suggestedName", "contents", "saveAs"].includes(key),
    )
  );
}

export function isOpenSvgFile(value: unknown): value is OpenSvgFile {
  if (!isRecord(value)) return false;
  return (
    isSvgFileName(value.name) &&
    isBoundedSvgContents(value.contents) &&
    hasExactKeys(value, ["name", "contents"])
  );
}

export function isSaveSvgFileRequest(
  value: unknown,
): value is SaveSvgFileRequest {
  if (!isRecord(value)) return false;
  return (
    isSuggestedFileName(value.suggestedName) &&
    isBoundedSvgContents(value.contents) &&
    hasExactKeys(value, ["suggestedName", "contents"])
  );
}

export function isSaveSvgFileResult(
  value: unknown,
): value is SaveSvgFileResult {
  return (
    isRecord(value) &&
    isSvgFileName(value.name) &&
    hasExactKeys(value, ["name"])
  );
}

export function isSaveRasterFileRequest(
  value: unknown,
): value is SaveRasterFileRequest {
  if (!isRecord(value)) return false;
  return (
    isSuggestedFileName(value.suggestedName) &&
    isRasterExportFormat(value.format) &&
    value.mimeType === rasterExportMimeType(value.format) &&
    value.bytes instanceof Uint8Array &&
    value.bytes.byteLength > 0 &&
    value.bytes.byteLength <= RASTER_EXPORT_MAX_ENCODED_BYTES &&
    isRasterDimension(value.width) &&
    isRasterDimension(value.height) &&
    hasExactKeys(value, [
      "suggestedName",
      "format",
      "mimeType",
      "bytes",
      "width",
      "height",
    ])
  );
}

export function isSaveRasterFileResult(
  value: unknown,
): value is SaveRasterFileResult {
  return (
    isRecord(value) &&
    isSuggestedFileName(value.name) &&
    Number.isInteger(value.byteSize) &&
    Number(value.byteSize) > 0 &&
    Number(value.byteSize) <= RASTER_EXPORT_MAX_ENCODED_BYTES &&
    hasExactKeys(value, ["name", "byteSize"])
  );
}

export function isCreateProjectRequest(
  value: unknown,
): value is CreateProjectRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    isStableId(request.projectId) &&
    isDisplayName(request.name) &&
    hasExactKeys(request, ["projectId", "name"])
  );
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

function isProviderBaseUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048)
    return false;
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    return (
      (url.protocol === "https:" || localHttp) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isProviderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
  );
}

function isModelApiFormat(value: unknown): value is ModelApiFormat {
  return (
    value === "openai-responses" ||
    value === "openai-chat-completions" ||
    value === "anthropic-messages"
  );
}

function isImageGenerationApiFormat(
  value: unknown,
): value is ImageGenerationApiFormat {
  return value === "openai-images";
}

function isModelAuthMode(value: unknown): value is ModelAuthMode {
  return value === "bearer" || value === "x-api-key" || value === "none";
}

function isModelReasoningEffort(value: unknown): value is ModelReasoningEffort {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function isModelProfile(value: unknown): value is ModelProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  const capabilities = model.capabilities;
  return (
    isModelName(model.modelId, false) &&
    isDisplayName(model.name) &&
    Number.isInteger(model.contextWindow) &&
    (model.contextWindow as number) >= 1_024 &&
    (model.contextWindow as number) <= 10_000_000 &&
    Number.isInteger(model.maxOutputTokens) &&
    (model.maxOutputTokens as number) >= 1 &&
    (model.maxOutputTokens as number) <= 2_000_000 &&
    Boolean(capabilities) &&
    typeof capabilities === "object" &&
    !Array.isArray(capabilities) &&
    typeof (capabilities as Record<string, unknown>).toolUse === "boolean" &&
    typeof (capabilities as Record<string, unknown>).imageInput === "boolean" &&
    typeof (capabilities as Record<string, unknown>).reasoning === "boolean" &&
    hasExactKeys(capabilities as Record<string, unknown>, [
      "toolUse",
      "imageInput",
      "reasoning",
    ]) &&
    Array.isArray(model.reasoningEfforts) &&
    model.reasoningEfforts.length > 0 &&
    model.reasoningEfforts.length <= 7 &&
    model.reasoningEfforts.every(isModelReasoningEffort) &&
    new Set(model.reasoningEfforts).size === model.reasoningEfforts.length &&
    (capabilities as ModelCapabilities).reasoning ===
      model.reasoningEfforts.some((effort) => effort !== "off") &&
    hasExactKeys(model, [
      "modelId",
      "name",
      "contextWindow",
      "maxOutputTokens",
      "capabilities",
      "reasoningEfforts",
    ])
  );
}

function migrateV1Provider(value: unknown): ModelProviderProfile | null {
  if (!isRecord(value) || !Array.isArray(value.models)) return null;
  if (
    !hasExactKeys(value, [
      "providerId",
      "name",
      "enabled",
      "apiFormat",
      "authMode",
      "baseUrl",
      "models",
      "hasApiKey",
      "updatedAt",
    ])
  ) {
    return null;
  }
  const models = value.models.map(migrateV1Model);
  if (models.some((model) => model === null)) return null;
  const candidate = { ...value, models };
  return isModelProviderProfile(candidate) ? candidate : null;
}

function migrateV1Model(value: unknown): ModelProfile | null {
  if (!isRecord(value) || !isRecord(value.capabilities)) return null;
  if (
    !hasExactKeys(value, [
      "modelId",
      "name",
      "contextWindow",
      "maxOutputTokens",
      "capabilities",
      "reasoningEfforts",
    ]) ||
    !hasExactKeys(value.capabilities, ["toolUse", "imageInput", "reasoning"])
  ) {
    return null;
  }
  const candidate = { ...value, capabilities: { ...value.capabilities } };
  return isModelProfile(candidate) ? candidate : null;
}

function migrateV2Provider(value: unknown): ModelProviderProfile | null {
  if (!isRecord(value) || !Array.isArray(value.models)) return null;
  if (
    !Object.keys(value).every((key) =>
      [
        "providerId",
        "name",
        "enabled",
        "apiFormat",
        "imageGenerationApiFormat",
        "authMode",
        "baseUrl",
        "models",
        "hasApiKey",
        "updatedAt",
      ].includes(key),
    )
  ) {
    return null;
  }
  const models = value.models.map(migrateV2Model);
  if (models.some((model) => model === null)) return null;
  const candidate = {
    providerId: value.providerId,
    name: value.name,
    enabled: value.enabled,
    apiFormat: value.apiFormat,
    authMode: value.authMode,
    baseUrl: value.baseUrl,
    models,
    hasApiKey: value.hasApiKey,
    updatedAt: value.updatedAt,
  };
  return isModelProviderProfile(candidate) ? candidate : null;
}

function migrateV2Model(value: unknown): ModelProfile | null {
  if (!isRecord(value) || !isRecord(value.capabilities)) return null;
  if (
    !hasExactKeys(value, [
      "modelId",
      "name",
      "contextWindow",
      "maxOutputTokens",
      "capabilities",
      "reasoningEfforts",
    ]) ||
    !hasExactKeys(value.capabilities, [
      "toolUse",
      "imageInput",
      "imageGeneration",
      "reasoning",
    ])
  ) {
    return null;
  }
  const candidate = {
    ...value,
    capabilities: {
      toolUse: value.capabilities.toolUse,
      imageInput: value.capabilities.imageInput,
      reasoning: value.capabilities.reasoning,
    },
  };
  return isModelProfile(candidate) ? candidate : null;
}

function snapshotCatalog(catalog: ModelProviderCatalog): ModelProviderCatalog {
  return {
    ...catalog,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      models: provider.models.map((model) => ({
        ...model,
        capabilities: { ...model.capabilities },
        reasoningEfforts: [...model.reasoningEfforts],
      })),
    })),
    ...(catalog.defaultSelection === undefined
      ? {}
      : { defaultSelection: { ...catalog.defaultSelection } }),
  };
}

function isNullableTimestamp(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)))
  );
}

function isModelName(value: unknown, allowEmpty: boolean): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= 256 &&
    !hasControlCharacter(value)
  );
}

function isApiKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 8_192 &&
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

function isBoundedSvgContents(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return value.length > 0 && value.length <= SVG_MAX_CHARACTERS;
}

function isSuggestedFileName(value: unknown): value is string {
  return isPortableFileName(value);
}

function isSvgFileName(value: unknown): value is string {
  return isSuggestedFileName(value) && value.toLowerCase().endsWith(".svg");
}

function isRasterDimension(value: unknown): value is number {
  return (
    Number.isInteger(value) && Number(value) > 0 && Number(value) <= 16_384
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAgentAttachmentId(value: unknown): value is string {
  return (
    typeof value === "string" && /^(image|file|svg)_[a-f0-9]{64}$/.test(value)
  );
}

function isAgentAttachment(
  value: Record<string, unknown>,
): value is Record<string, unknown> & AgentAttachment {
  const imageMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const documentMimeTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/html",
    "application/json",
    "application/yaml",
  ];
  const kind =
    typeof value.attachmentId !== "string"
      ? null
      : value.attachmentId.startsWith("image_")
        ? "image"
        : value.attachmentId.startsWith("file_")
          ? "document"
          : value.attachmentId.startsWith("svg_")
            ? "svg"
            : null;
  return (
    isAgentAttachmentId(value.attachmentId) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 255 &&
    (kind === "image"
      ? imageMimeTypes.includes(String(value.mimeType))
      : kind === "document"
        ? documentMimeTypes.includes(String(value.mimeType))
        : value.mimeType === "image/svg+xml") &&
    Number.isInteger(value.byteSize) &&
    Number(value.byteSize) > 0 &&
    Number(value.byteSize) <= 16 * 1024 * 1024
  );
}
