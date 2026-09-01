import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import { analyzeContainerSelection } from "./layer-operations.js";
import { projectFlattenAppearance } from "./vector-flatten-appearance.js";
import {
  flattenFailure,
  type FlattenFailure,
} from "./vector-flatten-internal.js";
import { isFlattenSourceNode } from "./vector-flatten-sources.js";

export type FlattenRootSelection = {
  document: DesignDocument;
  nodes: readonly DesignNode[];
  ordered: readonly string[];
  parentId: string | null;
  siblings: readonly string[];
  sourceNode: DesignNode;
};

export function analyzeFlattenRootSelection(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): ({ ok: true } & FlattenRootSelection) | FlattenFailure {
  const selection = analyzeContainerSelection(document, pageId, nodeIds, {
    action: "Flatten",
    minimum: 1,
  });
  if (!selection.ok) {
    return flattenFailure("unsupported-topology", selection.message);
  }
  if (
    selection.parentId &&
    document.nodesById[selection.parentId]?.kind === "boolean"
  ) {
    return flattenFailure(
      "unsupported-topology",
      "Flattening Boolean operands requires leaving Boolean edit scope",
    );
  }
  const nodes = selection.ordered.map((nodeId) => document.nodesById[nodeId]!);
  const unsupported = nodes.find((node) => !isSupportedFlattenRoot(node));
  if (unsupported) {
    return flattenFailure(
      "unsupported-topology",
      `Flatten currently supports Frame, Group, Boolean, Component Instance, Text, Image, Rectangle, Ellipse, Line, Polygon, Star, Path, and Vector layers; received ${unsupported.kind} ${unsupported.id}`,
    );
  }
  const appearance = projectFlattenAppearance(document, nodes);
  if (!appearance.ok) return appearance;
  const projectedNodes: DesignNode[] = [];
  for (const node of nodes) {
    const projected = appearance.document.nodesById[node.id];
    if (!projected) {
      return flattenFailure(
        "unsupported-topology",
        `Flatten source ${node.id} is missing from the current Component projection`,
      );
    }
    projectedNodes.push(projected);
  }
  return {
    ok: true,
    document: appearance.document,
    nodes: projectedNodes,
    ordered: selection.ordered,
    parentId: selection.parentId,
    siblings: selection.siblings,
    sourceNode: projectedNodes[0]!,
  };
}

function isSupportedFlattenRoot(node: DesignNode): boolean {
  return (
    isFlattenSourceNode(node) ||
    node.kind === "group" ||
    node.kind === "frame" ||
    node.kind === "image" ||
    node.kind === "text" ||
    node.kind === "instance"
  );
}
