import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  FrameNode,
  ImageNode,
  Paint,
  RectangleNode,
  TextNode,
  Transform,
  VectorNetwork,
} from "@opendesign/design-contracts";
import { resolveLineEndpointPoint } from "@opendesign/design-contracts";
import {
  createBooleanGeometryResolver,
  type BooleanGeometryResolution,
} from "@opendesign/geometry-service/boolean-resolver";
import {
  normalizeVectorNetwork,
  serializeVectorNetwork,
  serializeVectorRegion,
} from "@opendesign/geometry-service/editable-vector";
import {
  materializeVectorNetwork,
  mergeVectorNetworks,
  outlineVectorNetworkStroke,
  outlineVectorPath,
  type VectorOutlineOptions,
} from "@opendesign/geometry-service/vector-materialization";
import { resolveLineEndpointVisiblePath } from "@opendesign/geometry-service/line-endpoint";
import type {
  VectorGeometryProvider,
  VectorPathInput,
} from "@opendesign/geometry-service/vector-path";
import { materializeNodeStyle } from "@opendesign/style-service";
import { planDeleteNodes } from "./deletion-operations.js";
import { multiplyTransforms } from "./geometry.js";
import { analyzeContainerSelection } from "./layer-operations.js";
import {
  flattenSourcePath,
  sourceHasFillGeometry,
  type FlattenSourcePath,
  type FlattenSourceNode,
} from "./vector-flatten-shapes.js";
import {
  resolveFlattenTextGlyphs,
  type FlattenTextRunStyle,
} from "./vector-flatten-text.js";
import { flattenImageNode } from "./vector-flatten-image.js";
import type { TextRunLayoutProvider } from "@opendesign/text-service";

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

type FlattenFailure = {
  ok: false;
  code: "invalid-geometry" | "unsupported-topology";
  message: string;
};

type FlattenSelection = {
  nodes: readonly FlattenSourceEntry[];
  ordered: readonly string[];
  parentId: string | null;
  siblings: readonly string[];
  sourceNode: DesignNode;
};

type FlattenSourceEntry = {
  clips: readonly FlattenClip[];
  contribution: "all" | "fill" | "stroke";
  node: FlattenSourceNode | FrameNode | ImageNode | TextNode;
  transform: Transform;
};

type FlattenClip = {
  node: RectangleNode;
  transform: Transform;
};

type ResolvedFlattenSourceEntry = {
  clips: readonly FlattenClip[];
  node: FlattenSourceNode | TextNode;
};

