import type {
  TextFontDescriptor,
  TextLayoutCase,
  TextLayoutDecoration,
  TextLayoutTruncation,
  TextLayoutWarning,
  TextLayoutWrap,
  TextResizeMode,
} from "./text-types.js";
import { validateTextStyleRuns, type TextStyleRun } from "./text-ranges.js";
import {
  validateTextParagraphRuns,
  type TextParagraphStyle,
} from "./text-paragraphs.js";
import { resolveTextListMarkers } from "./text-lists.js";
import {
  validateTextRunLayoutDecorations,
  type TextRunLayoutDecoration,
} from "./text-run-layout-decoration.js";
import {
  textRunDisplayRequest,
  validateTextRunDisplayIdentity,
} from "./text-run-truncation.js";

export type {
  TextRunLayoutDecoration,
  TextRunLayoutDecorationKind,
} from "./text-run-layout-decoration.js";

export const TEXT_RUN_LAYOUT_SERVICE_CONTRACT_VERSION = 7 as const;
export const MAX_TEXT_RUN_LAYOUT_CHARACTERS = 100_000;
export const MAX_TEXT_RUN_LAYOUT_RUNS = 16_384;
export const MAX_TEXT_RUN_LAYOUT_FRAGMENTS = 100_000;
export const MAX_TEXT_RUN_LAYOUT_LINES = 100_000;
export const MAX_TEXT_RUN_LAYOUT_MARKERS = 16_384;
export const MAX_TEXT_RUN_LAYOUT_GLYPHS = 200_000;
export const MAX_TEXT_RUN_LAYOUT_GLYPH_PATH_CHARACTERS = 1_000_000;
export const MAX_TEXT_RUN_LAYOUT_TOTAL_PATH_CHARACTERS = 16_000_000;

export type TextRunLayoutHorizontalAlign = "left" | "center" | "right";
export type TextRunLayoutVerticalAlign = "top" | "center" | "bottom";

export type TextRunLayoutDecorationMetric =
  { unit: "auto" } | { unit: "pixels" | "percent"; value: number };

export type TextRunLayoutDecorationColor =
  | { value: "auto" }
  | {
      value: {
        color: string;
        opacity: number;
        type: "solid";
      };
    };

export interface TextRunLayoutStyle extends TextFontDescriptor {
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
  textCase: TextLayoutCase;
  textDecoration: TextLayoutDecoration;
  textDecorationStyle: "dotted" | "solid" | "wavy" | null;
  textDecorationOffset: TextRunLayoutDecorationMetric | null;
  textDecorationThickness: TextRunLayoutDecorationMetric | null;
  textDecorationColor: TextRunLayoutDecorationColor | null;
  textDecorationSkipInk: boolean | null;
}

export interface TextRunLayoutRequest<
  Style extends TextRunLayoutStyle = TextRunLayoutStyle,
> {
  baseStyle: Style;
  content: string;
  height?: number;
  mode: TextResizeMode;
  paragraphIndent: number;
  paragraphSpacing: number;
  listSpacing: number;
  hangingList: boolean;
  paragraphRuns?: readonly TextStyleRun<TextParagraphStyle>[];
  runs: readonly TextStyleRun<Style>[];
  maxLines: number | null;
  textAlignHorizontal: TextRunLayoutHorizontalAlign;
  textAlignVertical: TextRunLayoutVerticalAlign;
  textTruncation: TextLayoutTruncation;
  textWrap: TextLayoutWrap;
  width?: number;
}

export interface TextRunLayoutFragment<
  Style extends TextRunLayoutStyle = TextRunLayoutStyle,
> {
  baseline: number;
  decorations?: readonly TextRunLayoutDecoration[];
  end: number;
  glyphs?: readonly TextRunLayoutGlyph[];
  height: number;
  lineIndex: number;
  start: number;
  style: Style;
  text: string;
  width: number;
  x: number;
  y: number;
}

