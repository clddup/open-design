import { describe, expect, it } from "vitest";
import {
  DESIGN_EDIT_TOOL_INPUT_SCHEMA,
  EditDesignContract,
  INTERNAL_DESIGN_EDIT_TOOL_INPUT_SCHEMA,
} from "./design-edit-tool";
import { designAgentToolInputIssues } from "./design-agent-tool-catalog";
import { DESIGN_EDIT_TOOL_NAME } from "./design-agent-tool-names";
import { schemaValidationIssues } from "./contract-validation";

describe("Edit Design contract", () => {
  it("compiles omitted deterministic Text defaults from a production edit payload", () => {
    const input = {
      label: "Redesign the login page",
      edits: [
        {
          kind: "node",
          input: {
            label: "Build the editor preview",
            commands: [
              {
                commandId: "toolbar-title",
                type: "insert_element",
                pageId: "page_login",
                parentId: "editor_preview",
                index: 0,
                node: {
                  id: "toolbar_title",
                  name: "Project name",
                  transform: [1, 0, 0, 1, 22, 13],
                  size: { width: 240, height: 22 },
                  kind: "text",
                  properties: {
                    content: "品牌主页设计  ·  已保存",
                    fontFamily: "Noto Sans SC",
                    fontStyleName: "Medium",
                    fontSize: 12,
                    fontWeight: 500,
                    fontSlant: "normal",
                    lineHeight: 20,
                    fills: [{ type: "solid", color: "#C9D6DB", opacity: 1 }],
                    strokes: [],
                    strokeWidth: 0,
                  },
                },
              },
            ],
          },
        },
      ],
    };
    expect(
      schemaValidationIssues(DESIGN_EDIT_TOOL_INPUT_SCHEMA, input),
    ).toEqual([]);
    expect(designAgentToolInputIssues(DESIGN_EDIT_TOOL_NAME, input)).toEqual(
      [],
    );
    const result = EditDesignContract.parse(input);

    expect(result).toMatchObject({
      ok: true,
      value: {
        edits: [
          {
            kind: "node",
            input: {
              commands: [
                {
                  node: {
                    properties: {
                      paragraphIndent: 0,
                      paragraphSpacing: 0,
                      listSpacing: 0,
                      hangingList: false,
                      textCase: "original",
                      textDecoration: "none",
                      textDecorationStyle: null,
                      textDecorationOffset: null,
                      textDecorationThickness: null,
                      textDecorationColor: null,
                      textDecorationSkipInk: null,
                      letterSpacing: 0,
                      textAlignHorizontal: "left",
                      textAlignVertical: "top",
                      textResize: "fixed",
                      textWrap: "word",
                      textOverflow: "visible",
                      textTruncation: "disabled",
                      maxLines: null,
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    });
    if (!result.ok) throw new Error("Expected production edit to compile");
    expect(
      schemaValidationIssues(
        INTERNAL_DESIGN_EDIT_TOOL_INPUT_SCHEMA,
        result.value,
      ),
    ).toEqual([]);

    const autoHeightEnding = structuredClone(input);
    const autoHeightProperties = autoHeightEnding.edits[0].input.commands[0]
      .node.properties as Record<string, unknown>;
    autoHeightProperties.textResize = "auto-height";
    autoHeightProperties.textWrap = "word";
    autoHeightProperties.textOverflow = "visible";
    autoHeightProperties.textTruncation = "ending";
    const autoHeightResult = EditDesignContract.parse(autoHeightEnding);
    expect(autoHeightResult).toMatchObject({
      ok: true,
      value: {
        edits: [
          {
            input: {
              commands: [{ node: { properties: { maxLines: 1 } } }],
            },
          },
        ],
      },
    });
  });

  it("compiles one node transaction and validates ordered hierarchy/layout edits", () => {
    const result = EditDesignContract.parse({
      label: "Refine the card system",
      edits: [
        {
          kind: "node",
          input: {
            label: "Update the card",
            commands: [
              {
                commandId: "update_card",
                type: "update_properties",
                nodeId: "card",
                opacity: 0.96,
              },
            ],
          },
        },
        {
          kind: "hierarchy",
          input: {
            action: "reparent",
            label: "Move card into content",
            pageId: "page_main",
            nodeIds: ["card"],
            parentId: "content",
            index: 0,
          },
        },
        {
          kind: "arrange",
          input: {
            action: "set-layout-sizing",
            label: "Fill content width",
            pageId: "page_main",
            nodeId: "card",
            sizing: { horizontal: "fill", vertical: "fixed" },
          },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        label: "Refine the card system",
        edits: [{ kind: "node" }, { kind: "hierarchy" }, { kind: "arrange" }],
      },
    });
  });

  it("reports nested field paths and rejects multiple node transactions", () => {
    const invalid = EditDesignContract.parse({
      label: "Invalid combined edit",
      edits: [
        {
          kind: "arrange",
          input: {
            action: "resize-frame",
            label: "Resize",
            pageId: "page_main",
            frameId: "frame_main",
            width: 0,
            height: 720,
          },
        },
      ],
    });
    expect(invalid).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: "/edits/0/input/width" })],
    });

    const duplicated = EditDesignContract.parse({
      label: "Duplicate nodes",
      edits: [
        {
          kind: "node",
          input: {
            label: "First",
            commands: [
              {
                commandId: "first",
                type: "update_properties",
                nodeId: "card",
                opacity: 0.9,
              },
            ],
          },
        },
        {
          kind: "node",
          input: {
            label: "Second",
            commands: [
              {
                commandId: "second",
                type: "update_properties",
                nodeId: "card",
                opacity: 1,
              },
            ],
          },
        },
      ],
    });
    expect(duplicated).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design_edit.node_edit_duplicated",
          path: "/edits",
        }),
      ],
    });
    expect(EditDesignContract.schema).toBe(DESIGN_EDIT_TOOL_INPUT_SCHEMA);
  });
});
