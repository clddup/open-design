import type { DesignOperation } from "@opendesign/design-contracts";
import type {
  DesignDeliveryTargetState,
  InspectedHierarchy,
} from "./design-plan-registration.js";

type ImpactInspection = Pick<
  InspectedHierarchy,
  "nodesById" | "componentsById"
>;
type ImpactState = {
  targetsById: ReadonlyMap<
    string,
    {
      artboardEstablished: boolean;
      planned: Pick<DesignDeliveryTargetState["planned"], "artboard">;
      delivery: Pick<DesignDeliveryTargetState["delivery"], "reservedNodeIds">;
    }
  >;
};

/** Unknown/shared effects retain the existing Plan path; this query only proves disjoint local edits. */
export function isIndependentNodeEdit(
  commands: readonly DesignOperation[],
  state: ImpactState,
  inspection: ImpactInspection,
): boolean {
  const related = new Set<string>();
  for (const target of state.targetsById.values()) {
    for (const id of target.delivery.reservedNodeIds) related.add(id);
    const root = target.planned.artboard.frameId;
    if (!inspection.nodesById.has(root)) {
      if (target.artboardEstablished) return false;
      related.add(root);
    } else if (!addRelatedTree(related, root, inspection)) return false;
  }
  // Component Main edits can affect instances without sharing a physical ancestor.
  for (const component of inspection.componentsById.values()) {
    if (!addRelatedTree(related, component.rootNodeId, inspection))
      return false;
  }
  const created = new Set(
    commands.flatMap((command) =>
      command.type === "insert_element"
        ? [command.node.id]
        : command.type === "replace_subtree"
          ? command.nodes.map((node) => node.id)
          : [],
    ),
  );
  return (
    commands.length > 0 &&
    commands.every((command) => {
      const ids = localNodeReferences(command);
      return (
        ids !== undefined &&
        ids.every(
          (id) =>
            id === null ||
            (!related.has(id) &&
              (inspection.nodesById.has(id) || created.has(id)) &&
              hasIndependentAncestors(id, related, inspection)),
        )
      );
    })
  );
}

function addRelatedTree(
  ids: Set<string>,
  root: string,
  inspection: ImpactInspection,
): boolean {
  const queue = [root];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    ids.add(id);
    const node = inspection.nodesById.get(id);
    if (!node) return false;
    queue.push(...node.childIds);
  }
  let ancestor = inspection.nodesById.get(root)?.parentId;
  const ancestors = new Set<string>();
  while (ancestor && !ancestors.has(ancestor)) {
    ancestors.add(ancestor);
    ids.add(ancestor);
    const node = inspection.nodesById.get(ancestor);
    if (!node) return false;
    ancestor = node.parentId;
  }
  return !ancestor;
}

function hasIndependentAncestors(
  id: string,
  related: ReadonlySet<string>,
  inspection: ImpactInspection,
): boolean {
  const seen = new Set<string>();
  let parent = inspection.nodesById.get(id)?.parentId;
  while (parent !== undefined && parent !== null) {
    if (seen.has(parent) || related.has(parent)) return false;
    seen.add(parent);
    const node = inspection.nodesById.get(parent);
    if (!node) return false;
    parent = node.parentId;
  }
  return true;
}

function localNodeReferences(
  command: DesignOperation,
): Array<string | null> | undefined {
  switch (command.type) {
    case "insert_element":
      return [command.node.id, command.parentId, ...command.node.childIds];
    case "update_properties":
    case "delete_element":
      return [command.nodeId];
    case "move_element":
      return [command.nodeId, command.parentId];
    case "replace_subtree":
      return [
        command.rootNodeId,
        ...command.nodes.flatMap((node) => [
          node.id,
          node.parentId,
          ...node.childIds,
        ]),
      ];
    case "reflow_text":
      return [...command.nodeIds];
    default:
      return undefined;
  }
}
