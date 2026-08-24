import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_VARIABLE_TOOL_INPUT_SCHEMA,
  DESIGN_VARIABLE_TOOL_NAME,
  DesignVariableContract,
  type DesignVariableToolInput,
} from "./design-agent-tools";

const validInputs: DesignVariableToolInput[] = [
  {
    action: "create-collection",
    label: "Create theme collection",
    pageId: "page_ui",
    collectionId: "theme",
    key: "theme-key",
    name: "Theme",
    defaultModeId: "light",
    defaultModeName: "Light",
  },
  {
    action: "rename-collection",
    label: "Rename theme collection",
    pageId: "page_ui",
    collectionId: "theme",
    name: "Product theme",
  },
  {
    action: "delete-collection",
    label: "Delete obsolete collection",
    pageId: "page_ui",
    collectionId: "obsolete",
  },
  {
    action: "add-mode",
    label: "Add dark mode",
    pageId: "page_ui",
    collectionId: "theme",
    modeId: "dark",
    name: "Dark",
    valuesByVariableId: {
      surface: { r: 0.05, g: 0.06, b: 0.08 },
    },
  },
  {
    action: "rename-mode",
    label: "Rename dark mode",
    pageId: "page_ui",
    collectionId: "theme",
    modeId: "dark",
    name: "Night",
  },
  {
    action: "remove-mode",
    label: "Remove high contrast mode",
    pageId: "page_ui",
    collectionId: "theme",
    modeId: "high-contrast",
    replacementModeId: "dark",
  },
  {
    action: "create-variable",
    label: "Create surface variable",
    pageId: "page_ui",
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
  },
  {
    action: "set-value",
    label: "Set spring motion",
    pageId: "page_ui",
    variableId: "motion-spring",
    modeId: "default",
    value: {
      type: "CUSTOM_SPRING",
      easingFunctionSpring: { bounce: 0.25 },
    },
  },
  {
    action: "update-variable",
    label: "Publish surface variable",
    pageId: "page_ui",
    variableId: "surface",
    description: "Default application surface",
    hiddenFromPublishing: false,
    codeSyntax: { WEB: "--surface", iOS: "surface" },
  },
  {
    action: "delete-variable",
    label: "Delete obsolete variable",
    pageId: "page_ui",
    variableId: "obsolete",
  },
  {
    action: "set-binding",
    label: "Bind surface fill",
    pageId: "page_ui",
    target: {
      kind: "paint",
      nodeId: "frame",
      paintField: "fills",
      paintIndex: 0,
      field: "color",
    },
    variableId: "surface",
  },
  {
    action: "set-mode",
    label: "Use inherited theme mode",
    pageId: "page_ui",
    target: { kind: "page", id: "page_ui" },
    collectionId: "theme",
    modeId: null,
  },
];

describe("Variable Agent contract", () => {
  it("uses one disclosed executable schema for every Variable action", () => {
    expect(DesignVariableContract.schema).toBe(
      DESIGN_VARIABLE_TOOL_INPUT_SCHEMA,
    );
    expect(validInputs).toHaveLength(12);
    for (const input of validInputs) {
      expect(
        schemaValidationIssues(DesignVariableContract.schema, input),
        input.action,
      ).toEqual([]);
      expect(DesignVariableContract.parse(input)).toEqual({
        ok: true,
        value: input,
      });
    }
  });

  it("accepts the full executable easing schema disclosed to Provider", () => {
    const spring = validInputs.find((input) => input.action === "set-value");
    expect(spring).toBeDefined();
    expect(DesignVariableContract.parse(spring)).toEqual({
      ok: true,
      value: spring,
    });
  });

  it("reports action-specific target and foreign field paths", () => {
    expect(
      DesignVariableContract.issues({
        action: "set-binding",
        label: "Bind width",
        pageId: "page_ui",
        target: { kind: "node", nodeId: "frame", field: "width" },
        variableId: "size",
        collectionId: "theme",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/target/field" }),
        expect.objectContaining({ path: "/collectionId" }),
      ]),
    );

    const modeIssues = DesignVariableContract.issues({
      action: "set-mode",
      label: "Set mode",
      pageId: "page_ui",
      target: { kind: "node", nodeId: "frame", field: "width" },
      collectionId: "theme",
      modeId: "dark",
    });
    expect(modeIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/target/id" })]),
    );
    expect(modeIssues[0]?.path).toBe("/target/id");
  });

  it("mirrors disclosed record-key bounds in the canonical Contract", () => {
    const create = validInputs.find(
      (input) => input.action === "create-variable",
    );
    if (!create || create.action !== "create-variable") {
      throw new Error("Missing create-variable fixture");
    }
    for (const invalidKey of ["", "x".repeat(257)]) {
      const input = { ...create, valuesByMode: { [invalidKey]: true } };
      const issues = DesignVariableContract.issues(input);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        code: "design_variable.record_key_invalid",
      });
      expect(issues[0]?.path.startsWith("/valuesByMode/")).toBe(true);
    }
  });

  it("follows nested Variable value discriminants for actionable paths", () => {
    const issues = DesignVariableContract.issues({
      action: "set-value",
      label: "Set custom easing",
      pageId: "page_ui",
      variableId: "motion",
      modeId: "default",
      value: {
        type: "CUSTOM_CUBIC_BEZIER",
        easingFunctionCubicBezier: { x1: 0.1, y1: 0.2, y2: 0.9 },
      },
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/value/easingFunctionCubicBezier/x2",
        }),
      ]),
    );
    expect(issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Expected boolean" }),
      ]),
    );
  });

  it("reports an unknown action without leaking a candidate branch", () => {
    const issues = DesignVariableContract.issues({
      action: "publish-variable",
      label: "Publish variables",
      pageId: "page_ui",
    });
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/action" })]),
    );
    expect(issues.every((issue) => issue.path === "/action")).toBe(true);
  });

  it("rejects empty updates and same-mode replacement before Runtime", () => {
    expect(
      DesignVariableContract.issues({
        action: "update-variable",
        label: "No update",
        pageId: "page_ui",
        variableId: "surface",
      }),
    ).not.toHaveLength(0);
    expect(
      DesignVariableContract.issues({
        action: "remove-mode",
        label: "Remove dark",
        pageId: "page_ui",
        collectionId: "theme",
        modeId: "dark",
        replacementModeId: "dark",
      }),
    ).toEqual([
      expect.objectContaining({
        code: "design_variable.replacement_mode_not_distinct",
        path: "/replacementModeId",
      }),
    ]);
  });

  it("wires Pi validation to the same Variable contract", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === DESIGN_VARIABLE_TOOL_NAME,
    );
    expect(tool).not.toHaveProperty("explainInvalidInput");
    expect(tool).toHaveProperty(
      "validateInputIssues",
      DesignVariableContract.issues,
    );
  });
});
