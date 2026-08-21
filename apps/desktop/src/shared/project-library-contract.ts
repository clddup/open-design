import {
  isLibraryReleaseSnapshot,
  type LibraryReleaseSnapshot,
} from "@opendesign/design-contracts";
import { isStableId } from "@opendesign/workspace-contracts";

export interface ProjectLibraryCatalogEntry {
  libraryId: string;
  name: string;
  sourceProjectId: string;
  sourceDesignFileId: string;
  sourceDocumentId: string;
  latestReleaseId: string;
  publishedAt: string;
  releases: Array<{ releaseId: string; publishedAt: string }>;
}

export interface ProjectLibraryCatalog {
  version: 1;
  libraries: ProjectLibraryCatalogEntry[];
  enabledLibraryIdsByDesignFileId: Record<string, string[]>;
  acceptedReleaseIdsByDesignFileId: Record<string, Record<string, string>>;
  ignoredReleaseIdsByDesignFileId: Record<string, Record<string, string>>;
}

export interface PublishProjectLibraryRequest {
  projectId: string;
  designFileId: string;
  name?: string;
}

export interface PublishProjectLibraryResult {
  catalog: ProjectLibraryCatalog;
  entry: ProjectLibraryCatalogEntry;
  release: LibraryReleaseSnapshot;
}

export interface ListProjectLibrariesRequest {
  projectId: string;
}

export interface ReadProjectLibraryReleaseRequest {
  projectId: string;
  libraryId: string;
  releaseId?: string;
}

export interface SetProjectLibraryEnabledRequest {
  projectId: string;
  designFileId: string;
  libraryId: string;
  enabled: boolean;
}

export interface SetProjectLibraryUpdateIgnoredRequest {
  projectId: string;
  designFileId: string;
  libraryId: string;
  releaseId: string | null;
}

export interface SetProjectLibraryUpdateAcceptedRequest {
  projectId: string;
  designFileId: string;
  libraryId: string;
  releaseId: string;
}

export function isProjectLibraryCatalog(
  value: unknown,
): value is ProjectLibraryCatalog {
  if (!isRecord(value)) return false;
  if (
    value.version !== 1 ||
    !Array.isArray(value.libraries) ||
    !isRecord(value.enabledLibraryIdsByDesignFileId) ||
    !isRecord(value.acceptedReleaseIdsByDesignFileId) ||
    !isRecord(value.ignoredReleaseIdsByDesignFileId) ||
    !onlyKeys(value, [
      "version",
      "libraries",
      "enabledLibraryIdsByDesignFileId",
      "acceptedReleaseIdsByDesignFileId",
      "ignoredReleaseIdsByDesignFileId",
    ])
  ) {
    return false;
  }
  const libraries = value.libraries;
  if (
    libraries.length > 4_096 ||
    !libraries.every(isProjectLibraryCatalogEntry)
  ) {
    return false;
  }
  const libraryIds = new Set(libraries.map((entry) => entry.libraryId));
  const releaseIdsByLibraryId = new Map(
    libraries.map((entry) => [
      entry.libraryId,
      new Set(entry.releases.map((release) => release.releaseId)),
    ]),
  );
  if (libraryIds.size !== libraries.length) return false;
  if (
    !Object.entries(value.enabledLibraryIdsByDesignFileId).every(
      ([designFileId, ids]) =>
        isStableId(designFileId) &&
        Array.isArray(ids) &&
        ids.length <= 4_096 &&
        ids.every((id) => typeof id === "string" && libraryIds.has(id)) &&
        new Set(ids).size === ids.length,
    )
  ) {
    return false;
  }
  return (
    isReleaseDecisionMap(
      value.acceptedReleaseIdsByDesignFileId,
      releaseIdsByLibraryId,
    ) &&
    isReleaseDecisionMap(
      value.ignoredReleaseIdsByDesignFileId,
      releaseIdsByLibraryId,
    ) &&
    releaseDecisionsAreDisjoint(
      value.acceptedReleaseIdsByDesignFileId,
      value.ignoredReleaseIdsByDesignFileId,
    )
  );
}

function releaseDecisionsAreDisjoint(
  accepted: Record<string, unknown>,
  ignored: Record<string, unknown>,
) {
  for (const [designFileId, acceptedByLibrary] of Object.entries(accepted)) {
    if (!isRecord(acceptedByLibrary)) return false;
    const ignoredByLibrary = ignored[designFileId];
    if (!isRecord(ignoredByLibrary)) continue;
    if (
      Object.keys(acceptedByLibrary).some((libraryId) =>
        Object.hasOwn(ignoredByLibrary, libraryId),
      )
    ) {
      return false;
    }
  }
  return true;
}

