import {
  resolveRegularPolygonPoints,
  resolveStarPoints,
  type DesignNode,
  type Point,
} from "@opendesign/design-contracts";

const REGULAR_SHAPE_VERSION = "1";
const VERSION_ATTRIBUTE = "data-opendesign-regular-shape-version";
const POINT_COUNT_ATTRIBUTE = "data-opendesign-point-count";
const INNER_RADIUS_ATTRIBUTE = "data-opendesign-inner-radius";
const CORNER_RADIUS_ATTRIBUTE = "data-opendesign-corner-radius";
const WIDTH_ATTRIBUTE = "data-opendesign-width";
const HEIGHT_ATTRIBUTE = "data-opendesign-height";

type RegularShapeNode = Extract<DesignNode, { kind: "polygon" | "star" }>;

export type SvgRegularShapeReadResult =
  | { status: "absent" }
  | { status: "invalid"; message: string }
  | {
      status: "valid";
      value:
        | {
            kind: "polygon";
            width: number;
            height: number;
            pointCount: number;
            cornerRadius: 0;
          }
        | {
            kind: "star";
            width: number;
            height: number;
            pointCount: number;
            innerRadius: number;
            cornerRadius: 0;
          };
    };

export function writeSvgRegularShape(
  element: Element,
  node: RegularShapeNode,
): void {
  if (node.properties.cornerRadius !== 0) {
    throw new RangeError("Rounded regular shapes require an exact SVG outline");
  }
  const points = regularShapePoints(node);
  element.setAttribute("points", formatPoints(points));
  element.setAttribute(VERSION_ATTRIBUTE, REGULAR_SHAPE_VERSION);
  element.setAttribute(
    POINT_COUNT_ATTRIBUTE,
    String(node.properties.pointCount),
  );
  element.setAttribute(CORNER_RADIUS_ATTRIBUTE, "0");
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
  const hasMetadata = [
    VERSION_ATTRIBUTE,
    POINT_COUNT_ATTRIBUTE,
    INNER_RADIUS_ATTRIBUTE,
    CORNER_RADIUS_ATTRIBUTE,
    WIDTH_ATTRIBUTE,
    HEIGHT_ATTRIBUTE,
  ].some((name) => element.hasAttribute(name));
  if (sourceKind !== "polygon" && sourceKind !== "star" && !hasMetadata) {
    return { status: "absent" };
  }
  if (sourceKind !== "polygon" && sourceKind !== "star") {
    return invalid(
      "OpenDesign regular-shape metadata requires a Polygon or Star kind",
    );
  }
  if (element.localName.toLowerCase() !== "polygon") {
    return invalid(
      `OpenDesign ${sourceKind} semantics require an SVG <polygon>`,
    );
  }
  if (element.getAttribute(VERSION_ATTRIBUTE) !== REGULAR_SHAPE_VERSION) {
    return invalid(
      "OpenDesign regular-shape metadata version is missing or unsupported",
    );
  }
  const width = strictNumber(element.getAttribute(WIDTH_ATTRIBUTE));
  const height = strictNumber(element.getAttribute(HEIGHT_ATTRIBUTE));
  const pointCount = strictNumber(element.getAttribute(POINT_COUNT_ATTRIBUTE));
  const cornerRadius = strictNumber(
    element.getAttribute(CORNER_RADIUS_ATTRIBUTE),
  );
  if (!isPositive(width) || !isPositive(height)) {
    return invalid(
      "OpenDesign regular-shape bounds must be finite and positive",
    );
  }
  if (
    !Number.isInteger(pointCount) ||
    pointCount === null ||
    pointCount < 3 ||
    pointCount > 60
  ) {
    return invalid(
      "OpenDesign regular-shape pointCount must be an integer from 3 to 60",
    );
  }
  if (cornerRadius !== 0) {
    return invalid(
      "Rounded OpenDesign regular shapes require an exact SVG outline",
    );
  }

  let expected: Point[];
  let value: Extract<SvgRegularShapeReadResult, { status: "valid" }>["value"];
  if (sourceKind === "star") {
    const innerRadius = strictNumber(
      element.getAttribute(INNER_RADIUS_ATTRIBUTE),
    );
    if (innerRadius === null || innerRadius < 0 || innerRadius > 1) {
      return invalid("OpenDesign Star innerRadius must be between 0 and 1");
    }
    expected = resolveStarPoints({ width, height }, pointCount, innerRadius);
    value = {
      kind: "star",
      width,
      height,
      pointCount,
      innerRadius,
      cornerRadius: 0,
    };
  } else {
    if (element.hasAttribute(INNER_RADIUS_ATTRIBUTE)) {
      return invalid(
        "OpenDesign Polygon metadata cannot contain Star innerRadius",
      );
    }
    expected = resolveRegularPolygonPoints({ width, height }, pointCount);
    value = {
      kind: "polygon",
      width,
      height,
      pointCount,
      cornerRadius: 0,
    };
  }
  const actual = parsePoints(element.getAttribute("points"));
  if (!actual || !samePoints(actual, expected)) {
    return invalid(
      "OpenDesign regular-shape points do not match their semantic parameters",
    );
  }
  return { status: "valid", value };
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
  if (actual.length !== expected.length) return false;
  return actual.every((point, index) => {
    const candidate = expected[index]!;
    return close(point.x, candidate.x) && close(point.y, candidate.y);
  });
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

function invalid(message: string): SvgRegularShapeReadResult {
  return { status: "invalid", message };
}
