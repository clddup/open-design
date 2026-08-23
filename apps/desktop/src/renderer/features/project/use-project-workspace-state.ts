import type { ProjectManifest } from "@opendesign/workspace-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectDesignFile,
  RecentProject,
} from "../../../shared/desktop-api";
import type {
  MessageKey,
  MessageParameters,
} from "../../../shared/i18n/messages";
import { reportRendererError } from "../diagnostics/diagnostics";
import {
  ProjectAutosaveCoordinator,
  type ProjectAutosaveTarget,
} from "./project-autosave";
import type { WorkspaceRuntime } from "../../state/workspace-runtime";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;
export type ProjectFileTarget = Pick<
  ProjectAutosaveTarget,
  "projectId" | "designFileId" | "documentId"
>;

export function useProjectWorkspaceState({
  setEditorError,
  t,
  workspace,
}: {
  setEditorError: (error: string | null) => void;
  t: Translate;
  workspace: WorkspaceRuntime;
}) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [projectsById, setProjectsById] = useState<
    Readonly<Record<string, ProjectManifest>>
  >({});
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const autosaveCallbacks = useRef<{
    onError: (target: ProjectAutosaveTarget, error: unknown) => void;
    onSaved: (target: ProjectAutosaveTarget, saved: ProjectDesignFile) => void;
  }>({ onError: () => undefined, onSaved: () => undefined });
  const projectAutosave = useMemo(
    () =>
      new ProjectAutosaveCoordinator({
        save: async (projectId, designFileId, document) => {
          const desktop = window.desktop;
          if (!desktop) throw new Error("Desktop autosave is unavailable");
          return await desktop.saveProjectDesignFile({
            projectId,
            designFileId,
            document,
          });
        },
        onError: (target, error) =>
          autosaveCallbacks.current.onError(target, error),
        onSaved: (target, saved) =>
          autosaveCallbacks.current.onSaved(target, saved),
      }),
    [],
  );

  const applySavedProjectFile = useCallback(
    (target: ProjectFileTarget, saved: ProjectDesignFile) => {
      const updateManifest = (project: ProjectManifest): ProjectManifest => ({
        ...project,
        updatedAt: saved.descriptor.updatedAt,
        designFiles: project.designFiles.map((file) =>
          file.designFileId === saved.descriptor.designFileId
            ? saved.descriptor
            : file,
        ),
      });
      setProjectsById((projects) => {
        const project = projects[target.projectId];
        return project
          ? { ...projects, [target.projectId]: updateManifest(project) }
          : projects;
      });
      workspace.renameFile(
        target.projectId,
        target.designFileId,
        saved.descriptor.name,
      );
    },
    [workspace],
  );

  autosaveCallbacks.current = {
    onError: (target, error) => {
      setEditorError(
        reportRendererError(
          "design_autosave_failed",
          error,
          t("error.autosaveDesignFile"),
          {
            projectId: target.projectId,
            designFileId: target.designFileId,
          },
        ),
      );
    },
    onSaved: applySavedProjectFile,
  };

  useEffect(() => {
    let active = true;
    void window.desktop
      ?.listRecentProjects()
      .then((projects) => {
        if (active) setRecentProjects(projects);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setWorkspaceError(
          reportRendererError(
            "recent_projects_load_failed",
            error,
            t("error.loadRecentProjects"),
          ),
        );
      });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => () => projectAutosave.dispose(), [projectAutosave]);

  useEffect(() => {
    let closeAfterFlush = false;
    let flushing = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (closeAfterFlush || !projectAutosave.hasPendingWork()) return;
      event.preventDefault();
      event.returnValue = false;
      if (flushing) return;
      flushing = true;
      void projectAutosave.flushAll().then(
        () => {
          closeAfterFlush = true;
          window.close();
        },
        () => {
          flushing = false;
        },
      );
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [projectAutosave]);

  return {
    applySavedProjectFile,
    projectAutosave,
    projectsById,
    recentProjects,
    setProjectsById,
    setRecentProjects,
    setWorkspaceBusy,
    setWorkspaceError,
    workspaceBusy,
    workspaceError,
  };
}
