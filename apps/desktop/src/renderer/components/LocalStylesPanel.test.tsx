import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { TooltipProvider } from "@opendesign/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { I18nProvider } from "../i18n";
import type { StyleActions } from "../use-style-actions";
import type { ProjectLibraryActions } from "../use-project-library-actions";
import { LocalStylesPanel } from "./LocalStylesPanel";
import { StyleReferencesSection } from "./properties/StyleReferencesSection";

describe("Local Styles workbench", () => {
  it("creates from the real selected property and manages ordered local styles", async () => {
    const user = userEvent.setup();
    const document = fixture();
    const actions = actionSpies();
    renderUi(
      <LocalStylesPanel
        actions={actions}
        document={document}
        selectedNodeIds={["title_welcome"]}
      />,
    );
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "id",
      "sidebar-styles",
    );
    expect(screen.getAllByText("Brand")).toHaveLength(2);
    await user.type(
      screen.getAllByLabelText("Style name").at(-1)!,
      "Brand/Accent{Enter}",
    );
    expect(actions.createFromNode).toHaveBeenCalledWith(
      "title_welcome",
      "fillStyleId",
      "Brand/Accent",
    );
    await user.click(
      screen.getByRole("button", { name: "Move Brand/Primary down" }),
    );
    expect(actions.moveStyle).toHaveBeenCalledWith("brand", 1);
  });

  it("applies, creates, updates and detaches typed Inspector references", async () => {
    const user = userEvent.setup();
    const document = fixture();
    const actions = actionSpies();
    const node = document.nodesById.title_welcome;
    renderUi(
      <StyleReferencesSection
        actions={actions}
        document={document}
        node={node}
      />,
    );
    await user.click(screen.getAllByLabelText("Apply Paint style")[0]);
    await user.click(screen.getAllByText("Brand/Primary")[0]);
    expect(actions.setReference).toHaveBeenCalledWith(
      { nodeId: "title_welcome", field: "fillStyleId" },
      "brand",
    );
    await user.click(
      screen.getAllByRole("button", {
        name: "Create style from this property",
      })[0],
    );
    expect(actions.createFromNode).toHaveBeenCalledWith(
      "title_welcome",
      "fillStyleId",
      "Untitled style",
    );
  });

  it("shows enabled Library Styles in the property picker and applies one through the Library transaction path", async () => {
    const user = userEvent.setup();
    const document = fixture();
    const actions = actionSpies();
    const applyStyle = vi.fn().mockResolvedValue({
      ok: true,
      message: "Applied Brand/Library",
    });
    const projectLibraries = libraryActions(applyStyle);
    renderUi(
      <StyleReferencesSection
        actions={actions}
        document={document}
        node={document.nodesById.title_welcome}
        projectLibraries={projectLibraries}
      />,
    );

    const picker = screen.getAllByLabelText("Apply Paint style")[0];
    await user.click(picker);
    await user.clear(picker);
    await user.type(picker, "Acme");
    expect(screen.getByText("Brand/Library")).toBeInTheDocument();
    expect(screen.getByText("Acme Library")).toBeInTheDocument();
    const option = screen
      .getByText("Brand/Library")
      .closest<HTMLElement>("[role=option]");
    option?.click();
    expect(applyStyle).toHaveBeenCalledWith("library_acme", "brand-library", {
      nodeId: "title_welcome",
      field: "fillStyleId",
    });
  });

  it("keeps same-id Styles from separate Libraries distinguishable in the picker", async () => {
    const user = userEvent.setup();
    const document = fixture();
    const applyStyle = vi.fn().mockResolvedValue({ ok: true });
    const acme = libraryActions(applyStyle);
    const first = acme.items[0];
    if (!first?.release) throw new Error("Missing Library fixture");
    const otherRelease = structuredClone(first.release);
    otherRelease.libraryId = "library_other";
    otherRelease.sourceDesignFileId = "other_design_system";
    otherRelease.sourceDocumentId = "document_other_design_system";
    const otherStyle = otherRelease.stylesById["brand-library"];
    if (!otherStyle) throw new Error("Missing Style fixture");
    otherStyle.source.libraryId = otherRelease.libraryId;
    otherStyle.source.sourceDesignFileId = otherRelease.sourceDesignFileId;
    otherStyle.source.sourceDocumentId = otherRelease.sourceDocumentId;
    otherStyle.style.name = "Other/Primary";
    const projectLibraries: ProjectLibraryActions = {
      ...acme,
      items: [
        first,
        {
          ...first,
          entry: {
            ...first.entry,
            libraryId: otherRelease.libraryId,
            name: "Other Library",
            sourceDesignFileId: otherRelease.sourceDesignFileId,
            sourceDocumentId: otherRelease.sourceDocumentId,
          },
          release: otherRelease,
        },
      ],
    };
    renderUi(
      <StyleReferencesSection
        actions={actionSpies()}
        document={document}
        node={document.nodesById.title_welcome}
        projectLibraries={projectLibraries}
      />,
    );

    const picker = screen.getAllByLabelText("Apply Paint style")[0];
    await user.click(picker);
    await user.clear(picker);
    await user.type(picker, "Other Library");
    expect(screen.getByText("Other/Primary")).toBeInTheDocument();
    screen
      .getByText("Other/Primary")
      .closest<HTMLElement>("[role=option]")
      ?.click();
    expect(applyStyle).toHaveBeenCalledWith("library_other", "brand-library", {
      nodeId: "title_welcome",
      field: "fillStyleId",
    });
  });
});