export function canFlattenNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): boolean {
  return analyzeFlattenSelection(document, pageId, nodeIds).ok;
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
    return failure(
      "invalid-geometry",
      `Flatten result node ID ${resultNodeId || "(empty)"} is unavailable`,
    );
  }
  const selection = analyzeFlattenSelection(document, pageId, nodeIds);
  if (!selection.ok) return selection;
  const resolvedNodes = materializeFlattenSelection(document, selection.nodes);
  if (!resolvedNodes.ok) return resolvedNodes;
  const built = buildFlattenedVectorNetwork(
    document,
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
    return failure("unsupported-topology", deletion.message);
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

function materializeFlattenSelection(
  document: DesignDocument,
  entries: readonly FlattenSourceEntry[],
): { ok: true; nodes: readonly ResolvedFlattenSourceEntry[] } | FlattenFailure {
  const resolved: ResolvedFlattenSourceEntry[] = [];
  for (const entry of entries) {
    const { node, transform } = entry;
    const projection = materializeNodeStyle(document, node.id);
    if (projection.issues.length > 0) {
      return failure(
        "unsupported-topology",
        projection.issues[0]?.message ?? `Vector ${node.id} Style is invalid`,
      );
    }
    if (!projection.node) {
      return failure(
        "unsupported-topology",
        `Flatten source ${node.id} is unavailable`,
      );
    }
    if (entry.contribution === "all") {
      if (projection.node.kind === "image") {
        const image = flattenImageNode(document, projection.node, transform);
        if (!image.ok) {
          return failure("unsupported-topology", image.message);
        }
        resolved.push({ clips: entry.clips, node: image.node });
        continue;
      }
      if (
        !isFlattenSourceNode(projection.node) &&
        projection.node.kind !== "text"
      ) {
        return failure(
          "unsupported-topology",
          `Flatten source ${node.id} changed kind during Style resolution`,
        );
      }
      resolved.push({
        clips: entry.clips,
        node: { ...projection.node, transform },
      });
      continue;
    }
    if (projection.node.kind !== "frame") {
      return failure(
        "unsupported-topology",
        `Flatten source ${node.id} changed kind during Style resolution`,
      );
    }
    resolved.push({
      clips: entry.clips,
      node: frameContributionNode(
        projection.node,
        transform,
        entry.contribution,
      ),
    });
  }
  return { ok: true, nodes: resolved };
}

function analyzeFlattenSelection(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): ({ ok: true } & FlattenSelection) | FlattenFailure {
  const selection = analyzeContainerSelection(document, pageId, nodeIds, {
    action: "Flatten",
    minimum: 1,
  });
  if (!selection.ok) {
    return failure("unsupported-topology", selection.message);
  }
  if (
    selection.parentId &&
    document.nodesById[selection.parentId]?.kind === "boolean"
  ) {
    return failure(
      "unsupported-topology",
      "Flattening Boolean operands requires leaving Boolean edit scope",
    );
  }
  const nodes = selection.ordered.map((nodeId) => document.nodesById[nodeId]!);
  const unsupported = nodes.find(
    (node) =>
      !isFlattenSourceNode(node) &&
      node.kind !== "group" &&
      node.kind !== "frame" &&
      node.kind !== "image" &&
      node.kind !== "text",
  );
  if (unsupported) {
    return failure(
      "unsupported-topology",
      `Flatten currently supports Frame, Group, Boolean, Text, Image, Rectangle, Ellipse, Line, Polygon, Star, Path, and Vector layers; received ${unsupported.kind} ${unsupported.id}`,
    );
  }
  const sourceEntries: FlattenSourceEntry[] = [];
  for (const node of nodes) {
    const collected = collectFlattenSources(
      document,
      node,
      node.transform,
      [],
      sourceEntries,
    );
    if (!collected.ok) return collected;
  }
  if (sourceEntries.length === 0) {
    return failure(
      "unsupported-topology",
      "Flatten requires at least one visible supported geometry layer",
    );
  }
  return {
    ok: true,
    nodes: sourceEntries,
    ordered: selection.ordered,
    parentId: selection.parentId,
    siblings: selection.siblings,
    sourceNode: nodes[0]!,
  };
}

function buildFlattenedVectorNetwork(
  document: DesignDocument,
  pageId: string,
  entries: readonly ResolvedFlattenSourceEntry[],
  provider: VectorGeometryProvider,
  idPrefix: string,
  textRunLayoutProvider: TextRunLayoutProvider<FlattenTextRunStyle> | undefined,
): { ok: true; network: VectorNetwork } | FlattenFailure {
  const booleanResolution = entries.some(({ node }) => node.kind === "boolean")
    ? createBooleanGeometryResolver(provider).resolve(document, pageId)
    : null;
  const networks: VectorNetwork[] = [];
  for (const [nodeIndex, entry] of entries.entries()) {
    const { clips, node } = entry;
    if (node.kind === "text") {
      const text = flattenTextNetworks(
        node,
        clips,
        provider,
        `${idPrefix}_node_${nodeIndex}_text`,
        textRunLayoutProvider,
      );
      if (!text.ok) return text;
      networks.push(...text.networks);
      continue;
    }
    const fills = flattenFillNetworks(
      node,
      clips,
      provider,
      `${idPrefix}_node_${nodeIndex}_fill`,
      booleanResolution,
    );
    if (!fills.ok) return fills;
    networks.push(...fills.networks);
    const stroke = flattenStrokeNetwork(
      node,
      clips,
      provider,
      `${idPrefix}_node_${nodeIndex}_stroke`,
      booleanResolution,
    );
    if (!stroke.ok) return stroke;
    if (stroke.network) networks.push(stroke.network);
  }
  const merged = mergeVectorNetworks(networks);
  return merged.ok
    ? { ok: true, network: merged.network }
    : failure("invalid-geometry", merged.message);
}

function flattenTextNetworks(
  node: TextNode,
  clips: readonly FlattenClip[],
  provider: VectorGeometryProvider,
  idPrefix: string,
  textRunLayoutProvider: TextRunLayoutProvider<FlattenTextRunStyle> | undefined,
): { ok: true; networks: VectorNetwork[] } | FlattenFailure {
  const resolved = resolveFlattenTextGlyphs(node, textRunLayoutProvider);
  if (!resolved.ok) {
    return failure("unsupported-topology", resolved.message);
  }
  const networks: VectorNetwork[] = [];
  for (const [index, glyph] of resolved.glyphs.entries()) {
    if (hasVisiblePaint(glyph.fills)) {
      const fill = materializePaintedPath(
        glyph.path,
        "nonzero",
        glyph.transform,
        glyph.fills,
        clips,
        provider,
        `${idPrefix}_${index}_fill`,
      );
      if (!fill.ok) return fill;
      if (fill.network) networks.push(fill.network);
    }
    if (
      node.properties.strokeWidth <= 0 ||
      !hasVisiblePaint(node.properties.strokes)
    ) {
      continue;
    }
    const outline = outlineVectorPath(
      { path: glyph.path, fillRule: "nonzero" },
      {
        align: node.properties.strokeAlign ?? "center",
        cap:
          node.properties.strokeCap === "round" ||
          node.properties.strokeCap === "square"
            ? node.properties.strokeCap
            : "butt",
        ...(node.properties.dashPattern === undefined
          ? {}
          : { dashPattern: node.properties.dashPattern }),
        join: node.properties.strokeJoin ?? "miter",
        miterLimit: 4,
        width: node.properties.strokeWidth,
      },
      provider,
      `${idPrefix}_${index}_stroke_local`,
    );
    if (!outline.ok) return failure("invalid-geometry", outline.message);
    const serialized = serializeVectorNetwork(outline.network);
    if (!serialized.ok) {
      return failure("invalid-geometry", "Text stroke outline is invalid");
    }
    const stroke = materializePaintedPath(
      serialized.path,
      "nonzero",
      glyph.transform,
      node.properties.strokes,
      clips,
      provider,
      `${idPrefix}_${index}_stroke`,
    );
    if (!stroke.ok) return stroke;
    if (stroke.network) networks.push(stroke.network);
  }
  return { ok: true, networks };
}

function flattenFillNetworks(
  node: FlattenSourceNode,
  clips: readonly FlattenClip[],
  provider: VectorGeometryProvider,
  idPrefix: string,
  booleanResolution: BooleanGeometryResolution | null,
): { ok: true; networks: VectorNetwork[] } | FlattenFailure {
  if ("network" in node.properties) {
    const networks: VectorNetwork[] = [];
    for (const [
      regionIndex,
      region,
    ] of node.properties.network.regions.entries()) {
      const paints = region.fills ?? node.properties.fills;
      if (!hasVisiblePaint(paints)) continue;
      const serialized = serializeVectorRegion(
        node.properties.network,
        region.id,
        node.properties.cornerRadius ?? 0,
        node.properties.cornerSmoothing ?? 0,
      );
      if (!serialized.ok) {
        return failure(
          "invalid-geometry",
          serialized.issues.map((issue) => issue.message).join("; "),
        );
      }
      const materialized = materializePaintedPath(
        serialized.path,
        region.windingRule,
        node.transform,
        paints,
        clips,
        provider,
        `${idPrefix}_${regionIndex}`,
      );
      if (!materialized.ok) return materialized;
      if (materialized.network) networks.push(materialized.network);
    }
    return { ok: true, networks };
  }
  if (!sourceHasFillGeometry(node) || !hasVisiblePaint(node.properties.fills)) {
    return { ok: true, networks: [] };
  }
  const source = resolveFlattenSourcePath(node, booleanResolution);
  if (!source.ok) return failure("unsupported-topology", source.message);
  const materialized = materializePaintedPath(
    source.path,
    source.fillRule,
    node.transform,
    node.properties.fills,
    clips,
    provider,
    idPrefix,
  );
  if (!materialized.ok) return materialized;
  return {
    ok: true,
    networks: materialized.network ? [materialized.network] : [],
  };
}

function flattenStrokeNetwork(
  node: FlattenSourceNode,
  clips: readonly FlattenClip[],
  provider: VectorGeometryProvider,
  idPrefix: string,
  booleanResolution: BooleanGeometryResolution | null,
): { ok: true; network?: VectorNetwork } | FlattenFailure {
  if (
    node.properties.strokeWidth <= 0 ||
    !hasVisiblePaint(node.properties.strokes)
  ) {
    return { ok: true };
  }
  const source = resolveFlattenSourcePath(node, booleanResolution);
  if (!source.ok) return failure("unsupported-topology", source.message);
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
    join: node.properties.strokeJoin ?? "miter",
    miterLimit: 4,
    width: node.properties.strokeWidth,
  } as const;
  const sourcePath = { path: source.path, fillRule: source.fillRule } as const;
  const outlined = outlineFlattenStroke(
    node,
    sourcePath,
    outlineOptions,
    provider,
    idPrefix,
  );
  if (!outlined.ok) return failure("invalid-geometry", outlined.message);
  const serialized = serializeVectorNetwork(outlined.network);
  if (!serialized.ok) {
    return failure("invalid-geometry", "Stroke outline is invalid");
  }
  const visiblePath = combineLineEndpointGeometry(
    node,
    serialized.path,
    outlineOptions,
    provider,
  );
  if (!visiblePath.ok) return visiblePath;
  return materializePaintedPath(
    visiblePath.path,
    "nonzero",
    node.transform,
    node.properties.strokes,
    clips,
    provider,
    idPrefix,
  );
}

