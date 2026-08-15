import type {
  TextFontDescriptor,
  TextLayoutCase,
  TextLayoutDecoration,
  TextLayoutWarning,
  TextLayoutWrap,
  TextResizeMode,
} from "./text-types.js";
import { validateTextStyleRuns, type TextStyleRun } from "./text-ranges.js";

export const TEXT_RUN_LAYOUT_SERVICE_CONTRACT_VERSION = 1 as const;
export const MAX_TEXT_RUN_LAYOUT_CHARACTERS = 100_000;
export const MAX_TEXT_RUN_LAYOUT_RUNS = 16_384;
export const MAX_TEXT_RUN_LAYOUT_FRAGMENTS = 100_000;
export const MAX_TEXT_RUN_LAYOUT_LINES = 100_000;

export type TextRunLayoutHorizontalAlign = "left" | "center" | "right";
export type TextRunLayoutVerticalAlign = "top" | "center" | "bottom";

export interface TextRunLayoutStyle extends TextFontDescriptor {
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
  textCase: TextLayoutCase;
  textDecoration: TextLayoutDecoration;
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
  runs: readonly TextStyleRun<Style>[];
  textAlignHorizontal: TextRunLayoutHorizontalAlign;
  textAlignVertical: TextRunLayoutVerticalAlign;
  textWrap: TextLayoutWrap;
  width?: number;
}

export interface TextRunLayoutFragment<
  Style extends TextRunLayoutStyle = TextRunLayoutStyle,
> {
  baseline: number;
  end: number;
  height: number;
  lineIndex: number;
  start: number;
  style: Style;
  text: string;
  width: number;
  x: number;
  y: number;
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
      fragments: readonly TextRunLayoutFragment<Style>[];
      lines: readonly TextRunLayoutLine[];
      ok: true;
      provider: string;
      providerVersion: string;
      size: { height: number; width: number };
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
  return null;
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
  if (!["left", "center", "right"].includes(request.textAlignHorizontal)) {
    return "Text run layout horizontal alignment is unsupported";
  }
  if (!["top", "center", "bottom"].includes(request.textAlignVertical)) {
    return "Text run layout vertical alignment is unsupported";
  }
  if (!["none", "word", "character"].includes(request.textWrap)) {
    return "Text run layout wrapping mode is unsupported";
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
  if (!validSize(value.size) || !validBounds(value.contentBounds)) {
    return "Text run layout provider returned invalid bounds";
  }
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
    value.fragments.length > MAX_TEXT_RUN_LAYOUT_FRAGMENTS
  ) {
    return "Text run layout provider exceeded structural limits";
  }
  const lines = value.lines as readonly TextRunLayoutLine[];
  const fragments = value.fragments as readonly TextRunLayoutFragment<Style>[];
  if (!validWarnings(value.warnings)) {
    return "Text run layout provider returned invalid warnings";
  }

  let expectedLineStart = 0;
  for (const line of lines) {
    if (
      !safeRange(line.start, line.end, request.content.length) ||
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
  if (lines.length > 0 && expectedLineStart !== request.content.length) {
    return "Text run layout lines do not cover source text";
  }

  let expectedFragmentStart = 0;
  for (const fragment of fragments) {
    const line = lines[fragment.lineIndex];
    if (
      !safeRange(fragment.start, fragment.end, request.content.length) ||
      fragment.start !== expectedFragmentStart ||
      fragment.end <= fragment.start ||
      fragment.text !== request.content.slice(fragment.start, fragment.end) ||
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
    expectedFragmentStart = fragment.end;
  }
  if (expectedFragmentStart !== request.content.length) {
    return "Text run layout fragments do not cover source text";
  }
  if (request.content.length === 0 && fragments.length !== 0) {
    return "Empty text run layout must not return fragments";
  }
  return null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