function fixture() {
  const document = structuredClone(createWelcomeDocument());
  document.styleOrderByType.PAINT = ["brand", "accent"];
  document.stylesById.brand = paintStyle("brand", "Brand/Primary", "#2563eb");
  document.stylesById.accent = paintStyle("accent", "Brand/Accent", "#db2777");
  return document;
}

function paintStyle(id: string, name: string, color: string) {
  return {
    id,
    key: `${id}-key`,
    name,
    description: "",
    hiddenFromPublishing: false,
    styleType: "PAINT" as const,
    paints: [{ type: "solid" as const, color, opacity: 1 }],
    extensions: {},
  };
}

function actionSpies() {
  return {
    createFromNode: vi.fn(() => true),
    updateStyle: vi.fn(() => true),
    updateFromNode: vi.fn(() => true),
    moveStyle: vi.fn(() => true),
    deleteStyle: vi.fn(() => true),
    setReference: vi.fn(() => true),
  } satisfies StyleActions;
}

function libraryActions(
  applyStyle: ProjectLibraryActions["applyStyle"],
): ProjectLibraryActions {
  return {
    available: true,
    busyKey: null,
    error: null,
    items: [
      {
        currentReleaseId: "release_current",
        enabled: true,
        entry: {
          libraryId: "library_acme",
          name: "Acme Library",
          sourceProjectId: "project_acme",
          sourceDesignFileId: "design_system",
          sourceDocumentId: "document_design_system",
          latestReleaseId: "release_current",
          publishedAt: "2026-08-22T08:00:00.000Z",
          releases: [
            {
              releaseId: "release_current",
              publishedAt: "2026-08-22T08:00:00.000Z",
            },
          ],
        },
        ignored: false,
        release: {
          version: 2,
          libraryId: "library_acme",
          releaseId: "release_current",
          sourceProjectId: "project_acme",
          sourceDesignFileId: "design_system",
          sourceDocumentId: "document_design_system",
          name: "Acme Library",
          publishedAt: "2026-08-22T08:00:00.000Z",
          componentsById: {},
          variantSetsById: {},
          stylesById: {
            "brand-library": {
              source: {
                libraryId: "library_acme",
                releaseId: "release_current",
                sourceProjectId: "project_acme",
                sourceDesignFileId: "design_system",
                sourceDocumentId: "document_design_system",
                sourceStyleId: "brand-library",
              },
              style: paintStyle("brand-library", "Brand/Library", "#7c3aed"),
            },
          },
        },
        updateAvailable: false,
      },
    ],
    loading: false,
    notice: null,
    published: false,
    publish: () => Promise.resolve(),
    setEnabled: () => Promise.resolve(),
    placeComponent: () => Promise.resolve({ ok: false, error: "No component" }),
    applyStyle,
    acceptUpdate: () => Promise.resolve(),
    ignoreUpdate: () => Promise.resolve(),
    clearError: () => undefined,
  };
}

function renderUi(children: ReactNode) {
  return render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">{children}</I18nProvider>
    </TooltipProvider>,
  );
}
