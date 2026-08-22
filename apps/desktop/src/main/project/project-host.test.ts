import {
  createEmptyDesignDocument,
  createWelcomeDocument,
  EditorRuntime,
  planCreateLibraryInstance,
} from "@opendesign/editor-runtime";
import { resolveComponentInstance } from "@opendesign/component-service";
import { planLibraryReleaseUpdate } from "@opendesign/library-service";
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
  PROJECT_LIBRARY_CATALOG_PATH,
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
  it("publishes a Style-only Library and changes its release when Style content changes", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    const sourceDocument = structuredClone(
      createEmptyDesignDocument("document_styles", "page_styles"),
    );
    sourceDocument.stylesById.primary = {
      id: "primary",
      key: "primary-key",
      name: "Brand/Primary",
      description: "",
      hiddenFromPublishing: false,
      styleType: "PAINT",
      paints: [{ type: "solid", color: "#2563eb", opacity: 1 }],
      extensions: {},
    };
    sourceDocument.styleOrderByType.PAINT.push("primary");
    const sourceDescriptor = designFileDescriptor({
      designFileId: "design_styles",
      documentId: sourceDocument.documentId,
      name: "Shared Styles",
      relativePath: "designs/shared-styles.opendesign",
    });
    await host.createProject(
      root,
      { projectId: "project_acme", name: "Acme Design", now },
      [{ descriptor: sourceDescriptor, document: sourceDocument }],
    );

    const first = await host.publishDesignFileLibrary(
      "project_acme",
      sourceDescriptor.designFileId,
      "Acme Styles",
      now,
    );
    expect(first.release.componentsById).toEqual({});
    expect(first.release.variantSetsById).toEqual({});
    expect(first.release.stylesById.primary?.style).toMatchObject({
      styleType: "PAINT",
      paints: [{ color: "#2563eb" }],
    });

    const changedDocument = structuredClone(sourceDocument);
    changedDocument.revision = 1;
    const primary = changedDocument.stylesById.primary;
    if (primary?.styleType !== "PAINT") throw new Error("Missing Paint Style");
    primary.paints = [{ type: "solid", color: "#db2777", opacity: 1 }];
    await host.saveDesignFile(
      "project_acme",
      sourceDescriptor.designFileId,
      changedDocument,
      later,
    );
    const second = await host.publishDesignFileLibrary(
      "project_acme",
      sourceDescriptor.designFileId,
      undefined,
      later,
    );

    expect(second.entry.libraryId).toBe(first.entry.libraryId);
    expect(second.entry.latestReleaseId).not.toBe(first.entry.latestReleaseId);
    expect(second.entry.releases).toHaveLength(2);
    expect(second.release.stylesById.primary?.style).toMatchObject({
      paints: [{ color: "#db2777" }],
    });
  });

  it("publishes immutable component releases and explicitly enables them per consuming Design File", async () => {
    const root = await createProjectRoot();
    const host = new ProjectHost();
    const sourceDocument = structuredClone(createWelcomeDocument());
    sourceDocument.componentsById = {
      component_card: {
        id: "component_card",
        name: "Feature cards",
        rootNodeId: "feature_group",
        componentPropertyOrder: [],
        componentPropertyDefinitions: {},
        variantProperties: {},
        extensions: {},
      },
    };
    const sourceDescriptor = designFileDescriptor({
      designFileId: "design_library",
      name: "Design System",
      relativePath: "designs/design-system.opendesign",
    });
    const consumerDocument = createEmptyDesignDocument(
      "document_consumer",
      "page_consumer",
    );
    const consumerDescriptor = designFileDescriptor({
      designFileId: "design_consumer",
      documentId: consumerDocument.documentId,
      name: "Consumer",
      relativePath: "designs/consumer.opendesign",
    });
    await host.createProject(
      root,
      { projectId: "project_acme", name: "Acme Design", now },
      [
        { descriptor: sourceDescriptor, document: sourceDocument },
        { descriptor: consumerDescriptor, document: consumerDocument },
      ],
    );

    const first = await host.publishDesignFileLibrary(
      "project_acme",
      sourceDescriptor.designFileId,
      "Acme Library",
      now,
    );
    expect(first.release.componentsById.component_card).toMatchObject({
      source: {
        libraryId: first.entry.libraryId,
        releaseId: first.entry.latestReleaseId,
        sourceDesignFileId: sourceDescriptor.designFileId,
      },
      component: { id: "component_card", rootNodeId: "feature_group" },
    });
    expect(
      first.release.componentsById.component_card?.nodesById.frame_welcome,
    ).toBeUndefined();
    expect(
      first.release.componentsById.component_card?.nodesById.feature_group,
    ).toBeDefined();
    expect(
      first.release.componentsById.component_card?.nodesById.feature_group
        ?.parentId,
    ).toBeNull();
    await expect(
      readFile(join(root, PROJECT_LIBRARY_CATALOG_PATH), "utf8"),
    ).resolves.toContain(first.entry.libraryId);

    const enabled = await host.setProjectLibraryEnabled(
      "project_acme",
      consumerDescriptor.designFileId,
      first.entry.libraryId,
      true,
    );
    expect(
      enabled.enabledLibraryIdsByDesignFileId[consumerDescriptor.designFileId],
    ).toEqual([first.entry.libraryId]);

    const consumerRuntime = new EditorRuntime(consumerDocument);
    const instancePlan = planCreateLibraryInstance(
      consumerRuntime.getSnapshot().document,
      first.release,
      {
        componentId: "component_card",
        instanceId: "instance_library_card",
        pageId: "page_consumer",
        parentId: null,
        index: 0,
        transform: [1, 0, 0, 1, 64, 64],
        commandPrefix: "library_card",
      },
    );
    expect(instancePlan.ok).toBe(true);
    const placed = consumerRuntime.apply({
      transactionId: "place_library_card",
      documentId: consumerDocument.documentId,
      baseRevision: consumerDocument.revision,
      actor: { type: "user", id: "test" },
      label: "Place Library component",
      commands: instancePlan.ok ? instancePlan.commands : [],
    });
    expect(placed.ok).toBe(true);
    await host.saveDesignFile(
      "project_acme",
      consumerDescriptor.designFileId,
      consumerRuntime.getSnapshot().document,
      now,
    );
    const reopenedConsumer = await host.readDesignFile(
      "project_acme",
      consumerDescriptor.designFileId,
    );
    expect(
      resolveComponentInstance(
        reopenedConsumer.document,
        "instance_library_card",
      ).ok,
    ).toBe(true);

    const changedDocument = structuredClone(sourceDocument);
    changedDocument.revision = 1;
    const feature = changedDocument.nodesById.feature_one;
    if (feature?.kind !== "rectangle") throw new Error("Missing feature");
    feature.properties.fills = [
      { type: "solid", color: "#db2777", opacity: 1 },
    ];
    await host.saveDesignFile(
      "project_acme",
      sourceDescriptor.designFileId,
      changedDocument,
      later,
    );
    const second = await host.publishDesignFileLibrary(
      "project_acme",
      sourceDescriptor.designFileId,
      undefined,
      later,
    );
    expect(second.entry.libraryId).toBe(first.entry.libraryId);
    expect(second.entry.latestReleaseId).not.toBe(first.entry.latestReleaseId);
    expect(second.entry.releases).toHaveLength(2);
    await expect(
      host.readProjectLibraryRelease(
        "project_acme",
        first.entry.libraryId,
        first.entry.latestReleaseId,
      ),
    ).resolves.toMatchObject({ releaseId: first.entry.latestReleaseId });
    await expect(
      host.readProjectLibraryRelease("project_acme", first.entry.libraryId),
    ).resolves.toMatchObject({ releaseId: second.entry.latestReleaseId });

    const updateRuntime = new EditorRuntime(reopenedConsumer.document);
    const updatePlan = planLibraryReleaseUpdate(
      updateRuntime.getSnapshot().document,
      second.release,
      "accept_library_update",
    );
    const updated = updateRuntime.apply({
      transactionId: "accept_library_update",
      documentId: reopenedConsumer.document.documentId,
      baseRevision: reopenedConsumer.document.revision,
      actor: { type: "user", id: "test" },
      label: "Update Library components",
      commands: updatePlan.commands,
    });
    expect(updated.ok).toBe(true);
    await host.saveDesignFile(
      "project_acme",
      consumerDescriptor.designFileId,
      updateRuntime.getSnapshot().document,
      later,
    );
    const reopenedUpdatedConsumer = await host.readDesignFile(
      "project_acme",
      consumerDescriptor.designFileId,
    );
    const resolvedUpdated = resolveComponentInstance(
      reopenedUpdatedConsumer.document,
      "instance_library_card",
    );
    expect(resolvedUpdated.ok).toBe(true);
    expect(
      resolvedUpdated.ok
        ? resolvedUpdated.nodes.find(
            (candidate) => candidate.sourceNodeId === "feature_one",
          )?.node
        : null,
    ).toMatchObject({
      properties: {
        fills: [{ type: "solid", color: "#db2777", opacity: 1 }],
      },
    });

    const accepted = await host.setProjectLibraryUpdateAccepted(
      "project_acme",
      consumerDescriptor.designFileId,
      first.entry.libraryId,
      second.entry.latestReleaseId,
    );
    expect(
      accepted.acceptedReleaseIdsByDesignFileId[
        consumerDescriptor.designFileId
      ],
    ).toEqual({ [first.entry.libraryId]: second.entry.latestReleaseId });

    const ignored = await host.setProjectLibraryUpdateIgnored(
      "project_acme",
      consumerDescriptor.designFileId,
      first.entry.libraryId,
      second.entry.latestReleaseId,
    );
    expect(
      ignored.ignoredReleaseIdsByDesignFileId[consumerDescriptor.designFileId],
    ).toEqual({ [first.entry.libraryId]: second.entry.latestReleaseId });
    expect(
      ignored.acceptedReleaseIdsByDesignFileId[consumerDescriptor.designFileId],
    ).toEqual({});
    await expect(
      host.setProjectLibraryUpdateIgnored(
        "project_acme",
        consumerDescriptor.designFileId,
        first.entry.libraryId,
        "release_unknown",
      ),
    ).rejects.toMatchObject({ code: "LIBRARY_NOT_FOUND" });
    const cleared = await host.setProjectLibraryUpdateIgnored(
      "project_acme",
      consumerDescriptor.designFileId,
      first.entry.libraryId,
      null,
    );
    expect(
      cleared.ignoredReleaseIdsByDesignFileId[consumerDescriptor.designFileId],
    ).toEqual({});
  });

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
      originProjectId: "project_acme",
      filedProjectId: "project_acme",
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
    expect(store.listConversations()).toEqual([conversation]);
    expect(store.listRootGrants()).toEqual([grant]);
    expect(store.listGlobalTasks()).toEqual([task]);
    store.close();
  });

  it("resets the pre-release Conversation and task schema without a compatibility path", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-workspace-v1-"));
    const databasePath = join(root, "workspace.sqlite");
    const initialized = new WorkspaceStore(databasePath);
    initialized.close();
    const database = new DatabaseSync(databasePath);
    database.exec(`
      DROP TABLE global_tasks;
      DROP TABLE conversations;
      CREATE TABLE conversations (
        conversation_id TEXT PRIMARY KEY,
        home_project_id TEXT NOT NULL,
        descriptor_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE global_tasks (
        task_id TEXT PRIMARY KEY,
        home_project_id TEXT NOT NULL,
        projection_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO conversations VALUES (
        'conversation_legacy',
        'project_acme',
        '{}',
        '${now}'
      );
      INSERT INTO global_tasks VALUES (
        'task_legacy',
        'project_acme',
        '{}',
        '${now}'
      );
    `);
    database.close();

    const reopened = new WorkspaceStore(databasePath);
    expect(reopened.listConversations()).toEqual([]);
    expect(reopened.listGlobalTasks()).toEqual([]);
    reopened.close();
  });

  it("keeps Conversation origin immutable while allowing filed Project moves", () => {
    const store = new WorkspaceStore(":memory:");
    const conversation: ConversationDescriptor = {
      conversationId: "conversation_1",
      originProjectId: "project_acme",
      filedProjectId: "project_acme",
      title: "Refine the mobile experience",
      createdAt: now,
      updatedAt: now,
      lifecycle: "active",
    };

    store.createConversation(conversation);
    expect(() => store.createConversation(conversation)).toThrow();
    const unfiled = {
      ...conversation,
      filedProjectId: null,
      updatedAt: "2026-08-07T13:00:00.000Z",
    };
    store.saveConversation(unfiled);
    expect(store.listConversations()).toEqual([unfiled]);
    expect(() =>
      store.saveConversation({
        ...unfiled,
        originProjectId: "project_other",
        updatedAt: "2026-08-07T14:00:00.000Z",
      }),
    ).toThrow("Conversation origin Project cannot be changed by save");
    store.close();
  });
});
