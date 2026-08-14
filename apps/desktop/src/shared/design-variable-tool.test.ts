import { describe, expect, it } from "vitest";
import { isDesignVariableToolInput } from "./design-variable-tool";

describe("typed Variables tool", () => {
  it("accepts Figma-shaped RGB/alias values and exact binding targets", () => {
    expect(
      isDesignVariableToolInput({
        action: "create-variable",
        label: "Create surface variable",
        pageId: "page",
        variableId: "surface",
        key: "surface-key",
        collectionId: "theme",
        name: "Color/Surface",
        resolvedType: "COLOR",
        valuesByMode: {
          light: { r: 1, g: 1, b: 1 },
          dark: { type: "VARIABLE_ALIAS", id: "primitive-dark" },
        },
        scopes: ["FRAME_FILL"],
      }),
    ).toBe(true);
    expect(
      isDesignVariableToolInput({
        action: "set-binding",
        label: "Bind surface fill",
        pageId: "page",
        target: {
          kind: "paint",
          nodeId: "frame",
          paintField: "fills",
          paintIndex: 0,
          field: "color",
        },
        variableId: "surface",
      }),
    ).toBe(true);
  });

  it("rejects unknown fields, malformed values, and unsupported binding fields", () => {
    expect(
      isDesignVariableToolInput({
        action: "set-value",
        label: "Set color",
        pageId: "page",
        variableId: "surface",
        modeId: "light",
        value: { color: "#fff", opacity: 1 },
      }),
    ).toBe(false);
    expect(
      isDesignVariableToolInput({
        action: "set-binding",
        label: "Bind width",
        pageId: "page",
        target: { kind: "node", nodeId: "frame", field: "width" },
        variableId: "size",
      }),
    ).toBe(false);
    expect(
      isDesignVariableToolInput({
        action: "delete-variable",
        label: "Delete variable",
        pageId: "page",
        variableId: "surface",
        arbitrary: true,
      }),
    ).toBe(false);
  });
});
