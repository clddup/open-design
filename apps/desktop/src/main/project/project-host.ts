import {
  isDesignDocument,
  isLibraryReleaseSnapshot,
  migrateDesignDocument,
  type DesignDocument,
  type LibraryReleaseSnapshot,
} from "@opendesign/design-contracts";
import { createLibraryReleaseSnapshot } from "@opendesign/component-service";
import {
  PROJECT_MANIFEST_VERSION,
  isDesignFileDescriptor,
  isNormalizedRelativePath,
  isProjectManifest,
  isStableId,
  type DesignFileDescriptor,
  type ProjectManifest,
} from "@opendesign/workspace-contracts";
import {
  isProjectLibraryCatalog,
  type ProjectLibraryCatalog,
  type ProjectLibraryCatalogEntry,
} from "../../shared/project-library-contract.js";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import type { WorkspaceStore } from "./workspace-store.js";
import { createStarterProjectFiles } from "../../shared/project/starter-project.js";

export const PROJECT_MANIFEST_NAME = "opendesign.project.json";
export const PROJECT_SAVE_JOURNAL_NAME = ".opendesign-save-journal.json";
export const PROJECT_LIBRARY_CATALOG_PATH = ".opendesign/libraries.json";
export const PROJECT_LIBRARY_RELEASE_DIRECTORY = ".opendesign/libraries";
const DESIGN_FILE_EXTENSION = ".opendesign";
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_DESIGN_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SAVE_JOURNAL_BYTES =
  MAX_MANIFEST_BYTES + MAX_DESIGN_FILE_BYTES + 1024 * 1024;
const MAX_LIBRARY_CATALOG_BYTES = 4 * 1024 * 1024;
const MAX_LIBRARY_RELEASE_BYTES = 64 * 1024 * 1024;

interface OpenProjectRecord {
  rootPath: string;
  manifest: ProjectManifest;
}

interface ProjectDocumentSaveJournal {
  version: 1;
  operation: "create" | "save";
  projectId: string;
  designFileId: string;
  documentId: string;
  relativePath: string;
  previousDocumentHash: string | null;
  nextDocumentHash: string;
  previousManifestHash: string;
  nextManifestHash: string;
  nextDocument: DesignDocument;
  nextManifest: ProjectManifest;
}

interface ProjectInitializationJournal {
  version: 1;
  operation: "initialize";
  projectId: string;
  previousManifestHash: null;
  nextManifestHash: string;
  nextManifest: ProjectManifest;
  designFiles: Array<{
    designFileId: string;
    documentId: string;
    relativePath: string;
    nextDocumentHash: string;
    nextDocument: DesignDocument;
  }>;
}

interface ProjectMigrationJournal {
  version: 1;
  operation: "migrate";
  projectId: string;
  previousManifestHash: string;
  nextManifestHash: string;
  nextManifest: ProjectManifest;
  createdDesignFiles: ProjectInitializationJournal["designFiles"];
}

interface ProjectDesignFileRenameJournal {
  version: 1;
  operation: "rename";
  projectId: string;
  designFileId: string;
  previousManifestHash: string;
  nextManifestHash: string;
  previousManifest: ProjectManifest;
  nextManifest: ProjectManifest;
}

type ProjectSaveJournal =
  | ProjectDocumentSaveJournal
  | ProjectInitializationJournal
  | ProjectMigrationJournal
  | ProjectDesignFileRenameJournal;

export interface CreateProjectRequest {
  projectId: string;
  name: string;
  now?: string;
}

export interface CreateDesignFileRequest {
  descriptor: DesignFileDescriptor;
  document: DesignDocument;
}

export interface ProjectDesignFile {
  descriptor: DesignFileDescriptor;
  document: DesignDocument;
}

export class ProjectHostError extends Error {
  constructor(
    readonly code:
      | "PROJECT_EXISTS"
      | "PROJECT_NOT_OPEN"
      | "INVALID_PROJECT"
      | "INVALID_DESIGN_FILE"
      | "DESIGN_FILE_NOT_FOUND"
      | "LIBRARY_NOT_FOUND"
      | "PATH_OUTSIDE_PROJECT"
      | "SYMLINK_NOT_ALLOWED"
      | "FILE_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "ProjectHostError";
  }
}

export class ProjectHost {
  readonly #projects = new Map<string, OpenProjectRecord>();
  readonly #projectMutations = new Map<string, Promise<void>>();

  constructor(private readonly workspaceStore?: WorkspaceStore) {}

  async createProject(
    rootPath: string,
    request: CreateProjectRequest,
    initialDesignFiles: readonly CreateDesignFileRequest[] = [],
  ): Promise<ProjectManifest> {
    const root = resolve(rootPath);
    await mkdir(root, { recursive: true });
    const canonicalRoot = await realpath(root);
    const manifestPath = resolve(canonicalRoot, PROJECT_MANIFEST_NAME);
    if (await pathExists(manifestPath)) {
      throw new ProjectHostError(
        "PROJECT_EXISTS",
        `${PROJECT_MANIFEST_NAME} already exists in ${basename(canonicalRoot)}`,
      );
    }

    const now = request.now ?? new Date().toISOString();
    for (const file of initialDesignFiles) {
      assertDesignFile(file);
    }
    assertUniqueDesignFiles(
      initialDesignFiles.map(({ descriptor }) => descriptor),
    );
    const manifest: ProjectManifest = {
      manifestVersion: PROJECT_MANIFEST_VERSION,
      projectId: request.projectId,
      name: request.name,
      createdAt: now,
      updatedAt: now,
      lifecycle: "active",
      designFiles: initialDesignFiles.map(({ descriptor }) => descriptor),
    };
    if (!isProjectManifest(manifest)) {
      throw new ProjectHostError(
        "INVALID_PROJECT",
        "Project identity, name, or initial design files are invalid",
      );
    }

    await Promise.all(
      ["designs", "assets", "exports"].map((directory) =>
        mkdir(resolve(canonicalRoot, directory), { recursive: true }),
      ),
    );
    const designFiles = await Promise.all(
      initialDesignFiles.map(async ({ descriptor, document }) => {
        const path = await resolveProjectPath(
          canonicalRoot,
          descriptor.relativePath,
          false,
        );
        if (await pathExists(path)) {
          throw new ProjectHostError(
            "INVALID_DESIGN_FILE",
            `Design file already exists: ${descriptor.name}`,
          );
        }
        return {
          designFileId: descriptor.designFileId,
          documentId: descriptor.documentId,
          relativePath: descriptor.relativePath,
          nextDocumentHash: hashContents(JSON.stringify(document, null, 2)),
          nextDocument: document,
        };
      }),
    );
    const nextManifestContents = JSON.stringify(manifest, null, 2);
    const journal: ProjectInitializationJournal = {
      version: 1,
      operation: "initialize",
      projectId: request.projectId,
      previousManifestHash: null,
      nextManifestHash: hashContents(nextManifestContents),
      nextManifest: manifest,
      designFiles,
    };
    await commitProjectSave(canonicalRoot, journal);
    this.#register(canonicalRoot, manifest);
    return structuredClone(manifest);
  }

