import {
  isFrameLikeNode,
  resolveLineEndpointPoint,
  type DesignDocument,
  type DesignNode,
  type LineEndpoint,
  type Rect,
  type Transform,
} from "@opendesign/design-contracts";
import type { BooleanGeometryResolution } from "@opendesign/geometry-service/boolean-resolver";
import type { VectorFillRule } from "@opendesign/geometry-service/vector-path";
import {
  resolvePathPropertiesData,
  serializeVectorRegion,
  vectorNetworkHasFillRegion,
} from "@opendesign/geometry-service/editable-vector";
import {
  projectVectorNetworkStrokePaths,
  vectorNetworkHasVertexStrokeOverrides,
} from "@opendesign/geometry-service/vector-stroke-appearance";
import { applyToPoint } from "transformation-matrix";
import {
  applyExportNodeAppearance,
  applyExportShapeAppearance,
} from "./svg-appearance.js";
import {
  activeSvgMaskMode,
  appendSvgFrameClipDefinition,
  createSvgMaskDefinition,
  stripSvgExportedLayerIdentity,
  type SvgMaskMode,
} from "./svg-mask-clip.js";
import { createSvgIssue, type SvgInterchangeIssue } from "./svg-issues.js";
import { appendSvgLineEndpointDefinition } from "./svg-line-endpoints.js";
import { writeSvgRegularShape } from "./svg-regular-shapes.js";
import { writeSvgText } from "./svg-text.js";
import { writeSvgEditableVector } from "./svg-editable-vector.js";
import { transformToSvgMatrix } from "./svg-normalize.js";
import {
  formatSvgNumber,
  sanitizeSvgXmlId,
  serializeSvgMatrixAttribute,
  SVG_NAMESPACE,
} from "./svg-serialize.js";

export interface SvgResolvedBooleanPath {
  bounds: Rect | null;
  empty: boolean;
  fillRule: VectorFillRule;
  path: string;
  provider: string;
  providerVersion: string;
}

export interface SvgNodeExportRequest {
  document: DesignDocument;
  includeLayerIds?: boolean;
  resolvedBooleanPaths?: Readonly<Record<string, SvgResolvedBooleanPath>>;
  rootTransformOverrides?: Readonly<Record<string, Transform>>;
}

interface ExportContext {
  definitions: Element;
  document: Document;
  exportedNodeIds: string[];
  frameClipSequence: number;
  gradientSequence: number;
  filterSequence: number;
  issues: SvgInterchangeIssue[];
  maskSequence: number;
  markerSequence: number;
  request: SvgNodeExportRequest;
  visiting: Set<string>;
}

interface ExportNodeOptions {
  maskSource?: boolean;
  selectedRoot?: boolean;
}

export function resolvedBooleanPathsForSvg(
  resolution: BooleanGeometryResolution,
): Readonly<Record<string, SvgResolvedBooleanPath>> {
  return Object.fromEntries(
    [...resolution.resultsByNodeId].map(([nodeId, result]) => [
      nodeId,
      {
        bounds: result.bounds ? { ...result.bounds } : null,
        empty: result.empty,
        fillRule: result.fillRule,
        path: result.path,
        provider: result.provider,
        providerVersion: result.providerVersion,
      },
    ]),
  );
}

export function exportSvgNodeRoots(input: {
  definitions: Element;
  document: Document;
  issues: SvgInterchangeIssue[];
  request: SvgNodeExportRequest;
  root: Element;
  rootNodeIds: readonly string[];
}): readonly string[] {
  const context: ExportContext = {
    definitions: input.definitions,
    document: input.document,
    exportedNodeIds: [],
    frameClipSequence: 0,
    filterSequence: 0,
    gradientSequence: 0,
    issues: input.issues,
    maskSequence: 0,
    markerSequence: 0,
    request: input.request,
    visiting: new Set(),
  };
  for (const rootNodeId of input.rootNodeIds) {
    const element = exportNode(context, rootNodeId, { selectedRoot: true });
    if (element) input.root.appendChild(element);
  }
  return context.exportedNodeIds;
}

