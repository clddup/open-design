import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  VectorNetwork,
} from "@opendesign/design-contracts";
import { normalizeVectorNetwork } from "@opendesign/geometry-service/editable-vector";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import type { TextRunLayoutProvider } from "@opendesign/text-service";
import { planDeleteNodes } from "./deletion-operations.js";
import {
  flattenFailure,
  type FlattenFailure,
  type FlattenSourceEntry,
} from "./vector-flatten-internal.js";
import { buildFlattenedVectorNetwork } from "./vector-flatten-network.js";
import {
  collectFlattenSources,
  resolveFlattenSelection,
} from "./vector-flatten-sources.js";
import type { FlattenTextRunStyle } from "./vector-flatten-text.js";
import { analyzeFlattenRootSelection } from "./vector-flatten-selection.js";
import { prepareRasterFlattenNodes } from "./vector-flatten-raster.js";

type EditableVectorNode = Extract<DesignNode, { kind: "path" | "vector" }>;

export type FlattenOperationPlan =
  | {
      ok: true;
      operations: readonly DesignOperation[];
      cutResult?: undefined;
      layerLineCutResult?: undefined;
      lineCutResult?: undefined;
      outlineResult?: undefined;
      flattenResult: {
        resultNodeId: string;
        sourceNodeIds: readonly string[];
      };
    }
  | FlattenFailure;

type FlattenSelection = Omit<
  Extract<ReturnType<typeof analyzeFlattenRootSelection>, { ok: true }>,
  "nodes"
> & { nodes: readonly FlattenSourceEntry[] };

export function canFlattenNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): boolean {
  if (analyzeFlattenSelection(document, pageId, nodeIds).ok) return true;
  return prepareRasterFlattenNodes(document, pageId, nodeIds).kind === "ready";
}

/** Destructively replaces supported same-parent layers with one editable Vector. */
export function planFlattenNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  resultNodeId: string,
  geometryIdPrefix: string,
  provider: VectorGeometryProvider,
  textRunLayoutProvider?: TextRunLayoutProvider<FlattenTextRunStyle>,
): FlattenOperationPlan {
  if (!resultNodeId || document.nodesById[resultNodeId]) {
    return flattenFailure(
      "invalid-geometry",
      `Flatten result node ID ${resultNodeId || "(empty)"} is unavailable`,
    );
  }
  const selection = analyzeFlattenSelection(document, pageId, nodeIds);
  if (!selection.ok) return selection;
  const resolvedNodes = resolveFlattenSelection(
    selection.document,
    selection.nodes,
  );
  if (!resolvedNodes.ok) return resolvedNodes;
  const built = buildFlattenedVectorNetwork(
    selection.document,
    pageId,
    resolvedNodes.nodes,
    provider,
    geometryIdPrefix,
    textRunLayoutProvider,
  );
  if (!built.ok) return built;
  const deletion = planDeleteNodes(document, {
    nodeIds: selection.ordered,
    commandPrefix: `flatten_${resultNodeId}`,
  });
  if (!deletion.ok) {
    return flattenFailure("unsupported-topology", deletion.message);
  }
  const result = createFlattenedVectorNode(
    selection.sourceNode,
    resultNodeId,
    selection.parentId,
    built.network,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    operations: [
      ...deletion.commands,
      {
        commandId: `insert_flattened_vector_${resultNodeId}`,
        type: "insert_element",
        pageId,
        parentId: selection.parentId,
        index: Math.min(
          ...selection.ordered.map((nodeId) =>
            selection.siblings.indexOf(nodeId),
          ),
        ),
        node: result.node,
      },
    ],
    flattenResult: {
      resultNodeId,
      sourceNodeIds: [...selection.ordered],
    },
  };
}

function analyzeFlattenSelection(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): ({ ok: true } & FlattenSelection) | FlattenFailure {
  const selection = analyzeFlattenRootSelection(document, pageId, nodeIds);
  if (!selection.ok) return selection;
  const sourceEntries: FlattenSourceEntry[] = [];
  for (const projectedNode of selection.nodes) {
    const collected = collectFlattenSources(
      selection.document,
      projectedNode,
      projectedNode.transform,
      [],
      sourceEntries,
      selection.nodes.length === 1,
    );
    if (!collected.ok) return collected;
  }
  if (sourceEntries.length === 0) {
    return flattenFailure(
      "unsupported-topology",
      "Flatten requires at least one visible supported geometry layer",
    );
  }
  return {
    ok: true,
    document: selection.document,
    nodes: sourceEntries,
    ordered: selection.ordered,
    parentId: selection.parentId,
    siblings: selection.siblings,
    sourceNode: selection.sourceNode,
  };
}

function createFlattenedVectorNode(
  source: DesignNode,
  id: string,
  parentId: string | null,
  network: VectorNetwork,
): { ok: true; node: EditableVectorNode } | FlattenFailure {
  const normalized = normalizeVectorNetwork(network);
  if (!normalized.ok || !normalized.offset) {
    return flattenFailure(
      "invalid-geometry",
      "Flattened Vector normalization failed",
    );
  }
  return {
    ok: true,
    node: {
      id,
      kind: "vector",
      name: `${source.name || "Vector"} Flattened`,
      parentId,
      childIds: [],
      visible: source.visible,
      locked: false,
      transform: [1, 0, 0, 1, normalized.offset.x, normalized.offset.y],
      size: {
        width: normalized.bounds.width,
        height: normalized.bounds.height,
      },
      exportSettings: [],
      opacity: source.opacity,
      ...(source.blendMode === undefined
        ? {}
        : { blendMode: source.blendMode }),
      ...(source.effects === undefined
        ? {}
        : { effects: structuredClone(source.effects) }),
      ...(source.maskMode === undefined ? {} : { maskMode: source.maskMode }),
      ...(source.effectStyleId === undefined
        ? {}
        : { effectStyleId: source.effectStyleId }),
      ...(source.explicitVariableModes === undefined
        ? {}
        : {
            explicitVariableModes: structuredClone(
              source.explicitVariableModes,
            ),
          }),
      ...flattenShellVariableBindings(source),
      extensions: {},
      properties: {
        network: normalized.network,
        fillRule: "nonzero",
        fills: [],
        strokes: [],
        strokeWidth: 0,
      },
    },
  };
}

function flattenShellVariableBindings(
  source: DesignNode,
): Pick<DesignNode, "boundVariables"> | Record<string, never> {
  const visible = source.boundVariables?.visible;
  const opacity = source.boundVariables?.opacity;
  return visible || opacity
    ? {
        boundVariables: {
          ...(visible ? { visible: structuredClone(visible) } : {}),
          ...(opacity ? { opacity: structuredClone(opacity) } : {}),
        },
      }
    : {};
}
