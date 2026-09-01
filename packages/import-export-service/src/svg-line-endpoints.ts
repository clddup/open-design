import type { LineEndpoint } from "@opendesign/design-contracts";
import {
  LINE_ENDPOINT_MARKER_SIZE,
  LINE_ENDPOINT_MARKER_VIEW_BOX,
  LINE_ENDPOINT_STROKE_WIDTH,
  resolveLineEndpointGeometry,
  serializeLineEndpointPath,
  type PaintedLineEndpoint,
} from "@opendesign/geometry-service/line-endpoint";
import type {
  VectorStrokeCap,
  VectorStrokeJoin,
} from "@opendesign/geometry-service/vector-path";
import type { SvgInterchangeIssue } from "./svg-issues.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ENDPOINTS = new Set<LineEndpoint>([
  "none",
  "line-arrow",
  "triangle-arrow",
  "reversed-triangle-arrow",
  "circle",
  "diamond",
]);

export interface SvgLineEndpointDefinition {
  cap: VectorStrokeCap;
  element: Element;
  endpoint: LineEndpoint;
  join: VectorStrokeJoin;
}

export function appendSvgLineEndpointDefinition(options: {
  cap: VectorStrokeCap;
  definitions: Element;
  document: Document;
  endpoint: Exclude<LineEndpoint, "none">;
  id: string;
  join: VectorStrokeJoin;
}): void {
  const marker = createMarker(
    options.document,
    options.id,
    options.endpoint,
    options.cap,
    options.join,
  );
  options.definitions.appendChild(marker);
}

export function collectSvgLineEndpointDefinitions(
  root: Element,
  issues: SvgInterchangeIssue[],
): ReadonlyMap<string, SvgLineEndpointDefinition> {
  const definitions = new Map<string, SvgLineEndpointDefinition>();
  const pending = [root];
  while (pending.length > 0) {
    const element = pending.pop();
    if (!element) break;
    if (element.localName.toLowerCase() === "marker") {
      const definition = readEndpointDefinition(element);
      if (definition) {
        const id = element.getAttribute("id")?.trim();
        if (!id || definitions.has(id)) {
          issues.push(
            issue(
              `OpenDesign SVG line endpoint marker requires a unique non-empty ID`,
              element,
            ),
          );
        } else if (!matchesMarker(element, definition)) {
          issues.push(
            issue(
              `OpenDesign SVG line endpoint marker #${id} was modified or is malformed`,
              element,
            ),
          );
        } else {
          definitions.set(id, { element, ...definition });
        }
      }
    }
    pending.push(...elementChildren(element));
  }
  return definitions;
}

export function readSvgLineEndpoints(options: {
  definitions: ReadonlyMap<string, SvgLineEndpointDefinition>;
  element: Element;
  issues: SvgInterchangeIssue[];
  nodeId: string;
  strokeCap: VectorStrokeCap;
  strokeJoin: VectorStrokeJoin;
}): { startEndpoint: LineEndpoint; endEndpoint: LineEndpoint } | null {
  const startEndpoint = readMarkerReference(options, "marker-start");
  const endEndpoint = readMarkerReference(options, "marker-end");
  if (startEndpoint === null || endEndpoint === null) return null;
  return { startEndpoint, endEndpoint };
}

