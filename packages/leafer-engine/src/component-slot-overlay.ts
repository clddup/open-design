import { resolveComponentInstance } from "@opendesign/component-service";
import type {
  DesignDocument,
  DesignNode,
  Transform,
} from "@opendesign/design-contracts";
import { getVisibleWorldTransform } from "./scene-node-transform.js";

export interface ComponentSlotOverlaySpec {
  height: number;
  id: string;
  propertyName: string;
  transform: Transform;
  width: number;
}

export interface ComponentSlotOverlayPlan {
  fingerprint: string | null;
  specs: readonly ComponentSlotOverlaySpec[];
}

export function createComponentSlotOverlayPlan(
  document: DesignDocument,
  pageId: string,
): ComponentSlotOverlayPlan {
  const page = document.pagesById[pageId];
  if (!page) return { fingerprint: null, specs: [] };
  const specs: ComponentSlotOverlaySpec[] = [];
  const visited = new Set<string>();

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node || !node.visible) return;
    if (node.kind !== "instance") {
      node.childIds.forEach(visit);
      return;
    }

    const resolution = resolveComponentInstance(document, node.id);
    if (!resolution.ok) return;
    const projectedNodesById: Record<string, DesignNode> = {
      ...document.nodesById,
    };
    for (const resolved of resolution.nodes) {
      projectedNodesById[resolved.projectionId] = resolved.node;
    }
    for (const slot of resolution.slots) {
      if (
        slot.childCount !== 0 ||
        slot.settings.displayEmptyByDefault !== true
      ) {
        continue;
      }
      const displayNode = projectedNodesById[slot.displayNodeId];
      const world = getVisibleWorldTransform(
        projectedNodesById,
        slot.displayNodeId,
      );
      if (
        displayNode?.kind !== "slot" ||
        !world ||
        displayNode.size.width <= 0 ||
        displayNode.size.height <= 0
      ) {
        continue;
      }
      specs.push({
        height: displayNode.size.height,
        id: `${node.id}:${slot.propertyName}:${slot.displayNodeId}`,
        propertyName: slot.propertyName,
        transform: world,
        width: displayNode.size.width,
      });
    }
  };

  page.rootNodeIds.forEach(visit);
  specs.sort((left, right) => left.id.localeCompare(right.id));
  return {
    fingerprint: specs.length === 0 ? null : JSON.stringify(specs),
    specs,
  };
}