function exportNode(
  context: ExportContext,
  nodeId: string,
  options: ExportNodeOptions = {},
): Element | null {
  const node = context.request.document.nodesById[nodeId];
  if (!node) {
    context.issues.push(
      createSvgIssue("invalid-root", "error", `SVG node ${nodeId} is missing`, {
        nodeId,
      }),
    );
    return null;
  }
  if (context.visiting.has(nodeId)) {
    context.issues.push(
      createSvgIssue("invalid-root", "error", `SVG node ${nodeId} is cyclic`, {
        nodeId,
      }),
    );
    return null;
  }
  context.visiting.add(nodeId);
  context.exportedNodeIds.push(nodeId);
  try {
    if (node.kind === "group" || isFrameLikeNode(node)) {
      const group = context.document.createElementNS(SVG_NAMESPACE, "g");
      applyExportMetadata(context, group, node);
      applyExportTransform(context, group, node, options.selectedRoot === true);
      applyExportNodeAppearance(
        context,
        group,
        node,
        options.maskSource === true,
      );
      if (isFrameLikeNode(node)) {
        const background = context.document.createElementNS(
          SVG_NAMESPACE,
          "rect",
        );
        background.setAttribute("width", formatSvgNumber(node.size.width));
        background.setAttribute("height", formatSvgNumber(node.size.height));
        background.setAttribute(
          "rx",
          formatSvgNumber(node.properties.cornerRadius),
        );
        background.setAttribute("data-opendesign-frame-background", "true");
        applyExportShapeAppearance(
          context,
          background,
          node.id,
          node.properties,
        );
        group.appendChild(background);
        if (node.properties.clipsContent) {
          const clipId = appendFrameClipDefinition(context, node);
          const content = context.document.createElementNS(SVG_NAMESPACE, "g");
          content.setAttribute("data-opendesign-frame-content", "true");
          content.setAttribute("clip-path", `url(#${clipId})`);
          exportContainerChildren(context, content, node.childIds);
          group.appendChild(content);
        } else {
          exportContainerChildren(context, group, node.childIds);
        }
      } else {
        exportContainerChildren(context, group, node.childIds);
      }
      return group;
    }

    if (node.kind === "boolean") {
      const resolved = context.request.resolvedBooleanPaths?.[node.id];
      if (!resolved || (!resolved.empty && resolved.path.length === 0)) {
        context.issues.push(
          createSvgIssue(
            "missing-boolean-geometry",
            "error",
            `Boolean ${node.id} requires an explicit resolved path for SVG export`,
            { nodeId: node.id },
          ),
        );
        return null;
      }
      const path = context.document.createElementNS(SVG_NAMESPACE, "path");
      path.setAttribute("d", resolved.empty ? "M 0 0" : resolved.path);
      path.setAttribute(
        "fill-rule",
        node.properties.fillRule ?? resolved.fillRule,
      );
      path.setAttribute("data-opendesign-source-kind", "boolean");
      path.setAttribute("data-opendesign-geometry-provider", resolved.provider);
      path.setAttribute(
        "data-opendesign-geometry-provider-version",
        resolved.providerVersion,
      );
      applyExportMetadata(context, path, node);
      applyExportTransform(context, path, node, options.selectedRoot === true);
      applyExportNodeAppearance(
        context,
        path,
        node,
        options.maskSource === true,
      );
      applyExportShapeAppearance(context, path, node.id, node.properties);
      context.issues.push(
        createSvgIssue(
          "boolean-flattened",
          "warning",
          `Boolean ${node.id} is exported as its standard SVG result path; editable operands remain only in the OpenDesign document`,
          { nodeId: node.id },
        ),
      );
      return path;
    }

    let element: Element;
    if (node.kind === "rectangle") {
      element = context.document.createElementNS(SVG_NAMESPACE, "rect");
      element.setAttribute("width", formatSvgNumber(node.size.width));
      element.setAttribute("height", formatSvgNumber(node.size.height));
      element.setAttribute("rx", formatSvgNumber(node.properties.cornerRadius));
    } else if (node.kind === "ellipse") {
      element = context.document.createElementNS(SVG_NAMESPACE, "ellipse");
      element.setAttribute("cx", formatSvgNumber(node.size.width / 2));
      element.setAttribute("cy", formatSvgNumber(node.size.height / 2));
      element.setAttribute("rx", formatSvgNumber(node.size.width / 2));
      element.setAttribute("ry", formatSvgNumber(node.size.height / 2));
    } else if (node.kind === "line") {
      element = context.document.createElementNS(SVG_NAMESPACE, "line");
      const start = resolveLineEndpointPoint(node.size, node.properties.start);
      const end = resolveLineEndpointPoint(node.size, node.properties.end);
      element.setAttribute("x1", formatSvgNumber(start.x));
      element.setAttribute("y1", formatSvgNumber(start.y));
      element.setAttribute("x2", formatSvgNumber(end.x));
      element.setAttribute("y2", formatSvgNumber(end.y));
      applyExportLineEndpoints(context, element, node);
    } else if (node.kind === "polygon" || node.kind === "star") {
      if (node.properties.cornerRadius > 0) {
        context.issues.push(
          createSvgIssue(
            "regular-shape-fidelity-unsupported",
            "error",
            `Rounded ${node.kind} ${node.id} requires an exact outline before SVG export`,
            { nodeId: node.id },
          ),
        );
        return null;
      }
      element = context.document.createElementNS(SVG_NAMESPACE, "polygon");
      writeSvgRegularShape(element, node);
    } else if (node.kind === "path" || node.kind === "vector") {
      const path = resolvePathPropertiesData(node.properties);
      if (path === null) {
        context.issues.push(
          createSvgIssue(
            "invalid-geometry",
            "error",
            `Editable vector network ${node.id} is invalid and cannot be exported`,
            { nodeId: node.id },
          ),
        );
        return null;
      }
      if (
        "network" in node.properties &&
        (node.properties.network.regions.some(
          (region) => region.fills !== undefined,
        ) ||
          vectorNetworkHasVertexStrokeOverrides(node.properties.network))
      ) {
        return exportEditableVectorRegions(context, node, path, options);
      }
      element = context.document.createElementNS(SVG_NAMESPACE, "path");
      element.setAttribute("d", path);
      element.setAttribute("fill-rule", node.properties.fillRule ?? "nonzero");
      if (
        "network" in node.properties &&
        !writeSvgEditableVector(
          element,
          node.properties.network,
          node.properties.fills,
          node.properties.cornerRadius ?? 0,
          node.properties.cornerSmoothing ?? 0,
        )
      ) {
        context.issues.push(
          createSvgIssue(
            "size-limit",
            "warning",
            `Editable vector metadata for ${node.id} exceeds its interchange limit and was omitted; standard path geometry remains exported`,
            { nodeId: node.id },
          ),
        );
      }
    } else if (node.kind === "text") {
      element = context.document.createElementNS(SVG_NAMESPACE, "text");
      const result = writeSvgText(element, node);
      if (!result.ok) {
        context.issues.push(
          createSvgIssue("malformed-svg", "error", result.message, {
            nodeId: node.id,
          }),
        );
        return null;
      }
      if (!result.metadataWritten) {
        context.issues.push(
          createSvgIssue(
            "size-limit",
            "warning",
            `Editable text metadata for ${node.id} exceeds its interchange limit and was omitted; standard SVG text remains exported`,
            { nodeId: node.id },
          ),
        );
      }
      context.issues.push(
        createSvgIssue(
          "text-font-not-embedded",
          "warning",
          `Text ${node.id} references ${node.properties.fontFamily} ${node.properties.fontStyleName ?? "(unresolved face)"}; the font is not embedded in this SVG`,
          { nodeId: node.id },
        ),
        createSvgIssue(
          "text-layout-fidelity",
          "warning",
          `Text ${node.id} uses ${node.properties.textResize} resizing, ${node.properties.textWrap} wrapping, ${node.properties.textTruncation} truncation, and ${node.properties.maxLines ?? "box-height"} max lines inside an OpenDesign text box; standard SVG line positions cannot preserve automatic sizing, wrapping, truncation, paragraph layout, justify, or exact font shaping without OpenDesign metadata`,
          { nodeId: node.id },
        ),
      );
    } else {
      context.issues.push(
        createSvgIssue(
          "unsupported-element",
          "error",
          `${node.kind} node ${node.id} is not supported by the current editable SVG export slice`,
          { nodeId: node.id },
        ),
      );
      return null;
    }
    applyExportMetadata(context, element, node);
    applyExportTransform(context, element, node, options.selectedRoot === true);
    applyExportNodeAppearance(
      context,
      element,
      node,
      options.maskSource === true,
    );
    applyExportShapeAppearance(
      context,
      element,
      node.id,
      "network" in node.properties &&
        !vectorNetworkHasFillRegion(node.properties.network)
        ? { ...node.properties, fills: [] }
        : node.properties,
    );
    return element;
  } finally {
    context.visiting.delete(nodeId);
  }
}

