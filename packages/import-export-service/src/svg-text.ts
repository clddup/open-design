import {
  TextPropertiesSchema,
  schemaValidationIssues,
  type DesignNode,
  type Paint,
  type TextParagraphStyle,
  type TextRunStyle,
} from "@opendesign/design-contracts";
import {
  resolveTextListMarkers,
  textParagraphDirection,
  textParagraphRanges,
} from "@opendesign/text-service";

const TEXT_METADATA_VERSION = "8";
const PARAGRAPH_RUNS_TEXT_METADATA_VERSION = "7";
const RICH_TEXT_TEXT_METADATA_VERSION = "6";
const FONT_FACE_TEXT_METADATA_VERSION = "5";
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

  if (
    (properties.runs?.length ?? 0) > 0 ||
    (properties.paragraphRuns?.length ?? 0) > 0
  ) {
    writeRichTextSpans(element, node);
  } else {
    writeUniformTextSpans(element, node);
  }

  const serialized = JSON.stringify({
    width: node.size.width,
    height: node.size.height,
    properties: {
      ...properties,
      paragraphRuns: properties.paragraphRuns ?? [],
      runs: properties.runs ?? [],
    },
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
    metadataVersion !== PARAGRAPH_RUNS_TEXT_METADATA_VERSION &&
    metadataVersion !== RICH_TEXT_TEXT_METADATA_VERSION &&
    metadataVersion !== FONT_FACE_TEXT_METADATA_VERSION &&
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
  if (
    version !== TEXT_METADATA_VERSION &&
    version !== PARAGRAPH_RUNS_TEXT_METADATA_VERSION &&
    version !== RICH_TEXT_TEXT_METADATA_VERSION &&
    version !== FONT_FACE_TEXT_METADATA_VERSION
  ) {
    migrated.fontStyleName = null;
    migrated.fontSlant = "normal";
  }
  if (
    version !== TEXT_METADATA_VERSION &&
    version !== PARAGRAPH_RUNS_TEXT_METADATA_VERSION &&
    version !== RICH_TEXT_TEXT_METADATA_VERSION
  ) {
    migrated.runs = [];
  }
  if (
    version !== TEXT_METADATA_VERSION &&
    version !== PARAGRAPH_RUNS_TEXT_METADATA_VERSION
  ) {
    migrated.paragraphRuns = [];
  }
  migrated.listSpacing ??= 0;
  migrated.hangingList ??= false;
  if (
    version === PARAGRAPH_RUNS_TEXT_METADATA_VERSION &&
    Array.isArray(migrated.paragraphRuns)
  ) {
    const paragraphRuns: unknown[] = migrated.paragraphRuns;
    migrated.paragraphRuns = paragraphRuns.map((value: unknown) => {
      if (!isRecord(value) || !isRecord(value.style)) return value;
      return {
        ...value,
        style: {
          ...value.style,
          listOptions: { type: "none" },
          indentation: 0,
          listSpacing: migrated.listSpacing,
        },
      };
    });
  }
  if (
    version !== TEXT_METADATA_VERSION &&
    version !== RICH_TEXT_TEXT_METADATA_VERSION &&
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

function writeUniformTextSpans(element: Element, node: TextNode): void {
  const { properties } = node;
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
}

function writeRichTextSpans(element: Element, node: TextNode): void {
  const segments = resolvedTextSegments(node.properties);
  const baseX = lineX(node.size.width, node.properties);
  const firstY = firstLineY(
    node.size.height,
    textLines(node.properties.content).length,
    node.properties,
  );
  const paragraphPositions = richTextParagraphPositions(
    node.properties,
    segments,
    firstY,
  );
  const markerByStart = new Map(
    resolveTextListMarkers(
      node.properties.content,
      node.properties.paragraphRuns ?? [],
      {
        listOptions: { type: "none" },
        indentation: 0,
        listSpacing: node.properties.listSpacing,
        paragraphIndent: node.properties.paragraphIndent,
        paragraphSpacing: node.properties.paragraphSpacing,
      },
    ).map((marker) => [marker.start, marker]),
  );
  segments.forEach((segment, index) => {
    const position = paragraphPositions.get(segment.paragraphStartOffset);
    if (!position) {
      throw new Error(
        `Missing SVG paragraph position at ${segment.paragraphStartOffset}`,
      );
    }
    const direction = textParagraphDirection(
      node.properties.content,
      segment.paragraphStartOffset,
      position.end,
    );
    const bodyX = svgParagraphBodyX(
      baseX,
      segment.paragraphStyle,
      segment.style.fontSize,
      node.properties.hangingList,
      direction,
    );
    const marker = markerByStart.get(segment.start);
    if (marker && segment.paragraphStart) {
      const markerTspan = element.ownerDocument.createElementNS(
        element.namespaceURI,
        "tspan",
      );
      const gap = Math.max(4, segment.style.fontSize * 0.5);
      markerTspan.setAttribute("data-opendesign-list-marker", marker.text);
      markerTspan.setAttribute(
        "data-opendesign-paragraph-start",
        String(marker.start),
      );
      markerTspan.setAttribute("data-opendesign-list-type", marker.type);
      markerTspan.setAttribute(
        "data-opendesign-list-indentation",
        String(marker.indentation),
      );
      markerTspan.setAttribute(
        "data-opendesign-list-spacing",
        formatNumber(segment.paragraphStyle.listSpacing),
      );
      markerTspan.setAttribute("direction", direction);
      markerTspan.setAttribute(
        "text-anchor",
        direction === "rtl" ? "start" : "end",
      );
      markerTspan.setAttribute(
        "x",
        formatNumber(direction === "rtl" ? bodyX + gap : bodyX - gap),
      );
      markerTspan.setAttribute("y", formatNumber(position.y));
      writeRunStyleAttributes(markerTspan, segment.style);
      markerTspan.appendChild(
        element.ownerDocument.createTextNode(marker.text),
      );
      element.appendChild(markerTspan);
    }
    const tspan = element.ownerDocument.createElementNS(
      element.namespaceURI,
      "tspan",
    );
    tspan.setAttribute("data-opendesign-range-start", String(segment.start));
    tspan.setAttribute("data-opendesign-range-end", String(segment.end));
    tspan.setAttribute(
      "data-opendesign-paragraph-indent",
      formatNumber(segment.paragraphStyle.paragraphIndent),
    );
    tspan.setAttribute(
      "data-opendesign-paragraph-spacing",
      formatNumber(segment.paragraphStyle.paragraphSpacing),
    );
    tspan.setAttribute(
      "data-opendesign-list-type",
      segment.paragraphStyle.listOptions.type,
    );
    tspan.setAttribute(
      "data-opendesign-list-indentation",
      String(segment.paragraphStyle.indentation),
    );
    tspan.setAttribute(
      "data-opendesign-list-spacing",
      formatNumber(segment.paragraphStyle.listSpacing),
    );
    if (index === 0 || segment.paragraphStart) {
      tspan.setAttribute("x", formatNumber(bodyX));
      tspan.setAttribute("y", formatNumber(position.y));
    }
    writeRunStyleAttributes(tspan, segment.style);
    tspan.appendChild(
      element.ownerDocument.createTextNode(
        node.properties.content.slice(segment.start, segment.end),
      ),
    );
    element.appendChild(tspan);
  });
}

function richTextParagraphPositions(
  properties: TextProperties,
  segments: ReturnType<typeof resolvedTextSegments>,
  firstY: number,
): Map<number, { end: number; y: number }> {
  const positions = new Map<number, { end: number; y: number }>();
  const paragraphs = textParagraphRanges(properties.content);
  let y = firstY;
  paragraphs.forEach((paragraph, index) => {
    const currentSegments = segments.filter(
      (segment) =>
        segment.end > paragraph.start && segment.start < paragraph.end,
    );
    const lineHeight = currentSegments.reduce(
      (maximum, segment) => Math.max(maximum, segment.style.lineHeight),
      properties.lineHeight,
    );
    positions.set(paragraph.start, { end: paragraph.end, y });
    const next = paragraphs[index + 1];
    if (!next) return;
    const style = currentSegments[0]?.paragraphStyle ?? {
      listOptions: { type: "none" as const },
      indentation: 0,
      listSpacing: properties.listSpacing,
      paragraphIndent: properties.paragraphIndent,
      paragraphSpacing: properties.paragraphSpacing,
    };
    const nextStyle = segments.find(
      (segment) => segment.start <= next.start && next.start < segment.end,
    )?.paragraphStyle;
    y +=
      lineHeight +
      (style.listOptions.type !== "none" &&
      nextStyle?.listOptions.type !== "none"
        ? style.listSpacing
        : style.paragraphSpacing);
  });
  return positions;
}

function svgParagraphBodyX(
  baseX: number,
  style: TextParagraphStyle,
  fontSize: number,
  hangingList: boolean,
  direction: "ltr" | "rtl",
): number {
  const listOffset =
    style.listOptions.type === "none"
      ? 0
      : (style.indentation - 1) * fontSize * 2 +
        (hangingList ? 0 : fontSize * 1.5);
  const offset = listOffset + style.paragraphIndent;
  return direction === "rtl" ? baseX - offset : baseX + offset;
}

function writeRunStyleAttributes(element: Element, style: TextRunStyle): void {
  element.setAttribute("font-family", style.fontFamily);
  element.setAttribute("font-size", formatNumber(style.fontSize));
  element.setAttribute("font-weight", String(style.fontWeight));
  element.setAttribute("font-style", style.fontSlant);
  element.setAttribute("letter-spacing", formatNumber(style.letterSpacing));
  element.setAttribute(
    "text-decoration",
    style.textDecoration === "underline"
      ? "underline"
      : style.textDecoration === "strikethrough"
        ? "line-through"
        : "none",
  );
  element.setAttribute(
    "text-transform",
    style.textCase === "uppercase"
      ? "uppercase"
      : style.textCase === "lowercase"
        ? "lowercase"
        : style.textCase === "title-case"
          ? "capitalize"
          : "none",
  );
  element.setAttribute(
    "font-variant",
    style.textCase === "small-caps" ? "small-caps" : "normal",
  );
  const solid = style.fills.find(
    (paint) => paint.visible !== false && paint.type === "solid",
  );
  if (solid?.type === "solid") {
    element.setAttribute("fill", solid.color);
    element.setAttribute("fill-opacity", formatNumber(solid.opacity));
  }
}

function renderedRichTextMismatch(
  element: Element,
  properties: TextProperties,
  width: number,
  height: number,
  validateParagraphs: boolean,
  validateLists: boolean,
): string | null {
  const runs = resolvedTextSegments(properties);
  const children = elementChildren(element);
  const markerChildren = validateLists
    ? children.filter((child) =>
        child.hasAttribute("data-opendesign-list-marker"),
      )
    : [];
  const runChildren = validateLists
    ? children.filter(
        (child) => !child.hasAttribute("data-opendesign-list-marker"),
      )
    : children;
  const baseX = lineX(width, properties);
  const firstY = firstLineY(
    height,
    textLines(properties.content).length,
    properties,
  );
  const positions = richTextParagraphPositions(properties, runs, firstY);
  const markers = resolveTextListMarkers(
    properties.content,
    properties.paragraphRuns ?? [],
    {
      listOptions: { type: "none" },
      indentation: 0,
      listSpacing: properties.listSpacing,
      paragraphIndent: properties.paragraphIndent,
      paragraphSpacing: properties.paragraphSpacing,
    },
  );
  if (
    runChildren.length !== runs.length ||
    markerChildren.length !== markers.length ||
    children.some((child) => child.localName.toLowerCase() !== "tspan")
  ) {
    return "OpenDesign rich text metadata does not match the rendered run structure";
  }
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!;
    const child = runChildren[index]!;
    const previous = runs[index - 1];
    const position = positions.get(run.paragraphStartOffset);
    const direction = position
      ? textParagraphDirection(
          properties.content,
          run.paragraphStartOffset,
          position.end,
        )
      : "ltr";
    const bodyX = svgParagraphBodyX(
      baseX,
      run.paragraphStyle,
      run.style.fontSize,
      properties.hangingList,
      direction,
    );
    const paragraphPositionMismatch =
      validateParagraphs &&
      (validateLists
        ? index === 0 || run.paragraphStart
          ? !position ||
            !sameAttributeNumber(child, "x", bodyX) ||
            !sameAttributeNumber(child, "y", position.y) ||
            child.hasAttribute("dy")
          : child.hasAttribute("x") ||
            child.hasAttribute("y") ||
            child.hasAttribute("dy")
        : index === 0
          ? !sameAttributeNumber(
              child,
              "x",
              baseX + run.paragraphStyle.paragraphIndent,
            ) || !sameAttributeNumber(child, "y", firstY)
          : run.paragraphStart
            ? !sameAttributeNumber(
                child,
                "x",
                baseX + run.paragraphStyle.paragraphIndent,
              ) ||
              !previous ||
              !sameAttributeNumber(
                child,
                "dy",
                previous.style.lineHeight +
                  previous.paragraphStyle.paragraphSpacing,
              )
            : child.hasAttribute("x") ||
              child.hasAttribute("y") ||
              child.hasAttribute("dy"));
    if (
      child.getAttribute("data-opendesign-range-start") !== String(run.start) ||
      child.getAttribute("data-opendesign-range-end") !== String(run.end) ||
      child.textContent !== properties.content.slice(run.start, run.end) ||
      child.getAttribute("font-family") !== run.style.fontFamily ||
      child.getAttribute("font-style") !== run.style.fontSlant ||
      child.getAttribute("font-weight") !== String(run.style.fontWeight) ||
      !sameAttributeNumber(child, "font-size", run.style.fontSize) ||
      !sameAttributeNumber(child, "letter-spacing", run.style.letterSpacing) ||
      (validateParagraphs &&
        (!sameAttributeNumber(
          child,
          "data-opendesign-paragraph-indent",
          run.paragraphStyle.paragraphIndent,
        ) ||
          !sameAttributeNumber(
            child,
            "data-opendesign-paragraph-spacing",
            run.paragraphStyle.paragraphSpacing,
          ) ||
          (validateLists &&
            (child.getAttribute("data-opendesign-list-type") !==
              run.paragraphStyle.listOptions.type ||
              child.getAttribute("data-opendesign-list-indentation") !==
                String(run.paragraphStyle.indentation) ||
              !sameAttributeNumber(
                child,
                "data-opendesign-list-spacing",
                run.paragraphStyle.listSpacing,
              ))))) ||
      paragraphPositionMismatch
    ) {
      return "OpenDesign rich text metadata does not match the rendered run content or style";
    }
  }
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]!;
    const child = markerChildren[index]!;
    const run = runs.find((candidate) => candidate.start === marker.start);
    const position = positions.get(marker.start);
    if (!run || !position) {
      return "OpenDesign list metadata does not match rendered marker structure";
    }
    const direction = textParagraphDirection(
      properties.content,
      marker.start,
      marker.end,
    );
    const bodyX = svgParagraphBodyX(
      baseX,
      run.paragraphStyle,
      run.style.fontSize,
      properties.hangingList,
      direction,
    );
    const gap = Math.max(4, run.style.fontSize * 0.5);
    if (
      child.textContent !== marker.text ||
      child.getAttribute("data-opendesign-list-marker") !== marker.text ||
      child.getAttribute("data-opendesign-paragraph-start") !==
        String(marker.start) ||
      child.getAttribute("data-opendesign-list-type") !== marker.type ||
      child.getAttribute("data-opendesign-list-indentation") !==
        String(marker.indentation) ||
      !sameAttributeNumber(
        child,
        "data-opendesign-list-spacing",
        run.paragraphStyle.listSpacing,
      ) ||
      child.getAttribute("direction") !== direction ||
      child.getAttribute("text-anchor") !==
        (direction === "rtl" ? "start" : "end") ||
      !sameAttributeNumber(
        child,
        "x",
        direction === "rtl" ? bodyX + gap : bodyX - gap,
      ) ||
      !sameAttributeNumber(child, "y", position.y)
    ) {
      return "OpenDesign list metadata does not match rendered marker content or geometry";
    }
  }
  return null;
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
    (metadataVersion === TEXT_METADATA_VERSION ||
      metadataVersion === PARAGRAPH_RUNS_TEXT_METADATA_VERSION ||
      metadataVersion === FONT_FACE_TEXT_METADATA_VERSION) &&
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

  if (
    ((metadataVersion === TEXT_METADATA_VERSION ||
      metadataVersion === PARAGRAPH_RUNS_TEXT_METADATA_VERSION) &&
      ((properties.runs?.length ?? 0) > 0 ||
        (properties.paragraphRuns?.length ?? 0) > 0)) ||
    (metadataVersion === RICH_TEXT_TEXT_METADATA_VERSION &&
      (properties.runs?.length ?? 0) > 0)
  ) {
    return renderedRichTextMismatch(
      element,
      properties,
      value.width,
      value.height,
      metadataVersion === TEXT_METADATA_VERSION ||
        metadataVersion === PARAGRAPH_RUNS_TEXT_METADATA_VERSION,
      metadataVersion === TEXT_METADATA_VERSION,
    );
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

function resolvedTextSegments(properties: TextProperties): Array<{
  end: number;
  paragraphStart: boolean;
  paragraphStartOffset: number;
  paragraphStyle: TextParagraphStyle;
  start: number;
  style: TextRunStyle;
}> {
  if (properties.content.length === 0) return [];
  const baseStyle: TextRunStyle = {
    fontFamily: properties.fontFamily,
    fontStyleName: properties.fontStyleName,
    fontSize: properties.fontSize,
    fontWeight: properties.fontWeight,
    fontSlant: properties.fontSlant,
    letterSpacing: properties.letterSpacing,
    lineHeight: properties.lineHeight,
    textCase: properties.textCase,
    textDecoration: properties.textDecoration,
    fills: properties.fills,
  };
  const runs =
    (properties.runs?.length ?? 0) > 0
      ? properties.runs!
      : [{ start: 0, end: properties.content.length, style: baseStyle }];
  const baseParagraphStyle: TextParagraphStyle = {
    listOptions: { type: "none" },
    indentation: 0,
    listSpacing: properties.listSpacing,
    paragraphIndent: properties.paragraphIndent,
    paragraphSpacing: properties.paragraphSpacing,
  };
  const paragraphRuns =
    (properties.paragraphRuns?.length ?? 0) > 0
      ? properties.paragraphRuns!
      : [
          {
            start: 0,
            end: properties.content.length,
            style: baseParagraphStyle,
          },
        ];
  const explicitParagraphRanges = textParagraphRanges(properties.content);
  const boundaries = [
    ...new Set([
      0,
      properties.content.length,
      ...runs.flatMap((run) => [run.start, run.end]),
      ...paragraphRuns.flatMap((run) => [run.start, run.end]),
      ...explicitParagraphRanges.flatMap((range) => [range.start, range.end]),
    ]),
  ].sort((left, right) => left - right);
  const paragraphStarts = new Set(
    explicitParagraphRanges.map((range) => range.start),
  );
  return boundaries.slice(0, -1).map((start, index) => {
    const style = runs.find(
      (run) => run.start <= start && start < run.end,
    )?.style;
    const paragraphStyle = paragraphRuns.find(
      (run) => run.start <= start && start < run.end,
    )?.style;
    if (!style || !paragraphStyle) {
      throw new Error(
        `Incomplete rich text coverage at UTF-16 offset ${start}`,
      );
    }
    return {
      start,
      end: boundaries[index + 1]!,
      paragraphStart: paragraphStarts.has(start),
      paragraphStartOffset:
        explicitParagraphRanges.find(
          (paragraph) => paragraph.start <= start && start < paragraph.end,
        )?.start ?? 0,
      style,
      paragraphStyle,
    };
  });
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
    lineCount * properties.lineHeight + paragraphSpacingTotal(properties);
  if (properties.textAlignVertical === "center") {
    return (height - contentHeight) / 2;
  }
  if (properties.textAlignVertical === "bottom") {
    return height - contentHeight;
  }
  return 0;
}

function paragraphSpacingTotal(properties: TextProperties): number {
  const paragraphs = textParagraphRanges(properties.content);
  if (paragraphs.length < 2) return 0;
  const runs = properties.paragraphRuns ?? [];
  return paragraphs.slice(0, -1).reduce((sum, paragraph, index) => {
    const style = runs.find(
      (run) => run.start <= paragraph.start && paragraph.start < run.end,
    )?.style;
    const next = paragraphs[index + 1];
    const nextStyle = next
      ? runs.find((run) => run.start <= next.start && next.start < run.end)
          ?.style
      : undefined;
    const listGap =
      style !== undefined &&
      nextStyle !== undefined &&
      style.listOptions.type !== "none" &&
      nextStyle.listOptions.type !== "none";
    return (
      sum +
      (listGap
        ? (style?.listSpacing ?? properties.listSpacing)
        : (style?.paragraphSpacing ?? properties.paragraphSpacing))
    );
  }, 0);
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