function isReleaseDecisionMap(
  value: Record<string, unknown>,
  releaseIdsByLibraryId: ReadonlyMap<string, ReadonlySet<string>>,
) {
  return Object.entries(value).every(
    ([designFileId, ignored]) =>
      isStableId(designFileId) &&
      isRecord(ignored) &&
      Object.entries(ignored).every(
        ([libraryId, releaseId]) =>
          isLibraryStorageId(releaseId) &&
          releaseIdsByLibraryId.get(libraryId)?.has(releaseId) === true,
      ),
  );
}

export function isProjectLibraryCatalogEntry(
  value: unknown,
): value is ProjectLibraryCatalogEntry {
  if (!isRecord(value) || !Array.isArray(value.releases)) return false;
  if (
    !onlyKeys(value, [
      "libraryId",
      "name",
      "sourceProjectId",
      "sourceDesignFileId",
      "sourceDocumentId",
      "latestReleaseId",
      "publishedAt",
      "releases",
    ]) ||
    !isLibraryStorageId(value.libraryId) ||
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > 256 ||
    !isStableId(value.sourceProjectId) ||
    !isStableId(value.sourceDesignFileId) ||
    !isStableId(value.sourceDocumentId) ||
    !isLibraryStorageId(value.latestReleaseId) ||
    !isTimestamp(value.publishedAt) ||
    value.releases.length < 1 ||
    value.releases.length > 4_096
  ) {
    return false;
  }
  const releaseIds = new Set<string>();
  for (const release of value.releases) {
    if (
      !isRecord(release) ||
      !onlyKeys(release, ["releaseId", "publishedAt"]) ||
      !isLibraryStorageId(release.releaseId) ||
      !isTimestamp(release.publishedAt) ||
      releaseIds.has(release.releaseId)
    ) {
      return false;
    }
    releaseIds.add(release.releaseId);
  }
  return releaseIds.has(value.latestReleaseId);
}

export function isPublishProjectLibraryRequest(
  value: unknown,
): value is PublishProjectLibraryRequest {
  return (
    isRecord(value) &&
    isStableId(value.projectId) &&
    isStableId(value.designFileId) &&
    (value.name === undefined || boundedName(value.name)) &&
    onlyKeys(value, ["projectId", "designFileId", "name"])
  );
}

export function isPublishProjectLibraryResult(
  value: unknown,
): value is PublishProjectLibraryResult {
  return (
    isRecord(value) &&
    isProjectLibraryCatalog(value.catalog) &&
    isProjectLibraryCatalogEntry(value.entry) &&
    isLibraryReleaseSnapshot(value.release) &&
    value.entry.libraryId === value.release.libraryId &&
    value.entry.latestReleaseId === value.release.releaseId &&
    onlyKeys(value, ["catalog", "entry", "release"])
  );
}

export function isListProjectLibrariesRequest(
  value: unknown,
): value is ListProjectLibrariesRequest {
  return (
    isRecord(value) &&
    isStableId(value.projectId) &&
    onlyKeys(value, ["projectId"])
  );
}

export function isReadProjectLibraryReleaseRequest(
  value: unknown,
): value is ReadProjectLibraryReleaseRequest {
  return (
    isRecord(value) &&
    isStableId(value.projectId) &&
    isLibraryStorageId(value.libraryId) &&
    (value.releaseId === undefined || isLibraryStorageId(value.releaseId)) &&
    onlyKeys(value, ["projectId", "libraryId", "releaseId"])
  );
}

export function isSetProjectLibraryEnabledRequest(
  value: unknown,
): value is SetProjectLibraryEnabledRequest {
  return (
    isRecord(value) &&
    isStableId(value.projectId) &&
    isStableId(value.designFileId) &&
    isLibraryStorageId(value.libraryId) &&
    typeof value.enabled === "boolean" &&
    onlyKeys(value, ["projectId", "designFileId", "libraryId", "enabled"])
  );
}

export function isSetProjectLibraryUpdateIgnoredRequest(
  value: unknown,
): value is SetProjectLibraryUpdateIgnoredRequest {
  return (
    isRecord(value) &&
    isStableId(value.projectId) &&
    isStableId(value.designFileId) &&
    isLibraryStorageId(value.libraryId) &&
    (value.releaseId === null || isLibraryStorageId(value.releaseId)) &&
    onlyKeys(value, ["projectId", "designFileId", "libraryId", "releaseId"])
  );
}

export function isSetProjectLibraryUpdateAcceptedRequest(
  value: unknown,
): value is SetProjectLibraryUpdateAcceptedRequest {
  return (
    isRecord(value) &&
    isStableId(value.projectId) &&
    isStableId(value.designFileId) &&
    isLibraryStorageId(value.libraryId) &&
    isLibraryStorageId(value.releaseId) &&
    onlyKeys(value, ["projectId", "designFileId", "libraryId", "releaseId"])
  );
}

function boundedName(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length >= 1 && value.length <= 256
  );
}

function isLibraryStorageId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
