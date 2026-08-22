import { createLibraryReleaseSnapshot } from "@opendesign/library-service";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { ProjectLibraryActions } from "../../use-project-library-actions";
import { VariableSection } from "./VariableSection";

describe("Variable Inspector section", () => {
  it("sorts compatible picker candidates, exposes mode override, and emits stable targets", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    document.variableCollectionOrder = ["theme"];
    document.variableCollectionsById.theme = {
      id: "theme",
      key: "theme-key",
      name: "Theme",
      hiddenFromPublishing: false,
      modes: [
        { modeId: "light", name: "Light" },
        { modeId: "dark", name: "Dark" },
      ],
      variableIds: ["copy", "opacity"],
      defaultModeId: "light",
      extensions: {},
    };
    document.variablesById.copy = {
      id: "copy",
      key: "copy-key",
      name: "Content/Title",
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "theme",
      resolvedType: "STRING",
      valuesByMode: { light: "Light title", dark: "Dark title" },
      scopes: ["TEXT_CONTENT"],
      codeSyntax: {},
      extensions: {},
    };
    document.variablesById.opacity = {
      id: "opacity",
      key: "opacity-key",
      name: "Opacity/Muted",
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "theme",
      resolvedType: "FLOAT",
      valuesByMode: { light: 0.8, dark: 0.6 },
      scopes: ["OPACITY"],
      codeSyntax: {},
      extensions: {},
    };
    const node = document.nodesById.title_welcome;
    if (!node) throw new Error("Welcome title is missing");
    const onSetBinding = vi.fn();
    const onSetExplicitMode = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <VariableSection
          activePageId="page_welcome"
          document={document}
          node={node}
          onSetBinding={onSetBinding}
          onSetExplicitMode={onSetExplicitMode}
        />
      </I18nProvider>,
    );

    await user.selectOptions(screen.getByLabelText("Theme Mode"), "dark");
    expect(onSetExplicitMode).toHaveBeenCalledWith("theme", "dark");
    const contentPicker = screen.getByLabelText("Text content variable");
    await user.click(contentPicker);
    await user.clear(contentPicker);
    await user.type(contentPicker, "Content/Title");
    screen
      .getByText("Content/Title")
      .closest<HTMLElement>("[role=option]")
      ?.click();
    expect(onSetBinding).toHaveBeenCalledWith(
      { kind: "node", nodeId: "title_welcome", field: "characters" },
      "copy",
    );
    const opacityPicker = screen.getByLabelText("Opacity variable");
    await user.click(opacityPicker);
    await user.clear(opacityPicker);
    await user.type(opacityPicker, "Content/Title");
    expect(screen.queryByText("Content/Title")).toBeNull();
  });

  it("shows enabled Library variables and delegates first binding to the atomic Library path", async () => {
    const user = userEvent.setup();
    const source = structuredClone(createWelcomeDocument());
    source.variableCollectionOrder = ["theme"];
    source.variableCollectionsById.theme = {
      id: "theme",
      key: "theme-key",
      name: "Theme",
      hiddenFromPublishing: false,
      modes: [{ modeId: "default", name: "Default" }],
      variableIds: ["copy"],
      defaultModeId: "default",
      extensions: {},
    };
    source.variablesById.copy = {
      id: "copy",
      key: "copy-key",
      name: "Content/Title",
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "theme",
      resolvedType: "STRING",
      valuesByMode: { default: "Library title" },
      scopes: ["TEXT_CONTENT"],
      codeSyntax: {},
      extensions: {},
    };
    const release = createLibraryReleaseSnapshot(source, {
      libraryId: "library_acme",
      releaseId: "release_current",
      sourceProjectId: "project_acme",
      sourceDesignFileId: "design_system",
      name: "Acme Library",
      publishedAt: "2026-08-22T08:00:00.000Z",
    });
    const applyVariable = vi.fn().mockResolvedValue({ ok: true });
    const projectLibraries: ProjectLibraryActions = {
      available: true,
      busyKey: null,
      error: null,
      items: [
        {
          currentReleaseId: null,
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
          updateAvailable: false,
        },
      ],
      loading: false,
      notice: null,
      published: false,
      publish: () => Promise.resolve(),
      setEnabled: () => Promise.resolve(),
      placeComponent: () =>
        Promise.resolve({ ok: false, error: "No component" }),
      applyStyle: () => Promise.resolve({ ok: false, error: "No style" }),
      applyVariable,
      acceptUpdate: () => Promise.resolve(),
      ignoreUpdate: () => Promise.resolve(),
      clearError: () => undefined,
    };
    const document = structuredClone(createWelcomeDocument());
    const node = document.nodesById.title_welcome;
    if (!node) throw new Error("Welcome title is missing");
    render(
      <I18nProvider initialLocale="en">
        <VariableSection
          activePageId="page_welcome"
          document={document}
          node={node}
          onSetBinding={vi.fn()}
          onSetExplicitMode={vi.fn()}
          projectLibraries={projectLibraries}
        />
      </I18nProvider>,
    );

    const picker = screen.getByLabelText("Text content variable");
    await user.click(picker);
    await user.clear(picker);
    await user.type(picker, "Acme Library");
    screen
      .getByText("Content/Title")
      .closest<HTMLElement>("[role=option]")
      ?.click();

    expect(applyVariable).toHaveBeenCalledWith("library_acme", "copy", {
      kind: "node",
      nodeId: "title_welcome",
      field: "characters",
    });
  });
});
