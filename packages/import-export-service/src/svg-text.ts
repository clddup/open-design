import {
  TextPropertiesSchema,
  schemaValidationIssues,
  type DesignNode,
  type Paint,
} from "@opendesign/design-contracts";

const TEXT_METADATA_VERSION = "5";
const TYPOGRAPHY_V2_TEXT_METADATA_VERSION = "4";
const TYPOGRAPHY_V1_TEXT_METADATA_VERSION = "3";
const FIXED_LAYOUT_TEXT_METADATA_VERSION = "2";
const LEGACY_TEXT_METADATA_VERSION = "1";
const VERSION_ATTRIBUTE = "data-opendesign-text-version";
const METADATA_ATTRIBUTE = "data-opendesign-text";
const MAX_TEXT_METADATA_CHARACTERS = 1_000_000;
const NUMBER_EPSILON = 0.000_001;
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

type TextNode = Extract<DesignNode, { kind: "text" }>;
type TextProperties = TextNode["properties"];

interface SerializedText {
  height: number;
  properties: TextProperties;
  width: number;
}

export type SvgTextReadResult =
  | { status: "absent" }
  | { status: "invalid"; message: string }
  | { status: "valid"; value: SerializedText };

export type SvgTextWriteResult =
  { ok: false; message: string } | { ok: true; metadataWritten: boolean };

/**
 * Writes a standard SVG text/tspan representation and bounded OpenDesign
 * metadata. The standard nodes remain useful in ordinary SVG consumers while
 * the metadata preserves the editable text box semantics that SVG 1.1 cannot
 * express on its own.
 */
export function writeSvgText(
  element: Element,
  node: TextNode,
): SvgTextWriteResult {
  if (!isXmlText(node.properties.content)) {
    return {
      ok: false,
      message: `Text ${node.id} contains characters that are not valid in XML 1.0`,
    };
  }

  const { properties } = node;
  element.setAttribute("font-family", properties.fontFamily);
  element.setAttribute("font-size", formatNumber(properties.fontSize));
  element.setAttribute("font-weight", String(properties.fontWeight));
  element.setAttribute("font-style", properties.fontSlant);
  element.setAttribute("text-decoration", svgTextDecoration(properties));
  element.setAttribute("text-transform", svgTextTransform(properties));
  element.setAttribute(
    "font-variant",
    properties.textCase === "small-caps" ? "small-caps" : "normal",
  );
  element.setAttribute(
    "letter-spacing",
    formatNumber(properties.letterSpacing),
  );
  element.setAttribute("dominant-baseline", "text-before-edge");
  element.setAttribute("text-anchor", textAnchor(properties));
  element.setAttributeNS(XML_NAMESPACE, "xml:space", "preserve");

  const lines = textLines(properties.content);
  const x = lineX(node.size.width, properties) + properties.paragraphIndent;
  const y = firstLineY(node.size.height, lines.length, properties);
  for (let index = 0; index < lines.length; index += 1) {
    const tspan = element.ownerDocument.createElementNS(
      element.namespaceURI,
      "tspan",
    );
    tspan.setAttribute("x", formatNumber(x));
    tspan.setAttribute(
      "y",
      formatNumber(
        y + index * properties.lineHeight + index * properties.paragraphSpacing,
      ),
    );
    tspan.appendChild(element.ownerDocument.createTextNode(lines[index]!));
    element.appendChild(tspan);
  }

  const serialized = JSON.stringify({
    width: node.size.width,
    height: node.size.height,
    properties,
  } satisfies SerializedText);
  if (serialized.length > MAX_TEXT_METADATA_CHARACTERS) {
    return { ok: true, metadataWritten: false };
  }
  element.setAttribute(VERSION_ATTRIBUTE, TEXT_METADATA_VERSION);
  element.setAttribute(METADATA_ATTRIBUTE, serialized);
  return { ok: true, metadataWritten: true };
}

/**
 * Reads only the controlled representation produced by writeSvgText. Ordinary
 * third-party SVG text remains outside the editable import boundary until a
 * font/layout service can derive its box semantics deterministically.
 */
