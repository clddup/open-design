import { createLibraryReleaseSnapshot } from "@opendesign/library-service";
import type { DesignOperation } from "@opendesign/design-contracts";
import {
  createEmptyDesignDocument,
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, ProjectLibraryCatalog } from "../shared/desktop-api";
import { translate } from "../shared/i18n/messages";
import { useProjectLibraryActions } from "./use-project-library-actions";

afterEach(() => {
  window.desktop = undefined;
});

describe("useProjectLibraryActions", () => {
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
