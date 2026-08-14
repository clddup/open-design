import type {
  DesignChangeSet,
  DesignDocument,
} from "@opendesign/design-contracts";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import {
  projectDesignPage,
  projectDesignPageIncrementally,
} from "./mapping.js";

describe("Variable Leafer projection", () => {
  it("materializes a mode-specific COLOR binding into the Leafer spec", () => {
    const document = variableFixture("dark");
    const projection = projectDesignPage(document, "page_welcome");

    expect(projection.elementsById.get("title_welcome")?.data.fill).toEqual([
      {
        type: "solid",
        color: "#112233",
        opacity: 0.5,
        visible: true,
      },
    ]);
    expect(projection.warnings).toEqual([]);
  });

  it("reprojects bound nodes when only the inherited Page mode changes", () => {
    const before = variableFixture("dark");
    const previous = projectDesignPage(before, "page_welcome");
    const after = structuredClone(before);
    after.revision = 2;
    const beforePage = before.pagesById.page_welcome;
    const afterPage = after.pagesById.page_welcome;
    if (!beforePage || !afterPage) throw new Error("Welcome Page is missing");
    afterPage.explicitVariableModes = { theme: "light" };
    const changes: DesignChangeSet = {
      documentId: after.documentId,
      fromRevision: 1,
      toRevision: 2,
      addedNodeIds: [],
      changedNodeIds: [],
      removedNodeIds: [],
      pageChanges: [
        {
          type: "updated",
          pageId: "page_welcome",
          before: beforePage,
          after: afterPage,
          changedFields: ["explicitVariableModes"],
        },
      ],
      changes: [],
    };

    const projection = projectDesignPageIncrementally(
      previous,
      after,
      "page_welcome",
      changes,
    );

    expect(projection.affectedNodeIds).toContain("title_welcome");
    expect(projection.elementsById.get("title_welcome")?.data.fill).toEqual([
      {
        type: "solid",
        color: "#ffffff",
        opacity: 1,
        visible: true,
      },
    ]);
  });
});

function variableFixture(modeId: "dark" | "light"): DesignDocument {
  const document = structuredClone(createWelcomeDocument());
  document.revision = 1;
  document.variableCollectionOrder = ["theme"];
  document.variableCollectionsById.theme = {
    id: "theme",
    key: "theme-key",
    name: "Theme",
    hiddenFromPublishing: false,
    modes: [
      { modeId: "dark", name: "Dark" },
      { modeId: "light", name: "Light" },
    ],
    variableIds: ["foreground"],
    defaultModeId: "dark",
    extensions: {},
  };
  document.variablesById.foreground = {
    id: "foreground",
    key: "foreground-key",
    name: "Foreground",
    description: "",
    hiddenFromPublishing: false,
    variableCollectionId: "theme",
    resolvedType: "COLOR",
    valuesByMode: {
      dark: { r: 17 / 255, g: 34 / 255, b: 51 / 255, a: 0.5 },
      light: { r: 1, g: 1, b: 1 },
    },
    scopes: ["TEXT_FILL"],
    codeSyntax: {},
    extensions: {},
  };
  document.pagesById.page_welcome!.explicitVariableModes = {
    theme: modeId,
  };
  const title = document.nodesById.title_welcome;
  if (title?.kind !== "text") throw new Error("Welcome title is missing");
  const fill = title.properties.fills[0];
  if (fill?.type !== "solid") throw new Error("Welcome title fill is missing");
  fill.boundVariables = {
    color: { type: "VARIABLE_ALIAS", id: "foreground" },
  };
  return document;
}