/**
 * One provider-derived positioned glyph. Cluster offsets use JavaScript
 * UTF-16 indices and are relative to the result's displayContent. For an
 * ending-truncated result, sourceContentEnd maps that display prefix back to
 * the complete request content.
 * The outline is disposable render projection data, never document state.
 */
export interface TextRunLayoutGlyph {
  clusterEnd: number;
  clusterStart: number;
  glyphId: number;
  path: string;
  x: number;
  xAdvance: number;
  y: number;
  yAdvance: number;
}

export interface TextRunLayoutLine {
  baseline: number;
  end: number;
  height: number;
  start: number;
  width: number;
  x: number;
  y: number;
}

export interface TextRunLayoutMarker<
  Style extends TextRunLayoutStyle = TextRunLayoutStyle,
> {
  baseline: number;
  decorations?: readonly TextRunLayoutDecoration[];
  direction: "ltr" | "rtl";
  glyphs?: readonly TextRunLayoutGlyph[];
  height: number;
  paragraphStart: number;
  style: Style;
  text: string;
  width: number;
  x: number;
  y: number;
}

export type TextRunLayoutFailureCode =
  | "invalid-input"
  | "measurement-failed"
  | "provider-unavailable"
  | "unsupported";

export type TextRunLayoutResult<
  Style extends TextRunLayoutStyle = TextRunLayoutStyle,
> =
  | {
      contentBounds: {
        height: number;
        width: number;
        x: number;
        y: number;
      };
      displayContent: string;
      fragments: readonly TextRunLayoutFragment<Style>[];
      fullContentBounds: {
        height: number;
        width: number;
        x: number;
        y: number;
      };
      lines: readonly TextRunLayoutLine[];
      markers: readonly TextRunLayoutMarker<Style>[];
      ok: true;
      provider: string;
      providerVersion: string;
      sourceContentEnd: number;
      size: { height: number; width: number };
      truncated: boolean;
      warnings: readonly TextLayoutWarning[];
    }
  | {
      code: TextRunLayoutFailureCode;
      message: string;
      ok: false;
      retryable: boolean;
    };

export interface TextRunLayoutProvider<
  Style extends TextRunLayoutStyle = TextRunLayoutStyle,
> {
  readonly id: string;
  layout(request: TextRunLayoutRequest<Style>): TextRunLayoutResult<Style>;
  readonly version: string;
}

export function validateTextRunLayoutStyle(
  style: TextRunLayoutStyle,
): string | null {
  if (
    typeof style.fontFamily !== "string" ||
    style.fontFamily.trim().length === 0 ||
    style.fontFamily.length > 4_096
  ) {
    return "Text run layout requires a bounded non-empty font family";
  }
  if (
    style.fontStyleName !== null &&
    (typeof style.fontStyleName !== "string" ||
      style.fontStyleName.trim().length === 0 ||
      style.fontStyleName.length > 512)
  ) {
    return "Text run layout style name must be null or a bounded non-empty string";
  }
  if (!positiveBounded(style.fontSize)) {
    return "Text run layout font size is outside supported finite limits";
  }
  if (!positiveBounded(style.lineHeight)) {
    return "Text run layout line height is outside supported finite limits";
  }
  if (
    !Number.isInteger(style.fontWeight) ||
    style.fontWeight < 1 ||
    style.fontWeight > 1_000
  ) {
    return "Text run layout font weight must be an integer from 1 to 1000";
  }
  if (style.fontSlant !== "normal" && style.fontSlant !== "italic") {
    return "Text run layout font slant must be normal or italic";
  }
  if (
    !Number.isFinite(style.letterSpacing) ||
    Math.abs(style.letterSpacing) > 1_000_000
  ) {
    return "Text run layout letter spacing is outside supported finite limits";
  }
  if (
    ![
      "original",
      "uppercase",
      "lowercase",
      "title-case",
      "small-caps",
    ].includes(style.textCase)
  ) {
    return "Text run layout case transform is unsupported";
  }
  if (!["none", "underline", "strikethrough"].includes(style.textDecoration)) {
    return "Text run layout decoration is unsupported";
  }
  const decorationIssue = validateAdvancedDecoration(style);
  if (decorationIssue) return decorationIssue;
  return null;
}

