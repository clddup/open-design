import type {
  ConversationDescriptor,
  DesignTarget,
} from "@opendesign/workspace-contracts";
import {
  ConversationDescriptorContract,
  ConversationDescriptorListContract,
  ConversationIdentityRequestContract,
  CreateConversationRequestContract,
} from "@opendesign/workspace-contracts";
import { basename } from "node:path";
import {
  CreateProjectRequestContract,
  OpenRecentProjectRequestContract,
  ProjectManifestListContract,
  ProjectManifestResponseContract,
  RecentProjectListContract,
} from "@/shared/project-file-contract.js";
import { requireContract } from "@/main/contract-parser.js";
import { ConversationOpenContextContract } from "@/shared/conversation-contract.js";
import {
  isListProjectLibrariesRequest,
  isPublishProjectLibraryRequest,
  isReadProjectLibraryReleaseRequest,
  isSetProjectLibraryEnabledRequest,
  isSetProjectLibraryUpdateAcceptedRequest,
  isSetProjectLibraryUpdateIgnoredRequest,
} from "@/shared/project-library-contract.js";
import { createStarterProjectFiles } from "@/shared/project/starter-project.js";
import { ProjectFileIpcService } from "./project-file-ipc-service.js";
import { ProjectHostError, type ProjectHost } from "./project-host.js";
import type { WorkspaceStore } from "./workspace-store.js";

export type ProjectDirectoryPurpose = "create" | "open";
export type SelectProjectDirectory = (
  purpose: ProjectDirectoryPurpose,
) => Promise<string | null>;
export type RevealProjectDirectory = (rootPath: string) => void;
export type HasActiveConversationRun = (conversationId: string) => boolean;

export class ProjectIpcService {
  readonly #projectFiles: ProjectFileIpcService;

  constructor(
    private readonly projectHost: ProjectHost,
    private readonly workspaceStore: WorkspaceStore,
    private readonly selectProjectDirectory: SelectProjectDirectory,
    private readonly revealProjectDirectory: RevealProjectDirectory = () =>
      undefined,
    private readonly hasActiveConversationRun: HasActiveConversationRun = () =>
      false,
  ) {
    this.#projectFiles = new ProjectFileIpcService(projectHost);
  }

  async createProject(request: unknown) {
    const canonicalRequest = requireContract(
      CreateProjectRequestContract,
      request,
      "Project create request",
    );
    const rootPath = await this.selectProjectDirectory("create");
    if (!rootPath) return null;
    try {
      const project = {
        ...canonicalRequest,
        name: basename(rootPath),
      };
      const result = await this.projectHost.createProject(
        rootPath,
        project,
        createStarterProjectFiles(canonicalRequest.projectId),
      );
      return requireContract(
        ProjectManifestResponseContract,
        result,
        "Project create response",
      );
    } catch (error) {
      if (
        error instanceof ProjectHostError &&
        error.code === "PROJECT_EXISTS"
      ) {
        return requireContract(
          ProjectManifestResponseContract,
          await this.projectHost.openProject(rootPath),
          "Project create response",
        );
      }
      throw error;
    }
  }

  async openProject() {
    const rootPath = await this.selectProjectDirectory("open");
    if (!rootPath) return null;
    return requireContract(
      ProjectManifestResponseContract,
      await this.projectHost.openProject(rootPath),
      "Project open response",
    );
  }

  async openRecentProject(request: unknown) {
    const canonicalRequest = requireContract(
      OpenRecentProjectRequestContract,
      request,
      "Recent Project request",
    );
    return requireContract(
      ProjectManifestResponseContract,
      await this.projectHost.openRecentProject(canonicalRequest.projectId),
      "Recent Project response",
      { kind: "project", projectId: canonicalRequest.projectId },
    );
  }

  listRecentProjects() {
    return requireContract(
      RecentProjectListContract,
      this.workspaceStore.listRecentProjects(),
      "Recent Project list",
    );
  }

  removeRecentProject(request: unknown) {
    const canonicalRequest = requireContract(
      OpenRecentProjectRequestContract,
      request,
      "Recent Project remove request",
    );
    this.workspaceStore.hideProject(canonicalRequest.projectId);
    return this.listRecentProjects();
  }

  revealRecentProject(request: unknown) {
    const canonicalRequest = requireContract(
      OpenRecentProjectRequestContract,
      request,
      "Recent Project reveal request",
    );
    const rootPath = this.workspaceStore.getProjectRoot(
      canonicalRequest.projectId,
    );
    if (!rootPath) throw new Error("Recent Project is not registered");
    this.revealProjectDirectory(rootPath);
  }

