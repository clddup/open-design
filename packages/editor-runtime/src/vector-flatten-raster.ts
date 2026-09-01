import type {
  DesignAsset,
  DesignDocument,
  DesignNode,
  DesignOperation,
  VectorNetwork,
} from "@opendesign/design-contracts";
import { planDeleteNodes } from "./deletion-operations.js";
import {
  flattenFailure,
  type FlattenFailure,
} from "./vector-flatten-internal.js";
import type { FlattenOperationPlan } from "./vector-flatten.js";
import { analyzeFlattenRootSelection } from "./vector-flatten-selection.js";

export type RasterFlattenRequest = {
  baseRevision: number;
  documentId: string;
  neutralizeRootNodeId?: string;
  nodeIds: readonly string[];
  pageId: string;
  parentId: string | null;
};

export type RasterFlattenPreparation =
  | { kind: "ready"; request: RasterFlattenRequest }
  | { kind: "not-required" }
  | { kind: "failed"; failure: FlattenFailure };

export type RasterFlattenResult = {
  asset: DesignAsset;
  bounds: { x: number; y: number; width: number; height: number };
};

export function prepareRasterFlattenNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): RasterFlattenPreparation {
  const selection = analyzeFlattenRootSelection(document, pageId, nodeIds);
  if (!selection.ok) return { kind: "failed", failure: selection };
  const singleRoot = selection.nodes.length === 1;
  const rootIds = new Set(selection.ordered);
  const nodes = flattenSubtreeNodes(selection.document, selection.nodes);
  const composited = nodes.filter(
    (node) => !(singleRoot && rootIds.has(node.id)) && hasCompositing(node),
  );
  if (!singleRoot) {
    composited.push(...selection.nodes.filter(hasCompositing));
  }
  if (composited.length === 0) return { kind: "not-required" };

  const issue = rasterIsolationIssue(
    selection.document,
    selection.nodes,
    selection.ordered,
    selection.siblings,
  );
  if (issue) {
    return {
      kind: "failed",
      failure: flattenFailure("unsupported-topology", issue),
    };
  }
  return {
    kind: "ready",
    request: {
      baseRevision: document.revision,
      documentId: document.documentId,
      ...(singleRoot ? { neutralizeRootNodeId: selection.ordered[0] } : {}),
      nodeIds: [...selection.ordered],
      pageId,
      parentId: selection.parentId,
    },
  };
}

export function planRasterizedFlattenNodes(
  document: DesignDocument,
  preparation: RasterFlattenRequest,
  resultNodeId: string,
  geometryIdPrefix: string,
  raster: RasterFlattenResult,
): FlattenOperationPlan {
  const identityIssue = rasterPreparationIdentityIssue(document, preparation);
  if (identityIssue)
    return flattenFailure("unsupported-topology", identityIssue);
  if (!resultNodeId || document.nodesById[resultNodeId]) {
    return flattenFailure(
      "invalid-geometry",
      `Flatten result node ID ${resultNodeId || "(empty)"} is unavailable`,
    );
  }
  if (document.assetsById[raster.asset.id]) {
    return flattenFailure(
      "invalid-geometry",
      `Flatten raster asset ID ${raster.asset.id} is unavailable`,
    );
  }
  const rasterIssue = rasterResultIssue(raster);
  if (rasterIssue) return flattenFailure("invalid-geometry", rasterIssue);
  const selection = analyzeFlattenRootSelection(
    document,
    preparation.pageId,
    preparation.nodeIds,
  );
  if (!selection.ok) return selection;
  if (selection.parentId !== preparation.parentId) {
    return flattenFailure(
      "unsupported-topology",
      "Flatten source parent changed during rasterization",
    );
  }
  const deletion = planDeleteNodes(document, {
    nodeIds: selection.ordered,
    commandPrefix: `flatten_${resultNodeId}`,
  });
  if (!deletion.ok) {
    return flattenFailure("unsupported-topology", deletion.message);
  }
  const node = rasterVectorNode(
    selection.nodes.length === 1 ? selection.sourceNode : null,
    resultNodeId,
    preparation.parentId,
    geometryIdPrefix,
    raster,
  );
  const operations: DesignOperation[] = [
    {
      commandId: `put_flatten_raster_${resultNodeId}`,
      type: "put_asset",
      asset: structuredClone(raster.asset),
    },
    ...deletion.commands,
    {
      commandId: `insert_flattened_vector_${resultNodeId}`,
      type: "insert_element",
      pageId: preparation.pageId,
      parentId: preparation.parentId,
      index: Math.min(
        ...selection.ordered.map((nodeId) =>
          selection.siblings.indexOf(nodeId),
        ),
      ),
      node,
    },
  ];
  return {
    ok: true,
    operations,
    flattenResult: {
      resultNodeId,
      sourceNodeIds: [...selection.ordered],
    },
  };
}