function validateAdvancedDecoration(style: TextRunLayoutStyle): string | null {
  const advanced = [
    style.textDecorationStyle,
    style.textDecorationOffset,
    style.textDecorationThickness,
    style.textDecorationColor,
    style.textDecorationSkipInk,
  ];
  if (style.textDecoration !== "underline") {
    return advanced.every((value) => value === null)
      ? null
      : "Advanced text decoration fields require underline";
  }
  if (!["solid", "wavy", "dotted"].includes(style.textDecorationStyle ?? "")) {
    return "Underline requires a supported decoration style";
  }
  if (!validDecorationMetric(style.textDecorationOffset, false)) {
    return "Underline offset is outside supported finite limits";
  }
  if (!validDecorationMetric(style.textDecorationThickness, true)) {
    return "Underline thickness must be finite and positive";
  }
  if (!validDecorationColor(style.textDecorationColor)) {
    return "Underline color must be auto or a valid solid paint";
  }
  return typeof style.textDecorationSkipInk === "boolean"
    ? null
    : "Underline skip-ink mode must be boolean";
}

function validDecorationMetric(
  value: TextRunLayoutDecorationMetric | null,
  positive: boolean,
): boolean {
  if (!value || value.unit === "auto") return value?.unit === "auto";
  return (
    (value.unit === "pixels" || value.unit === "percent") &&
    Number.isFinite(value.value) &&
    Math.abs(value.value) <= 1_000_000 &&
    (!positive || value.value > 0)
  );
}

function validDecorationColor(
  color: TextRunLayoutDecorationColor | null,
): boolean {
  if (!color) return false;
  if (color.value === "auto") return true;
  return (
    color.value.type === "solid" &&
    /^#[0-9a-f]{6}$/i.test(color.value.color) &&
    Number.isFinite(color.value.opacity) &&
    color.value.opacity >= 0 &&
    color.value.opacity <= 1
  );
}

export function validateTextRunLayoutRequest<Style extends TextRunLayoutStyle>(
  request: TextRunLayoutRequest<Style>,
): string | null {
  if (
    typeof request.content !== "string" ||
    request.content.length > MAX_TEXT_RUN_LAYOUT_CHARACTERS
  ) {
    return `Text run layout content exceeds ${MAX_TEXT_RUN_LAYOUT_CHARACTERS} UTF-16 code units`;
  }
  const baseStyleIssue = validateTextRunLayoutStyle(request.baseStyle);
  if (baseStyleIssue) return baseStyleIssue;
  if (
    !Array.isArray(request.runs) ||
    request.runs.length > MAX_TEXT_RUN_LAYOUT_RUNS
  ) {
    return `Text run layout exceeds ${MAX_TEXT_RUN_LAYOUT_RUNS} style runs`;
  }
  const runs = request.runs as readonly TextStyleRun<Style>[];
  const rangeIssue = validateTextStyleRuns(request.content, runs);
  if (rangeIssue) return rangeIssue;
  for (const run of runs) {
    const styleIssue = validateTextRunLayoutStyle(run.style);
    if (styleIssue) return styleIssue;
  }
  if (!nonNegativeBounded(request.paragraphIndent)) {
    return "Text run layout paragraph indent is outside supported finite limits";
  }
  if (!nonNegativeBounded(request.paragraphSpacing)) {
    return "Text run layout paragraph spacing is outside supported finite limits";
  }
  if (!nonNegativeBounded(request.listSpacing)) {
    return "Text run layout list spacing is outside supported finite limits";
  }
  if (typeof request.hangingList !== "boolean") {
    return "Text run layout hanging list mode must be boolean";
  }
  const paragraphIssue = validateTextParagraphRuns(
    request.content,
    request.paragraphRuns ?? [],
  );
  if (paragraphIssue) return paragraphIssue;
  if (!["left", "center", "right"].includes(request.textAlignHorizontal)) {
    return "Text run layout horizontal alignment is unsupported";
  }
  if (!["top", "center", "bottom"].includes(request.textAlignVertical)) {
    return "Text run layout vertical alignment is unsupported";
  }
  if (!["none", "word", "character"].includes(request.textWrap)) {
    return "Text run layout wrapping mode is unsupported";
  }
  if (
    request.textTruncation !== "disabled" &&
    request.textTruncation !== "ending"
  ) {
    return "Text run layout truncation mode is unsupported";
  }
  if (
    request.maxLines !== null &&
    (!Number.isSafeInteger(request.maxLines) || request.maxLines < 1)
  ) {
    return "Text run layout max lines must be null or a positive integer";
  }
  if (request.textTruncation === "disabled" && request.maxLines !== null) {
    return "Text run layout max lines require ending truncation";
  }
  if (
    request.textTruncation === "ending" &&
    request.mode !== "fixed" &&
    request.maxLines === null
  ) {
    return "Auto Size ending truncation requires max lines";
  }

  if (request.mode === "auto-width") {
    if (request.width !== undefined || request.height !== undefined) {
      return "Auto Width text run layout must not provide fixed bounds";
    }
    return request.textWrap === "none"
      ? null
      : "Auto Width text run layout only supports explicit line breaks";
  }
  if (request.mode === "auto-height") {
    if (!positiveBounded(request.width) || request.height !== undefined) {
      return "Auto Height text run layout requires only a finite positive width";
    }
    return request.textWrap === "word" || request.textWrap === "character"
      ? null
      : "Auto Height text run layout requires word or character wrapping";
  }
  if (request.mode !== "fixed") {
    return "Text run layout resize mode is unsupported";
  }
  if (!positiveBounded(request.width) || !positiveBounded(request.height)) {
    return "Fixed text run layout requires finite positive width and height";
  }
  return null;
}

