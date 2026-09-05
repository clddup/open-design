import { describe, expect, it } from "vitest";
import type {
  DesignChangeSet,
  DesignNode,
  FrameNode,
  ImageNode,
  InstanceNode,
} from "@opendesign/design-contracts";
import type { InspectedHierarchy } from "./design-plan-registration.js";
import { advanceDesignEditInspection } from "./design-edit-inspection.js";
import { projectInspectedNode } from "./design-inspection-parser.js";
import type { DesignInspectionHierarchy } from "@/shared/design-inspection-hierarchy-contract.js";
import { computeCommittedDesignEditImpact } from "./design-edit-committed-impact.js";

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

function image(): ImageNode {
  return {
    ...frame("image", "A"),
    kind: "image",
    extensions: { designRole: "hero", privateData: "ignored" },
    properties: {
      assetId: "asset",
      placement: { mode: "fit" },
      altText: "hero",
      cornerRadius: 0,
    },
  };
}

function instance(): InstanceNode {
  return {
    ...frame("instance", "A"),
    kind: "instance",
    properties: {
      componentId: "component",
      componentProperties: {},
      overrides: [],
    },
  };
}

function inspectedFrame(node: FrameNode) {
  const { id, parentId, childIds, kind, locked, size, transform } = node;
  return {
    id,
    parentId,
    childIds,
    kind,
    locked,
    size,
    transform,
    componentId: null,
  };
}

function initial(): InspectedHierarchy {
  const nodes = [
    frame("A", null, ["a"]),
    frame("a", "A", ["leaf"]),
    frame("leaf", "a"),
    frame("B", null, ["b"]),
    frame("b", "B"),
  ];
  return {
    documentId: "doc",
    revision: 7,
    newNodeIdPrefix: "run_namespace_",
    nodesById: new Map(nodes.map((node) => [node.id, inspectedFrame(node)])),
    pageRootsById: new Map([
      ["page", new Set(["A", "B"])],
      ["spare", new Set()],
    ]),
    componentsById: new Map([
      ["component", { id: "component", rootNodeId: "A" }],
    ]),
    catalogComponentsById: new Map([
      [
        "component",
        {
          componentId: "component",
          name: "Component",
          availability: "design-file",
          usageCount: 0,
          scopeUsageCount: 0,
          variantProperties: {},
          properties: [],
          propertiesTruncated: false,
        },
      ],
    ]),
  };
}

function nodeChange(
  before: DesignNode | undefined,
  after: DesignNode | undefined,
): DesignChangeSet["changes"][number] {
  const node = after ?? before;
  if (!node) throw new Error("A node snapshot is required");
  return {
    nodeId: node.id,
    before,
    after,
    changedFields: ["node"],
    type: !before
      ? "added"
      : !after
        ? "removed"
        : before.parentId === after.parentId
          ? "updated"
          : "moved",
  };
}

function committed(
  nodes: DesignChangeSet["changes"] = [],
  extra: Partial<DesignChangeSet> = {},
): DesignChangeSet {
  const ids = (...types: DesignChangeSet["changes"][number]["type"][]) =>
    nodes
      .filter((node) => types.includes(node.type))
      .map((node) => node.nodeId);
  return {
    documentId: "doc",
    fromRevision: 7,
    toRevision: 8,
    addedNodeIds: ids("added"),
    changedNodeIds: ids("updated", "moved"),
    removedNodeIds: ids("removed"),
    changes: nodes,
    ...extra,
  };
}

function moveToB() {
  return committed([
    nodeChange(frame("A", null, ["a"]), frame("A")),
    nodeChange(frame("B", null, ["b"]), frame("B", null, ["b", "a"])),
    nodeChange(frame("a", "A", ["leaf"]), frame("a", "B", ["leaf"])),
  ]);
}

function advance(changes: DesignChangeSet, inspection = initial()) {
  const next = advanceDesignEditInspection(inspection, changes);
  if (!next) throw new Error("Expected an exact inspection base");
  return next;
}

function page(id: string, rootNodeIds: string[]) {
  return { id, name: id, rootNodeIds, extensions: {} };
}

function component(id: string, rootNodeId: string) {
  return {
    id,
    name: id,
    rootNodeId,
    componentPropertyOrder: [],
    componentPropertyDefinitions: {},
    variantProperties: {},
    extensions: {},
  };
}

