import { createLibraryReleaseSnapshot } from "@opendesign/library-service";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { createScopedVariableInspection } from "./design-variable-inspection";

describe("design Variable inspection", () => {
  it("separates local and imported definitions while resolving imported bindings", () => {
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
      valuesByMode: { default: "Imported title" },
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
    const document = structuredClone(createWelcomeDocument());
    document.libraryVariableCollectionsById = structuredClone(
      release.variableCollectionsById,
    );
    document.libraryVariablesById = structuredClone(release.variablesById);
    const title = document.nodesById.title_welcome;
    if (!title) throw new Error("Welcome title is missing");
    title.boundVariables = {
      characters: { type: "VARIABLE_ALIAS", id: "title-copy" },
    };

    const inspection = createScopedVariableInspection(
      document,
      ["page_welcome"],
      { title_welcome: title },
    );

    expect(inspection.variableCollectionsById).toEqual({});
    expect(inspection.variablesById).toEqual({});
    expect(
      inspection.libraryVariableCollectionsById.content?.source,
    ).toMatchObject({
      libraryId: "library_acme",
      sourceVariableCollectionId: "content",
    });
    expect(inspection.libraryVariablesById["title-copy"]?.source).toMatchObject(
      {
        libraryId: "library_acme",
        sourceVariableId: "title-copy",
      },
    );
    expect(
      inspection.variableResolutionsByNodeId.title_welcome?.characters,
    ).toMatchObject({ ok: true, resolved: { value: "Imported title" } });
    expect(inspection.designSystemIds).toEqual({
      variableCollections: [],
      variables: [],
    });
  });
});
