import {
  createEmptyDesignDocument,
  createWelcomeDocument,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import type { DesignDocument } from "@opendesign/design-contracts";
import {
  PROJECT_MANIFEST_VERSION,
  type DesignFileDescriptor,
  type ProjectManifest,
} from "@opendesign/workspace-contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopApi,
  ProjectDesignFile,
} from "../../../shared/desktop-api";
import { LOCAL_DESIGN_FILE_ID, LOCAL_PROJECT_ID } from "../../editor-runtime";
import type { ProjectAutosaveCoordinator } from "../../project-autosave";
import {
  WorkspaceRuntime,
  type WorkspaceFileIdentity,
} from "../../workspace-runtime";
import { useProjectNavigationController } from "./use-project-navigation-controller";
import { AppNavigationCoordinator } from "../../router/app-navigation-coordinator";
import { useProjectWorkspaceState } from "./use-project-workspace-state";

const now = "2026-08-23T00:00:00.000Z";

afterEach(() => {
  delete window.desktop;
});

describe("Project workspace", () => {
  it("ignores a slower Project open after a newer navigation wins", async () => {
    const workspace = localWorkspace();
    const slowProject = manifest("project_slow", []);
    const fastProject = manifest("project_fast", []);
    const slow = deferred<ProjectManifest>();
    const fast = deferred<ProjectManifest>();
    window.desktop = {
      listRecentProjects: vi.fn().mockResolvedValue([]),
      openRecentProject: vi.fn(({ projectId }) =>
        projectId === slowProject.projectId ? slow.promise : fast.promise,
      ),
    } as unknown as DesktopApi;
    const routeNavigate = vi.fn();
    const navigator = navigationCoordinator(routeNavigate);
    const setProjectsById = vi.fn();
    const args = navigationArgs(workspace, {
      navigator,
      setProjectsById,
    });
    const { result, unmount } = renderHook(() =>
      useProjectNavigationController({
        ...args,
        runtime: workspace.getActiveRuntime(),
        workspaceSnapshot: workspace.getSnapshot(),
      }),
    );

    let slowOpen!: Promise<void>;
    let fastOpen!: Promise<void>;
    act(() => {
      slowOpen = result.current.openRecentProject(slowProject.projectId);
      fastOpen = result.current.openRecentProject(fastProject.projectId);
    });
    await act(async () => {
      fast.resolve(fastProject);
      await fastOpen;
    });
    await act(async () => {
      slow.resolve(slowProject);
      await slowOpen;
    });

    expect(routeNavigate).toHaveBeenLastCalledWith({
      kind: "project",
      projectId: fastProject.projectId,
    });
    expect(setProjectsById).toHaveBeenCalledOnce();
    unmount();
  });

  it("replaces only the clean local placeholder when opening a composite Project target", async () => {
    const cleanWorkspace = localWorkspace();
    const cleanTarget = projectFile("project_alpha", "design_shared");
    const cleanManifest = manifest("project_alpha", [cleanTarget.descriptor]);
    window.desktop = {
      openRecentProject: vi.fn().mockResolvedValue(cleanManifest),
      readProjectDesignFile: vi.fn().mockResolvedValue(cleanTarget),
    } as unknown as DesktopApi;
    const cleanOpenFile = vi.fn(
      (identity: WorkspaceFileIdentity, document: DesignDocument) =>
        cleanWorkspace.openFile(identity, document),
    );
    const replaceActiveFile = vi.spyOn(cleanWorkspace, "replaceActiveFile");
    const track = vi.fn();
    const cleanArgs = navigationArgs(cleanWorkspace, {
      openFile: cleanOpenFile,
      projectAutosave: { track } as unknown as ProjectAutosaveCoordinator,
    });
    const cleanHook = renderHook(() =>
      useProjectNavigationController({
        ...cleanArgs,
        runtime: cleanWorkspace.getActiveRuntime(),
        workspaceSnapshot: cleanWorkspace.getSnapshot(),
      }),
    );

    await act(() =>
      cleanHook.result.current.openProjectTarget({
        projectId: "project_alpha",
        designFileId: "design_shared",
        pageId: "page_project_alpha",
      }),
    );

    expect(replaceActiveFile).toHaveBeenCalledOnce();
    expect(cleanOpenFile).not.toHaveBeenCalled();
    expect(cleanWorkspace.getSnapshot()).toMatchObject({
      activeProjectId: "project_alpha",
      activeDesignFileId: "design_shared",
      openFileKeys: [expect.any(String)],
    });
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_alpha",
        designFileId: "design_shared",
        documentId: "document_project_alpha",
      }),
    );
    cleanHook.unmount();

    const dirtyWorkspace = localWorkspace();
    renameWelcomeFrame(dirtyWorkspace.getActiveRuntime(), "Keep this draft");
    const dirtyTarget = projectFile("project_beta", "design_shared");
    const dirtyManifest = manifest("project_beta", [dirtyTarget.descriptor]);
    window.desktop = {
      openRecentProject: vi.fn().mockResolvedValue(dirtyManifest),
      readProjectDesignFile: vi.fn().mockResolvedValue(dirtyTarget),
    } as unknown as DesktopApi;
    const dirtyOpenFile = vi.fn(
      (identity: WorkspaceFileIdentity, document: DesignDocument) =>
        dirtyWorkspace.openFile(identity, document),
    );
    const dirtyArgs = navigationArgs(dirtyWorkspace, {
      openFile: dirtyOpenFile,
    });
    const dirtyHook = renderHook(() =>
      useProjectNavigationController({
        ...dirtyArgs,
        runtime: dirtyWorkspace.getActiveRuntime(),
        workspaceSnapshot: dirtyWorkspace.getSnapshot(),
      }),
    );

    await act(() =>
      dirtyHook.result.current.openProjectTarget({
        projectId: "project_beta",
        designFileId: "design_shared",
      }),
    );

    expect(dirtyOpenFile).toHaveBeenCalledOnce();
    expect(dirtyWorkspace.getSnapshot()).toMatchObject({
      activeProjectId: "project_beta",
      activeDesignFileId: "design_shared",
      openFileKeys: [expect.any(String), expect.any(String)],
    });
    dirtyHook.unmount();
  });

  it("saves the active composite Project identity after switching files", async () => {
    const alpha = projectFile("project_alpha", "design_shared");
    const beta = projectFile("project_beta", "design_shared");
    const workspace = new WorkspaceRuntime({
      projectId: "project_alpha",
      designFileId: "design_shared",
      name: alpha.descriptor.name,
      document: alpha.document,
    });
    workspace.openFile(
      {
        projectId: "project_beta",
        designFileId: "design_shared",
        name: beta.descriptor.name,
      },
      beta.document,
    );
    const saved = projectFile("project_beta", "design_shared", {
      name: "Saved Beta",
    });
    const saveProjectDesignFile = vi.fn().mockResolvedValue(saved);
    window.desktop = { saveProjectDesignFile } as unknown as DesktopApi;
    const applySavedProjectFile = vi.fn();
    const args = navigationArgs(workspace, {
      applySavedProjectFile,
      projectsById: {
        project_alpha: manifest("project_alpha", [alpha.descriptor]),
        project_beta: manifest("project_beta", [beta.descriptor]),
      },
    });
    const { result, unmount } = renderHook(() =>
      useProjectNavigationController({
        ...args,
        runtime: workspace.getActiveRuntime(),
        workspaceSnapshot: workspace.getSnapshot(),
      }),
    );

    await act(() => result.current.saveDocument(false));

    expect(saveProjectDesignFile).toHaveBeenCalledWith({
      projectId: "project_beta",
      designFileId: "design_shared",
      document: beta.document,
    });
    expect(applySavedProjectFile).toHaveBeenCalledWith(
      {
        projectId: "project_beta",
        designFileId: "design_shared",
        documentId: "document_project_beta",
      },
      saved,
    );
    unmount();
  });

  it("rejects a Project target response that resolves to another file", async () => {
    const workspace = localWorkspace();
    const returnedFile = projectFile("project_alpha", "design_other");
    window.desktop = {
      openRecentProject: vi
        .fn()
        .mockResolvedValue(
          manifest("project_alpha", [returnedFile.descriptor]),
        ),
      readProjectDesignFile: vi.fn().mockResolvedValue(returnedFile),
    } as unknown as DesktopApi;
    const track = vi.fn();
    const args = navigationArgs(workspace, {
      projectAutosave: { track } as unknown as ProjectAutosaveCoordinator,
    });
    const { result, unmount } = renderHook(() =>
      useProjectNavigationController({
        ...args,
        runtime: workspace.getActiveRuntime(),
        workspaceSnapshot: workspace.getSnapshot(),
      }),
    );

    await expect(
      act(() =>
        result.current.openProjectTarget({
          projectId: "project_alpha",
          designFileId: "design_shared",
        }),
      ),
    ).rejects.toThrow("does not match the requested file");

    expect(workspace.getSnapshot().activeProjectId).toBe(LOCAL_PROJECT_ID);
    expect(track).not.toHaveBeenCalled();
    unmount();
  });

  it("rejects a rename response whose document identity changed", async () => {
    const file = projectFile("project_alpha", "design_shared");
    const project = manifest("project_alpha", [file.descriptor]);
    const workspace = new WorkspaceRuntime({
      projectId: project.projectId,
      designFileId: file.descriptor.designFileId,
      name: file.descriptor.name,
      document: file.document,
    });
    window.desktop = {
      renameProjectDesignFile: vi.fn().mockResolvedValue({
        ...file.descriptor,
        documentId: "document_wrong",
        name: "Renamed",
      }),
    } as unknown as DesktopApi;
    const setEditorError = vi.fn();
    const args = navigationArgs(workspace, {
      projectsById: { [project.projectId]: project },
      setEditorError,
    });
    const { result, unmount } = renderHook(() =>
      useProjectNavigationController({
        ...args,
        runtime: workspace.getActiveRuntime(),
        workspaceSnapshot: workspace.getSnapshot(),
      }),
    );

    await expect(
      act(() =>
        result.current.renameProjectDesignFile(
          "project_alpha",
          "design_shared",
          "Renamed",
        ),
      ),
    ).resolves.toBe(false);

    expect(setEditorError).toHaveBeenLastCalledWith(expect.any(String));
    expect(Object.values(workspace.getSnapshot().files)[0]?.name).toBe(
      file.descriptor.name,
    );
    unmount();
  });

  it("applies a successful autosave to the manifest and active file name", async () => {
    const file = projectFile("project_alpha", "design_shared", {
      name: "Before save",
    });
    const project = manifest("project_alpha", [file.descriptor]);
    const workspace = new WorkspaceRuntime({
      projectId: project.projectId,
      designFileId: file.descriptor.designFileId,
      name: file.descriptor.name,
      document: file.document,
    });
    window.desktop = {
      listRecentProjects: vi.fn().mockResolvedValue([]),
      saveProjectDesignFile: vi
        .fn()
        .mockImplementation(
          ({ document }: Parameters<DesktopApi["saveProjectDesignFile"]>[0]) =>
            Promise.resolve(
              projectFile("project_alpha", "design_shared", {
                document,
                name: "After save",
                updatedAt: "2026-08-23T00:01:00.000Z",
              }),
            ),
        ),
    } as unknown as DesktopApi;
    const setEditorError = vi.fn();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspaceState({ setEditorError, t: (key) => key, workspace }),
    );
    act(() => {
      result.current.setProjectsById({ [project.projectId]: project });
      result.current.projectAutosave.track({
        projectId: project.projectId,
        designFileId: file.descriptor.designFileId,
        documentId: file.document.documentId,
        runtime: workspace.getActiveRuntime(),
      });
      insertProjectRectangle(workspace.getActiveRuntime(), "Autosave me");
    });

    await act(() =>
      result.current.projectAutosave.flushDocument(file.document.documentId),
    );

    await waitFor(() =>
      expect(
        workspace.getSnapshot().files[workspace.getSnapshot().activeFileKey]
          ?.name,
      ).toBe("After save"),
    );
    expect(
      result.current.projectsById[project.projectId]?.designFiles[0]?.name,
    ).toBe("After save");
    expect(workspace.getActiveRuntime().getSnapshot().state.dirty).toBe(false);
    expect(setEditorError).not.toHaveBeenCalled();
    unmount();
  });

  it("keeps the runtime dirty and reports an autosave persistence failure", async () => {
    const file = projectFile("project_alpha", "design_shared");
    const workspace = new WorkspaceRuntime({
      projectId: "project_alpha",
      designFileId: "design_shared",
      name: file.descriptor.name,
      document: file.document,
    });
    window.desktop = {
      listRecentProjects: vi.fn().mockResolvedValue([]),
      saveProjectDesignFile: vi
        .fn()
        .mockRejectedValue(new Error("Disk is read-only")),
    } as unknown as DesktopApi;
    const setEditorError = vi.fn();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspaceState({ setEditorError, t: (key) => key, workspace }),
    );
    act(() => {
      result.current.projectAutosave.track({
        projectId: "project_alpha",
        designFileId: "design_shared",
        documentId: file.document.documentId,
        runtime: workspace.getActiveRuntime(),
      });
      insertProjectRectangle(workspace.getActiveRuntime(), "Unsaved");
    });

    await expect(
      act(() =>
        result.current.projectAutosave.flushDocument(file.document.documentId),
      ),
    ).rejects.toThrow("Disk is read-only");

    expect(workspace.getActiveRuntime().getSnapshot().state.dirty).toBe(true);
    expect(setEditorError).toHaveBeenLastCalledWith(expect.any(String));
    unmount();
  });
});