function rasterIsolationIssue(
  document: DesignDocument,
  roots: readonly DesignNode[],
  ordered: readonly string[],
  siblings: readonly string[],
): string | null {
  for (const root of roots) {
    const issue = subtreeIsolationIssue(document, root, root.id);
    if (issue) return issue;
  }
  if (roots.length === 1) {
    const maskMode = roots[0]?.maskMode;
    return maskMode === "outline" || maskMode === "clipping"
      ? `Flatten root ${roots[0]!.id} uses a geometry mask that cannot be preserved by a raster rectangle`
      : null;
  }
  const rootBackgroundBlur = roots.find(hasBackgroundBlur);
  if (rootBackgroundBlur) {
    return `Flatten layer ${rootBackgroundBlur.id} uses background blur, which the current pixel compositor cannot preserve`;
  }
  const rootBlend = roots.find(
    (root) =>
      hasBackdropBlend(root) &&
      !selectionContainsBackdrop(root.id, ordered, siblings),
  );
  if (rootBlend) {
    return `Flatten layer ${rootBlend.id} blends with unselected backdrop content`;
  }
  const maskIndex = ordered.findIndex((nodeId) =>
    isActiveMask(document.nodesById[nodeId]),
  );
  if (maskIndex < 0) return null;
  const siblingMaskIndex = siblings.indexOf(ordered[maskIndex]!);
  const required = siblings.slice(siblingMaskIndex);
  return required.every((nodeId) => ordered.includes(nodeId))
    ? null
    : "Flatten must include every sibling affected by a selected root mask";
}

function subtreeIsolationIssue(
  document: DesignDocument,
  root: DesignNode,
  rootId: string,
): string | null {
  const pending = [...root.childIds];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    const node = nodeId ? document.nodesById[nodeId] : undefined;
    if (!node) return `Flatten subtree ${rootId} contains an invalid child`;
    if (hasBackgroundBlur(node)) {
      return `Flatten descendant ${node.id} uses background blur, which the current pixel compositor cannot preserve`;
    }
    if (
      hasBackdropBlend(node) &&
      !hasIsolatingAncestor(document, node, rootId)
    ) {
      return `Flatten descendant ${node.id} blends with content outside an isolated ancestor`;
    }
    pending.push(...node.childIds);
  }
  return null;
}

function hasIsolatingAncestor(
  document: DesignDocument,
  node: DesignNode,
  rootId: string,
): boolean {
  let parentId = node.parentId;
  while (parentId) {
    const parent = document.nodesById[parentId];
    if (!parent) return false;
    if (parent.blendMode === "normal") return true;
    if (parentId === rootId) return false;
    parentId = parent.parentId;
  }
  return false;
}

function selectionContainsBackdrop(
  nodeId: string,
  ordered: readonly string[],
  siblings: readonly string[],
): boolean {
  const nodeIndex = siblings.indexOf(nodeId);
  if (nodeIndex < 0) return false;
  const selected = new Set(ordered);
  return siblings
    .slice(0, nodeIndex)
    .every((siblingId) => selected.has(siblingId));
}

function hasCompositing(node: DesignNode): boolean {
  return (
    node.opacity !== 1 ||
    (node.effects ?? []).some((effect) => effect.visible !== false) ||
    hasBackdropBlend(node) ||
    hasBackgroundBlur(node) ||
    isActiveMask(node)
  );
}

function hasBackdropBlend(node: DesignNode): boolean {
  if (
    node.blendMode !== undefined &&
    node.blendMode !== "normal" &&
    node.blendMode !== "pass-through"
  ) {
    return true;
  }
  return (node.effects ?? []).some(
    (effect) =>
      effect.visible !== false &&
      "blendMode" in effect &&
      effect.blendMode !== undefined &&
      effect.blendMode !== "normal",
  );
}

function hasBackgroundBlur(node: DesignNode): boolean {
  return (node.effects ?? []).some(
    (effect) => effect.visible !== false && effect.type === "background-blur",
  );
}

function isActiveMask(node: DesignNode | undefined): boolean {
  return node?.maskMode !== undefined && node.maskMode !== "none";
}

function flattenSubtreeNodes(
  document: DesignDocument,
  roots: readonly DesignNode[],
): DesignNode[] {
  const result: DesignNode[] = [];
  const pending = [...roots];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || visited.has(node.id)) continue;
    visited.add(node.id);
    result.push(node);
    node.childIds.forEach((childId) =>
      pending.push(document.nodesById[childId]!),
    );
  }
  return result;
}

