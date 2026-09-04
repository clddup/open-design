import type { DesignApplyToolInput } from "@/shared/design-agent-tools.js";
import type { InspectedHierarchy } from "./design-plan-registration.js";

/** Bind structural positions from the latest trusted hierarchy, never model guesses. */
export function bindDesignOperationStructure(
  input: DesignApplyToolInput,
  inspection: InspectedHierarchy | undefined,
): DesignApplyToolInput {
  const hierarchy = createHierarchyState(inspection);
  let changed = false;
  const commands = input.commands.map((command) => {
    if (command.type === "delete_element") {
      hierarchy.remove(command.nodeId);
      return command;
    }
    if (command.type === "move_element") {
      const index = hierarchy.move(
        command.nodeId,
        command.pageId,
        command.parentId,
      );
      if (command.index === index) return command;
      changed = true;
      return { ...command, index };
    }
    if (command.type === "replace_subtree") {
      const nodes = hierarchy.replace(command.rootNodeId, command.nodes);
      if (nodes === command.nodes) return command;
      changed = true;
      return { ...command, nodes };
    }
    if (command.type !== "insert_element") return command;
    const index = hierarchy.append(
      command.pageId,
      command.parentId,
      command.node.id,
      command.node.childIds,
    );
    if (command.index === index) return command;
    changed = true;
    return { ...command, index };
  });
  return changed ? { ...input, commands } : input;
}

type NodeLocation = { pageId: string; parentId: string | null };
type ReplacementNodes = Extract<
  DesignApplyToolInput["commands"][number],
  { type: "replace_subtree" }
>["nodes"];

function createHierarchyState(inspection: InspectedHierarchy | undefined) {
  const childCounts = new Map<string, number>();
  const locations = new Map<string, NodeLocation>();
  for (const [pageId, roots] of inspection?.pageRootsById ?? []) {
    childCounts.set(containerKey(pageId, null), roots.size);
    for (const rootId of roots) visitInspectedNode(rootId, pageId, null);
  }

  function visitInspectedNode(
    nodeId: string,
    pageId: string,
    parentId: string | null,
  ): void {
    const node = inspection?.nodesById.get(nodeId);
    if (!node) return;
    locations.set(nodeId, { pageId, parentId });
    childCounts.set(containerKey(pageId, nodeId), node.childIds.length);
    for (const childId of node.childIds) {
      visitInspectedNode(childId, pageId, nodeId);
    }
  }

  const changeCount = (
    pageId: string,
    parentId: string | null,
    delta: number,
  ) => {
    const key = containerKey(pageId, parentId);
    childCounts.set(key, Math.max(0, (childCounts.get(key) ?? 0) + delta));
  };
  const remove = (nodeId: string) => {
    const location = locations.get(nodeId);
    if (!location) return;
    changeCount(location.pageId, location.parentId, -1);
    locations.delete(nodeId);
  };

  return {
    append(
      pageId: string,
      parentId: string | null,
      nodeId: string,
      childIds: readonly string[],
    ) {
      const key = containerKey(pageId, parentId);
      const index = childCounts.get(key) ?? 0;
      childCounts.set(key, index + 1);
      childCounts.set(containerKey(pageId, nodeId), childIds.length);
      locations.set(nodeId, { pageId, parentId });
      return index;
    },
    move(nodeId: string, pageId: string, parentId: string | null) {
      remove(nodeId);
      const key = containerKey(pageId, parentId);
      const index = childCounts.get(key) ?? 0;
      childCounts.set(key, index + 1);
      locations.set(nodeId, { pageId, parentId });
      return index;
    },
    remove,
    replace(rootNodeId: string, nodes: ReplacementNodes): ReplacementNodes {
      const rootLocation = locations.get(rootNodeId);
      if (!rootLocation) return nodes;
      const bound = nodes.map((node) =>
        node.id === rootNodeId && node.parentId !== rootLocation.parentId
          ? { ...node, parentId: rootLocation.parentId }
          : node,
      );
      for (const node of bound) {
        const parentId =
          node.id === rootNodeId ? rootLocation.parentId : node.parentId;
        locations.set(node.id, { pageId: rootLocation.pageId, parentId });
        childCounts.set(
          containerKey(rootLocation.pageId, node.id),
          node.childIds.length,
        );
      }
      return bound.some((node, index) => node !== nodes[index]) ? bound : nodes;
    },
  };
}

function containerKey(pageId: string, parentId: string | null): string {
  return `${pageId}\u0000${parentId ?? ""}`;
}