function exportEditableVectorRegions(
  context: ExportContext,
  node: Extract<DesignNode, { kind: "path" | "vector" }>,
  pathData: string,
  options: ExportNodeOptions,
): Element {
  if (!("network" in node.properties)) {
    throw new Error("Editable vector region export requires a network");
  }
  const group = context.document.createElementNS(SVG_NAMESPACE, "g");
  group.setAttribute("data-opendesign-vector-region-container", "true");
  applyExportMetadata(context, group, node);
  applyExportTransform(context, group, node, options.selectedRoot === true);
  applyExportNodeAppearance(context, group, node, options.maskSource === true);

  if (
    node.properties.network.regions.every(
      (region) => region.fills !== undefined,
    ) &&
    node.properties.fills.some((paint) => paint.type === "image")
  ) {
    context.issues.push(
      createSvgIssue(
        "unsupported-paint",
        "error",
        `Image fallback fill on ${node.id} is not supported by the current SVG vector slice`,
        { nodeId: node.id },
      ),
    );
  }

  for (const region of node.properties.network.regions) {
    const serialized = serializeVectorRegion(
      node.properties.network,
      region.id,
      node.properties.cornerRadius ?? 0,
      node.properties.cornerSmoothing ?? 0,
    );
    if (!serialized.ok) continue;
    const element = context.document.createElementNS(SVG_NAMESPACE, "path");
    element.setAttribute("d", serialized.path);
    element.setAttribute("fill-rule", region.windingRule);
    element.setAttribute("data-opendesign-vector-region-id", region.id);
    applyExportShapeAppearance(context, element, `${node.id}_${region.id}`, {
      ...node.properties,
      fills: region.fills ?? node.properties.fills,
      strokes: [],
      strokeWidth: 0,
    });
    group.appendChild(element);
  }

  const source = context.document.createElementNS(SVG_NAMESPACE, "path");
  source.setAttribute("d", pathData);
  source.setAttribute("fill-rule", node.properties.fillRule ?? "nonzero");
  source.setAttribute("data-opendesign-vector-source", "true");
  source.setAttribute("data-opendesign-kind", node.kind);
  source.setAttribute("data-name", node.name);
  applyExportShapeAppearance(context, source, node.id, {
    ...node.properties,
    fills: [],
  });
  if (vectorNetworkHasVertexStrokeOverrides(node.properties.network)) {
    const strokeParts = appendEditableVectorStrokeParts(context, group, node);
    if (strokeParts) source.setAttribute("display", "none");
  }
  if (
    !writeSvgEditableVector(
      source,
      node.properties.network,
      node.properties.fills,
      node.properties.cornerRadius ?? 0,
      node.properties.cornerSmoothing ?? 0,
    )
  ) {
    group.removeAttribute("data-opendesign-vector-region-container");
    source.removeAttribute("data-opendesign-vector-source");
    context.issues.push(
      createSvgIssue(
        "size-limit",
        "warning",
        `Editable vector metadata for ${node.id} exceeds its interchange limit and was omitted; standard region paths remain exported`,
        { nodeId: node.id },
      ),
    );
  }
  group.appendChild(source);
  return group;
}

