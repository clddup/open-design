import { describe, expect, it } from "vitest";
import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import {
  toFigmaExplicitVariableModes,
  toFigmaNodeBoundVariables,
  toFigmaVariable,
  toFigmaVariableCollection,
} from "./index.js";

describe("Figma Variables compatibility", () => {
  it("preserves public collection, variable, mode, alias, and binding shapes", () => {
    const collection = {
      id: "theme",
      key: "theme-key",
      name: "Theme",
      hiddenFromPublishing: false,
      modes: [
        { modeId: "light", name: "Light" },
        { modeId: "dark", name: "Dark" },
      ],
      variableIds: ["surface"],
      defaultModeId: "light",
      extensions: {},
    } satisfies DesignDocument["variableCollectionsById"][string];
    const variable = {
      id: "surface",
      key: "surface-key",
      name: "Color/Surface",
      description: "Surface color",
      hiddenFromPublishing: false,
      variableCollectionId: "theme",
      resolvedType: "COLOR",
      valuesByMode: {
        light: { r: 1, g: 1, b: 1 },
        dark: { type: "VARIABLE_ALIAS", id: "dark-primitive" },
      },
      scopes: ["FRAME_FILL"],
      codeSyntax: { WEB: "--color-surface", iOS: "colorSurface" },
      extensions: {},
    } satisfies DesignDocument["variablesById"][string];
    expect(toFigmaVariableCollection(collection)).toEqual({
      id: "theme",
      key: "theme-key",
      name: "Theme",
      hiddenFromPublishing: false,
      modes: collection.modes,
      variableIds: ["surface"],
      defaultModeId: "light",
    });
    expect(toFigmaVariable(variable)).toMatchObject({
      resolvedType: "COLOR",
      valuesByMode: variable.valuesByMode,
      scopes: ["FRAME_FILL"],
      codeSyntax: { WEB: "--color-surface", iOS: "colorSurface" },
    });
    const node: DesignNode = {
      id: "node",
      kind: "group",
      name: "Node",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      explicitVariableModes: { theme: "dark" },
      boundVariables: {
        opacity: { type: "VARIABLE_ALIAS" as const, id: "opacity" },
      },
      properties: {},
      extensions: {},
    };
    expect(toFigmaExplicitVariableModes(node)).toEqual({ theme: "dark" });
    expect(toFigmaNodeBoundVariables(node)).toEqual({
      opacity: { type: "VARIABLE_ALIAS", id: "opacity" },
    });
  });
});
