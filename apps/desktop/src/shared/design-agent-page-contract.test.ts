import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_PAGE_TOOL_INPUT_SCHEMA,
  DESIGN_PAGE_TOOL_NAME,
  DesignPageContract,
  PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  PageStructureAccessContract,
} from "./design-agent-tools";

describe("Page Agent contracts", () => {
  it("uses the disclosed schemas as the Runtime structure source", () => {
    expect(DesignPageContract.schema).toBe(DESIGN_PAGE_TOOL_INPUT_SCHEMA);
    expect(PageStructureAccessContract.schema).toBe(
      PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
    );
    expect(
      schemaValidationIssues(DESIGN_PAGE_TOOL_INPUT_SCHEMA, {
        action: "create",
        label: "Create Research Page",
        name: "Research",
        index: 1,
      }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA, {
        actions: ["create-page", "cross-page-edit"],
        reason: "Create and design the requested Research Page",
      }),
    ).toHaveLength(0);
  });

  it("accepts every Page lifecycle action with only its own fields", () => {
    const inputs = [
      {
        action: "create",
        label: "Create Research Page",
        name: "Research",
        index: 1,
      },
      {
        action: "rename",
        label: "Rename Research Page",
        pageId: "page_research",
        name: "01 · 调研",
      },
      {
        action: "duplicate",
        label: "Duplicate Research Page",
        pageId: "page_research",
        name: "Research copy",
        index: 2,
      },
      {
        action: "reorder",
        label: "Move Research Page",
        pageId: "page_research",
        index: 0,
      },
      {
        action: "clear",
        label: "Clear Research Page",
        pageId: "page_research",
      },
      {
        action: "delete",
        label: "Delete Research Page",
        pageId: "page_research",
      },
    ];

    for (const input of inputs) {
      expect(DesignPageContract.parse(input)).toEqual({
        ok: true,
        value: input,
      });
    }
  });

  it("returns action-specific paths for missing and foreign fields", () => {
    expect(
      DesignPageContract.issues({
        action: "create",
        label: "Create Page",
        pageId: "page_host_owned",
        name: "Page 2",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_page.schema_invalid",
          path: "/pageId",
        }),
      ]),
    );
    expect(
      DesignPageContract.issues({
        action: "rename",
        label: "Rename Page",
        pageId: "page_2",
        name: "Page 2",
        index: 1,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_page.schema_invalid",
          path: "/index",
        }),
      ]),
    );
    expect(
      DesignPageContract.issues({
        action: "delete",
        label: "Delete Page",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_page.schema_invalid",
          path: "/pageId",
        }),
      ]),
    );
  });

  it("rejects blank or control-character Page names at the name field", () => {
    for (const name of ["   ", "Bad\nName", "Bad\u007fName", "Bad\u0085Name"]) {
      expect(
        DesignPageContract.issues({
          action: "rename",
          label: "Rename Page",
          pageId: "page_2",
          name,
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "design_page.schema_invalid",
            path: "/name",
          }),
        ]),
      );
    }
  });

  it("requires a unique bounded Page-structure action set and visible reason", () => {
    expect(
      PageStructureAccessContract.parse({
        actions: ["create-page", "reorder-pages", "cross-page-edit"],
        reason: "Create, arrange, and design the requested Pages",
      }).ok,
    ).toBe(true);
    expect(
      PageStructureAccessContract.issues({
        actions: ["create-page", "create-page"],
        reason: "Create the requested Page",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "page_structure_access.schema_invalid",
          path: "/actions",
        }),
      ]),
    );
    expect(
      PageStructureAccessContract.issues({
        actions: ["filesystem"],
        reason: "Modify files outside the design",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "page_structure_access.schema_invalid",
          path: "/actions/0",
        }),
      ]),
    );
    expect(
      PageStructureAccessContract.parse({
        actions: ["create-page"],
        reason: "需要",
      }).ok,
    ).toBe(true);
    expect(
      PageStructureAccessContract.issues({
        actions: ["create-page"],
        reason: "        ",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "page_structure_access.schema_invalid",
          path: "/reason",
        }),
      ]),
    );
  });

  it("wires Pi validation to the same Page contracts", () => {
    const pageTool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === DESIGN_PAGE_TOOL_NAME,
    );
    const accessTool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === PAGE_STRUCTURE_ACCESS_TOOL_NAME,
    );
    expect(pageTool).toHaveProperty(
      "validateInputIssues",
      DesignPageContract.issues,
    );
    expect(accessTool).toHaveProperty(
      "validateInputIssues",
      PageStructureAccessContract.issues,
    );
  });
});
