import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_STYLE_TOOL_INPUT_SCHEMA,
  DESIGN_SYSTEM_TOOL_NAME,
  DesignStyleContract,
  DesignSystemContract,
  type DesignStyleToolInput,
} from "./design-agent-tools";

const validInputs: DesignStyleToolInput[] = [
  {
    action: "create-from-node",
    label: "Create brand fill",
    pageId: "page_ui",
    nodeId: "hero",
    field: "fillStyleId",
    styleId: "brand_primary",
    key: "brand-primary-key",
    name: "Brand/Primary",
    description: "Primary product accent",
  },
  {
    action: "update-from-node",
    label: "Refresh brand fill",
    pageId: "page_ui",
    nodeId: "hero",
    field: "fillStyleId",
    styleId: "brand_primary",
  },
  {
    action: "update-metadata",
    label: "Rename brand fill",
    pageId: "page_ui",
    styleId: "brand_primary",
    name: "Brand/Accent",
    hiddenFromPublishing: false,
  },
  {
    action: "move",
    label: "Reorder brand fill",
    pageId: "page_ui",
    styleId: "brand_primary",
    index: 2,
  },
  {
    action: "delete",
    label: "Delete obsolete fill",
    pageId: "page_ui",
    styleId: "brand_obsolete",
  },
  {
    action: "set-reference",
    label: "Detach title style",
    pageId: "page_ui",
    nodeId: "title",
    field: "textStyleId",
    styleId: null,
  },
];

describe("Style Agent contract", () => {
  it("uses one disclosed executable schema for every Style action", () => {
    expect(DesignStyleContract.schema).toBe(DESIGN_STYLE_TOOL_INPUT_SCHEMA);
    expect(validInputs).toHaveLength(6);
    for (const input of validInputs) {
      expect(schemaValidationIssues(DesignStyleContract.schema, input)).toEqual(
        [],
      );
      expect(DesignStyleContract.parse(input)).toEqual({
        ok: true,
        value: input,
      });
    }
  });

  it("reports action-specific missing and foreign fields", () => {
    expect(
      DesignStyleContract.issues({
        action: "set-reference",
        label: "Apply style",
        pageId: "page_ui",
        nodeId: "title",
        field: "fills",
        styleId: "brand_primary",
        index: 1,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/field" }),
        expect.objectContaining({ path: "/index" }),
      ]),
    );
  });

  it("reports an unknown action without leaking a candidate branch", () => {
    const issues = DesignStyleContract.issues({
      action: "publish",
      label: "Publish styles",
      pageId: "page_ui",
    });
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/action" })]),
    );
    expect(issues.every((issue) => issue.path === "/action")).toBe(true);
  });

  it("rejects metadata calls that do not change metadata", () => {
    expect(
      DesignStyleContract.issues({
        action: "update-metadata",
        label: "No update",
        pageId: "page_ui",
        styleId: "brand_primary",
      }),
    ).not.toHaveLength(0);
  });

  it("composes the Style contract into the unified Provider contract", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === DESIGN_SYSTEM_TOOL_NAME,
    );
    expect(tool).not.toHaveProperty("explainInvalidInput");
    expect(tool).toHaveProperty(
      "validateInputIssues",
      DesignSystemContract.issues,
    );
  });
});
