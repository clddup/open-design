import {
  MAX_TRANSACTION_COMMANDS,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
  type Point,
  type Transform,
  type VectorNetwork,
  type VectorNetworkProperties,
} from "@opendesign/design-contracts";
import {
  buildVectorShapeBuilderEdit,
  type VectorShapeBuilderAction,
} from "@opendesign/geometry-service";
import {
  normalizeVectorNetwork,
  serializeVectorRegion,
} from "@opendesign/geometry-service/editable-vector";
import {
  materializeVectorNetwork,
  mergeVectorNetworks,
} from "@opendesign/geometry-service/vector-materialization";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import { planDeleteNodes } from "./deletion-operations.js";
import { getWorldTransform, invertTransform } from "./geometry.js";
import { analyzeContainerSelection } from "./layer-operations.js";
import { buildFlattenedVectorNetwork } from "./vector-flatten-network.js";
import {
  collectFlattenSources,
  resolveFlattenSelection,
} from "./vector-flatten-sources.js";
import type { FlattenSourceEntry } from "./vector-flatten-internal.js";
export interface VectorShapeBuilderPlanInput {
  action: VectorShapeBuilderAction;
  baseRevision: number;
  geometryIdPrefix: string;
  nodeIds: readonly string[];
  points: readonly Point[];
  resultNodeId?: string;
}
export type VectorShapeBuilderOperationPlan =
  | {
      ok: true;
      operations: readonly DesignOperation[];
      shapeBuilderResult: {
        selectionNodeIds: readonly string[];
      };
    }
  | {
      ok: false;
      code: FailureCode;
      message: string;
    };
type FailureCode =
  | "conflict"
  | "invalid-geometry"
  | "invalid-selection"
  | "locked"
  | "mixed-parent"
  | "no-op"
  | "non-invertible"
  | "not-found"
  | "operation-limit"
  | "requires-raster-compositing"
  | "unsupported-topology";
