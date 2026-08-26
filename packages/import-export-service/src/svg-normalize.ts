import type { DesignNode, Rect, Transform } from "@opendesign/design-contracts";
import type { VectorFillRule } from "@opendesign/geometry-service/vector-path";
import {
  applyToPoint,
  compose,
  fromDefinition,
  fromTransformAttribute,
  identity,
  translate,
  type Matrix,
} from "transformation-matrix";
import type { SvgInterchangeIssue } from "./svg-issues.js";
import { parseSvgLength } from "./svg-parse.js";

export interface ImportedSvgStyle {
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

export const DEFAULT_IMPORTED_SVG_STYLE: ImportedSvgStyle = {
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

export function readImportedSvgStyle(
  element: Element,
  inherited: ImportedSvgStyle,
  issues: SvgInterchangeIssue[],
): ImportedSvgStyle {
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
    "clip-path",
    "fill",
    "fill-opacity",
    "fill-rule",
    "filter",
    "mask",
    "mask-type",
    "marker-start",
    "marker-end",
    "stroke",
    "stroke-opacity",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
  ]);
  declarations.forEach((_value, name) => {
    if (!supported.has(name)) {
      issues.push({
        code: "unsupported-css",
        severity: "warning",
        message: `SVG inline style property ${name} is not preserved`,
        sourceElement: element.localName,
      });
    }
  });
  const cap = read("stroke-linecap");
  const join = read("stroke-linejoin");
  return {
    fill: read("fill") ?? inherited.fill,
    fillOpacity: readSvgOpacity(read("fill-opacity"), inherited.fillOpacity),
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
    strokeOpacity: readSvgOpacity(
      read("stroke-opacity"),
      inherited.strokeOpacity,
    ),
    strokeWidth: readFiniteSvgNumber(
      read("stroke-width"),
      inherited.strokeWidth,
    ),
    dashPattern: readSvgDashPattern(
      read("stroke-dasharray"),
      inherited.dashPattern,
    ),
  };
}

export function readSvgStyleOrAttribute(
  element: Element,
  name: string,
): string | null {
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

export function readSvgElementTransform(
  element: Element,
  issues: SvgInterchangeIssue[],
): Transform {
  const value = element.getAttribute("transform");
  if (!value?.trim()) return [1, 0, 0, 1, 0, 0];
  try {
    const descriptors = fromTransformAttribute(value);
    const matrices = fromDefinition(descriptors);
    const matrix = matrices.length === 0 ? identity() : compose(matrices);
    if (!isFiniteSvgMatrix(matrix)) throw new TypeError("non-finite transform");
    return transformFromSvgMatrix(matrix);
  } catch (error) {
    issues.push({
      code: "invalid-transform",
      severity: "error",
      message:
        error instanceof Error
          ? `Invalid SVG transform: ${error.message}`
          : "Invalid SVG transform",
      sourceElement: element.localName,
    });
    return [1, 0, 0, 1, 0, 0];
  }
}

export function importedSvgGroupBounds(
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
    const matrix = transformToSvgMatrix(child.transform);
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

export function rebaseImportedSvgChildren(
  nodes: readonly DesignNode[],
  childIds: readonly string[],
  x: number,
  y: number,
): void {
  const offset = translate(-x, -y);
  for (const childId of childIds) {
    const child = nodes.find((candidate) => candidate.id === childId);
    if (child) {
      child.transform = transformFromSvgMatrix(
        compose(offset, transformToSvgMatrix(child.transform)),
      );
    }
  }
}

export function readSvgLength(
  element: Element,
  attribute: string,
  fallback: number | null,
  issues: SvgInterchangeIssue[],
): number | null {
  const value = element.getAttribute(attribute);
  if (!value) return fallback;
  const parsed = parseSvgLength(value);
  if (parsed === null) {
    issues.push({
      code: "invalid-dimension",
      severity: "error",
      message: `SVG ${element.localName}.${attribute} must use finite px or unitless coordinates`,
      sourceElement: element.localName,
    });
  }
  return parsed;
}

export function readSvgOpacity(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = value.trim().endsWith("%")
    ? Number(value.trim().slice(0, -1)) / 100
    : Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
}

export function readSvgUnitInterval(
  value: string | null,
  fallback: number,
): number {
  return readSvgOpacity(value, fallback);
}

export function isPositiveSvgLength(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

export function transformToSvgMatrix(transform: Transform): Matrix {
  const [a, b, c, d, e, f] = transform;
  return { a, b, c, d, e, f };
}

export function transformFromSvgMatrix(matrix: Matrix): Transform {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
}

function isFiniteSvgMatrix(matrix: Matrix): boolean {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(
    Number.isFinite,
  );
}

function readSvgDashPattern(
  value: string | null,
  fallback: number[],
): number[] {
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

function readFiniteSvgNumber(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = parseSvgLength(value) ?? Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}
