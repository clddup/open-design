import type { LineEndpoint } from "@opendesign/design-contracts";
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

export function appendSvgLineEndpointDefinition(options: {
  definitions: Element;
  document: Document;
  endpoint: Exclude<LineEndpoint, "none">;
  id: string;
}): void {
  const marker = createMarker(options.document, options.id, options.endpoint);
  options.definitions.appendChild(marker);
}

export function collectSvgLineEndpointDefinitions(
  root: Element,
  issues: SvgInterchangeIssue[],
): ReadonlyMap<string, { element: Element; endpoint: LineEndpoint }> {
  const definitions = new Map<
    string,
    { element: Element; endpoint: LineEndpoint }
  >();
  const pending = [root];
  while (pending.length > 0) {
    const element = pending.pop();
    if (!element) break;
    if (element.localName.toLowerCase() === "marker") {
      const endpoint = readEndpoint(element);
      if (endpoint) {
        const id = element.getAttribute("id")?.trim();
        if (!id || definitions.has(id)) {
          issues.push(
            issue(
              `OpenDesign SVG line endpoint marker requires a unique non-empty ID`,
              element,
            ),
          );
        } else if (!matchesMarker(element, endpoint)) {
          issues.push(
            issue(
              `OpenDesign SVG line endpoint marker #${id} was modified or is malformed`,
              element,
            ),
          );
        } else {
          definitions.set(id, { element, endpoint });
        }
      }
    }
    pending.push(...elementChildren(element));
  }
  return definitions;
}

export function readSvgLineEndpoints(options: {
  definitions: ReadonlyMap<
    string,
    { element: Element; endpoint: LineEndpoint }
  >;
  element: Element;
  issues: SvgInterchangeIssue[];
  nodeId: string;
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
  return definition.endpoint;
}

function createMarker(
  document: Document,
  id: string,
  endpoint: Exclude<LineEndpoint, "none">,
): Element {
  const marker = document.createElementNS(SVG_NAMESPACE, "marker");
  setAttributes(marker, markerAttributes(id, endpoint));
  const shape = endpointShape(document, endpoint);
  marker.appendChild(shape);
  return marker;
}

function markerAttributes(
  id: string,
  endpoint: Exclude<LineEndpoint, "none">,
): Record<string, string> {
  return {
    id,
    "data-opendesign-line-endpoint": endpoint,
    viewBox: "0 0 10 10",
    refX: "5",
    refY: "5",
    markerWidth: "4",
    markerHeight: "4",
    markerUnits: "strokeWidth",
    orient: "auto-start-reverse",
    overflow: "visible",
  };
}

function endpointShape(
  document: Document,
  endpoint: Exclude<LineEndpoint, "none">,
): Element {
  if (endpoint === "circle") {
    const circle = document.createElementNS(SVG_NAMESPACE, "circle");
    setAttributes(circle, {
      cx: "5",
      cy: "5",
      r: "3.5",
      fill: "context-stroke",
      stroke: "none",
    });
    return circle;
  }
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  if (endpoint === "line-arrow") {
    setAttributes(path, {
      d: "M 1 1 L 9 5 L 1 9",
      fill: "none",
      stroke: "context-stroke",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
  } else {
    setAttributes(path, {
      d:
        endpoint === "triangle-arrow"
          ? "M 1 1 L 9 5 L 1 9 Z"
          : endpoint === "reversed-triangle-arrow"
            ? "M 9 1 L 1 5 L 9 9 Z"
            : "M 5 1 L 9 5 L 5 9 L 1 5 Z",
      fill: "context-stroke",
      stroke: "none",
    });
  }
  return path;
}

function readEndpoint(
  marker: Element,
): Exclude<LineEndpoint, "none"> | undefined {
  const value = marker.getAttribute("data-opendesign-line-endpoint");
  return value && value !== "none" && ENDPOINTS.has(value as LineEndpoint)
    ? (value as Exclude<LineEndpoint, "none">)
    : undefined;
}

function matchesMarker(
  marker: Element,
  endpoint: Exclude<LineEndpoint, "none">,
): boolean {
  const id = marker.getAttribute("id");
  const children = elementChildren(marker);
  if (!id || children.length !== 1) return false;
  const expected = createMarker(marker.ownerDocument, id, endpoint);
  const expectedChild = expected.firstChild as Element | null;
  return (
    exactAttributes(marker, expected) &&
    expectedChild !== null &&
    children[0]!.localName === expectedChild.localName &&
    exactAttributes(children[0]!, expectedChild) &&
    elementChildren(children[0]!).length === 0
  );
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
