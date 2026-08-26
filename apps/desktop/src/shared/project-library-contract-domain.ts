import { isLibraryReleaseSnapshot } from "@opendesign/design-contracts";
import type { ValidationIssue } from "./contract-validation";
import type {
  ProjectLibraryCatalog,
  ProjectLibraryCatalogEntry,
  PublishProjectLibraryResult,
} from "./project-library-contract-schemas";

export function projectLibraryCatalogEntryIssues(
  value: ProjectLibraryCatalogEntry,
): ValidationIssue[] {
  const releaseIds = new Set<string>();
  for (let index = 0; index < value.releases.length; index += 1) {
    const releaseId = value.releases[index].releaseId;
    if (releaseIds.has(releaseId)) {
      return [
        projectLibraryIssue(
          "project_library_catalog_entry.release_duplicate",
          `/releases/${index}/releaseId`,
          `Release ${releaseId} appears more than once`,
        ),
      ];
    }
    releaseIds.add(releaseId);
  }
  return releaseIds.has(value.latestReleaseId)
    ? []
    : [
        projectLibraryIssue(
          "project_library_catalog_entry.latest_release_missing",
          "/latestReleaseId",
          "latestReleaseId must identify one release in this entry",
        ),
      ];
}

export function projectLibraryCatalogIssues(
  value: ProjectLibraryCatalog,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const librariesById = new Map<string, ProjectLibraryCatalogEntry>();
  for (let index = 0; index < value.libraries.length; index += 1) {
    const entry = value.libraries[index];
    const entryIssues = projectLibraryCatalogEntryIssues(entry);
    issues.push(...prefixIssues(entryIssues, `/libraries/${index}`));
    if (librariesById.has(entry.libraryId)) {
      issues.push(
        projectLibraryIssue(
          "project_library_catalog.library_duplicate",
          `/libraries/${index}/libraryId`,
          `Library ${entry.libraryId} appears more than once`,
        ),
      );
    } else {
      librariesById.set(entry.libraryId, entry);
    }
  }

  for (const [designFileId, libraryIds] of Object.entries(
    value.enabledLibraryIdsByDesignFileId,
  )) {
    for (let index = 0; index < libraryIds.length; index += 1) {
      const libraryId = libraryIds[index];
      if (!librariesById.has(libraryId)) {
        issues.push(
          projectLibraryIssue(
            "project_library_catalog.enabled_library_missing",
            `/enabledLibraryIdsByDesignFileId/${escapePath(designFileId)}/${index}`,
            `Enabled library ${libraryId} is not present in the catalog`,
          ),
        );
      }
    }
  }

  issues.push(
    ...releaseDecisionIssues(
      value.acceptedReleaseIdsByDesignFileId,
      librariesById,
      "acceptedReleaseIdsByDesignFileId",
    ),
    ...releaseDecisionIssues(
      value.ignoredReleaseIdsByDesignFileId,
      librariesById,
      "ignoredReleaseIdsByDesignFileId",
    ),
  );

  for (const [designFileId, acceptedByLibraryId] of Object.entries(
    value.acceptedReleaseIdsByDesignFileId,
  )) {
    const ignoredByLibraryId =
      value.ignoredReleaseIdsByDesignFileId[designFileId];
    if (!ignoredByLibraryId) continue;
    for (const libraryId of Object.keys(acceptedByLibraryId)) {
      if (Object.hasOwn(ignoredByLibraryId, libraryId)) {
        issues.push(
          projectLibraryIssue(
            "project_library_catalog.release_decision_conflict",
            `/acceptedReleaseIdsByDesignFileId/${escapePath(designFileId)}/${escapePath(libraryId)}`,
            "One library release cannot be accepted and ignored for the same Design File",
          ),
        );
      }
    }
  }
  return issues.slice(0, 64);
}

function releaseDecisionIssues(
  decisions: Record<string, Record<string, string>>,
  librariesById: ReadonlyMap<string, ProjectLibraryCatalogEntry>,
  field: "acceptedReleaseIdsByDesignFileId" | "ignoredReleaseIdsByDesignFileId",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [designFileId, decisionsByLibraryId] of Object.entries(
    decisions,
  )) {
    for (const [libraryId, releaseId] of Object.entries(decisionsByLibraryId)) {
      const entry = librariesById.get(libraryId);
      const basePath = `/${field}/${escapePath(designFileId)}/${escapePath(libraryId)}`;
      if (!entry) {
        issues.push(
          projectLibraryIssue(
            "project_library_catalog.decision_library_missing",
            basePath,
            `Library ${libraryId} is not present in the catalog`,
          ),
        );
        continue;
      }
      if (!entry.releases.some((release) => release.releaseId === releaseId)) {
        issues.push(
          projectLibraryIssue(
            "project_library_catalog.decision_release_missing",
            basePath,
            `Release ${releaseId} is not present in library ${libraryId}`,
          ),
        );
      }
    }
  }
  return issues;
}

export function publishProjectLibraryResultIssues(
  value: PublishProjectLibraryResult,
): ValidationIssue[] {
  const issues = [
    ...prefixIssues(projectLibraryCatalogIssues(value.catalog), "/catalog"),
    ...prefixIssues(projectLibraryCatalogEntryIssues(value.entry), "/entry"),
  ];
  if (!isLibraryReleaseSnapshot(value.release)) {
    issues.push(
      projectLibraryIssue(
        "publish_project_library_result.release_invalid",
        "/release",
        "Library release violates the canonical DesignDocument release contract",
      ),
    );
    return issues;
  }
  if (value.entry.libraryId !== value.release.libraryId) {
    issues.push(
      projectLibraryIssue(
        "publish_project_library_result.library_mismatch",
        "/entry/libraryId",
        "Catalog entry and release must identify the same library",
      ),
    );
  }
  if (value.entry.latestReleaseId !== value.release.releaseId) {
    issues.push(
      projectLibraryIssue(
        "publish_project_library_result.release_mismatch",
        "/entry/latestReleaseId",
        "Catalog entry latestReleaseId must identify the published release",
      ),
    );
  }
  return issues;
}

function prefixIssues(
  issues: readonly ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((current) => ({
    ...current,
    path: `${prefix}${current.path === "/" ? "" : current.path}`,
  }));
}

export function projectLibraryIssue(
  code: string,
  path: string,
  message: string,
): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery:
      "Refresh the Project Library catalog and retry with current stable identities.",
  };
}

function escapePath(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
