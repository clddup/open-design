import type { Rect } from "@opendesign/design-contracts";
import { DOMParser } from "@xmldom/xmldom";
import { SVG_MAX_CHARACTERS } from "./limits.js";
import type {
  SvgInterchangeIssue,
  SvgInterchangeIssueCode,
} from "./svg-issues.js";

export const SVG_IMPORT_MAX_DEPTH = 64;
export const SVG_IMPORT_MAX_NODES = 8_192;

const MAX_SVG_ELEMENTS = SVG_IMPORT_MAX_NODES * 4;
const MAX_ID_PREFIX_CHARACTERS = 80;
const SAFE_ID_PREFIX = /^[A-Za-z][A-Za-z0-9_-]*$/;
const BLOCKED_XML_PATTERN = /<!\s*(?:DOCTYPE|ENTITY)\b/i;

export type SvgParsedImportSource = {
  document: Document;
  root: Element;
  sourceViewport: Rect;
};

export type SvgParseResult =
  | { ok: true; value: SvgParsedImportSource }
  | { ok: false; issues: readonly SvgInterchangeIssue[] };

export function parseSvgImportSource(input: {
  svg: string;
  idPrefix: string;
}): SvgParseResult {
  if (input.svg.length === 0 || input.svg.length > SVG_MAX_CHARACTERS) {
    return invalid(
      "size-limit",
      `SVG import must contain between 1 and ${SVG_MAX_CHARACTERS} characters`,
    );
  }
  if (
    input.idPrefix.length > MAX_ID_PREFIX_CHARACTERS ||
    !SAFE_ID_PREFIX.test(input.idPrefix)
  ) {
    return invalid(
      "invalid-root",
      "SVG import idPrefix must start with a letter and contain only letters, digits, underscore, or hyphen",
    );
  }
  if (BLOCKED_XML_PATTERN.test(input.svg)) {
    return invalid(
      "unsafe-xml",
      "SVG import rejects DOCTYPE and ENTITY declarations",
    );
  }

  const parseMessages: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => parseMessages.push(String(message)),
      error: (message) => parseMessages.push(String(message)),
      fatalError: (message) => parseMessages.push(String(message)),
    },
  }).parseFromString(input.svg, "image/svg+xml");
  if (parseMessages.length > 0) {
    return invalid(
      "malformed-svg",
      `SVG XML is malformed: ${parseMessages[0] ?? "parse failure"}`,
    );
  }
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== "svg") {
    return invalid("invalid-root", "SVG import root element must be <svg>");
  }
  const structureIssue = validateSvgStructure(root);
  if (structureIssue) return { ok: false, issues: [structureIssue] };
  const sourceViewport = readSvgViewport(root);
  if (!sourceViewport) {
    return invalid(
      "invalid-dimension",
      "SVG import requires a finite positive viewBox or width and height",
    );
  }
  return { ok: true, value: { document, root, sourceViewport } };
}

export function parseSvgLength(value: string | null): number | null {
  if (value === null) return null;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:px)?$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const result = Number(match[1]);
  return Number.isFinite(result) ? result : null;
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
      return issue(
        "unsupported-element",
        `SVG <${tag}> is not accepted by the editable import boundary`,
        tag,
      );
    }
    if (tag === "style") {
      return issue(
        "unsupported-css",
        "SVG stylesheets are not accepted; use presentation attributes or inline style",
        tag,
      );
    }
    if (tag === "use") {
      return issue(
        "external-reference",
        "SVG <use> references are not accepted by the editable import boundary",
        tag,
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
        return issue(
          "unsafe-xml",
          `SVG event attribute ${attribute.name} is not accepted`,
          tag,
        );
      }
      if (name === "href" || name === "xlink:href") {
        return issue(
          "external-reference",
          `SVG reference attribute ${attribute.name} is not accepted`,
          tag,
        );
      }
    }
    count += 1;
    if (count > MAX_SVG_ELEMENTS) {
      return issue(
        "element-limit",
        `SVG import exceeds ${MAX_SVG_ELEMENTS} XML elements`,
      );
    }
    if (current.depth > SVG_IMPORT_MAX_DEPTH) {
      return issue(
        "depth-limit",
        `SVG import exceeds ${SVG_IMPORT_MAX_DEPTH} nested levels`,
      );
    }
    for (const child of elementChildren(current.element)) {
      pending.push({ element: child, depth: current.depth + 1 });
    }
  }
  return null;
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
  return positive(width) && positive(height)
    ? { x: 0, y: 0, width, height }
    : null;
}

function elementChildren(element: Element): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 1) children.push(child as Element);
  }
  return children;
}

function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function issue(
  code: SvgInterchangeIssueCode,
  message: string,
  sourceElement?: string,
): SvgInterchangeIssue {
  return {
    code,
    severity: "error",
    message,
    ...(sourceElement ? { sourceElement } : {}),
  };
}

function invalid(
  code: SvgInterchangeIssueCode,
  message: string,
): SvgParseResult {
  return { ok: false, issues: [issue(code, message)] };
}