type EditableVectorNode = Extract<DesignNode, { kind: "path" | "vector" }> & {
  properties: VectorNetworkProperties;
};
type Failure = Extract<VectorShapeBuilderOperationPlan, { ok: false }>;
type InsertOperation = Extract<DesignOperation, { type: "insert_element" }>;
type UpdateOperation = Extract<DesignOperation, { type: "update_properties" }>;
export function planVectorShapeBuilderEdit(
  document: DesignDocument,
  pageId: string,
  input: VectorShapeBuilderPlanInput,
  provider: VectorGeometryProvider,
): VectorShapeBuilderOperationPlan {
  if (input.baseRevision !== document.revision) {
    return failure(
      "conflict",
      `Shape Builder expected revision ${input.baseRevision}, current revision is ${document.revision}`,
    );
  }
  const selection = analyzeContainerSelection(document, pageId, input.nodeIds, {
    action: "Shape Builder",
    minimum: 1,
  });
  if (!selection.ok) {
    const code =
      selection.code === "invalid-target" ||
      selection.code === "visual-fidelity"
        ? "invalid-selection"
        : selection.code;
    return failure(code, selection.message);
  }
  const prepared = prepareDocumentSources(
    document,
    pageId,
    selection.ordered,
    provider,
    input.geometryIdPrefix,
  );
  if (!prepared.ok) return prepared;
  const built = buildVectorShapeBuilderEdit(
    prepared.sources,
    input.points,
    input.action,
    provider,
    input.geometryIdPrefix,
  );
  if (!built.ok) {
    const code =
      built.code === "no-region"
        ? "no-op"
        : built.code === "budget-exceeded"
          ? "operation-limit"
          : "invalid-geometry";
    return failure(code, built.message);
  }
  const resultId = input.action === "subtract" ? null : input.resultNodeId;
  if (
    input.action !== "subtract" &&
    (!resultId || document.nodesById[resultId])
  ) {
    return failure(
      "invalid-selection",
      `Shape Builder result node ID ${resultId || "(empty)"} is unavailable`,
    );
  }
  const mutations = planSourceMutations(
    document,
    prepared.nodesById,
    built.sourceResults,
    provider,
  );
  if (!mutations.ok) return mutations;
  const insertion =
    resultId && built.resultNetwork
      ? planResultInsertion({
          action: input.action,
          document,
          network: built.resultNetwork,
          nodesById: prepared.nodesById,
          pageId,
          parentId: selection.parentId,
          removedNodeIds: mutations.removedNodeIds,
          resultId,
          siblings: selection.siblings,
          provider,
        })
      : null;
  if (insertion && !insertion.ok) return insertion;
  const operations = [
    ...mutations.operations,
    ...(insertion?.ok ? [insertion.operation] : []),
  ];
  if (operations.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Shape Builder requires ${operations.length} commands, exceeding the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  return {
    ok: true,
    operations,
    shapeBuilderResult: {
      selectionNodeIds: resultId ? [resultId] : mutations.updatedNodeIds,
    },
  };
}
function prepareDocumentSources(
  document: DesignDocument,
  pageId: string,
  ordered: readonly string[],
  provider: VectorGeometryProvider,
  idPrefix: string,
):
  | {
      ok: true;
      nodesById: ReadonlyMap<string, EditableVectorNode>;
      sources: { network: VectorNetwork; sourceId: string }[];
    }
  | Failure {
  const nodesById = new Map<string, EditableVectorNode>();
  const sources: { network: VectorNetwork; sourceId: string }[] = [];
  for (const [index, nodeId] of ordered.entries()) {
    const node = document.nodesById[nodeId];
    if (!isEditableVectorNode(node)) {
      return failure(
        "unsupported-topology",
        `Shape Builder requires explicit editable Path or Vector layers; received ${node?.kind ?? "missing"} ${nodeId}`,
      );
    }
    const world = getWorldTransform(document, node.id);
    if (!world || !invertTransform(world)) {
      return failure(
        "non-invertible",
        `Shape Builder source ${node.id} has a non-invertible world transform`,
      );
    }
    const network = materializeDocumentPaint(
      document,
      pageId,
      node,
      world,
      provider,
      `${idPrefix}_source_${index}`,
    );
    if (!network.ok) return network;
    nodesById.set(node.id, node);
    sources.push({ sourceId: node.id, network: network.network });
  }
  return { ok: true, nodesById, sources };
}
function materializeDocumentPaint(
  document: DesignDocument,
  pageId: string,
  node: EditableVectorNode,
  world: Transform,
  provider: VectorGeometryProvider,
  idPrefix: string,
): { ok: true; network: VectorNetwork } | Failure {
  const entries: FlattenSourceEntry[] = [];
  const collected = collectFlattenSources(document, node, world, [], entries);
  if (!collected.ok) return failure(collected.code, collected.message);
  const resolved = resolveFlattenSelection(document, entries);
  if (!resolved.ok) return failure(resolved.code, resolved.message);
  const built = buildFlattenedVectorNetwork(
    document,
    pageId,
    resolved.nodes,
    provider,
    idPrefix,
    undefined,
  );
  return built.ok
    ? { ok: true, network: built.network }
    : failure(built.code, built.message);
}
function planSourceMutations(
  document: DesignDocument,
  nodesById: ReadonlyMap<string, EditableVectorNode>,
  sourceResults: readonly {
    changed: boolean;
    network: VectorNetwork | null;
    sourceId: string;
  }[],
  provider: VectorGeometryProvider,
):
  | {
      ok: true;
      operations: DesignOperation[];
      removedNodeIds: string[];
      updatedNodeIds: string[];
    }
  | Failure {
  const operations: DesignOperation[] = [];
  const removedNodeIds: string[] = [];
  const updatedNodeIds: string[] = [];
  for (const result of sourceResults) {
    if (!result.changed) continue;
    const node = nodesById.get(result.sourceId);
    if (!node) {
      return failure(
        "invalid-geometry",
        `Unknown Shape Builder result ${result.sourceId}`,
      );
    }
    if (!result.network) {
      removedNodeIds.push(node.id);
      continue;
    }
    const update = networkUpdateInParentSpace(
      document,
      node,
      result.network,
      provider,
    );
    if (!update.ok) return update;
    operations.push(update.operation);
    updatedNodeIds.push(node.id);
  }
  if (removedNodeIds.length > 0) {
    const deletion = planDeleteNodes(document, {
      commandPrefix: "shape_builder",
      nodeIds: removedNodeIds,
    });
    if (!deletion.ok) return failure("unsupported-topology", deletion.message);
    operations.push(...deletion.commands);
  }
  return { ok: true, operations, removedNodeIds, updatedNodeIds };
}
function networkUpdateInParentSpace(
  document: DesignDocument,
  node: EditableVectorNode,
  documentNetwork: VectorNetwork,
  provider: VectorGeometryProvider,
): { ok: true; operation: UpdateOperation } | Failure {
  const localized = networkInParentSpace(
    document,
    node.parentId,
    documentNetwork,
    provider,
    `shape_builder_local_${node.id}`,
  );
  if (!localized.ok) return localized;
  return {
    ok: true,
    operation: {
      commandId: `shape_builder_update_${node.id}`,
      type: "update_properties",
      nodeId: node.id,
      transform: [1, 0, 0, 1, localized.offset.x, localized.offset.y],
      size: localized.size,
      properties: shapeBuilderProperties(localized.network),
    },
  };
}
interface ResultInsertionInput {
  action: VectorShapeBuilderAction;
  document: DesignDocument;
  network: VectorNetwork;
  nodesById: ReadonlyMap<string, EditableVectorNode>;
  pageId: string;
  parentId: string | null;
  provider: VectorGeometryProvider;
  removedNodeIds: readonly string[];
  resultId: string;
  siblings: readonly string[];
}
function planResultInsertion(
  input: ResultInsertionInput,
): { ok: true; operation: InsertOperation } | Failure {
  const localized = networkInParentSpace(
    input.document,
    input.parentId,
    input.network,
    input.provider,
    `${input.resultId}_local`,
  );
  if (!localized.ok) return localized;
  const source = [...input.nodesById.values()].at(-1)!;
  const sourceIndexes = [...input.nodesById.keys()].map((id) =>
    input.siblings.indexOf(id),
  );
  const desiredIndex = Math.max(...sourceIndexes) + 1;
  const removed = new Set(input.removedNodeIds);
  const index =
    desiredIndex -
    input.siblings.slice(0, desiredIndex).filter((id) => removed.has(id))
      .length;
  return {
    ok: true,
    operation: {
      commandId: `shape_builder_insert_${input.resultId}`,
      type: "insert_element",
      pageId: input.pageId,
      parentId: input.parentId,
      index,
      node: {
        id: input.resultId,
        kind: "vector",
        name: `${source.name || "Vector"} ${input.action === "merge" ? "Merged" : "Extracted"}`,
        parentId: input.parentId,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, localized.offset.x, localized.offset.y],
        size: localized.size,
        exportSettings: [],
        opacity: source.opacity,
        extensions: {},
        properties: shapeBuilderProperties(localized.network),
      },
    },
  };
}
function networkInParentSpace(
  document: DesignDocument,
  parentId: string | null,
  network: VectorNetwork,
  provider: VectorGeometryProvider,
  idPrefix: string,
):
  | {
      ok: true;
      network: VectorNetwork;
      offset: Point;
      size: { width: number; height: number };
    }
  | Failure {
  const parentWorld = parentId
    ? getWorldTransform(document, parentId)
    : ([1, 0, 0, 1, 0, 0] as Transform);
  const inverse = parentWorld ? invertTransform(parentWorld) : null;
  if (!inverse)
    return failure(
      "non-invertible",
      "Shape Builder parent transform is non-invertible",
    );
  const transformed = transformPaintedNetwork(
    network,
    inverse,
    provider,
    idPrefix,
  );
  if (!transformed.ok) return transformed;
  const normalized = normalizeVectorNetwork(transformed.network);
  if (!normalized.ok || !normalized.offset) {
    return failure(
      "invalid-geometry",
      normalized.ok
        ? "Shape Builder result could not be normalized"
        : normalized.issues.map((issue) => issue.message).join("; "),
    );
  }
  return {
    ok: true,
    network: normalized.network,
    offset: normalized.offset,
    size: { width: normalized.bounds.width, height: normalized.bounds.height },
  };
}
function transformPaintedNetwork(
  network: VectorNetwork,
  transform: Transform,
  provider: VectorGeometryProvider,
  idPrefix: string,
): { ok: true; network: VectorNetwork } | Failure {
  const pieces: VectorNetwork[] = [];
  for (const [index, region] of network.regions.entries()) {
    const serialized = serializeVectorRegion(network, region.id);
    if (!serialized.ok) {
      return failure(
        "invalid-geometry",
        serialized.issues.map((issue) => issue.message).join("; "),
      );
    }
    const transformed = provider.transform(
      { path: serialized.path, fillRule: region.windingRule },
      transform,
    );
    if (!transformed.ok || transformed.empty) {
      return failure(
        "invalid-geometry",
        transformed.ok
          ? "Shape Builder transformed region is empty"
          : transformed.message,
      );
    }
    const materialized = materializeVectorNetwork(
      transformed.path,
      transformed.fillRule,
      `${idPrefix}_${index}`,
    );
    if (!materialized.ok)
      return failure("invalid-geometry", materialized.message);
    materialized.network.regions.forEach((candidate) => {
      if (region.fills !== undefined)
        candidate.fills = structuredClone(region.fills);
      if (region.fillStyleId !== undefined)
        candidate.fillStyleId = region.fillStyleId;
    });
    pieces.push(materialized.network);
  }
  const merged = mergeVectorNetworks(pieces);
  return merged.ok
    ? { ok: true, network: merged.network }
    : failure("invalid-geometry", merged.message);
}
function shapeBuilderProperties(
  network: VectorNetwork,
): VectorNetworkProperties {
  return {
    fillRule: "nonzero",
    fills: [],
    network,
    strokeWidth: 0,
    strokes: [],
  };
}
function isEditableVectorNode(
  node: DesignNode | undefined,
): node is EditableVectorNode {
  return Boolean(
    node &&
    (node.kind === "path" || node.kind === "vector") &&
    "network" in node.properties,
  );
}
function failure(code: Failure["code"], message: string): Failure {
  return { ok: false, code, message };
}