  async openProject(rootPath: string): Promise<ProjectManifest> {
    const root = await realpath(rootPath);
    const rootInfo = await stat(root);
    if (!rootInfo.isDirectory()) {
      throw new ProjectHostError(
        "INVALID_PROJECT",
        "OpenDesign projects must be directories",
      );
    }

    await recoverProjectSave(root);
    const manifestPath = resolve(root, PROJECT_MANIFEST_NAME);
    const manifestValue = await readBoundedJson(
      manifestPath,
      MAX_MANIFEST_BYTES,
      "INVALID_PROJECT",
    );
    if (!isProjectManifest(manifestValue)) {
      throw new ProjectHostError(
        "INVALID_PROJECT",
        "Project manifest does not match the OpenDesign project schema",
      );
    }
    let manifest: ProjectManifest = manifestValue;

    for (const descriptor of manifest.designFiles) {
      assertDesignFileDescriptor(descriptor);
      await resolveProjectPath(root, descriptor.relativePath, true);
    }
    manifest = await migrateLegacyStarterProject(root, manifest);
    this.#register(root, manifest);
    return structuredClone(manifest);
  }

  async openRecentProject(projectId: string): Promise<ProjectManifest> {
    const root = this.workspaceStore?.getProjectRoot(projectId);
    if (!root) {
      throw new ProjectHostError(
        "PROJECT_NOT_OPEN",
        `Recent project is unavailable: ${projectId}`,
      );
    }
    return this.openProject(root);
  }

  listOpenProjects(): ProjectManifest[] {
    return [...this.#projects.values()].map(({ manifest }) =>
      structuredClone(manifest),
    );
  }