function rasterPreparationIdentityIssue(
  document: DesignDocument,
  preparation: RasterFlattenRequest,
): string | null {
  if (document.documentId !== preparation.documentId) {
    return "Flatten raster belongs to another Design File";
  }
  if (document.revision !== preparation.baseRevision) {
    return "Flatten source changed while raster compositing was in progress";
  }
  return null;
}

function rasterResultIssue(raster: RasterFlattenResult): string | null {
  const values = [
    raster.bounds.x,
    raster.bounds.y,
    raster.bounds.width,
    raster.bounds.height,
  ];
  if (!values.every(Number.isFinite))
    return "Flatten raster bounds are invalid";
  if (raster.bounds.width <= 0 || raster.bounds.height <= 0) {
    return "Flatten raster bounds must be positive";
  }
  if (
    raster.asset.kind !== "image" ||
    raster.asset.mimeType !== "image/png" ||
    raster.asset.source.type !== "data" ||
    raster.asset.source.value.length === 0 ||
    !raster.asset.size
  ) {
    return "Flatten raster must be a self-contained PNG image asset";
  }
  return null;
}

function rasterVectorNode(
  shell: DesignNode | null,
  id: string,
  parentId: string | null,
  geometryIdPrefix: string,
  raster: RasterFlattenResult,
): Extract<DesignNode, { kind: "vector" }> {
  const network = rasterRectangleNetwork(
    geometryIdPrefix,
    raster.bounds.width,
    raster.bounds.height,
    raster.asset.id,
  );
  return {
    id,
    kind: "vector",
    name: `${shell?.name || "Vector"} Flattened`,
    parentId,
    childIds: [],
    visible: shell?.visible ?? true,
    locked: false,
    transform: [1, 0, 0, 1, raster.bounds.x, raster.bounds.y],
    size: { width: raster.bounds.width, height: raster.bounds.height },
    exportSettings: [],
    opacity: shell?.opacity ?? 1,
    ...(shell?.blendMode === undefined ? {} : { blendMode: shell.blendMode }),
    ...(shell?.effects === undefined
      ? {}
      : { effects: structuredClone(shell.effects) }),
    ...(shell?.maskMode === undefined ? {} : { maskMode: shell.maskMode }),
    ...(shell?.effectStyleId === undefined
      ? {}
      : { effectStyleId: shell.effectStyleId }),
    ...(shell?.explicitVariableModes === undefined
      ? {}
      : {
          explicitVariableModes: structuredClone(shell.explicitVariableModes),
        }),
    ...shellVariableBindings(shell),
    extensions: {},
    properties: {
      network,
      fillRule: "nonzero",
      fills: [],
      strokes: [],
      strokeWidth: 0,
    },
  };
}

function shellVariableBindings(
  shell: DesignNode | null,
): Pick<DesignNode, "boundVariables"> | Record<string, never> {
  const visible = shell?.boundVariables?.visible;
  const opacity = shell?.boundVariables?.opacity;
  return visible || opacity
    ? {
        boundVariables: {
          ...(visible ? { visible: structuredClone(visible) } : {}),
          ...(opacity ? { opacity: structuredClone(opacity) } : {}),
        },
      }
    : {};
}

function rasterRectangleNetwork(
  prefix: string,
  width: number,
  height: number,
  assetId: string,
): VectorNetwork {
  const vertexIds = [0, 1, 2, 3].map((index) => `${prefix}_v${index}`);
  const segmentIds = [0, 1, 2, 3].map((index) => `${prefix}_s${index}`);
  const pathId = `${prefix}_path`;
  return {
    vertices: [
      { id: vertexIds[0]!, x: 0, y: 0 },
      { id: vertexIds[1]!, x: width, y: 0 },
      { id: vertexIds[2]!, x: width, y: height },
      { id: vertexIds[3]!, x: 0, y: height },
    ],
    segments: segmentIds.map((id, index) => ({
      id,
      startVertexId: vertexIds[index]!,
      endVertexId: vertexIds[(index + 1) % vertexIds.length]!,
    })),
    paths: [
      {
        id: pathId,
        closed: true,
        segments: segmentIds.map((segmentId) => ({
          segmentId,
          reversed: false,
        })),
      },
    ],
    regions: [
      {
        id: `${prefix}_region`,
        windingRule: "nonzero",
        fills: [{ type: "image", assetId, fit: "fill", opacity: 1 }],
        loops: [{ pathId, reversed: false }],
      },
    ],
  };
}
