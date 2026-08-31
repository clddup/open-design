import type { DesignNode, Paint } from "./public-types.js";

export interface NodePaintCollection {
  paints: readonly Paint[];
  /** JSON Pointer relative to the node root. */
  path: string;
}

/** Enumerates every persisted Paint owned by one node. */
export function nodePaintCollections(node: DesignNode): NodePaintCollection[] {
  if (
    node.kind === "group" ||
    node.kind === "image" ||
    node.kind === "instance" ||
    node.kind === "slice"
  ) {
    return [];
  }
  const collections: NodePaintCollection[] = [
    { paints: node.properties.fills, path: "/properties/fills" },
    { paints: node.properties.strokes, path: "/properties/strokes" },
  ];
  if (node.kind === "text") {
    for (const [runIndex, run] of (node.properties.runs ?? []).entries()) {
      collections.push({
        paints: run.style.fills,
        path: `/properties/runs/${runIndex}/style/fills`,
      });
    }
  }
  if (
    (node.kind === "path" || node.kind === "vector") &&
    "network" in node.properties
  ) {
    for (const [
      regionIndex,
      region,
    ] of node.properties.network.regions.entries()) {
      if (region.fills === undefined) continue;
      collections.push({
        paints: region.fills,
        path: `/properties/network/regions/${regionIndex}/fills`,
      });
    }
  }
  return collections;
}

export function nodePaints(node: DesignNode): Paint[] {
  return nodePaintCollections(node).flatMap(({ paints }) => paints);
}
