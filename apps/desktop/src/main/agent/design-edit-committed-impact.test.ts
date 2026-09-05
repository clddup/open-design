import { describe, expect, it } from "vitest";
import type {
  DesignChangeSet,
  DesignNode,
  FrameNode,
  InstanceNode,
} from "@opendesign/design-contracts";
import type { InspectedHierarchy } from "./design-plan-registration.js";
import {
  computeCommittedDesignEditImpact,
  type CommittedDesignEditTarget,
} from "./design-edit-committed-impact.js";

type NodeChange = DesignChangeSet["changes"][number];

function frame(
  id: string,
  parentId: string | null = null,
  childIds: string[] = [],
): FrameNode {
  return {
    id,
    parentId,
    childIds,
    kind: "frame",
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
}

function instance(
  id: string,
  parentId: string,
  componentId: string,
): InstanceNode {
  return {
    ...frame(id, parentId),
    kind: "instance",
    properties: { componentId, componentProperties: {}, overrides: [] },
  };
}

function inspection(nodes: DesignNode[]): InspectedHierarchy {
  const roots = nodes.filter((node) => node.parentId === null);
  return {
    documentId: "doc",
    revision: 0,
    catalogComponentsById: new Map(),
    componentsById: new Map(),
    pageRootsById: new Map([["page", new Set(roots.map((node) => node.id))]]),
    nodesById: new Map(
      nodes.map((node) => [
        node.id,
        {
          ...node,
          componentId:
            node.kind === "instance" ? node.properties.componentId : null,
        },
      ]),
    ),
  };
}

function target(root: string, known: string[] = []): CommittedDesignEditTarget {
  return {
    planned: { artboard: { frameId: root } },
    artboardDescendantIds: new Set(known),
  };
}

function fixture() {
  return {
    inspection: inspection([
      frame("A", null, ["a"]),
      frame("a", "A", ["leaf"]),
      frame("leaf", "a"),
      frame("B", null, ["b"]),
      frame("b", "B"),
    ]),
    targets: new Map([
      ["A", target("A", ["a", "leaf"])],
      ["B", target("B", ["b"])],
    ]),
  };
}

function change(
  before: DesignNode | undefined,
  after: DesignNode | undefined,
): NodeChange {
  const node = after ?? before;
  if (!node) throw new Error("A node snapshot is required");
  return {
    nodeId: node.id,
    before,
    after,
    type: !before
      ? "added"
      : !after
        ? "removed"
        : before.parentId !== after.parentId
          ? "moved"
          : "updated",
    changedFields: ["node"],
  };
}

function committed(
  changes: NodeChange[] = [],
  extra: Partial<DesignChangeSet> = {},
): DesignChangeSet {
  const ids = (...types: NodeChange["type"][]) =>
    changes
      .filter((item) => types.includes(item.type))
      .map((item) => item.nodeId);
  return {
    documentId: "doc",
    fromRevision: 0,
    toRevision: 1,
    addedNodeIds: ids("added"),
    changedNodeIds: ids("updated", "moved"),
    removedNodeIds: ids("removed"),
    changes,
    ...extra,
  };
}

function evaluate(changes: DesignChangeSet, input = fixture()) {
  return computeCommittedDesignEditImpact(
    changes,
    input.inspection,
    input.targets,
  );
}

function expectImpact(
  result: ReturnType<typeof evaluate>,
  id: string,
  affected: boolean,
  added: string[] = [],
  removed: string[] = [],
  materialChanged = affected,
) {
  expect(result.get(id)).toMatchObject({
    affected,
    materialChanged,
    addedNodeIds: new Set(added),
    removedNodeIds: new Set(removed),
  });
}

function component(id: string, rootNodeId: string) {
  return {
    id,
    rootNodeId,
    name: id,
    componentPropertyOrder: [],
    componentPropertyDefinitions: {},
    variantProperties: {},
    extensions: {},
  };
}

describe("committed edit physical membership", () => {
  it("keeps new groups and their descendants isolated per target, independent of change order", () => {
    const edits = [
      change(undefined, frame("ga", "A", ["na"])),
      change(undefined, frame("na", "ga")),
      change(undefined, frame("gb", "B", ["nb"])),
      change(undefined, frame("nb", "gb")),
      change(undefined, frame("outside")),
    ];
    for (const order of [edits, [...edits].reverse()]) {
      const result = evaluate(committed(order));
      expectImpact(result, "A", true, ["ga", "na"]);
      expectImpact(result, "B", true, ["gb", "nb"]);
      expect(result.get("A")?.afterDescendantIds).toEqual(
        new Set(["a", "leaf", "ga", "na"]),
      );
    }
  });

  it("treats a page-root wrapper as an ancestor rather than a new target member", () => {
    const result = evaluate(
      committed([
        change(undefined, frame("wrapper", null, ["A"])),
        change(frame("A", null, ["a"]), frame("A", "wrapper", ["a"])),
      ]),
    );
    expectImpact(result, "A", true);
    expectImpact(result, "B", false);
    expect(result.get("A")?.afterDescendantIds).toEqual(new Set(["a", "leaf"]));
  });

  it("does not dirty an unchanged target just because its sibling's parent childIds changed", () => {
    const oldParent = frame("holder", null, ["A", "B"]);
    const input = {
      inspection: inspection([
        oldParent,
        frame("A", "holder"),
        frame("B", "holder"),
      ]),
      targets: new Map([
        ["A", target("A")],
        ["B", target("B")],
      ]),
    };
    const result = evaluate(
      committed([
        change(oldParent, frame("holder", null, ["wrapper", "B"])),
        change(undefined, frame("wrapper", "holder", ["A"])),
        change(frame("A", "holder"), frame("A", "wrapper")),
      ]),
      input,
    );
    expectImpact(result, "A", true);
    expectImpact(result, "B", false);
  });

  it.each(["B", null])(
    "moves a subtree to %s from either inspection revision",
    (parent) => {
      for (const after of [false, true]) {
        const input = fixture();
        if (after) input.inspection.nodesById.get("a")!.parentId = parent;
        const edits = committed([
          change(frame("a", "A", ["leaf"]), frame("a", parent, ["leaf"])),
        ]);
        const result = evaluate(edits, input);
        expectImpact(result, "A", true, [], ["a", "leaf"]);
        expectImpact(result, "B", parent === "B", parent ? ["a", "leaf"] : []);
      }
    },
  );

  it.each([frame("a", "A", ["leaf"]), frame("A", null, ["a"])])(
    "removes the subtree of deleted $id",
    (node) => {
      const result = evaluate(committed([change(node, undefined)]));
      expectImpact(result, "A", true, [], ["a", "leaf"]);
      expectImpact(result, "B", false);
      expect(result.get("A")?.afterDescendantIds.size).toBe(0);
    },
  );

  it("preserves a descendant moved out before its old ancestor is deleted", () => {
    const result = evaluate(
      committed([
        change(frame("a", "A", ["leaf"]), undefined),
        change(frame("leaf", "a"), frame("leaf", "B")),
      ]),
    );
    expectImpact(result, "A", true, [], ["a", "leaf"]);
    expectImpact(result, "B", true, ["leaf"]);
  });

  it("does not mistake after-inspected new nodes for pre-existing members", () => {
    const input = fixture();
    const node = frame("new", "A");
    input.inspection.nodesById.set(node.id, { ...node, componentId: null });
    const result = evaluate(committed([change(undefined, node)]), input);
    expectImpact(result, "A", true, ["new"]);
    expectImpact(result, "B", false);
  });
});

describe("committed edit material evidence", () => {
  it("attributes real layout-propagated node changes, not just requested nodes", () => {
    const result = evaluate(
      committed([
        change(frame("a", "A", ["leaf"]), {
          ...frame("a", "A", ["leaf"]),
          opacity: 0.5,
        }),
        change(frame("b", "B"), {
          ...frame("b", "B"),
          transform: [1, 0, 0, 1, 200, 0],
        }),
      ]),
    );
    expectImpact(result, "A", true);
    expectImpact(result, "B", true);
  });

  it("ignores no-op fields, key order differences, revisions and unsubstantiated summary IDs", () => {
    const before = frame("a", "A", ["leaf"]);
    const { opacity, ...rest } = before;
    const after = { opacity, ...rest };
    const edits = [
      change(before, after),
      { ...change(before, after), changedFields: [] },
    ];
    for (const edit of edits) {
      const result = evaluate(
        committed([edit], {
          addedNodeIds: ["phantom"],
          changedNodeIds: ["A", "B"],
        }),
      );
      expectImpact(result, "A", false);
      expectImpact(result, "B", false);
    }
    expectImpact(evaluate(committed()), "A", false);
  });

  it("recognizes actual zOrder movement even with equal node snapshots", () => {
    const node = frame("a", "A", ["leaf"]);
    const result = evaluate(
      committed([
        { ...change(node, node), type: "moved", changedFields: ["zOrder"] },
      ]),
    );
    expectImpact(result, "A", true, [], [], false);
    expectImpact(result, "B", false);
  });

  it("invalidates a target when its ancestor appearance changes without adding that ancestor", () => {
    const input = fixture();
    const holder = frame("holder", null, ["A"]);
    input.inspection.nodesById.set("holder", { ...holder, componentId: null });
    input.inspection.nodesById.get("A")!.parentId = "holder";
    const result = evaluate(
      committed([change(holder, { ...holder, opacity: 0.5 })]),
      input,
    );
    expectImpact(result, "A", true, [], [], false);
    expectImpact(result, "B", false);
    expect(result.get("A")?.afterDescendantIds.has("holder")).toBe(false);
  });

  it("does not mutate inspection, target state, or the committed ChangeSet", () => {
    const input = fixture();
    const edits = committed([change(undefined, frame("new", "A"))]);
    const baseline = structuredClone({ input, edits });
    const first = evaluate(edits, input);
    expect({ input, edits }).toEqual(baseline);
    expect(evaluate(edits, input)).toEqual(first);
    expect(first.get("A")?.afterDescendantIds).not.toBe(
      input.targets.get("A")?.artboardDescendantIds,
    );
  });
});

describe("incomplete inspection boundaries", () => {
  it("preserves known old members without assigning unrelated new IDs to every target", () => {
    const input = fixture();
    const edits = committed([
      change(undefined, frame("unresolved", "missing")),
      change(frame("a", "missing"), { ...frame("a", "missing"), opacity: 0.5 }),
    ]);
    const result = computeCommittedDesignEditImpact(
      edits,
      undefined,
      input.targets,
    );
    expectImpact(result, "A", true);
    expectImpact(result, "B", false);
    expect(result.get("A")?.afterDescendantIds).toEqual(new Set(["a", "leaf"]));
  });

  it("uses an explicit complete chain to the target root even without inspection", () => {
    const result = computeCommittedDesignEditImpact(
      committed([
        change(undefined, frame("new", "A", ["child"])),
        change(undefined, frame("child", "new")),
      ]),
      undefined,
      fixture().targets,
    );
    expectImpact(result, "A", true, ["new", "child"]);
    expectImpact(result, "B", false);
  });

  it("does not bridge missing parents via old membership or childIds alone", () => {
    const input = fixture();
    input.inspection.nodesById.delete("a");
    input.inspection.nodesById.get("A")!.childIds.push("unresolved");
    const result = evaluate(
      committed([change(undefined, frame("unresolved", "missing"))]),
      input,
    );
    expectImpact(result, "A", false);
    expect(result.get("A")?.afterDescendantIds).toEqual(new Set(["a", "leaf"]));
  });

  it("removes a known deleted member without inspection and does not loop on cyclic unknown ancestry", () => {
    const edits = committed([
      change(frame("a", "missing"), undefined),
      change(undefined, frame("x", "y")),
      change(undefined, frame("y", "x")),
    ]);
    const result = computeCommittedDesignEditImpact(
      edits,
      undefined,
      fixture().targets,
    );
    expectImpact(result, "A", true, [], ["a"]);
    expectImpact(result, "B", false);
    expect(result.get("A")?.afterDescendantIds).toEqual(new Set(["leaf"]));
  });
});

describe("shared definition dirty-only boundaries", () => {
  function componentFixture() {
    const input = fixture();
    const extra = inspection([
      frame("source", null, ["sourceChild"]),
      frame("sourceChild", "source"),
      instance("inst", "A", "component"),
    ]);
    for (const [id, node] of extra.nodesById)
      input.inspection.nodesById.set(id, node);
    input.inspection.componentsById.set("component", {
      id: "component",
      rootNodeId: "source",
    });
    return input;
  }

  it("only adds the physical instance, never its unchanged external component subtree", () => {
    const input = componentFixture();
    input.inspection.nodesById.delete("inst");
    const result = evaluate(
      committed([change(undefined, instance("inst", "A", "component"))]),
      input,
    );
    expectImpact(result, "A", true, ["inst"]);
    expectImpact(result, "B", false);
    expect(result.get("A")?.afterDescendantIds.has("sourceChild")).toBe(false);
  });

  it("dirties users of an edited component subtree without importing source IDs", () => {
    const input = componentFixture();
    const result = evaluate(
      committed([
        change(frame("sourceChild", "source"), {
          ...frame("sourceChild", "source"),
          opacity: 0.5,
        }),
      ]),
      input,
    );
    expectImpact(result, "A", true, [], [], false);
    expectImpact(result, "B", false);
    expect(result.get("A")?.afterDescendantIds).toEqual(
      new Set(["a", "leaf", "inst"]),
    );
  });

  it.each([true, false])(
    "tracks nested component definition changes=%s without progress",
    (changed) => {
      const input = componentFixture();
      const nested = instance("nested", "source", "inner");
      input.inspection.nodesById.set("nested", {
        ...nested,
        componentId: "inner",
      });
      const before = component("inner", "innerRoot");
      const after = { ...before, name: changed ? "Renamed" : before.name };
      const componentChanges: DesignChangeSet["componentChanges"] = [
        {
          type: "updated",
          componentId: "inner",
          before,
          after,
          changedFields: ["name"],
        },
      ];
      const result = evaluate(committed([], { componentChanges }), input);
      expectImpact(result, "A", changed, [], [], false);
      expectImpact(result, "B", false);
      expect(result.get("A")?.afterDescendantIds.has("nested")).toBe(false);
    },
  );

  it("conservatively dirties shared asset users without inventing member changes", () => {
    const result = evaluate(committed([], { changedAssetIds: ["asset"] }));
    expectImpact(result, "A", true, [], [], false);
    expectImpact(result, "B", true, [], [], false);
    expectImpact(
      evaluate(committed([], { addedAssetIds: ["unused"] })),
      "A",
      false,
    );
  });
});
