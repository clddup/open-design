import type { DesignDocument } from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import type {
  ConversationDescriptor,
  ProjectManifest,
} from "@opendesign/workspace-contracts";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type {
  MessageKey,
  MessageParameters,
} from "../../../shared/i18n/messages";
import type {
  ProjectDesignFile,
  RecentProject,
} from "../../../shared/desktop-api";
import { LOCAL_PROJECT_ID } from "../../editor-runtime";
import { reportRendererError } from "../../diagnostics";
import type { ProjectAutosaveCoordinator } from "../../project-autosave";
import type {
  WorkspaceFileIdentity,
  WorkspaceRuntime,
  WorkspaceSnapshot,
} from "../../workspace-runtime";
import type { ProjectFileTarget } from "./use-project-workspace-state";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useProjectNavigationController({
  activateFile,
  activatePage,
  activeProject,
  applySavedProjectFile,
  conversations,
  fileName,
  openFile,
  projectAutosave,
  projectsById,
  replaceDocument,
  requestConversationHistory,
  runtime,
  selectConversation,
  setActiveProject,
  setEditorError,
  setFileName,
  setProjectsById,
  setRecentProjects,
  setWorkspaceBusy,
  setWorkspaceError,
  showUtilityTab,
  showView,
  t,
  workspace,
  workspaceSnapshot,
}: {
  activateFile: (projectId: string, designFileId: string) => void;
  activatePage: (pageId: string) => void;
  activeProject: ProjectManifest | null;
  applySavedProjectFile: (
    target: ProjectFileTarget,
    saved: ProjectDesignFile,
  ) => void;
  conversations: ConversationDescriptor[];
  fileName: string;
  openFile: (
    identity: WorkspaceFileIdentity,
    document: DesignDocument,
  ) => EditorRuntime;
  projectAutosave: ProjectAutosaveCoordinator;
  projectsById: Readonly<Record<string, ProjectManifest>>;
  replaceDocument: (document: unknown, name?: string) => EditorRuntime;
  requestConversationHistory: (conversationId: string) => Promise<void>;
  runtime: EditorRuntime;
  selectConversation: (conversationId: string | null) => void;
  setActiveProject: Dispatch<SetStateAction<ProjectManifest | null>>;
  setEditorError: (error: string | null) => void;
  setFileName: (name: string) => void;
  setProjectsById: Dispatch<
    SetStateAction<Readonly<Record<string, ProjectManifest>>>
  >;
  setRecentProjects: Dispatch<SetStateAction<RecentProject[]>>;
  setWorkspaceBusy: (busy: boolean) => void;
  setWorkspaceError: (error: string | null) => void;
  showUtilityTab: (tab: "agent" | "properties") => void;
  showView: (view: "workspace" | "project" | "editor") => void;
  t: Translate;
  workspace: WorkspaceRuntime;
  workspaceSnapshot: WorkspaceSnapshot;
}) {
  const refreshRecentProjects = useCallback(async () => {
    const projects = await window.desktop?.listRecentProjects();
    if (projects) setRecentProjects(projects);
  }, [setRecentProjects]);

  const showProject = useCallback(
    (manifest: ProjectManifest, preferredConversationId?: string) => {
      setProjectsById((projects) => ({
        ...projects,
        [manifest.projectId]: manifest,
      }));
      setActiveProject(manifest);
      setWorkspaceError(null);
      showView("project");
      const conversationId =
        preferredConversationId ??
        conversations.find(
          (conversation) =>
            conversation.lifecycle === "active" &&
            conversation.filedProjectId === manifest.projectId,
        )?.conversationId;
      if (conversationId) {
        selectConversation(conversationId);
        void requestConversationHistory(conversationId);
      }
    },
    [
      conversations,
      requestConversationHistory,
      selectConversation,
      setActiveProject,
      setProjectsById,
      setWorkspaceError,
      showView,
    ],
  );

  const createProject = useCallback(
    async (name: string) => {
      if (!window.desktop) return false;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const manifest = await window.desktop.createProject({
          projectId: createProjectId(),
          name: name.trim(),
        });
        if (!manifest) return false;
        showProject(manifest);
        await refreshRecentProjects();
        return true;
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "project_create_failed",
            error,
            t("error.createProject"),
          ),
        );
        return false;
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [
      refreshRecentProjects,
      setWorkspaceBusy,
      setWorkspaceError,
      showProject,
      t,
    ],
  );

  const openProject = useCallback(async () => {
    if (!window.desktop) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const manifest = await window.desktop.openProject();
      if (!manifest) return;
      showProject(manifest);
      await refreshRecentProjects();
    } catch (error) {
      setWorkspaceError(
        reportRendererError(
          "project_open_failed",
          error,
          t("error.openProject"),
        ),
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }, [
    refreshRecentProjects,
    setWorkspaceBusy,
    setWorkspaceError,
    showProject,
    t,
  ]);

  const openRecentProject = useCallback(
    async (projectId: string) => {
      if (!window.desktop) return;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const manifest = await window.desktop.openRecentProject({ projectId });
        showProject(manifest);
        await refreshRecentProjects();
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "recent_project_open_failed",
            error,
            t("error.reopenProject"),
            { projectId },
          ),
        );
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [
      refreshRecentProjects,
      setWorkspaceBusy,
      setWorkspaceError,
      showProject,
      t,
    ],
  );

  const removeRecentProject = useCallback(
    async (projectId: string) => {
      if (!window.desktop) return false;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        const projects = await window.desktop.removeRecentProject({
          projectId,
        });
        setRecentProjects(projects);
        return true;
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "recent_project_remove_failed",
            error,
            t("error.removeProject"),
            { projectId },
          ),
        );
        return false;
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [setRecentProjects, setWorkspaceBusy, setWorkspaceError, t],
  );

  const revealRecentProject = useCallback(
    (projectId: string) => {
      setWorkspaceError(null);
      void window.desktop
        ?.revealRecentProject({ projectId })
        .catch((error: unknown) => {
          setWorkspaceError(
            reportRendererError(
              "recent_project_reveal_failed",
              error,
              t("error.revealProject"),
              { projectId },
            ),
          );
        });
    },
    [setWorkspaceError, t],
  );

  const openProjectTarget = useCallback(
    async (target: {
      projectId: string;
      designFileId: string;
      pageId?: string;
    }) => {
      const desktop = window.desktop;
      if (!desktop) throw new Error("Desktop Project services are unavailable");
      const manifest =
        projectsById[target.projectId] ??
        (activeProject?.projectId === target.projectId
          ? activeProject
          : await desktop.openRecentProject({ projectId: target.projectId }));
      const file = await desktop.readProjectDesignFile({
        projectId: target.projectId,
        designFileId: target.designFileId,
      });
      if (
        manifest.projectId !== target.projectId ||
        file.descriptor.designFileId !== target.designFileId ||
        file.descriptor.documentId !== file.document.documentId
      ) {
        throw new Error(
          "Project target response identity does not match the requested file",
        );
      }
      const identity = {
        projectId: target.projectId,
        designFileId: file.descriptor.designFileId,
        name: file.descriptor.name,
      };
      const openedRuntime =
        workspaceSnapshot.openFileKeys.length === 1 &&
        workspaceSnapshot.activeProjectId === LOCAL_PROJECT_ID &&
        !runtime.getSnapshot().state.dirty
          ? workspace.replaceActiveFile(identity, file.document)
          : openFile(identity, file.document);
      projectAutosave.track({
        projectId: identity.projectId,
        designFileId: identity.designFileId,
        documentId: file.document.documentId,
        runtime: openedRuntime,
      });
      setProjectsById((projects) => ({
        ...projects,
        [manifest.projectId]: manifest,
      }));
      setActiveProject(manifest);
      setFileName(file.descriptor.name);
      if (target.pageId && file.document.pagesById[target.pageId]) {
        activatePage(target.pageId);
      }
      showUtilityTab("agent");
      showView("editor");
    },
    [
      activatePage,
      activeProject,
      openFile,
      projectAutosave,
      projectsById,
      runtime,
      setActiveProject,
      setFileName,
      setProjectsById,
      showUtilityTab,
      showView,
      workspace,
      workspaceSnapshot.activeProjectId,
      workspaceSnapshot.openFileKeys.length,
    ],
  );

  const activateDesignFile = useCallback(
    (projectId: string, designFileId: string) => {
      const file = Object.values(workspaceSnapshot.files).find(
        (candidate) =>
          candidate.projectId === projectId &&
          candidate.designFileId === designFileId,
      );
      activateFile(projectId, designFileId);
      setActiveProject(projectsById[projectId] ?? null);
      if (file) setFileName(file.name);
    },
    [
      activateFile,
      projectsById,
      setActiveProject,
      setFileName,
      workspaceSnapshot.files,
    ],
  );

  const renameProjectDesignFile = useCallback(
    async (projectId: string, designFileId: string, nextName: string) => {
      const desktop = window.desktop;
      const targetProject = projectsById[projectId];
      const targetFile = Object.values(workspaceSnapshot.files).find(
        (file) =>
          file.projectId === projectId && file.designFileId === designFileId,
      );
      if (!desktop || !targetProject || !targetFile) return false;
      const name = nextName.trim();
      if (name.length === 0 || name.length > 256) return false;
      setEditorError(null);
      try {
        const descriptor = await desktop.renameProjectDesignFile({
          projectId,
          designFileId,
          name,
        });
        if (
          descriptor.designFileId !== designFileId ||
          descriptor.documentId !== targetFile.documentId ||
          descriptor.name !== name
        ) {
          throw new Error(
            "Design file rename response identity does not match",
          );
        }
        const updateManifest = (project: ProjectManifest): ProjectManifest => ({
          ...project,
          updatedAt: descriptor.updatedAt,
          designFiles: project.designFiles.map((file) =>
            file.designFileId === designFileId ? descriptor : file,
          ),
        });
        setProjectsById((projects) => {
          const project = projects[projectId];
          return project
            ? { ...projects, [projectId]: updateManifest(project) }
            : projects;
        });
        setActiveProject((project) =>
          project?.projectId === projectId ? updateManifest(project) : project,
        );
        workspace.renameFile(projectId, designFileId, descriptor.name);
        if (
          workspaceSnapshot.activeProjectId === projectId &&
          workspaceSnapshot.activeDesignFileId === designFileId
        ) {
          setFileName(descriptor.name);
        }
        return true;
      } catch (error) {
        setEditorError(
          reportRendererError(
            "design_file_rename_failed",
            error,
            t("error.renameDesignFile"),
            { projectId, designFileId },
          ),
        );
        return false;
      }
    },
    [
      projectsById,
      setActiveProject,
      setEditorError,
      setFileName,
      setProjectsById,
      t,
      workspace,
      workspaceSnapshot,
    ],
  );

  const openProjectDesignFile = useCallback(
    async (designFileId: string) => {
      if (!activeProject) return;
      setWorkspaceBusy(true);
      setWorkspaceError(null);
      try {
        await openProjectTarget({
          projectId: activeProject.projectId,
          designFileId,
        });
      } catch (error) {
        setWorkspaceError(
          reportRendererError(
            "design_file_open_failed",
            error,
            t("error.openDesignFile"),
            { projectId: activeProject.projectId, designFileId },
          ),
        );
      } finally {
        setWorkspaceBusy(false);
      }
    },
    [activeProject, openProjectTarget, setWorkspaceBusy, setWorkspaceError, t],
  );

  const openDocument = useCallback(async () => {
    setEditorError(null);
    try {
      const file = await window.desktop?.openDesignFile();
      if (!file) return;
      const value: unknown = JSON.parse(file.contents);
      replaceDocument(value, file.name);
      setActiveProject(null);
      setFileName(file.name);
      showView("editor");
    } catch (error) {
      setEditorError(
        reportRendererError(
          "design_document_open_failed",
          error,
          t("error.openDesignDocument"),
        ),
      );
    }
  }, [
    replaceDocument,
    setActiveProject,
    setEditorError,
    setFileName,
    showView,
    t,
  ]);

  const saveDocument = useCallback(
    async (saveAs: boolean) => {
      setEditorError(null);
      try {
        const current = runtime.getSnapshot();
        const targetProject =
          projectsById[workspaceSnapshot.activeProjectId] ?? null;
        if (targetProject) {
          const saved = await window.desktop?.saveProjectDesignFile({
            projectId: workspaceSnapshot.activeProjectId,
            designFileId: workspaceSnapshot.activeDesignFileId,
            document: current.document,
          });
          if (!saved) return;
          if (
            saved.descriptor.designFileId !==
              workspaceSnapshot.activeDesignFileId ||
            saved.descriptor.documentId !== current.document.documentId ||
            saved.document.documentId !== current.document.documentId ||
            saved.document.revision !== current.document.revision
          ) {
            throw new Error(
              "Design file save response does not match the active document",
            );
          }
          applySavedProjectFile(
            {
              projectId: workspaceSnapshot.activeProjectId,
              designFileId: workspaceSnapshot.activeDesignFileId,
              documentId: current.document.documentId,
            },
            saved,
          );
          runtime.checkpoint(
            t("history.saved", { name: saved.descriptor.name }),
          );
          return;
        }

        const result = await window.desktop?.saveDesignFile({
          suggestedName: fileName,
          contents: JSON.stringify(current.document, null, 2),
          ...(saveAs ? { saveAs: true } : {}),
        });
        if (!result) return;
        setFileName(result.name);
        workspace.renameFile(
          workspaceSnapshot.activeProjectId,
          workspaceSnapshot.activeDesignFileId,
          result.name,
        );
        runtime.checkpoint(t("history.saved", { name: result.name }));
      } catch (error) {
        setEditorError(
          reportRendererError(
            "design_document_save_failed",
            error,
            t("error.saveDesignDocument"),
            {
              projectId: workspaceSnapshot.activeProjectId,
              designFileId: workspaceSnapshot.activeDesignFileId,
            },
          ),
        );
      }
    },
    [
      applySavedProjectFile,
      fileName,
      projectsById,
      runtime,
      setEditorError,
      setFileName,
      t,
      workspace,
      workspaceSnapshot.activeDesignFileId,
      workspaceSnapshot.activeProjectId,
    ],
  );

  return {
    activateDesignFile,
    createProject,
    openDocument,
    openProject,
    openProjectDesignFile,
    openProjectTarget,
    openRecentProject,
    refreshRecentProjects,
    removeRecentProject,
    renameProjectDesignFile,
    revealRecentProject,
    saveDocument,
  };
}

function createProjectId() {
  return `project_${crypto.randomUUID().replaceAll("-", "")}`;
}