  async createDesignFile(
    projectId: string,
    request: CreateDesignFileRequest,
  ): Promise<ProjectDesignFile> {
    return this.#withProjectMutation(projectId, async () => {
      const project = this.#requireProject(projectId);
      assertDesignFileDescriptor(request.descriptor);
      assertDesignDocumentIdentity(request.document, request.descriptor);
      if (
        project.manifest.designFiles.some(
          (file) =>
            file.designFileId === request.descriptor.designFileId ||
            file.documentId === request.descriptor.documentId ||
            file.relativePath === request.descriptor.relativePath,
        )
      ) {
        throw new ProjectHostError(
          "INVALID_DESIGN_FILE",
          "Design file ID, document ID, and relative path must be unique",
        );
      }

      const path = await resolveProjectPath(
        project.rootPath,
        request.descriptor.relativePath,
        false,
      );
      if (await pathExists(path)) {
        throw new ProjectHostError(
          "INVALID_DESIGN_FILE",
          `Design file already exists: ${request.descriptor.name}`,
        );
      }
      await mkdir(dirname(path), { recursive: true });

      const nextManifest: ProjectManifest = {
        ...project.manifest,
        updatedAt: request.descriptor.updatedAt,
        designFiles: [...project.manifest.designFiles, request.descriptor],
      };
      const documentContents = JSON.stringify(request.document, null, 2);
      const manifestPath = resolve(project.rootPath, PROJECT_MANIFEST_NAME);
      const previousManifestContents = await readFile(manifestPath, "utf8");
      const nextManifestContents = JSON.stringify(nextManifest, null, 2);
      const journal: ProjectSaveJournal = {
        version: 1,
        operation: "create",
        projectId,
        designFileId: request.descriptor.designFileId,
        documentId: request.document.documentId,
        relativePath: request.descriptor.relativePath,
        previousDocumentHash: null,
        nextDocumentHash: hashContents(documentContents),
        previousManifestHash: hashContents(previousManifestContents),
        nextManifestHash: hashContents(nextManifestContents),
        nextDocument: request.document,
        nextManifest,
      };
      await commitProjectSave(project.rootPath, journal);
      project.manifest = nextManifest;
      this.#touch(project);
      return {
        descriptor: structuredClone(request.descriptor),
        document: structuredClone(request.document),
      };
    });
  }

  async readDesignFile(
    projectId: string,
    designFileId: string,
  ): Promise<ProjectDesignFile> {
    const project = this.#requireProject(projectId);
    const descriptor = project.manifest.designFiles.find(
      (file) => file.designFileId === designFileId,
    );
    if (!descriptor) {
      throw new ProjectHostError(
        "DESIGN_FILE_NOT_FOUND",
        `Unknown design file: ${designFileId}`,
      );
    }
    const path = await resolveProjectPath(
      project.rootPath,
      descriptor.relativePath,
      true,
    );
    const value = await readBoundedJson(
      path,
      MAX_DESIGN_FILE_BYTES,
      "INVALID_DESIGN_FILE",
    );
    const document = migrateDesignDocument(value);
    if (!document) {
      throw new ProjectHostError(
        "INVALID_DESIGN_FILE",
        `${descriptor.name} is not a valid OpenDesign document`,
      );
    }
    assertDesignDocumentIdentity(document, descriptor);
    return {
      descriptor: structuredClone(descriptor),
      document: structuredClone(document),
    };
  }

  async saveDesignFile(
    projectId: string,
    designFileId: string,
    document: DesignDocument,
    now = new Date().toISOString(),
  ): Promise<ProjectDesignFile> {
    return this.#withProjectMutation(projectId, async () => {
      const project = this.#requireProject(projectId);
      const index = project.manifest.designFiles.findIndex(
        (file) => file.designFileId === designFileId,
      );
      const descriptor = project.manifest.designFiles[index];
      if (!descriptor) {
        throw new ProjectHostError(
          "DESIGN_FILE_NOT_FOUND",
          `Unknown design file: ${designFileId}`,
        );
      }
      if (!isDesignDocument(document)) {
        throw new ProjectHostError(
          "INVALID_DESIGN_FILE",
          "Cannot save an invalid OpenDesign document",
        );
      }
      assertDesignDocumentIdentity(document, descriptor);
      const path = await resolveProjectPath(
        project.rootPath,
        descriptor.relativePath,
        true,
      );
      const contents = JSON.stringify(document, null, 2);
      if (Buffer.byteLength(contents, "utf8") > MAX_DESIGN_FILE_BYTES) {
        throw new ProjectHostError(
          "FILE_TOO_LARGE",
          "OpenDesign document exceeds the 64 MB limit",
        );
      }
      const updatedDescriptor = { ...descriptor, updatedAt: now };
      const designFiles = [...project.manifest.designFiles];
      designFiles[index] = updatedDescriptor;
      const nextManifest = { ...project.manifest, updatedAt: now, designFiles };
      const previousDocumentContents = await readFile(path, "utf8");
      const manifestPath = resolve(project.rootPath, PROJECT_MANIFEST_NAME);
      const previousManifestContents = await readFile(manifestPath, "utf8");
      const nextManifestContents = JSON.stringify(nextManifest, null, 2);
      const journal: ProjectSaveJournal = {
        version: 1,
        operation: "save",
        projectId,
        designFileId,
        documentId: document.documentId,
        relativePath: descriptor.relativePath,
        previousDocumentHash: hashContents(previousDocumentContents),
        nextDocumentHash: hashContents(contents),
        nextDocument: document,
        previousManifestHash: hashContents(previousManifestContents),
        nextManifestHash: hashContents(nextManifestContents),
        nextManifest,
      };
      await commitProjectSave(project.rootPath, journal);
      project.manifest = nextManifest;
      this.#touch(project);
      return {
        descriptor: structuredClone(updatedDescriptor),
        document: structuredClone(document),
      };
    });
  }

  async renameDesignFile(
    projectId: string,
    designFileId: string,
    name: string,
    now = new Date().toISOString(),
  ): Promise<DesignFileDescriptor> {
    return this.#withProjectMutation(projectId, async () => {
      assertDesignFileName(name);
      const project = this.#requireProject(projectId);
      const index = project.manifest.designFiles.findIndex(
        (file) => file.designFileId === designFileId,
      );
      const descriptor = project.manifest.designFiles[index];
      if (!descriptor) {
        throw new ProjectHostError(
          "DESIGN_FILE_NOT_FOUND",
          `Unknown design file: ${designFileId}`,
        );
      }
      if (descriptor.name === name) return structuredClone(descriptor);

      const updatedDescriptor = { ...descriptor, name, updatedAt: now };
      const designFiles = [...project.manifest.designFiles];
      designFiles[index] = updatedDescriptor;
      const nextManifest = { ...project.manifest, updatedAt: now, designFiles };
      const manifestPath = resolve(project.rootPath, PROJECT_MANIFEST_NAME);
      const previousManifestContents = await readFile(manifestPath, "utf8");
      const nextManifestContents = JSON.stringify(nextManifest, null, 2);
      const journal: ProjectSaveJournal = {
        version: 1,
        operation: "rename",
        projectId,
        designFileId,
        previousManifestHash: hashContents(previousManifestContents),
        nextManifestHash: hashContents(nextManifestContents),
        previousManifest: project.manifest,
        nextManifest,
      };
      await commitProjectSave(project.rootPath, journal);
      project.manifest = nextManifest;
      this.#touch(project);
      return structuredClone(updatedDescriptor);
    });
  }

  async publishDesignFileLibrary(
    projectId: string,
    designFileId: string,
    name?: string,
    now = new Date().toISOString(),
  ): Promise<{
    catalog: ProjectLibraryCatalog;
    entry: ProjectLibraryCatalogEntry;
    release: LibraryReleaseSnapshot;
  }> {
    return this.#withProjectMutation(projectId, async () => {
      const project = this.#requireProject(projectId);
      const source = await this.readDesignFile(projectId, designFileId);
      const catalog = await readProjectLibraryCatalog(project.rootPath);
      const existing = catalog.libraries.find(
        (candidate) => candidate.sourceDesignFileId === designFileId,
      );
      const libraryId =
        existing?.libraryId ??
        `library_${hashContents(`${projectId}\u0000${designFileId}`).slice(0, 24)}`;
      const provisionalRelease = createLibraryReleaseSnapshot(source.document, {
        libraryId,
        releaseId: "release_pending",
        sourceProjectId: projectId,
        sourceDesignFileId: designFileId,
        name: name?.trim() || existing?.name || source.descriptor.name,
        publishedAt: now,
      });
      const sourceFingerprint = hashContents(
        JSON.stringify({
          componentsById: Object.fromEntries(
            Object.entries(provisionalRelease.componentsById).map(
              ([componentId, component]) => [
                componentId,
                {
                  component: component.component,
                  nodesById: component.nodesById,
                  assetsById: component.assetsById,
                  dependencyComponentIds: component.dependencyComponentIds,
                },
              ],
            ),
          ),
          variantSetsById: Object.fromEntries(
            Object.entries(provisionalRelease.variantSetsById).map(
              ([variantSetId, variantSet]) => [
                variantSetId,
                variantSet.variantSet,
              ],
            ),
          ),
        }),
      );
      const releaseId = `release_${sourceFingerprint.slice(0, 24)}`;
      const release = createLibraryReleaseSnapshot(source.document, {
        libraryId,
        releaseId,
        sourceProjectId: projectId,
        sourceDesignFileId: designFileId,
        name: name?.trim() || existing?.name || source.descriptor.name,
        publishedAt:
          existing?.latestReleaseId === releaseId ? existing.publishedAt : now,
      });
      const releasePath = await resolveProjectPath(
        project.rootPath,
        libraryReleaseRelativePath(libraryId, releaseId),
        false,
      );
      const releaseContents = JSON.stringify(release, null, 2);
      if (
        Buffer.byteLength(releaseContents, "utf8") > MAX_LIBRARY_RELEASE_BYTES
      ) {
        throw new ProjectHostError(
          "FILE_TOO_LARGE",
          "Published Library release exceeds the 64 MB limit",
        );
      }
      await mkdir(dirname(releasePath), { recursive: true });
      if (!(await pathExists(releasePath))) {
        await writeAtomic(releasePath, releaseContents);
      }
      const entry: ProjectLibraryCatalogEntry = {
        libraryId,
        name: release.name,
        sourceProjectId: projectId,
        sourceDesignFileId: designFileId,
        sourceDocumentId: source.document.documentId,
        latestReleaseId: releaseId,
        publishedAt: release.publishedAt,
        releases: existing?.releases.some(
          (candidate) => candidate.releaseId === releaseId,
        )
          ? existing.releases
          : [
              ...(existing?.releases ?? []),
              { releaseId, publishedAt: release.publishedAt },
            ],
      };
      const nextCatalog: ProjectLibraryCatalog = {
        ...catalog,
        libraries: existing
          ? catalog.libraries.map((candidate) =>
              candidate.libraryId === libraryId ? entry : candidate,
            )
          : [...catalog.libraries, entry],
      };
      await writeProjectLibraryCatalog(project.rootPath, nextCatalog);
      return {
        catalog: structuredClone(nextCatalog),
        entry: structuredClone(entry),
        release: structuredClone(release),
      };
    });
  }

  async listProjectLibraries(
    projectId: string,
  ): Promise<ProjectLibraryCatalog> {
    const project = this.#requireProject(projectId);
    return structuredClone(await readProjectLibraryCatalog(project.rootPath));
  }

  async readProjectLibraryRelease(
    projectId: string,
    libraryId: string,
    releaseId?: string,
  ): Promise<LibraryReleaseSnapshot> {
    const project = this.#requireProject(projectId);
    const catalog = await readProjectLibraryCatalog(project.rootPath);
    const entry = catalog.libraries.find(
      (candidate) => candidate.libraryId === libraryId,
    );
    if (!entry) {
      throw new ProjectHostError(
        "LIBRARY_NOT_FOUND",
        `Unknown Library: ${libraryId}`,
      );
    }
    const selectedReleaseId = releaseId ?? entry.latestReleaseId;
    if (
      !entry.releases.some(
        (candidate) => candidate.releaseId === selectedReleaseId,
      )
    ) {
      throw new ProjectHostError(
        "LIBRARY_NOT_FOUND",
        `Unknown Library release: ${selectedReleaseId}`,
      );
    }
    const releasePath = await resolveProjectPath(
      project.rootPath,
      libraryReleaseRelativePath(libraryId, selectedReleaseId),
      true,
    );
    const value = await readBoundedJson(
      releasePath,
      MAX_LIBRARY_RELEASE_BYTES,
      "INVALID_PROJECT",
    );
    if (
      !isLibraryReleaseSnapshot(value) ||
      value.libraryId !== libraryId ||
      value.releaseId !== selectedReleaseId ||
      value.sourceProjectId !== projectId ||
      value.sourceDesignFileId !== entry.sourceDesignFileId ||
      value.sourceDocumentId !== entry.sourceDocumentId
    ) {
      throw new ProjectHostError(
        "INVALID_PROJECT",
        "Published Library release does not match its catalog identity",
      );
    }
    return structuredClone(value);
  }

  async setProjectLibraryEnabled(
    projectId: string,
    designFileId: string,
    libraryId: string,
    enabled: boolean,
  ): Promise<ProjectLibraryCatalog> {
    return this.#withProjectMutation(projectId, async () => {
      const project = this.#requireProject(projectId);
      if (
        !project.manifest.designFiles.some(
          (candidate) => candidate.designFileId === designFileId,
        )
      ) {
        throw new ProjectHostError(
          "DESIGN_FILE_NOT_FOUND",
          `Unknown design file: ${designFileId}`,
        );
      }
      const catalog = await readProjectLibraryCatalog(project.rootPath);
      if (
        !catalog.libraries.some(
          (candidate) => candidate.libraryId === libraryId,
        )
      ) {
        throw new ProjectHostError(
          "LIBRARY_NOT_FOUND",
          `Unknown Library: ${libraryId}`,
        );
      }
      const current = new Set(
        catalog.enabledLibraryIdsByDesignFileId[designFileId] ?? [],
      );
      if (enabled) current.add(libraryId);
      else current.delete(libraryId);
      const nextCatalog: ProjectLibraryCatalog = {
        ...catalog,
        enabledLibraryIdsByDesignFileId: {
          ...catalog.enabledLibraryIdsByDesignFileId,
          [designFileId]: [...current].sort(),
        },
      };
      await writeProjectLibraryCatalog(project.rootPath, nextCatalog);
      return structuredClone(nextCatalog);
    });
  }

  async setProjectLibraryUpdateIgnored(
    projectId: string,
    designFileId: string,
    libraryId: string,
    releaseId: string | null,
  ): Promise<ProjectLibraryCatalog> {
    return this.#withProjectMutation(projectId, async () => {
      const project = this.#requireProject(projectId);
      if (
        !project.manifest.designFiles.some(
          (candidate) => candidate.designFileId === designFileId,
        )
      ) {
        throw new ProjectHostError(
          "DESIGN_FILE_NOT_FOUND",
          `Unknown design file: ${designFileId}`,
        );
      }
      const catalog = await readProjectLibraryCatalog(project.rootPath);
      const entry = catalog.libraries.find(
        (candidate) => candidate.libraryId === libraryId,
      );
      if (!entry) {
        throw new ProjectHostError(
          "LIBRARY_NOT_FOUND",
          `Unknown Library: ${libraryId}`,
        );
      }
      if (
        releaseId !== null &&
        !entry.releases.some((candidate) => candidate.releaseId === releaseId)
      ) {
        throw new ProjectHostError(
          "LIBRARY_NOT_FOUND",
          `Unknown Library release: ${releaseId}`,
        );
      }
      const ignored = {
        ...(catalog.ignoredReleaseIdsByDesignFileId[designFileId] ?? {}),
      };
      if (releaseId === null) delete ignored[libraryId];
      else ignored[libraryId] = releaseId;
      const accepted = {
        ...(catalog.acceptedReleaseIdsByDesignFileId[designFileId] ?? {}),
      };
      if (releaseId !== null) delete accepted[libraryId];
      const nextCatalog: ProjectLibraryCatalog = {
        ...catalog,
        acceptedReleaseIdsByDesignFileId: {
          ...catalog.acceptedReleaseIdsByDesignFileId,
          [designFileId]: accepted,
        },
        ignoredReleaseIdsByDesignFileId: {
          ...catalog.ignoredReleaseIdsByDesignFileId,
          [designFileId]: ignored,
        },
      };
      await writeProjectLibraryCatalog(project.rootPath, nextCatalog);
      return structuredClone(nextCatalog);
    });
  }

  async setProjectLibraryUpdateAccepted(
    projectId: string,
    designFileId: string,
    libraryId: string,
    releaseId: string,
  ): Promise<ProjectLibraryCatalog> {
    return this.#withProjectMutation(projectId, async () => {
      const project = this.#requireProject(projectId);
      if (
        !project.manifest.designFiles.some(
          (candidate) => candidate.designFileId === designFileId,
        )
      ) {
        throw new ProjectHostError(
          "DESIGN_FILE_NOT_FOUND",
          `Unknown design file: ${designFileId}`,
        );
      }
      const catalog = await readProjectLibraryCatalog(project.rootPath);
      const entry = catalog.libraries.find(
        (candidate) => candidate.libraryId === libraryId,
      );
      if (
        !entry?.releases.some((candidate) => candidate.releaseId === releaseId)
      ) {
        throw new ProjectHostError(
          "LIBRARY_NOT_FOUND",
          `Unknown Library release: ${releaseId}`,
        );
      }
      const accepted = {
        ...(catalog.acceptedReleaseIdsByDesignFileId[designFileId] ?? {}),
        [libraryId]: releaseId,
      };
      const ignored = {
        ...(catalog.ignoredReleaseIdsByDesignFileId[designFileId] ?? {}),
      };
      delete ignored[libraryId];
      const nextCatalog: ProjectLibraryCatalog = {
        ...catalog,
        acceptedReleaseIdsByDesignFileId: {
          ...catalog.acceptedReleaseIdsByDesignFileId,
          [designFileId]: accepted,
        },
        ignoredReleaseIdsByDesignFileId: {
          ...catalog.ignoredReleaseIdsByDesignFileId,
          [designFileId]: ignored,
        },
      };
      await writeProjectLibraryCatalog(project.rootPath, nextCatalog);
      return structuredClone(nextCatalog);
    });
  }

  async #withProjectMutation<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#projectMutations.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveCurrent) => {
      release = resolveCurrent;
    });
    const tail = previous.then(() => current);
    this.#projectMutations.set(projectId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#projectMutations.get(projectId) === tail) {
        this.#projectMutations.delete(projectId);
      }
    }
  }

  #requireProject(projectId: string): OpenProjectRecord {
    const project = this.#projects.get(projectId);
    if (!project) {
      throw new ProjectHostError(
        "PROJECT_NOT_OPEN",
        `Project is not open: ${projectId}`,
      );
    }
    return project;
  }

  #register(rootPath: string, manifest: ProjectManifest): void {
    const existing = this.#projects.get(manifest.projectId);
    if (existing && existing.rootPath !== rootPath) {
      throw new ProjectHostError(
        "INVALID_PROJECT",
        `Project ID is already open from another directory: ${manifest.projectId}`,
      );
    }
    const record = { rootPath, manifest: structuredClone(manifest) };
    this.#touch(record, true);
    this.#projects.set(manifest.projectId, record);
  }

  #touch(project: OpenProjectRecord, reveal = false): void {
    const result = this.workspaceStore?.upsertProject({
      projectId: project.manifest.projectId,
      name: project.manifest.name,
      rootPath: project.rootPath,
      lastOpenedAt: new Date().toISOString(),
      reveal,
    });
    if (result?.displacedProjectId) {
      this.#projects.delete(result.displacedProjectId);
    }
  }
}