type NavigationArgs = Parameters<typeof useProjectNavigationController>[0];

function navigationArgs(
  workspace: WorkspaceRuntime,
  overrides: Partial<NavigationArgs> = {},
): NavigationArgs {
  return {
    activateFile: (projectId, designFileId) =>
      workspace.activateFile(projectId, designFileId),
    activatePage: (pageId) => workspace.activatePage(pageId),
    applySavedProjectFile: vi.fn(),
    conversations: [],
    navigator: navigationCoordinator(),
    openFile: (identity, document) => workspace.openFile(identity, document),
    projectAutosave: {
      track: vi.fn(),
    } as unknown as ProjectAutosaveCoordinator,
    projectContextId: workspace.getSnapshot().activeProjectId,
    projectsById: {},
    replaceDocument: vi.fn(),
    requestConversationHistory: vi.fn().mockResolvedValue(undefined),
    runtime: workspace.getActiveRuntime(),
    selectConversation: vi.fn(),
    setEditorError: vi.fn(),
    setProjectsById: vi.fn(),
    setRecentProjects: vi.fn(),
    setWorkspaceBusy: vi.fn(),
    setWorkspaceError: vi.fn(),
    t: (key) => key,
    workspace,
    workspaceSnapshot: workspace.getSnapshot(),
    ...overrides,
  };
}

