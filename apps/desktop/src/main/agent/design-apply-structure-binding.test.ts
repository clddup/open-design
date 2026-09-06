import { describe, expect, it } from "vitest";
import type { DesignApplyToolInput } from "@/shared/design-agent-tools.js";
import type { InspectedHierarchy } from "./design-plan-registration.js";
import { bindDesignOperationStructure } from "./design-apply-structure-binding.js";

describe("bindDesignOperationStructure", () => {
  it("binds deep valid hierarchies without exhausting the call stack", () => {
    const source = inspection();
    const template = source.nodesById.get("root_a");
    if (!template) throw new Error("Missing fixture node");
    const depth = 12_000;
    source.nodesById.clear();
    source.pageRootsById.set("page_1", new Set(["deep_0"]));
    for (let index = 0; index < depth; index += 1) {
      const id = `deep_${index}`;
      source.nodesById.set(id, {
        ...template,
        id,
        parentId: index === 0 ? null : `deep_${index - 1}`,
        childIds: index + 1 < depth ? [`deep_${index + 1}`] : [],
      });
    }
    const input = {
      label: "Append to deepest Frame",
      commands: [insert("new_child", `deep_${depth - 1}`, 99)],
    };
    const bound = bindDesignOperationStructure(input, source);
    expect(bound.commands[0]).toMatchObject({
      parentId: `deep_${depth - 1}`,
      index: 0,
    });
    expect(source.nodesById.get(`deep_${depth - 1}`)?.childIds).toEqual([]);
    expect(input.commands[0].index).toBe(99);
  });

  it("does not recurse indefinitely on a repeated node in a defensive cache projection", () => {
    const source = inspection();
    const node = source.nodesById.get("root_a");
    if (!node) throw new Error("Missing fixture node");
    node.childIds = ["root_a"];
    const input = { label: "Append", commands: [insert("new_root", null, 99)] };
    expect(
      bindDesignOperationStructure(input, source).commands[0],
    ).toMatchObject({ index: 2 });
    expect(source.nodesById.get("root_a")?.childIds).toEqual(["root_a"]);
  });

  it("appends siblings and nested children from trusted hierarchy state", () => {
    const input = {
      label: "Create material hierarchy",
      commands: [
        insert("parent", null, 99),
        insert("child_a", "parent", 99),
        insert("child_b", "parent", 99),
        insert("existing_child", "existing_parent", 99),
      ],
    } satisfies DesignApplyToolInput;

    const bound = bindDesignOperationStructure(input, inspection());

    expect(
      bound.commands.flatMap((command) =>
        command.type === "insert_element" ? [command.index] : [],
      ),
    ).toEqual([2, 0, 1, 2]);
    expect(input.commands.map((command) => command.index)).toEqual([
      99, 99, 99, 99,
    ]);
  });

  it("tracks earlier deletes and moves before binding later inserts", () => {
    const input = {
      label: "Restructure then append",
      commands: [
        { commandId: "delete_a", type: "delete_element", nodeId: "a" },
        {
          commandId: "move_root",
          type: "move_element",
          nodeId: "root_a",
          pageId: "page_1",
          parentId: "existing_parent",
          index: 1,
        },
        insert("new_root", null, 99),
        insert("new_child", "existing_parent", 99),
      ],
    } satisfies DesignApplyToolInput;

    const bound = bindDesignOperationStructure(input, inspection());

    expect(bound.commands[1]).toMatchObject({ index: 1 });
    expect(bound.commands[2]).toMatchObject({ index: 1 });
    expect(bound.commands[3]).toMatchObject({ index: 2 });
  });

  it("uses replacement child counts for later inserts", () => {
    const replacement = insert("existing_parent", null, 0).node;
    const input = {
      label: "Replace then append",
      commands: [
        {
          commandId: "replace_parent",
          type: "replace_subtree",
          rootNodeId: "existing_parent",
          nodes: [{ ...replacement, childIds: ["replacement_child"] }],
        },
        insert("new_child", "existing_parent", 99),
      ],
    } satisfies DesignApplyToolInput;

    const bound = bindDesignOperationStructure(input, inspection());

    expect(bound.commands[1]).toMatchObject({ index: 1 });
  });

  it("preserves the inspected root parent when replacing a nested subtree", () => {
    const replacement = insert("a", null, 0).node;
    const input = {
      label: "Replace nested child",
      commands: [
        {
          commandId: "replace_nested",
          type: "replace_subtree",
          rootNodeId: "a",
          nodes: [replacement],
        },
      ],
    } satisfies DesignApplyToolInput;

    const bound = bindDesignOperationStructure(input, inspection());

    expect(bound.commands[0]).toMatchObject({
      nodes: [{ id: "a", parentId: "existing_parent" }],
    });
    expect(input.commands[0]).toMatchObject({ nodes: [{ parentId: null }] });
  });
});

function insert(id: string, parentId: string | null, index: number) {
  return {
    commandId: `insert_${id}`,
    type: "insert_element" as const,
    pageId: "page_1",
    parentId,
    index,
    node: {
      id,
      kind: "frame" as const,
      name: id,
      parentId,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: false,
      },
      extensions: {},
    },
  };
}

function inspection(): InspectedHierarchy {
  type InspectedNode =
    InspectedHierarchy["nodesById"] extends Map<string, infer Node>
      ? Node
      : never;
  const node = (id: string, childIds: string[]): InspectedNode => ({
    childIds,
    componentId: null,
    id,
    kind: "frame",
    locked: false,
    parentId: null,
    size: { width: 100, height: 100 },
    transform: [1, 0, 0, 1, 0, 0] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
  });
  return {
    catalogComponentsById: new Map(),
    componentsById: new Map(),
    documentId: "document_1",
    nodesById: new Map([
      ["root_a", node("root_a", [])],
      ["existing_parent", node("existing_parent", ["a", "b"])],
      ["a", { ...node("a", []), parentId: "existing_parent" }],
      ["b", { ...node("b", []), parentId: "existing_parent" }],
    ]),
    pageRootsById: new Map([
      ["page_1", new Set(["root_a", "existing_parent"])],
    ]),
    revision: 1,
  };
}
