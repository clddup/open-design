import {
  CreateProjectDesignFileRequestContract,
  CreateProjectRequestContract,
  OpenRecentProjectRequestContract,
  ProjectDesignFileContract,
  ProjectDesignFileRequestContract,
  ProjectManifestListContract,
  ProjectManifestResponseContract,
  RecentProjectListContract,
  RenameProjectDesignFileRequestContract,
  RenameProjectDesignFileResultContract,
  SaveProjectDesignFileRequestContract,
  type CreateProjectDesignFileRequest,
  type CreateProjectRequest,
  type OpenRecentProjectRequest,
  type ProjectDesignFileRequest,
  type RenameProjectDesignFileRequest,
  type SaveProjectDesignFileRequest,
} from "@/shared/project-file-contract";
import { channels, type DesktopApi } from "@/shared/desktop-api";
import { parseContract } from "./contract-parser";

type ProjectApi = Pick<
  DesktopApi,
  | "createProject"
  | "openProject"
  | "openRecentProject"
  | "listRecentProjects"
  | "removeRecentProject"
  | "revealRecentProject"
  | "listOpenProjects"
  | "createProjectDesignFile"
  | "readProjectDesignFile"
  | "saveProjectDesignFile"
  | "renameProjectDesignFile"
>;

export function createProjectApi(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): ProjectApi {
  return {
    createProject: async (request: CreateProjectRequest) => {
      const canonicalRequest = parseContract(
        CreateProjectRequestContract,
        request,
        "Project create request",
      );
      const result = await invoke(channels.createProject, canonicalRequest);
      return result === null
        ? null
        : parseContract(
            ProjectManifestResponseContract,
            result,
            "Project create response",
          );
    },
    openProject: async () => {
      const result = await invoke(channels.openProject);
      return result === null
        ? null
        : parseContract(
            ProjectManifestResponseContract,
            result,
            "Project open response",
          );
    },
    openRecentProject: async (request: OpenRecentProjectRequest) => {
      const canonicalRequest = parseContract(
        OpenRecentProjectRequestContract,
        request,
        "Recent Project request",
      );
      const result = await invoke(channels.openRecentProject, canonicalRequest);
      return parseContract(
        ProjectManifestResponseContract,
        result,
        "Recent Project response",
        { kind: "project", projectId: canonicalRequest.projectId },
      );
    },
    listRecentProjects: async () =>
      parseContract(
        RecentProjectListContract,
        await invoke(channels.listRecentProjects),
        "Recent Project list",
      ),
    removeRecentProject: async (request: OpenRecentProjectRequest) => {
      const canonicalRequest = parseContract(
        OpenRecentProjectRequestContract,
        request,
        "Recent Project remove request",
      );
      return parseContract(
        RecentProjectListContract,
        await invoke(channels.removeRecentProject, canonicalRequest),
        "Recent Project list",
      );
    },
    revealRecentProject: async (request: OpenRecentProjectRequest) => {
      const canonicalRequest = parseContract(
        OpenRecentProjectRequestContract,
        request,
        "Recent Project reveal request",
      );
      await invoke(channels.revealRecentProject, canonicalRequest);
    },
    listOpenProjects: async () =>
      parseContract(
        ProjectManifestListContract,
        await invoke(channels.listOpenProjects),
        "Open Project list",
      ),
    createProjectDesignFile: async (
      request: CreateProjectDesignFileRequest,
    ) => {
      const canonicalRequest = parseContract(
        CreateProjectDesignFileRequestContract,
        request,
        "Design File create request",
      );
      return parseContract(
        ProjectDesignFileContract,
        await invoke(channels.createProjectDesignFile, canonicalRequest),
        "Design File create response",
        { kind: "create", request: canonicalRequest },
      );
    },
    readProjectDesignFile: async (request: ProjectDesignFileRequest) => {
      const canonicalRequest = parseContract(
        ProjectDesignFileRequestContract,
        request,
        "Design File read request",
      );
      return parseContract(
        ProjectDesignFileContract,
        await invoke(channels.readProjectDesignFile, canonicalRequest),
        "Design File read response",
        { kind: "read", request: canonicalRequest },
      );
    },
    saveProjectDesignFile: async (request: SaveProjectDesignFileRequest) => {
      const canonicalRequest = parseContract(
        SaveProjectDesignFileRequestContract,
        request,
        "Design File save request",
      );
      return parseContract(
        ProjectDesignFileContract,
        await invoke(channels.saveProjectDesignFile, canonicalRequest),
        "Design File save response",
        { kind: "save", request: canonicalRequest },
      );
    },
    renameProjectDesignFile: async (
      request: RenameProjectDesignFileRequest,
    ) => {
      const canonicalRequest = parseContract(
        RenameProjectDesignFileRequestContract,
        request,
        "Design File rename request",
      );
      return parseContract(
        RenameProjectDesignFileResultContract,
        await invoke(channels.renameProjectDesignFile, canonicalRequest),
        "Design File rename response",
        { kind: "rename", request: canonicalRequest },
      );
    },
  };
}