export function validateTextRunLayoutResult<Style extends TextRunLayoutStyle>(
  value: TextRunLayoutResult<Style>,
  request: TextRunLayoutRequest<Style>,
): string | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return "Text run layout provider returned an invalid result";
  }
  if (!value.ok) {
    if (
      ![
        "invalid-input",
        "measurement-failed",
        "provider-unavailable",
        "unsupported",
      ].includes(value.code) ||
      typeof value.message !== "string" ||
      value.message.length === 0 ||
      value.message.length > 8_192 ||
      typeof value.retryable !== "boolean"
    ) {
      return "Text run layout provider returned an invalid failure";
    }
    return null;
  }
  if (
    typeof value.provider !== "string" ||
    value.provider.length === 0 ||
    value.provider.length > 256 ||
    typeof value.providerVersion !== "string" ||
    value.providerVersion.length === 0 ||
    value.providerVersion.length > 256
  ) {
    return "Text run layout provider identity is missing";
  }
  if (
    !validSize(value.size) ||
    !validBounds(value.contentBounds) ||
    !validBounds(value.fullContentBounds)
  ) {
    return "Text run layout provider returned invalid bounds";
  }
  const displayIdentityIssue = validateTextRunDisplayIdentity(value, request);
  if (displayIdentityIssue) return displayIdentityIssue;
  const displayRequest = textRunDisplayRequest(
    request,
    value.sourceContentEnd,
    value.truncated,
  );
  if (
    request.mode !== "auto-width" &&
    Math.abs(value.size.width - request.width!) > 0.000_001
  ) {
    return "Text run layout provider changed the authoritative width";
  }
  if (
    request.mode === "fixed" &&
    Math.abs(value.size.height - request.height!) > 0.000_001
  ) {
    return "Text run layout provider changed the authoritative height";
  }
  if (
    !Array.isArray(value.lines) ||
    value.lines.length > MAX_TEXT_RUN_LAYOUT_LINES ||
    !Array.isArray(value.fragments) ||
    value.fragments.length > MAX_TEXT_RUN_LAYOUT_FRAGMENTS ||
    !Array.isArray(value.markers) ||
    value.markers.length > MAX_TEXT_RUN_LAYOUT_MARKERS
  ) {
    return "Text run layout provider exceeded structural limits";
  }
  const lines = value.lines as readonly TextRunLayoutLine[];
  const fragments = value.fragments as readonly TextRunLayoutFragment<Style>[];
  const markers = value.markers as readonly TextRunLayoutMarker<Style>[];
  if (!validWarnings(value.warnings)) {
    return "Text run layout provider returned invalid warnings";
  }

  let expectedLineStart = 0;
  for (const line of lines) {
    if (
      !safeRange(line.start, line.end, value.displayContent.length) ||
      line.start !== expectedLineStart ||
      !finite(line.x) ||
      !finite(line.y) ||
      !nonNegativeBounded(line.width) ||
      !nonNegativeBounded(line.height) ||
      !nonNegativeBounded(line.baseline) ||
      line.baseline > line.height
    ) {
      return "Text run layout provider returned invalid lines";
    }
    expectedLineStart = line.end;
  }
  if (lines.length > 0 && expectedLineStart !== value.displayContent.length) {
    return "Text run layout lines do not cover display text";
  }

  let expectedFragmentStart = 0;
  let glyphCount = 0;
  let totalPathCharacters = 0;
  for (const fragment of fragments) {
    const line = lines[fragment.lineIndex];
    if (
      !safeRange(fragment.start, fragment.end, value.displayContent.length) ||
      fragment.start !== expectedFragmentStart ||
      fragment.end <= fragment.start ||
      fragment.text !==
        value.displayContent.slice(fragment.start, fragment.end) ||
      !Number.isSafeInteger(fragment.lineIndex) ||
      fragment.lineIndex < 0 ||
      fragment.lineIndex >= lines.length ||
      !line ||
      fragment.start < line.start ||
      fragment.end > line.end ||
      !finite(fragment.x) ||
      !finite(fragment.y) ||
      !nonNegativeBounded(fragment.width) ||
      !nonNegativeBounded(fragment.height) ||
      !nonNegativeBounded(fragment.baseline) ||
      fragment.baseline > fragment.height ||
      Math.abs(fragment.y + fragment.baseline - (line.y + line.baseline)) >
        0.000_001 ||
      fragment.x < line.x - 0.000_001 ||
      fragment.x + fragment.width > line.x + line.width + 0.000_001 ||
      validateTextRunLayoutStyle(fragment.style)
    ) {
      return "Text run layout provider returned invalid fragments";
    }
    if (fragment.glyphs !== undefined) {
      if (!Array.isArray(fragment.glyphs)) {
        return "Text run layout provider returned invalid glyphs";
      }
      glyphCount += fragment.glyphs.length;
      if (glyphCount > MAX_TEXT_RUN_LAYOUT_GLYPHS) {
        return "Text run layout provider exceeded glyph limits";
      }
      const clusterRanges = new Map<number, number>();
      for (const glyph of fragment.glyphs) {
        const glyphId = isRecord(glyph) ? glyph.glyphId : undefined;
        const clusterStart = isRecord(glyph) ? glyph.clusterStart : undefined;
        const clusterEnd = isRecord(glyph) ? glyph.clusterEnd : undefined;
        const path = isRecord(glyph) ? glyph.path : undefined;
        const x = isRecord(glyph) ? glyph.x : undefined;
        const y = isRecord(glyph) ? glyph.y : undefined;
        const xAdvance = isRecord(glyph) ? glyph.xAdvance : undefined;
        const yAdvance = isRecord(glyph) ? glyph.yAdvance : undefined;
        if (
          !isRecord(glyph) ||
          !Number.isSafeInteger(glyphId) ||
          Number(glyphId) < 0 ||
          Number(glyphId) > 0xffff_ffff ||
          !safeRange(clusterStart, clusterEnd, value.displayContent.length) ||
          Number(clusterStart) < fragment.start ||
          Number(clusterEnd) > fragment.end ||
          Number(clusterEnd) <= Number(clusterStart) ||
          typeof path !== "string" ||
          path.length > MAX_TEXT_RUN_LAYOUT_GLYPH_PATH_CHARACTERS ||
          !boundedSigned(x) ||
          !boundedSigned(y) ||
          !boundedSigned(xAdvance) ||
          !boundedSigned(yAdvance)
        ) {
          return "Text run layout provider returned invalid glyphs";
        }
        const validatedClusterStart = Number(clusterStart);
        const validatedClusterEnd = Number(clusterEnd);
        const previousEnd = clusterRanges.get(validatedClusterStart);
        if (previousEnd !== undefined && previousEnd !== validatedClusterEnd) {
          return "Text run layout provider returned ambiguous glyph clusters";
        }
        clusterRanges.set(validatedClusterStart, validatedClusterEnd);
        totalPathCharacters += path.length;
        if (totalPathCharacters > MAX_TEXT_RUN_LAYOUT_TOTAL_PATH_CHARACTERS) {
          return "Text run layout provider exceeded outline limits";
        }
      }
      let expectedClusterStart = fragment.start;
      for (const [clusterStart, clusterEnd] of [...clusterRanges].sort(
        (left, right) => left[0] - right[0],
      )) {
        if (clusterStart !== expectedClusterStart) {
          return "Text run layout glyph clusters do not cover their fragment";
        }
        expectedClusterStart = clusterEnd;
      }
      if (
        fragment.start !== fragment.end &&
        expectedClusterStart !== fragment.end
      ) {
        return "Text run layout glyph clusters do not cover their fragment";
      }
    }
    const decoration = validateTextRunLayoutDecorations(
      fragment.decorations,
      fragment.style.textDecoration,
      fragment.width,
      fragment.style.textDecorationSkipInk === true,
    );
    if (decoration.issue) return decoration.issue;
    totalPathCharacters += decoration.pathCharacters;
    if (totalPathCharacters > MAX_TEXT_RUN_LAYOUT_TOTAL_PATH_CHARACTERS) {
      return "Text run layout provider exceeded outline limits";
    }
    expectedFragmentStart = fragment.end;
  }
  if (expectedFragmentStart !== value.displayContent.length) {
    return "Text run layout fragments do not cover display text";
  }
  if (value.displayContent.length === 0 && fragments.length !== 0) {
    return "Empty text run layout must not return fragments";
  }
  const expectedMarkers = resolveTextListMarkers(
    displayRequest.content,
    displayRequest.paragraphRuns ?? [],
    {
      listOptions: { type: "none" },
      indentation: 0,
      listSpacing: request.listSpacing,
      paragraphIndent: request.paragraphIndent,
      paragraphSpacing: request.paragraphSpacing,
    },
  );
  if (markers.length !== expectedMarkers.length) {
    return "Text run layout markers do not match authored list paragraphs";
  }
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]!;
    const expected = expectedMarkers[index]!;
    const line = lines.find(
      (candidate) => candidate.start === marker.paragraphStart,
    );
    if (
      marker.paragraphStart !== expected.start ||
      marker.text !== expected.text ||
      (marker.direction !== "ltr" && marker.direction !== "rtl") ||
      !line ||
      !finite(marker.x) ||
      !finite(marker.y) ||
      !nonNegativeBounded(marker.width) ||
      !nonNegativeBounded(marker.height) ||
      !nonNegativeBounded(marker.baseline) ||
      marker.baseline > marker.height ||
      Math.abs(marker.y + marker.baseline - (line.y + line.baseline)) >
        0.000_001 ||
      validateTextRunLayoutStyle(marker.style)
    ) {
      return "Text run layout provider returned invalid list markers";
    }
    const markerGlyphIssue = validateMarkerGlyphs(marker);
    if (markerGlyphIssue) return markerGlyphIssue;
    const decoration = validateTextRunLayoutDecorations(
      marker.decorations,
      marker.style.textDecoration,
      marker.width,
      marker.style.textDecorationSkipInk === true,
    );
    if (decoration.issue) return decoration.issue;
    glyphCount += marker.glyphs?.length ?? 0;
    totalPathCharacters +=
      marker.glyphs?.reduce((sum, glyph) => sum + glyph.path.length, 0) ?? 0;
    totalPathCharacters += decoration.pathCharacters;
    if (glyphCount > MAX_TEXT_RUN_LAYOUT_GLYPHS) {
      return "Text run layout provider exceeded glyph limits";
    }
    if (totalPathCharacters > MAX_TEXT_RUN_LAYOUT_TOTAL_PATH_CHARACTERS) {
      return "Text run layout provider exceeded outline limits";
    }
  }
  return null;
}