export function readSvgText(element: Element): SvgTextReadResult {
  const hasMetadata =
    element.hasAttribute(VERSION_ATTRIBUTE) ||
    element.hasAttribute(METADATA_ATTRIBUTE);
  if (!hasMetadata) return { status: "absent" };
  if (element.localName.toLowerCase() !== "text") {
    return invalid("OpenDesign text metadata requires an SVG <text>");
  }
  if (element.getAttribute("data-opendesign-kind") !== "text") {
    return invalid("OpenDesign text metadata requires a Text source kind");
  }
  const metadataVersion = element.getAttribute(VERSION_ATTRIBUTE);
  if (
    metadataVersion !== TEXT_METADATA_VERSION &&
    metadataVersion !== TYPOGRAPHY_V2_TEXT_METADATA_VERSION &&
    metadataVersion !== TYPOGRAPHY_V1_TEXT_METADATA_VERSION &&
    metadataVersion !== FIXED_LAYOUT_TEXT_METADATA_VERSION &&
    metadataVersion !== LEGACY_TEXT_METADATA_VERSION
  ) {
    return invalid(
      "OpenDesign text metadata version is missing or unsupported",
    );
  }
  const source = element.getAttribute(METADATA_ATTRIBUTE);
  if (!source || source.length > MAX_TEXT_METADATA_CHARACTERS) {
    return invalid("OpenDesign text metadata is missing or exceeds its limit");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return invalid("OpenDesign text metadata is not valid JSON");
  }
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ["width", "height", "properties"])
  ) {
    return invalid("OpenDesign text metadata has an invalid shape");
  }
  if (isRecord(parsed.properties)) {
    if (
      metadataVersion === LEGACY_TEXT_METADATA_VERSION &&
      (Object.hasOwn(parsed.properties, "textWrap") ||
        Object.hasOwn(parsed.properties, "textOverflow") ||
        Object.hasOwn(parsed.properties, "textResize"))
    ) {
      return invalid(
        "OpenDesign legacy text metadata contains unsupported layout fields",
      );
    }
    if (
      metadataVersion === FIXED_LAYOUT_TEXT_METADATA_VERSION &&
      Object.hasOwn(parsed.properties, "textResize")
    ) {
      return invalid(
        "OpenDesign fixed-layout text metadata contains unsupported resize fields",
      );
    }
  }
  if (!isPositive(parsed.width) || !isPositive(parsed.height)) {
    return invalid("OpenDesign text metadata requires finite positive bounds");
  }
  const migratedProperties = migrateTextProperties(
    metadataVersion,
    parsed.properties,
  );
  const schemaIssues = schemaValidationIssues(
    TextPropertiesSchema,
    migratedProperties,
  );
  if (schemaIssues.length > 0) {
    return invalid(
      `OpenDesign text metadata does not match the versioned schema: ${schemaIssues[0]?.message ?? "invalid text properties"}`,
    );
  }

  const value: SerializedText = {
    width: parsed.width,
    height: parsed.height,
    properties: migratedProperties as TextProperties,
  };
  const mismatch = renderedTextMismatch(element, value, metadataVersion);
  return mismatch ? invalid(mismatch) : { status: "valid", value };
}

function migrateTextProperties(version: string, value: unknown): unknown {
  if (!isRecord(value)) return value;
  let migrated = { ...value };
  if (version === LEGACY_TEXT_METADATA_VERSION) {
    migrated = {
      ...migrated,
      textResize: "fixed",
      textWrap: "character",
      textOverflow: "visible",
    };
  } else if (version === FIXED_LAYOUT_TEXT_METADATA_VERSION) {
    migrated.textResize = "fixed";
  }
  if (version !== TEXT_METADATA_VERSION) {
    migrated.fontStyleName = null;
    migrated.fontSlant = "normal";
  }
  if (
    version !== TEXT_METADATA_VERSION &&
    version !== TYPOGRAPHY_V2_TEXT_METADATA_VERSION
  ) {
    if (migrated.textOverflow === "ellipsis") {
      migrated.textOverflow = "clip";
      migrated.textTruncation = "ending";
    } else {
      migrated.textTruncation = "disabled";
    }
    migrated.maxLines = null;
    migrated.paragraphIndent = 0;
    migrated.paragraphSpacing = 0;
    migrated.textCase = "original";
    migrated.textDecoration = "none";
  }
  return migrated;
}