const LEGACY_STARTER_PATHS = new Set([
  "designs/mobile-ui.opendesign",
  "designs/website.opendesign",
]);

async function migrateLegacyStarterProject(
  rootPath: string,
  manifest: ProjectManifest,
): Promise<ProjectManifest> {
  const removableIds = new Set<string>();
  for (const descriptor of manifest.designFiles) {
    if (!LEGACY_STARTER_PATHS.has(descriptor.relativePath)) continue;
    const path = await resolveProjectPath(
      rootPath,
      descriptor.relativePath,
      true,
    );
    const value = await readBoundedJson(
      path,
      MAX_DESIGN_FILE_BYTES,
      "INVALID_DESIGN_FILE",
    );
    if (
      isDesignDocument(value) &&
      value.documentId === descriptor.documentId &&
      value.revision === 0 &&
      value.extensions.template === "starter-project"
    ) {
      removableIds.add(descriptor.designFileId);
    }
  }
  if (removableIds.size === 0) return manifest;

  const now = new Date().toISOString();
  const remaining = manifest.designFiles.filter(
    ({ designFileId }) => !removableIds.has(designFileId),
  );
  const created =
    remaining.length === 0
      ? createStarterProjectFiles(manifest.projectId, now)
      : [];
  const nextManifest: ProjectManifest = {
    ...manifest,
    updatedAt: now,
    designFiles: [...remaining, ...created.map(({ descriptor }) => descriptor)],
  };
  if (!isProjectManifest(nextManifest)) {
    throw new ProjectHostError(
      "INVALID_PROJECT",
      "Legacy starter migration produced an invalid Project manifest",
    );
  }
  assertUniqueDesignFiles(nextManifest.designFiles);

  const manifestPath = resolve(rootPath, PROJECT_MANIFEST_NAME);
  const previousManifestContents = await readFile(manifestPath, "utf8");
  const nextManifestContents = JSON.stringify(nextManifest, null, 2);
  const journal: ProjectMigrationJournal = {
    version: 1,
    operation: "migrate",
    projectId: manifest.projectId,
    previousManifestHash: hashContents(previousManifestContents),
    nextManifestHash: hashContents(nextManifestContents),
    nextManifest,
    createdDesignFiles: created.map(({ descriptor, document }) => ({
      designFileId: descriptor.designFileId,
      documentId: descriptor.documentId,
      relativePath: descriptor.relativePath,
      nextDocumentHash: hashContents(JSON.stringify(document, null, 2)),
      nextDocument: document,
    })),
  };
  await commitProjectSave(rootPath, journal);
  return nextManifest;
}

