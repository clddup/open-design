import {
  createEmptyDesignDocument,
  createWelcomeDocument,
} from "@opendesign/editor-runtime";
import {
  PROJECT_MANIFEST_VERSION,
  WORKSPACE_CONTRACT_VERSION,
  type ConversationDescriptor,
  type DesignFileDescriptor,
  type DesignTarget,
  type GlobalTaskProjection,
  type RootGrant,
} from "@opendesign/workspace-contracts";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  PROJECT_MANIFEST_NAME,
  PROJECT_SAVE_JOURNAL_NAME,
  ProjectHost,
  ProjectHostError,
} from "./project-host.js";
import { WorkspaceStore } from "./workspace-store.js";

const now = "2026-08-07T12:00:00.000Z";
const later = "2026-08-07T12:01:00.000Z";

function designFileDescriptor(
  overrides: Partial<DesignFileDescriptor> = {},
): DesignFileDescriptor {
  return {
    designFileId: "design_mobile",
    documentId: "document_welcome",
    name: "Mobile UI",
    relativePath: "designs/mobile-ui.opendesign",
    createdAt: now,
    updatedAt: now,
    lifecycle: "active",
    ...overrides,
  };
}

function designTarget(overrides: Partial<DesignTarget> = {}): DesignTarget {
  return {
    targetId: "target_mobile",
    projectId: "project_acme",
    designFileId: "design_mobile",
    documentId: "document_welcome",
    pageId: "page_welcome",
    selectedNodeIds: [],
    baseRevision: 0,
    ...overrides,
  };
}

async function createProjectRoot() {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-project-host-"));
  return join(directory, "Acme Design");
}

