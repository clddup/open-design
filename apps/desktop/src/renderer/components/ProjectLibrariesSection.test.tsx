import { createLibraryReleaseSnapshot } from "@opendesign/component-service";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { ProjectLibraryActions } from "../use-project-library-actions";
import { ProjectLibrariesSection } from "./ProjectLibrariesSection";

describe("ProjectLibrariesSection", () => {
  it("publishes, enables, browses, places, and reviews Library components", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    document.componentsById.component_feature = {
      id: "component_feature",
      name: "Feature card",
      rootNodeId: "feature_group",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    const release = createLibraryReleaseSnapshot(document, {
      libraryId: "library_acme",
      releaseId: "release_current",
      sourceProjectId: "project_acme",
      sourceDesignFileId: "design_system",
      name: "Acme Library",
      publishedAt: "2026-08-21T08:00:00.000Z",
    });
    const publish = vi.fn().mockResolvedValue(undefined);
    const setEnabled = vi.fn().mockResolvedValue(undefined);
    const placeComponent = vi
      .fn()
      .mockResolvedValue({ ok: true, message: "Placed Feature card" });
    const acceptUpdate = vi.fn().mockResolvedValue(undefined);
    const ignoreUpdate = vi.fn().mockResolvedValue(undefined);
    const actions: ProjectLibraryActions = {
      available: true,
      busyKey: null,
      error: null,
      items: [
        {
          currentReleaseId: "release_previous",
          enabled: true,
          entry: {
            libraryId: release.libraryId,
            name: release.name,
            sourceProjectId: release.sourceProjectId,
            sourceDesignFileId: release.sourceDesignFileId,
            sourceDocumentId: release.sourceDocumentId,
            latestReleaseId: release.releaseId,
            publishedAt: release.publishedAt,
            releases: [
              {
                releaseId: release.releaseId,
                publishedAt: release.publishedAt,
              },
            ],
          },
          ignored: false,
          release,
          updateAvailable: true,
        },
      ],
      loading: false,
      notice: null,
      published: false,
      publish,
      setEnabled,
      placeComponent,
      acceptUpdate,
      ignoreUpdate,
      clearError: vi.fn(),
    };

    render(
      <I18nProvider initialLocale="en">
        <ProjectLibrariesSection
          actions={actions}
          document={document}
          query=""
        />
      </I18nProvider>,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Publish current file as a Library",
      }),
    );
    expect(publish).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: /^Acme Library Enabled$/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Place Feature card instance" }),
    );
    expect(placeComponent).toHaveBeenCalledWith(
      "library_acme",
      "component_feature",
    );

    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(screen.getByRole("button", { name: "Ignore" }));
    expect(acceptUpdate).toHaveBeenCalledWith("library_acme");
    expect(ignoreUpdate).toHaveBeenCalledWith("library_acme");

    await user.click(
      screen.getByRole("button", { name: "Disable Acme Library" }),
    );
    expect(setEnabled).toHaveBeenCalledWith("library_acme", false);
  });
});