function outlineFlattenStroke(
  node: FlattenSourceNode,
  sourcePath: {
    readonly fillRule: "evenodd" | "nonzero";
    readonly path: string;
  },
  options: VectorOutlineOptions,
  provider: VectorGeometryProvider,
  idPrefix: string,
) {
  return "network" in node.properties
    ? outlineVectorNetworkStroke(
        node.properties.network,
        sourcePath,
        options,
        provider,
        `${idPrefix}_local`,
      )
    : outlineVectorPath(sourcePath, options, provider, `${idPrefix}_local`);
}

function combineLineEndpointGeometry(
  node: FlattenSourceNode,
  strokePath: string,
  options: VectorOutlineOptions,
  provider: VectorGeometryProvider,
): { ok: true; path: string } | FlattenFailure {
  if (
    node.kind !== "line" ||
    (node.properties.startEndpoint === "none" &&
      node.properties.endEndpoint === "none")
  ) {
    return { ok: true, path: strokePath };
  }
  const start = resolveLineEndpointPoint(node.size, node.properties.start);
  const end = resolveLineEndpointPoint(node.size, node.properties.end);
  const paths: VectorPathInput[] = [{ path: strokePath, fillRule: "nonzero" }];
  for (const position of ["start", "end"] as const) {
    const endpoint =
      position === "start"
        ? node.properties.startEndpoint
        : node.properties.endEndpoint;
    if (endpoint === "none") continue;
    const resolved = resolveLineEndpointVisiblePath({
      endpoint,
      lineEnd: end,
      lineStart: start,
      position,
      provider,
      strokeCap: options.cap,
      strokeJoin: options.join,
      strokeWidth: options.width,
    });
    if (!resolved.ok) return failure("invalid-geometry", resolved.message);
    paths.push({ path: resolved.path, fillRule: resolved.fillRule });
  }
  const combined = provider.combine(paths, "union");
  return combined.ok
    ? { ok: true, path: combined.path }
    : failure("invalid-geometry", combined.message);
}

