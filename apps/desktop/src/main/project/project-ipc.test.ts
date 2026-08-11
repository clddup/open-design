import { createWelcomeDocument } from "@opendesign/editor-runtime";
import {
  WORKSPACE_CONTRACT_VERSION,
  type DesignFileDescriptor,
  type GlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createStarterProjectFiles } from "../../shared/project/starter-project.js";
import { ProjectHost } from "./project-host.js";
import { ProjectIpcService } from "./project-ipc.js";
import { WorkspaceStore } from "./workspace-store.js";

const now = "2026-08-07T12:00:00.000Z";

function designFileDescriptor(
  overrides: Partial<DesignFileDescriptor> = {},
): DesignFileDescriptor {
  return {
    designFileId: "design_brand",
    documentId: "document_welcome",
    name: "Brand System",
    relativePath: "designs/brand-system.opendesign",
    createdAt: now,
    updatedAt: now,
    lifecycle: "active",
    ...overrides,
  };
}

async function projectRoot() {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-project-ipc-"));
  return join(directory, "Acme Design");
}

describe("ProjectIpcService", () => {
  it("returns null when the native directory selection is cancelled", async () => {
    const store = new WorkspaceStore(":memory:");
    const service = new ProjectIpcService(new ProjectHost(store), store, () =>
      Promise.resolve(null),
    );

    await expect(
      service.createProject({
        projectId: "project_acme",
        name: "Acme Design",
      }),
    ).resolves.toBeNull();
    await expect(service.openProject()).resolves.toBeNull();
    expect(service.listOpenProjects()).toEqual([]);
    store.close();
  });

  it("creates a Project and reads and saves its design files by stable IDs", async () => {
    const root = await projectRoot();
    const store = new WorkspaceStore(":memory:");
    const host = new ProjectHost(store);
    const service = new ProjectIpcService(host, store, () =>
      Promise.resolve(root),
    );
    const manifest = await service.createProject({
      projectId: "project_acme",
      name: "Acme Design",
    });
    if (!manifest)
      throw new Error("Project selection was unexpectedly cancelled");
    expect(manifest.designFiles.map(({ name }) => name)).toEqual(["Untitled"]);
    const blankStarter = await service.readDesignFile({
      projectId: "project_acme",
      designFileId: "design_project_acme_untitled",
    });
    expect(blankStarter.document.pageOrder).toHaveLength(1);
    expect(
      blankStarter.document.pagesById[blankStarter.document.pageOrder[0] ?? ""]
        ?.rootNodeIds,
    ).toHaveLength(0);

    const descriptor = designFileDescriptor({
      designFileId: "design_brand",
      name: "Brand System",
      relativePath: "designs/brand-system.opendesign",
    });
    const document = createWelcomeDocument();
    await expect(
      service.createDesignFile({
        projectId: "project_acme",
        descriptor,
        document,
      }),
    ).resolves.toEqual({ descriptor, document });
    await expect(
      service.readDesignFile({
        projectId: "project_acme",
        designFileId: "design_brand",
      }),
    ).resolves.toEqual({ descriptor, document });

    const updated = structuredClone(document);
    const frame = updated.nodesById.frame_welcome;
    if (!frame) throw new Error("Welcome frame is missing");
    frame.name = "Updated through Project IPC";
    const saved = await service.saveDesignFile({
      projectId: "project_acme",
      designFileId: "design_brand",
      document: updated,
    });
    expect(saved.document.nodesById.frame_welcome?.name).toBe(
      "Updated through Project IPC",
    );
    const renamed = await service.renameDesignFile({
      projectId: "project_acme",
      designFileId: "design_brand",
      name: "Launch poster",
    });
    expect(renamed).toMatchObject({
      designFileId: "design_brand",
      documentId: document.documentId,
      name: "Launch poster",
      relativePath: descriptor.relativePath,
    });
    expect(
      (
        await service.readDesignFile({
          projectId: "project_acme",
          designFileId: "design_brand",
        })
      ).document.nodesById.frame_welcome?.name,
    ).toBe("Updated through Project IPC");
    expect(service.listOpenProjects()).toHaveLength(1);
    expect(service.listRecentProjects()).toEqual([
      expect.objectContaining({
        projectId: "project_acme",
        name: "Acme Design",
      }),
    ]);
    expect(service.listRecentProjects()[0]).not.toHaveProperty("rootPath");
    await expect(
      service.openRecentProject({ projectId: "project_acme" }),
    ).resolves.toMatchObject({ projectId: "project_acme" });
    store.close();
  });

  it("removes a recent Project without deleting its bound directory", async () => {
    const root = await projectRoot();
    const store = new WorkspaceStore(":memory:");
    const reveal = vi.fn();
    const service = new ProjectIpcService(
      new ProjectHost(store),
      store,
      () => Promise.resolve(root),
      reveal,
    );
    const manifest = await service.createProject({
      projectId: "project_acme",
      name: "Acme Design",
    });
    if (!manifest)
      throw new Error("Project selection was unexpectedly cancelled");

    service.revealRecentProject({ projectId: manifest.projectId });
    expect(reveal).toHaveBeenCalledWith(await realpath(root));
    expect(
      service.removeRecentProject({ projectId: manifest.projectId }),
    ).toEqual([]);
    expect(store.getProjectRoot(manifest.projectId)).toBe(await realpath(root));

    await expect(service.openProject()).resolves.toMatchObject({
      projectId: manifest.projectId,
    });
    expect(service.listRecentProjects()).toEqual([
      expect.objectContaining({ projectId: manifest.projectId }),
    ]);
    store.close();
  });

  it("reclaims a removed Project path after its folder contents are deleted", async () => {
    const root = await projectRoot();
    const store = new WorkspaceStore(":memory:");
    const host = new ProjectHost(store);
    const service = new ProjectIpcService(host, store, () =>
      Promise.resolve(root),
    );
    const original = await service.createProject({
      projectId: "project_original",
      name: "Original",
    });
    if (!original)
      throw new Error("Project selection was unexpectedly cancelled");
    const conversation = service.createConversation({
      conversationId: "conversation_original",
      homeProjectId: original.projectId,
      title: "Original design work",
    });
    service.removeRecentProject({ projectId: original.projectId });
    await rm(root, { force: true, recursive: true });

    const replacement = await service.createProject({
      projectId: "project_replacement",
      name: "Replacement",
    });
    if (!replacement)
      throw new Error("Project selection was unexpectedly cancelled");

    expect(replacement.designFiles.map(({ name }) => name)).toEqual([
      "Untitled",
    ]);
    expect(store.getProjectRoot(original.projectId)).toBeNull();
    expect(store.getProjectRoot(replacement.projectId)).toBe(
      await realpath(root),
    );
    expect(store.listConversations(original.projectId)).toEqual([conversation]);
    expect(
      service.listOpenProjects().map(({ projectId }) => projectId),
    ).toEqual([replacement.projectId]);
    expect(service.listRecentProjects()).toEqual([
      expect.objectContaining({ projectId: replacement.projectId }),
    ]);
    store.close();
  });

  it("opens a valid Project left behind by an interrupted create retry", async () => {
    const root = await projectRoot();
    const orphanHost = new ProjectHost();
    const orphan = await orphanHost.createProject(
      root,
      { projectId: "project_orphan", name: "Recovered" },
      createStarterProjectFiles("project_orphan"),
    );
    const store = new WorkspaceStore(":memory:");
    store.upsertProject({
      projectId: "project_removed",
      name: "Removed",
      rootPath: await realpath(root),
      lastOpenedAt: now,
    });
    store.hideProject("project_removed");
    const service = new ProjectIpcService(new ProjectHost(store), store, () =>
      Promise.resolve(root),
    );

    await expect(
      service.createProject({
        projectId: "project_retry_request",
        name: "Retry request",
      }),
    ).resolves.toEqual(orphan);
    expect(store.getProjectRoot("project_removed")).toBeNull();
    expect(store.getProjectRoot(orphan.projectId)).toBe(await realpath(root));
    store.close();
  });

  it("reopens a saved structured file through a durable recent Project registration", async () => {
    const root = await projectRoot();
    const databasePath = `${root}.sqlite`;
    const firstStore = new WorkspaceStore(databasePath);
    const firstService = new ProjectIpcService(
      new ProjectHost(firstStore),
      firstStore,
      () => Promise.resolve(root),
    );
    const manifest = await firstService.createProject({
      projectId: "project_acme",
      name: "Acme Design",
    });
    if (!manifest)
      throw new Error("Project selection was unexpectedly cancelled");
    const descriptor = manifest.designFiles[0];
    if (!descriptor) throw new Error("Blank starter file is missing");
    const opened = await firstService.readDesignFile({
      projectId: manifest.projectId,
      designFileId: descriptor.designFileId,
    });
    const updated = structuredClone(opened.document);
    const page = updated.pagesById[updated.pageOrder[0] ?? ""];
    if (!page) throw new Error("Blank starter page is missing");
    page.name = "Persisted after restart";
    await firstService.saveDesignFile({
      projectId: manifest.projectId,
      designFileId: descriptor.designFileId,
      document: updated,
    });
    firstStore.close();

    const reopenedStore = new WorkspaceStore(databasePath);
    const reopenedService = new ProjectIpcService(
      new ProjectHost(reopenedStore),
      reopenedStore,
      () => Promise.resolve(null),
    );
    const reopenedManifest = await reopenedService.openRecentProject({
      projectId: manifest.projectId,
    });
    expect(reopenedManifest.projectId).toBe(manifest.projectId);
    expect(
      reopenedManifest.designFiles.find(
        (file) => file.designFileId === descriptor.designFileId,
      ),
    ).toMatchObject({ designFileId: descriptor.designFileId });
    const reopened = await reopenedService.readDesignFile({
      projectId: manifest.projectId,
      designFileId: descriptor.designFileId,
    });
    expect(reopened.document.pagesById[page.id]?.name).toBe(
      "Persisted after restart",
    );
    reopenedStore.close();
  });

  it("creates durable Conversations for registered Home Projects", async () => {
    const root = await projectRoot();
    const store = new WorkspaceStore(":memory:");
    const service = new ProjectIpcService(new ProjectHost(store), store, () =>
      Promise.resolve(root),
    );
    const manifest = await service.createProject({
      projectId: "project_acme",
      name: "Acme Design",
    });
    if (!manifest)
      throw new Error("Project selection was unexpectedly cancelled");

    const conversation = service.createConversation({
      conversationId: "conversation_mobile",
      homeProjectId: manifest.projectId,
      title: "Refine the mobile experience",
    });
    expect(conversation).toMatchObject({
      conversationId: "conversation_mobile",
      homeProjectId: manifest.projectId,
      title: "Refine the mobile experience",
      lifecycle: "active",
    });
    expect(conversation.createdAt).toBe(conversation.updatedAt);
    expect(
      service.listProjectConversations({ homeProjectId: manifest.projectId }),
    ).toEqual([conversation]);
    expect(() =>
      service.createConversation({
        conversationId: "conversation_mobile",
        homeProjectId: manifest.projectId,
        title: "Replace the existing Conversation",
      }),
    ).toThrow();
    expect(() =>
      service.createConversation({
        conversationId: "conversation_unknown",
        homeProjectId: "project_unknown",
        title: "Unknown Project",
      }),
    ).toThrow("Conversation Home Project is not registered");
    expect(() =>
      service.listProjectConversations({ homeProjectId: "project_unknown" }),
    ).toThrow("Conversation Home Project is not registered");
    store.close();
  });

  it("lists persisted Global Task projections", async () => {
    const root = await projectRoot();
    const store = new WorkspaceStore(":memory:");
    const service = new ProjectIpcService(new ProjectHost(store), store, () =>
      Promise.resolve(root),
    );
    const manifest = await service.createProject({
      projectId: "project_acme",
      name: "Acme Design",
    });
    if (!manifest)
      throw new Error("Project selection was unexpectedly cancelled");
    const file = manifest.designFiles[0];
    if (!file) throw new Error("Starter design file is missing");
    const opened = await service.readDesignFile({
      projectId: manifest.projectId,
      designFileId: file.designFileId,
    });
    const pageId = opened.document.pageOrder[0];
    if (!pageId) throw new Error("Starter design page is missing");
    const primaryTarget = {
      targetId: "target_mobile",
      projectId: manifest.projectId,
      designFileId: file.designFileId,
      documentId: file.documentId,
      pageId,
      selectedNodeIds: [],
      baseRevision: opened.document.revision,
    };
    const task: GlobalTaskProjection = {
      version: WORKSPACE_CONTRACT_VERSION,
      taskId: "task_mobile",
      conversationId: "conversation_mobile",
      homeProjectId: manifest.projectId,
      runId: "run_mobile",
      title: "Refine the mobile experience",
      lifecycle: "running",
      targetSet: { targets: [primaryTarget], primaryTarget },
      createdAt: now,
      updatedAt: now,
    };
    store.saveGlobalTask(task);

    expect(service.listGlobalTasks()).toEqual([task]);
    store.close();
  });

  it("rejects forged paths before opening a native picker", async () => {
    const selectDirectory = vi.fn(() =>
      Promise.resolve("/tmp/should-not-open"),
    );
    const store = new WorkspaceStore(":memory:");
    const service = new ProjectIpcService(
      new ProjectHost(store),
      store,
      selectDirectory,
    );

    await expect(
      service.createProject({
        projectId: "project_acme",
        name: "Acme Design",
        rootPath: "/tmp/forged",
      }),
    ).rejects.toThrow("Invalid Project create request");
    expect(selectDirectory).not.toHaveBeenCalled();
    expect(() =>
      service.readDesignFile({
        projectId: "project_acme",
        designFileId: "design_brand",
        path: "/tmp/forged.opendesign",
      }),
    ).toThrow("Invalid design file read request");
    expect(() =>
      service.renameDesignFile({
        projectId: "project_acme",
        designFileId: "design_brand",
        name: " Forged ",
      }),
    ).toThrow("Invalid design file rename request");
    store.close();
  });
});
