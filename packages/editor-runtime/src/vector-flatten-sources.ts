import {
  nodePaintCollections,
  type DesignDocument,
  type DesignNode,
  type FrameLikeNode,
  type RectangleNode,
  type Transform,
} from "@opendesign/design-contracts";
import { flattenImageNode } from "./vector-flatten-image.js";
import {
  flattenFailure,
  type FlattenFailure,
  type FlattenSourceEntry,
  type ResolvedFlattenSourceEntry,
} from "./vector-flatten-internal.js";
import type { FlattenSourceNode } from "./vector-flatten-shapes.js";
import { multiplyTransforms } from "./geometry.js";

export function resolveFlattenSelection(
  document: DesignDocument,
  entries: readonly FlattenSourceEntry[],
): { ok: true; nodes: readonly ResolvedFlattenSourceEntry[] } | FlattenFailure {
  const resolved: ResolvedFlattenSourceEntry[] = [];
  for (const entry of entries) {
    const { transform } = entry;
    const node = detachFlattenPaintBindings(entry.node);
    if (entry.contribution === "all") {
      if (node.kind === "image") {
        const image = flattenImageNode(document, node, transform);
        if (!image.ok) {
          return flattenFailure("unsupported-topology", image.message);
        }
        resolved.push({ clips: entry.clips, node: image.node });
        continue;
      }
      if (!isFlattenSourceNode(node) && node.kind !== "text") {
        return flattenFailure(
          "unsupported-topology",
          `Flatten source ${node.id} changed kind during appearance resolution`,
        );
      }
      resolved.push({ clips: entry.clips, node: { ...node, transform } });
      continue;
    }
    if (node.kind !== "frame" && node.kind !== "slot") {
      return flattenFailure(
        "unsupported-topology",
        `Flatten source ${node.id} changed kind during appearance resolution`,
      );
    }
    resolved.push({
      clips: entry.clips,
      node: frameContributionNode(node, transform, entry.contribution),
    });
  }
  return { ok: true, nodes: resolved };
}

export function collectFlattenSources(
  document: DesignDocument,
  node: DesignNode,
  transform: Transform,
  clips: FlattenSourceEntry["clips"],
  entries: FlattenSourceEntry[],
  preserveShell = false,
): { ok: true } | FlattenFailure {
  if (!node.visible) {
    return flattenFailure(
      "unsupported-topology",
      `Hidden ${node.kind} ${node.id} cannot be flattened`,
    );
  }
  if (!preserveShell) {
    const issue = flattenCompositingIssue(node);
    if (issue) {
      return flattenFailure("requires-raster-compositing", issue);
    }
  }
  if (
    isFlattenSourceNode(node) ||
    node.kind === "text" ||
    node.kind === "image"
  ) {
    entries.push({ clips, contribution: "all", node, transform });
    return { ok: true };
  }
  if (node.kind === "frame" || node.kind === "slot") {
    return collectFrameSources(document, node, transform, clips, entries);
  }
  if (node.kind !== "group") {
    return flattenFailure(
      "unsupported-topology",
      `Flatten descendant ${node.kind} ${node.id} cannot yet be flattened exactly`,
    );
  }
  return collectChildren(document, node, transform, clips, entries);
}

export function isFlattenSourceNode(
  node: DesignNode,
): node is FlattenSourceNode {
  return (
    node.kind === "boolean" ||
    node.kind === "ellipse" ||
    node.kind === "line" ||
    node.kind === "path" ||
    node.kind === "polygon" ||
    node.kind === "rectangle" ||
    node.kind === "star" ||
    node.kind === "vector"
  );
}

function collectFrameSources(
  document: DesignDocument,
  node: FrameLikeNode,
  transform: Transform,
  clips: FlattenSourceEntry["clips"],
  entries: FlattenSourceEntry[],
): { ok: true } | FlattenFailure {
  entries.push({ clips, contribution: "fill", node, transform });
  const childClips = node.properties.clipsContent
    ? [
        ...clips,
        { node: frameContributionNode(node, transform, "fill"), transform },
      ]
    : clips;
  const collected = collectChildren(
    document,
    node,
    transform,
    childClips,
    entries,
  );
  if (!collected.ok) return collected;
  entries.push({ clips, contribution: "stroke", node, transform });
  return { ok: true };
}

function collectChildren(
  document: DesignDocument,
  node: DesignNode,
  transform: Transform,
  clips: FlattenSourceEntry["clips"],
  entries: FlattenSourceEntry[],
): { ok: true } | FlattenFailure {
  for (const childId of node.childIds) {
    const child = document.nodesById[childId];
    if (!child || child.parentId !== node.id) {
      return flattenFailure(
        "unsupported-topology",
        `${node.kind} ${node.id} contains an invalid child ${childId}`,
      );
    }
    const collected = collectFlattenSources(
      document,
      child,
      multiplyTransforms(transform, child.transform),
      clips,
      entries,
    );
    if (!collected.ok) return collected;
  }
  return { ok: true };
}

function flattenCompositingIssue(node: DesignNode): string | null {
  if (
    node.opacity !== 1 ||
    (node.effects ?? []).some((effect) => effect.visible !== false)
  ) {
    return `${node.kind} ${node.id} has layer compositing that cannot be preserved by Flatten`;
  }
  if (
    (node.blendMode !== undefined &&
      node.blendMode !== "normal" &&
      node.blendMode !== "pass-through") ||
    (node.maskMode !== undefined && node.maskMode !== "none")
  ) {
    return `${node.kind} ${node.id} has blend or mask semantics that cannot be preserved by Flatten`;
  }
  return null;
}

function detachFlattenPaintBindings(node: DesignNode): DesignNode {
  const clone = structuredClone(node);
  for (const { paints } of nodePaintCollections(clone)) {
    for (const paint of paints) {
      if (paint.type === "solid") delete paint.boundVariables;
    }
  }
  return clone;
}

function frameContributionNode(
  frame: FrameLikeNode,
  transform: Transform,
  contribution: "fill" | "stroke",
): RectangleNode {
  const properties = frame.properties;
  return {
    ...frame,
    childIds: [],
    kind: "rectangle",
    transform,
    properties: {
      cornerRadius: properties.cornerRadius,
      fills: contribution === "fill" ? properties.fills : [],
      strokes: contribution === "stroke" ? properties.strokes : [],
      strokeWidth: contribution === "stroke" ? properties.strokeWidth : 0,
      ...(properties.strokeAlign === undefined
        ? {}
        : { strokeAlign: properties.strokeAlign }),
      ...(properties.strokeCap === undefined
        ? {}
        : { strokeCap: properties.strokeCap }),
      ...(properties.strokeJoin === undefined
        ? {}
        : { strokeJoin: properties.strokeJoin }),
      ...(properties.dashPattern === undefined
        ? {}
        : { dashPattern: properties.dashPattern }),
    },
  };
}