function appendEditableVectorStrokeParts(
  context: ExportContext,
  group: Element,
  node: Extract<DesignNode, { kind: "path" | "vector" }>,
): boolean {
  if (!("network" in node.properties)) return false;
  const projected = projectVectorNetworkStrokePaths(
    node.properties.network,
    {
      strokeCap: node.properties.strokeCap ?? "none",
      strokeJoin: node.properties.strokeJoin ?? "miter",
    },
    node.properties.strokeWidth,
    node.properties.cornerRadius ?? 0,
    node.properties.cornerSmoothing ?? 0,
    node.properties.dashPattern ?? [],
  );
  if (!projected.ok) {
    context.issues.push(
      createSvgIssue("invalid-geometry", "error", projected.message, {
        nodeId: node.id,
      }),
    );
    return false;
  }
  projected.paths.forEach((part, index) => {
    const element = context.document.createElementNS(SVG_NAMESPACE, "path");
    element.setAttribute("d", part.path);
    element.setAttribute("fill", "none");
    element.setAttribute("data-opendesign-vector-stroke-part", String(index));
    applyExportShapeAppearance(context, element, `${node.id}_stroke_${index}`, {
      ...node.properties,
      fills: [],
      dashPattern: [],
      strokeAlign: "center",
      strokeCap: part.cap === "butt" ? "none" : part.cap,
      strokeJoin: part.join,
    });
    group.appendChild(element);
  });
  return true;
}