function assertDesignFileDescriptor(descriptor: DesignFileDescriptor): void {
  if (
    !isDesignFileDescriptor(descriptor) ||
    !isNormalizedRelativePath(descriptor.relativePath) ||
    extname(descriptor.relativePath).toLowerCase() !== DESIGN_FILE_EXTENSION
  ) {
    throw new ProjectHostError(
      "INVALID_DESIGN_FILE",
      "Design files must use a safe relative .opendesign path",
    );
  }
}

function assertDesignFile(file: CreateDesignFileRequest): void {
  assertDesignFileDescriptor(file.descriptor);
  if (!isDesignDocument(file.document)) {
    throw new ProjectHostError(
      "INVALID_DESIGN_FILE",
      "Cannot create an invalid OpenDesign document",
    );
  }
  assertDesignDocumentIdentity(file.document, file.descriptor);
}

function assertUniqueDesignFiles(
  descriptors: readonly DesignFileDescriptor[],
): void {
  const designFileIds = new Set<string>();
  const documentIds = new Set<string>();
  const relativePaths = new Set<string>();
  for (const descriptor of descriptors) {
    if (
      designFileIds.has(descriptor.designFileId) ||
      documentIds.has(descriptor.documentId) ||
      relativePaths.has(descriptor.relativePath)
    ) {
      throw new ProjectHostError(
        "INVALID_DESIGN_FILE",
        "Design file ID, document ID, and relative path must be unique",
      );
    }
    designFileIds.add(descriptor.designFileId);
    documentIds.add(descriptor.documentId);
    relativePaths.add(descriptor.relativePath);
  }
}

