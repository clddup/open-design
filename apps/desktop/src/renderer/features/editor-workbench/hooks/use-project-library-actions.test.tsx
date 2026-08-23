import { createLibraryReleaseSnapshot } from "@opendesign/library-service";
import type { DesignOperation } from "@opendesign/design-contracts";
import {
  createEmptyDesignDocument,
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopApi,
  ProjectLibraryCatalog,
} from "../../../../shared/desktop-api";
import { translate } from "../../../../shared/i18n/messages";
import { useProjectLibraryActions } from "./use-project-library-actions";

afterEach(() => {
  window.desktop = undefined;
});

describe("useProjectLibraryActions", () => {
  it("imports and binds a Library Variable in one runtime transaction", async () => {
    const source = structuredClone(createWelcomeDocument());
    source.variableCollectionOrder = ["content"];
    source.variableCollectionsById.content = {
      id: "content",
      key: "content-key",
      name: "Content",
      hiddenFromPublishing: false,
      modes: [{ modeId: "default", name: "Default" }],
      variableIds: ["title-copy"],
      defaultModeId: "default",
      extensions: {},
    };
    source.variablesById["title-copy"] = {
      id: "title-copy",
      key: "title-copy-key",
      name: "Content/Title",
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "content",
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
    const catalog: ProjectLibraryCatalog = {
      version: 1,
      libraries: [
        {
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
      ],
      enabledLibraryIdsByDesignFileId: {
        design_consumer: [release.libraryId],
      },
      acceptedReleaseIdsByDesignFileId: {},
      ignoredReleaseIdsByDesignFileId: {},
    };
    window.desktop = {
      listProjectLibraries: vi.fn().mockResolvedValue(catalog),
      readProjectLibraryRelease: vi.fn().mockResolvedValue(release),
    } as unknown as DesktopApi;
    const runtime = new EditorRuntime(createWelcomeDocument());
    const applyCommands = vi.fn(
      (label: string, commands: DesignOperation[]) => {
        const current = runtime.getSnapshot().document;
        return runtime.apply({
          transactionId: "apply_library_variable",
          documentId: current.documentId,
          baseRevision: current.revision,
          actor: { type: "user", id: "test" },
          label,
          commands,
        }).ok;
      },
    );
    const { result } = renderHook(() =>
      useProjectLibraryActions({
        activeDesignFileId: "design_consumer",
        activePageId: "page_welcome",
        activeProjectId: "project_acme",
        applyCommands,
        document: runtime.getSnapshot().document,
        projectBacked: true,
        runtime,
        t: (key, parameters) => translate("en", key, parameters),
        transactionCounter: { current: 0 },
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect(
        await result.current.applyVariable("library_acme", "title-copy", {
          kind: "node",
          nodeId: "title_welcome",
          field: "characters",
        }),
      ).toMatchObject({ ok: true });
    });

    expect(applyCommands).toHaveBeenCalledTimes(1);
    expect(
      applyCommands.mock.calls[0]?.[1].map((command) => command.type),
    ).toEqual([
      "put_library_variable_collection_source",
      "put_library_variable_source",
      "set_variable_binding",
    ]);
    expect(runtime.getSnapshot().document).toMatchObject({
      revision: 1,
      libraryVariableCollectionsById: { content: {} },
      libraryVariablesById: { "title-copy": {} },
      nodesById: {
        title_welcome: {
          boundVariables: {
            characters: { type: "VARIABLE_ALIAS", id: "title-copy" },
          },
        },
      },
    });
    expect(runtime.undo("user")).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.libraryVariablesById).toEqual({});
  });

  it("keeps an imported file on its accepted release until the user accepts an update", async () => {
    const source = structuredClone(createWelcomeDocument());
    source.componentsById.component_feature = {
      id: "component_feature",
      name: "Feature card",
      rootNodeId: "feature_group",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    source.stylesById.brand_primary = paintStyle("#2563eb");
    source.styleOrderByType.PAINT.push("brand_primary");
    source.variableCollectionOrder = ["theme"];
    source.variableCollectionsById.theme = {
      id: "theme",
      key: "theme-key",
      name: "Theme",
      hiddenFromPublishing: false,
      modes: [{ modeId: "default", name: "Default" }],
      variableIds: ["opacity-muted"],
      defaultModeId: "default",
      extensions: {},
    };
    source.variablesById["opacity-muted"] = {
      id: "opacity-muted",
      key: "opacity-muted-key",
      name: "Opacity/Muted",
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "theme",
      resolvedType: "FLOAT",
      valuesByMode: { default: 0.8 },
      scopes: ["OPACITY"],
      codeSyntax: {},
      extensions: {},
    };
    const previous = createLibraryReleaseSnapshot(source, {
      libraryId: "library_acme",
      releaseId: "release_previous",
      sourceProjectId: "project_acme",
      sourceDesignFileId: "design_system",
      name: "Acme Library",
      publishedAt: "2026-08-20T08:00:00.000Z",
    });
    const feature = source.nodesById.feature_one;
    if (feature?.kind !== "rectangle") throw new Error("Feature is missing");
    feature.properties.fills = [
      { type: "solid", color: "#ef4444", opacity: 1 },
    ];
    const latestStyle = source.stylesById.brand_primary;
    if (!latestStyle || latestStyle.styleType !== "PAINT") {
      throw new Error("Library Paint Style is missing");
    }
    latestStyle.paints = [{ type: "solid", color: "#db2777", opacity: 1 }];
    source.variablesById["opacity-muted"].valuesByMode.default = 0.6;
    const latest = createLibraryReleaseSnapshot(source, {
      libraryId: "library_acme",
      releaseId: "release_current",
      sourceProjectId: "project_acme",
      sourceDesignFileId: "design_system",
      name: "Acme Library",
      publishedAt: "2026-08-21T08:00:00.000Z",
    });
    const consumer = structuredClone(
      createEmptyDesignDocument("document_consumer", "page_consumer"),
    );
    consumer.libraryComponentsById = structuredClone(previous.componentsById);
    consumer.libraryVariantSetsById = structuredClone(previous.variantSetsById);
    consumer.libraryStylesById = structuredClone(previous.stylesById);
    consumer.libraryVariableCollectionsById = structuredClone(
      previous.variableCollectionsById,
    );
    consumer.libraryVariablesById = structuredClone(previous.variablesById);
    consumer.nodesById.consumer_shape = {
      id: "consumer_shape",
      kind: "rectangle",
      name: "Consumer shape",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 120, height: 80 },
      exportSettings: [],
      opacity: 1,
      boundVariables: {
        opacity: { type: "VARIABLE_ALIAS", id: "opacity-muted" },
      },
      fillStyleId: "brand_primary",
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
      },
      extensions: {},
    };
    consumer.pagesById.page_consumer.rootNodeIds.push("consumer_shape");
    const catalog: ProjectLibraryCatalog = {
      version: 1,
      libraries: [
        {
          libraryId: latest.libraryId,
          name: latest.name,
          sourceProjectId: latest.sourceProjectId,
          sourceDesignFileId: latest.sourceDesignFileId,
          sourceDocumentId: latest.sourceDocumentId,
          latestReleaseId: latest.releaseId,
          publishedAt: latest.publishedAt,
          releases: [
            {
              releaseId: previous.releaseId,
              publishedAt: previous.publishedAt,
            },
            {
              releaseId: latest.releaseId,
              publishedAt: latest.publishedAt,
            },
          ],
        },
      ],
      enabledLibraryIdsByDesignFileId: {
        design_consumer: [latest.libraryId],
      },
      acceptedReleaseIdsByDesignFileId: {},
      ignoredReleaseIdsByDesignFileId: {},
    };
    const readProjectLibraryRelease = vi.fn<
      DesktopApi["readProjectLibraryRelease"]
    >((request) =>
      Promise.resolve(
        request.releaseId === previous.releaseId ? previous : latest,
      ),
    );
    const setProjectLibraryUpdateAccepted = vi
      .fn<DesktopApi["setProjectLibraryUpdateAccepted"]>()
      .mockResolvedValue({
        ...catalog,
        acceptedReleaseIdsByDesignFileId: {
          design_consumer: { library_acme: latest.releaseId },
        },
      });
    const saveProjectDesignFile = vi.fn<DesktopApi["saveProjectDesignFile"]>(
      (request) =>
        Promise.resolve({
          descriptor: {
            designFileId: "design_consumer",
            documentId: consumer.documentId,
            name: "Consumer",
            relativePath: "designs/consumer.opendesign",
            createdAt: "2026-08-21T08:00:00.000Z",
            updatedAt: "2026-08-21T08:00:00.000Z",
            lifecycle: "active",
          },
          document: request.document,
        }),
    );
    window.desktop = {
      listProjectLibraries: vi.fn().mockResolvedValue(catalog),
      readProjectLibraryRelease,
      saveProjectDesignFile,
      setProjectLibraryUpdateAccepted,
    } as unknown as DesktopApi;
    const runtime = new EditorRuntime(consumer);
    const applyCommands = vi.fn(
      (label: string, commands: DesignOperation[]) => {
        const current = runtime.getSnapshot().document;
        return runtime.apply({
          transactionId: "accept_library_update",
          documentId: current.documentId,
          baseRevision: current.revision,
          actor: { type: "user", id: "test" },
          label,
          commands,
        }).ok;
      },
    );
    const { result } = renderHook(() =>
      useProjectLibraryActions({
        activeDesignFileId: "design_consumer",
        activePageId: "page_consumer",
        activeProjectId: "project_acme",
        applyCommands,
        document: consumer,
        projectBacked: true,
        runtime,
        t: (key, parameters) => translate("en", key, parameters),
        transactionCounter: { current: 0 },
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(readProjectLibraryRelease).toHaveBeenCalledWith({
      projectId: "project_acme",
      libraryId: "library_acme",
      releaseId: "release_previous",
    });
    expect(result.current.items[0]).toMatchObject({
      currentReleaseId: "release_previous",
      updateAvailable: true,
      release: { releaseId: "release_previous" },
    });

    await act(async () => {
      await result.current.acceptUpdate("library_acme");
    });
    expect(readProjectLibraryRelease).toHaveBeenLastCalledWith({
      projectId: "project_acme",
      libraryId: "library_acme",
    });
    expect(applyCommands).toHaveBeenCalledWith(
      "Update Library assets",
      expect.arrayContaining([
        expect.objectContaining({ type: "put_library_component_source" }),
        expect.objectContaining({ type: "put_library_style_source" }),
        expect.objectContaining({
          type: "put_library_variable_collection_source",
        }),
        expect.objectContaining({ type: "put_library_variable_source" }),
      ]),
    );
    expect(setProjectLibraryUpdateAccepted).toHaveBeenCalledWith({
      projectId: "project_acme",
      designFileId: "design_consumer",
      libraryId: "library_acme",
      releaseId: "release_current",
    });
    expect(saveProjectDesignFile.mock.invocationCallOrder[0]).toBeLessThan(
      setProjectLibraryUpdateAccepted.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(
      saveProjectDesignFile.mock.calls[0]?.[0].document.libraryComponentsById
        .component_feature?.source.releaseId,
    ).toBe("release_current");
    expect(
      saveProjectDesignFile.mock.calls[0]?.[0].document.libraryStylesById
        .brand_primary?.source.releaseId,
    ).toBe("release_current");
    expect(
      saveProjectDesignFile.mock.calls[0]?.[0].document.libraryVariablesById[
        "opacity-muted"
      ]?.variable.valuesByMode.default,
    ).toBe(0.6);
    expect(result.current.items[0]).toMatchObject({
      currentReleaseId: "release_current",
      updateAvailable: false,
    });
  });
});

function paintStyle(color: string) {
  return {
    id: "brand_primary",
    key: "brand-primary-key",
    name: "Brand/Primary",
    description: "",
    hiddenFromPublishing: false,
    styleType: "PAINT" as const,
    paints: [{ type: "solid" as const, color, opacity: 1 }],
    extensions: {},
  };
}