  listOpenProjects() {
    return requireContract(
      ProjectManifestListContract,
      this.projectHost.listOpenProjects(),
      "Open Project list",
    );
  }

  createConversation(request: unknown) {
    const canonicalRequest = requireContract(
      CreateConversationRequestContract,
      request,
      "Conversation create request",
    );
    if (!this.workspaceStore.getProjectRoot(canonicalRequest.filedProjectId)) {
      throw new Error("Conversation Project is not registered");
    }
    const timestamp = new Date().toISOString();
    const conversation: ConversationDescriptor = {
      conversationId: canonicalRequest.conversationId,
      originProjectId: canonicalRequest.filedProjectId,
      filedProjectId: canonicalRequest.filedProjectId,
      title: canonicalRequest.title,
      createdAt: timestamp,
      updatedAt: timestamp,
      lifecycle: "active",
    };
    this.workspaceStore.createConversation(conversation);
    return requireContract(
      ConversationDescriptorContract,
      conversation,
      "Conversation create response",
      { kind: "create-response", request: canonicalRequest },
    );
  }

  deleteConversation(request: unknown) {
    const canonicalRequest = requireContract(
      ConversationIdentityRequestContract,
      request,
      "Conversation delete request",
    );
    const conversation = this.workspaceStore.getConversation(
      canonicalRequest.conversationId,
    );
    if (!conversation) throw new Error("Conversation does not exist");
    if (this.hasActiveConversationRun(conversation.conversationId)) {
      throw new Error("A Conversation with an active task cannot be deleted");
    }
    if (conversation.lifecycle === "deleted") {
      return requireContract(
        ConversationDescriptorContract,
        conversation,
        "Conversation delete response",
        {
          kind: "delete-response",
          conversationId: canonicalRequest.conversationId,
        },
      );
    }
    const deleted: ConversationDescriptor = {
      ...conversation,
      lifecycle: "deleted",
      updatedAt: new Date().toISOString(),
    };
    this.workspaceStore.saveConversation(deleted);
    return requireContract(
      ConversationDescriptorContract,
      deleted,
      "Conversation delete response",
      {
        kind: "delete-response",
        conversationId: canonicalRequest.conversationId,
      },
    );
  }

  listConversations() {
    const conversations = this.workspaceStore
      .listConversations()
      .filter((conversation) => conversation.lifecycle === "active");
    return requireContract(
      ConversationDescriptorListContract,
      conversations,
      "Conversation descriptor list",
    );
  }

