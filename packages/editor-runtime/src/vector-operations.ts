import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  Paint,
  Point,
  Transform,
  VectorNetwork,
  VectorNetworkProperties,
  VectorPointMode,
  VariableWidthStrokeProperties,
} from "@opendesign/design-contracts";
import {
  bendVectorSegment,
  connectVectorEndpoints,
  cutVectorNetworkByLine,
  cutVectorPath,
  deleteVectorSegments,
  deleteVectorVertices,
  disconnectVectorVertex,
  findVectorPathIdForVertex,
  inferVectorPointMode,
  reverseVectorPath,
  setVectorRegionFillStyle,
  setVectorRegionFills,
  setVectorVertexCornerRadius,
  setVectorVertexStrokeAppearance,
  setVectorPathClosed,
  transformVectorVertices,
  vectorNetworkEditability,
  vectorNetworkPointEditability,
  type VectorCutLocation,
  type VectorVertexStrokeAppearancePatch,
} from "@opendesign/geometry-service/vector-edit";
import {
  normalizeVectorNetwork,
  resolvePathPropertiesData,
} from "@opendesign/geometry-service/editable-vector";
import {
  outlineVectorNetworkStroke,
  outlineVectorPath,
} from "@opendesign/geometry-service/vector-materialization";
import { type VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import { splitVectorNetwork } from "@opendesign/geometry-service/vector-split";
import { styleDefinition } from "@opendesign/style-service";
import {
  getWorldTransform,
  invertTransform,
  multiplyTransforms,
  transformPoint,
} from "./geometry.js";
import { isEffectivelyLocked } from "./layer-operations.js";

export type VectorOperationFailureCode =
  | "conflict"
  | "invalid-geometry"
  | "invalid-selection"
  | "locked"
  | "mixed-parent"
  | "non-invertible"
  | "no-op"
  | "not-found"
  | "operation-limit"
  | "requires-raster-compositing"
  | "unsupported-topology";

export type VectorSemanticEdit =
  | { action: "set-closed"; closed: boolean; pathId?: string }
  | {
      action: "set-variable-width";
      variableWidthStrokeProperties: VariableWidthStrokeProperties;
    }
  | { action: "reverse-path"; pathId?: string }
  | {
      action: "bend-segment";
      pathId: string;
      point: Point;
      segmentId: string;
      t: number;
    }
  | {
      action: "set-region-fills";
      fills: readonly Paint[];
      regionId: string;
    }
  | {
      action: "set-region-fill-style";
      fillStyleId: string;
      regionId: string;
    }
  | ({
      action: "set-vertex-stroke-appearance";
      vertexIds: readonly string[];
    } & VectorVertexStrokeAppearancePatch)
  | {
      action: "set-vertex-corner-radius";
      cornerRadius: number | null;
      vertexIds: readonly string[];
    }
  | {
      action: "connect-endpoints";
      vertexIds: readonly [string, string];
    }
  | {
      action: "disconnect-vertex";
      pathId: string;
      segmentId?: string;
      vertexId: string;
    }
  | {
      action: "delete-segments";
      segmentIds: readonly string[];
    }
  | {
      action: "delete-vertices";
      vertexIds: readonly string[];
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
  topologyEditable: boolean;
  variableWidthEditable: boolean;
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

export interface VectorLayerEndpointTarget {
  nodeId: string;
  vertexId: string;
}

export interface VectorNetworkUpdateTarget {
  network: VectorNetwork;
  nodeId: string;
  variableWidthStrokeProperties?: VariableWidthStrokeProperties;
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
      layerConnectResult?: {
        removedNodeId: string;
        retainedNodeId: string;
      };
      outlineResult?: {
        resultNodeId: string;
        sourceNodeId: string;
      };
      flattenResult?: {
        resultNodeId: string;
        sourceNodeIds: readonly string[];
      };
      splitResult?: {
        pathIds: readonly string[];
        resultNodeIds: readonly string[];
      };
      eraserResult?: {
        deletedNodeIds: readonly string[];
        remainingNodeIds: readonly string[];
      };
      shapeBuilderResult?: {
        selectionNodeIds: readonly string[];
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
  const pointEditability = vectorNetworkPointEditability(network);
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
  const readOnly = locked || !pointEditability.editable;
  const readOnlyReason = locked
    ? "The vector or one of its ancestors is locked"
    : pointEditability.editable
      ? null
      : pointEditability.reason;
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
    topologyEditable: editability.editable,
    variableWidthEditable:
      editability.editable &&
      (node.properties.dashPattern?.length ?? 0) === 0 &&
      node.properties.strokeWidth > 0,
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
  return planVectorNetworkTargetUpdate(document, pageId, {
    network,
    nodeId,
  });
}

function planVectorNetworkTargetUpdate(
  document: DesignDocument,
  pageId: string,
  target: VectorNetworkUpdateTarget,
): VectorOperationPlan {
  const { network, nodeId } = target;
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
  const editability = vectorNetworkPointEditability(network);
  if (!editability.editable) {
    return {
      ok: false,
      code: "unsupported-topology",
      message: editability.reason,
    };
  }
  const normalized = normalizeVectorNetwork(
    network,
    node.properties.cornerRadius ?? 0,
    node.properties.cornerSmoothing ?? 0,
  );
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
          ...(target.variableWidthStrokeProperties === undefined
            ? {}
            : {
                variableWidthStrokeProperties: structuredClone(
                  target.variableWidthStrokeProperties,
                ),
              }),
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
    const plan = planVectorNetworkTargetUpdate(document, pageId, target);
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

/**
 * Joins endpoints from two sibling Vector layers into the earlier layer.
 * The appended network is transformed into the retained node's local space,
 * remapped to collision-free geometry IDs, and removed in the same revision.
 */
export function planVectorLayersEndpointConnect(
  document: DesignDocument,
  pageId: string,
  targets: readonly [VectorLayerEndpointTarget, VectorLayerEndpointTarget],
): VectorOperationPlan {
  const [firstTarget, secondTarget] = targets;
  if (firstTarget.nodeId === secondTarget.nodeId) {
    return planVectorSemanticEdit(document, pageId, firstTarget.nodeId, {
      action: "connect-endpoints",
      vertexIds: [firstTarget.vertexId, secondTarget.vertexId],
    });
  }
  const ordered = resolveLayerConnectTargets(document, pageId, targets);
  if (!ordered.ok) return ordered;
  const appended = projectAppendedNetwork(document, ordered.value);
  if (!appended.ok) return appended;
  const connected = connectVectorEndpoints(
    mergeAuthoredVectorNetworks(
      ordered.value.retained.properties.network,
      appended.network,
    ),
    [ordered.value.retainedVertexId, appended.vertexId],
  );
  if (!connected.ok) return vectorOperationFailure(connected);
  const update = planVectorNetworkUpdate(
    document,
    pageId,
    ordered.value.retained.id,
    connected.network,
  );
  if (!update.ok) return update;
  return {
    ok: true,
    layerConnectResult: {
      removedNodeId: ordered.value.appended.id,
      retainedNodeId: ordered.value.retained.id,
    },
    operations: [
      ...update.operations,
      {
        commandId: `delete_joined_vector_${ordered.value.appended.id}`,
        type: "delete_element",
        nodeId: ordered.value.appended.id,
      },
    ],
  };
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
  if (edit.action === "set-variable-width") {
    return planVectorNetworkTargetUpdate(document, pageId, {
      network: node.properties.network,
      nodeId,
      variableWidthStrokeProperties: edit.variableWidthStrokeProperties,
    });
  }
  if (edit.action === "cut-path" || edit.action === "disconnect-vertex") {
    const cut =
      edit.action === "cut-path"
        ? cutVectorPath(node.properties.network, edit.pathId, edit.at)
        : disconnectVectorVertex(
            node.properties.network,
            edit.pathId,
            edit.vertexId,
            edit.segmentId,
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
  if (edit.action === "delete-segments") {
    const deleted = deleteVectorSegments(
      node.properties.network,
      edit.segmentIds,
    );
    if (!deleted.ok) return vectorOperationFailure(deleted);
    if (deleted.deleteNode)
      return planDeleteVectorNode(document, pageId, nodeId);
    return planVectorNetworkUpdate(document, pageId, nodeId, deleted.network);
  }
  if (edit.action === "delete-vertices") {
    const deleted = deleteVectorVertices(
      node.properties.network,
      edit.vertexIds,
    );
    if (!deleted.ok) return vectorOperationFailure(deleted);
    if (deleted.deleteNode)
      return planDeleteVectorNode(document, pageId, nodeId);
    return planVectorNetworkUpdate(document, pageId, nodeId, deleted.network);
  }
  if (edit.action === "bend-segment") {
    const bent = bendVectorSegment(
      node.properties.network,
      edit.pathId,
      edit.segmentId,
      edit.t,
      edit.point,
    );
    if (!bent.ok) return vectorOperationFailure(bent);
    return planVectorNetworkUpdate(document, pageId, nodeId, bent.network);
  }
  if (edit.action === "set-region-fills") {
    const painted = setVectorRegionFills(
      node.properties.network,
      edit.regionId,
      edit.fills,
    );
    if (!painted.ok) return vectorOperationFailure(painted);
    return planVectorNetworkUpdate(document, pageId, nodeId, painted.network);
  }
  if (edit.action === "set-region-fill-style") {
    const style = styleDefinition(document, edit.fillStyleId);
    if (!style) {
      return vectorPlanFailure(
        "not-found",
        `Fill Style ${edit.fillStyleId} does not exist`,
      );
    }
    if (style.styleType !== "PAINT") {
      return vectorPlanFailure(
        "unsupported-topology",
        `Vector region Fill requires a PAINT Style, received ${style.styleType}`,
      );
    }
    const linked = setVectorRegionFillStyle(
      node.properties.network,
      edit.regionId,
      edit.fillStyleId,
    );
    if (!linked.ok) return vectorOperationFailure(linked);
    return planVectorNetworkUpdate(document, pageId, nodeId, linked.network);
  }
  if (edit.action === "set-vertex-stroke-appearance") {
    const updated = setVectorVertexStrokeAppearance(
      node.properties.network,
      edit.vertexIds,
      edit,
    );
    if (!updated.ok) return vectorOperationFailure(updated);
    return planVectorNetworkUpdate(document, pageId, nodeId, updated.network);
  }
  if (edit.action === "set-vertex-corner-radius") {
    const updated = setVectorVertexCornerRadius(
      node.properties.network,
      edit.vertexIds,
      edit.cornerRadius,
    );
    if (!updated.ok) return vectorOperationFailure(updated);
    return planVectorNetworkUpdate(document, pageId, nodeId, updated.network);
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

/** Splits one multi-path Vector into sibling layers in authored path order. */
export function planSplitVector(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  resultNodeIds: readonly string[],
): VectorOperationPlan {
  const target = editableVectorTarget(document, pageId, nodeId);
  if (!target.ok) return target;
  const split = splitVectorNetwork(target.node.properties.network);
  if (!split.ok) return vectorOperationFailure(split);
  const resultIds = [nodeId, ...resultNodeIds];
  const ids = new Set(resultIds);
  if (
    resultNodeIds.length !== split.networks.length - 1 ||
    ids.size !== resultIds.length ||
    resultNodeIds.some((id) => !id || document.nodesById[id])
  ) {
    return vectorPlanFailure(
      "invalid-geometry",
      `Split vector requires ${split.networks.length - 1} unique available result node IDs`,
    );
  }
  const insertion = vectorSiblingInsertion(
    document,
    pageId,
    target.node,
    "Splitting",
  );
  if (!insertion.ok) return insertion;
  const normalized = normalizeSplitNetworks(target.node, split.networks);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    operations: splitVectorOperations(
      pageId,
      target.node,
      resultIds,
      normalized.parts,
      insertion.index,
    ),
    splitResult: { pathIds: split.pathIds, resultNodeIds: resultIds },
  };
}

/** Creates a Figma-compatible editable Vector sibling while preserving source. */
export function planVectorOutlineStroke(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  resultNodeId: string,
  geometryIdPrefix: string,
  provider: VectorGeometryProvider,
): VectorOperationPlan {
  const node = document.nodesById[nodeId];
  if (!isEditablePathNode(document, pageId, nodeId)) {
    return vectorPlanFailure(
      "not-found",
      `Editable vector ${nodeId} does not exist on page ${pageId}`,
    );
  }
  if (isEffectivelyLocked(document, nodeId)) {
    return vectorPlanFailure("locked", `Editable vector ${nodeId} is locked`);
  }
  if (!node || (node.kind !== "path" && node.kind !== "vector")) {
    return vectorPlanFailure(
      "not-found",
      `Editable vector ${nodeId} is unavailable`,
    );
  }
  if (!resultNodeId || document.nodesById[resultNodeId]) {
    return vectorPlanFailure(
      "invalid-geometry",
      `Outline result node ID ${resultNodeId || "(empty)"} is unavailable`,
    );
  }
  const insertion = vectorSiblingInsertion(document, pageId, node);
  if (!insertion.ok) return insertion;
  const sourcePath = resolvePathPropertiesData(node.properties);
  const visibleStrokes = node.properties.strokes.filter(
    (paint) => paint.visible !== false,
  );
  if (
    !sourcePath ||
    node.properties.strokeWidth <= 0 ||
    visibleStrokes.length === 0
  ) {
    return vectorPlanFailure(
      "no-op",
      `Editable vector ${nodeId} has no visible stroke to outline`,
    );
  }
  const cornerRadius =
    "network" in node.properties ? node.properties.cornerRadius : undefined;
  const cornerSmoothing =
    "network" in node.properties ? node.properties.cornerSmoothing : undefined;
  const outlineOptions = {
    align: node.properties.strokeAlign ?? "center",
    cap:
      node.properties.strokeCap === "round" ||
      node.properties.strokeCap === "square"
        ? node.properties.strokeCap
        : "butt",
    ...(cornerRadius === undefined ? {} : { cornerRadius }),
    ...(cornerSmoothing === undefined ? {} : { cornerSmoothing }),
    ...(node.properties.dashPattern === undefined
      ? {}
      : { dashPattern: node.properties.dashPattern }),
    ...(!("network" in node.properties) ||
    node.properties.variableWidthStrokeProperties === undefined
      ? {}
      : {
          variableWidthStrokeProperties:
            node.properties.variableWidthStrokeProperties,
        }),
    join: node.properties.strokeJoin ?? "miter",
    miterLimit: 4,
    width: node.properties.strokeWidth,
  } as const;
  const source = {
    path: sourcePath,
    fillRule: node.properties.fillRule ?? "nonzero",
  } as const;
  const outlined =
    "network" in node.properties
      ? outlineVectorNetworkStroke(
          node.properties.network,
          source,
          outlineOptions,
          provider,
          geometryIdPrefix,
        )
      : outlineVectorPath(source, outlineOptions, provider, geometryIdPrefix);
  if (!outlined.ok)
    return vectorPlanFailure("invalid-geometry", outlined.message);
  const normalized = normalizeVectorNetwork(outlined.network);
  if (!normalized.ok || !normalized.offset) {
    return vectorPlanFailure(
      "invalid-geometry",
      "Outlined stroke could not be normalized",
    );
  }
  const inserted = structuredClone(node);
  inserted.id = resultNodeId;
  inserted.kind = "vector";
  inserted.name = `${node.name || "Vector"} Outline`;
  inserted.transform = translateLocalTransform(
    node.transform,
    normalized.offset,
  );
  inserted.size = {
    width: normalized.bounds.width,
    height: normalized.bounds.height,
  };
  inserted.properties = {
    ...structuredClone(node.properties),
    cornerRadius: 0,
    cornerSmoothing: 0,
    dashPattern: [],
    variableWidthStrokeProperties: { widthProfile: "UNIFORM" },
    fillRule: normalized.network.regions[0]?.windingRule ?? "nonzero",
    fills: structuredClone(visibleStrokes),
    network: normalized.network,
    strokeAlign: "center",
    strokeWidth: 0,
    strokes: [],
  };
  return {
    ok: true,
    operations: [
      {
        commandId: `insert_vector_outline_${resultNodeId}`,
        type: "insert_element",
        pageId,
        parentId: node.parentId,
        index: insertion.index,
        node: inserted,
      },
    ],
    outlineResult: { sourceNodeId: node.id, resultNodeId },
  };
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
  const cornerRadius = node.properties.cornerRadius ?? 0;
  const cornerSmoothing = node.properties.cornerSmoothing ?? 0;
  const retained = normalizeVectorNetwork(
    divided.retainedNetwork,
    cornerRadius,
    cornerSmoothing,
  );
  const extracted = normalizeVectorNetwork(
    divided.extractedNetwork,
    cornerRadius,
    cornerSmoothing,
  );
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
    | "missing-region"
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
              failure.code === "missing-region" ||
              failure.code === "missing-segment" ||
              failure.code === "missing-vertex"
            ? "not-found"
            : "invalid-geometry",
    message: failure.message,
  };
}

type EditableVectorNode = Extract<DesignNode, { kind: "path" | "vector" }> & {
  properties: VectorNetworkProperties;
};

type NormalizedSplitPart = {
  bounds: { height: number; width: number };
  network: VectorNetwork;
  offset: Point;
};

function normalizeSplitNetworks(
  node: EditableVectorNode,
  networks: readonly VectorNetwork[],
):
  | { ok: true; parts: readonly NormalizedSplitPart[] }
  | Extract<VectorOperationPlan, { ok: false }> {
  const parts: NormalizedSplitPart[] = [];
  for (const network of networks) {
    const normalized = normalizeVectorNetwork(
      network,
      node.properties.cornerRadius ?? 0,
      node.properties.cornerSmoothing ?? 0,
    );
    if (!normalized.ok || !normalized.offset) {
      return vectorPlanFailure(
        "invalid-geometry",
        normalized.ok
          ? "Split vector geometry could not be normalized"
          : normalized.issues.map((issue) => issue.message).join("; "),
      );
    }
    parts.push({
      bounds: normalized.bounds,
      network: normalized.network,
      offset: normalized.offset,
    });
  }
  return { ok: true, parts };
}

function splitVectorOperations(
  pageId: string,
  node: EditableVectorNode,
  resultNodeIds: readonly string[],
  parts: readonly NormalizedSplitPart[],
  insertionIndex: number,
): DesignOperation[] {
  return parts.map((part, index) => {
    const properties = {
      ...structuredClone(node.properties),
      network: part.network,
    };
    const transform = translateLocalTransform(node.transform, part.offset);
    const size = { width: part.bounds.width, height: part.bounds.height };
    if (index === 0) {
      return {
        commandId: `split_vector_${node.id}`,
        type: "update_properties",
        nodeId: node.id,
        properties,
        size,
        transform,
      };
    }
    const inserted = structuredClone(node);
    inserted.id = resultNodeIds[index]!;
    inserted.name = `${node.name || "Vector"} ${index + 1}`;
    inserted.properties = properties;
    inserted.size = size;
    inserted.transform = transform;
    return {
      commandId: `insert_split_vector_${inserted.id}`,
      type: "insert_element",
      pageId,
      parentId: node.parentId,
      index: insertionIndex + index - 1,
      node: inserted,
    };
  });
}

function isEditableVectorNode(
  node: DesignNode | undefined,
): node is EditableVectorNode {
  return (
    !!node &&
    (node.kind === "path" || node.kind === "vector") &&
    "network" in node.properties
  );
}

function editableVectorTarget(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
):
  | { ok: true; node: EditableVectorNode }
  | Extract<VectorOperationPlan, { ok: false }> {
  const node = document.nodesById[nodeId];
  if (
    !isEditableVectorNode(node) ||
    !nodeBelongsToPage(document, pageId, node.id)
  ) {
    return vectorPlanFailure(
      "not-found",
      `Editable vector ${nodeId} does not exist on page ${pageId}`,
    );
  }
  if (isEffectivelyLocked(document, node.id)) {
    return vectorPlanFailure("locked", `Editable vector ${nodeId} is locked`);
  }
  return { ok: true, node };
}

function sameVectorAppearance(
  first: EditableVectorNode,
  second: EditableVectorNode,
): boolean {
  return (
    serializedVectorAppearance(first) === serializedVectorAppearance(second)
  );
}

function serializedVectorAppearance(node: EditableVectorNode): string {
  return JSON.stringify(
    canonicalizeJson(
      Object.fromEntries(
        Object.entries(node.properties).filter(([name]) => name !== "network"),
      ),
    ),
  );
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([name, item]) => [name, canonicalizeJson(item)]),
  );
}

type OrderedLayerConnectTargets = NonNullable<
  ReturnType<typeof siblingOrderedTargets>
>;

function resolveLayerConnectTargets(
  document: DesignDocument,
  pageId: string,
  targets: readonly [VectorLayerEndpointTarget, VectorLayerEndpointTarget],
):
  | { ok: true; value: OrderedLayerConnectTargets }
  | Extract<VectorOperationPlan, { ok: false }> {
  const [firstTarget, secondTarget] = targets;
  const first = editableVectorTarget(document, pageId, firstTarget.nodeId);
  if (!first.ok) return first;
  const second = editableVectorTarget(document, pageId, secondTarget.nodeId);
  if (!second.ok) return second;
  if (first.node.parentId !== second.node.parentId) {
    return vectorPlanFailure(
      "unsupported-topology",
      "Cross-layer Vector Connect requires sibling layers",
    );
  }
  if (!sameVectorAppearance(first.node, second.node)) {
    return vectorPlanFailure(
      "unsupported-topology",
      "Cross-layer Vector Connect requires matching layer appearance",
    );
  }
  const ordered = siblingOrderedTargets(
    document,
    pageId,
    first.node,
    second.node,
    firstTarget,
    secondTarget,
  );
  return ordered
    ? { ok: true, value: ordered }
    : vectorPlanFailure(
        "not-found",
        "Cross-layer Vector Connect could not resolve sibling order",
      );
}

function projectAppendedNetwork(
  document: DesignDocument,
  targets: OrderedLayerConnectTargets,
):
  | { ok: true; network: VectorNetwork; vertexId: string }
  | Extract<VectorOperationPlan, { ok: false }> {
  const retainedWorld = getWorldTransform(document, targets.retained.id);
  const appendedWorld = getWorldTransform(document, targets.appended.id);
  const retainedInverse = retainedWorld ? invertTransform(retainedWorld) : null;
  if (!retainedInverse || !appendedWorld) {
    return vectorPlanFailure(
      "non-invertible",
      "Cross-layer Vector Connect requires invertible layer transforms",
    );
  }
  const transformed = transformVectorVertices(
    targets.appended.properties.network,
    targets.appended.properties.network.vertices.map(({ id }) => id),
    multiplyTransforms(retainedInverse, appendedWorld),
  );
  if (!transformed.ok) return vectorOperationFailure(transformed);
  const remapped = remapVectorNetworkIds(
    transformed.network,
    targets.retained.properties.network,
    targets.appended.id,
  );
  const vertexId = remapped.vertexIds.get(targets.appendedVertexId);
  return vertexId
    ? { ok: true, network: remapped.network, vertexId }
    : vectorPlanFailure(
        "not-found",
        `Vector endpoint ${targets.appendedVertexId} does not exist`,
      );
}

function siblingOrderedTargets(
  document: DesignDocument,
  pageId: string,
  first: EditableVectorNode,
  second: EditableVectorNode,
  firstTarget: VectorLayerEndpointTarget,
  secondTarget: VectorLayerEndpointTarget,
): {
  appended: EditableVectorNode;
  appendedVertexId: string;
  retained: EditableVectorNode;
  retainedVertexId: string;
} | null {
  const siblings = first.parentId
    ? document.nodesById[first.parentId]?.childIds
    : document.pagesById[pageId]?.rootNodeIds;
  const firstIndex = siblings?.indexOf(first.id) ?? -1;
  const secondIndex = siblings?.indexOf(second.id) ?? -1;
  if (firstIndex < 0 || secondIndex < 0) return null;
  return firstIndex < secondIndex
    ? {
        retained: first,
        retainedVertexId: firstTarget.vertexId,
        appended: second,
        appendedVertexId: secondTarget.vertexId,
      }
    : {
        retained: second,
        retainedVertexId: secondTarget.vertexId,
        appended: first,
        appendedVertexId: firstTarget.vertexId,
      };
}

function remapVectorNetworkIds(
  source: VectorNetwork,
  retained: VectorNetwork,
  prefix: string,
): { network: VectorNetwork; vertexIds: ReadonlyMap<string, string> } {
  const used = new Set([
    ...retained.vertices.map(({ id }) => id),
    ...retained.segments.map(({ id }) => id),
    ...retained.paths.map(({ id }) => id),
    ...retained.regions.map(({ id }) => id),
  ]);
  const remap = (items: readonly { id: string }[], role: string) =>
    new Map(
      items.map(({ id }) => [
        id,
        uniqueGeometryId(`${prefix}.${role}.${id}`, used),
      ]),
    );
  const vertexIds = remap(source.vertices, "vertex");
  const segmentIds = remap(source.segments, "segment");
  const pathIds = remap(source.paths, "path");
  const regionIds = remap(source.regions, "region");
  return {
    vertexIds,
    network: {
      vertices: source.vertices.map((vertex) => ({
        ...structuredClone(vertex),
        id: vertexIds.get(vertex.id)!,
      })),
      segments: source.segments.map((segment) => ({
        ...structuredClone(segment),
        id: segmentIds.get(segment.id)!,
        startVertexId: vertexIds.get(segment.startVertexId)!,
        endVertexId: vertexIds.get(segment.endVertexId)!,
      })),
      paths: source.paths.map((path) => ({
        ...structuredClone(path),
        id: pathIds.get(path.id)!,
        segments: path.segments.map((reference) => ({
          ...reference,
          segmentId: segmentIds.get(reference.segmentId)!,
        })),
      })),
      regions: source.regions.map((region) => ({
        ...structuredClone(region),
        id: regionIds.get(region.id)!,
        loops: region.loops.map((loop) => ({
          ...loop,
          pathId: pathIds.get(loop.pathId)!,
        })),
      })),
    },
  };
}

function uniqueGeometryId(candidate: string, used: Set<string>): string {
  let id = candidate;
  let suffix = 2;
  while (used.has(id)) id = `${candidate}.${suffix++}`;
  used.add(id);
  return id;
}

function mergeAuthoredVectorNetworks(
  first: VectorNetwork,
  second: VectorNetwork,
): VectorNetwork {
  return {
    vertices: [
      ...structuredClone(first.vertices),
      ...structuredClone(second.vertices),
    ],
    segments: [
      ...structuredClone(first.segments),
      ...structuredClone(second.segments),
    ],
    paths: [...structuredClone(first.paths), ...structuredClone(second.paths)],
    regions: [
      ...structuredClone(first.regions),
      ...structuredClone(second.regions),
    ],
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

function isEditablePathNode(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const node = document.nodesById[nodeId];
  return Boolean(
    node &&
    (node.kind === "path" || node.kind === "vector") &&
    nodeBelongsToPage(document, pageId, nodeId),
  );
}

function vectorSiblingInsertion(
  document: DesignDocument,
  pageId: string,
  node: Extract<DesignNode, { kind: "path" | "vector" }>,
  operation = "Outlining",
): { ok: true; index: number } | Extract<VectorOperationPlan, { ok: false }> {
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  if (parent?.kind === "boolean") {
    return vectorPlanFailure(
      "unsupported-topology",
      `${operation} a Boolean operand requires leaving Boolean edit scope`,
    );
  }
  const siblings = node.parentId
    ? parent?.kind === "frame" ||
      parent?.kind === "slot" ||
      parent?.kind === "group"
      ? parent.childIds
      : undefined
    : document.pagesById[pageId]?.rootNodeIds;
  const sourceIndex = siblings?.indexOf(node.id) ?? -1;
  return siblings && sourceIndex >= 0
    ? { ok: true, index: sourceIndex + 1 }
    : vectorPlanFailure(
        "not-found",
        `Editable vector ${node.id} has no valid insertion parent`,
      );
}

function vectorPlanFailure(
  code: VectorOperationFailureCode,
  message: string,
): Extract<VectorOperationPlan, { ok: false }> {
  return { ok: false, code, message };
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
