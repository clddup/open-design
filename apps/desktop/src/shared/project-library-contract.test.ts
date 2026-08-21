import { createEmptyDesignDocument } from "@opendesign/editor-runtime";
import { createLibraryReleaseSnapshot } from "@opendesign/component-service";
import { describe, expect, it } from "vitest";
import {
  isProjectLibraryCatalog,
  isPublishProjectLibraryResult,
  isSetProjectLibraryEnabledRequest,
  isSetProjectLibraryUpdateAcceptedRequest,
  isSetProjectLibraryUpdateIgnoredRequest,
} from "./project-library-contract";

describe("Project Library contract", () => {
  it("accepts bounded catalog state and rejects undeclared or dangling identities", () => {
    const catalog = {
      version: 1 as const,
      libraries: [
        {
          libraryId: "library_acme",
          name: "Acme Library",
          sourceProjectId: "project_acme",
          sourceDesignFileId: "design_system",
          sourceDocumentId: "document_system",
          latestReleaseId: "release_current",
          publishedAt: "2026-08-21T08:00:00.000Z",
          releases: [
            {
              releaseId: "release_current",
              publishedAt: "2026-08-21T08:00:00.000Z",
            },
          ],
        },
      ],
      enabledLibraryIdsByDesignFileId: {
        design_consumer: ["library_acme"],
      },
      acceptedReleaseIdsByDesignFileId: {},
      ignoredReleaseIdsByDesignFileId: {
        design_consumer: { library_acme: "release_current" },
      },
    };
    expect(isProjectLibraryCatalog(catalog)).toBe(true);
    expect(
      isProjectLibraryCatalog({
        ...catalog,
        enabledLibraryIdsByDesignFileId: {
          design_consumer: ["library_missing"],
        },
      }),
    ).toBe(false);
    expect(isProjectLibraryCatalog({ ...catalog, path: "/tmp/forged" })).toBe(
      false,
    );
    expect(
      isProjectLibraryCatalog({
        ...catalog,
        acceptedReleaseIdsByDesignFileId: {
          design_consumer: { library_acme: "release_current" },
        },
      }),
    ).toBe(false);
  });

  it("validates publish results and mutation requests at the process boundary", () => {
    const document = createEmptyDesignDocument(
      "document_system",
      "page_system",
    );
    const release = createLibraryReleaseSnapshot(document, {
      libraryId: "library_acme",
      releaseId: "release_current",
      sourceProjectId: "project_acme",
      sourceDesignFileId: "design_system",
      name: "Acme Library",
      publishedAt: "2026-08-21T08:00:00.000Z",
    });
    const entry = {
      libraryId: release.libraryId,
      name: release.name,
      sourceProjectId: release.sourceProjectId,
      sourceDesignFileId: release.sourceDesignFileId,
      sourceDocumentId: release.sourceDocumentId,
      latestReleaseId: release.releaseId,
      publishedAt: release.publishedAt,
      releases: [
        { releaseId: release.releaseId, publishedAt: release.publishedAt },
      ],
    };
    const catalog = {
      version: 1 as const,
      libraries: [entry],
      enabledLibraryIdsByDesignFileId: {},
      acceptedReleaseIdsByDesignFileId: {},
      ignoredReleaseIdsByDesignFileId: {},
    };
    expect(isPublishProjectLibraryResult({ catalog, entry, release })).toBe(
      true,
    );
    expect(
      isSetProjectLibraryEnabledRequest({
        projectId: "project_acme",
        designFileId: "design_consumer",
        libraryId: "library_acme",
        enabled: true,
      }),
    ).toBe(true);
    expect(
      isSetProjectLibraryUpdateAcceptedRequest({
        projectId: "project_acme",
        designFileId: "design_consumer",
        libraryId: "library_acme",
        releaseId: "release_current",
      }),
    ).toBe(true);
    expect(
      isSetProjectLibraryUpdateIgnoredRequest({
        projectId: "project_acme",
        designFileId: "design_consumer",
        libraryId: "library_acme",
        releaseId: null,
      }),
    ).toBe(true);
    expect(
      isSetProjectLibraryEnabledRequest({
        projectId: "project_acme",
        designFileId: "design_consumer",
        libraryId: "library_acme",
        enabled: true,
        filePath: "/tmp/forged",
      }),
    ).toBe(false);
  });
});