  async resolveConversationOpenContext(request: unknown) {
    const canonicalRequest = requireContract(
      ConversationIdentityRequestContract,
      request,
      "Conversation open request",
    );
    const conversation = this.workspaceStore.getConversation(
      canonicalRequest.conversationId,
    );
    if (!conversation || conversation.lifecycle !== "active") {
      throw new Error("Conversation does not exist");
    }
    const validateContext = (value: unknown) =>
      requireContract(
        ConversationOpenContextContract,
        value,
        "Conversation open context",
        { conversationId: canonicalRequest.conversationId },
      );
    const tasks = this.workspaceStore
      .listGlobalTasks()
      .filter((task) => task.conversationId === conversation.conversationId);
    const activeTask = tasks.find((task) =>
      ["queued", "running", "waiting_approval"].includes(task.lifecycle),
    );
    const task = activeTask ?? tasks[0];
    if (task) {
      return validateContext(
        await this.#resolveConversationTarget(
          conversation.conversationId,
          task.targetSet.primaryTarget,
          activeTask ? "active-task" : "recent-task",
        ),
      );
    }
    if (!conversation.filedProjectId) {
      return validateContext({
        kind: "target-unavailable" as const,
        conversationId: conversation.conversationId,
        reason: "no-target" as const,
      });
    }
    let manifest;
    try {
      manifest = await this.projectHost.openRecentProject(
        conversation.filedProjectId,
      );
    } catch {
      return validateContext({
        kind: "target-unavailable" as const,
        conversationId: conversation.conversationId,
        reason: "project-unavailable" as const,
      });
    }
    const descriptor = manifest.designFiles.find(
      (file) => file.lifecycle === "active",
    );
    if (!descriptor) {
      return validateContext({
        kind: "target-unavailable" as const,
        conversationId: conversation.conversationId,
        reason: "design-file-unavailable" as const,
      });
    }
    const opened = await this.projectHost.readDesignFile(
      manifest.projectId,
      descriptor.designFileId,
    );
    const pageId = opened.document.pageOrder[0];
    if (!pageId) {
      return validateContext({
        kind: "target-unavailable" as const,
        conversationId: conversation.conversationId,
        reason: "page-unavailable" as const,
      });
    }
    const target: DesignTarget = {
      targetId: `resume_${conversation.conversationId}`,
      projectId: manifest.projectId,
      designFileId: descriptor.designFileId,
      documentId: descriptor.documentId,
      pageId,
      selectedNodeIds: [],
      baseRevision: opened.document.revision,
    };
    return validateContext({
      kind: "target-available" as const,
      conversationId: conversation.conversationId,
      source: "filed-project" as const,
      target,
    });
  }

  async #resolveConversationTarget(
    conversationId: string,
    target: DesignTarget,
    source: "active-task" | "recent-task",
  ) {
    let manifest;
    try {
      manifest = await this.projectHost.openRecentProject(target.projectId);
    } catch {
      return {
        kind: "target-unavailable" as const,
        conversationId,
        reason: "project-unavailable" as const,
        target,
      };
    }
    const descriptor = manifest.designFiles.find(
      (file) =>
        file.designFileId === target.designFileId &&
        file.documentId === target.documentId &&
        file.lifecycle === "active",
    );
    if (!descriptor) {
      return {
        kind: "target-unavailable" as const,
        conversationId,
        reason: "design-file-unavailable" as const,
        target,
      };
    }
    const opened = await this.projectHost.readDesignFile(
      manifest.projectId,
      descriptor.designFileId,
    );
    if (!opened.document.pagesById[target.pageId]) {
      return {
        kind: "target-unavailable" as const,
        conversationId,
        reason: "page-unavailable" as const,
        target,
      };
    }
    return {
      kind: "target-available" as const,
      conversationId,
      source,
      target,
    };
  }

  listGlobalTasks() {
    return this.workspaceStore.listGlobalTasks();
  }

  createDesignFile(request: unknown) {
    return this.#projectFiles.create(request);
  }

  readDesignFile(request: unknown) {
    return this.#projectFiles.read(request);
  }

  saveDesignFile(request: unknown) {
    return this.#projectFiles.save(request);
  }

  renameDesignFile(request: unknown) {
    return this.#projectFiles.rename(request);
  }

  publishProjectLibrary(request: unknown) {
    if (!isPublishProjectLibraryRequest(request)) {
      throw new TypeError("Invalid Project Library publish request");
    }
    return this.projectHost.publishDesignFileLibrary(
      request.projectId,
      request.designFileId,
      request.name,
    );
  }

  listProjectLibraries(request: unknown) {
    if (!isListProjectLibrariesRequest(request)) {
      throw new TypeError("Invalid Project Library list request");
    }
    return this.projectHost.listProjectLibraries(request.projectId);
  }

  readProjectLibraryRelease(request: unknown) {
    if (!isReadProjectLibraryReleaseRequest(request)) {
      throw new TypeError("Invalid Project Library release request");
    }
    return this.projectHost.readProjectLibraryRelease(
      request.projectId,
      request.libraryId,
      request.releaseId,
    );
  }

  setProjectLibraryEnabled(request: unknown) {
    if (!isSetProjectLibraryEnabledRequest(request)) {
      throw new TypeError("Invalid Project Library enable request");
    }
    return this.projectHost.setProjectLibraryEnabled(
      request.projectId,
      request.designFileId,
      request.libraryId,
      request.enabled,
    );
  }

  setProjectLibraryUpdateIgnored(request: unknown) {
    if (!isSetProjectLibraryUpdateIgnoredRequest(request)) {
      throw new TypeError("Invalid Project Library ignore request");
    }
    return this.projectHost.setProjectLibraryUpdateIgnored(
      request.projectId,
      request.designFileId,
      request.libraryId,
      request.releaseId,
    );
  }

  setProjectLibraryUpdateAccepted(request: unknown) {
    if (!isSetProjectLibraryUpdateAcceptedRequest(request)) {
      throw new TypeError("Invalid Project Library accept request");
    }
    return this.projectHost.setProjectLibraryUpdateAccepted(
      request.projectId,
      request.designFileId,
      request.libraryId,
      request.releaseId,
    );
  }
}
