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

describe("Shared Style Leafer projection", () => {
  it("projects Paint styles before node Variable bindings", () => {
    const document = fixture("#2563eb");
    const projection = projectDesignPage(document, "page_welcome");
    expect(projection.elementsById.get("title_welcome")?.data.fill).toEqual([
      {
        type: "solid",
        color: "#ff3366",
        opacity: 1,
        visible: true,
      },
    ]);
    expect(projection.warnings).toEqual([]);
  });

  it("reprojects consumers when only a Style definition changes", () => {
    const before = fixture("#2563eb", false);
    const previous = projectDesignPage(before, "page_welcome");
    const after = fixture("#16a34a", false);
    after.revision = 2;
    const changes: DesignChangeSet = {
      documentId: after.documentId,
      fromRevision: 1,
      toRevision: 2,
      addedNodeIds: [],
      changedNodeIds: [],
      removedNodeIds: [],
      changedStyleIds: ["brand-primary"],
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
      expect.objectContaining({ color: "#16a34a" }),
    ]);
  });
});

function fixture(styleColor: string, withVariable = true): DesignDocument {
  const document = structuredClone(createWelcomeDocument());
  document.revision = 1;
  document.styleOrderByType.PAINT = ["brand-primary"];
  document.stylesById["brand-primary"] = {
    id: "brand-primary",
    key: "brand-primary-key",
    name: "Brand/Primary",
    description: "",
    hiddenFromPublishing: false,
    styleType: "PAINT",
    paints: [{ type: "solid", color: styleColor, opacity: 1 }],
    extensions: {},
  };
  const title = document.nodesById.title_welcome;
  if (title?.kind !== "text") throw new Error("Welcome title is missing");
  title.fillStyleId = "brand-primary";
  const fallback = title.properties.fills[0];
  if (fallback?.type !== "solid") throw new Error("Welcome fill is missing");
  if (withVariable) {
    fallback.boundVariables = {
      color: { type: "VARIABLE_ALIAS", id: "accent" },
    };
  }
  document.variableCollectionOrder = ["theme"];
  document.variableCollectionsById.theme = {
    id: "theme",
    key: "theme-key",
    name: "Theme",
    hiddenFromPublishing: false,
    modes: [{ modeId: "default", name: "Default" }],
    variableIds: ["accent"],
    defaultModeId: "default",
    extensions: {},
  };
  document.variablesById.accent = {
    id: "accent",
    key: "accent-key",
    name: "Accent",
    description: "",
    hiddenFromPublishing: false,
    variableCollectionId: "theme",
    resolvedType: "COLOR",
    valuesByMode: {
      default: { r: 1, g: 51 / 255, b: 102 / 255 },
    },
    scopes: ["TEXT_FILL"],
    codeSyntax: {},
    extensions: {},
  };
  return document;
}
