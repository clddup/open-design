import type { ConversationDescriptor } from "@opendesign/workspace-contracts";
import {
  isCreateConversationRequest,
  isCreateProjectDesignFileRequest,
  isCreateProjectRequest,
  isListProjectConversationsRequest,
  isOpenRecentProjectRequest,
  isProjectDesignFileRequest,
  isSaveProjectDesignFileRequest,
} from "../../shared/desktop-api.js";
import { createStarterProjectFiles } from "../../shared/project/starter-project.js";
import { ProjectHostError, type ProjectHost } from "./project-host.js";
import type { WorkspaceStore } from "./workspace-store.js";

export type ProjectDirectoryPurpose = "create" | "open";
export type SelectProjectDirectory = (
  purpose: ProjectDirectoryPurpose,
) => Promise<string | null>;
export type RevealProjectDirectory = (rootPath: string) => void;

export class ProjectIpcService {
  constructor(
    private readonly projectHost: ProjectHost,
    private readonly workspaceStore: WorkspaceStore,
    private readonly selectProjectDirectory: SelectProjectDirectory,
    private readonly revealProjectDirectory: RevealProjectDirectory = () =>
      undefined,
  ) {}

  async createProject(request: unknown) {
    if (!isCreateProjectRequest(request)) {
      throw new TypeError("Invalid Project create request");
    }
    const rootPath = await this.selectProjectDirectory("create");
    if (!rootPath) return null;
    try {
      return await this.projectHost.createProject(
        rootPath,
        request,
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
    if (!isCreateConversationRequest(request)) {
      throw new TypeError("Invalid Conversation create request");
    }
    if (!this.workspaceStore.getProjectRoot(request.homeProjectId)) {
      throw new Error("Conversation Home Project is not registered");
    }
    const timestamp = new Date().toISOString();
    const conversation: ConversationDescriptor = {
      conversationId: request.conversationId,
      homeProjectId: request.homeProjectId,
      title: request.title,
      createdAt: timestamp,
      updatedAt: timestamp,
      lifecycle: "active",
    };
    this.workspaceStore.createConversation(conversation);
    return conversation;
  }

  listProjectConversations(request: unknown) {
    if (!isListProjectConversationsRequest(request)) {
      throw new TypeError("Invalid Project Conversation list request");
    }
    if (!this.workspaceStore.getProjectRoot(request.homeProjectId)) {
      throw new Error("Conversation Home Project is not registered");
    }
    return this.workspaceStore.listConversations(request.homeProjectId);
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
}