function assertDesignDocumentIdentity(
  document: DesignDocument,
  descriptor: DesignFileDescriptor,
): void {
  if (document.documentId !== descriptor.documentId) {
    throw new ProjectHostError(
      "INVALID_DESIGN_FILE",
      `Document identity does not match ${descriptor.name}`,
    );
  }
}

async function resolveProjectPath(
  rootPath: string,
  relativePath: string,
  mustExist: boolean,
): Promise<string> {
  if (!isNormalizedRelativePath(relativePath)) {
    throw new ProjectHostError(
      "PATH_OUTSIDE_PROJECT",
      "Project resources require a normalized relative path",
    );
  }
  const root = await realpath(rootPath);
  const path = resolve(root, ...relativePath.split("/"));
  if (!isWithin(path, root)) {
    throw new ProjectHostError(
      "PATH_OUTSIDE_PROJECT",
      "Resource path escapes its project",
    );
  }

  let current = root;
  const segments = relativePath.split("/");
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new ProjectHostError(
          "SYMLINK_NOT_ALLOWED",
          `Project resources cannot traverse symlinks: ${relativePath}`,
        );
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        if (mustExist) {
          throw new ProjectHostError(
            "DESIGN_FILE_NOT_FOUND",
            `Project resource does not exist: ${relativePath}`,
          );
        }
        break;
      }
      throw error;
    }
  }
  if (mustExist) {
    const canonicalPath = await realpath(path);
    if (!isWithin(canonicalPath, root)) {
      throw new ProjectHostError(
        "PATH_OUTSIDE_PROJECT",
        "Resource resolves outside its project",
      );
    }
  }
  return path;
}

async function commitProjectSave(
  rootPath: string,
  journal: ProjectSaveJournal,
): Promise<void> {
  const journalPath = resolve(rootPath, PROJECT_SAVE_JOURNAL_NAME);
  if (await pathExists(journalPath)) {
    throw new ProjectHostError(
      "INVALID_PROJECT",
      "Project has an unfinished save that must be recovered before writing",
    );
  }
  const manifestPath = resolve(rootPath, PROJECT_MANIFEST_NAME);
  const journalContents = JSON.stringify(journal, null, 2);
  if (Buffer.byteLength(journalContents, "utf8") > MAX_SAVE_JOURNAL_BYTES) {
    throw new ProjectHostError(
      "FILE_TOO_LARGE",
      "Project save journal exceeds its size limit",
    );
  }

  if (journal.operation === "initialize" || journal.operation === "migrate") {
    if ((await readHash(manifestPath)) !== journal.previousManifestHash) {
      throw new ProjectHostError(
        "INVALID_PROJECT",
        "Project changed before initialization could be committed",
      );
    }
    const createdDesignFiles =
      journal.operation === "initialize"
        ? journal.designFiles
        : journal.createdDesignFiles;
    for (const file of createdDesignFiles) {
      const documentPath = await resolveProjectPath(
        rootPath,
        file.relativePath,
        false,
      );
      if ((await readHash(documentPath)) !== null) {
        throw new ProjectHostError(
          "INVALID_PROJECT",
          "Project changed before initialization could be committed",
        );
      }
    }
    await writeAtomic(journalPath, journalContents);
    for (const file of createdDesignFiles) {
      const documentPath = await resolveProjectPath(
        rootPath,
        file.relativePath,
        false,
      );
      await mkdir(dirname(documentPath), { recursive: true });
      await writeAtomic(
        documentPath,
        JSON.stringify(file.nextDocument, null, 2),
      );
    }
  } else if (journal.operation === "rename") {
    if ((await readHash(manifestPath)) !== journal.previousManifestHash) {
      throw new ProjectHostError(
        "INVALID_PROJECT",
        "Project changed before the rename could be committed",
      );
    }
    await writeAtomic(journalPath, journalContents);
  } else {
    const documentPath = await resolveProjectPath(
      rootPath,
      journal.relativePath,
      false,
    );
    if (
      (await readHash(documentPath)) !== journal.previousDocumentHash ||
      (await readHash(manifestPath)) !== journal.previousManifestHash
    ) {
      throw new ProjectHostError(
        "INVALID_PROJECT",
        "Project changed before the save could be committed",
      );
    }
    await writeAtomic(journalPath, journalContents);
    await writeAtomic(
      documentPath,
      JSON.stringify(journal.nextDocument, null, 2),
    );
  }
  await writeAtomic(
    manifestPath,
    JSON.stringify(journal.nextManifest, null, 2),
  );
  await removeDurably(journalPath);
}

