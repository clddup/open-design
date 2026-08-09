import {
  createEmptyDesignDocument,
  createWelcomeDocument,
} from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceRuntime, workspaceFileKey } from "./workspace-runtime";

function createWorkspace() {
  return new WorkspaceRuntime({
    projectId: "project_acme",
    designFileId: "design_mobile",
    name: "Mobile UI",
    document: createWelcomeDocument(),
  });
}

describe("WorkspaceRuntime", () => {
  it("keeps one writable EditorRuntime per open design file", () => {
    const workspace = createWorkspace();
    const mobile = workspace.getActiveRuntime();
    const websiteDocument = createEmptyDesignDocument(
      "document_website",
      "page_website",
    );
    const website = workspace.openFile(
      {
        projectId: "project_acme",
        designFileId: "design_website",
        name: "Website",
      },
      websiteDocument,
    );

    expect(workspace.getSnapshot()).toMatchObject({
      activeProjectId: "project_acme",
      activeDesignFileId: "design_website",
      openFileKeys: [
        workspaceFileKey("project_acme", "design_mobile"),
        workspaceFileKey("project_acme", "design_website"),
      ],
    });
    expect(workspace.getRuntime("project_acme", "design_mobile")).toBe(mobile);
    expect(workspace.getRuntime("project_acme", "design_website")).toBe(
      website,
    );
    expect(
      workspace.openFile(
        {
          projectId: "project_acme",
          designFileId: "design_mobile",
          name: "Mobile UI renamed",
        },
        createWelcomeDocument(),
      ),
    ).toBe(mobile);
  });

  it("allows matching design file IDs in different Projects without aliasing", () => {
    const workspace = createWorkspace();
    const acme = workspace.getActiveRuntime();
    const other = workspace.openFile(
      {
        projectId: "project_other",
        designFileId: "design_mobile",
        name: "Other Mobile UI",
      },
      createEmptyDesignDocument("document_other", "page_other"),
    );

    expect(other).not.toBe(acme);
    expect(workspace.getRuntime("project_acme", "design_mobile")).toBe(acme);
    expect(workspace.getRuntime("project_other", "design_mobile")).toBe(other);
    expect(workspace.getSnapshot().openFileKeys).toHaveLength(2);
  });

  it("preserves per-file viewport, selection, history, and dirty state", () => {
    const workspace = createWorkspace();
    const mobile = workspace.getActiveRuntime();
    mobile.setViewport({ zoom: 1.5, panX: 24 });
    mobile.setSelection(["title_welcome"], "title_welcome");
    mobile.apply({
      transactionId: "transaction_mobile",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "user", id: "local-user" },
      label: "Rename title",
      commands: [
        {
          commandId: "rename_title",
          type: "update_properties",
          nodeId: "title_welcome",
          name: "Mobile title",
        },
      ],
    });
    workspace.openFile(
      {
        projectId: "project_other",
        designFileId: "design_brand",
        name: "Brand System",
      },
      createEmptyDesignDocument("document_brand", "page_brand"),
    );
    workspace.getActiveRuntime().setViewport({ zoom: 0.75 });

    workspace.activateFile("project_acme", "design_mobile");
    expect(workspace.getActiveRuntime()).toBe(mobile);
    expect(mobile.getSnapshot()).toMatchObject({
      state: {
        dirty: true,
        viewport: { zoom: 1.5, panX: 24 },
        selection: { nodeIds: ["title_welcome"] },
        history: { canUndo: true },
      },
    });
  });

  it("tracks the active page independently and clears off-page selection", () => {
    const document = structuredClone(createWelcomeDocument());
    document.pageOrder.push("page_archive");
    document.pagesById.page_archive = {
      id: "page_archive",
      name: "Archive",
      rootNodeIds: [],
      extensions: {},
    };
    const workspace = new WorkspaceRuntime({
      projectId: "project_acme",
      designFileId: "design_mobile",
      name: "Mobile UI",
      document,
    });
    const runtime = workspace.getActiveRuntime();
    runtime.setSelection(["title_welcome"], "title_welcome");

    workspace.activatePage("page_archive");

    expect(
      workspace.getSnapshot().files[
        workspaceFileKey("project_acme", "design_mobile")
      ]?.activePageId,
    ).toBe("page_archive");
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([]);
    expect(() => workspace.activatePage("page_missing")).toThrow(
      "Page is not part of the active design file",
    );
  });

  it("retains files used by background runs when editor tabs close", () => {
    const workspace = createWorkspace();
    workspace.openFile(
      {
        projectId: "project_acme",
        designFileId: "design_website",
        name: "Website",
      },
      createEmptyDesignDocument("document_website", "page_website"),
    );
    workspace.retainFileForRun("project_acme", "design_website", "run_1");
    workspace.activateFile("project_acme", "design_mobile");

    expect(workspace.closeFile("project_acme", "design_website")).toBe(false);
    workspace.releaseFileForRun("project_acme", "design_website", "run_1");
    expect(workspace.closeFile("project_acme", "design_website")).toBe(true);
    expect(workspace.getRuntime("project_acme", "design_website")).toBeNull();
  });

  it("renames a file without replacing its writable runtime", () => {
    const workspace = createWorkspace();
    const runtime = workspace.getActiveRuntime();

    workspace.renameFile("project_acme", "design_mobile", "Mobile App");

    expect(workspace.getActiveRuntime()).toBe(runtime);
    expect(
      workspace.getSnapshot().files[
        workspaceFileKey("project_acme", "design_mobile")
      ]?.name,
    ).toBe("Mobile App");
  });

  it("publishes immutable snapshots when workspace identity changes", () => {
    const workspace = createWorkspace();
    const listener = vi.fn();
    const unsubscribe = workspace.subscribe(listener);
    const before = workspace.getSnapshot();

    workspace.openFile(
      {
        projectId: "project_acme",
        designFileId: "design_website",
        name: "Website",
      },
      createEmptyDesignDocument("document_website", "page_website"),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(workspace.getSnapshot()).not.toBe(before);
    expect(Object.isFrozen(workspace.getSnapshot())).toBe(true);
    unsubscribe();
  });
});
