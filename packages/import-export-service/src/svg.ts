import {
  isFrameLikeNode,
  normalizeLineEndpoints,
  resolveLineEndpointPoint,
  type DesignDocument,
  type DesignNode,
  type LineEndpoint,
  type Paint,
  type Rect,
  type Transform,
} from "@opendesign/design-contracts";
import type { BooleanGeometryResolution } from "@opendesign/geometry-service/boolean-resolver";
import type {
  VectorFillRule,
  VectorGeometryProvider,
} from "@opendesign/geometry-service/vector-path";
import {
  normalizeVectorNetwork,
  resolvePathPropertiesData,
  vectorNetworkHasFillRegion,
} from "@opendesign/geometry-service/editable-vector";
import { DOMImplementation, XMLSerializer } from "@xmldom/xmldom";
import { applyToPoint, compose, translate } from "transformation-matrix";
import { SVG_MAX_CHARACTERS } from "./limits.js";
import {
  appendSvgEffectFilter,
  collectSvgFilterDefinitions,
  readSvgFilterEffects,
} from "./svg-filter-effects.js";
import {
  activeSvgMaskMode,
  appendSvgFrameClipDefinition,
  collectSvgMaskDefinitions,
  controlledSvgClippingSourcesMatch,
  createSvgMaskDefinition,
  parseLocalSvgUrlReference,
  readSerializedSvgMaskMode,
  readVisibleSvgMaskSourceReference,
  resolveControlledSvgMaskRun,
  resolveStandardSvgMaskReference,
  stripSvgExportedLayerIdentity,
  validateSvgFrameClipDefinition,
  type SvgMaskMode,
  type SvgMaskReference,
} from "./svg-mask-clip.js";
import type {
  SvgInterchangeIssue,
  SvgInterchangeIssueCode,
  SvgInterchangeIssueSeverity,
} from "./svg-issues.js";
import {
  appendSvgLineEndpointDefinition,
  collectSvgLineEndpointDefinitions,
  readSvgLineEndpoints,
} from "./svg-line-endpoints.js";
import {
  readSvgRegularShape,
  writeSvgRegularShape,
} from "./svg-regular-shapes.js";
import { readSvgText, svgTextShapeMatches, writeSvgText } from "./svg-text.js";
import {
  readSvgEditableVector,
  writeSvgEditableVector,
} from "./svg-editable-vector.js";
import {
  parseSvgImportSource,
  SVG_IMPORT_MAX_DEPTH as MAX_SVG_DEPTH,
  SVG_IMPORT_MAX_NODES as MAX_IMPORTED_NODES,
} from "./svg-parse.js";
import {
  DEFAULT_IMPORTED_SVG_STYLE,
  importedSvgGroupBounds,
  isPositiveSvgLength,
  readImportedSvgStyle,
  readSvgElementTransform,
  readSvgLength,
  readSvgOpacity,
  readSvgStyleOrAttribute,
  readSvgUnitInterval,
  rebaseImportedSvgChildren,
  transformFromSvgMatrix,
  transformToSvgMatrix,
  type ImportedSvgStyle,
} from "./svg-normalize.js";

export * from "./svg-issues.js";

export const SVG_INTERCHANGE_VERSION = 1 as const;
export const SVG_MIME_TYPE = "image/svg+xml" as const;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export interface SvgResolvedBooleanPath {
  bounds: Rect | null;
  empty: boolean;
  fillRule: VectorFillRule;
  path: string;
  provider: string;
  providerVersion: string;
}

export interface SvgExportRequest {
  document: DesignDocument;
  rootNodeIds: readonly string[];
  viewport: Rect;
  includeLayerIds?: boolean;
  resolvedBooleanPaths?: Readonly<Record<string, SvgResolvedBooleanPath>>;
  rootTransformOverrides?: Readonly<Record<string, Transform>>;
  title?: string;
}

export type SvgExportResult =
  | {
      ok: true;
      version: typeof SVG_INTERCHANGE_VERSION;
      mimeType: typeof SVG_MIME_TYPE;
      svg: string;
      viewport: Rect;
      exportedNodeIds: readonly string[];
      issues: readonly SvgInterchangeIssue[];
    }
  | {
      ok: false;
      version: typeof SVG_INTERCHANGE_VERSION;
      issues: readonly SvgInterchangeIssue[];
    };

export interface SvgImportRequest {
  svg: string;
  idPrefix: string;
  name?: string;
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

export type SvgImportResult =
  | {
      ok: true;
      version: typeof SVG_INTERCHANGE_VERSION;
      rootNodeId: string;
      nodes: readonly DesignNode[];
      sourceViewport: Rect;
      issues: readonly SvgInterchangeIssue[];
    }
  | {
      ok: false;
      version: typeof SVG_INTERCHANGE_VERSION;
      issues: readonly SvgInterchangeIssue[];
    };

interface SvgFailureResult {
  ok: false;
  version: typeof SVG_INTERCHANGE_VERSION;
  issues: readonly SvgInterchangeIssue[];
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
  request: SvgExportRequest;
  visiting: Set<string>;
}

interface ImportContext {
  activeMaskReferences: Set<string>;
  filterDefinitions: ReadonlyMap<string, Element>;
  geometry: VectorGeometryProvider;
  gradientDefinitions: ReadonlyMap<string, Element>;
  idPrefix: string;
  issues: SvgInterchangeIssue[];
  maskDefinitions: ReadonlyMap<string, Element>;
  markerDefinitions: ReadonlyMap<
    string,
    { element: Element; endpoint: LineEndpoint }
  >;
  nodeSequence: number;
  nodes: DesignNode[];
  rootStyle: ImportedSvgStyle;
}

interface ExportNodeOptions {
  maskSource?: boolean;
  selectedRoot?: boolean;
}

type ImportedNodeBase = Pick<
  Extract<DesignNode, { kind: "group" }>,
  | "blendMode"
  | "childIds"
  | "effects"
  | "exportSettings"
  | "extensions"
  | "id"
  | "locked"
  | "maskMode"
  | "name"
  | "opacity"
  | "parentId"
  | "visible"
>;

export function exportSvg(request: SvgExportRequest): SvgExportResult {
  const issues: SvgInterchangeIssue[] = [];
  if (!isFinitePositiveRect(request.viewport)) {
    return failure(
      "invalid-dimension",
      "SVG export viewport must be finite and positive",
    );
  }
  if (request.rootNodeIds.length === 0) {
    return failure(
      "invalid-root",
      "SVG export requires at least one root node",
    );
  }
  const rootSet = new Set(request.rootNodeIds);
  if (rootSet.size !== request.rootNodeIds.length) {
    return failure("invalid-root", "SVG export root node IDs must be unique");
  }
  for (const rootNodeId of request.rootNodeIds) {
    const node = request.document.nodesById[rootNodeId];
    if (!node) {
      issues.push(
        svgIssue(
          "invalid-root",
          "error",
          `SVG export root ${rootNodeId} does not exist`,
          { nodeId: rootNodeId },
        ),
      );
      continue;
    }
    let parentId = node.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      if (rootSet.has(parentId)) {
        issues.push(
          svgIssue(
            "invalid-root",
            "error",
            `SVG export root ${rootNodeId} is already contained by selected root ${parentId}`,
            { nodeId: rootNodeId },
          ),
        );
        break;
      }
      seen.add(parentId);
      parentId = request.document.nodesById[parentId]?.parentId ?? null;
    }
  }
  if (hasErrors(issues)) return failed(issues);

  const implementation = new DOMImplementation();
  const xmlDocument = implementation.createDocument(SVG_NAMESPACE, "svg", null);
  const root = xmlDocument.documentElement;
  root.setAttribute("xmlns", SVG_NAMESPACE);
  root.setAttribute("version", "1.1");
  root.setAttribute(
    "viewBox",
    [
      request.viewport.x,
      request.viewport.y,
      request.viewport.width,
      request.viewport.height,
    ]
      .map(formatNumber)
      .join(" "),
  );
  root.setAttribute("width", formatNumber(request.viewport.width));
  root.setAttribute("height", formatNumber(request.viewport.height));
  root.setAttribute(
    "data-opendesign-svg-version",
    String(SVG_INTERCHANGE_VERSION),
  );