async function recoverProjectSave(rootPath: string): Promise<void> {
  const journalPath = resolve(rootPath, PROJECT_SAVE_JOURNAL_NAME);
  if (!(await pathExists(journalPath))) return;
  const value = await readBoundedJson(
    journalPath,
    MAX_SAVE_JOURNAL_BYTES,
    "INVALID_PROJECT",
  );
  if (!isProjectSaveJournal(value)) {
    throw new ProjectHostError(
      "INVALID_PROJECT",
      "Project contains an invalid interrupted-save journal",
    );
  }

  const manifestPath = resolve(rootPath, PROJECT_MANIFEST_NAME);
  const currentManifestHash = await readHash(manifestPath);
  const manifestKnown =
    currentManifestHash === value.previousManifestHash ||
    currentManifestHash === value.nextManifestHash;
  if (!manifestKnown) {
    throw new ProjectHostError(
      "INVALID_PROJECT",
      "Interrupted save conflicts with files changed outside OpenDesign",
    );
  }

  if (value.operation === "initialize" || value.operation === "migrate") {
    const createdDesignFiles =
      value.operation === "initialize"
        ? value.designFiles
        : value.createdDesignFiles;
    for (const file of createdDesignFiles) {
      const documentPath = await resolveProjectPath(
        rootPath,
        file.relativePath,
        false,
      );
      const currentDocumentHash = await readHash(documentPath);
      if (
        currentDocumentHash !== null &&
        currentDocumentHash !== file.nextDocumentHash
      ) {
        throw new ProjectHostError(
          "INVALID_PROJECT",
          "Interrupted initialization conflicts with files changed outside OpenDesign",
        );
      }
      if (currentDocumentHash !== file.nextDocumentHash) {
        await mkdir(dirname(documentPath), { recursive: true });
        await writeAtomic(
          documentPath,
          JSON.stringify(file.nextDocument, null, 2),
        );
      }
    }
  } else if (value.operation !== "rename") {
    const documentPath = await resolveProjectPath(
      rootPath,
      value.relativePath,
      false,
    );
    const currentDocumentHash = await readHash(documentPath);
    const documentKnown =
      currentDocumentHash === value.previousDocumentHash ||
      currentDocumentHash === value.nextDocumentHash;
    if (!documentKnown) {
      throw new ProjectHostError(
        "INVALID_PROJECT",
        "Interrupted save conflicts with files changed outside OpenDesign",
      );
    }
    if (currentDocumentHash !== value.nextDocumentHash) {
      await mkdir(dirname(documentPath), { recursive: true });
      await writeAtomic(
        documentPath,
        JSON.stringify(value.nextDocument, null, 2),
      );
    }
  }
  if (currentManifestHash !== value.nextManifestHash) {
    await writeAtomic(
      manifestPath,
      JSON.stringify(value.nextManifest, null, 2),
    );
  }
  await removeDurably(journalPath);
}

function isProjectSaveJournal(value: unknown): value is ProjectSaveJournal {
  if (!value || typeof value !== "object") return false;
  const journal = value as Record<string, unknown>;
  if (
    journal.version !== 1 ||
    !isStableId(journal.projectId) ||
    !isContentHash(journal.nextManifestHash) ||
    !isProjectManifest(journal.nextManifest) ||
    journal.nextManifest.projectId !== journal.projectId ||
    hashContents(JSON.stringify(journal.nextManifest, null, 2)) !==
      journal.nextManifestHash
  ) {
    return false;
  }
  if (journal.operation === "initialize") {
    if (
      journal.previousManifestHash !== null ||
      !Array.isArray(journal.designFiles) ||
      journal.designFiles.length !== journal.nextManifest.designFiles.length
    ) {
      return false;
    }
    return areJournalDesignFilesValid(
      journal.designFiles,
      journal.nextManifest,
    );
  }
  if (journal.operation === "migrate") {
    return (
      isContentHash(journal.previousManifestHash) &&
      Array.isArray(journal.createdDesignFiles) &&
      areJournalDesignFilesValid(
        journal.createdDesignFiles,
        journal.nextManifest,
      )
    );
  }
  if (journal.operation === "rename") {
    if (
      !isStableId(journal.designFileId) ||
      !isContentHash(journal.previousManifestHash) ||
      !isProjectManifest(journal.previousManifest) ||
      journal.previousManifest.projectId !== journal.projectId ||
      hashContents(JSON.stringify(journal.previousManifest, null, 2)) !==
        journal.previousManifestHash
    ) {
      return false;
    }
    const previousDescriptor = journal.previousManifest.designFiles.find(
      (file) => file.designFileId === journal.designFileId,
    );
    const nextDescriptor = journal.nextManifest.designFiles.find(
      (file) => file.designFileId === journal.designFileId,
    );
    if (
      !previousDescriptor ||
      !nextDescriptor ||
      !isValidDesignFileName(nextDescriptor.name) ||
      previousDescriptor.name === nextDescriptor.name ||
      previousDescriptor.documentId !== nextDescriptor.documentId ||
      previousDescriptor.relativePath !== nextDescriptor.relativePath ||
      previousDescriptor.createdAt !== nextDescriptor.createdAt ||
      previousDescriptor.lifecycle !== nextDescriptor.lifecycle ||
      nextDescriptor.updatedAt !== journal.nextManifest.updatedAt
    ) {
      return false;
    }
    const expectedManifest: ProjectManifest = {
      ...journal.previousManifest,
      updatedAt: nextDescriptor.updatedAt,
      designFiles: journal.previousManifest.designFiles.map((file) =>
        file.designFileId === journal.designFileId ? nextDescriptor : file,
      ),
    };
    return (
      JSON.stringify(expectedManifest) === JSON.stringify(journal.nextManifest)
    );
  }
  if (
    (journal.operation !== "create" && journal.operation !== "save") ||
    !isStableId(journal.designFileId) ||
    !isStableId(journal.documentId) ||
    !isNormalizedRelativePath(journal.relativePath) ||
    !isContentHash(journal.nextDocumentHash) ||
    !isContentHash(journal.previousManifestHash) ||
    !isDesignDocument(journal.nextDocument) ||
    (journal.operation === "create"
      ? journal.previousDocumentHash !== null
      : !isContentHash(journal.previousDocumentHash))
  ) {
    return false;
  }
  const descriptor = journal.nextManifest.designFiles.find(
    (file) => file.designFileId === journal.designFileId,
  );
  return (
    journal.nextDocument.documentId === journal.documentId &&
    descriptor?.documentId === journal.documentId &&
    descriptor.relativePath === journal.relativePath &&
    hashContents(JSON.stringify(journal.nextDocument, null, 2)) ===
      journal.nextDocumentHash
  );
}