function applyExportLineEndpoints(
  context: ExportContext,
  element: Element,
  node: Extract<DesignNode, { kind: "line" }>,
): void {
  const append = (position: "start" | "end", endpoint: LineEndpoint): void => {
    if (endpoint === "none") return;
    const id = `od_line_marker_${++context.markerSequence}_${sanitizeSvgXmlId(node.id)}_${position}`;
    appendSvgLineEndpointDefinition({
      definitions: context.definitions,
      document: context.document,
      endpoint,
      id,
    });
    element.setAttribute(`marker-${position}`, `url(#${id})`);
  };
  append("start", node.properties.startEndpoint);
  append("end", node.properties.endEndpoint);
}

function exportContainerChildren(
  context: ExportContext,
  parent: Element,
  childIds: readonly string[],
): void {
  let index = 0;
  while (index < childIds.length) {
    const childId = childIds[index]!;
    const childNode = context.request.document.nodesById[childId];
    const mode = activeSvgMaskMode(childNode);
    if (!mode) {
      const child = exportNode(context, childId);
      if (child) parent.appendChild(child);
      index += 1;
      continue;
    }

    let runEnd = index + 1;
    while (runEnd < childIds.length) {
      const candidate = context.request.document.nodesById[childIds[runEnd]!];
      if (activeSvgMaskMode(candidate)) break;
      runEnd += 1;
    }
    const maskedNodeIds = childIds.slice(index + 1, runEnd);
    const source = exportNode(context, childId, { maskSource: true });
    if (!source) {
      index = runEnd;
      continue;
    }

    const referenceId = `od_${mode === "outline" ? "clip" : "mask"}_${++context.maskSequence}_${sanitizeSvgXmlId(childId)}`;
    source.setAttribute("data-opendesign-mask-source", "true");
    source.setAttribute("data-opendesign-mask-mode", mode);
    source.setAttribute("data-opendesign-mask-reference", referenceId);

    const definition = appendMaskDefinition(
      context,
      referenceId,
      mode,
      childId,
      maskedNodeIds,
    );
    if (mode === "clipping") {
      parent.appendChild(source);
      const definitionSource = source.cloneNode(true) as Element;
      stripSvgExportedLayerIdentity(definitionSource);
      definition.appendChild(definitionSource);
    } else {
      definition.appendChild(source);
    }
    context.definitions.appendChild(definition);

    const run = context.document.createElementNS(SVG_NAMESPACE, "g");
    run.setAttribute("data-opendesign-mask-run", "true");
    run.setAttribute("data-opendesign-mask-mode", mode);
    run.setAttribute("data-opendesign-mask-reference", referenceId);
    run.setAttribute(
      mode === "outline" ? "clip-path" : "mask",
      `url(#${referenceId})`,
    );
    if (mode === "outline" && childNode && childNode.opacity !== 1) {
      run.setAttribute("opacity", formatSvgNumber(childNode.opacity));
    }
    for (const maskedNodeId of maskedNodeIds) {
      const masked = exportNode(context, maskedNodeId);
      if (masked) run.appendChild(masked);
    }
    parent.appendChild(run);
    index = runEnd;
  }
}

function appendFrameClipDefinition(
  context: ExportContext,
  node: Extract<DesignNode, { kind: "frame" | "slot" }>,
): string {
  const clipId = `od_frame_clip_${++context.frameClipSequence}_${sanitizeSvgXmlId(node.id)}`;
  appendSvgFrameClipDefinition({
    definitions: context.definitions,
    document: context.document,
    height: node.size.height,
    id: clipId,
    radius: node.properties.cornerRadius,
    width: node.size.width,
  });
  return clipId;
}

