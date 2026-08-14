import type { DesignDocument, Transform } from "@opendesign/design-contracts";
import { getVisibleWorldTransform } from "./scene-node-transform.js";

export interface SliceOverlaySpec {
  height: number;
  id: string;
  transform: Transform;
  width: number;
}

export interface SliceOverlayPlan {
  fingerprint: string | null;
  specs: readonly SliceOverlaySpec[];
}

export function createSliceOverlayPlan(
  document: DesignDocument,
  pageId: string,
): SliceOverlayPlan {
  const page = document.pagesById[pageId];
  if (!page) return { fingerprint: null, specs: [] };
  const specs: SliceOverlaySpec[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node || !node.visible) return;
    if (node.kind === "slice") {
      const transform = getVisibleWorldTransform(document.nodesById, node.id);
      if (transform && node.size.width > 0 && node.size.height > 0) {
        specs.push({
          height: node.size.height,
          id: node.id,
          transform,
          width: node.size.width,
        });
      }
      return;
    }
    node.childIds.forEach(visit);
  };
  page.rootNodeIds.forEach(visit);
  specs.sort((left, right) => left.id.localeCompare(right.id));
  return {
    fingerprint: specs.length === 0 ? null : JSON.stringify(specs),
    specs,
  };
}
