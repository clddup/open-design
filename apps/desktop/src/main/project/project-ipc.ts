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
import {
  formatContractFailure,
  type Contract,
} from "@opendesign/contract-runtime";
import { basename } from "node:path";
import {
  isCreateProjectDesignFileRequest,
  isCreateProjectRequest,
  isOpenRecentProjectRequest,
  isProjectDesignFileRequest,
  isRenameProjectDesignFileRequest,
  isSaveProjectDesignFileRequest,
} from "@/shared/desktop-api.js";
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
import { ProjectHostError, type ProjectHost } from "./project-host.js";
import type { WorkspaceStore } from "./workspace-store.js";

export type ProjectDirectoryPurpose = "create" | "open";
export type SelectProjectDirectory = (
  purpose: ProjectDirectoryPurpose,
) => Promise<string | null>;
export type RevealProjectDirectory = (rootPath: string) => void;
export type HasActiveConversationRun = (conversationId: string) => boolean;

export class ProjectIpcService {
  constructor(
    private readonly projectHost: ProjectHost,
    private readonly workspaceStore: WorkspaceStore,
    private readonly selectProjectDirectory: SelectProjectDirectory,
    private readonly revealProjectDirectory: RevealProjectDirectory = () =>
      undefined,
    private readonly hasActiveConversationRun: HasActiveConversationRun = () =>
      false,
  ) {}

  async createProject(request: unknown) {
    if (!isCreateProjectRequest(request)) {
      throw new TypeError("Invalid Project create request");
    }
    const rootPath = await this.selectProjectDirectory("create");
    if (!rootPath) return null;
    try {
      const project = {
        ...request,
        name: basename(rootPath),
      };
      return await this.projectHost.createProject(
        rootPath,
        project,
        createStarterProjectFiles(request.projectId),
      );
    } catch (error) {
      if (
        error instanceof ProjectHostError &&
        error.code === "PROJECT_EXISTS"
      ) {
        return this.projectHost.openProject(rootPath);
      }
      throw error;
    }
  }

  async openProject() {
    const rootPath = await this.selectProjectDirectory("open");
    if (!rootPath) return null;
    return this.projectHost.openProject(rootPath);
  }

  openRecentProject(request: unknown) {
    if (!isOpenRecentProjectRequest(request)) {
      throw new TypeError("Invalid recent Project request");
    }
    return this.projectHost.openRecentProject(request.projectId);
  }

  listRecentProjects() {
    return this.workspaceStore.listRecentProjects();
  }

  removeRecentProject(request: unknown) {
    if (!isOpenRecentProjectRequest(request)) {
      throw new TypeError("Invalid recent Project remove request");
    }
    this.workspaceStore.hideProject(request.projectId);
    return this.workspaceStore.listRecentProjects();
  }

  revealRecentProject(request: unknown) {
    if (!isOpenRecentProjectRequest(request)) {
      throw new TypeError("Invalid recent Project reveal request");
    }
    const rootPath = this.workspaceStore.getProjectRoot(request.projectId);
    if (!rootPath) throw new Error("Recent Project is not registered");
    this.revealProjectDirectory(rootPath);
  }

  listOpenProjects() {
    return this.projectHost.listOpenProjects();
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
    if (!isCreateProjectDesignFileRequest(request)) {
      throw new TypeError("Invalid design file create request");
    }
    return this.projectHost.createDesignFile(request.projectId, {
      descriptor: request.descriptor,
      document: request.document,
    });
  }

  readDesignFile(request: unknown) {
    if (!isProjectDesignFileRequest(request)) {
      throw new TypeError("Invalid design file read request");
    }
    return this.projectHost.readDesignFile(
      request.projectId,
      request.designFileId,
    );
  }

  saveDesignFile(request: unknown) {
    if (!isSaveProjectDesignFileRequest(request)) {
      throw new TypeError("Invalid design file save request");
    }
    return this.projectHost.saveDesignFile(
      request.projectId,
      request.designFileId,
      request.document,
    );
  }

  renameDesignFile(request: unknown) {
    if (!isRenameProjectDesignFileRequest(request)) {
      throw new TypeError("Invalid design file rename request");
    }
    return this.projectHost.renameDesignFile(
      request.projectId,
      request.designFileId,
      request.name,
    );
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

function requireContract<T, Context>(
  contract: Contract<T, Context>,
  value: unknown,
  subject: string,
  context?: Context,
): T {
  const result = contract.parse(value, context);
  if (!result.ok) {
    throw new TypeError(formatContractFailure(subject, result.issues));
  }
  return result.value;
}