function appendMaskDefinition(
  context: ExportContext,
  referenceId: string,
  mode: SvgMaskMode,
  sourceNodeId: string,
  maskedNodeIds: readonly string[],
): Element {
  return createSvgMaskDefinition({
    document: context.document,
    id: referenceId,
    mode,
    region: exportMaskRegion(context, [sourceNodeId, ...maskedNodeIds]),
  });
}

function exportMaskRegion(
  context: ExportContext,
  nodeIds: readonly string[],
): Rect | null {
  let bounds: Rect | null = null;
  for (const nodeId of nodeIds) {
    const node = context.request.document.nodesById[nodeId];
    if (!node) continue;
    const candidate = transformedNodeBounds(node);
    bounds = bounds ? unionRects(bounds, candidate) : candidate;
  }
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
  const padding = Math.max(
    1,
    Math.max(bounds.width, bounds.height) * 0.01,
    svgMaskVisualPadding(context.request.document, nodeIds),
  );
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

function svgMaskVisualPadding(
  document: DesignDocument,
  nodeIds: readonly string[],
): number {
  let maximum = 0;
  const visiting = new Set<string>();
  const visit = (nodeId: string, inheritedScale: number): void => {
    if (visiting.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;
    visiting.add(nodeId);
    const [a, b, c, d] = node.transform;
    const scale =
      inheritedScale * Math.max(Math.hypot(a, b), Math.hypot(c, d), 1e-6);
    if (
      node.kind !== "group" &&
      node.kind !== "image" &&
      node.kind !== "instance" &&
      node.kind !== "slice" &&
      node.properties.strokes.length > 0
    ) {
      const strokeFactor =
        node.properties.strokeAlign === "outside"
          ? 1
          : node.properties.strokeAlign === "inside"
            ? 0
            : 0.5;
      maximum = Math.max(
        maximum,
        node.properties.strokeWidth * strokeFactor * scale,
      );
    }
    for (const effect of node.effects ?? []) {
      if (effect.visible === false) continue;
      let expansion = 0;
      if (effect.type === "layer-blur" || effect.type === "background-blur") {
        expansion = effect.radius * 2;
      } else if (effect.type === "drop-shadow") {
        expansion =
          Math.max(Math.abs(effect.offset.x), Math.abs(effect.offset.y)) +
          effect.blur * 2 +
          Math.max(0, effect.spread);
      } else if (effect.type === "outer-glow") {
        expansion = effect.radius * 2 + Math.max(0, effect.spread);
      }
      maximum = Math.max(maximum, expansion * scale);
    }
    for (const childId of node.childIds) visit(childId, scale);
    visiting.delete(nodeId);
  };
  for (const nodeId of nodeIds) visit(nodeId, 1);
  return maximum;
}

function transformedNodeBounds(node: DesignNode): Rect {
  const matrix = transformToSvgMatrix(node.transform);
  const corners = [
    applyToPoint(matrix, { x: 0, y: 0 }),
    applyToPoint(matrix, { x: node.size.width, y: 0 }),
    applyToPoint(matrix, { x: 0, y: node.size.height }),
    applyToPoint(matrix, { x: node.size.width, y: node.size.height }),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function unionRects(left: Rect, right: Rect): Rect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: maxX - x, height: maxY - y };
}

function applyExportMetadata(
  context: ExportContext,
  element: Element,
  node: DesignNode,
): void {
  if (context.request.includeLayerIds) {
    element.setAttribute("id", sanitizeSvgXmlId(node.id));
    element.setAttribute("data-opendesign-id", node.id);
  }
  element.setAttribute("data-name", node.name);
  element.setAttribute("data-opendesign-kind", node.kind);
}

function applyExportTransform(
  context: ExportContext,
  element: Element,
  node: DesignNode,
  selectedRoot: boolean,
): void {
  const transform =
    selectedRoot && context.request.rootTransformOverrides?.[node.id]
      ? context.request.rootTransformOverrides[node.id]!
      : node.transform;
  element.setAttribute("transform", serializeSvgMatrixAttribute(transform));
}
