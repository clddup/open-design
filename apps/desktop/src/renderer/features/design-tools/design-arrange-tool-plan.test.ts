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

  it("routes Agent rotation origin through the shared Runtime planner", () => {
    const plan = planDesignArrangeTool(
      createWelcomeDocument(),
      {
        action: "set-rotation-origin",
        label: "Set the inspected title rotation origin",
        pageId: "page_welcome",
        nodeId: "title_welcome",
        origin: { x: 0.25, y: 0.75 },
      },
      "agent_origin",
    );

    expect(plan).toMatchObject({
      ok: true,
      nodeId: "title_welcome",
      commands: [
        {
          type: "update_properties",
          nodeId: "title_welcome",
          rotationOrigin: { x: 0.25, y: 0.75 },
        },
      ],
    });
  });
});
