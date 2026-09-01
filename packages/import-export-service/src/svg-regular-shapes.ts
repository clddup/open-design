import {
  resolveRegularPolygonPoints,
  resolveStarPoints,
  type DesignNode,
  type Point,
} from "@opendesign/design-contracts";
import { resolveRegularShapeGeometry } from "@opendesign/geometry-service/regular-shape";

const LEGACY_REGULAR_SHAPE_VERSION = "1";
const REGULAR_SHAPE_VERSION = "2";
const VERSION_ATTRIBUTE = "data-opendesign-regular-shape-version";
const POINT_COUNT_ATTRIBUTE = "data-opendesign-point-count";
const INNER_RADIUS_ATTRIBUTE = "data-opendesign-inner-radius";
const CORNER_RADIUS_ATTRIBUTE = "data-opendesign-corner-radius";
const CORNER_SMOOTHING_ATTRIBUTE = "data-opendesign-corner-smoothing";
const WIDTH_ATTRIBUTE = "data-opendesign-width";
const HEIGHT_ATTRIBUTE = "data-opendesign-height";

type RegularShapeNode = Extract<DesignNode, { kind: "polygon" | "star" }>;
type RegularShapeValue =
  | {
      kind: "polygon";
      width: number;
      height: number;
      pointCount: number;
      cornerRadius: number;
      cornerSmoothing: number;
    }
  | {
      kind: "star";
      width: number;
      height: number;
      pointCount: number;
      innerRadius: number;
      cornerRadius: number;
      cornerSmoothing: number;
    };

export type SvgRegularShapeReadResult =
  | { status: "absent" }
  | { status: "invalid"; message: string }
  | { status: "valid"; value: RegularShapeValue };

export function writeSvgRegularShape(
  element: Element,
  node: RegularShapeNode,
): void {
  const rounded = node.properties.cornerRadius > 0;
  const expectedTag = rounded ? "path" : "polygon";
  if (element.localName.toLowerCase() !== expectedTag) {
    throw new TypeError(`${node.kind} SVG geometry requires <${expectedTag}>`);
  }
  if (rounded) {
    const geometry = resolveRegularShapeGeometry(node);
    if (!geometry.ok) throw new RangeError(geometry.message);
    element.setAttribute("d", geometry.path);
  } else {
    element.setAttribute("points", formatPoints(regularShapePoints(node)));
  }
  element.setAttribute(VERSION_ATTRIBUTE, REGULAR_SHAPE_VERSION);
  element.setAttribute(
    POINT_COUNT_ATTRIBUTE,
    String(node.properties.pointCount),
  );
  element.setAttribute(
    CORNER_RADIUS_ATTRIBUTE,
    formatNumber(node.properties.cornerRadius),
  );
  element.setAttribute(
    CORNER_SMOOTHING_ATTRIBUTE,
    formatNumber(node.properties.cornerSmoothing ?? 0),
  );
  element.setAttribute(WIDTH_ATTRIBUTE, formatNumber(node.size.width));
  element.setAttribute(HEIGHT_ATTRIBUTE, formatNumber(node.size.height));
  if (node.kind === "star") {
    element.setAttribute(
      INNER_RADIUS_ATTRIBUTE,
      formatNumber(node.properties.innerRadius),
    );
  }
}

export function readSvgRegularShape(
  element: Element,
): SvgRegularShapeReadResult {
  const sourceKind = element.getAttribute("data-opendesign-kind");
  const hasMetadata = metadataAttributes().some((name) =>
    element.hasAttribute(name),
  );
  if (sourceKind !== "polygon" && sourceKind !== "star" && !hasMetadata) {
    return { status: "absent" };
  }
  if (sourceKind !== "polygon" && sourceKind !== "star") {
    return invalid(
      "OpenDesign regular-shape metadata requires a Polygon or Star kind",
    );
  }
  const version = element.getAttribute(VERSION_ATTRIBUTE);
  if (
    version !== LEGACY_REGULAR_SHAPE_VERSION &&
    version !== REGULAR_SHAPE_VERSION
  ) {
    return invalid(
      "OpenDesign regular-shape metadata version is missing or unsupported",
    );
  }
  const common = readCommonMetadata(element, version);
  if (!common.ok) return invalid(common.message);
  const value = readKindMetadata(element, sourceKind, common.value);
  if (!value.ok) return invalid(value.message);
  const geometryIssue = validateRenderedGeometry(element, value.value, version);
  return geometryIssue
    ? invalid(geometryIssue)
    : { status: "valid", value: value.value };
}

type CommonMetadata = Omit<RegularShapeValue, "kind" | "innerRadius">;

function readCommonMetadata(
  element: Element,
  version: string,
): { ok: true; value: CommonMetadata } | { ok: false; message: string } {
  const width = strictNumber(element.getAttribute(WIDTH_ATTRIBUTE));
  const height = strictNumber(element.getAttribute(HEIGHT_ATTRIBUTE));
  const pointCount = strictNumber(element.getAttribute(POINT_COUNT_ATTRIBUTE));
  const cornerRadius = strictNumber(
    element.getAttribute(CORNER_RADIUS_ATTRIBUTE),
  );
  const cornerSmoothing =
    version === LEGACY_REGULAR_SHAPE_VERSION
      ? 0
      : strictNumber(element.getAttribute(CORNER_SMOOTHING_ATTRIBUTE));
  if (!isPositive(width) || !isPositive(height)) {
    return failure(
      "OpenDesign regular-shape bounds must be finite and positive",
    );
  }
  if (
    !Number.isInteger(pointCount) ||
    pointCount === null ||
    pointCount < 3 ||
    pointCount > 60
  ) {
    return failure(
      "OpenDesign regular-shape pointCount must be an integer from 3 to 60",
    );
  }
  if (cornerRadius === null || cornerRadius < 0) {
    return failure(
      "OpenDesign regular-shape cornerRadius must be non-negative",
    );
  }
  if (cornerSmoothing === null || cornerSmoothing < 0 || cornerSmoothing > 1) {
    return failure(
      "OpenDesign regular-shape cornerSmoothing must be between 0 and 1",
    );
  }
  if (version === LEGACY_REGULAR_SHAPE_VERSION && cornerRadius !== 0) {
    return failure(
      "Legacy regular-shape metadata supports only sharp geometry",
    );
  }
  return {
    ok: true,
    value: { width, height, pointCount, cornerRadius, cornerSmoothing },
  };
}

