import type { DesignNode, Paint } from "@opendesign/design-contracts";
import { appendSvgEffectFilter } from "./svg-filter-effects.js";
import type { SvgInterchangeIssue } from "./svg-issues.js";
import { createSvgIssue } from "./svg-issues.js";
import {
  readSvgOpacity,
  readSvgStyleOrAttribute,
  readSvgUnitInterval,
  type ImportedSvgStyle,
} from "./svg-normalize.js";
import {
  formatSvgNumber,
  sanitizeSvgXmlId,
  SVG_NAMESPACE,
} from "./svg-serialize.js";

export type SvgShapeProperties = Extract<
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

export interface SvgAppearanceExportContext {
  definitions: Element;
  document: Document;
  filterSequence: number;
  gradientSequence: number;
  issues: SvgInterchangeIssue[];
}

export interface SvgAppearanceImportContext {
  gradientDefinitions: ReadonlyMap<string, Element>;
  issues: SvgInterchangeIssue[];
}

export function applyExportNodeAppearance(
  context: SvgAppearanceExportContext,
  element: Element,
  node: DesignNode,
  maskSource: boolean,
): void {
  if (node.opacity !== 1) {
    element.setAttribute("opacity", formatSvgNumber(node.opacity));
  }
  if (!node.visible) element.setAttribute("display", "none");
  if (node.blendMode && node.blendMode !== "pass-through") {
    element.setAttribute("style", `mix-blend-mode:${node.blendMode}`);
  }
  if ((node.effects?.length ?? 0) > 0) {
    const result = appendSvgEffectFilter({
      definitions: context.definitions,
      document: context.document,
      filterId: `od_filter_${++context.filterSequence}_${sanitizeSvgXmlId(node.id)}`,
      node,
    });
    context.issues.push(...result.issues);
    if (result.filterId) {
      element.setAttribute("filter", `url(#${result.filterId})`);
    }
  }
  if (!maskSource && node.maskMode && node.maskMode !== "none") {
    context.issues.push(
      createSvgIssue(
        "mask-omitted",
        "warning",
        `Mask source ${node.id} was exported without its parent sibling run, so mode ${node.maskMode} could not be preserved`,
        { nodeId: node.id },
      ),
    );
  }
}

export function applyExportShapeAppearance(
  context: SvgAppearanceExportContext,
  element: Element,
  nodeId: string,
  properties: SvgShapeProperties,
): void {
  applyExportPaint(context, element, nodeId, "fill", properties.fills);
  applyExportPaint(context, element, nodeId, "stroke", properties.strokes);
  if (properties.strokes.length === 0) return;

  element.setAttribute("stroke-width", formatSvgNumber(properties.strokeWidth));
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
      properties.dashPattern.map(formatSvgNumber).join(" "),
    );
  }
  if (properties.strokeAlign && properties.strokeAlign !== "center") {
    context.issues.push(
      createSvgIssue(
        "stroke-alignment-flattened",
        "warning",
        `${properties.strokeAlign} stroke on ${nodeId} requires outline-stroke conversion for standard SVG fidelity`,
        { nodeId },
      ),
    );
  }
}

export function collectSvgGradientDefinitions(
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

export function importSvgShapeProperties(
  context: SvgAppearanceImportContext,
  element: Element,
  style: ImportedSvgStyle,
  nodeId: string,
): SvgShapeProperties | null {
  if (!Number.isFinite(style.strokeWidth) || style.strokeWidth < 0) {
    context.issues.push(
      createSvgIssue(
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

function applyExportPaint(
  context: SvgAppearanceExportContext,
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
      createSvgIssue(
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
      element.setAttribute(`${role}-opacity`, formatSvgNumber(paint.opacity));
    }
    return;
  }
  if (paint.type === "angular-gradient") {
    const first = paint.stops[0];
    element.setAttribute(role, first?.color ?? "none");
    if (first && first.opacity !== 1) {
      element.setAttribute(`${role}-opacity`, formatSvgNumber(first.opacity));
    }
    context.issues.push(
      createSvgIssue(
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
      createSvgIssue(
        "unsupported-paint",
        "error",
        `Image ${role} on ${nodeId} is not supported by the current SVG vector slice`,
        { nodeId },
      ),
    );
    return;
  }

  const gradientId = `od_gradient_${sanitizeSvgXmlId(nodeId)}_${role}_${context.gradientSequence++}`;
  const gradient = context.document.createElementNS(
    SVG_NAMESPACE,
    paint.type === "linear-gradient" ? "linearGradient" : "radialGradient",
  );
  gradient.setAttribute("id", gradientId);
  gradient.setAttribute("gradientUnits", "objectBoundingBox");
  if (paint.type === "linear-gradient") {
    gradient.setAttribute("x1", formatSvgNumber(paint.from?.x ?? 0));
    gradient.setAttribute("y1", formatSvgNumber(paint.from?.y ?? 0.5));
    gradient.setAttribute("x2", formatSvgNumber(paint.to?.x ?? 1));
    gradient.setAttribute("y2", formatSvgNumber(paint.to?.y ?? 0.5));
  } else {
    const center = paint.from ?? { x: 0.5, y: 0.5 };
    const edge = paint.to ?? { x: 1, y: 0.5 };
    gradient.setAttribute("cx", formatSvgNumber(center.x));
    gradient.setAttribute("cy", formatSvgNumber(center.y));
    gradient.setAttribute(
      "r",
      formatSvgNumber(Math.hypot(edge.x - center.x, edge.y - center.y)),
    );
  }
  if (paint.rotation !== undefined) {
    gradient.setAttribute(
      "gradientTransform",
      `rotate(${formatSvgNumber(paint.rotation)} 0.5 0.5)`,
    );
  }
  for (const stop of paint.stops) {
    const stopElement = context.document.createElementNS(SVG_NAMESPACE, "stop");
    stopElement.setAttribute("offset", formatSvgNumber(stop.offset));
    stopElement.setAttribute("stop-color", stop.color);
    stopElement.setAttribute("stop-opacity", formatSvgNumber(stop.opacity));
    gradient.appendChild(stopElement);
  }
  context.definitions.appendChild(gradient);
  element.setAttribute(role, `url(#${gradientId})`);
  if (paint.opacity !== 1) {
    element.setAttribute(`${role}-opacity`, formatSvgNumber(paint.opacity));
  }
}

function importPaint(
  context: SvgAppearanceImportContext,
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
      createSvgIssue(
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
        createSvgIssue(
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
      createSvgIssue(
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
      createSvgIssue(
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
      createSvgIssue(
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
    createSvgIssue(
      "unsupported-gradient",
      "error",
      `SVG gradient #${reference[1]} is not linear or radial`,
      { nodeId },
    ),
  );
  return null;
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
      createSvgIssue(
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