  if (request.title?.trim()) {
    const title = xmlDocument.createElementNS(SVG_NAMESPACE, "title");
    title.appendChild(xmlDocument.createTextNode(request.title.trim()));
    root.appendChild(title);
  }
  const definitions = xmlDocument.createElementNS(SVG_NAMESPACE, "defs");
  const context: ExportContext = {
    definitions,
    document: xmlDocument,
    exportedNodeIds: [],
    frameClipSequence: 0,
    filterSequence: 0,
    gradientSequence: 0,
    issues,
    maskSequence: 0,
    markerSequence: 0,
    request,
    visiting: new Set(),
  };
  for (const rootNodeId of request.rootNodeIds) {
    const element = exportNode(context, rootNodeId, { selectedRoot: true });
    if (element) root.appendChild(element);
  }
  if (definitions.childNodes.length > 0) {
    root.insertBefore(definitions, root.firstChild);
  }
  if (hasErrors(issues)) return failed(issues);
  try {
    const svg = new XMLSerializer().serializeToString(
      xmlDocument,
      false,
      undefined,
      { requireWellFormed: true },
    );
    if (svg.length > SVG_MAX_CHARACTERS) {
      return failure(
        "size-limit",
        `SVG export exceeds ${SVG_MAX_CHARACTERS} characters`,
      );
    }
    return {
      ok: true,
      version: SVG_INTERCHANGE_VERSION,
      mimeType: SVG_MIME_TYPE,
      svg,
      viewport: { ...request.viewport },
      exportedNodeIds: context.exportedNodeIds,
      issues,
    };
  } catch (error) {
    return failure(
      "malformed-svg",
      error instanceof Error ? error.message : "SVG serialization failed",
    );
  }
}

export function importSvg(
  request: SvgImportRequest,
  geometry: VectorGeometryProvider,
): SvgImportResult {
  const parsed = parseSvgImportSource(request);
  if (!parsed.ok) return failed(parsed.issues);
  const { root, sourceViewport } = parsed.value;

  const issues: SvgInterchangeIssue[] = [];
  const rootStyle = readImportedSvgStyle(
    root,
    DEFAULT_IMPORTED_SVG_STYLE,
    issues,
  );
  for (const property of ["mask", "clip-path"] as const) {
    const value = readSvgStyleOrAttribute(root, property);
    if (value && value.trim().toLowerCase() !== "none") {
      issues.push(
        svgIssue(
          "mask-omitted",
          "error",
          `SVG root-level ${property} requires a later viewport compositing slice`,
          { sourceElement: root.localName },
        ),
      );
    }
  }
  const maskDefinitions = collectSvgMaskDefinitions(root, issues);
  const context: ImportContext = {
    activeMaskReferences: new Set(),
    filterDefinitions: collectSvgFilterDefinitions(root),
    geometry,
    gradientDefinitions: collectGradientDefinitions(root),
    idPrefix: request.idPrefix,
    issues,
    maskDefinitions,
    markerDefinitions: collectSvgLineEndpointDefinitions(root, issues),
    nodeSequence: 0,
    nodes: [],
    rootStyle,
  };
  const rootNodeId = nextImportedNodeId(context, "root");
  const rootEffects = readSvgFilterEffects({
    definitions: context.filterDefinitions,
    element: root,
    nodeId: rootNodeId,
  });
  issues.push(...rootEffects.issues);
  const childIds = importContainerChildren(
    context,
    elementChildren(root),
    rootNodeId,
    rootStyle,
    1,
  );
  if (hasErrors(issues)) return failed(issues);
  if (childIds.length === 0) {
    return failure(
      "invalid-root",
      "SVG import did not contain any supported editable graphics",
    );
  }

  const viewportOffset = translate(-sourceViewport.x, -sourceViewport.y);
  for (const childId of childIds) {
    const node = context.nodes.find((candidate) => candidate.id === childId);
    if (node) {
      node.transform = transformFromSvgMatrix(
        compose(viewportOffset, transformToSvgMatrix(node.transform)),
      );
    }
  }
  const rootNode: DesignNode = {
    id: rootNodeId,
    kind: "group",
    name: request.name?.trim() || readSvgName(root) || "Imported SVG",
    parentId: null,
    childIds,
    visible:
      root.getAttribute("display") !== "none" &&
      root.getAttribute("visibility") !== "hidden",
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: {
      width: sourceViewport.width,
      height: sourceViewport.height,
    },
    opacity: readSvgOpacity(root.getAttribute("opacity"), 1),
    exportSettings: [],
    ...(rootEffects.effects.length === 0
      ? {}
      : { effects: [...rootEffects.effects] }),
    properties: {},
    extensions: {
      svgImport: {
        version: SVG_INTERCHANGE_VERSION,
        viewBox: { ...sourceViewport },
      },
    },
  };
  return {
    ok: true,
    version: SVG_INTERCHANGE_VERSION,
    rootNodeId,
    nodes: [rootNode, ...context.nodes],
    sourceViewport,
    issues,
  };
}