function readMarkerReference(
  options: Parameters<typeof readSvgLineEndpoints>[0],
  attribute: "marker-start" | "marker-end",
): LineEndpoint | null {
  const value = readStyleOrAttribute(options.element, attribute)?.trim();
  if (!value || value === "none") return "none";
  const match = /^url\(\s*#([^\s)]+)\s*\)$/.exec(value);
  if (!match) {
    options.issues.push(
      issue(
        `SVG ${attribute} on ${options.nodeId} must reference a local controlled OpenDesign marker`,
        options.element,
        options.nodeId,
      ),
    );
    return null;
  }
  const definition = options.definitions.get(match[1]!);
  if (!definition) {
    options.issues.push(
      issue(
        `SVG ${attribute} on ${options.nodeId} references a missing or unsupported marker #${match[1]}`,
        options.element,
        options.nodeId,
      ),
    );
    return null;
  }
  if (
    definition.cap !== options.strokeCap ||
    definition.join !== options.strokeJoin
  ) {
    options.issues.push(
      issue(
        `SVG ${attribute} on ${options.nodeId} does not match the Line stroke cap and join`,
        options.element,
        options.nodeId,
      ),
    );
    return null;
  }
  return definition.endpoint;
}

function createMarker(
  document: Document,
  id: string,
  endpoint: PaintedLineEndpoint,
  cap: VectorStrokeCap,
  join: VectorStrokeJoin,
): Element {
  const marker = document.createElementNS(SVG_NAMESPACE, "marker");
  setAttributes(marker, markerAttributes(id, endpoint, cap, join));
  const shape = endpointShape(document, endpoint, cap, join);
  marker.appendChild(shape);
  return marker;
}

function markerAttributes(
  id: string,
  endpoint: PaintedLineEndpoint,
  cap: VectorStrokeCap,
  join: VectorStrokeJoin,
): Record<string, string> {
  return {
    id,
    "data-opendesign-line-endpoint": endpoint,
    "data-opendesign-stroke-cap": cap,
    "data-opendesign-stroke-join": join,
    viewBox: LINE_ENDPOINT_MARKER_VIEW_BOX,
    refX: "0",
    refY: "0",
    markerWidth: String(LINE_ENDPOINT_MARKER_SIZE),
    markerHeight: String(LINE_ENDPOINT_MARKER_SIZE),
    markerUnits: "strokeWidth",
    orient: "auto-start-reverse",
    overflow: "visible",
  };
}

function endpointShape(
  document: Document,
  endpoint: PaintedLineEndpoint,
  cap: VectorStrokeCap,
  join: VectorStrokeJoin,
): Element {
  const geometry = resolveLineEndpointGeometry(endpoint);
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  setAttributes(path, {
    d: serializeLineEndpointPath(geometry),
    fill: geometry.fill ? "context-stroke" : "none",
    stroke: "context-stroke",
    "stroke-width": String(LINE_ENDPOINT_STROKE_WIDTH),
    "stroke-linecap": cap,
    "stroke-linejoin": join,
  });
  return path;
}

function readEndpointDefinition(marker: Element):
  | {
      cap: VectorStrokeCap;
      endpoint: PaintedLineEndpoint;
      join: VectorStrokeJoin;
    }
  | undefined {
  const value = marker.getAttribute("data-opendesign-line-endpoint");
  const cap = marker.getAttribute("data-opendesign-stroke-cap");
  const join = marker.getAttribute("data-opendesign-stroke-join");
  if (
    !value ||
    value === "none" ||
    !ENDPOINTS.has(value as LineEndpoint) ||
    !isStrokeCap(cap) ||
    !isStrokeJoin(join)
  ) {
    return undefined;
  }
  return { cap, endpoint: value as PaintedLineEndpoint, join };
}

function matchesMarker(
  marker: Element,
  definition: {
    cap: VectorStrokeCap;
    endpoint: PaintedLineEndpoint;
    join: VectorStrokeJoin;
  },
): boolean {
  const id = marker.getAttribute("id");
  const children = elementChildren(marker);
  if (!id || children.length !== 1) return false;
  const expected = createMarker(
    marker.ownerDocument,
    id,
    definition.endpoint,
    definition.cap,
    definition.join,
  );
  const expectedChild = expected.firstChild as Element | null;
  return (
    exactAttributes(marker, expected) &&
    expectedChild !== null &&
    children[0]!.localName === expectedChild.localName &&
    exactAttributes(children[0]!, expectedChild) &&
    elementChildren(children[0]!).length === 0
  );
}

function isStrokeCap(value: string | null): value is VectorStrokeCap {
  return value === "butt" || value === "round" || value === "square";
}

function isStrokeJoin(value: string | null): value is VectorStrokeJoin {
  return value === "bevel" || value === "miter" || value === "round";
}

function exactAttributes(actual: Element, expected: Element): boolean {
  if (actual.attributes.length !== expected.attributes.length) return false;
  for (let index = 0; index < expected.attributes.length; index += 1) {
    const attribute = expected.attributes.item(index);
    if (!attribute || actual.getAttribute(attribute.name) !== attribute.value) {
      return false;
    }
  }
  return true;
}

function setAttributes(element: Element, attributes: Record<string, string>) {
  Object.entries(attributes).forEach(([name, value]) =>
    element.setAttribute(name, value),
  );
}

function elementChildren(element: Element): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 1) children.push(child as Element);
  }
  return children;
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

function issue(
  message: string,
  element: Element,
  nodeId?: string,
): SvgInterchangeIssue {
  return {
    code: "line-endpoint-unsupported",
    severity: "error",
    message,
    sourceElement: element.localName,
    ...(nodeId ? { nodeId } : {}),
  };
}
