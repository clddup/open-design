import type { DesignNode, Rect } from "@opendesign/design-contracts";
import { XMLSerializer } from "@xmldom/xmldom";
import type { SvgInterchangeIssue } from "./svg-issues.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export type SvgMaskMode = Exclude<NonNullable<DesignNode["maskMode"]>, "none">;

export interface SvgMaskReference {
  definition: Element;
  id: string;
  mode: SvgMaskMode;
  property: "clip-path" | "mask";
}

export function activeSvgMaskMode(
  node: DesignNode | undefined,
): SvgMaskMode | null {
  const mode = node?.maskMode;
  return mode && mode !== "none" ? mode : null;
}

export function appendSvgFrameClipDefinition(input: {
  definitions: Element;
  document: Document;
  height: number;
  id: string;
  radius: number;
  width: number;
}): void {
  const clip = input.document.createElementNS(SVG_NAMESPACE, "clipPath");
  clip.setAttribute("id", input.id);
  clip.setAttribute("clipPathUnits", "userSpaceOnUse");
  clip.setAttribute("data-opendesign-frame-clip", "true");
  clip.setAttribute("data-opendesign-frame-clip-version", "1");
  const rect = input.document.createElementNS(SVG_NAMESPACE, "rect");
  rect.setAttribute("width", formatNumber(input.width));
  rect.setAttribute("height", formatNumber(input.height));
  rect.setAttribute("rx", formatNumber(input.radius));
  clip.appendChild(rect);
  input.definitions.appendChild(clip);
}

export function createSvgMaskDefinition(input: {
  document: Document;
  id: string;
  mode: SvgMaskMode;
  region: Rect | null;
}): Element {
  const definition = input.document.createElementNS(
    SVG_NAMESPACE,
    input.mode === "outline" ? "clipPath" : "mask",
  );
  definition.setAttribute("id", input.id);
  definition.setAttribute("data-opendesign-mask-version", "1");
  definition.setAttribute("data-opendesign-mask-mode", input.mode);
  if (input.mode === "outline") {
    definition.setAttribute("clipPathUnits", "userSpaceOnUse");
    return definition;
  }

  definition.setAttribute("maskUnits", "userSpaceOnUse");
  definition.setAttribute("maskContentUnits", "userSpaceOnUse");
  definition.setAttribute(
    "mask-type",
    input.mode === "luminance" ? "luminance" : "alpha",
  );
  if (input.region) {
    definition.setAttribute("x", formatNumber(input.region.x));
    definition.setAttribute("y", formatNumber(input.region.y));
    definition.setAttribute("width", formatNumber(input.region.width));
    definition.setAttribute("height", formatNumber(input.region.height));
  }
  return definition;
}

export function stripSvgExportedLayerIdentity(element: Element): void {
  element.removeAttribute("id");
  element.removeAttribute("data-opendesign-id");
  for (const child of elementChildren(element)) {
    stripSvgExportedLayerIdentity(child);
  }
}

export function collectSvgMaskDefinitions(
  root: Element,
  issues: SvgInterchangeIssue[],
): ReadonlyMap<string, Element> {
  const definitions = new Map<string, Element>();
  const elements: Element[] = [];
  const idCounts = new Map<string, number>();
  const pending = [root];
  while (pending.length > 0) {
    const element = pending.pop();
    if (!element) break;
    elements.push(element);
    const id = element.getAttribute("id");
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    pending.push(...elementChildren(element));
  }
  const reportedCollisions = new Set<string>();
  for (const element of elements) {
    const tag = element.localName.toLowerCase();
    const id = element.getAttribute("id");
    if (id && (tag === "mask" || tag === "clippath")) {
      if ((idCounts.get(id) ?? 0) > 1 && !reportedCollisions.has(id)) {
        reportedCollisions.add(id);
        issues.push(
          issue(
            "mask-omitted",
            "error",
            `SVG mask or clipPath definition id #${id} collides with another element`,
            { sourceElement: tag },
          ),
        );
      } else if ((idCounts.get(id) ?? 0) === 1) {
        definitions.set(id, element);
      }
    }
  }
  return definitions;
}

