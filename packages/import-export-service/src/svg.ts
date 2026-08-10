import type {
  DesignDocument,
  DesignNode,
  Paint,
  Rect,
  Transform,
} from "@opendesign/design-contracts";
import type { BooleanGeometryResolution } from "@opendesign/geometry-service/boolean-resolver";
import type {
  VectorFillRule,
  VectorGeometryProvider,
} from "@opendesign/geometry-service/vector-path";
import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  applyToPoint,
  compose,
  fromDefinition,
  fromTransformAttribute,
  identity,
  translate,
  type Matrix,
} from "transformation-matrix";
import { SVG_MAX_CHARACTERS } from "./limits.js";
import type {
  SvgInterchangeIssue,
  SvgInterchangeIssueCode,
  SvgInterchangeIssueSeverity,
} from "./svg-issues.js";

export * from "./svg-issues.js";

export const SVG_INTERCHANGE_VERSION = 1 as const;
export const SVG_MIME_TYPE = "image/svg+xml" as const;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_SVG_ELEMENTS = 10_000;
const MAX_SVG_DEPTH = 64;
const MAX_IMPORTED_NODES = 8_192;
const MAX_ID_PREFIX_CHARACTERS = 80;
const SAFE_ID_PREFIX = /^[A-Za-z][A-Za-z0-9_-]*$/;
const BLOCKED_XML_PATTERN = /<!\s*(?:DOCTYPE|ENTITY)\b/i;

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
  gradientSequence: number;
  issues: SvgInterchangeIssue[];
  request: SvgExportRequest;
  visiting: Set<string>;
}

interface ImportContext {
  geometry: VectorGeometryProvider;
  gradientDefinitions: ReadonlyMap<string, Element>;
  idPrefix: string;
  issues: SvgInterchangeIssue[];
  nodeSequence: number;
  nodes: DesignNode[];
}

interface ImportedStyle {
  fill: string;
  fillOpacity: number;
  fillRule: VectorFillRule;
  stroke: string;
  strokeCap: "none" | "round" | "square";
  strokeJoin: "bevel" | "miter" | "round";
  strokeOpacity: number;
  strokeWidth: number;
  dashPattern: number[];
}