function navigationCoordinator(navigate = vi.fn()) {
  return new AppNavigationCoordinator({ back: vi.fn(), navigate });
}

function localWorkspace() {
  return new WorkspaceRuntime({
    projectId: LOCAL_PROJECT_ID,
    designFileId: LOCAL_DESIGN_FILE_ID,
    name: "Untitled.opendesign",
    document: createWelcomeDocument(),
  });
}

function projectFile(
  projectId: string,
  designFileId: string,
  options: {
    document?: ProjectDesignFile["document"];
    name?: string;
    updatedAt?: string;
  } = {},
): ProjectDesignFile {
  const document =
    options.document ??
    createEmptyDesignDocument(`document_${projectId}`, `page_${projectId}`);
  return {
    descriptor: {
      designFileId,
      documentId: document.documentId,
      name: options.name ?? `File ${projectId}`,
      relativePath: `designs/${projectId}.opendesign`,
      createdAt: now,
      updatedAt: options.updatedAt ?? now,
      lifecycle: "active",
    },
    document,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function manifest(
  projectId: string,
  designFiles: DesignFileDescriptor[],
): ProjectManifest {
  return {
    manifestVersion: PROJECT_MANIFEST_VERSION,
    projectId,
    name: `Project ${projectId}`,
    createdAt: now,
    updatedAt: now,
    lifecycle: "active",
    designFiles,
  };
}

function renameWelcomeFrame(runtime: EditorRuntime, name: string) {
  renameNode(runtime, "frame_welcome", name);
}

function renameNode(runtime: EditorRuntime, nodeId: string, name: string) {
  const current = runtime.getSnapshot().document;
  const result = runtime.apply({
    transactionId: `rename_${current.revision + 1}`,
    documentId: current.documentId,
    baseRevision: current.revision,
    actor: { type: "user", id: "tester" },
    label: "Rename node",
    commands: [
      {
        commandId: `rename_node_${current.revision + 1}`,
        type: "update_properties",
        nodeId,
        name,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
}

function insertProjectRectangle(runtime: EditorRuntime, name: string) {
  const current = runtime.getSnapshot().document;
  const pageId = current.pageOrder[0];
  if (!pageId) throw new Error("Project fixture has no page");
  const result = runtime.apply({
    transactionId: `insert_${current.revision + 1}`,
    documentId: current.documentId,
    baseRevision: current.revision,
    actor: { type: "user", id: "tester" },
    label: "Insert rectangle",
    commands: [
      {
        commandId: `insert_rectangle_${current.revision + 1}`,
        type: "insert_element",
        pageId,
        parentId: null,
        index: 0,
        node: {
          id: `rectangle_${current.revision + 1}`,
          kind: "rectangle",
          name,
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 100, height: 100 },
          exportSettings: [],
          opacity: 1,
          properties: {
            fills: [],
            strokes: [],
            strokeWidth: 0,
            cornerRadius: 0,
          },
          extensions: {},
        },
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
}
