import { describe, expect, it } from "vitest";
import type { DesignOperation } from "@opendesign/design-contracts";
import { isNodeRelocation } from "./design-node-relocation";

const move: DesignOperation = {
  commandId: "move",
  type: "move_element",
  nodeId: "node",
  pageId: "page",
  parentId: "destination",
  index: 0,
};

describe("existing node relocation", () => {
  it("allows moved-node properties and geometry in the same atomic batch", () => {
    expect(isNodeRelocation([move])).toBe(true);
    expect(
      isNodeRelocation([
        {
          commandId: "transform",
          type: "update_properties",
          nodeId: "node",
          transform: [1, 0, 0, 1, 10, 20],
        },
        move,
      ]),
    ).toBe(true);
  });
  it.each<DesignOperation>([
    { commandId: "delete", type: "delete_element", nodeId: "node" },
    {
      commandId: "other",
      type: "update_properties",
      nodeId: "unrelated",
      opacity: 0.5,
    },
    { commandId: "asset", type: "delete_asset", assetId: "asset" },
  ])("does not reclassify mixed or shared writes as relocation", (command) => {
    expect(isNodeRelocation([move, command])).toBe(false);
  });
  it("does not treat empty or property-only edits as relocation", () => {
    expect(isNodeRelocation([])).toBe(false);
    expect(
      isNodeRelocation([
        {
          commandId: "property",
          type: "update_properties",
          nodeId: "node",
          opacity: 0.4,
        },
      ]),
    ).toBe(false);
  });
});
