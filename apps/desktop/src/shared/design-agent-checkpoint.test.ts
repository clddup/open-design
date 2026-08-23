import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA,
  DesignCheckpointContract,
} from "./design-agent-checkpoint";

const deleteApply = {
  label: "Remove obsolete badge",
  commands: [
    {
      commandId: "remove_badge",
      type: "delete_element" as const,
      nodeId: "obsolete_badge",
    },
  ],
};

describe("design checkpoint contract", () => {
  it("uses one executable schema for Provider disclosure and Runtime structure", () => {
    expect(DesignCheckpointContract.schema).toBe(
      DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA,
    );
    expect(
      schemaValidationIssues(DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA, {
        version: 1,
        action: "apply-and-capture",
        apply: deleteApply,
      }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA, {
        version: 1,
        action: "refine-and-capture",
        refinement: deleteApply,
      }),
    ).toHaveLength(0);
  });

  it("canonicalizes a nested apply after validating the checkpoint structure once", () => {
    const result = DesignCheckpointContract.parse({
      version: 1,
      action: "apply-and-capture",
      apply: compactRectangleApply(),
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "apply-and-capture",
        apply: {
          commands: [
            {
              node: {
                parentId: "poster_artboard",
                childIds: [],
                visible: true,
                locked: false,
                opacity: 1,
                exportSettings: [],
                extensions: {},
                properties: {
                  strokes: [],
                  strokeWidth: 0,
                  cornerRadius: 0,
                },
              },
            },
          ],
        },
      },
    });
  });

  it("canonicalizes the refinement branch through the same Apply contract", () => {
    const result = DesignCheckpointContract.parse({
      version: 1,
      action: "refine-and-capture",
      refinement: compactRectangleApply(),
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "refine-and-capture",
        refinement: {
          commands: [{ node: { parentId: "poster_artboard" } }],
        },
      },
    });
  });

  it("reports the real checkpoint branch for an invalid action or extra field", () => {
    const invalidAction = DesignCheckpointContract.issues({
      version: 1,
      action: "capture-only",
      apply: deleteApply,
    });
    const extraField = DesignCheckpointContract.issues({
      version: 1,
      action: "apply-and-capture",
      apply: deleteApply,
      refinement: deleteApply,
    });

    expect(invalidAction).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_checkpoint.schema_invalid",
          path: "/action",
        }),
      ]),
    );
    expect(extraField.some((issue) => issue.path === "/refinement")).toBe(true);
  });

  it("prefixes canonical Apply errors with the nested branch path", () => {
    const issues = DesignCheckpointContract.issues({
      version: 1,
      action: "apply-and-capture",
      apply: {
        label: "Create incomplete star",
        commands: [
          {
            commandId: "insert_star",
            type: "insert_element",
            pageId: "page_1",
            parentId: "poster_artboard",
            index: 0,
            node: {
              id: "star_1",
              name: "Star",
              transform: [1, 0, 0, 1, 0, 0],
              size: { width: 64, height: 64 },
              kind: "star",
              properties: {
                fills: [{ type: "solid", color: "#FFFFFF", opacity: 1 }],
              },
            },
          },
        ],
      },
    });

    expect(
      issues.some(
        (issue) =>
          issue.code === "design_apply.canonical_invalid" &&
          issue.path.startsWith("/apply/commands/0/node/properties"),
      ),
    ).toBe(true);
  });

  it("prefixes Apply domain errors without replacing their stable code", () => {
    const issues = DesignCheckpointContract.issues({
      version: 1,
      action: "refine-and-capture",
      refinement: {
        label: "Refine the title and badge",
        steps: [
          {
            stepId: "cleanup",
            label: "Remove obsolete badge",
            commandIds: ["remove_badge"],
          },
        ],
        commands: [
          {
            commandId: "remove_badge",
            type: "delete_element",
            nodeId: "obsolete_badge",
          },
          {
            commandId: "remove_hint",
            type: "delete_element",
            nodeId: "obsolete_hint",
          },
        ],
      },
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_apply.step_command_order_invalid",
          path: "/refinement/steps",
        }),
      ]),
    );
  });
});

function compactRectangleApply() {
  return {
    label: "Create poster background",
    commands: [
      {
        commandId: "insert_background",
        type: "insert_element" as const,
        pageId: "page_1",
        parentId: "poster_artboard",
        index: 0,
        node: {
          id: "poster_background",
          name: "Poster background",
          transform: [1, 0, 0, 1, 0, 0],
          size: { width: 1200, height: 1600 },
          kind: "rectangle" as const,
          properties: {
            fills: [{ type: "solid" as const, color: "#101820", opacity: 1 }],
          },
        },
      },
    ],
  };
}