function areJournalDesignFilesValid(
  files: unknown[],
  manifest: ProjectManifest,
): boolean {
  const identities = new Set<string>();
  for (const value of files) {
    if (!value || typeof value !== "object") return false;
    const file = value as Record<string, unknown>;
    if (
      !isStableId(file.designFileId) ||
      !isStableId(file.documentId) ||
      !isNormalizedRelativePath(file.relativePath) ||
      !isContentHash(file.nextDocumentHash) ||
      !isDesignDocument(file.nextDocument)
    ) {
      return false;
    }
    const descriptor = manifest.designFiles.find(
      ({ designFileId }) => designFileId === file.designFileId,
    );
    if (
      descriptor?.documentId !== file.documentId ||
      descriptor.relativePath !== file.relativePath ||
      file.nextDocument.documentId !== file.documentId ||
      hashContents(JSON.stringify(file.nextDocument, null, 2)) !==
        file.nextDocumentHash
    ) {
      return false;
    }
    identities.add(String(file.designFileId));
  }
  return identities.size === files.length;
}

function isContentHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function hashContents(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

function assertDesignFileName(name: string): void {
  if (!isValidDesignFileName(name)) {
    throw new ProjectHostError(
      "INVALID_DESIGN_FILE",
      "Design file name must contain 1 to 256 visible characters without surrounding whitespace",
    );
  }
}

function isValidDesignFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

async function readHash(path: string): Promise<string | null> {
  try {
    return hashContents(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

async function readBoundedJson(
  path: string,
  limit: number,
  code: "INVALID_PROJECT" | "INVALID_DESIGN_FILE",
): Promise<unknown> {
  const file = await stat(path);
  if (!file.isFile())
    throw new ProjectHostError(code, "Expected a regular file");
  if (file.size > limit) {
    throw new ProjectHostError("FILE_TOO_LARGE", "File exceeds its size limit");
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof ProjectHostError) throw error;
    throw new ProjectHostError(code, "File contains malformed JSON");
  }
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  const temporaryPath = resolve(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    const temporaryFile = await open(temporaryPath, "wx");
    try {
      await temporaryFile.writeFile(contents, { encoding: "utf8" });
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }
    const target = await lstat(path).catch((error: unknown) => {
      if (isMissingPathError(error)) return null;
      throw error;
    });
    if (target?.isSymbolicLink()) {
      throw new ProjectHostError(
        "SYMLINK_NOT_ALLOWED",
        "Refusing to replace a symlink",
      );
    }
    await rename(temporaryPath, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function readProjectLibraryCatalog(
  rootPath: string,
): Promise<ProjectLibraryCatalog> {
  const path = await resolveProjectPath(
    rootPath,
    PROJECT_LIBRARY_CATALOG_PATH,
    false,
  );
  if (!(await pathExists(path))) {
    return {
      version: 1,
      libraries: [],
      enabledLibraryIdsByDesignFileId: {},
      acceptedReleaseIdsByDesignFileId: {},
      ignoredReleaseIdsByDesignFileId: {},
    };
  }
  const value = await readBoundedJson(
    path,
    MAX_LIBRARY_CATALOG_BYTES,
    "INVALID_PROJECT",
  );
  if (!isProjectLibraryCatalog(value)) {
    throw new ProjectHostError(
      "INVALID_PROJECT",
      "Project Library catalog is invalid",
    );
  }
  return value;
}

async function writeProjectLibraryCatalog(
  rootPath: string,
  catalog: ProjectLibraryCatalog,
): Promise<void> {
  if (!isProjectLibraryCatalog(catalog)) {
    throw new ProjectHostError(
      "INVALID_PROJECT",
      "Project Library catalog is invalid",
    );
  }
  const path = await resolveProjectPath(
    rootPath,
    PROJECT_LIBRARY_CATALOG_PATH,
    false,
  );
  const contents = JSON.stringify(catalog, null, 2);
  if (Buffer.byteLength(contents, "utf8") > MAX_LIBRARY_CATALOG_BYTES) {
    throw new ProjectHostError(
      "FILE_TOO_LARGE",
      "Project Library catalog exceeds its size limit",
    );
  }
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, contents);
}

function libraryReleaseRelativePath(
  libraryId: string,
  releaseId: string,
): string {
  if (!isLibraryStorageId(libraryId) || !isLibraryStorageId(releaseId)) {
    throw new ProjectHostError(
      "INVALID_PROJECT",
      "Library storage identity is invalid",
    );
  }
  return `${PROJECT_LIBRARY_RELEASE_DIRECTORY}/${libraryId}/${releaseId}.json`;
}

function isLibraryStorageId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

async function removeDurably(path: string): Promise<void> {
  await rm(path, { force: true });
  await syncDirectory(dirname(path));
}

async function syncDirectory(path: string): Promise<void> {
  // Windows does not support fsync on directory handles. The temporary file
  // itself is still flushed before rename; directory metadata flushing is the
  // additional POSIX durability step.
  if (process.platform === "win32") return;
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isWithin(path: string, root: string): boolean {
  const pathRelative = relative(resolve(root), resolve(path));
  return (
    pathRelative === "" ||
    (!pathRelative.startsWith(`..${sep}`) &&
      pathRelative !== ".." &&
      !isAbsolute(pathRelative))
  );
}
