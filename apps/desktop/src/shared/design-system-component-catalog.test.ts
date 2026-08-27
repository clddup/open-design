import { describe, expect, it } from "vitest";
import {
  DesignSystemComponentCatalogContract,
  isDesignSystemComponentCatalog,
  type DesignSystemComponentCatalog,
} from "./design-system-component-catalog";

const catalog: DesignSystemComponentCatalog = {
  totalCount: 1,
  truncated: false,
  components: [
    {
      componentId: "component_button",
      name: "Button / Primary",
      description: "Primary product action",
      availability: "design-file",
      usageCount: 8,
      scopeUsageCount: 0,
      variantSetId: "set_button",
      variantProperties: { Size: "Medium", State: "Default" },
      properties: [
        { name: "Label", type: "TEXT" },
        { name: "Disabled", type: "BOOLEAN" },
      ],
      propertiesTruncated: false,
    },
  ],
};

describe("design-system component catalog", () => {
  it("accepts a bounded exact catalog", () => {
    expect(isDesignSystemComponentCatalog(catalog)).toBe(true);
  });

  it("rejects inconsistent truncation, duplicate IDs, and extra fields", () => {
    expect(isDesignSystemComponentCatalog({ ...catalog, totalCount: 2 })).toBe(
      false,
    );
    expect(
      isDesignSystemComponentCatalog({
        ...catalog,
        totalCount: 2,
        truncated: true,
        components: [catalog.components[0], catalog.components[0]],
      }),
    ).toBe(false);
    expect(
      isDesignSystemComponentCatalog({ ...catalog, untrusted: true }),
    ).toBe(false);
  });

  it("reports structure and cross-field failures at exact catalog paths", () => {
    expect(
      DesignSystemComponentCatalogContract.issues({
        ...catalog,
        components: [
          {
            ...catalog.components[0],
            properties: [{ name: "Label", type: "NUMBER" }],
          },
        ],
      })[0]?.path,
    ).toBe("/components/0/properties/0/type");

    expect(
      DesignSystemComponentCatalogContract.issues({
        ...catalog,
        components: [
          {
            ...catalog.components[0],
            scopeUsageCount: 9,
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "design.component_catalog_scope_usage_invalid",
        path: "/components/0/scopeUsageCount",
      }),
    );

    expect(
      DesignSystemComponentCatalogContract.issues({
        ...catalog,
        components: [
          {
            ...catalog.components[0],
            properties: [
              { name: "Label", type: "TEXT" },
              { name: "Label", type: "BOOLEAN" },
            ],
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "design.component_catalog_property_duplicate",
        path: "/components/0/properties/1/name",
      }),
    );
  });
});
