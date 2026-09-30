import { createWelcomeDocument } from "@opendesign/editor-runtime";
import type { ProjectManifest } from "@opendesign/workspace-contracts";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@/shared/desktop-api";
import { AppNavigationCoordinator } from "../../router/app-navigation-coordinator";
import { WorkspaceRuntime } from "../../state/workspace-runtime";
import type { ProjectAutosaveCoordinator } from "./project-autosave";
import { useProjectNavigationController } from "./use-project-navigation-controller";

afterEach(() => {
  delete window.desktop;
});

describe("native project dialog cancellation", () => {
  it.each(["createProject", "openProject"] as const)(
    "reenables Workspace conversation entries after cancelling %s",
    async (operation) => {
      const dialog = deferred<ProjectManifest | null>();
      window.desktop = {
        [operation]: vi.fn(() => dialog.promise),
      } as unknown as DesktopApi;
      const { result, unmount } = navigationFixture();
      let opening!: Promise<unknown>;
      act(() => {
        opening = result.current[operation]();
      });
      expect(result.current.busy).toBe(true);

      await act(async () => {
        dialog.resolve(null);
        await opening;
      });

      expect(result.current.busy).toBe(false);
      unmount();
    },
  );

  it("does not release the newer navigation when an older dialog is cancelled", async () => {
    const oldDialog = deferred<ProjectManifest | null>();
    const newDialog = deferred<ProjectManifest | null>();
    window.desktop = {
      openProject: vi
        .fn()
        .mockReturnValueOnce(oldDialog.promise)
        .mockReturnValueOnce(newDialog.promise),
    } as unknown as DesktopApi;
    const { result, unmount } = navigationFixture();
    let oldOpen!: Promise<void>;
    let newOpen!: Promise<void>;
    act(() => {
      oldOpen = result.current.openProject();
      newOpen = result.current.openProject();
    });
    await act(async () => {
      oldDialog.resolve(null);
      await oldOpen;
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      newDialog.resolve(null);
      await newOpen;
    });
    expect(result.current.busy).toBe(false);
    unmount();
  });
});

function navigationFixture() {
  const workspace = new WorkspaceRuntime({
    projectId: "project_local",
    designFileId: "file_local",
    name: "Untitled",
    document: createWelcomeDocument(),
  });
  const navigator = new AppNavigationCoordinator({
    back: vi.fn(),
    navigate: vi.fn(),
  });
  return renderHook(() => {
    const [busy, setWorkspaceBusy] = useState(false);
    const navigation = useProjectNavigationController({
      activateFile: vi.fn(),
      activatePage: vi.fn(),
      applySavedProjectFile: vi.fn(),
      conversations: [],
      navigator,
      openFile: vi.fn(() => workspace.getActiveRuntime()),
      projectAutosave: {} as ProjectAutosaveCoordinator,
      projectContextId: "project_local",
      projectsById: {},
      replaceDocument: vi.fn(() => workspace.getActiveRuntime()),
      requestConversationHistory: vi.fn(),
      runtime: workspace.getActiveRuntime(),
      selectConversation: vi.fn(),
      setEditorError: vi.fn(),
      setProjectsById: vi.fn(),
      setRecentProjects: vi.fn(),
      setWorkspaceBusy,
      setWorkspaceError: vi.fn(),
      t: (key) => key,
      workspace,
      workspaceSnapshot: workspace.getSnapshot(),
    });
    return { ...navigation, busy };
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
