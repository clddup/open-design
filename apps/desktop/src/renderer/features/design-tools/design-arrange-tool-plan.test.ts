import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { planDesignArrangeTool } from "./design-arrange-tool-plan";

describe("planDesignArrangeTool", () => {
  it("routes Agent Flip through the same matrix planner as the human editor", () => {
    const plan = planDesignArrangeTool(
      createWelcomeDocument(),
      {
        action: "flip-horizontal",
        label: "Flip the inspected title",
        pageId: "page_welcome",
        nodeIds: ["title_welcome"],
      },
      "agent_flip",
    );

    expect(plan).toMatchObject({
      ok: true,
      axis: "horizontal",
      selectionNodeIds: ["title_welcome"],
      commands: [
        {
          type: "update_properties",
          nodeId: "title_welcome",
          transform: [-1, 0, 0, 1, 784, 108],
        },
      ],
    });
  });
});