function validateMarkerGlyphs<Style extends TextRunLayoutStyle>(
  marker: TextRunLayoutMarker<Style>,
): string | null {
  if (marker.glyphs === undefined) return null;
  if (!Array.isArray(marker.glyphs)) {
    return "Text run layout provider returned invalid marker glyphs";
  }
  const ranges = new Map<number, number>();
  for (const glyph of marker.glyphs) {
    const glyphId = isRecord(glyph) ? glyph.glyphId : undefined;
    const clusterStart = isRecord(glyph) ? glyph.clusterStart : undefined;
    const clusterEnd = isRecord(glyph) ? glyph.clusterEnd : undefined;
    const path = isRecord(glyph) ? glyph.path : undefined;
    const x = isRecord(glyph) ? glyph.x : undefined;
    const y = isRecord(glyph) ? glyph.y : undefined;
    const xAdvance = isRecord(glyph) ? glyph.xAdvance : undefined;
    const yAdvance = isRecord(glyph) ? glyph.yAdvance : undefined;
    if (
      !isRecord(glyph) ||
      !Number.isSafeInteger(glyphId) ||
      Number(glyphId) < 0 ||
      Number(glyphId) > 0xffff_ffff ||
      !safeRange(clusterStart, clusterEnd, marker.text.length) ||
      Number(clusterEnd) <= Number(clusterStart) ||
      typeof path !== "string" ||
      path.length > MAX_TEXT_RUN_LAYOUT_GLYPH_PATH_CHARACTERS ||
      !boundedSigned(x) ||
      !boundedSigned(y) ||
      !boundedSigned(xAdvance) ||
      !boundedSigned(yAdvance)
    ) {
      return "Text run layout provider returned invalid marker glyphs";
    }
    const validatedStart = Number(clusterStart);
    const validatedEnd = Number(clusterEnd);
    const end = ranges.get(validatedStart);
    if (end !== undefined && end !== validatedEnd) {
      return "Text run layout provider returned ambiguous marker glyphs";
    }
    ranges.set(validatedStart, validatedEnd);
  }
  let expectedStart = 0;
  for (const [start, end] of [...ranges].sort(
    (left, right) => left[0] - right[0],
  )) {
    if (start !== expectedStart) {
      return "Text run layout marker glyphs do not cover marker text";
    }
    expectedStart = end;
  }
  return expectedStart === marker.text.length
    ? null
    : "Text run layout marker glyphs do not cover marker text";
}

function safeRange(
  start: unknown,
  end: unknown,
  contentLength: number,
): boolean {
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    Number(start) >= 0 &&
    Number(end) >= Number(start) &&
    Number(end) <= contentLength
  );
}

function validSize(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonNegativeBounded(value.width) &&
    nonNegativeBounded(value.height)
  );
}

function validBounds(value: unknown): boolean {
  return (
    isRecord(value) &&
    finite(value.x) &&
    finite(value.y) &&
    nonNegativeBounded(value.width) &&
    nonNegativeBounded(value.height)
  );
}

function validWarnings(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.every(
      (warning) =>
        isRecord(warning) &&
        warning.code === "font-fallback" &&
        typeof warning.message === "string" &&
        warning.message.length > 0 &&
        warning.message.length <= 8_192 &&
        typeof warning.fallback === "string" &&
        warning.fallback.length <= 8_192,
    )
  );
}

function positiveBounded(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1_000_000
  );
}

function nonNegativeBounded(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1_000_000
  );
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedSigned(value: unknown): value is number {
  return finite(value) && Math.abs(value) <= 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
