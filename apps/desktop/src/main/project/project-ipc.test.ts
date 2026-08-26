import {
  createEmptyDesignDocument,
  createWelcomeDocument,
} from "@opendesign/editor-runtime";
import {
  WORKSPACE_CONTRACT_VERSION,
  type DesignFileDescriptor,
  type GlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createStarterProjectFiles } from "@/shared/project/starter-project.js";
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
  it("publishes, enables, reads, and ignores Project Libraries through validated requests", async () => {
    const root = await projectRoot();
    const store = new WorkspaceStore(":memory:");
    const service = new ProjectIpcService(new ProjectHost(store), store, () =>
      Promise.resolve(root),
    );
    const manifest = await service.createProject({
      projectId: "project_acme",
    });
    if (!manifest) throw new Error("Project selection was cancelled");
    expect(manifest.name).toBe("Acme Design");
    const source = manifest.designFiles[0];
    if (!source) throw new Error("Source design file is missing");
    const consumerDocument = createEmptyDesignDocument(
      "document_consumer",
      "page_consumer",
    );
    const consumer = designFileDescriptor({
      designFileId: "design_consumer",
      documentId: consumerDocument.documentId,
      name: "Consumer",
      relativePath: "designs/consumer.opendesign",
    });
    await service.createDesignFile({
      projectId: manifest.projectId,
      descriptor: consumer,
      document: consumerDocument,
    });

    const published = await service.publishProjectLibrary({
      projectId: manifest.projectId,
      designFileId: source.designFileId,
      name: "Acme Library",
    });
    expect(
      await service.listProjectLibraries({ projectId: manifest.projectId }),
    ).toEqual(published.catalog);
    await expect(
      service.readProjectLibraryRelease({
        projectId: manifest.projectId,
        libraryId: published.entry.libraryId,
      }),
    ).resolves.toEqual(published.release);
    const enabled = await service.setProjectLibraryEnabled({
      projectId: manifest.projectId,
      designFileId: consumer.designFileId,
      libraryId: published.entry.libraryId,
      enabled: true,
    });
    expect(
      enabled.enabledLibraryIdsByDesignFileId[consumer.designFileId],
    ).toEqual([published.entry.libraryId]);
    const accepted = await service.setProjectLibraryUpdateAccepted({
      projectId: manifest.projectId,
      designFileId: consumer.designFileId,
      libraryId: published.entry.libraryId,
      releaseId: published.entry.latestReleaseId,
    });
    expect(
      accepted.acceptedReleaseIdsByDesignFileId[consumer.designFileId],
    ).toEqual({
      [published.entry.libraryId]: published.entry.latestReleaseId,
    });
    const ignored = await service.setProjectLibraryUpdateIgnored({
      projectId: manifest.projectId,
      designFileId: consumer.designFileId,
      libraryId: published.entry.libraryId,
      releaseId: published.entry.latestReleaseId,
    });
    expect(
      ignored.ignoredReleaseIdsByDesignFileId[consumer.designFileId],
    ).toEqual({
      [published.entry.libraryId]: published.entry.latestReleaseId,
    });
    expect(() =>
      service.setProjectLibraryEnabled({
        projectId: manifest.projectId,
        designFileId: consumer.designFileId,
        libraryId: published.entry.libraryId,
        enabled: true,
        path: "/tmp/forged",
      }),
    ).toThrow("Invalid Project Library enable request");
    store.close();
  });

  it("returns null when the native directory selection is cancelled", async () => {
    const store = new WorkspaceStore(":memory:");
    const service = new ProjectIpcService(new ProjectHost(store), store, () =>
      Promise.resolve(null),
    );

    await expect(
      service.createProject({
        projectId: "project_acme",
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
    });
    if (!original)
      throw new Error("Project selection was unexpectedly cancelled");
    const conversation = service.createConversation({
      conversationId: "conversation_original",
      filedProjectId: original.projectId,
      title: "Original design work",
    });
    service.removeRecentProject({ projectId: original.projectId });
    await rm(root, { force: true, recursive: true });

    const replacement = await service.createProject({
      projectId: "project_replacement",
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
    expect(store.listConversations()).toEqual([conversation]);
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

  it("creates and globally lists durable Conversations", async () => {
    const root = await projectRoot();
    const store = new WorkspaceStore(":memory:");
    const service = new ProjectIpcService(new ProjectHost(store), store, () =>
      Promise.resolve(root),
    );
    const manifest = await service.createProject({
      projectId: "project_acme",
    });
    if (!manifest)
      throw new Error("Project selection was unexpectedly cancelled");

    const conversation = service.createConversation({
      conversationId: "conversation_mobile",
      filedProjectId: manifest.projectId,
      title: "Refine the mobile experience",
    });
    expect(conversation).toMatchObject({
      conversationId: "conversation_mobile",
      originProjectId: manifest.projectId,
      filedProjectId: manifest.projectId,
      title: "Refine the mobile experience",
      lifecycle: "active",
    });
    expect(conversation.createdAt).toBe(conversation.updatedAt);
    expect(service.listConversations()).toEqual([conversation]);
    expect(() =>
      service.createConversation({
        conversationId: "conversation_mobile",
        filedProjectId: manifest.projectId,
        title: "Replace the existing Conversation",
      }),
    ).toThrow();
    expect(() =>
      service.createConversation({
        conversationId: "conversation_unknown",
        filedProjectId: "project_unknown",
        title: "Unknown Project",
      }),
    ).toThrow("Conversation Project is not registered");
    store.close();
  });

  it("resolves filed, active, recent, and unfiled Conversation targets", async () => {
    const root = await projectRoot();
    const store = new WorkspaceStore(":memory:");
    const service = new ProjectIpcService(new ProjectHost(store), store, () =>
      Promise.resolve(root),
    );
    const manifest = await service.createProject({
      projectId: "project_acme",
    });
    if (!manifest) throw new Error("Project selection was cancelled");
    const file = manifest.designFiles[0];
    if (!file) throw new Error("Starter design file is missing");
    const opened = await service.readDesignFile({
      projectId: manifest.projectId,
      designFileId: file.designFileId,
    });
    const pageId = opened.document.pageOrder[0];
    if (!pageId) throw new Error("Starter design page is missing");
    const conversation = service.createConversation({
      conversationId: "conversation_mobile",
      filedProjectId: manifest.projectId,
      title: "Refine the mobile experience",
    });

    await expect(
      service.resolveConversationOpenContext({
        conversationId: conversation.conversationId,
      }),
    ).resolves.toMatchObject({
      kind: "target-available",
      source: "filed-project",
      conversationId: conversation.conversationId,
      target: {
        projectId: manifest.projectId,
        designFileId: file.designFileId,
        pageId,
      },
    });

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
      conversationId: conversation.conversationId,
      runId: "run_mobile",
      title: conversation.title,
      lifecycle: "running",
      targetSet: { targets: [primaryTarget], primaryTarget },
      createdAt: now,
      updatedAt: now,
    };
    store.saveGlobalTask(task);
    await expect(
      service.resolveConversationOpenContext({
        conversationId: conversation.conversationId,
      }),
    ).resolves.toMatchObject({
      kind: "target-available",
      source: "active-task",
    });

    store.saveGlobalTask({ ...task, lifecycle: "completed" });
    await expect(
      service.resolveConversationOpenContext({
        conversationId: conversation.conversationId,
      }),
    ).resolves.toMatchObject({
      kind: "target-available",
      source: "recent-task",
    });

    store.saveConversation({
      ...conversation,
      filedProjectId: null,
      updatedAt: conversation.updatedAt,
    });
    const unfiled = service.createConversation({
      conversationId: "conversation_unfiled",
      filedProjectId: manifest.projectId,
      title: "Unfiled work",
    });
    store.saveConversation({
      ...unfiled,
      filedProjectId: null,
      updatedAt: unfiled.updatedAt,
    });
    await expect(
      service.resolveConversationOpenContext({
        conversationId: unfiled.conversationId,
      }),
    ).resolves.toEqual({
      kind: "target-unavailable",
      conversationId: unfiled.conversationId,
      reason: "no-target",
    });
    store.close();
  });

  it("tombstones terminal Conversations and rejects deleting active work", async () => {
    const root = await projectRoot();
    const store = new WorkspaceStore(":memory:");
    let hasActiveRun = true;
    const service = new ProjectIpcService(
      new ProjectHost(store),
      store,
      () => Promise.resolve(root),
      () => undefined,
      () => hasActiveRun,
    );
    const manifest = await service.createProject({
      projectId: "project_acme",
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
    const conversation = service.createConversation({
      conversationId: "conversation_mobile",
      filedProjectId: manifest.projectId,
      title: "Refine the mobile experience",
    });
    const primaryTarget = {
      targetId: "target_mobile",
      projectId: manifest.projectId,
      designFileId: file.designFileId,
      documentId: file.documentId,
      pageId,
      selectedNodeIds: [],
      baseRevision: opened.document.revision,
    };
    const activeTask: GlobalTaskProjection = {
      version: WORKSPACE_CONTRACT_VERSION,
      taskId: "task_mobile",
      conversationId: conversation.conversationId,
      runId: "run_mobile",
      title: conversation.title,
      lifecycle: "running",
      targetSet: { targets: [primaryTarget], primaryTarget },
      createdAt: now,
      updatedAt: now,
    };
    store.saveGlobalTask(activeTask);

    expect(() =>
      service.deleteConversation({
        conversationId: conversation.conversationId,
      }),
    ).toThrow("active task cannot be deleted");

    store.saveGlobalTask({
      ...activeTask,
      lifecycle: "completed",
      updatedAt: "2026-08-07T12:01:00.000Z",
    });
    hasActiveRun = false;
    expect(
      service.deleteConversation({
        conversationId: conversation.conversationId,
      }),
    ).toMatchObject({
      conversationId: conversation.conversationId,
      lifecycle: "deleted",
    });
    expect(service.listConversations()).toEqual([]);
    expect(service.listGlobalTasks()).toEqual([
      expect.objectContaining({
        taskId: activeTask.taskId,
        lifecycle: "completed",
      }),
    ]);
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