export function svgTextShapeMatches(
  expected: TextProperties,
  actual: Pick<
    TextProperties,
    | "fills"
    | "strokes"
    | "strokeWidth"
    | "strokeAlign"
    | "strokeCap"
    | "strokeJoin"
    | "dashPattern"
  >,
): boolean {
  const expectedFills = standardSvgPaints(expected.fills);
  const expectedStrokes = standardSvgPaints(expected.strokes);
  const writesStrokeAttributes = expected.strokes.length > 0;
  return (
    sameJson(actual.fills, expectedFills) &&
    sameJson(actual.strokes, expectedStrokes) &&
    sameNumber(
      actual.strokeWidth,
      expectedStrokes.length === 0 ? 0 : expected.strokeWidth,
    ) &&
    (actual.strokeAlign ?? "center") === "center" &&
    (actual.strokeCap ?? "none") ===
      (writesStrokeAttributes ? (expected.strokeCap ?? "none") : "none") &&
    (actual.strokeJoin ?? "miter") ===
      (writesStrokeAttributes ? (expected.strokeJoin ?? "miter") : "miter") &&
    sameJson(
      actual.dashPattern ?? [],
      writesStrokeAttributes ? (expected.dashPattern ?? []) : [],
    )
  );
}

function standardSvgPaints(paints: readonly Paint[]): Paint[] {
  const first = paints.find((paint) => paint.visible !== false);
  if (!first) return [];
  const paint: Paint = { ...first };
  delete paint.visible;
  if (paint.type === "solid") return [roundNumbers(paint)];
  if (paint.type === "linear-gradient") {
    return [
      roundNumbers({
        ...paint,
        from: paint.from ?? { x: 0, y: 0.5 },
        to: paint.to ?? { x: 1, y: 0.5 },
      }),
    ];
  }
  if (paint.type === "radial-gradient") {
    const center = paint.from ?? { x: 0.5, y: 0.5 };
    const edge = paint.to ?? { x: 1, y: 0.5 };
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
    return [
      roundNumbers({
        ...paint,
        from: center,
        to: { x: center.x + radius, y: center.y },
      }),
    ];
  }
  if (paint.type === "angular-gradient") {
    const stop = paint.stops[0];
    return stop
      ? [
          {
            type: "solid",
            color: stop.color,
            opacity: roundNumber(stop.opacity),
          },
        ]
      : [];
  }
  return [];
}

function roundNumbers<T>(value: T): T {
  if (typeof value === "number") return roundNumber(value) as T;
  if (Array.isArray(value)) return value.map(roundNumbers) as T;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, roundNumbers(item)]),
    ) as T;
  }
  return value;
}

function roundNumber(value: number): number {
  return Number(value.toFixed(6));
}

function sameJson(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(roundNumbers(left)) === JSON.stringify(roundNumbers(right))
  );
}