const DEFAULT_IMPORTED_STYLE: ImportedStyle = {
  fill: "#000000",
  fillOpacity: 1,
  fillRule: "nonzero",
  stroke: "none",
  strokeCap: "none",
  strokeJoin: "miter",
  strokeOpacity: 1,
  strokeWidth: 1,
  dashPattern: [],
};

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
    gradientSequence: 0,
    issues,
    request,
    visiting: new Set(),
  };
  for (const rootNodeId of request.rootNodeIds) {
    const element = exportNode(context, rootNodeId, true);
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
  if (request.svg.length === 0 || request.svg.length > SVG_MAX_CHARACTERS) {
    return failure(
      "size-limit",
      `SVG import must contain between 1 and ${SVG_MAX_CHARACTERS} characters`,
    );
  }
  if (
    request.idPrefix.length > MAX_ID_PREFIX_CHARACTERS ||
    !SAFE_ID_PREFIX.test(request.idPrefix)
  ) {
    return failure(
      "invalid-root",
      "SVG import idPrefix must start with a letter and contain only letters, digits, underscore, or hyphen",
    );
  }
  if (BLOCKED_XML_PATTERN.test(request.svg)) {
    return failure(
      "unsafe-xml",
      "SVG import rejects DOCTYPE and ENTITY declarations",
    );
  }

  const parseMessages: string[] = [];
  const parsed = new DOMParser({
    errorHandler: {
      warning: (message) => parseMessages.push(String(message)),
      error: (message) => parseMessages.push(String(message)),
      fatalError: (message) => parseMessages.push(String(message)),
    },
  }).parseFromString(request.svg, SVG_MIME_TYPE);
  if (parseMessages.length > 0) {
    return failure(
      "malformed-svg",
      `SVG XML is malformed: ${parseMessages[0] ?? "parse failure"}`,
    );
  }
  const root = parsed.documentElement;
  if (root.localName.toLowerCase() !== "svg") {
    return failure("invalid-root", "SVG import root element must be <svg>");
  }
  const structureIssue = validateSvgStructure(root);
  if (structureIssue) return failed([structureIssue]);
  const sourceViewport = readSvgViewport(root);
  if (!sourceViewport) {
    return failure(
      "invalid-dimension",
      "SVG import requires a finite positive viewBox or width and height",
    );
  }

  const issues: SvgInterchangeIssue[] = [];
  const rootStyle = readImportedStyle(root, DEFAULT_IMPORTED_STYLE, issues);
  const context: ImportContext = {
    geometry,
    gradientDefinitions: collectGradientDefinitions(root),
    idPrefix: request.idPrefix,
    issues,
    nodeSequence: 0,
    nodes: [],
  };
  const rootNodeId = nextImportedNodeId(context, "root");
  const childIds: string[] = [];
  for (const child of elementChildren(root)) {
    const childId = importElement(context, child, rootNodeId, rootStyle, 1);
    if (childId) childIds.push(childId);
  }
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
      node.transform = fromMatrix(
        compose(viewportOffset, toMatrix(node.transform)),
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
    opacity: readOpacity(root.getAttribute("opacity"), 1),
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
  selectedRoot: boolean,
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
    if (node.kind === "group" || node.kind === "frame") {
      const group = context.document.createElementNS(SVG_NAMESPACE, "g");
      applyExportMetadata(context, group, node);
      applyExportTransform(context, group, node, selectedRoot);
      applyExportNodeAppearance(context, group, node);
      if (node.kind === "frame") {
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
          context.issues.push(
            svgIssue(
              "frame-clipping-omitted",
              "warning",
              `Frame ${node.id} clipping is not preserved by the current SVG slice`,
              { nodeId: node.id },
            ),
          );
        }
      }
      for (const childId of node.childIds) {
        const child = exportNode(context, childId, false);
        if (child) group.appendChild(child);
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
      applyExportTransform(context, path, node, selectedRoot);
      applyExportNodeAppearance(context, path, node);
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
    } else if (node.kind === "path" || node.kind === "vector") {
      element = context.document.createElementNS(SVG_NAMESPACE, "path");
      element.setAttribute("d", node.properties.path);
      element.setAttribute("fill-rule", node.properties.fillRule ?? "nonzero");
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
    applyExportTransform(context, element, node, selectedRoot);
    applyExportNodeAppearance(context, element, node);
    applyExportShapeAppearance(context, element, node.id, node.properties);
    return element;
  } finally {
    context.visiting.delete(nodeId);
  }
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
): void {
  if (node.opacity !== 1) {
    element.setAttribute("opacity", formatNumber(node.opacity));
  }
  if (!node.visible) element.setAttribute("display", "none");
  if (node.blendMode && node.blendMode !== "pass-through") {
    element.setAttribute("style", `mix-blend-mode:${node.blendMode}`);
  }
  if (node.effects?.some((effect) => effect.visible !== false)) {
    context.issues.push(
      svgIssue(
        "effect-omitted",
        "warning",
        `Effects on ${node.id} require the later SVG filter fidelity slice`,
        { nodeId: node.id },
      ),
    );
  }
  if (node.maskMode && node.maskMode !== "none") {
    context.issues.push(
      svgIssue(
        "mask-omitted",
        "warning",
        `Mask mode ${node.maskMode} on ${node.id} is not preserved by the current SVG slice`,
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

function importElement(
  context: ImportContext,
  element: Element,
  parentId: string,
  inheritedStyle: ImportedStyle,
  depth: number,
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
  if (
    tag === "image" ||
    tag === "text" ||
    tag === "clippath" ||
    tag === "mask"
  ) {
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

  const localStyle = readImportedStyle(element, inheritedStyle, context.issues);
  reportUnsupportedElementAttributes(element, context.issues);
  const nodeId = nextImportedNodeId(context, tag);
  const transform = readElementTransform(element, context.issues);
  const common = {
    id: nodeId,
    name: readSvgName(element) || `${capitalize(tag)} ${context.nodeSequence}`,
    parentId,
    childIds: [] as string[],
    visible:
      element.getAttribute("display") !== "none" &&
      element.getAttribute("visibility") !== "hidden",
    locked: false,
    opacity: readOpacity(element.getAttribute("opacity"), 1),
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

  if (tag === "g") {
    const childIds: string[] = [];
    for (const child of elementChildren(element)) {
      const childId = importElement(
        context,
        child,
        nodeId,
        localStyle,
        depth + 1,
      );
      if (childId) childIds.push(childId);
    }
    if (childIds.length === 0) return null;
    const bounds = importedGroupBounds(context.nodes, childIds);
    rebaseImportedChildren(context.nodes, childIds, bounds.x, bounds.y);
    const node: DesignNode = {
      ...common,
      kind: "group",
      childIds,
      transform: fromMatrix(
        compose(toMatrix(transform), translate(bounds.x, bounds.y)),
      ),
      size: { width: bounds.width, height: bounds.height },
      properties: {},
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

  if (tag === "rect") {
    const x = readLength(element, "x", 0, context.issues);
    const y = readLength(element, "y", 0, context.issues);
    const width = readLength(element, "width", null, context.issues);
    const height = readLength(element, "height", null, context.issues);
    if (x === null || y === null || !isPositive(width) || !isPositive(height)) {
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
    const radius = readLength(element, "rx", 0, context.issues);
    const node: DesignNode = {
      ...common,
      kind: "rectangle",
      transform: fromMatrix(compose(toMatrix(transform), translate(x, y))),
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
    const cx = readLength(element, "cx", 0, context.issues);
    const cy = readLength(element, "cy", 0, context.issues);
    const rx =
      tag === "circle"
        ? readLength(element, "r", null, context.issues)
        : readLength(element, "rx", null, context.issues);
    const ry =
      tag === "circle" ? rx : readLength(element, "ry", null, context.issues);
    if (cx === null || cy === null || !isPositive(rx) || !isPositive(ry)) {
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
      transform: fromMatrix(
        compose(toMatrix(transform), translate(cx - rx, cy - ry)),
      ),
      size: { width: rx * 2, height: ry * 2 },
      properties,
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
    transform: fromMatrix(
      compose(toMatrix(transform), translate(origin.x, origin.y)),
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

function importShapeProperties(
  context: ImportContext,
  element: Element,
  style: ImportedStyle,
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
      offset: readUnitInterval(readStyleOrAttribute(stop, "offset"), 0),
      color: readStyleOrAttribute(stop, "stop-color") || "#000000",
      opacity: readOpacity(readStyleOrAttribute(stop, "stop-opacity"), 1),
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
        x: readUnitInterval(definition.getAttribute("x1"), 0),
        y: readUnitInterval(definition.getAttribute("y1"), 0.5),
      },
      to: {
        x: readUnitInterval(definition.getAttribute("x2"), 1),
        y: readUnitInterval(definition.getAttribute("y2"), 0.5),
      },
      ...(rotation === undefined ? {} : { rotation }),
    };
  }
  if (definition.localName.toLowerCase() === "radialgradient") {
    const center = {
      x: readUnitInterval(definition.getAttribute("cx"), 0.5),
      y: readUnitInterval(definition.getAttribute("cy"), 0.5),
    };
    const radius = readUnitInterval(definition.getAttribute("r"), 0.5);
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

function readImportedStyle(
  element: Element,
  inherited: ImportedStyle,
  issues: SvgInterchangeIssue[],
): ImportedStyle {
  const declarations = new Map<string, string>();
  const style = element.getAttribute("style");
  if (style) {
    for (const declaration of style.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator <= 0) continue;
      declarations.set(
        declaration.slice(0, separator).trim().toLowerCase(),
        declaration.slice(separator + 1).trim(),
      );
    }
  }
  const read = (name: string): string | null =>
    declarations.get(name) ??
    (element.hasAttribute(name) ? element.getAttribute(name) : null);
  const supported = new Set([
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-opacity",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
  ]);
  declarations.forEach((_value, name) => {
    if (!supported.has(name)) {
      issues.push(
        svgIssue(
          "unsupported-css",
          "warning",
          `SVG inline style property ${name} is not preserved`,
          { sourceElement: element.localName },
        ),
      );
    }
  });
  const cap = read("stroke-linecap");
  const join = read("stroke-linejoin");
  return {
    fill: read("fill") ?? inherited.fill,
    fillOpacity: readOpacity(read("fill-opacity"), inherited.fillOpacity),
    fillRule:
      read("fill-rule") === "evenodd"
        ? "evenodd"
        : read("fill-rule") === "nonzero"
          ? "nonzero"
          : inherited.fillRule,
    stroke: read("stroke") ?? inherited.stroke,
    strokeCap:
      cap === "round"
        ? "round"
        : cap === "square"
          ? "square"
          : cap === "butt"
            ? "none"
            : inherited.strokeCap,
    strokeJoin:
      join === "round"
        ? "round"
        : join === "bevel"
          ? "bevel"
          : join === "miter"
            ? "miter"
            : inherited.strokeJoin,
    strokeOpacity: readOpacity(read("stroke-opacity"), inherited.strokeOpacity),
    strokeWidth: readFiniteNumber(read("stroke-width"), inherited.strokeWidth),
    dashPattern: readDashPattern(
      read("stroke-dasharray"),
      inherited.dashPattern,
    ),
  };
}

function readStyleOrAttribute(element: Element, name: string): string | null {
  const style = element.getAttribute("style");
  if (style) {
    for (const declaration of style.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator <= 0) continue;
      if (
        declaration.slice(0, separator).trim().toLowerCase() ===
        name.toLowerCase()
      ) {
        return declaration.slice(separator + 1).trim();
      }
    }
  }
  return element.hasAttribute(name) ? element.getAttribute(name) : null;
}

function readElementPath(
  element: Element,
  tag: string,
  issues: SvgInterchangeIssue[],
): string | null {
  if (tag === "path") return element.getAttribute("d")?.trim() || null;
  if (tag === "line") {
    const x1 = readLength(element, "x1", 0, issues);
    const y1 = readLength(element, "y1", 0, issues);
    const x2 = readLength(element, "x2", 0, issues);
    const y2 = readLength(element, "y2", 0, issues);
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

function readElementTransform(
  element: Element,
  issues: SvgInterchangeIssue[],
): Transform {
  const value = element.getAttribute("transform");
  if (!value?.trim()) return [1, 0, 0, 1, 0, 0];
  try {
    const descriptors = fromTransformAttribute(value);
    const matrices = fromDefinition(descriptors);
    const matrix = matrices.length === 0 ? identity() : compose(matrices);
    if (!isFiniteMatrix(matrix)) throw new TypeError("non-finite transform");
    return fromMatrix(matrix);
  } catch (error) {
    issues.push(
      svgIssue(
        "invalid-transform",
        "error",
        error instanceof Error
          ? `Invalid SVG transform: ${error.message}`
          : "Invalid SVG transform",
        { sourceElement: element.localName },
      ),
    );
    return [1, 0, 0, 1, 0, 0];
  }
}

function importedGroupBounds(
  nodes: readonly DesignNode[],
  childIds: readonly string[],
): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const childId of childIds) {
    const child = nodes.find((candidate) => candidate.id === childId);
    if (!child) continue;
    const matrix = toMatrix(child.transform);
    const corners = [
      applyToPoint(matrix, { x: 0, y: 0 }),
      applyToPoint(matrix, { x: child.size.width, y: 0 }),
      applyToPoint(matrix, { x: 0, y: child.size.height }),
      applyToPoint(matrix, { x: child.size.width, y: child.size.height }),
    ];
    for (const point of corners) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function rebaseImportedChildren(
  nodes: readonly DesignNode[],
  childIds: readonly string[],
  x: number,
  y: number,
): void {
  const offset = translate(-x, -y);
  for (const childId of childIds) {
    const child = nodes.find((candidate) => candidate.id === childId);
    if (child) {
      child.transform = fromMatrix(compose(offset, toMatrix(child.transform)));
    }
  }
}

function reportUnsupportedElementAttributes(
  element: Element,
  issues: SvgInterchangeIssue[],
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
    if (name === "filter") {
      issues.push(
        svgIssue(
          "effect-omitted",
          "warning",
          "SVG filter effects are not preserved by the current import slice",
          { sourceElement: element.localName },
        ),
      );
      continue;
    }
    if (name === "mask" || name === "clip-path") {
      issues.push(
        svgIssue(
          "mask-omitted",
          "warning",
          `SVG ${attribute.name} is not preserved by the current import slice`,
          { sourceElement: element.localName },
        ),
      );
    }
  }
}

function validateSvgStructure(root: Element): SvgInterchangeIssue | null {
  let count = 0;
  const pending: Array<{ element: Element; depth: number }> = [
    { element: root, depth: 0 },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    const tag = current.element.localName.toLowerCase();
    if (tag === "script" || tag === "foreignobject") {
      return svgIssue(
        "unsupported-element",
        "error",
        `SVG <${tag}> is not accepted by the editable import boundary`,
        { sourceElement: tag },
      );
    }
    if (tag === "style") {
      return svgIssue(
        "unsupported-css",
        "error",
        "SVG stylesheets are not accepted; use presentation attributes or inline style",
        { sourceElement: tag },
      );
    }
    if (tag === "use") {
      return svgIssue(
        "external-reference",
        "error",
        "SVG <use> references are not accepted by the editable import boundary",
        { sourceElement: tag },
      );
    }
    for (
      let attributeIndex = 0;
      attributeIndex < current.element.attributes.length;
      attributeIndex += 1
    ) {
      const attribute = current.element.attributes.item(attributeIndex);
      if (!attribute) continue;
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        return svgIssue(
          "unsafe-xml",
          "error",
          `SVG event attribute ${attribute.name} is not accepted`,
          { sourceElement: tag },
        );
      }
      if (name === "href" || name === "xlink:href") {
        return svgIssue(
          "external-reference",
          "error",
          `SVG reference attribute ${attribute.name} is not accepted`,
          { sourceElement: tag },
        );
      }
    }
    count += 1;
    if (count > MAX_SVG_ELEMENTS) {
      return svgIssue(
        "element-limit",
        "error",
        `SVG import exceeds ${MAX_SVG_ELEMENTS} XML elements`,
      );
    }
    if (current.depth > MAX_SVG_DEPTH) {
      return svgIssue(
        "depth-limit",
        "error",
        `SVG import exceeds ${MAX_SVG_DEPTH} nested levels`,
      );
    }
    for (const child of elementChildren(current.element)) {
      pending.push({ element: child, depth: current.depth + 1 });
    }
  }
  return null;
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

function readSvgViewport(root: Element): Rect | null {
  const viewBox = root.getAttribute("viewBox")?.trim();
  if (viewBox) {
    const values = viewBox.split(/[\s,]+/).map(Number);
    if (
      values.length === 4 &&
      values.every(Number.isFinite) &&
      values[2]! > 0 &&
      values[3]! > 0
    ) {
      return {
        x: values[0]!,
        y: values[1]!,
        width: values[2]!,
        height: values[3]!,
      };
    }
    return null;
  }
  const width = parseSvgLength(root.getAttribute("width"));
  const height = parseSvgLength(root.getAttribute("height"));
  return isPositive(width) && isPositive(height)
    ? { x: 0, y: 0, width, height }
    : null;
}

function readLength(
  element: Element,
  attribute: string,
  fallback: number | null,
  issues: SvgInterchangeIssue[],
): number | null {
  const value = element.getAttribute(attribute);
  if (!value) return fallback;
  const parsed = parseSvgLength(value);
  if (parsed === null) {
    issues.push(
      svgIssue(
        "invalid-dimension",
        "error",
        `SVG ${element.localName}.${attribute} must use finite px or unitless coordinates`,
        { sourceElement: element.localName },
      ),
    );
  }
  return parsed;
}

function parseSvgLength(value: string | null): number | null {
  if (value === null) return null;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:px)?$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const result = Number(match[1]);
  return Number.isFinite(result) ? result : null;
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

function readDashPattern(value: string | null, fallback: number[]): number[] {
  if (!value || value === "none") return value === "none" ? [] : [...fallback];
  const numbers = value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  return numbers.length > 0 &&
    numbers.every((number) => Number.isFinite(number) && number >= 0)
    ? numbers
    : [...fallback];
}

function readFiniteNumber(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = parseSvgLength(value) ?? Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOpacity(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = value.trim().endsWith("%")
    ? Number(value.trim().slice(0, -1)) / 100
    : Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
}

function readUnitInterval(value: string | null, fallback: number): number {
  return readOpacity(value, fallback);
}

function isPositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
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

function toMatrix(transform: Transform): Matrix {
  const [a, b, c, d, e, f] = transform;
  return { a, b, c, d, e, f };
}

function fromMatrix(matrix: Matrix): Transform {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
}

function isFiniteMatrix(matrix: Matrix): boolean {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(
    Number.isFinite,
  );
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
      | "path"
      | "rectangle"
      | "text"
      | "vector";
  }
>["properties"];
