import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { MAX_DESIGN_SYSTEM_CATALOG_CHARACTERS } from "../shared/design-system-component-catalog";
import { createScopedComponentInspection } from "./design-component-inspection";

describe("scoped component inspection catalog", () => {
  it("lists bounded Design File components without exposing out-of-scope source trees", () => {
    const document = structuredClone(createWelcomeDocument());
    document.componentsById = {
      component_current: component(
        "component_current",
        "Current / Action",
        "feature_one",
      ),
      component_file: component(
        "component_file",
        "Library / Navigation",
        "feature_two",
      ),
    };
    const nodeIds = new Set(["feature_one"]);
    const nodesById = {
      feature_one: document.nodesById.feature_one,
    };

    const inspection = createScopedComponentInspection(
      document,
      nodeIds,
      nodesById,
    );

    expect(inspection.componentCatalog).toMatchObject({
      totalCount: 2,
      truncated: false,
      components: [
        {
          componentId: "component_current",
          availability: "current-scope",
          properties: [{ name: "Label", type: "TEXT" }],
        },
        {
          componentId: "component_file",
          availability: "design-file",
        },
      ],
    });
    expect(inspection.componentsById).toHaveProperty("component_current");
    expect(inspection.componentsById).not.toHaveProperty("component_file");
  });

  it("bounds the complete catalog payload and marks omitted components", () => {
    const document = structuredClone(createWelcomeDocument());
    document.componentsById = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => {
        const id = `component_${String(index).padStart(3, "0")}`;
        return [
          id,
          {
            ...component(id, `Component ${index}`, "feature_one"),
            description: "A".repeat(2_000),
          },
        ];
      }),
    );

    const inspection = createScopedComponentInspection(
      document,
      new Set(["feature_one"]),
      { feature_one: document.nodesById.feature_one },
    );

    expect(inspection.componentCatalog.totalCount).toBe(100);
    expect(inspection.componentCatalog.truncated).toBe(true);
    expect(
      JSON.stringify(inspection.componentCatalog.components).length,
    ).toBeLessThanOrEqual(MAX_DESIGN_SYSTEM_CATALOG_CHARACTERS);
    expect(inspection.componentCatalog.components[0]).toMatchObject({
      descriptionTruncated: true,
    });
  });
});

function component(id: string, name: string, rootNodeId: string) {
  return {
    id,
    name,
    rootNodeId,
    description: `${name} reusable component`,
    componentPropertyOrder: ["Label"],
    componentPropertyDefinitions: {
      Label: { type: "TEXT" as const, defaultValue: "Continue" },
    },
    variantProperties: {},
    extensions: {},
  };
}
