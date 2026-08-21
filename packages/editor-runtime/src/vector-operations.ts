import type {
  DesignDocument,
  DesignOperation,
  Point,
  Transform,
  VectorNetwork,
  VectorPointMode,
} from "@opendesign/design-contracts";
import {
  connectVectorEndpoints,
  cutVectorNetworkByLine,
  cutVectorPath,
  disconnectVectorVertex,
  findVectorPathIdForVertex,
  inferVectorPointMode,
  reverseVectorPath,
  setVectorPathClosed,
  transformVectorVertices,
  vectorNetworkEditability,
  type VectorCutLocation,
} from "@opendesign/geometry-service/vector-edit";
import { normalizeVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import {
  getWorldTransform,
  invertTransform,
  multiplyTransforms,
  transformPoint,
} from "./geometry.js";
import { isEffectivelyLocked } from "./layer-operations.js";

export type VectorOperationFailureCode =
  | "invalid-geometry"
  | "locked"
  | "non-invertible"
  | "no-op"
  | "not-found"
  | "unsupported-topology";

export type VectorSemanticEdit =
  | { action: "set-closed"; closed: boolean; pathId?: string }
  | { action: "reverse-path"; pathId?: string }
  | {
      action: "connect-endpoints";
      vertexIds: readonly [string, string];
    }
  | {
      action: "disconnect-vertex";
      pathId: string;
      vertexId: string;
    }
  | {
      action: "transform-vertices";
      transform: Transform;
      vertexIds: readonly string[];
    }
  | {
      action: "cut-path";
      at: VectorCutLocation;
      pathId: string;
    }
  | {
      action: "cut-with-line";
      end: Point;
      resultNodeId: string;
      start: Point;
    };

export interface VectorEditScope {
  activePathId?: string;
  nodeId: string;
  pathCount: number;
  pointMode?: VectorPointMode;
  readOnly: boolean;
  readOnlyReason?: string;
  selectedSegmentIds: readonly string[];
  selectedVertexIds: readonly string[];
}

export interface VectorEditCollectionScope {
  activeNodeId: string;
  nodeIds: readonly string[];
  nodes: readonly VectorEditScope[];
}

export interface VectorLayerLineCutTarget {
  nodeId: string;
  resultNodeId: string;
}

export interface VectorNetworkUpdateTarget {
  network: VectorNetwork;
  nodeId: string;
}

export interface VectorLayerVertexTransformTarget {
  nodeId: string;
  vertexIds: readonly string[];
}

export type VectorOperationPlan =
  | {
      ok: true;
      operations: readonly DesignOperation[];
      cutResult?: {
        cutVertexIds: readonly [string, string];
        pathIds: readonly string[];
      };
      lineCutResult?: {
        extractedPathIds: readonly string[];
        intersectionCount: number;
        resultNodeIds: readonly [string, string];
        retainedPathIds: readonly string[];
      };
      layerLineCutResult?: {
        resultNodeIds: readonly string[];
        targets: readonly {
          extractedPathIds: readonly string[];
          intersectionCount: number;
          nodeId: string;
          resultNodeId: string;
          retainedPathIds: readonly string[];
        }[];
      };
    }
  | {
      ok: false;
      code: VectorOperationFailureCode;
      message: string;
    };

export function resolveVectorEditScope(
  document: DesignDocument,
  pageId: string,
  selectionNodeIds: readonly string[],
  editNodeId: string | null,
  selectedVertexIds: readonly string[],
  selectedSegmentIds: readonly string[] = [],
): VectorEditScope | null {
  if (
    !editNodeId ||
    selectionNodeIds.length !== 1 ||
    selectionNodeIds[0] !== editNodeId
  ) {
    return null;
  }
  return resolveVectorNodeEditScope(
    document,
    pageId,
    editNodeId,
    selectedVertexIds,
    selectedSegmentIds,
  );
}

export function resolveVectorEditCollectionScope(
  document: DesignDocument,
  pageId: string,
  selectionNodeIds: readonly string[],
  editNodeIds: readonly string[],
  activeNodeId: string | null,
  selectedVertexIdsByNode: Readonly<Record<string, readonly string[]>>,
  selectedSegmentIdsByNode: Readonly<Record<string, readonly string[]>> = {},
): VectorEditCollectionScope | null {
  if (
    editNodeIds.length === 0 ||
    new Set(editNodeIds).size !== editNodeIds.length ||
    selectionNodeIds.length !== editNodeIds.length ||
    !sameStringList(selectionNodeIds, editNodeIds) ||
    !activeNodeId ||
    !editNodeIds.includes(activeNodeId)
  ) {
    return null;
  }
  const nodes = editNodeIds.map((nodeId) =>
    resolveVectorNodeEditScope(
      document,
      pageId,
      nodeId,
      selectedVertexIdsByNode[nodeId] ?? [],
      selectedSegmentIdsByNode[nodeId] ?? [],
    ),
  );
  if (nodes.some((scope) => scope === null)) return null;
  return {
    activeNodeId,
    nodeIds: [...editNodeIds],
    nodes: nodes as VectorEditScope[],
  };
}

function resolveVectorNodeEditScope(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  selectedVertexIds: readonly string[],
  selectedSegmentIds: readonly string[],
): VectorEditScope | null {
  const node = document.nodesById[nodeId];
  if (
    !node ||
    (node.kind !== "path" && node.kind !== "vector") ||
    !("network" in node.properties) ||
    !nodeBelongsToPage(document, pageId, node.id)
  ) {
    return null;
  }
  const network = node.properties.network;
  const vertices = new Set(network.vertices.map((vertex) => vertex.id));
  const selected = [...new Set(selectedVertexIds)].filter((vertexId) =>
    vertices.has(vertexId),
  );
  const segments = new Set(network.segments.map((segment) => segment.id));
  const selectedSegments = [...new Set(selectedSegmentIds)].filter(
    (segmentId) => segments.has(segmentId),
  );
  const editability = vectorNetworkEditability(network);
  const locked = isEffectivelyLocked(document, node.id);
  const modes = new Set(
    selected.map((vertexId) => inferVectorPointMode(network, vertexId)),
  );
  const selectedPathIds = new Set([
    ...selected.flatMap((vertexId) => {
      const pathId = findVectorPathIdForVertex(network, vertexId);
      return pathId ? [pathId] : [];
    }),
    ...selectedSegments.flatMap((segmentId) => {
      const pathId = network.paths.find((path) =>
        path.segments.some((reference) => reference.segmentId === segmentId),
      )?.id;
      return pathId ? [pathId] : [];
    }),
  ]);
  const activePathId =
    selectedPathIds.size === 1
      ? [...selectedPathIds][0]
      : selectedPathIds.size === 0 && network.paths.length === 1
        ? network.paths[0]?.id
        : undefined;
  const readOnly = locked || !editability.editable;
  const readOnlyReason = locked
    ? "The vector or one of its ancestors is locked"
    : editability.editable
      ? null
      : editability.reason;
  return {
    ...(activePathId ? { activePathId } : {}),
    nodeId: node.id,
    pathCount: network.paths.length,
    ...(selected.length > 0 && modes.size === 1
      ? { pointMode: [...modes][0]! }
      : {}),
    readOnly,
    ...(readOnlyReason ? { readOnlyReason } : {}),
    selectedSegmentIds: selectedSegments,
    selectedVertexIds: selected,
  };
}

function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function planVectorNetworkUpdate(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  network: VectorNetwork,
): VectorOperationPlan {
  const node = document.nodesById[nodeId];
  if (
    !node ||
    (node.kind !== "path" && node.kind !== "vector") ||
    !("network" in node.properties) ||
    !nodeBelongsToPage(document, pageId, node.id)
  ) {
    return {
      ok: false,
      code: "not-found",
      message: `Editable vector ${nodeId} does not exist on page ${pageId}`,
    };
  }
  if (isEffectivelyLocked(document, node.id)) {
    return {
      ok: false,
      code: "locked",
      message: `Editable vector ${nodeId} is locked`,
    };
  }
  const editability = vectorNetworkEditability(network);
  if (!editability.editable) {
    return {
      ok: false,
      code: "unsupported-topology",
      message: editability.reason,
    };
  }
  const normalized = normalizeVectorNetwork(network);
  if (!normalized.ok || !normalized.offset) {
    return {
      ok: false,
      code: "invalid-geometry",
      message: normalized.ok
        ? "Vector geometry could not be normalized"
        : normalized.issues.map((issue) => issue.message).join("; "),
    };
  }
  return {
    ok: true,
    operations: [
      {
        commandId: `edit_vector_${node.id}`,
        type: "update_properties",
        nodeId: node.id,
        transform: translateLocalTransform(node.transform, normalized.offset),
        size: {
          width: normalized.bounds.width,
          height: normalized.bounds.height,
        },
        properties: {
          ...structuredClone(node.properties),
          network: normalized.network,
        },
      },
    ],
  };
}

/**
 * Plans multiple editable-network updates against one authoritative document.
 * Validation is all-or-nothing and the caller applies the returned operations
 * as one EditorRuntime transaction/revision/undo step.
 */
export function planVectorNetworkUpdates(
  document: DesignDocument,
  pageId: string,
  targets: readonly VectorNetworkUpdateTarget[],
): VectorOperationPlan {
  if (targets.length === 0 || targets.length > 500) {
    return {
      ok: false,
      code: "invalid-geometry",
      message: "Vector network updates require between 1 and 500 targets",
    };
  }
  const nodeIds = new Set<string>();
  const operations: DesignOperation[] = [];
  for (const target of targets) {
    if (!target.nodeId || nodeIds.has(target.nodeId)) {
      return {
        ok: false,
        code: "invalid-geometry",
        message: "Vector network updates require unique target node IDs",
      };
    }
    nodeIds.add(target.nodeId);
    const plan = planVectorNetworkUpdate(
      document,
      pageId,
      target.nodeId,
      target.network,
    );
    if (!plan.ok) return plan;
    operations.push(...plan.operations);
  }
  return { ok: true, operations };
}

/**
 * Applies one document-space affine matrix to explicit vertices across Vector
 * layers. Every layer is conjugated through its current world transform before
 * Geometry Service edits its node-local network.
 */
export function planVectorLayersVertexTransform(
  document: DesignDocument,
  pageId: string,
  targets: readonly VectorLayerVertexTransformTarget[],
  transform: Transform,
): VectorOperationPlan {
  if (
    targets.length === 0 ||
    targets.length > 500 ||
    transform.length !== 6 ||
    !transform.every(Number.isFinite)
  ) {
    return {
      ok: false,
      code: "invalid-geometry",
      message:
        "Vector layer transform requires 1..500 targets and one finite document-space affine matrix",
    };
  }
  const nodeIds = new Set<string>();
  const updates: VectorNetworkUpdateTarget[] = [];
  for (const target of targets) {
    if (
      !target.nodeId ||
      nodeIds.has(target.nodeId) ||
      target.vertexIds.length === 0 ||
      new Set(target.vertexIds).size !== target.vertexIds.length
    ) {
      return {
        ok: false,
        code: "invalid-geometry",
        message:
          "Vector layer transform requires unique nodes and explicit unique vertex IDs",
      };
    }
    nodeIds.add(target.nodeId);
    const node = document.nodesById[target.nodeId];
    if (
      !node ||
      (node.kind !== "path" && node.kind !== "vector") ||
      !("network" in node.properties) ||
      !nodeBelongsToPage(document, pageId, target.nodeId)
    ) {
      return {
        ok: false,
        code: "not-found",
        message: `Editable vector ${target.nodeId} does not exist on page ${pageId}`,
      };
    }
    const world = getWorldTransform(document, target.nodeId);
    const inverse = world ? invertTransform(world) : null;
    if (!world || !inverse) {
      return {
        ok: false,
        code: "non-invertible",
        message: `Vector layer ${target.nodeId} has a non-invertible world transform`,
      };
    }
    const localTransform = multiplyTransforms(
      inverse,
      multiplyTransforms(transform, world),
    );
    const transformed = transformVectorVertices(
      node.properties.network,
      target.vertexIds,
      localTransform,
    );
    if (!transformed.ok) {
      if (transformed.code === "no-op") continue;
      return vectorOperationFailure(transformed);
    }
    updates.push({ nodeId: target.nodeId, network: transformed.network });
  }
  if (updates.length === 0) {
    return {
      ok: false,
      code: "no-op",
      message: "Vector layer transform does not move any targeted vertex",
    };
  }
  return planVectorNetworkUpdates(document, pageId, updates);
}

export function planVectorSemanticEdit(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  edit: VectorSemanticEdit,
): VectorOperationPlan {
  const node = document.nodesById[nodeId];
  if (
    !node ||
    (node.kind !== "path" && node.kind !== "vector") ||
    !("network" in node.properties) ||
    !nodeBelongsToPage(document, pageId, node.id)
  ) {
    return {
      ok: false,
      code: "not-found",
      message: `Editable vector ${nodeId} does not exist on page ${pageId}`,
    };
  }
  if (isEffectivelyLocked(document, node.id)) {
    return {
      ok: false,
      code: "locked",
      message: `Editable vector ${nodeId} is locked`,
    };
  }
  if (edit.action === "cut-with-line") {
    return planVectorLineCut(document, pageId, nodeId, edit);
  }
  if (edit.action === "cut-path" || edit.action === "disconnect-vertex") {
    const cut =
      edit.action === "cut-path"
        ? cutVectorPath(node.properties.network, edit.pathId, edit.at)
        : disconnectVectorVertex(
            node.properties.network,
            edit.pathId,
            edit.vertexId,
          );
    if (!cut.ok) return vectorOperationFailure(cut);
    const plan = planVectorNetworkUpdate(document, pageId, nodeId, cut.network);
    if (!plan.ok) return plan;
    return {
      ...plan,
      cutResult: {
        cutVertexIds: cut.cutVertexIds,
        pathIds: cut.pathIds,
      },
    };
  }
  if (edit.action === "connect-endpoints") {
    const connected = connectVectorEndpoints(
      node.properties.network,
      edit.vertexIds,
    );
    if (!connected.ok) return vectorOperationFailure(connected);
    return planVectorNetworkUpdate(document, pageId, nodeId, connected.network);
  }
  if (edit.action === "transform-vertices") {
    const transformed = transformVectorVertices(
      node.properties.network,
      edit.vertexIds,
      edit.transform,
    );
    if (!transformed.ok) return vectorOperationFailure(transformed);
    return planVectorNetworkUpdate(
      document,
      pageId,
      nodeId,
      transformed.network,
    );
  }
  const edited =
    edit.action === "set-closed"
      ? setVectorPathClosed(node.properties.network, edit.closed, edit.pathId)
      : reverseVectorPath(node.properties.network, edit.pathId);
  if (!edited.ok) {
    return vectorOperationFailure(edited);
  }
  return planVectorNetworkUpdate(document, pageId, nodeId, edited.network);
}

/**
 * Divides every explicitly targeted Vector layer crossed by one finite line in
 * document coordinates. Per-layer geometry remains node-local; the trusted
 * host owns transform inversion, result IDs, sibling insertion order and the
 * one atomic transaction returned to human and Agent callers.
 */
export function planVectorLayersLineCut(
  document: DesignDocument,
  pageId: string,
  targets: readonly VectorLayerLineCutTarget[],
  start: Point,
  end: Point,
): VectorOperationPlan {
  if (targets.length === 0 || targets.length > 500) {
    return {
      ok: false,
      code: "invalid-geometry",
      message: "Vector layer Cut requires between 1 and 500 explicit targets",
    };
  }
  const nodeIds = new Set<string>();
  const resultNodeIds = new Set<string>();
  for (const target of targets) {
    if (
      !target.nodeId ||
      !target.resultNodeId ||
      nodeIds.has(target.nodeId) ||
      resultNodeIds.has(target.resultNodeId)
    ) {
      return {
        ok: false,
        code: "invalid-geometry",
        message: "Vector layer Cut requires unique source and result node IDs",
      };
    }
    nodeIds.add(target.nodeId);
    resultNodeIds.add(target.resultNodeId);
  }

  const affected: Array<{
    index: number;
    operations: readonly DesignOperation[];
    parentKey: string;
    result: NonNullable<
      Extract<VectorOperationPlan, { ok: true }>["lineCutResult"]
    >;
    sourceIndex: number;
    target: VectorLayerLineCutTarget;
  }> = [];
  for (const [index, target] of targets.entries()) {
    const node = document.nodesById[target.nodeId];
    if (
      !node ||
      (node.kind !== "path" && node.kind !== "vector") ||
      !("network" in node.properties) ||
      !nodeBelongsToPage(document, pageId, target.nodeId)
    ) {
      return {
        ok: false,
        code: "not-found",
        message: `Editable vector ${target.nodeId} does not exist on page ${pageId}`,
      };
    }
    const world = getWorldTransform(document, target.nodeId);
    const inverse = world ? invertTransform(world) : null;
    if (!inverse) {
      return {
        ok: false,
        code: "non-invertible",
        message: `Vector layer ${target.nodeId} has a non-invertible world transform`,
      };
    }
    const plan = planVectorSemanticEdit(document, pageId, target.nodeId, {
      action: "cut-with-line",
      start: transformPoint(start, inverse),
      end: transformPoint(end, inverse),
      resultNodeId: target.resultNodeId,
    });
    if (!plan.ok) {
      if (plan.code === "no-op") continue;
      return plan;
    }
    if (!plan.lineCutResult) {
      return {
        ok: false,
        code: "invalid-geometry",
        message: `Vector layer ${target.nodeId} did not produce a line Cut result`,
      };
    }
    const insertion = plan.operations.find(
      (operation) =>
        operation.type === "insert_element" &&
        operation.node.id === target.resultNodeId,
    );
    if (!insertion || insertion.type !== "insert_element") {
      return {
        ok: false,
        code: "invalid-geometry",
        message: `Vector layer ${target.nodeId} did not produce a sibling insertion`,
      };
    }
    affected.push({
      index,
      operations: plan.operations,
      parentKey: insertion.parentId ?? `page:${insertion.pageId}`,
      result: plan.lineCutResult,
      sourceIndex: insertion.index - 1,
      target,
    });
  }
  if (affected.length === 0) {
    return {
      ok: false,
      code: "no-op",
      message: "Vector layer Cut does not cross any targeted layer",
    };
  }

  const parentOrder: string[] = [];
  const byParent = new Map<string, typeof affected>();
  for (const entry of affected) {
    let entries = byParent.get(entry.parentKey);
    if (!entries) {
      entries = [];
      byParent.set(entry.parentKey, entries);
      parentOrder.push(entry.parentKey);
    }
    entries.push(entry);
  }
  const operations = parentOrder.flatMap((parentKey) =>
    [...(byParent.get(parentKey) ?? [])]
      .sort(
        (left, right) =>
          right.sourceIndex - left.sourceIndex || left.index - right.index,
      )
      .flatMap((entry) => entry.operations),
  );
  const orderedResults = [...affected].sort(
    (left, right) => left.index - right.index,
  );
  return {
    ok: true,
    operations,
    layerLineCutResult: {
      resultNodeIds: orderedResults.flatMap((entry) => [
        entry.target.nodeId,
        entry.target.resultNodeId,
      ]),
      targets: orderedResults.map((entry) => ({
        extractedPathIds: entry.result.extractedPathIds,
        intersectionCount: entry.result.intersectionCount,
        nodeId: entry.target.nodeId,
        resultNodeId: entry.target.resultNodeId,
        retainedPathIds: entry.result.retainedPathIds,
      })),
    },
  };
}

function planVectorLineCut(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  edit: Extract<VectorSemanticEdit, { action: "cut-with-line" }>,
): VectorOperationPlan {
  const node = document.nodesById[nodeId];
  if (
    !node ||
    (node.kind !== "path" && node.kind !== "vector") ||
    !("network" in node.properties)
  ) {
    return {
      ok: false,
      code: "not-found",
      message: `Editable vector ${nodeId} does not exist on page ${pageId}`,
    };
  }
  if (!edit.resultNodeId || document.nodesById[edit.resultNodeId]) {
    return {
      ok: false,
      code: "invalid-geometry",
      message: `Vector Cut result node ID ${edit.resultNodeId || "(empty)"} is unavailable`,
    };
  }
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  if (parent?.kind === "boolean") {
    return {
      ok: false,
      code: "unsupported-topology",
      message: "Dividing a Boolean operand requires leaving Boolean edit scope",
    };
  }
  const siblings = node.parentId
    ? parent?.kind === "frame" ||
      parent?.kind === "slot" ||
      parent?.kind === "group"
      ? parent.childIds
      : undefined
    : document.pagesById[pageId]?.rootNodeIds;
  const sourceIndex = siblings?.indexOf(node.id) ?? -1;
  if (!siblings || sourceIndex < 0) {
    return {
      ok: false,
      code: "not-found",
      message: `Editable vector ${nodeId} has no valid insertion parent on page ${pageId}`,
    };
  }
  const divided = cutVectorNetworkByLine(
    node.properties.network,
    edit.start,
    edit.end,
  );
  if (!divided.ok) return vectorOperationFailure(divided);
  const retained = normalizeVectorNetwork(divided.retainedNetwork);
  const extracted = normalizeVectorNetwork(divided.extractedNetwork);
  if (!retained.ok || !retained.offset || !extracted.ok || !extracted.offset) {
    const issues = [
      ...(retained.ok ? [] : retained.issues),
      ...(extracted.ok ? [] : extracted.issues),
    ];
    return {
      ok: false,
      code: "invalid-geometry",
      message:
        issues.length > 0
          ? issues.map((issue) => issue.message).join("; ")
          : "Vector line Cut results could not be normalized",
    };
  }
  const inserted = structuredClone(node);
  inserted.id = edit.resultNodeId;
  inserted.name = `${node.name || "Vector"} Cut`;
  inserted.transform = translateLocalTransform(
    node.transform,
    extracted.offset,
  );
  inserted.size = {
    width: extracted.bounds.width,
    height: extracted.bounds.height,
  };
  inserted.properties = {
    ...structuredClone(node.properties),
    network: extracted.network,
  };
  return {
    ok: true,
    operations: [
      {
        commandId: `divide_vector_${node.id}`,
        type: "update_properties",
        nodeId: node.id,
        transform: translateLocalTransform(node.transform, retained.offset),
        size: {
          width: retained.bounds.width,
          height: retained.bounds.height,
        },
        properties: {
          ...structuredClone(node.properties),
          network: retained.network,
        },
      },
      {
        commandId: `insert_vector_cut_${edit.resultNodeId}`,
        type: "insert_element",
        pageId,
        parentId: node.parentId,
        index: sourceIndex + 1,
        node: inserted,
      },
    ],
    lineCutResult: {
      extractedPathIds: divided.extractedPathIds,
      intersectionCount: divided.intersections.length,
      resultNodeIds: [node.id, inserted.id],
      retainedPathIds: divided.retainedPathIds,
    },
  };
}

function vectorOperationFailure(failure: {
  code:
    | "invalid-network"
    | "missing-handle"
    | "missing-path"
    | "missing-segment"
    | "missing-vertex"
    | "no-op"
    | "unsupported-topology";
  message: string;
}): Extract<VectorOperationPlan, { ok: false }> {
  return {
    ok: false,
    code:
      failure.code === "no-op"
        ? "no-op"
        : failure.code === "unsupported-topology"
          ? "unsupported-topology"
          : failure.code === "missing-path" ||
              failure.code === "missing-segment" ||
              failure.code === "missing-vertex"
            ? "not-found"
            : "invalid-geometry",
    message: failure.message,
  };
}

export function planDeleteVectorNode(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): VectorOperationPlan {
  const node = document.nodesById[nodeId];
  if (
    !node ||
    (node.kind !== "path" && node.kind !== "vector") ||
    !("network" in node.properties) ||
    !nodeBelongsToPage(document, pageId, node.id)
  ) {
    return {
      ok: false,
      code: "not-found",
      message: `Editable vector ${nodeId} does not exist on page ${pageId}`,
    };
  }
  if (isEffectivelyLocked(document, node.id)) {
    return {
      ok: false,
      code: "locked",
      message: `Editable vector ${nodeId} is locked`,
    };
  }
  return {
    ok: true,
    operations: [
      {
        commandId: `delete_vector_${node.id}`,
        type: "delete_element",
        nodeId: node.id,
      },
    ],
  };
}

function translateLocalTransform(
  transform: Transform,
  offset: { x: number; y: number },
): Transform {
  const [a, b, c, d, e, f] = transform;
  return [
    a,
    b,
    c,
    d,
    normalizeNumber(e + a * offset.x + c * offset.y),
    normalizeNumber(f + b * offset.x + d * offset.y),
  ];
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const roots = new Set(document.pagesById[pageId]?.rootNodeIds ?? []);
  let currentId: string | undefined = nodeId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    if (roots.has(currentId)) return true;
    visited.add(currentId);
    currentId = document.nodesById[currentId]?.parentId ?? undefined;
  }
  return false;
}

function normalizeNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