export function resolveControlledSvgMaskRun(
  element: Element,
  definitions: ReadonlyMap<string, Element>,
  issues: SvgInterchangeIssue[],
): SvgMaskReference | null {
  const mode = parseSvgMaskMode(
    element.getAttribute("data-opendesign-mask-mode"),
  );
  const metadataReference = element.getAttribute(
    "data-opendesign-mask-reference",
  );
  if (!mode || !metadataReference) {
    issues.push(
      issue(
        "mask-omitted",
        "error",
        "OpenDesign SVG mask run metadata is incomplete",
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  const property = mode === "outline" ? "clip-path" : "mask";
  const referenceId = parseLocalSvgUrlReference(
    readStyleOrAttribute(element, property),
  );
  if (referenceId === null) {
    issues.push(
      issue(
        "external-reference",
        "error",
        `SVG ${property} on an OpenDesign mask run must use a local url(#id) reference`,
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  if (referenceId !== metadataReference) {
    issues.push(
      issue(
        "mask-omitted",
        "error",
        "OpenDesign SVG mask run metadata does not match its local reference",
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  const definition = definitions.get(referenceId);
  if (!definition || !validateControlledMaskDefinition(definition, mode)) {
    issues.push(
      issue(
        "mask-omitted",
        "error",
        `OpenDesign SVG mask definition #${referenceId} is missing or incompatible`,
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  if (
    element.hasAttribute("transform") ||
    element.hasAttribute("filter") ||
    element.hasAttribute("style") ||
    element.hasAttribute("display") ||
    element.hasAttribute("visibility") ||
    (mode !== "outline" && element.hasAttribute("opacity"))
  ) {
    issues.push(
      issue(
        "mask-omitted",
        "error",
        "OpenDesign SVG mask run contains unsupported appearance or transform",
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  if (mode === "outline") {
    const source = elementChildren(definition)[0];
    const sourceOpacity = readOpacity(
      source?.getAttribute("opacity") ?? null,
      1,
    );
    const runOpacity = readOpacity(element.getAttribute("opacity"), 1);
    if (!nearlyEqual(sourceOpacity, runOpacity)) {
      issues.push(
        issue(
          "mask-omitted",
          "error",
          "OpenDesign SVG outline mask run opacity does not match its source",
          { sourceElement: element.localName },
        ),
      );
      return null;
    }
  }
  return { definition, id: referenceId, mode, property };
}

export function readVisibleSvgMaskSourceReference(
  element: Element,
  definitions: ReadonlyMap<string, Element>,
  issues: SvgInterchangeIssue[],
): SvgMaskReference | null {
  if (element.getAttribute("data-opendesign-mask-source") !== "true") {
    return null;
  }
  const mode = parseSvgMaskMode(
    element.getAttribute("data-opendesign-mask-mode"),
  );
  const referenceId = element.getAttribute("data-opendesign-mask-reference");
  if (mode !== "clipping" || !referenceId) {
    issues.push(
      issue(
        "mask-omitted",
        "error",
        "Only clipping masks may expose a visible OpenDesign SVG source sibling",
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  const definition = definitions.get(referenceId);
  if (!definition || !validateControlledMaskDefinition(definition, mode)) {
    issues.push(
      issue(
        "mask-omitted",
        "error",
        `OpenDesign SVG clipping mask definition #${referenceId} is missing or incompatible`,
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  return { definition, id: referenceId, mode, property: "mask" };
}

export function controlledSvgClippingSourcesMatch(
  visibleSource: Element,
  definition: Element,
): boolean {
  const definitionSources = elementChildren(definition).filter(
    (child) =>
      !["title", "desc", "metadata", "defs"].includes(
        child.localName.toLowerCase(),
      ),
  );
  if (definitionSources.length !== 1) return false;
  const visible = visibleSource.cloneNode(true) as Element;
  const hidden = definitionSources[0]!.cloneNode(true) as Element;
  stripSvgExportedLayerIdentity(visible);
  stripSvgExportedLayerIdentity(hidden);
  const serializer = new XMLSerializer();
  return (
    serializer.serializeToString(visible) ===
    serializer.serializeToString(hidden)
  );
}

export function resolveStandardSvgMaskReference(
  element: Element,
  definitions: ReadonlyMap<string, Element>,
  issues: SvgInterchangeIssue[],
): SvgMaskReference | undefined | null {
  const rawMask = readStyleOrAttribute(element, "mask");
  const rawClipPath = readStyleOrAttribute(element, "clip-path");
  const mask = rawMask?.trim().toLowerCase() === "none" ? null : rawMask;
  const clipPath =
    rawClipPath?.trim().toLowerCase() === "none" ? null : rawClipPath;
  if (!mask && !clipPath) return undefined;
  if (mask && clipPath) {
    issues.push(
      issue(
        "mask-omitted",
        "error",
        "SVG elements combining mask and clip-path require a later compositing slice",
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  const property = clipPath ? "clip-path" : "mask";
  const referenceId = parseLocalSvgUrlReference(clipPath || mask);
  if (referenceId === null) {
    issues.push(
      issue(
        "external-reference",
        "error",
        `SVG ${property} must use a local url(#id) reference`,
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  const definition = definitions.get(referenceId);
  if (!definition) {
    issues.push(
      issue(
        "mask-omitted",
        "error",
        `SVG ${property} definition #${referenceId} is missing`,
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  const tag = definition.localName.toLowerCase();
  if (property === "clip-path") {
    if (
      tag !== "clippath" ||
      (definition.hasAttribute("clipPathUnits") &&
        definition.getAttribute("clipPathUnits") !== "userSpaceOnUse")
    ) {
      issues.push(
        issue(
          "mask-omitted",
          "error",
          `SVG clipPath #${referenceId} must use userSpaceOnUse coordinates`,
          { sourceElement: element.localName },
        ),
      );
      return null;
    }
    return { definition, id: referenceId, mode: "outline", property };
  }
  if (
    tag !== "mask" ||
    (definition.hasAttribute("maskContentUnits") &&
      definition.getAttribute("maskContentUnits") !== "userSpaceOnUse")
  ) {
    issues.push(
      issue(
        "mask-omitted",
        "error",
        `SVG mask #${referenceId} must use userSpaceOnUse content coordinates`,
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  const type = readStyleOrAttribute(definition, "mask-type") || "luminance";
  if (type !== "alpha" && type !== "luminance") {
    issues.push(
      issue(
        "mask-omitted",
        "error",
        `SVG mask #${referenceId} uses unsupported mask-type ${type}`,
        { sourceElement: element.localName },
      ),
    );
    return null;
  }
  return { definition, id: referenceId, mode: type, property };
}

export function readSerializedSvgMaskMode(
  element: Element,
): { maskMode: SvgMaskMode } | Record<string, never> {
  if (element.getAttribute("data-opendesign-mask-source") !== "true") {
    return {};
  }
  const mode = parseSvgMaskMode(
    element.getAttribute("data-opendesign-mask-mode"),
  );
  return mode ? { maskMode: mode } : {};
}

export function parseLocalSvgUrlReference(value: string | null): string | null {
  if (!value || value.trim().toLowerCase() === "none") return null;
  const match = /^url\(\s*#([^\s)]+)\s*\)$/i.exec(value.trim());
  if (!match || !match[1] || match[1].length > 512) return null;
  return match[1];
}

export function validateSvgFrameClipDefinition(
  definition: Element,
  width: number,
  height: number,
  radius: number,
): boolean {
  if (
    definition.localName.toLowerCase() !== "clippath" ||
    definition.getAttribute("data-opendesign-frame-clip") !== "true" ||
    definition.getAttribute("data-opendesign-frame-clip-version") !== "1" ||
    (definition.hasAttribute("clipPathUnits") &&
      definition.getAttribute("clipPathUnits") !== "userSpaceOnUse")
  ) {
    return false;
  }
  const children = elementChildren(definition);
  if (
    children.length !== 1 ||
    children[0]!.localName.toLowerCase() !== "rect"
  ) {
    return false;
  }
  const rect = children[0]!;
  const x = parseSvgLength(rect.getAttribute("x")) ?? 0;
  const y = parseSvgLength(rect.getAttribute("y")) ?? 0;
  const clipWidth = parseSvgLength(rect.getAttribute("width"));
  const clipHeight = parseSvgLength(rect.getAttribute("height"));
  const clipRadius = parseSvgLength(rect.getAttribute("rx")) ?? 0;
  return (
    x === 0 &&
    y === 0 &&
    clipWidth !== null &&
    clipHeight !== null &&
    nearlyEqual(clipWidth, width) &&
    nearlyEqual(clipHeight, height) &&
    nearlyEqual(clipRadius, radius)
  );
}

function validateControlledMaskDefinition(
  definition: Element,
  mode: SvgMaskMode,
): boolean {
  if (
    definition.getAttribute("data-opendesign-mask-version") !== "1" ||
    definition.getAttribute("data-opendesign-mask-mode") !== mode
  ) {
    return false;
  }
  const tag = definition.localName.toLowerCase();
  if (mode === "outline") {
    return (
      tag === "clippath" &&
      (!definition.hasAttribute("clipPathUnits") ||
        definition.getAttribute("clipPathUnits") === "userSpaceOnUse")
    );
  }
  if (
    tag !== "mask" ||
    (definition.hasAttribute("maskContentUnits") &&
      definition.getAttribute("maskContentUnits") !== "userSpaceOnUse")
  ) {
    return false;
  }
  const maskType = readStyleOrAttribute(definition, "mask-type") || "luminance";
  return mode === "luminance" ? maskType === "luminance" : maskType === "alpha";
}

function parseSvgMaskMode(value: string | null): SvgMaskMode | null {
  return value === "alpha" ||
    value === "luminance" ||
    value === "clipping" ||
    value === "outline"
    ? value
    : null;
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

function elementChildren(element: Element): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 1) children.push(child as Element);
  }
  return children;
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

function readOpacity(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = value.trim().endsWith("%")
    ? Number(value.trim().slice(0, -1)) / 100
    : Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-6;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function issue(
  code: SvgInterchangeIssue["code"],
  severity: SvgInterchangeIssue["severity"],
  message: string,
  context: Pick<SvgInterchangeIssue, "nodeId" | "sourceElement"> = {},
): SvgInterchangeIssue {
  return { code, severity, message, ...context };
}
