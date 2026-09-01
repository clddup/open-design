import type {
  DesignDocument,
  Paint,
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
import type { TextRunLayoutProvider } from "@opendesign/text-service";
import {
  flattenFailure,
  type FlattenClip,
  type FlattenFailure,
  type ResolvedFlattenSourceEntry,
} from "./vector-flatten-internal.js";
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

export function buildFlattenedVectorNetwork(
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
    : flattenFailure("invalid-geometry", merged.message);
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
    return flattenFailure("unsupported-topology", resolved.message);
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
    if (!outline.ok) return flattenFailure("invalid-geometry", outline.message);
    const serialized = serializeVectorNetwork(outline.network);
    if (!serialized.ok) {
      return flattenFailure(
        "invalid-geometry",
        "Text stroke outline is invalid",
      );
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
        return flattenFailure(
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
  if (!source.ok) return flattenFailure("unsupported-topology", source.message);
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
  if (!source.ok) return flattenFailure("unsupported-topology", source.message);
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
  if (!outlined.ok) return flattenFailure("invalid-geometry", outlined.message);
  const serialized = serializeVectorNetwork(outlined.network);
  if (!serialized.ok) {
    return flattenFailure("invalid-geometry", "Stroke outline is invalid");
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
    if (!resolved.ok)
      return flattenFailure("invalid-geometry", resolved.message);
    paths.push({ path: resolved.path, fillRule: resolved.fillRule });
  }
  const combined = provider.combine(paths, "union");
  return combined.ok
    ? { ok: true, path: combined.path }
    : flattenFailure("invalid-geometry", combined.message);
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
    return flattenFailure("invalid-geometry", materialized.message);
  }
  if (materialized.network.regions.length === 0) {
    return flattenFailure(
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
  if (!prepared.ok) return flattenFailure("invalid-geometry", prepared.message);
  if (prepared.empty) return { ok: true };
  for (const clip of clips) {
    const clipSource = flattenSourcePath(clip.node);
    if (!clipSource.ok) {
      return flattenFailure("unsupported-topology", clipSource.message);
    }
    const transformedClip = provider.transform(clipSource, clip.transform);
    if (!transformedClip.ok) {
      return flattenFailure("invalid-geometry", transformedClip.message);
    }
    if (transformedClip.empty) return { ok: true };
    prepared = provider.combine([prepared, transformedClip], "intersect");
    if (!prepared.ok)
      return flattenFailure("invalid-geometry", prepared.message);
    if (prepared.empty) return { ok: true };
  }
  return {
    ok: true,
    path: { fillRule: prepared.fillRule, path: prepared.path },
  };
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