function materializePaintedPath(
  path: string,
  fillRule: "evenodd" | "nonzero",
  transform: Transform,
  paints: readonly Paint[],
  clips: readonly FlattenClip[],
  provider: VectorGeometryProvider,
  idPrefix: string,
): { ok: true; network?: VectorNetwork } | FlattenFailure {
  const prepared = prepareFlattenPath(
    { path, fillRule },
    transform,
    clips,
    provider,
  );
  if (!prepared.ok) return prepared;
  if (!prepared.path) return { ok: true };
  const materialized = materializeVectorNetwork(
    prepared.path.path,
    prepared.path.fillRule,
    idPrefix,
  );
  if (!materialized.ok) {
    return failure("invalid-geometry", materialized.message);
  }
  if (materialized.network.regions.length === 0) {
    return failure(
      "unsupported-topology",
      "Flattened fill geometry must contain a closed region",
    );
  }
  for (const region of materialized.network.regions) {
    region.fills = paints.map((paint) => structuredClone(paint));
  }
  return { ok: true, network: materialized.network };
}

function prepareFlattenPath(
  source: { fillRule: "evenodd" | "nonzero"; path: string },
  transform: Transform,
  clips: readonly FlattenClip[],
  provider: VectorGeometryProvider,
):
  | {
      ok: true;
      path?: { fillRule: "evenodd" | "nonzero"; path: string };
    }
  | FlattenFailure {
  let prepared = provider.transform(source, transform);
  if (!prepared.ok) return failure("invalid-geometry", prepared.message);
  if (prepared.empty) return { ok: true };
  for (const clip of clips) {
    const clipSource = flattenSourcePath(clip.node);
    if (!clipSource.ok) {
      return failure("unsupported-topology", clipSource.message);
    }
    const transformedClip = provider.transform(clipSource, clip.transform);
    if (!transformedClip.ok) {
      return failure("invalid-geometry", transformedClip.message);
    }
    if (transformedClip.empty) return { ok: true };
    prepared = provider.combine([prepared, transformedClip], "intersect");
    if (!prepared.ok) return failure("invalid-geometry", prepared.message);
    if (prepared.empty) return { ok: true };
  }
  return {
    ok: true,
    path: { fillRule: prepared.fillRule, path: prepared.path },
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
    return failure("invalid-geometry", "Flattened Vector normalization failed");
  }
  return {
    ok: true,
    node: {
      id,
      kind: "vector",
      name: `${source.name || "Vector"} Flattened`,
      parentId,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, normalized.offset.x, normalized.offset.y],
      size: {
        width: normalized.bounds.width,
        height: normalized.bounds.height,
      },
      exportSettings: [],
      opacity: 1,
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

function flattenAppearanceIssue(node: DesignNode): string | null {
  if (!node.visible)
    return `Hidden ${node.kind} ${node.id} cannot be flattened`;
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

function collectFlattenSources(
  document: DesignDocument,
  node: DesignNode,
  transform: Transform,
  clips: readonly FlattenClip[],
  entries: FlattenSourceEntry[],
): { ok: true } | FlattenFailure {
  const appearanceIssue = flattenAppearanceIssue(node);
  if (appearanceIssue) return failure("unsupported-topology", appearanceIssue);
  if (isFlattenSourceNode(node)) {
    entries.push({ clips, contribution: "all", node, transform });
    return { ok: true };
  }
  if (node.kind === "text") {
    entries.push({ clips, contribution: "all", node, transform });
    return { ok: true };
  }
  if (node.kind === "image") {
    entries.push({ clips, contribution: "all", node, transform });
    return { ok: true };
  }
  if (node.kind === "frame") {
    entries.push({ clips, contribution: "fill", node, transform });
    const childClips = node.properties.clipsContent
      ? [
          ...clips,
          {
            node: frameContributionNode(node, transform, "fill"),
            transform,
          },
        ]
      : clips;
    for (const childId of node.childIds) {
      const child = document.nodesById[childId];
      if (!child || child.parentId !== node.id) {
        return failure(
          "unsupported-topology",
          `Frame ${node.id} contains an invalid child ${childId}`,
        );
      }
      const collected = collectFlattenSources(
        document,
        child,
        multiplyTransforms(transform, child.transform),
        childClips,
        entries,
      );
      if (!collected.ok) return collected;
    }
    entries.push({ clips, contribution: "stroke", node, transform });
    return { ok: true };
  }
  if (node.kind !== "group") {
    return failure(
      "unsupported-topology",
      `Flatten descendant ${node.kind} ${node.id} cannot yet be flattened exactly`,
    );
  }
  for (const childId of node.childIds) {
    const child = document.nodesById[childId];
    if (!child || child.parentId !== node.id) {
      return failure(
        "unsupported-topology",
        `Group ${node.id} contains an invalid child ${childId}`,
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

function frameContributionNode(
  frame: FrameNode,
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

function isFlattenSourceNode(node: DesignNode): node is FlattenSourceNode {
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

function resolveFlattenSourcePath(
  node: FlattenSourceNode,
  booleanResolution: BooleanGeometryResolution | null,
): FlattenSourcePath {
  if (node.kind !== "boolean") return flattenSourcePath(node);
  const resolved = booleanResolution?.resultsByNodeId.get(node.id);
  if (resolved && !resolved.empty && resolved.path) {
    return {
      ok: true,
      fillRule: resolved.fillRule,
      path: resolved.path,
    };
  }
  const issue = booleanResolution?.issues.find(
    ({ nodeId }) => nodeId === node.id,
  );
  return {
    ok: false,
    message:
      issue?.message ??
      `Boolean ${node.id} does not resolve to non-empty editable geometry`,
  };
}

function hasVisiblePaint(paints: readonly Paint[]): boolean {
  return paints.some((paint) => paint.visible !== false);
}

function failure(
  code: FlattenFailure["code"],
  message: string,
): FlattenFailure {
  return { ok: false, code, message };
}
