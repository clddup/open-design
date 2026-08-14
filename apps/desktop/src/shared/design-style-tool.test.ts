import { describe, expect, it } from "vitest";
import { isDesignStyleToolInput } from "./design-style-tool";

describe("Styles Agent tool contract", () => {
  it("accepts only exact typed actions and Figma-shaped reference fields", () => {
    expect(
      isDesignStyleToolInput({
        action: "create-from-node",
        label: "Create brand fill",
        pageId: "page",
        nodeId: "title",
        field: "fillStyleId",
        styleId: "brand",
        key: "brand-key",
        name: "Brand/Primary",
      }),
    ).toBe(true);
    expect(
      isDesignStyleToolInput({
        action: "set-reference",
        label: "Apply style",
        pageId: "page",
        nodeId: "title",
        field: "fills",
        styleId: "brand",
      }),
    ).toBe(false);
    expect(
      isDesignStyleToolInput({
        action: "update-metadata",
        label: "No update",
        pageId: "page",
        styleId: "brand",
      }),
    ).toBe(false);
  });
});