function renderedTextMismatch(
  element: Element,
  value: SerializedText,
  metadataVersion: string,
): string | null {
  const { properties } = value;
  if (element.getAttribute("font-family") !== properties.fontFamily) {
    return "OpenDesign text metadata does not match the rendered font family";
  }
  if (
    !sameAttributeNumber(element, "font-size", properties.fontSize) ||
    !sameAttributeNumber(element, "letter-spacing", properties.letterSpacing)
  ) {
    return "OpenDesign text metadata does not match the rendered font metrics";
  }
  if (element.getAttribute("font-weight") !== String(properties.fontWeight)) {
    return "OpenDesign text metadata does not match the rendered font weight";
  }
  if (
    metadataVersion === TEXT_METADATA_VERSION &&
    element.getAttribute("font-style") !== properties.fontSlant
  ) {
    return "OpenDesign text metadata does not match the rendered font slant";
  }
  if (
    element.getAttribute("text-decoration") !== svgTextDecoration(properties) ||
    element.getAttribute("text-transform") !== svgTextTransform(properties) ||
    element.getAttribute("font-variant") !==
      (properties.textCase === "small-caps" ? "small-caps" : "normal")
  ) {
    return "OpenDesign text metadata does not match the rendered case or decoration";
  }
  if (
    element.getAttribute("dominant-baseline") !== "text-before-edge" ||
    element.getAttribute("text-anchor") !== textAnchor(properties) ||
    element.getAttributeNS(XML_NAMESPACE, "space") !== "preserve"
  ) {
    return "OpenDesign text metadata does not match the rendered alignment";
  }

  const lines = textLines(properties.content);
  const children = elementChildren(element);
  if (
    children.length !== lines.length ||
    children.some((child) => child.localName.toLowerCase() !== "tspan")
  ) {
    return "OpenDesign text metadata does not match the rendered line structure";
  }
  const expectedX = lineX(value.width, properties) + properties.paragraphIndent;
  const expectedY = firstLineY(value.height, lines.length, properties);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (
      child.textContent !== lines[index] ||
      !sameAttributeNumber(child, "x", expectedX) ||
      !sameAttributeNumber(
        child,
        "y",
        expectedY +
          index * properties.lineHeight +
          index * properties.paragraphSpacing,
      )
    ) {
      return "OpenDesign text metadata does not match the rendered line content or position";
    }
  }
  return null;
}

function lineX(width: number, properties: TextProperties): number {
  if (properties.textAlignHorizontal === "center") return width / 2;
  if (properties.textAlignHorizontal === "right") return width;
  return 0;
}

function firstLineY(
  height: number,
  lineCount: number,
  properties: TextProperties,
): number {
  const contentHeight =
    lineCount * properties.lineHeight +
    Math.max(0, lineCount - 1) * properties.paragraphSpacing;
  if (properties.textAlignVertical === "center") {
    return (height - contentHeight) / 2;
  }
  if (properties.textAlignVertical === "bottom") {
    return height - contentHeight;
  }
  return 0;
}

function textAnchor(properties: TextProperties): "end" | "middle" | "start" {
  if (properties.textAlignHorizontal === "center") return "middle";
  if (properties.textAlignHorizontal === "right") return "end";
  return "start";
}

function svgTextDecoration(properties: TextProperties): string {
  if (properties.textDecoration === "underline") return "underline";
  if (properties.textDecoration === "strikethrough") return "line-through";
  return "none";
}

function svgTextTransform(properties: TextProperties): string {
  if (properties.textCase === "uppercase") return "uppercase";
  if (properties.textCase === "lowercase") return "lowercase";
  if (properties.textCase === "title-case") return "capitalize";
  return "none";
}

function textLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/);
}

function elementChildren(element: Element): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 1) children.push(child as Element);
    else if (child?.nodeType === 3 && child.nodeValue !== "") {
      return [];
    }
  }
  return children;
}

function sameAttributeNumber(
  element: Element,
  name: string,
  expected: number,
): boolean {
  const value = element.getAttribute(name);
  if (value === null || value.trim() === "") return false;
  return sameNumber(Number(value), expected);
}

function sameNumber(left: number, right: number): boolean {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= NUMBER_EPSILON
  );
}

function isXmlText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index)!;
    if (codePoint > 0xffff) index += 1;
    if (
      codePoint !== 0x9 &&
      codePoint !== 0xa &&
      codePoint !== 0xd &&
      (codePoint < 0x20 ||
        (codePoint > 0xd7ff && codePoint < 0xe000) ||
        (codePoint > 0xfffd && codePoint < 0x10000) ||
        codePoint > 0x10ffff)
    ) {
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length && expected.every((key) => key in value)
  );
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) return "0";
  return Number(value.toFixed(6)).toString();
}

function invalid(message: string): SvgTextReadResult {
  return { status: "invalid", message };
}