function hash(contents: string) {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

describe("ProjectHost", () => {
  it("replaces untouched legacy product templates with one neutral blank file", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    const mobile = structuredClone(
      createEmptyDesignDocument("document_legacy_mobile", "page_legacy_mobile"),
    );
    const website = structuredClone(
      createEmptyDesignDocument(
        "document_legacy_website",
        "page_legacy_website",
      ),
    );
    mobile.extensions = { template: "starter-project" };
    website.extensions = { template: "starter-project" };
    const mobileDescriptor = designFileDescriptor({
      designFileId: "design_legacy_mobile",
      documentId: mobile.documentId,
      name: "Mobile UI",
      relativePath: "designs/mobile-ui.opendesign",
    });
    const websiteDescriptor = designFileDescriptor({
      designFileId: "design_legacy_website",
      documentId: website.documentId,
      name: "Website",
      relativePath: "designs/website.opendesign",
    });
    await host.createProject(
      root,
      { projectId: "project_acme", name: "Acme Design", now },
      [
        { descriptor: mobileDescriptor, document: mobile },
        { descriptor: websiteDescriptor, document: website },
      ],
    );

    const reopened = new ProjectHost();
    const manifest = await reopened.openProject(root);

    expect(manifest.designFiles).toEqual([
      expect.objectContaining({
        designFileId: "design_project_acme_untitled",
        name: "Untitled",
        relativePath: "designs/untitled.opendesign",
      }),
    ]);
    const blank = await reopened.readDesignFile(
      "project_acme",
      "design_project_acme_untitled",
    );
    expect(blank.document.pageOrder).toHaveLength(1);
    expect(blank.document.nodesById).toEqual({});
    await expect(
      readFile(join(root, mobileDescriptor.relativePath), "utf8"),
    ).resolves.toContain("document_legacy_mobile");
    await expect(
      readFile(join(root, websiteDescriptor.relativePath), "utf8"),
    ).resolves.toContain("document_legacy_website");
  });

  it("creates a folder project without persisting host paths", async () => {
    const root = await createProjectRoot();
    const store = new WorkspaceStore(":memory:");
    const host = new ProjectHost(store);

    const manifest = await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });

    expect(manifest).toEqual({
      manifestVersion: PROJECT_MANIFEST_VERSION,
      projectId: "project_acme",
      name: "Acme Design",
      createdAt: now,
      updatedAt: now,
      lifecycle: "active",
      designFiles: [],
    });
    const contents = await readFile(join(root, PROJECT_MANIFEST_NAME), "utf8");
    expect(contents).not.toContain(root);
    expect(contents).not.toContain("conversation");
    expect(contents).not.toContain("credential");
    expect(store.listRecentProjects()).toEqual([
      expect.objectContaining({
        projectId: "project_acme",
        name: "Acme Design",
      }),
    ]);
    expect(store.listRecentProjects()[0]).not.toHaveProperty("rootPath");
    store.close();
  });

  it("creates, saves, and reopens a structured design file by stable identity", async () => {
    const root = await createProjectRoot();
    const store = new WorkspaceStore(":memory:");
    const host = new ProjectHost(store);
    await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });
    const document = createWelcomeDocument();
    const descriptor = designFileDescriptor();

    await host.createDesignFile("project_acme", { descriptor, document });
    const reopenedHost = new ProjectHost(store);
    const manifest = await reopenedHost.openRecentProject("project_acme");
    expect(manifest.designFiles).toEqual([descriptor]);
    expect(
      await reopenedHost.readDesignFile("project_acme", "design_mobile"),
    ).toEqual({ descriptor, document });

    const updated = structuredClone(document);
    const frame = updated.nodesById.frame_welcome;
    if (!frame) throw new Error("Welcome frame is missing");
    frame.name = "Updated mobile canvas";
    const saved = await reopenedHost.saveDesignFile(
      "project_acme",
      "design_mobile",
      updated,
      later,
    );
    expect(saved.descriptor.updatedAt).toBe(later);

    const thirdHost = new ProjectHost(store);
    const reopenedManifest = await thirdHost.openProject(root);
    expect(reopenedManifest.updatedAt).toBe(later);
    expect(
      (await thirdHost.readDesignFile("project_acme", "design_mobile")).document
        .nodesById.frame_welcome?.name,
    ).toBe("Updated mobile canvas");
    store.close();
  });

  it("renames a design file without changing its identity, path, or document", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });
    const document = createWelcomeDocument();
    const descriptor = designFileDescriptor();
    await host.createDesignFile("project_acme", { descriptor, document });
    const documentPath = join(root, descriptor.relativePath);
    const beforeDocument = await readFile(documentPath, "utf8");

    const renamed = await host.renameDesignFile(
      "project_acme",
      "design_mobile",
      "Launch poster",
      later,
    );

    expect(renamed).toEqual({
      ...descriptor,
      name: "Launch poster",
      updatedAt: later,
    });
    expect(await readFile(documentPath, "utf8")).toBe(beforeDocument);
    const reopened = new ProjectHost();
    const manifest = await reopened.openProject(root);
    expect(manifest.updatedAt).toBe(later);
    expect(manifest.designFiles[0]).toEqual(renamed);
    await expect(
      reopened.readDesignFile("project_acme", "design_mobile"),
    ).resolves.toEqual({ descriptor: renamed, document });
  });

  it("serializes a manifest rename with a document save without losing either", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });
    const document = createWelcomeDocument();
    const descriptor = designFileDescriptor();
    await host.createDesignFile("project_acme", { descriptor, document });
    const updated = structuredClone(document);
    const frame = updated.nodesById.frame_welcome;
    if (!frame) throw new Error("Welcome frame is missing");
    frame.name = "Saved after rename";

    await Promise.all([
      host.renameDesignFile(
        "project_acme",
        "design_mobile",
        "Launch poster",
        later,
      ),
      host.saveDesignFile("project_acme", "design_mobile", updated, later),
    ]);

    const reopened = new ProjectHost();
    await reopened.openProject(root);
    const file = await reopened.readDesignFile("project_acme", "design_mobile");
    expect(file.descriptor.name).toBe("Launch poster");
    expect(file.document.nodesById.frame_welcome?.name).toBe(
      "Saved after rename",
    );
  });

  it("allows duplicate display names while preserving distinct file identities", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });
    const mobileDocument = createWelcomeDocument();
    const websiteDocument = structuredClone(mobileDocument);
    websiteDocument.documentId = "document_website";
    const mobileDescriptor = designFileDescriptor();
    const websiteDescriptor = designFileDescriptor({
      designFileId: "design_website",
      documentId: "document_website",
      name: "Website",
      relativePath: "designs/website.opendesign",
    });
    await host.createDesignFile("project_acme", {
      descriptor: mobileDescriptor,
      document: mobileDocument,
    });
    await host.createDesignFile("project_acme", {
      descriptor: websiteDescriptor,
      document: websiteDocument,
    });

    await host.renameDesignFile(
      "project_acme",
      "design_website",
      "Mobile UI",
      later,
    );

    expect(
      host
        .listOpenProjects()[0]
        ?.designFiles.map(({ designFileId, name }) => ({ designFileId, name })),
    ).toEqual([
      { designFileId: "design_mobile", name: "Mobile UI" },
      { designFileId: "design_website", name: "Mobile UI" },
    ]);
  });

  it("rejects invalid or unknown design file rename targets", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });

    await expect(
      host.renameDesignFile("project_acme", "design_missing", "Missing"),
    ).rejects.toMatchObject({ code: "DESIGN_FILE_NOT_FOUND" });
    await expect(
      host.renameDesignFile("project_acme", "design_missing", "   "),
    ).rejects.toMatchObject({ code: "INVALID_DESIGN_FILE" });
  });

  it("serializes concurrent design file creation without losing manifest entries", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });
    const mobileDocument = createWelcomeDocument();
    const websiteDocument = structuredClone(mobileDocument);
    websiteDocument.documentId = "document_website";
    const mobileDescriptor = designFileDescriptor();
    const websiteDescriptor = designFileDescriptor({
      designFileId: "design_website",
      documentId: "document_website",
      name: "Website",
      relativePath: "designs/website.opendesign",
    });

    await Promise.all([
      host.createDesignFile("project_acme", {
        descriptor: mobileDescriptor,
        document: mobileDocument,
      }),
      host.createDesignFile("project_acme", {
        descriptor: websiteDescriptor,
        document: websiteDocument,
      }),
    ]);

    const reopened = new ProjectHost();
    const manifest = await reopened.openProject(root);
    expect(manifest.designFiles).toEqual([mobileDescriptor, websiteDescriptor]);
    await expect(
      reopened.readDesignFile("project_acme", "design_mobile"),
    ).resolves.toMatchObject({ descriptor: mobileDescriptor });
    await expect(
      reopened.readDesignFile("project_acme", "design_website"),
    ).resolves.toMatchObject({ descriptor: websiteDescriptor });
  });

  it("finishes an interrupted multi-file Project initialization on reopen", async () => {
    const root = await createProjectRoot();
    await mkdir(join(root, "designs"), { recursive: true });
    const mobileDocument = createWelcomeDocument();
    const websiteDocument = createEmptyDesignDocument(
      "document_website",
      "page_website",
    );
    const mobileDescriptor = designFileDescriptor();
    const websiteDescriptor = designFileDescriptor({
      designFileId: "design_website",
      documentId: "document_website",
      name: "Website",
      relativePath: "designs/website.opendesign",
    });
    const nextManifest = {
      manifestVersion: PROJECT_MANIFEST_VERSION,
      projectId: "project_acme",
      name: "Acme Design",
      createdAt: now,
      updatedAt: now,
      lifecycle: "active" as const,
      designFiles: [mobileDescriptor, websiteDescriptor],
    };
    const files = [
      { descriptor: mobileDescriptor, document: mobileDocument },
      { descriptor: websiteDescriptor, document: websiteDocument },
    ];
    await writeFile(
      join(root, PROJECT_SAVE_JOURNAL_NAME),
      JSON.stringify({
        version: 1,
        operation: "initialize",
        projectId: "project_acme",
        previousManifestHash: null,
        nextManifestHash: hash(JSON.stringify(nextManifest, null, 2)),
        nextManifest,
        designFiles: files.map(({ descriptor, document }) => ({
          designFileId: descriptor.designFileId,
          documentId: descriptor.documentId,
          relativePath: descriptor.relativePath,
          nextDocumentHash: hash(JSON.stringify(document, null, 2)),
          nextDocument: document,
        })),
      }),
    );
    await writeFile(
      join(root, mobileDescriptor.relativePath),
      JSON.stringify(mobileDocument, null, 2),
    );

    const reopened = new ProjectHost();
    await expect(reopened.openProject(root)).resolves.toEqual(nextManifest);
    await expect(
      reopened.readDesignFile("project_acme", "design_mobile"),
    ).resolves.toEqual({
      descriptor: mobileDescriptor,
      document: mobileDocument,
    });
    await expect(
      reopened.readDesignFile("project_acme", "design_website"),
    ).resolves.toEqual({
      descriptor: websiteDescriptor,
      document: websiteDocument,
    });
    await expect(
      readFile(join(root, PROJECT_SAVE_JOURNAL_NAME), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses interrupted initialization after an external file change", async () => {
    const root = await createProjectRoot();
    await mkdir(join(root, "designs"), { recursive: true });
    const document = createWelcomeDocument();
    const descriptor = designFileDescriptor();
    const nextManifest = {
      manifestVersion: PROJECT_MANIFEST_VERSION,
      projectId: "project_acme",
      name: "Acme Design",
      createdAt: now,
      updatedAt: now,
      lifecycle: "active" as const,
      designFiles: [descriptor],
    };
    await writeFile(
      join(root, PROJECT_SAVE_JOURNAL_NAME),
      JSON.stringify({
        version: 1,
        operation: "initialize",
        projectId: "project_acme",
        previousManifestHash: null,
        nextManifestHash: hash(JSON.stringify(nextManifest, null, 2)),
        nextManifest,
        designFiles: [
          {
            designFileId: descriptor.designFileId,
            documentId: descriptor.documentId,
            relativePath: descriptor.relativePath,
            nextDocumentHash: hash(JSON.stringify(document, null, 2)),
            nextDocument: document,
          },
        ],
      }),
    );
    await writeFile(join(root, descriptor.relativePath), "externally changed");

    let error: unknown;
    try {
      await new ProjectHost().openProject(root);
    } catch (reason) {
      error = reason;
    }
    expect(error).toBeInstanceOf(ProjectHostError);
    if (!(error instanceof ProjectHostError)) return;
    expect(error.code).toBe("INVALID_PROJECT");
    expect(error.message).toContain("changed outside OpenDesign");
    expect(await readFile(join(root, descriptor.relativePath), "utf8")).toBe(
      "externally changed",
    );
  });

  it("finishes an interrupted document and manifest save on reopen", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    const manifest = await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });
    const document = createWelcomeDocument();
    const descriptor = designFileDescriptor();
    await host.createDesignFile("project_acme", { descriptor, document });

    const previousManifestContents = await readFile(
      join(root, PROJECT_MANIFEST_NAME),
      "utf8",
    );
    const previousDocumentContents = await readFile(
      join(root, descriptor.relativePath),
      "utf8",
    );
    const nextDocument = structuredClone(document);
    const frame = nextDocument.nodesById.frame_welcome;
    if (!frame) throw new Error("Welcome frame is missing");
    frame.name = "Recovered frame";
    const nextDescriptor = { ...descriptor, updatedAt: later };
    const nextManifest = {
      ...manifest,
      updatedAt: later,
      designFiles: [nextDescriptor],
    };
    const nextDocumentContents = JSON.stringify(nextDocument, null, 2);
    const nextManifestContents = JSON.stringify(nextManifest, null, 2);
    await writeFile(
      join(root, PROJECT_SAVE_JOURNAL_NAME),
      JSON.stringify({
        version: 1,
        operation: "save",
        projectId: "project_acme",
        designFileId: descriptor.designFileId,
        documentId: descriptor.documentId,
        relativePath: descriptor.relativePath,
        previousDocumentHash: hash(previousDocumentContents),
        nextDocumentHash: hash(nextDocumentContents),
        previousManifestHash: hash(previousManifestContents),
        nextManifestHash: hash(nextManifestContents),
        nextDocument,
        nextManifest,
      }),
    );
    await writeFile(join(root, descriptor.relativePath), nextDocumentContents);

    const reopened = new ProjectHost();
    await expect(reopened.openProject(root)).resolves.toEqual(nextManifest);
    expect(
      (await reopened.readDesignFile("project_acme", "design_mobile")).document
        .nodesById.frame_welcome?.name,
    ).toBe("Recovered frame");
    await expect(
      readFile(join(root, PROJECT_SAVE_JOURNAL_NAME), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("finishes an interrupted manifest-only design file rename on reopen", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });
    const document = createWelcomeDocument();
    const descriptor = designFileDescriptor();
    await host.createDesignFile("project_acme", { descriptor, document });
    const previousManifest = host.listOpenProjects()[0];
    if (!previousManifest) throw new Error("Open Project manifest is missing");
    const nextDescriptor = {
      ...descriptor,
      name: "Recovered name",
      updatedAt: later,
    };
    const nextManifest = {
      ...previousManifest,
      updatedAt: later,
      designFiles: [nextDescriptor],
    };
    const previousManifestContents = JSON.stringify(previousManifest, null, 2);
    const nextManifestContents = JSON.stringify(nextManifest, null, 2);
    await writeFile(
      join(root, PROJECT_SAVE_JOURNAL_NAME),
      JSON.stringify({
        version: 1,
        operation: "rename",
        projectId: "project_acme",
        designFileId: "design_mobile",
        previousManifestHash: hash(previousManifestContents),
        nextManifestHash: hash(nextManifestContents),
        previousManifest,
        nextManifest,
      }),
    );

    const reopened = new ProjectHost();
    await expect(reopened.openProject(root)).resolves.toEqual(nextManifest);
    await expect(
      reopened.readDesignFile("project_acme", "design_mobile"),
    ).resolves.toEqual({ descriptor: nextDescriptor, document });
    await expect(
      readFile(join(root, PROJECT_SAVE_JOURNAL_NAME), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses interrupted-save recovery after an external file change", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    const manifest = await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });
    const document = createWelcomeDocument();
    const descriptor = designFileDescriptor();
    await host.createDesignFile("project_acme", { descriptor, document });
    const manifestContents = await readFile(
      join(root, PROJECT_MANIFEST_NAME),
      "utf8",
    );
    const documentContents = await readFile(
      join(root, descriptor.relativePath),
      "utf8",
    );
    const nextManifest = {
      ...manifest,
      updatedAt: later,
      designFiles: [{ ...descriptor, updatedAt: later }],
    };
    const nextManifestContents = JSON.stringify(nextManifest, null, 2);
    await writeFile(
      join(root, PROJECT_SAVE_JOURNAL_NAME),
      JSON.stringify({
        version: 1,
        operation: "save",
        projectId: "project_acme",
        designFileId: descriptor.designFileId,
        documentId: descriptor.documentId,
        relativePath: descriptor.relativePath,
        previousDocumentHash: hash(documentContents),
        nextDocumentHash: hash(documentContents),
        previousManifestHash: hash(manifestContents),
        nextManifestHash: hash(nextManifestContents),
        nextDocument: document,
        nextManifest,
      }),
    );
    await writeFile(join(root, descriptor.relativePath), "externally changed");

    let error: unknown;
    try {
      await new ProjectHost().openProject(root);
    } catch (reason) {
      error = reason;
    }
    expect(error).toBeInstanceOf(ProjectHostError);
    if (!(error instanceof ProjectHostError)) return;
    expect(error.code).toBe("INVALID_PROJECT");
    expect(error.message).toContain("changed outside OpenDesign");
    expect(await readFile(join(root, descriptor.relativePath), "utf8")).toBe(
      "externally changed",
    );
  });

  it("rejects path traversal and document identity substitution", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });
    const document = createWelcomeDocument();

    await expect(
      host.createDesignFile("project_acme", {
        descriptor: designFileDescriptor({
          relativePath: "../outside.opendesign",
        }),
        document,
      }),
    ).rejects.toMatchObject({ code: "INVALID_DESIGN_FILE" });

    const substituted = structuredClone(document);
    substituted.documentId = "document_substituted";
    await expect(
      host.createDesignFile("project_acme", {
        descriptor: designFileDescriptor(),
        document: substituted,
      }),
    ).rejects.toMatchObject({ code: "INVALID_DESIGN_FILE" });
  });

  it("rejects manifest entries that traverse project symlinks", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    const manifest = await host.createProject(root, {
      projectId: "project_acme",
      name: "Acme Design",
      now,
    });
    const outsideDirectory = await mkdtemp(
      join(tmpdir(), "opendesign-project-outside-"),
    );
    const outsideFile = join(outsideDirectory, "outside.opendesign");
    await writeFile(outsideFile, JSON.stringify(createWelcomeDocument()));
    await symlink(outsideFile, join(root, "designs", "linked.opendesign"));
    await writeFile(
      join(root, PROJECT_MANIFEST_NAME),
      JSON.stringify({
        ...manifest,
        designFiles: [
          designFileDescriptor({
            relativePath: "designs/linked.opendesign",
          }),
        ],
      }),
    );

    let error: unknown;
    try {
      await new ProjectHost().openProject(root);
    } catch (reason) {
      error = reason;
    }
    expect(error).toBeInstanceOf(ProjectHostError);
    if (!(error instanceof ProjectHostError)) return;
    expect(error.code).toBe("SYMLINK_NOT_ALLOWED");
  });
});

