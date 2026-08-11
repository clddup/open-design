import type {
  DesignDocument,
  DesignOperation,
  Transform,
  VectorNetwork,
  VectorPointMode,
} from "@opendesign/design-contracts";
import {
  cutVectorPath,
  findVectorPathIdForVertex,
  inferVectorPointMode,
  reverseVectorPath,
  setVectorPathClosed,
  vectorNetworkEditability,
  type VectorCutLocation,
} from "@opendesign/geometry-service/vector-edit";
import { normalizeVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import { isEffectivelyLocked } from "./layer-operations.js";

export type VectorOperationFailureCode =
  | "invalid-geometry"
  | "locked"
  | "no-op"
  | "not-found"
  | "unsupported-topology";

export type VectorSemanticEdit =
  | { action: "set-closed"; closed: boolean; pathId?: string }
  | { action: "reverse-path"; pathId?: string }
  | {
      action: "cut-path";
      at: VectorCutLocation;
      pathId: string;
    };

export interface VectorEditScope {
  activePathId?: string;
  nodeId: string;
  pathCount: number;
  pointMode?: VectorPointMode;
  readOnly: boolean;
  readOnlyReason?: string;
  selectedVertexIds: readonly string[];
}

export type VectorOperationPlan =
  | {
      ok: true;
      operations: readonly DesignOperation[];
      cutResult?: {
        cutVertexIds: readonly [string, string];
        pathIds: readonly string[];
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
): VectorEditScope | null {
  if (
    !editNodeId ||
    selectionNodeIds.length !== 1 ||
    selectionNodeIds[0] !== editNodeId
  ) {
    return null;
  }
  const node = document.nodesById[editNodeId];
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
  const editability = vectorNetworkEditability(network);
  const locked = isEffectivelyLocked(document, node.id);
  const modes = new Set(
    selected.map((vertexId) => inferVectorPointMode(network, vertexId)),
  );
  const selectedPathIds = new Set(
    selected.flatMap((vertexId) => {
      const pathId = findVectorPathIdForVertex(network, vertexId);
      return pathId ? [pathId] : [];
    }),
  );
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
    selectedVertexIds: selected,
  };
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
  if (edit.action === "cut-path") {
    const cut = cutVectorPath(node.properties.network, edit.pathId, edit.at);
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
  const edited =
    edit.action === "set-closed"
      ? setVectorPathClosed(node.properties.network, edit.closed, edit.pathId)
      : reverseVectorPath(node.properties.network, edit.pathId);
  if (!edited.ok) {
    return vectorOperationFailure(edited);
  }
  return planVectorNetworkUpdate(document, pageId, nodeId, edited.network);
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
