import { describe, expect, it } from "vitest";
import {
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
});
