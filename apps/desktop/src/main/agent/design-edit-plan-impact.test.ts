import { describe, expect, it } from "vitest";
import type { DesignOperation, FrameNode } from "@opendesign/design-contracts";
import type { InspectedHierarchy } from "./design-plan-registration";
import { isIndependentNodeEdit } from "./design-edit-plan-impact";

function inspectedNode(
  id: string,
  parentId: string | null,
  childIds: string[] = [],
) {
  return {
    id,
    parentId,
    childIds,
    componentId: null,
    kind: "frame",
    locked: false,
    size: { width: 100, height: 100 },
    transform: [1, 0, 0, 1, 0, 0] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
  };
}
function fixture() {
  const inspection: Pick<InspectedHierarchy, "nodesById" | "componentsById"> = {
    componentsById: new Map([
      ["component", { id: "component", rootNodeId: "componentRoot" }],
    ]),
    nodesById: new Map([
      ["holder", inspectedNode("holder", null, ["planned", "layoutSibling"])],
      ["planned", inspectedNode("planned", "holder", ["planChild"])],
      ["planChild", inspectedNode("planChild", "planned")],
      ["outside", inspectedNode("outside", null, ["outsideChild"])],
      ["layoutSibling", inspectedNode("layoutSibling", "holder")],
      ["outsideChild", inspectedNode("outsideChild", "outside")],
      [
        "componentRoot",
        inspectedNode("componentRoot", null, ["componentChild"]),
      ],
      ["componentChild", inspectedNode("componentChild", "componentRoot")],
    ]),
  };
  const state = {
    targetsById: new Map([
      [
        "target",
        {
          artboardEstablished: true,
          planned: {
            artboard: {
              mode: "existing" as const,
              frameId: "planned",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
            },
          },
          delivery: { reservedNodeIds: ["planned", "logicalRegion"] },
        },
      ],
    ]),
  };
  return { inspection, state };
}
function check(commands: DesignOperation[]) {
  const { state, inspection } = fixture();
  return isIndependentNodeEdit(commands, state, inspection);
}
const update = (nodeId: string): DesignOperation => ({
  commandId: "update",
  type: "update_properties",
  nodeId,
  opacity: 0.5,
});
function insert(id: string, parentId: string | null): DesignOperation {
  const node: FrameNode = {
    id,
    kind: "frame",
    parentId,
    childIds: [],
    name: id,
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 100, height: 100 },
    opacity: 1,
    exportSettings: [],
    extensions: {},
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent: false,
    },
  };
  return {
    commandId: `insert_${id}`,
    type: "insert_element",
    node,
    pageId: "page",
    parentId,
    index: 0,
  };
}

describe("independent node edit impact", () => {
  it("accepts an unrelated local batch including newly inserted descendants", () => {
    expect(
      check([
        insert("new", "outside"),
        insert("child", "new"),
        update("child"),
        update("outsideChild"),
      ]),
    ).toBe(true);
  });
  it.each([
    "planned",
    "planChild",
    "holder",
    "logicalRegion",
    "componentRoot",
    "componentChild",
    "unknown",
    "layoutSibling",
  ])("does not treat %s as proved unrelated", (id) =>
    expect(check([update(id)])).toBe(false),
  );
  it.each([
    ["outsideChild", "planned"],
    ["planChild", "outside"],
    ["planned", null],
  ] as const)("checks both ends of moving %s to %s", (nodeId, parentId) => {
    expect(
      check([
        {
          commandId: "move",
          type: "move_element",
          nodeId,
          parentId,
          pageId: "page",
          index: 0,
        },
      ]),
    ).toBe(false);
  });
  it("allows unrelated moves and checks references to new parents in the entire batch", () => {
    expect(
      check([
        {
          commandId: "move",
          type: "move_element",
          nodeId: "outsideChild",
          parentId: null,
          pageId: "page",
          index: 0,
        },
      ]),
    ).toBe(true);
    expect(
      check([
        insert("new", "planned"),
        {
          commandId: "move",
          type: "move_element",
          nodeId: "outsideChild",
          parentId: "new",
          pageId: "page",
          index: 0,
        },
      ]),
    ).toBe(false);
    expect(check([insert("logicalRegion", "outside")])).toBe(false);
  });
  it("does not mistake a shared resource edit or an empty batch for an unrelated node edit", () => {
    expect(
      check([
        {
          commandId: "delete_variant",
          type: "delete_variant_set",
          variantSetId: "variant",
        },
      ]),
    ).toBe(false);
    expect(
      check([
        { commandId: "delete_asset", type: "delete_asset", assetId: "asset" },
      ]),
    ).toBe(false);
    expect(check([])).toBe(false);
  });
  it("does not hide Plan intersection in replacement descendants", () => {
    const insertion = insert("planned", "outside");
    if (insertion.type !== "insert_element") throw new Error("Expected insert");
    expect(
      check([
        {
          commandId: "replace",
          type: "replace_subtree",
          rootNodeId: "outside",
          nodes: [insertion.node],
        },
      ]),
    ).toBe(false);
  });
});