function exportNode(
  context: ExportContext,
  nodeId: string,
  options: ExportNodeOptions = {},
): Element | null {
  const node = context.request.document.nodesById[nodeId];
  if (!node) {
    context.issues.push(
      svgIssue("invalid-root", "error", `SVG node ${nodeId} is missing`, {
        nodeId,
      }),
    );
    return null;
  }
  if (context.visiting.has(nodeId)) {
    context.issues.push(
      svgIssue("invalid-root", "error", `SVG node ${nodeId} is cyclic`, {
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
        background.setAttribute("width", formatNumber(node.size.width));
        background.setAttribute("height", formatNumber(node.size.height));
        background.setAttribute(
          "rx",
          formatNumber(node.properties.cornerRadius),
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
          svgIssue(
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
        svgIssue(
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
      element.setAttribute("width", formatNumber(node.size.width));
      element.setAttribute("height", formatNumber(node.size.height));
      element.setAttribute("rx", formatNumber(node.properties.cornerRadius));
    } else if (node.kind === "ellipse") {
      element = context.document.createElementNS(SVG_NAMESPACE, "ellipse");
      element.setAttribute("cx", formatNumber(node.size.width / 2));
      element.setAttribute("cy", formatNumber(node.size.height / 2));
      element.setAttribute("rx", formatNumber(node.size.width / 2));
      element.setAttribute("ry", formatNumber(node.size.height / 2));
    } else if (node.kind === "line") {
      element = context.document.createElementNS(SVG_NAMESPACE, "line");
      const start = resolveLineEndpointPoint(node.size, node.properties.start);
      const end = resolveLineEndpointPoint(node.size, node.properties.end);
      element.setAttribute("x1", formatNumber(start.x));
      element.setAttribute("y1", formatNumber(start.y));
      element.setAttribute("x2", formatNumber(end.x));
      element.setAttribute("y2", formatNumber(end.y));
      applyExportLineEndpoints(context, element, node);
    } else if (node.kind === "polygon" || node.kind === "star") {
      if (node.properties.cornerRadius > 0) {
        context.issues.push(
          svgIssue(
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
          svgIssue(
            "invalid-geometry",
            "error",
            `Editable vector network ${node.id} is invalid and cannot be exported`,
            { nodeId: node.id },
          ),
        );
        return null;
      }
      element = context.document.createElementNS(SVG_NAMESPACE, "path");
      element.setAttribute("d", path);
      element.setAttribute("fill-rule", node.properties.fillRule ?? "nonzero");
      if (
        "network" in node.properties &&
        !writeSvgEditableVector(element, node.properties.network)
      ) {
        context.issues.push(
          svgIssue(
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
          svgIssue("malformed-svg", "error", result.message, {
            nodeId: node.id,
          }),
        );
        return null;
      }
      if (!result.metadataWritten) {
        context.issues.push(
          svgIssue(
            "size-limit",
            "warning",
            `Editable text metadata for ${node.id} exceeds its interchange limit and was omitted; standard SVG text remains exported`,
            { nodeId: node.id },
          ),
        );
      }
      context.issues.push(
        svgIssue(
          "text-font-not-embedded",
          "warning",
          `Text ${node.id} references ${node.properties.fontFamily} ${node.properties.fontStyleName ?? "(unresolved face)"}; the font is not embedded in this SVG`,
          { nodeId: node.id },
        ),
        svgIssue(
          "text-layout-fidelity",
          "warning",
          `Text ${node.id} uses ${node.properties.textResize} resizing, ${node.properties.textWrap} wrapping, ${node.properties.textTruncation} truncation, and ${node.properties.maxLines ?? "box-height"} max lines inside an OpenDesign text box; standard SVG line positions cannot preserve automatic sizing, wrapping, truncation, paragraph layout, justify, or exact font shaping without OpenDesign metadata`,
          { nodeId: node.id },
        ),
      );
    } else {
      context.issues.push(
        svgIssue(
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

function applyExportLineEndpoints(
  context: ExportContext,
  element: Element,
  node: Extract<DesignNode, { kind: "line" }>,
): void {
  const append = (position: "start" | "end", endpoint: LineEndpoint): void => {
    if (endpoint === "none") return;
    const id = `od_line_marker_${++context.markerSequence}_${sanitizeXmlId(node.id)}_${position}`;
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

    const referenceId = `od_${mode === "outline" ? "clip" : "mask"}_${++context.maskSequence}_${sanitizeXmlId(childId)}`;
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
      run.setAttribute("opacity", formatNumber(childNode.opacity));
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
  const clipId = `od_frame_clip_${++context.frameClipSequence}_${sanitizeXmlId(node.id)}`;
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
    element.setAttribute("id", sanitizeXmlId(node.id));
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
  element.setAttribute("transform", matrixAttribute(transform));
}

function applyExportNodeAppearance(
  context: ExportContext,
  element: Element,
  node: DesignNode,
  maskSource: boolean,
): void {
  if (node.opacity !== 1) {
    element.setAttribute("opacity", formatNumber(node.opacity));
  }
  if (!node.visible) element.setAttribute("display", "none");
  if (node.blendMode && node.blendMode !== "pass-through") {
    element.setAttribute("style", `mix-blend-mode:${node.blendMode}`);
  }
  if ((node.effects?.length ?? 0) > 0) {
    const result = appendSvgEffectFilter({
      definitions: context.definitions,
      document: context.document,
      filterId: `od_filter_${++context.filterSequence}_${sanitizeXmlId(node.id)}`,
      node,
    });
    context.issues.push(...result.issues);
    if (result.filterId) {
      element.setAttribute("filter", `url(#${result.filterId})`);
    }
  }
  if (!maskSource && node.maskMode && node.maskMode !== "none") {
    context.issues.push(
      svgIssue(
        "mask-omitted",
        "warning",
        `Mask source ${node.id} was exported without its parent sibling run, so mode ${node.maskMode} could not be preserved`,
        { nodeId: node.id },
      ),
    );
  }
}

function applyExportShapeAppearance(
  context: ExportContext,
  element: Element,
  nodeId: string,
  properties: ShapeProperties,
): void {
  applyExportPaint(context, element, nodeId, "fill", properties.fills);
  applyExportPaint(context, element, nodeId, "stroke", properties.strokes);
  if (properties.strokes.length > 0) {
    element.setAttribute("stroke-width", formatNumber(properties.strokeWidth));
    element.setAttribute(
      "stroke-linecap",
      properties.strokeCap === "round"
        ? "round"
        : properties.strokeCap === "square"
          ? "square"
          : "butt",
    );
    element.setAttribute("stroke-linejoin", properties.strokeJoin ?? "miter");
    if (properties.dashPattern?.length) {
      element.setAttribute(
        "stroke-dasharray",
        properties.dashPattern.map(formatNumber).join(" "),
      );
    }
    if (properties.strokeAlign && properties.strokeAlign !== "center") {
      context.issues.push(
        svgIssue(
          "stroke-alignment-flattened",
          "warning",
          `${properties.strokeAlign} stroke on ${nodeId} requires outline-stroke conversion for standard SVG fidelity`,
          { nodeId },
        ),
      );
    }
  }
}

function applyExportPaint(
  context: ExportContext,
  element: Element,
  nodeId: string,
  role: "fill" | "stroke",
  paints: readonly Paint[],
): void {
  const visible = paints.filter((paint) => paint.visible !== false);
  if (visible.length === 0) {
    element.setAttribute(role, "none");
    return;
  }
  if (visible.length > 1) {
    context.issues.push(
      svgIssue(
        "multiple-paints-flattened",
        "warning",
        `SVG ${role} on ${nodeId} keeps only the first of ${visible.length} visible paints`,
        { nodeId },
      ),
    );
  }
  const paint = visible[0]!;
  if (paint.type === "solid") {
    element.setAttribute(role, paint.color);
    if (paint.opacity !== 1) {
      element.setAttribute(`${role}-opacity`, formatNumber(paint.opacity));
    }
    return;
  }
  if (paint.type === "angular-gradient") {
    const first = paint.stops[0];
    element.setAttribute(role, first?.color ?? "none");
    if (first && first.opacity !== 1) {
      element.setAttribute(`${role}-opacity`, formatNumber(first.opacity));
    }
    context.issues.push(
      svgIssue(
        "angular-gradient-flattened",
        "warning",
        `Angular gradient ${role} on ${nodeId} has no standard SVG 1.1 equivalent and is reduced to its first stop`,
        { nodeId },
      ),
    );
    return;
  }
  if (paint.type === "image") {
    element.setAttribute(role, "none");
    context.issues.push(
      svgIssue(
        "unsupported-paint",
        "error",
        `Image ${role} on ${nodeId} is not supported by the current SVG vector slice`,
        { nodeId },
      ),
    );
    return;
  }

  const gradientId = `od_gradient_${sanitizeXmlId(nodeId)}_${role}_${context.gradientSequence++}`;
  const gradient = context.document.createElementNS(
    SVG_NAMESPACE,
    paint.type === "linear-gradient" ? "linearGradient" : "radialGradient",
  );
  gradient.setAttribute("id", gradientId);
  gradient.setAttribute("gradientUnits", "objectBoundingBox");
  if (paint.type === "linear-gradient") {
    gradient.setAttribute("x1", formatNumber(paint.from?.x ?? 0));
    gradient.setAttribute("y1", formatNumber(paint.from?.y ?? 0.5));
    gradient.setAttribute("x2", formatNumber(paint.to?.x ?? 1));
    gradient.setAttribute("y2", formatNumber(paint.to?.y ?? 0.5));
  } else {
    const center = paint.from ?? { x: 0.5, y: 0.5 };
    const edge = paint.to ?? { x: 1, y: 0.5 };
    gradient.setAttribute("cx", formatNumber(center.x));
    gradient.setAttribute("cy", formatNumber(center.y));
    gradient.setAttribute(
      "r",
      formatNumber(Math.hypot(edge.x - center.x, edge.y - center.y)),
    );
  }
  if (paint.rotation !== undefined) {
    gradient.setAttribute(
      "gradientTransform",
      `rotate(${formatNumber(paint.rotation)} 0.5 0.5)`,
    );
  }
  for (const stop of paint.stops) {
    const stopElement = context.document.createElementNS(SVG_NAMESPACE, "stop");
    stopElement.setAttribute("offset", formatNumber(stop.offset));
    stopElement.setAttribute("stop-color", stop.color);
    stopElement.setAttribute("stop-opacity", formatNumber(stop.opacity));
    gradient.appendChild(stopElement);
  }
  context.definitions.appendChild(gradient);
  element.setAttribute(role, `url(#${gradientId})`);
  if (paint.opacity !== 1) {
    element.setAttribute(`${role}-opacity`, formatNumber(paint.opacity));
  }
}

function importContainerChildren(
  context: ImportContext,
  children: readonly Element[],
  parentId: string,
  inheritedStyle: ImportedSvgStyle,
  depth: number,
): string[] {
  const childIds: string[] = [];
  const visibleMaskSources = new Map<
    string,
    { element: Element; nodeId: string }
  >();
  const consumedMaskReferences = new Set<string>();

  for (const child of children) {
    if (child.getAttribute("data-opendesign-mask-run") === "true") {
      const reference = resolveControlledSvgMaskRun(
        child,
        context.maskDefinitions,
        context.issues,
      );
      if (!reference) continue;
      if (consumedMaskReferences.has(reference.id)) {
        context.issues.push(
          svgIssue(
            "mask-omitted",
            "error",
            `SVG mask run #${reference.id} is repeated in one container`,
            { sourceElement: child.localName },
          ),
        );
        continue;
      }
      consumedMaskReferences.add(reference.id);

      let sourceId: string | null;
      if (reference.mode === "clipping") {
        const visibleSource = visibleMaskSources.get(reference.id);
        sourceId = visibleSource?.nodeId ?? null;
        if (!sourceId || !visibleSource) {
          context.issues.push(
            svgIssue(
              "mask-omitted",
              "error",
              `SVG clipping mask run #${reference.id} is missing its visible sibling source`,
              { sourceElement: child.localName },
            ),
          );
          continue;
        }
        if (
          !controlledSvgClippingSourcesMatch(
            visibleSource.element,
            reference.definition,
          )
        ) {
          context.issues.push(
            svgIssue(
              "mask-omitted",
              "error",
              `SVG clipping mask definition #${reference.id} does not match its visible source`,
              { nodeId: sourceId, sourceElement: child.localName },
            ),
          );
          continue;
        }
        visibleMaskSources.delete(reference.id);
      } else {
        sourceId = importMaskDefinitionSource(
          context,
          reference,
          parentId,
          depth,
        );
        if (sourceId) childIds.push(sourceId);
      }

      for (const maskedElement of elementChildren(child)) {
        const maskedId = importElement(
          context,
          maskedElement,
          parentId,
          inheritedStyle,
          depth,
        );
        if (maskedId) childIds.push(maskedId);
      }
      continue;
    }

    const sourceReference = readVisibleSvgMaskSourceReference(
      child,
      context.maskDefinitions,
      context.issues,
    );
    const childId = importElement(
      context,
      child,
      parentId,
      inheritedStyle,
      depth,
    );
    if (!childId) continue;
    childIds.push(childId);
    if (sourceReference) {
      if (visibleMaskSources.has(sourceReference.id)) {
        context.issues.push(
          svgIssue(
            "mask-omitted",
            "error",
            `SVG clipping mask #${sourceReference.id} has multiple visible sources`,
            { nodeId: childId, sourceElement: child.localName },
          ),
        );
      } else {
        visibleMaskSources.set(sourceReference.id, {
          element: child,
          nodeId: childId,
        });
      }
    }
  }

  for (const [referenceId, source] of visibleMaskSources) {
    context.issues.push(
      svgIssue(
        "mask-omitted",
        "error",
        `SVG clipping mask source #${referenceId} is not followed by its mask run`,
        { nodeId: source.nodeId },
      ),
    );
  }
  return childIds;
}

function importMaskedElement(
  context: ImportContext,
  element: Element,
  parentId: string,
  inheritedStyle: ImportedSvgStyle,
  depth: number,
  reference: SvgMaskReference,
): string | null {
  const checkpoint = context.nodes.length;
  const groupId = nextImportedNodeId(context, "mask-group");
  const sourceId = importMaskDefinitionSource(
    context,
    reference,
    groupId,
    depth + 1,
  );
  const source = sourceId
    ? context.nodes.find((node) => node.id === sourceId)
    : undefined;
  if (source) {
    source.transform = transformFromSvgMatrix(
      compose(
        transformToSvgMatrix(readSvgElementTransform(element, context.issues)),
        transformToSvgMatrix(source.transform),
      ),
    );
  }
  const targetId = importElement(
    context,
    element,
    groupId,
    inheritedStyle,
    depth + 1,
    { ignoreMaskReference: true },
  );
  const exceedsNodeBudget = context.nodes.length >= MAX_IMPORTED_NODES;
  if (!sourceId || !targetId || exceedsNodeBudget) {
    context.nodes.splice(checkpoint);
    if (exceedsNodeBudget) {
      context.issues.push(
        svgIssue(
          "element-limit",
          "error",
          `SVG import exceeds ${MAX_IMPORTED_NODES} editable nodes`,
          { sourceElement: element.localName },
        ),
      );
    }
    return null;
  }
  const childIds = [sourceId, targetId];
  const bounds = importedSvgGroupBounds(context.nodes, childIds);
  rebaseImportedSvgChildren(context.nodes, childIds, bounds.x, bounds.y);
  const group: DesignNode = {
    id: groupId,
    kind: "group",
    name: `${readSvgName(element) || capitalize(element.localName)} Mask`,
    parentId,
    childIds,
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, bounds.x, bounds.y],
    size: { width: bounds.width, height: bounds.height },
    opacity: 1,
    exportSettings: [],
    properties: {},
    extensions: {
      svgImport: {
        version: SVG_INTERCHANGE_VERSION,
        sourceElement: "mask-wrapper",
        maskReference: reference.id,
      },
    },
  };
  context.nodes.push(group);
  return groupId;
}

function importMaskDefinitionSource(
  context: ImportContext,
  reference: SvgMaskReference,
  parentId: string,
  depth: number,
): string | null {
  if (context.activeMaskReferences.has(reference.id)) {
    context.issues.push(
      svgIssue(
        "mask-omitted",
        "error",
        `SVG mask reference cycle detected at #${reference.id}`,
        { sourceElement: reference.definition.localName },
      ),
    );
    return null;
  }
  context.activeMaskReferences.add(reference.id);
  try {
    const definitionStyle = readImportedSvgStyle(
      reference.definition,
      context.rootStyle,
      context.issues,
    );
    const definitionTransform = readSvgElementTransform(
      reference.definition,
      context.issues,
    );
    const sourceElements = elementChildren(reference.definition).filter(
      (child) =>
        !["title", "desc", "metadata", "defs"].includes(
          child.localName.toLowerCase(),
        ),
    );
    if (sourceElements.length === 0) {
      context.issues.push(
        svgIssue(
          "mask-omitted",
          "error",
          `SVG mask definition #${reference.id} contains no editable graphics`,
          { sourceElement: reference.definition.localName },
        ),
      );
      return null;
    }
    if (sourceElements.length === 1) {
      const sourceId = importElement(
        context,
        sourceElements[0]!,
        parentId,
        definitionStyle,
        depth,
      );
      const source = sourceId
        ? context.nodes.find((node) => node.id === sourceId)
        : undefined;
      if (!source) return null;
      source.maskMode = reference.mode;
      if (
        reference.mode === "outline" &&
        reference.definition.getAttribute("data-opendesign-mask-version") !==
          "1"
      ) {
        source.opacity = 1;
      }
      source.transform = transformFromSvgMatrix(
        compose(
          transformToSvgMatrix(definitionTransform),
          transformToSvgMatrix(source.transform),
        ),
      );
      return sourceId;
    }

    if (context.nodes.length >= MAX_IMPORTED_NODES) {
      context.issues.push(
        svgIssue(
          "element-limit",
          "error",
          `SVG import exceeds ${MAX_IMPORTED_NODES} editable nodes`,
          { sourceElement: reference.definition.localName },
        ),
      );
      return null;
    }
    const groupId = nextImportedNodeId(context, "mask-source");
    const checkpoint = context.nodes.length;
    const childIds = importContainerChildren(
      context,
      sourceElements,
      groupId,
      definitionStyle,
      depth + 1,
    );
    const exceedsNodeBudget = context.nodes.length >= MAX_IMPORTED_NODES;
    if (childIds.length === 0 || exceedsNodeBudget) {
      context.nodes.splice(checkpoint);
      if (exceedsNodeBudget) {
        context.issues.push(
          svgIssue(
            "element-limit",
            "error",
            `SVG import exceeds ${MAX_IMPORTED_NODES} editable nodes`,
            { sourceElement: reference.definition.localName },
          ),
        );
      } else {
        context.issues.push(
          svgIssue(
            "mask-omitted",
            "error",
            `SVG mask definition #${reference.id} contains no supported source layers`,
            { sourceElement: reference.definition.localName },
          ),
        );
      }
      return null;
    }
    const bounds = importedSvgGroupBounds(context.nodes, childIds);
    rebaseImportedSvgChildren(context.nodes, childIds, bounds.x, bounds.y);
    const group: DesignNode = {
      id: groupId,
      kind: "group",
      name: readSvgName(reference.definition) || "Mask Source",
      parentId,
      childIds,
      visible: true,
      locked: false,
      transform: transformFromSvgMatrix(
        compose(
          transformToSvgMatrix(definitionTransform),
          translate(bounds.x, bounds.y),
        ),
      ),
      size: { width: bounds.width, height: bounds.height },
      opacity: 1,
      exportSettings: [],
      maskMode: reference.mode,
      properties: {},
      extensions: {
        svgImport: {
          version: SVG_INTERCHANGE_VERSION,
          sourceElement: reference.definition.localName.toLowerCase(),
          sourceId: reference.id,
        },
      },
    };
    context.nodes.push(group);
    return groupId;
  } finally {
    context.activeMaskReferences.delete(reference.id);
  }
}

function importElement(
  context: ImportContext,
  element: Element,
  parentId: string,
  inheritedStyle: ImportedSvgStyle,
  depth: number,
  options: { ignoreMaskReference?: boolean } = {},
): string | null {
  const tag = element.localName.toLowerCase();
  if (
    tag === "defs" ||
    tag === "title" ||
    tag === "desc" ||
    tag === "metadata"
  ) {
    return null;
  }
  if (depth > MAX_SVG_DEPTH) {
    context.issues.push(
      svgIssue(
        "depth-limit",
        "error",
        `SVG import exceeds ${MAX_SVG_DEPTH} nested levels`,
        { sourceElement: tag },
      ),
    );
    return null;
  }
  if (context.nodes.length >= MAX_IMPORTED_NODES) {
    context.issues.push(
      svgIssue(
        "element-limit",
        "error",
        `SVG import exceeds ${MAX_IMPORTED_NODES} editable nodes`,
        { sourceElement: tag },
      ),
    );
    return null;
  }
  if (tag === "script" || tag === "foreignobject" || tag === "use") {
    context.issues.push(
      svgIssue(
        tag === "use" ? "external-reference" : "unsupported-element",
        "error",
        `SVG <${tag}> is not accepted by the editable import boundary`,
        { sourceElement: tag },
      ),
    );
    return null;
  }
  if (tag === "style") {
    context.issues.push(
      svgIssue(
        "unsupported-css",
        "error",
        "SVG stylesheets are not accepted; use presentation attributes or inline style",
        { sourceElement: tag },
      ),
    );
    return null;
  }
  if (tag === "image" || tag === "clippath" || tag === "mask") {
    context.issues.push(
      svgIssue(
        "unsupported-element",
        "error",
        `SVG <${tag}> requires a later typed import slice`,
        { sourceElement: tag },
      ),
    );
    return null;
  }

  if (!options.ignoreMaskReference) {
    const maskReference = resolveStandardSvgMaskReference(
      element,
      context.maskDefinitions,
      context.issues,
    );
    if (maskReference === null) return null;
    if (maskReference) {
      return importMaskedElement(
        context,
        element,
        parentId,
        inheritedStyle,
        depth,
        maskReference,
      );
    }
  }

  const localStyle = readImportedSvgStyle(
    element,
    inheritedStyle,
    context.issues,
  );
  const nodeId = nextImportedNodeId(context, tag);
  const filterEffects = readSvgFilterEffects({
    definitions: context.filterDefinitions,
    element,
    nodeId,
  });
  context.issues.push(...filterEffects.issues);
  reportUnsupportedElementAttributes(
    element,
    context.issues,
    options.ignoreMaskReference === true,
  );
  const transform = readSvgElementTransform(element, context.issues);
  const common: ImportedNodeBase = {
    id: nodeId,
    name: readSvgName(element) || `${capitalize(tag)} ${context.nodeSequence}`,
    parentId,
    childIds: [] as string[],
    visible:
      element.getAttribute("display") !== "none" &&
      element.getAttribute("visibility") !== "hidden",
    locked: false,
    opacity: readSvgOpacity(element.getAttribute("opacity"), 1),
    exportSettings: [],
    ...(filterEffects.effects.length === 0
      ? {}
      : { effects: [...filterEffects.effects] }),
    ...readSerializedSvgMaskMode(element),
    extensions: {
      svgImport: {
        version: SVG_INTERCHANGE_VERSION,
        sourceElement: tag,
        ...(element.getAttribute("id")
          ? { sourceId: element.getAttribute("id") }
          : {}),
      },
    },
  };

  const regularShape = readSvgRegularShape(element);
  if (regularShape.status === "invalid") {
    context.issues.push(
      svgIssue(
        "regular-shape-fidelity-unsupported",
        "error",
        regularShape.message,
        { nodeId, sourceElement: tag },
      ),
    );
    return null;
  }

  if (tag === "g") {
    if (element.getAttribute("data-opendesign-kind") === "frame") {
      return importFrameElement(
        context,
        element,
        nodeId,
        common,
        localStyle,
        transform,
        depth,
      );
    }
    const childIds = importContainerChildren(
      context,
      elementChildren(element),
      nodeId,
      localStyle,
      depth + 1,
    );
    if (childIds.length === 0) return null;
    const bounds = importedSvgGroupBounds(context.nodes, childIds);
    rebaseImportedSvgChildren(context.nodes, childIds, bounds.x, bounds.y);
    const node: DesignNode = {
      ...common,
      kind: "group",
      childIds,
      transform: transformFromSvgMatrix(
        compose(transformToSvgMatrix(transform), translate(bounds.x, bounds.y)),
      ),
      size: { width: bounds.width, height: bounds.height },
      properties: {},
    };
    context.nodes.push(node);
    return nodeId;
  }

  if (tag === "text") {
    const serializedText = readSvgText(element);
    if (serializedText.status === "absent") {
      context.issues.push(
        svgIssue(
          "unsupported-element",
          "error",
          "Ordinary SVG <text> requires deterministic font and text-box semantics before editable import",
          { nodeId, sourceElement: tag },
        ),
      );
      return null;
    }
    if (serializedText.status === "invalid") {
      context.issues.push(
        svgIssue("text-fidelity-unsupported", "error", serializedText.message, {
          nodeId,
          sourceElement: tag,
        }),
      );
      return null;
    }
    const shape = importShapeProperties(context, element, localStyle, nodeId);
    if (!shape) return null;
    if (!svgTextShapeMatches(serializedText.value.properties, shape)) {
      context.issues.push(
        svgIssue(
          "text-fidelity-unsupported",
          "error",
          "OpenDesign text metadata does not match the rendered SVG paint or stroke",
          { nodeId, sourceElement: tag },
        ),
      );
      return null;
    }
    const node: DesignNode = {
      ...common,
      kind: "text",
      transform,
      size: {
        width: serializedText.value.width,
        height: serializedText.value.height,
      },
      properties: serializedText.value.properties,
    };
    context.nodes.push(node);
    return nodeId;
  }

  const properties = importShapeProperties(
    context,
    element,
    localStyle,
    nodeId,
  );
  if (!properties) return null;

  if (regularShape.status === "valid") {
    const semantic = regularShape.value;
    const node: DesignNode =
      semantic.kind === "polygon"
        ? {
            ...common,
            kind: "polygon",
            transform,
            size: { width: semantic.width, height: semantic.height },
            properties: {
              ...properties,
              pointCount: semantic.pointCount,
              cornerRadius: semantic.cornerRadius,
            },
          }
        : {
            ...common,
            kind: "star",
            transform,
            size: { width: semantic.width, height: semantic.height },
            properties: {
              ...properties,
              pointCount: semantic.pointCount,
              innerRadius: semantic.innerRadius,
              cornerRadius: semantic.cornerRadius,
            },
          };
    context.nodes.push(node);
    return nodeId;
  }

  if (tag === "rect") {
    const x = readSvgLength(element, "x", 0, context.issues);
    const y = readSvgLength(element, "y", 0, context.issues);
    const width = readSvgLength(element, "width", null, context.issues);
    const height = readSvgLength(element, "height", null, context.issues);
    if (
      x === null ||
      y === null ||
      !isPositiveSvgLength(width) ||
      !isPositiveSvgLength(height)
    ) {
      context.issues.push(
        svgIssue(
          "invalid-dimension",
          "error",
          "SVG <rect> requires finite positive width and height",
          { sourceElement: tag },
        ),
      );
      return null;
    }
    const radius = readSvgLength(element, "rx", 0, context.issues);
    const node: DesignNode = {
      ...common,
      kind: "rectangle",
      transform: transformFromSvgMatrix(
        compose(transformToSvgMatrix(transform), translate(x, y)),
      ),
      size: { width, height },
      properties: {
        ...properties,
        cornerRadius: Math.max(0, radius ?? 0),
      },
    };
    context.nodes.push(node);
    return nodeId;
  }

  if (tag === "circle" || tag === "ellipse") {
    const cx = readSvgLength(element, "cx", 0, context.issues);
    const cy = readSvgLength(element, "cy", 0, context.issues);
    const rx =
      tag === "circle"
        ? readSvgLength(element, "r", null, context.issues)
        : readSvgLength(element, "rx", null, context.issues);
    const ry =
      tag === "circle"
        ? rx
        : readSvgLength(element, "ry", null, context.issues);
    if (
      cx === null ||
      cy === null ||
      !isPositiveSvgLength(rx) ||
      !isPositiveSvgLength(ry)
    ) {
      context.issues.push(
        svgIssue(
          "invalid-dimension",
          "error",
          `SVG <${tag}> requires finite positive radii`,
          { sourceElement: tag },
        ),
      );
      return null;
    }
    const node: DesignNode = {
      ...common,
      kind: "ellipse",
      transform: transformFromSvgMatrix(
        compose(transformToSvgMatrix(transform), translate(cx - rx, cy - ry)),
      ),
      size: { width: rx * 2, height: ry * 2 },
      properties,
    };
    context.nodes.push(node);
    return nodeId;
  }

  if (tag === "line") {
    const x1 = readSvgLength(element, "x1", 0, context.issues);
    const y1 = readSvgLength(element, "y1", 0, context.issues);
    const x2 = readSvgLength(element, "x2", 0, context.issues);
    const y2 = readSvgLength(element, "y2", 0, context.issues);
    if ([x1, y1, x2, y2].some((value) => value === null)) return null;
    const endpoints = readSvgLineEndpoints({
      definitions: context.markerDefinitions,
      element,
      issues: context.issues,
      nodeId,
    });
    if (!endpoints) return null;
    const geometry = normalizeLineEndpoints(
      { x: x1!, y: y1! },
      { x: x2!, y: y2! },
    );
    const node: DesignNode = {
      ...common,
      kind: "line",
      transform: transformFromSvgMatrix(
        compose(
          transformToSvgMatrix(transform),
          translate(geometry.bounds.x, geometry.bounds.y),
        ),
      ),
      size: {
        width: geometry.bounds.width,
        height: geometry.bounds.height,
      },
      properties: {
        fills: [],
        strokes: properties.strokes,
        strokeWidth: properties.strokeWidth,
        strokeAlign: "center",
        ...(properties.strokeCap === undefined
          ? {}
          : { strokeCap: properties.strokeCap }),
        ...(properties.strokeJoin === undefined
          ? {}
          : { strokeJoin: properties.strokeJoin }),
        ...(properties.dashPattern === undefined
          ? {}
          : { dashPattern: properties.dashPattern }),
        start: geometry.start,
        end: geometry.end,
        ...endpoints,
      },
    };
    context.nodes.push(node);
    return nodeId;
  }

  const pathData = readElementPath(element, tag, context.issues);
  if (!pathData) {
    context.issues.push(
      svgIssue(
        "unsupported-element",
        "error",
        `SVG <${tag}> is not supported by the current editable vector slice`,
        { sourceElement: tag },
      ),
    );
    return null;
  }
  const editableVector = readSvgEditableVector(element, pathData);
  if (editableVector.status === "invalid") {
    context.issues.push(
      svgIssue("invalid-geometry", "error", editableVector.message, {
        nodeId,
        sourceElement: tag,
      }),
    );
    return null;
  }
  if (editableVector.status === "valid") {
    const normalizedNetwork = normalizeVectorNetwork(editableVector.network);
    if (!normalizedNetwork.ok || !normalizedNetwork.offset) {
      context.issues.push(
        svgIssue(
          "invalid-geometry",
          "error",
          normalizedNetwork.ok
            ? "Editable vector metadata could not be normalized"
            : normalizedNetwork.issues[0]?.message ||
                "Editable vector metadata has invalid topology",
          { nodeId, sourceElement: tag },
        ),
      );
      return null;
    }
    const sourceKind = element.getAttribute("data-opendesign-kind");
    const kind = sourceKind === "path" ? "path" : "vector";
    const node: DesignNode = {
      ...common,
      kind,
      transform: transformFromSvgMatrix(
        compose(
          transformToSvgMatrix(transform),
          translate(normalizedNetwork.offset.x, normalizedNetwork.offset.y),
        ),
      ),
      size: {
        width: normalizedNetwork.bounds.width,
        height: normalizedNetwork.bounds.height,
      },
      properties: {
        ...properties,
        network: normalizedNetwork.network,
        fillRule: localStyle.fillRule,
      },
    };
    context.nodes.push(node);
    return nodeId;
  }
  const normalized = context.geometry.normalize({
    path: pathData,
    fillRule: localStyle.fillRule,
  });
  if (!normalized.ok) {
    context.issues.push(
      svgIssue("invalid-geometry", "error", normalized.message, {
        sourceElement: tag,
      }),
    );
    return null;
  }
  if (normalized.empty || !normalized.bounds) {
    const sourceKind = element.getAttribute("data-opendesign-kind");
    const kind =
      sourceKind === "path" || sourceKind === "vector" ? sourceKind : "vector";
    const node: DesignNode = {
      ...common,
      kind,
      visible: false,
      transform,
      size: { width: 0, height: 0 },
      properties: {
        ...properties,
        path: "M 0 0",
        fillRule: normalized.fillRule,
      },
    };
    context.nodes.push(node);
    context.issues.push(
      svgIssue(
        "empty-geometry",
        "warning",
        `SVG <${tag}> contains no drawable geometry and is imported as an invisible editable Vector`,
        { nodeId, sourceElement: tag },
      ),
    );
    return nodeId;
  }
  const origin = normalized.bounds;
  const localized = context.geometry.transform(
    { path: normalized.path, fillRule: normalized.fillRule },
    [1, 0, 0, 1, -origin.x, -origin.y],
  );
  if (!localized.ok || localized.empty || !localized.bounds) {
    context.issues.push(
      svgIssue(
        "invalid-geometry",
        "error",
        localized.ok
          ? `SVG <${tag}> could not be localized`
          : localized.message,
        { sourceElement: tag },
      ),
    );
    return null;
  }
  const sourceKind = element.getAttribute("data-opendesign-kind");
  const kind =
    sourceKind === "path" || sourceKind === "vector" ? sourceKind : "vector";
  const node: DesignNode = {
    ...common,
    kind,
    transform: transformFromSvgMatrix(
      compose(transformToSvgMatrix(transform), translate(origin.x, origin.y)),
    ),
    size: { width: origin.width, height: origin.height },
    properties: {
      ...properties,
      path: localized.path,
      fillRule: localized.fillRule,
    },
  };
  context.nodes.push(node);
  return nodeId;
}

function importFrameElement(
  context: ImportContext,
  element: Element,
  nodeId: string,
  common: ImportedNodeBase,
  inheritedStyle: ImportedSvgStyle,
  transform: Transform,
  depth: number,
): string | null {
  const structuralChildren = elementChildren(element).filter(
    (child) =>
      !["defs", "title", "desc", "metadata"].includes(
        child.localName.toLowerCase(),
      ),
  );
  const backgrounds = structuralChildren.filter(
    (child) =>
      child.localName.toLowerCase() === "rect" &&
      child.getAttribute("data-opendesign-frame-background") === "true",
  );
  if (backgrounds.length !== 1 || structuralChildren[0] !== backgrounds[0]) {
    context.issues.push(
      svgIssue(
        "unsupported-element",
        "error",
        "OpenDesign SVG Frame requires exactly one leading frame background rect",
        { nodeId, sourceElement: element.localName },
      ),
    );
    return null;
  }
  const background = backgrounds[0]!;
  if (
    background.hasAttribute("transform") ||
    background.hasAttribute("filter") ||
    background.hasAttribute("mask") ||
    background.hasAttribute("clip-path") ||
    readSvgOpacity(background.getAttribute("opacity"), 1) !== 1
  ) {
    context.issues.push(
      svgIssue(
        "unsupported-element",
        "error",
        "OpenDesign SVG Frame background contains unsupported structural appearance",
        { nodeId, sourceElement: background.localName },
      ),
    );
    return null;
  }
  const x = readSvgLength(background, "x", 0, context.issues);
  const y = readSvgLength(background, "y", 0, context.issues);
  const width = readSvgLength(background, "width", null, context.issues);
  const height = readSvgLength(background, "height", null, context.issues);
  const radius = readSvgLength(background, "rx", 0, context.issues);
  if (
    x !== 0 ||
    y !== 0 ||
    !isPositiveSvgLength(width) ||
    !isPositiveSvgLength(height) ||
    radius === null ||
    radius < 0
  ) {
    context.issues.push(
      svgIssue(
        "invalid-dimension",
        "error",
        "OpenDesign SVG Frame background requires origin-zero positive bounds and a non-negative corner radius",
        { nodeId, sourceElement: background.localName },
      ),
    );
    return null;
  }
  const backgroundStyle = readImportedSvgStyle(
    background,
    inheritedStyle,
    context.issues,
  );
  const shape = importShapeProperties(
    context,
    background,
    backgroundStyle,
    nodeId,
  );
  if (!shape) return null;

  const contentElements = structuralChildren.slice(1);
  const contentWrappers = contentElements.filter(
    (child) => child.getAttribute("data-opendesign-frame-content") === "true",
  );
  let clipsContent = false;
  let children: readonly Element[] = contentElements;
  if (contentWrappers.length > 0) {
    if (contentWrappers.length !== 1 || contentElements.length !== 1) {
      context.issues.push(
        svgIssue(
          "mask-omitted",
          "error",
          "OpenDesign SVG Frame clipping wrapper must be the only content container",
          { nodeId, sourceElement: element.localName },
        ),
      );
      return null;
    }
    const wrapper = contentWrappers[0]!;
    if (
      wrapper.hasAttribute("transform") ||
      wrapper.hasAttribute("filter") ||
      wrapper.hasAttribute("mask") ||
      wrapper.hasAttribute("opacity") ||
      wrapper.hasAttribute("display") ||
      wrapper.hasAttribute("visibility")
    ) {
      context.issues.push(
        svgIssue(
          "mask-omitted",
          "error",
          "OpenDesign SVG Frame clipping wrapper contains unsupported appearance or transform",
          { nodeId, sourceElement: wrapper.localName },
        ),
      );
      return null;
    }
    const referenceId = parseLocalSvgUrlReference(
      readSvgStyleOrAttribute(wrapper, "clip-path"),
    );
    const definition = referenceId
      ? context.maskDefinitions.get(referenceId)
      : undefined;
    if (
      !referenceId ||
      !definition ||
      !validateSvgFrameClipDefinition(definition, width, height, radius)
    ) {
      context.issues.push(
        svgIssue(
          "mask-omitted",
          "error",
          "OpenDesign SVG Frame clipping definition is missing or does not match the Frame bounds",
          { nodeId, sourceElement: wrapper.localName },
        ),
      );
      return null;
    }
    clipsContent = true;
    children = elementChildren(wrapper);
  }

  const childIds = importContainerChildren(
    context,
    children,
    nodeId,
    inheritedStyle,
    depth + 1,
  );
  const frame: DesignNode = {
    ...common,
    kind: "frame",
    childIds,
    transform,
    size: { width, height },
    properties: {
      ...shape,
      cornerRadius: radius,
      clipsContent,
    },
  };
  context.nodes.push(frame);
  return nodeId;
}

function importShapeProperties(
  context: ImportContext,
  element: Element,
  style: ImportedSvgStyle,
  nodeId: string,
): ShapeProperties | null {
  if (!Number.isFinite(style.strokeWidth) || style.strokeWidth < 0) {
    context.issues.push(
      svgIssue(
        "invalid-dimension",
        "error",
        `SVG stroke width on ${nodeId} must be finite and non-negative`,
        { nodeId, sourceElement: element.localName },
      ),
    );
    return null;
  }
  const fill = importPaint(
    context,
    element,
    style.fill,
    style.fillOpacity,
    nodeId,
  );
  const stroke = importPaint(
    context,
    element,
    style.stroke,
    style.strokeOpacity,
    nodeId,
  );
  if (fill === null || stroke === null) return null;
  return {
    fills: fill ? [fill] : [],
    strokes: stroke ? [stroke] : [],
    strokeWidth: style.stroke === "none" ? 0 : style.strokeWidth,
    strokeAlign: "center",
    strokeCap: style.strokeCap,
    strokeJoin: style.strokeJoin,
    dashPattern: style.dashPattern,
  };
}

function importPaint(
  context: ImportContext,
  element: Element,
  value: string,
  opacity: number,
  nodeId: string,
): Paint | undefined | null {
  const paint = value.trim();
  if (paint === "none") return undefined;
  if (
    paint === "currentColor" ||
    paint === "context-fill" ||
    paint === "context-stroke"
  ) {
    context.issues.push(
      svgIssue(
        "unsupported-paint",
        "error",
        `SVG paint ${paint} on ${nodeId} depends on an unsupported external style context`,
        { nodeId, sourceElement: element.localName },
      ),
    );
    return null;
  }
  const reference = /^url\(\s*#([^\s)]+)\s*\)$/.exec(paint);
  if (!reference) {
    if (/^url\(/i.test(paint)) {
      context.issues.push(
        svgIssue(
          "external-reference",
          "error",
          `SVG paint on ${nodeId} references an external resource`,
          { nodeId, sourceElement: element.localName },
        ),
      );
      return null;
    }
    return { type: "solid", color: paint, opacity };
  }
  const definition = context.gradientDefinitions.get(reference[1]!);
  if (!definition) {
    context.issues.push(
      svgIssue(
        "unsupported-gradient",
        "error",
        `SVG gradient #${reference[1]} is missing`,
        { nodeId, sourceElement: element.localName },
      ),
    );
    return null;
  }
  if (
    definition.getAttribute("gradientUnits") &&
    definition.getAttribute("gradientUnits") !== "objectBoundingBox"
  ) {
    context.issues.push(
      svgIssue(
        "unsupported-gradient",
        "error",
        `SVG gradient #${reference[1]} uses unsupported user-space coordinates`,
        { nodeId, sourceElement: element.localName },
      ),
    );
    return null;
  }
  const stops = elementChildren(definition)
    .filter((child) => child.localName.toLowerCase() === "stop")
    .map((stop) => ({
      offset: readSvgUnitInterval(readSvgStyleOrAttribute(stop, "offset"), 0),
      color: readSvgStyleOrAttribute(stop, "stop-color") || "#000000",
      opacity: readSvgOpacity(readSvgStyleOrAttribute(stop, "stop-opacity"), 1),
    }));
  if (stops.length < 2) {
    context.issues.push(
      svgIssue(
        "unsupported-gradient",
        "error",
        `SVG gradient #${reference[1]} requires at least two stops`,
        { nodeId },
      ),
    );
    return null;
  }
  const rotation = readGradientRotation(definition, context.issues);
  if (definition.localName.toLowerCase() === "lineargradient") {
    return {
      type: "linear-gradient",
      opacity,
      stops,
      from: {
        x: readSvgUnitInterval(definition.getAttribute("x1"), 0),
        y: readSvgUnitInterval(definition.getAttribute("y1"), 0.5),
      },
      to: {
        x: readSvgUnitInterval(definition.getAttribute("x2"), 1),
        y: readSvgUnitInterval(definition.getAttribute("y2"), 0.5),
      },
      ...(rotation === undefined ? {} : { rotation }),
    };
  }
  if (definition.localName.toLowerCase() === "radialgradient") {
    const center = {
      x: readSvgUnitInterval(definition.getAttribute("cx"), 0.5),
      y: readSvgUnitInterval(definition.getAttribute("cy"), 0.5),
    };
    const radius = readSvgUnitInterval(definition.getAttribute("r"), 0.5);
    return {
      type: "radial-gradient",
      opacity,
      stops,
      from: center,
      to: { x: center.x + radius, y: center.y },
      ...(rotation === undefined ? {} : { rotation }),
    };
  }
  context.issues.push(
    svgIssue(
      "unsupported-gradient",
      "error",
      `SVG gradient #${reference[1]} is not linear or radial`,
      { nodeId },
    ),
  );
  return null;
}

function readElementPath(
  element: Element,
  tag: string,
  issues: SvgInterchangeIssue[],
): string | null {
  if (tag === "path") return element.getAttribute("d")?.trim() || null;
  if (tag === "line") {
    const x1 = readSvgLength(element, "x1", 0, issues);
    const y1 = readSvgLength(element, "y1", 0, issues);
    const x2 = readSvgLength(element, "x2", 0, issues);
    const y2 = readSvgLength(element, "y2", 0, issues);
    if ([x1, y1, x2, y2].some((value) => value === null)) return null;
    return `M ${formatNumber(x1!)} ${formatNumber(y1!)} L ${formatNumber(x2!)} ${formatNumber(y2!)}`;
  }
  if (tag === "polygon" || tag === "polyline") {
    const values = (element.getAttribute("points") ?? "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (
      values.length < 4 ||
      values.length % 2 !== 0 ||
      !values.every(Number.isFinite)
    ) {
      return null;
    }
    const commands: string[] = [];
    for (let index = 0; index < values.length; index += 2) {
      commands.push(
        `${index === 0 ? "M" : "L"} ${formatNumber(values[index]!)} ${formatNumber(values[index + 1]!)}`,
      );
    }
    if (tag === "polygon") commands.push("Z");
    return commands.join(" ");
  }
  return null;
}

function reportUnsupportedElementAttributes(
  element: Element,
  issues: SvgInterchangeIssue[],
  ignoreMaskReference: boolean,
): void {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (!attribute) continue;
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on")) {
      issues.push(
        svgIssue(
          "unsafe-xml",
          "error",
          `SVG event attribute ${attribute.name} is not accepted`,
          { sourceElement: element.localName },
        ),
      );
      continue;
    }
    if (name === "class") {
      issues.push(
        svgIssue(
          "unsupported-css",
          "warning",
          "SVG class selectors are not resolved by the editable import boundary",
          { sourceElement: element.localName },
        ),
      );
      continue;
    }
    if (name === "mask" || name === "clip-path") {
      if (ignoreMaskReference) continue;
    }
  }
}

function collectGradientDefinitions(
  root: Element,
): ReadonlyMap<string, Element> {
  const definitions = new Map<string, Element>();
  const pending = [root];
  while (pending.length > 0) {
    const element = pending.pop();
    if (!element) break;
    const tag = element.localName.toLowerCase();
    const id = element.getAttribute("id");
    if (id && (tag === "lineargradient" || tag === "radialgradient")) {
      definitions.set(id, element);
    }
    pending.push(...elementChildren(element));
  }
  return definitions;
}

function readGradientRotation(
  definition: Element,
  issues: SvgInterchangeIssue[],
): number | undefined {
  const value = definition.getAttribute("gradientTransform")?.trim();
  if (!value) return undefined;
  const match =
    /^rotate\(\s*([+-]?(?:\d+\.?\d*|\.\d+))(?:[ ,]+0\.5[ ,]+0\.5)?\s*\)$/i.exec(
      value,
    );
  if (!match) {
    issues.push(
      svgIssue(
        "unsupported-gradient",
        "error",
        "SVG gradientTransform currently supports only rotate(angle 0.5 0.5)",
        { sourceElement: definition.localName },
      ),
    );
    return undefined;
  }
  return Number(match[1]);
}

function elementChildren(element: Element): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 1) children.push(child as Element);
  }
  return children;
}

function readSvgName(element: Element): string {
  return (
    element.getAttribute("data-name") ||
    element.getAttribute("aria-label") ||
    element.getAttribute("id") ||
    ""
  ).trim();
}

function nextImportedNodeId(context: ImportContext, tag: string): string {
  context.nodeSequence += 1;
  return `${context.idPrefix}_${context.nodeSequence.toString().padStart(4, "0")}_${sanitizeXmlId(tag)}`;
}

function isFinitePositiveRect(value: Rect): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function hasErrors(issues: readonly SvgInterchangeIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

function matrixAttribute(transform: Transform): string {
  return `matrix(${transform.map(formatNumber).join(" ")})`;
}

function sanitizeXmlId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `od_${sanitized}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function capitalize(value: string): string {
  return value.length === 0
    ? value
    : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function svgIssue(
  code: SvgInterchangeIssueCode,
  severity: SvgInterchangeIssueSeverity,
  message: string,
  context: Pick<SvgInterchangeIssue, "nodeId" | "sourceElement"> = {},
): SvgInterchangeIssue {
  return { code, severity, message, ...context };
}

function failure(
  code: SvgInterchangeIssueCode,
  message: string,
): SvgFailureResult {
  return failed([svgIssue(code, "error", message)]);
}

function failed(issues: readonly SvgInterchangeIssue[]): SvgFailureResult {
  return {
    ok: false,
    version: SVG_INTERCHANGE_VERSION,
    issues,
  };
}

// These aliases keep the public service tied to OpenDesign's versioned
// contracts without exposing third-party DOM or matrix values.
type ShapeProperties = Extract<
  DesignNode,
  {
    kind:
      | "boolean"
      | "ellipse"
      | "frame"
      | "line"
      | "path"
      | "rectangle"
      | "text"
      | "vector";
  }
>["properties"];