function readKindMetadata(
  element: Element,
  kind: RegularShapeValue["kind"],
  common: CommonMetadata,
): { ok: true; value: RegularShapeValue } | { ok: false; message: string } {
  if (kind === "polygon") {
    return element.hasAttribute(INNER_RADIUS_ATTRIBUTE)
      ? failure("OpenDesign Polygon metadata cannot contain Star innerRadius")
      : { ok: true, value: { kind, ...common } };
  }
  const innerRadius = strictNumber(
    element.getAttribute(INNER_RADIUS_ATTRIBUTE),
  );
  return innerRadius === null || innerRadius < 0 || innerRadius > 1
    ? failure("OpenDesign Star innerRadius must be between 0 and 1")
    : { ok: true, value: { kind, ...common, innerRadius } };
}

function validateRenderedGeometry(
  element: Element,
  value: RegularShapeValue,
  version: string,
): string | null {
  const rounded = value.cornerRadius > 0;
  const expectedTag = rounded ? "path" : "polygon";
  if (element.localName.toLowerCase() !== expectedTag) {
    return `OpenDesign ${value.kind} semantics require an SVG <${expectedTag}>`;
  }
  if (version === LEGACY_REGULAR_SHAPE_VERSION || !rounded) {
    const actual = parsePoints(element.getAttribute("points"));
    return actual && samePoints(actual, regularShapeValuePoints(value))
      ? null
      : "OpenDesign regular-shape points do not match their semantic parameters";
  }
  const expected = resolveRegularShapeGeometry(regularShapeValueNode(value));
  if (!expected.ok) return expected.message;
  return element.getAttribute("d") === expected.path
    ? null
    : "OpenDesign rounded regular-shape path does not match its semantic parameters";
}

function regularShapeValueNode(value: RegularShapeValue): RegularShapeNode {
  const base = {
    id: "svg_regular_shape",
    name: "SVG regular shape",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0] as RegularShapeNode["transform"],
    size: { width: value.width, height: value.height },
    exportSettings: [],
    opacity: 1,
    extensions: {},
  };
  const shape = { fills: [], strokes: [], strokeWidth: 0 };
  return value.kind === "polygon"
    ? {
        ...base,
        kind: "polygon",
        properties: {
          ...shape,
          pointCount: value.pointCount,
          cornerRadius: value.cornerRadius,
          cornerSmoothing: value.cornerSmoothing,
        },
      }
    : {
        ...base,
        kind: "star",
        properties: {
          ...shape,
          pointCount: value.pointCount,
          innerRadius: value.innerRadius,
          cornerRadius: value.cornerRadius,
          cornerSmoothing: value.cornerSmoothing,
        },
      };
}

function regularShapePoints(node: RegularShapeNode): Point[] {
  return node.kind === "polygon"
    ? resolveRegularPolygonPoints(node.size, node.properties.pointCount)
    : resolveStarPoints(
        node.size,
        node.properties.pointCount,
        node.properties.innerRadius,
      );
}

function regularShapeValuePoints(value: RegularShapeValue): Point[] {
  const size = { width: value.width, height: value.height };
  return value.kind === "polygon"
    ? resolveRegularPolygonPoints(size, value.pointCount)
    : resolveStarPoints(size, value.pointCount, value.innerRadius);
}

function metadataAttributes(): readonly string[] {
  return [
    VERSION_ATTRIBUTE,
    POINT_COUNT_ATTRIBUTE,
    INNER_RADIUS_ATTRIBUTE,
    CORNER_RADIUS_ATTRIBUTE,
    CORNER_SMOOTHING_ATTRIBUTE,
    WIDTH_ATTRIBUTE,
    HEIGHT_ATTRIBUTE,
  ];
}

function parsePoints(value: string | null): Point[] | null {
  const numbers = (value ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (
    numbers.length < 6 ||
    numbers.length % 2 !== 0 ||
    !numbers.every(Number.isFinite)
  ) {
    return null;
  }
  const points: Point[] = [];
  for (let index = 0; index < numbers.length; index += 2) {
    points.push({ x: numbers[index]!, y: numbers[index + 1]! });
  }
  return points;
}

function samePoints(
  actual: readonly Point[],
  expected: readonly Point[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((point, index) => {
      const candidate = expected[index]!;
      return close(point.x, candidate.x) && close(point.y, candidate.y);
    })
  );
}

function close(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-9;
}

function formatPoints(points: readonly Point[]): string {
  return points
    .map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`)
    .join(" ");
}

function formatNumber(value: number): string {
  const normalized = Math.abs(value) < 1e-12 ? 0 : value;
  return Number(normalized.toFixed(12)).toString();
}

function strictNumber(value: string | null): number | null {
  if (value === null || value.trim().length === 0) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isPositive(value: number | null): value is number {
  return value !== null && value > 0;
}

function failure(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

function invalid(message: string): SvgRegularShapeReadResult {
  return { status: "invalid", message };
}
