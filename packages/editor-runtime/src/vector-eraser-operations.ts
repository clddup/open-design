import type {
  DesignDocument,
  DesignOperation,
  Point,
  Transform,
  VectorNetworkProperties,
} from "@opendesign/design-contracts";
import {
  createVectorEraserPath,
  erasePaintedVectorNetwork,
  type VectorEraserShape,
} from "@opendesign/geometry-service/vector-eraser";
import { normalizeVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import { planDeleteNodes } from "./deletion-operations.js";
import {
  getWorldTransform,
  invertTransform,
  multiplyTransforms,
} from "./geometry.js";
import { isEffectivelyLocked, nodeBelongsToPage } from "./layer-operations.js";
import { buildFlattenedVectorNetwork } from "./vector-flatten-network.js";
import {
  collectFlattenSources,
  resolveFlattenSelection,
} from "./vector-flatten-sources.js";
import type { FlattenSourceEntry } from "./vector-flatten-internal.js";

const IDENTITY_TRANSFORM: Transform = [1, 0, 0, 1, 0, 0];

export interface VectorEraserTarget {
  geometryIdPrefix: string;
  nodeId: string;
}

export type VectorEraserOperationPlan =
  | {
      ok: true;
      operations: readonly DesignOperation[];
      eraserResult: {
        deletedNodeIds: readonly string[];
        remainingNodeIds: readonly string[];
      };
    }
  | {
      ok: false;
      code:
        | "invalid-geometry"
        | "locked"
        | "no-op"
        | "non-invertible"
        | "not-found"
        | "requires-raster-compositing"
        | "unsupported-topology";
      message: string;
    };

/**
 * Erases explicit Vector layers with one document-space gesture. Visible
 * fills and strokes are materialized into editable painted regions first, so
 * the result stays in the original layer instead of becoming raster content.
 */
export function planVectorLayersErase(
  document: DesignDocument,
  pageId: string,
  targets: readonly VectorEraserTarget[],
  points: readonly Point[],
  weight: number,
  shape: VectorEraserShape,
  provider: VectorGeometryProvider,
): VectorEraserOperationPlan {
  if (
    targets.length === 0 ||
    targets.length > 500 ||
    new Set(targets.map(({ nodeId }) => nodeId)).size !== targets.length ||
    targets.some(({ geometryIdPrefix, nodeId }) => !geometryIdPrefix || !nodeId)
  ) {
    return failure(
      "invalid-geometry",
      "Vector Eraser requires 1–500 unique explicit layer targets",
    );
  }
  const brush = createVectorEraserPath(points, weight, shape, provider);
  if (!brush.ok) return failure("invalid-geometry", brush.message);

  const updates: DesignOperation[] = [];
  const deletedNodeIds: string[] = [];
  const remainingNodeIds: string[] = [];
  for (const target of targets) {
    const prepared = prepareErasedVector(
      document,
      pageId,
      target,
      brush.path,
      provider,
    );
    if (!prepared.ok) {
      if (prepared.code === "no-op") {
        remainingNodeIds.push(target.nodeId);
        continue;
      }
      return prepared;
    }
    if (prepared.network === null) {
      deletedNodeIds.push(target.nodeId);
      continue;
    }
    updates.push(prepared.operation);
    remainingNodeIds.push(target.nodeId);
  }
  if (updates.length === 0 && deletedNodeIds.length === 0) {
    return failure("no-op", "Vector Eraser did not intersect any target");
  }
  const deletion =
    deletedNodeIds.length === 0
      ? { ok: true as const, commands: [] }
      : planDeleteNodes(document, {
          commandPrefix: "vector_eraser",
          nodeIds: deletedNodeIds,
        });
  if (!deletion.ok) return failure("unsupported-topology", deletion.message);
  return {
    ok: true,
    operations: [...updates, ...deletion.commands],
    eraserResult: { deletedNodeIds, remainingNodeIds },
  };
}

function prepareErasedVector(
  document: DesignDocument,
  pageId: string,
  target: VectorEraserTarget,
  documentBrush: Parameters<typeof erasePaintedVectorNetwork>[1],
  provider: VectorGeometryProvider,
):
  | {
      ok: true;
      network: VectorNetworkProperties["network"] | null;
      operation: Extract<DesignOperation, { type: "update_properties" }>;
    }
  | Extract<VectorEraserOperationPlan, { ok: false }> {
  const node = document.nodesById[target.nodeId];
  if (
    !node ||
    (node.kind !== "path" && node.kind !== "vector") ||
    !("network" in node.properties) ||
    !nodeBelongsToPage(document, pageId, node.id)
  ) {
    return failure(
      "not-found",
      `Editable vector ${target.nodeId} does not exist on page ${pageId}`,
    );
  }
  if (isEffectivelyLocked(document, node.id)) {
    return failure("locked", `Editable vector ${node.id} is locked`);
  }
  const world = getWorldTransform(document, node.id);
  const inverse = world ? invertTransform(world) : null;
  if (!inverse) {
    return failure(
      "non-invertible",
      `Vector layer ${node.id} has a non-invertible world transform`,
    );
  }
  const localBrush = provider.transform(documentBrush, inverse);
  if (!localBrush.ok) return failure("invalid-geometry", localBrush.message);
  if (localBrush.empty) {
    return failure("no-op", `Vector Eraser missed ${node.id}`);
  }
  const visible = materializeVisibleVector(document, pageId, node, provider);
  if (!visible.ok) return visible;
  const erased = erasePaintedVectorNetwork(
    visible.network,
    localBrush,
    provider,
    target.geometryIdPrefix,
  );
  if (!erased.ok) return failure("invalid-geometry", erased.message);
  if (!erased.changed) {
    return failure("no-op", `Vector Eraser missed ${node.id}`);
  }
  if (erased.network === null) {
    return {
      ok: true,
      network: null,
      operation: emptyUpdate(node.id),
    };
  }
  const normalized = normalizeVectorNetwork(erased.network);
  if (!normalized.ok || !normalized.offset) {
    return failure(
      "invalid-geometry",
      normalized.ok
        ? "Erased Vector geometry could not be normalized"
        : normalized.issues.map((issue) => issue.message).join("; "),
    );
  }
  return {
    ok: true,
    network: normalized.network,
    operation: {
      commandId: `erase_vector_${node.id}`,
      type: "update_properties",
      nodeId: node.id,
      transform: multiplyTransforms(node.transform, [
        1,
        0,
        0,
        1,
        normalized.offset.x,
        normalized.offset.y,
      ]),
      size: {
        width: normalized.bounds.width,
        height: normalized.bounds.height,
      },
      properties: erasedVectorProperties(node.properties, normalized.network),
    },
  };
}

function materializeVisibleVector(
  document: DesignDocument,
  pageId: string,
  node: Extract<
    DesignDocument["nodesById"][string],
    { kind: "path" | "vector" }
  >,
  provider: VectorGeometryProvider,
):
  | { ok: true; network: VectorNetworkProperties["network"] }
  | Extract<VectorEraserOperationPlan, { ok: false }> {
  const entries: FlattenSourceEntry[] = [];
  const collected = collectFlattenSources(
    document,
    node,
    IDENTITY_TRANSFORM,
    [],
    entries,
    true,
  );
  if (!collected.ok) return failure(collected.code, collected.message);
  const resolved = resolveFlattenSelection(document, entries);
  if (!resolved.ok) return failure(resolved.code, resolved.message);
  const built = buildFlattenedVectorNetwork(
    document,
    pageId,
    resolved.nodes,
    provider,
    `eraser_source_${node.id}`,
    undefined,
  );
  return built.ok
    ? { ok: true, network: built.network }
    : failure(built.code, built.message);
}

function erasedVectorProperties(
  source: VectorNetworkProperties,
  network: VectorNetworkProperties["network"],
): VectorNetworkProperties {
  return {
    ...structuredClone(source),
    cornerRadius: 0,
    cornerSmoothing: 0,
    dashPattern: [],
    fillRule: "nonzero",
    fills: [],
    network,
    strokeAlign: "center",
    strokeWidth: 0,
    strokes: [],
    variableWidthStrokeProperties: { widthProfile: "UNIFORM" },
  };
}

function emptyUpdate(
  nodeId: string,
): Extract<DesignOperation, { type: "update_properties" }> {
  return {
    commandId: `erase_vector_empty_${nodeId}`,
    type: "update_properties",
    nodeId,
    visible: true,
  };
}

function failure(
  code: Extract<VectorEraserOperationPlan, { ok: false }>["code"],
  message: string,
): Extract<VectorEraserOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
