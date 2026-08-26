import type { Rect, Transform } from "@opendesign/design-contracts";
import { DOMImplementation, XMLSerializer } from "@xmldom/xmldom";
import { SVG_MAX_CHARACTERS } from "./limits.js";
import { createSvgIssue, type SvgInterchangeIssue } from "./svg-issues.js";

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export interface SvgExportDocument {
  definitions: Element;
  document: Document;
  root: Element;
}

export type SvgDocumentSerializationResult =
  { ok: true; svg: string } | { ok: false; issue: SvgInterchangeIssue };

export function createSvgExportDocument(input: {
  title?: string;
  version: number;
  viewport: Rect;
}): SvgExportDocument {
  const implementation = new DOMImplementation();
  const document = implementation.createDocument(SVG_NAMESPACE, "svg", null);
  const root = document.documentElement;
  root.setAttribute("xmlns", SVG_NAMESPACE);
  root.setAttribute("version", "1.1");
  root.setAttribute(
    "viewBox",
    [
      input.viewport.x,
      input.viewport.y,
      input.viewport.width,
      input.viewport.height,
    ]
      .map(formatSvgNumber)
      .join(" "),
  );
  root.setAttribute("width", formatSvgNumber(input.viewport.width));
  root.setAttribute("height", formatSvgNumber(input.viewport.height));
  root.setAttribute("data-opendesign-svg-version", String(input.version));

  if (input.title?.trim()) {
    const title = document.createElementNS(SVG_NAMESPACE, "title");
    title.appendChild(document.createTextNode(input.title.trim()));
    root.appendChild(title);
  }
  return {
    definitions: document.createElementNS(SVG_NAMESPACE, "defs"),
    document,
    root,
  };
}

export function serializeSvgExportDocument(
  value: SvgExportDocument,
): SvgDocumentSerializationResult {
  if (value.definitions.childNodes.length > 0) {
    value.root.insertBefore(value.definitions, value.root.firstChild);
  }
  try {
    const svg = new XMLSerializer().serializeToString(
      value.document,
      false,
      undefined,
      { requireWellFormed: true },
    );
    if (svg.length > SVG_MAX_CHARACTERS) {
      return {
        ok: false,
        issue: createSvgIssue(
          "size-limit",
          "error",
          `SVG export exceeds ${SVG_MAX_CHARACTERS} characters`,
        ),
      };
    }
    return { ok: true, svg };
  } catch (error) {
    return {
      ok: false,
      issue: createSvgIssue(
        "malformed-svg",
        "error",
        error instanceof Error ? error.message : "SVG serialization failed",
      ),
    };
  }
}

export function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function sanitizeSvgXmlId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `od_${sanitized}`;
}

export function serializeSvgMatrixAttribute(transform: Transform): string {
  return `matrix(${transform.map(formatSvgNumber).join(" ")})`;
}
