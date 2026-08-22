import type { DesignDocument } from "@opendesign/design-contracts";
import { DESIGN_SCHEMA_VERSION } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  createLibraryReleaseSnapshot,
  planLibraryReleaseImport,
  planLibraryReleaseUpdate,
} from "./index.js";

describe("Library Service Variables", () => {
  it("publishes a Variable-only Library with hidden cross-collection alias dependencies", () => {
    const source = variableDocument();
    const release = createLibraryReleaseSnapshot(source, releaseOptions("r1"));

    expect(release).toMatchObject({
      version: 3,
      componentsById: {},
      stylesById: {},
      variableCollectionsById: {
        semantic: {
          collection: { hiddenFromPublishing: false, variableIds: ["title"] },
        },
        primitive: {
          collection: {
            hiddenFromPublishing: true,
            variableIds: ["title-base"],
          },
        },
      },
      variablesById: {
        title: { variable: { hiddenFromPublishing: false } },
        "title-base": { variable: { hiddenFromPublishing: true } },
      },
    });
    expect(release.variableCollectionsById.unused).toBeUndefined();
    expect(release.variablesById["unused-value"]).toBeUndefined();

    const consumer = emptyDocument("consumer");
    const plan = planLibraryReleaseImport(consumer, release, "import");
    expect(plan.commands.map((command) => command.type)).toEqual([
      "put_library_variable_collection_source",
      "put_library_variable_collection_source",
      "put_library_variable_source",
      "put_library_variable_source",
    ]);
    expect(plan).toMatchObject({
      staleVariableCollectionIds: [],
      staleVariableIds: [],
    });
  });

  it("plans consumed Variable updates and reports removed definitions as stale", () => {
    const source = variableDocument();
    const previous = createLibraryReleaseSnapshot(
      source,
      releaseOptions("previous"),
    );
    const changed = structuredClone(source);
    changed.variableCollectionsById.semantic!.modes.push({
      modeId: "compact",
      name: "Compact",
    });
    changed.variablesById.title!.valuesByMode.compact = {
      type: "VARIABLE_ALIAS",
      id: "title-base",
    };
    const current = createLibraryReleaseSnapshot(
      changed,
      releaseOptions("current"),
    );
    const consumer = emptyDocument("consumer");
    consumer.libraryVariableCollectionsById = structuredClone(
      previous.variableCollectionsById,
    );
    consumer.libraryVariablesById = structuredClone(previous.variablesById);

    const update = planLibraryReleaseUpdate(consumer, current, "update");
    expect(update.commands.map((command) => command.type)).toEqual([
      "put_library_variable_collection_source",
      "put_library_variable_collection_source",
      "put_library_variable_source",
      "put_library_variable_source",
    ]);
    expect(update.staleVariableCollectionIds).toEqual([]);
    expect(update.staleVariableIds).toEqual([]);

    changed.variableCollectionsById.semantic!.hiddenFromPublishing = true;
    changed.variableCollectionsById.primitive!.hiddenFromPublishing = true;
    const removed = createLibraryReleaseSnapshot(
      changed,
      releaseOptions("removed"),
    );
    const stale = planLibraryReleaseUpdate(consumer, removed, "remove");
    expect(stale.commands).toEqual([]);
    expect(stale.staleVariableCollectionIds.sort()).toEqual([
      "primitive",
      "semantic",
    ]);
    expect(stale.staleVariableIds.sort()).toEqual(["title", "title-base"]);
  });
});

function variableDocument(): DesignDocument {
  const document = emptyDocument("source");
  document.variableCollectionOrder = ["semantic", "primitive", "unused"];
  document.variableCollectionsById = {
    semantic: collection("semantic", ["title"], false),
    primitive: collection("primitive", ["title-base"], true),
    unused: collection("unused", ["unused-value"], true),
  };
  document.variablesById = {
    title: {
      ...variable("title", "semantic", false),
      valuesByMode: {
        default: { type: "VARIABLE_ALIAS", id: "title-base" },
      },
    },
    "title-base": {
      ...variable("title-base", "primitive", true),
      valuesByMode: { default: "Library title" },
    },
    "unused-value": {
      ...variable("unused-value", "unused", true),
      valuesByMode: { default: "Unused" },
    },
  };
  return document;
}

function emptyDocument(documentId: string): DesignDocument {
  return {
    format: "dev.opendesign.document",
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId,
    revision: 0,
    pageOrder: ["page"],
    pagesById: {
      page: { id: "page", name: "Page", rootNodeIds: [], extensions: {} },
    },
    nodesById: {},
    componentsById: {},
    variantSetsById: {},
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    libraryStylesById: {},
    libraryVariableCollectionsById: {},
    libraryVariablesById: {},
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
    interactionsById: {},
    assetsById: {},
    extensions: {},
  };
}

function collection(
  id: string,
  variableIds: string[],
  hiddenFromPublishing: boolean,
) {
  return {
    id,
    key: `${id}-key`,
    name: id,
    hiddenFromPublishing,
    modes: [{ modeId: "default", name: "Default" }],
    variableIds,
    defaultModeId: "default",
    extensions: {},
  };
}

function variable(
  id: string,
  variableCollectionId: string,
  hiddenFromPublishing: boolean,
) {
  return {
    id,
    key: `${id}-key`,
    name: id,
    description: "",
    hiddenFromPublishing,
    variableCollectionId,
    resolvedType: "STRING" as const,
    valuesByMode: { default: "" },
    scopes: ["TEXT_CONTENT" as const],
    codeSyntax: {},
    extensions: {},
  };
}

function releaseOptions(releaseId: string) {
  return {
    libraryId: "library",
    releaseId,
    sourceProjectId: "project",
    sourceDesignFileId: "design-system",
    name: "Library",
    publishedAt: "2026-08-22T08:00:00.000Z",
  };
}
