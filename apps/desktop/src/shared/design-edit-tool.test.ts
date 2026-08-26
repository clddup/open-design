import { describe, expect, it } from "vitest";
import {
  DESIGN_EDIT_TOOL_INPUT_SCHEMA,
  EditDesignContract,
} from "./design-edit-tool";

describe("Edit Design contract", () => {
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