describe("exact committed inspection projection", () => {
  it("keeps A→B parentage through the next unrelated edit and impact computation", () => {
    const first = advance(moveToB());
    const before = frame("A");
    const secondChange = committed(
      [nodeChange(before, { ...before, opacity: 0.5 })],
      { fromRevision: 8, toRevision: 9 },
    );
    const second = advance(secondChange, first);
    expect(second.revision).toBe(9);
    expect(second.nodesById.get("a")?.parentId).toBe("B");
    expect(second.nodesById.get("leaf")?.parentId).toBe("a");
    expect(second.nodesById.get("A")?.childIds).toEqual([]);
    expect(second.nodesById.get("B")?.childIds).toEqual(["b", "a"]);
    const targets = new Map([
      [
        "A",
        {
          planned: { artboard: { frameId: "A" } },
          artboardDescendantIds: new Set<string>(),
        },
      ],
      [
        "B",
        {
          planned: { artboard: { frameId: "B" } },
          artboardDescendantIds: new Set(["a", "leaf", "b"]),
        },
      ],
    ]);
    for (const inspection of [first, second]) {
      const impact = computeCommittedDesignEditImpact(
        secondChange,
        inspection,
        targets,
      );
      expect(impact.get("A")).toMatchObject({
        affected: true,
        materialChanged: true,
        afterDescendantIds: new Set(),
      });
      expect(impact.get("B")).toMatchObject({
        affected: false,
        materialChanged: false,
        afterDescendantIds: new Set(["a", "leaf", "b"]),
      });
    }
  });

  it.each([
    undefined,
    { ...initial(), documentId: "other" },
    { ...initial(), revision: 6 },
    { ...initial(), revision: 8 },
    { ...initial(), revision: 9 },
  ])(
    "does not advance a missing, foreign, stale or already-advanced base (%#)",
    (inspection) => {
      const baseline = structuredClone(inspection);
      expect(
        advanceDesignEditInspection(inspection, moveToB()),
      ).toBeUndefined();
      expect(inspection).toEqual(baseline);
    },
  );

  it("does not mutate inputs and isolates all map values and changed node arrays", () => {
    const inspection = initial();
    const changes = moveToB();
    const baseline = structuredClone({ inspection, changes });
    const next = advance(changes, inspection);
    expect({ inspection, changes }).toEqual(baseline);
    for (const key of [
      "nodesById",
      "pageRootsById",
      "componentsById",
      "catalogComponentsById",
    ] as const) {
      expect(next[key]).not.toBe(inspection[key]);
    }
    next.nodesById.get("a")!.childIds.push("local");
    next.nodesById.get("leaf")!.transform[4] = 999;
    next.nodesById.get("leaf")!.size.width = 999;
    next.pageRootsById.get("page")!.clear();
    next.componentsById.get("component")!.rootNodeId = "local";
    next.catalogComponentsById
      .get("component")!
      .properties.push({ name: "local", type: "TEXT" });
    expect({ inspection, changes }).toEqual(baseline);
  });

  it("preserves the allocation namespace through successive commits without inventing one", () => {
    const first = advance(moveToB());
    const second = advance(
      committed([], { fromRevision: 8, toRevision: 9 }),
      first,
    );
    expect(second.newNodeIdPrefix).toBe("run_namespace_");
    const inspection = initial();
    delete inspection.newNodeIdPrefix;
    expect(advance(moveToB(), inspection)).not.toHaveProperty(
      "newNodeIdPrefix",
    );
  });
});