describe("WorkspaceStore", () => {
  it("migrates legacy Project roots so a stale path can be detached", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-workspace-"));
    const databasePath = join(directory, "workspace.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        last_opened_at TEXT NOT NULL,
        is_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_visible IN (0, 1))
      );
    `);
    legacy
      .prepare(
        `
          INSERT INTO projects(
            project_id,
            name,
            root_path,
            last_opened_at,
            is_visible
          ) VALUES (?, ?, ?, ?, 0)
        `,
      )
      .run("project_old", "Old", "/tmp/opendesign-reused", now);
    legacy.close();

    const store = new WorkspaceStore(databasePath);
    expect(
      store.upsertProject({
        projectId: "project_new",
        name: "New",
        rootPath: "/tmp/opendesign-reused",
        lastOpenedAt: later,
        reveal: true,
      }),
    ).toEqual({ displacedProjectId: "project_old" });
    expect(store.getProjectRoot("project_old")).toBeNull();
    expect(store.getProjectRoot("project_new")).toBe("/tmp/opendesign-reused");
    store.close();

    const migrated = new DatabaseSync(databasePath);
    const rootColumn = migrated
      .prepare("PRAGMA table_info(projects)")
      .all()
      .find((column) => (column as { name: string }).name === "root_path") as
      { notnull: number } | undefined;
    expect(rootColumn?.notnull).toBe(0);
    migrated.close();
  });

  it("persists bounded application preferences without exposing host paths", () => {
    const store = new WorkspaceStore(":memory:");

    expect(store.getPreference("locale")).toBeNull();
    store.setPreference("locale", "zh-CN");
    expect(store.getPreference("locale")).toBe("zh-CN");
    store.setPreference("locale", "en");
    expect(store.getPreference("locale")).toBe("en");
    expect(() => store.setPreference("../locale", "en")).toThrow(
      "Invalid preference key",
    );
    expect(() => store.setPreference("locale", "x".repeat(262_145))).toThrow(
      "Preference value exceeds the 256 KB limit",
    );
    store.close();
  });

  it("persists path-free conversation, grant, and global task projections", () => {
    const store = new WorkspaceStore(":memory:");
    const conversation: ConversationDescriptor = {
      conversationId: "conversation_1",
      homeProjectId: "project_acme",
      title: "Refine the mobile experience",
      createdAt: now,
      updatedAt: now,
      lifecycle: "active",
    };
    const grant: RootGrant = {
      version: WORKSPACE_CONTRACT_VERSION,
      rootGrantId: "grant_assets",
      rootId: "root_assets",
      name: "Shared assets",
      scope: { type: "conversation", conversationId: "conversation_1" },
      permissions: ["read"],
      discoverProjectConfig: false,
      lifecycle: "active",
      createdAt: now,
    };
    const primaryTarget = designTarget();
    const task: GlobalTaskProjection = {
      version: WORKSPACE_CONTRACT_VERSION,
      taskId: "task_1",
      conversationId: "conversation_1",
      homeProjectId: "project_acme",
      runId: "run_1",
      title: "Refine the mobile experience",
      lifecycle: "running",
      targetSet: { targets: [primaryTarget], primaryTarget },
      createdAt: now,
      updatedAt: now,
    };

    store.createConversation(conversation);
    store.saveRootGrant(grant);
    store.saveGlobalTask(task);

    expect(store.getConversation(conversation.conversationId)).toEqual(
      conversation,
    );
    expect(store.getConversation("conversation_missing")).toBeNull();
    expect(store.listConversations("project_acme")).toEqual([conversation]);
    expect(store.listRootGrants()).toEqual([grant]);
    expect(store.listGlobalTasks()).toEqual([task]);
    store.close();
  });

  it("rejects duplicate Conversation creation and implicit Home Project moves", () => {
    const store = new WorkspaceStore(":memory:");
    const conversation: ConversationDescriptor = {
      conversationId: "conversation_1",
      homeProjectId: "project_acme",
      title: "Refine the mobile experience",
      createdAt: now,
      updatedAt: now,
      lifecycle: "active",
    };

    store.createConversation(conversation);
    expect(() => store.createConversation(conversation)).toThrow();
    expect(() =>
      store.saveConversation({
        ...conversation,
        homeProjectId: "project_other",
        updatedAt: "2026-08-07T13:00:00.000Z",
      }),
    ).toThrow("Conversation Home Project cannot be changed by save");
    expect(store.listConversations("project_acme")).toEqual([conversation]);
    expect(store.listConversations("project_other")).toEqual([]);
    store.close();
  });
});