describe("node snapshot projection", () => {
  it.each(["image", "instance"])(
    "shares projection with sparse validated %s inspection nodes",
    (kind) => {
      const node: DesignInspectionHierarchy["content"]["document"]["nodesById"][string] =
        {
          id: "wire",
          kind,
          locked: false,
          childIds: [],
          parentId: null,
          size: { width: 100, height: 100 },
          transform: [1, 0, 0, 1, 0, 0],
        };
      expect(projectInspectedNode(node.id, node)).toEqual({
        ...node,
        componentId: null,
      });
      expect(projectInspectedNode(node.id, node).childIds).not.toBe(
        node.childIds,
      );
    },
  );

  it("adds images and instances with only inspection fields and removes committed deletions", () => {
    const photo = image();
    const next = advance(
      committed([
        nodeChange(undefined, photo),
        nodeChange(undefined, instance()),
        nodeChange(frame("a", "A", ["leaf"]), undefined),
        nodeChange(frame("leaf", "a"), undefined),
      ]),
    );
    expect(next.nodesById.get("image")).toEqual({
      id: "image",
      kind: "image",
      parentId: "A",
      childIds: [],
      componentId: null,
      assetId: "asset",
      designRole: "hero",
      locked: false,
      size: { width: 100, height: 100 },
      transform: [1, 0, 0, 1, 0, 0],
    });
    expect(next.nodesById.get("instance")).toMatchObject({
      kind: "instance",
      componentId: "component",
    });
    expect(next.nodesById.get("instance")).not.toHaveProperty("properties");
    expect(next.nodesById.has("a")).toBe(false);
    expect(next.nodesById.has("leaf")).toBe(false);
    photo.transform[4] = 999;
    photo.size.width = 999;
    expect(next.nodesById.get("image")?.transform[4]).toBe(0);
    expect(next.nodesById.get("image")?.size.width).toBe(100);
  });

  it("replaces node metadata rather than retaining obsolete asset, role or component references", () => {
    const first = advance(
      committed([
        nodeChange(undefined, image()),
        nodeChange(undefined, instance()),
      ]),
    );
    const next = advance(
      committed(
        [
          nodeChange(image(), { ...frame("image", "A"), locked: true }),
          nodeChange(instance(), frame("instance", "A")),
        ],
        { fromRevision: 8, toRevision: 9 },
      ),
      first,
    );
    expect(next.nodesById.get("image")).toEqual(
      inspectedFrame({ ...frame("image", "A"), locked: true }),
    );
    expect(next.nodesById.get("instance")?.componentId).toBeNull();
  });

  it.each([undefined, 42, { unexpected: true }])(
    "omits non-string freeform designRole: %j",
    (role) => {
      const photo = image();
      photo.extensions = role === undefined ? {} : { designRole: role };
      const next = advance(committed([nodeChange(undefined, photo)]));
      expect(next.nodesById.get("image")).not.toHaveProperty("designRole");
      expect(next.nodesById.get("image")?.assetId).toBe("asset");
    },
  );
});

describe("page and component projection", () => {
  it("updates PageRoot wrapping, adds pages and deletes removed page root sets", () => {
    const after = page("page", ["wrapper", "B"]);
    const changes = committed(
      [
        nodeChange(undefined, frame("wrapper", null, ["A"])),
        nodeChange(frame("A", null, ["a"]), frame("A", "wrapper", ["a"])),
      ],
      {
        pageChanges: [
          {
            type: "updated",
            pageId: "page",
            before: page("page", ["A", "B"]),
            after,
            changedFields: ["rootNodeIds"],
          },
          {
            type: "added",
            pageId: "new",
            after: page("new", []),
            changedFields: ["page"],
          },
          {
            type: "removed",
            pageId: "spare",
            before: page("spare", []),
            changedFields: ["page"],
          },
        ],
      },
    );
    const next = advance(changes);
    expect(next.pageRootsById).toEqual(
      new Map([
        ["page", new Set(["wrapper", "B"])],
        ["new", new Set()],
      ]),
    );
    expect(next.nodesById.get("A")?.parentId).toBe("wrapper");
    after.rootNodeIds.push("late");
    expect(next.pageRootsById.get("page")?.has("late")).toBe(false);
  });

  it("updates component roots, adds definitions and removes deleted catalog entries", () => {
    const before = component("component", "A");
    const after = component("component", "B");
    const first = advance(
      committed([], {
        componentChanges: [
          {
            type: "updated",
            componentId: "component",
            before,
            after,
            changedFields: ["rootNodeId"],
          },
          {
            type: "added",
            componentId: "new",
            after: component("new", "A"),
            changedFields: ["component"],
          },
        ],
      }),
    );
    expect(first.componentsById.get("component")).toEqual({
      id: "component",
      rootNodeId: "B",
    });
    expect(first.componentsById.get("new")).toEqual({
      id: "new",
      rootNodeId: "A",
    });
    expect(first.catalogComponentsById.has("component")).toBe(true);
    expect(first.catalogComponentsById.has("new")).toBe(false);
    const second = advance(
      committed([], {
        fromRevision: 8,
        toRevision: 9,
        componentChanges: [
          {
            type: "removed",
            componentId: "component",
            before: after,
            changedFields: ["component"],
          },
        ],
      }),
      first,
    );
    expect(second.componentsById.has("component")).toBe(false);
    expect(second.catalogComponentsById.has("component")).toBe(false);
    expect(second.componentsById.has("new")).toBe(true);
    expect(first.componentsById.has("component")).toBe(true);
    expect(first.catalogComponentsById.has("component")).toBe(true);
    expect(second.newNodeIdPrefix).toBe("run_namespace_");
  });
});
