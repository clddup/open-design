import {
  canonicalizeTextParagraphRuns,
  canonicalizeTextStyleRuns,
  createTextListLayout,
  resolveTextListMarkers,
  textParagraphDirection,
  validateTextRunLayoutRequest,
  validateTextRunLayoutResult,
  type TextRunLayoutFailureCode,
  type TextRunLayoutFragment,
  type TextRunLayoutLine,
  type TextRunLayoutMarker,
  type TextRunLayoutProvider,
  type TextRunLayoutRequest,
  type TextRunLayoutResult,
  type TextRunLayoutStyle,
  type TextParagraphStyle,
  type TextStyleRun,
} from "@opendesign/text-service";
import type * as LeaferEditorModule from "leafer-editor";
import {
  browserFontAvailable,
  inspectLeaferFont,
  type LeaferTextLayoutProviderOptions,
} from "./text-layout.js";
import type {
  LeaferTextRunFragment,
  LeaferTextRunProjectionResult,
} from "./text-run-projection.js";
import {
  assignTextRunBreakOpportunities,
  breakTextRunLines,
  isTextRunHardBreak,
  isTextRunWhitespace,
  nextTextRunGraphemeEnd,
  textRunLineWidth,
  unsupportedTextRunLayoutReason,
  type BrokenTextRunLine,
  type MeasuredTextRunCluster,
} from "./text-run-segmentation.js";

export const LEAFER_TEXT_RUN_LAYOUT_PROVIDER_ID = "leafer-text-runs" as const;
export const LEAFER_TEXT_RUN_LAYOUT_PROVIDER_VERSION =
  "2.2.9+lists-v1" as const;

type LeaferModule = typeof LeaferEditorModule;

type LeaferRunTextInstance = {
  readonly __?: {
    readonly __baseLine?: number;
    readonly __lineHeight?: number;
    readonly __textDrawData?: {
      readonly rows?: ReadonlyArray<{ readonly width?: number }>;
    };
  };
  readonly boxBounds: {
    readonly height: number;
    readonly width: number;
    readonly x?: number;
    readonly y?: number;
  };
  destroy(): void;
};

type LeaferRunTextConstructor = new (
  data?: Record<string, unknown>,
) => LeaferRunTextInstance;

export interface LeaferTextRunStyle extends TextRunLayoutStyle {
  fill: unknown;
}

export type LeaferTextRunLayoutProviderOptions =
  LeaferTextLayoutProviderOptions;

interface MeasuredStyle {
  ascent: number;
  descent: number;
  height: number;
}

export function createLeaferTextRunLayoutProvider(
  leafer: Pick<LeaferModule, "Text">,
  options: LeaferTextRunLayoutProviderOptions = {},
): TextRunLayoutProvider<LeaferTextRunStyle> {
  const Text = leafer.Text as unknown as LeaferRunTextConstructor;
  const fontAvailable = options.fontAvailable ?? browserFontAvailable;
  return {
    id: LEAFER_TEXT_RUN_LAYOUT_PROVIDER_ID,
    version: LEAFER_TEXT_RUN_LAYOUT_PROVIDER_VERSION,
    layout(request) {
      const requestIssue = validateTextRunLayoutRequest(request);
      if (requestIssue) {
        return failure("invalid-input", requestIssue, false);
      }
      const providerInputIssue = validateLeaferTextRunRequest(request);
      if (providerInputIssue) {
        return failure("invalid-input", providerInputIssue, false);
      }
      const unsupportedIssue = unsupportedTextRunLayoutReason(request);
      if (unsupportedIssue)
        return failure("unsupported", unsupportedIssue, false);

      try {
        const result = layoutWithLeafer(Text, request, fontAvailable);
        if (!result.ok) return result;
        const resultIssue = validateTextRunLayoutResult(result, request);
        return resultIssue
          ? failure("measurement-failed", resultIssue, true)
          : result;
      } catch (error) {
        return failure(
          "measurement-failed",
          error instanceof Error && error.message
            ? `Leafer text run measurement failed: ${error.message}`
            : "Leafer text run measurement failed",
          true,
        );
      }
    },
  };
}

export function leaferTextRunLayoutToProjection(
  nodeId: string,
  result: TextRunLayoutResult<LeaferTextRunStyle>,
): LeaferTextRunProjectionResult {
  if (!result.ok) {
    throw new Error(
      `Text run layout is unavailable for ${nodeId}: ${result.message}`,
    );
  }
  return {
    nodeId,
    fragments: result.fragments.map((fragment): LeaferTextRunFragment => ({
      data: leaferTextRunData(fragment.style),
      end: fragment.end,
      ...(fragment.glyphs === undefined ? {} : { glyphs: fragment.glyphs }),
      baseline: fragment.baseline,
      height: fragment.height,
      start: fragment.start,
      text: fragment.text,
      width: fragment.width,
      x: fragment.x,
      y: fragment.y,
    })),
    markers: result.markers.map((marker) => ({
      baseline: marker.baseline,
      data: leaferTextRunData(marker.style),
      direction: marker.direction,
      ...(marker.glyphs === undefined ? {} : { glyphs: marker.glyphs }),
      height: marker.height,
      paragraphStart: marker.paragraphStart,
      text: marker.text,
      width: marker.width,
      x: marker.x,
      y: marker.y,
    })),
  };
}

function layoutWithLeafer(
  Text: LeaferRunTextConstructor,
  request: TextRunLayoutRequest<LeaferTextRunStyle>,
  fontAvailable: NonNullable<
    LeaferTextRunLayoutProviderOptions["fontAvailable"]
  >,
): TextRunLayoutResult<LeaferTextRunStyle> {
  const runs = materializedRuns(request);
  const paragraphRuns = canonicalizeTextParagraphRuns(
    request.content,
    request.paragraphRuns ?? [],
    {
      listOptions: { type: "none" },
      indentation: 0,
      listSpacing: request.listSpacing,
      paragraphIndent: request.paragraphIndent,
      paragraphSpacing: request.paragraphSpacing,
    },
    equalParagraphStyle,
  );
  const paragraphStyleAt = (offset: number): TextParagraphStyle =>
    paragraphRuns.find((run) => run.start <= offset && offset < run.end)
      ?.style ?? {
      listOptions: { type: "none" },
      indentation: 0,
      listSpacing: request.listSpacing,
      paragraphIndent: request.paragraphIndent,
      paragraphSpacing: request.paragraphSpacing,
    };
  const styleMetrics = new Map<string, MeasuredStyle>();
  const characterAdvances = new Map<string, number>();
  const warnings = fontWarnings(runs, request.baseStyle, fontAvailable);

  const measureStyle = (style: LeaferTextRunStyle): MeasuredStyle => {
    const key = metricStyleKey(style);
    const cached = styleMetrics.get(key);
    if (cached) return cached;
    const measured = measureNativeText(Text, "M", style);
    const value = {
      ascent: measured.baseline,
      descent: measured.lineHeight - measured.baseline,
      height: measured.lineHeight,
    };
    styleMetrics.set(key, value);
    return value;
  };
  const measureAdvance = (text: string, style: LeaferTextRunStyle): number => {
    if (isTextRunHardBreak(text)) return 0;
    const key = `${metricStyleKey(style)}\u0000${text}`;
    const cached = characterAdvances.get(key);
    if (cached !== undefined) return cached;
    const width = isTextRunWhitespace(text)
      ? normalize(
          Math.max(
            0,
            measureNativeText(Text, `M${text}M`, style).width -
              measureNativeText(Text, "MM", style).width,
          ),
        )
      : measureNativeText(Text, text, style).width;
    characterAdvances.set(key, width);
    return width;
  };

  const clusters: MeasuredTextRunCluster<LeaferTextRunStyle>[] = [];
  let runIndex = 0;
  for (let start = 0; start < request.content.length;) {
    while (runs[runIndex] && start >= runs[runIndex]!.end) runIndex += 1;
    const run = runs[runIndex];
    if (!run || start < run.start || start >= run.end) {
      throw new Error(`Missing style at UTF-16 offset ${start}`);
    }
    const end = nextTextRunGraphemeEnd(request.content, start);
    const text = request.content.slice(start, end);
    if (end > run.end) {
      throw new Error(`Style run splits a grapheme cluster at ${start}`);
    }
    const metrics = measureStyle(run.style);
    clusters.push({
      advance: measureAdvance(text, run.style),
      ascent: metrics.ascent,
      breakAfter: false,
      descent: metrics.descent,
      end,
      hardBreak: isTextRunHardBreak(text),
      start,
      style: run.style,
      text,
    });
    start = end;
  }
  assignTextRunBreakOpportunities(clusters);

  const markerMeasurements = resolveTextListMarkers(
    request.content,
    paragraphRuns,
    {
      listOptions: { type: "none" },
      indentation: 0,
      listSpacing: request.listSpacing,
      paragraphIndent: request.paragraphIndent,
      paragraphSpacing: request.paragraphSpacing,
    },
  ).map((marker) => {
    const style =
      runs.find((run) => run.start <= marker.start && marker.start < run.end)
        ?.style ?? request.baseStyle;
    const measured = measureNativeText(Text, marker.text, style);
    return {
      ...marker,
      baseline: measured.baseline,
      direction: textParagraphDirection(
        request.content,
        marker.start,
        marker.end,
      ),
      fontSize: style.fontSize,
      height: measured.lineHeight,
      paragraphStart: marker.start,
      style,
      width: measured.width,
    };
  });
  const listLayout = createTextListLayout(
    markerMeasurements,
    request.hangingList,
  );

  const broken = breakTextRunLines(
    clusters,
    request,
    (paragraphStart, firstLine) =>
      listLayout.lineInsets(
        paragraphStart,
        firstLine,
        paragraphStyleAt(paragraphStart).paragraphIndent,
      ),
  );
  if (request.content.length === 0) {
    broken.push({
      clusters: [],
      paragraphStart: true,
      paragraphStartOffset: 0,
      start: 0,
      end: 0,
    });
  } else if (request.content.endsWith("\n") || request.content.endsWith("\r")) {
    broken.push({
      clusters: [],
      paragraphStart: true,
      paragraphStartOffset: request.content.length,
      start: request.content.length,
      end: request.content.length,
    });
  }

  const fallbackMetrics = measureStyle(request.baseStyle);
  const measuredLines = broken.map((line) =>
    measureLine(line, fallbackMetrics),
  );
  const paragraphStyles = broken.map((line) =>
    paragraphStyleAt(line.paragraphStartOffset),
  );
  const contentHeight = measuredLines.reduce(
    (sum, line, index) =>
      sum +
      line.height +
      (index > 0 && broken[index]!.paragraphStart
        ? paragraphGap(paragraphStyles[index - 1]!, paragraphStyles[index]!)
        : 0),
    0,
  );
  const naturalWidth = measuredLines.reduce((maximum, line, index) => {
    const insets = listLayout.lineInsets(
      broken[index]!.paragraphStartOffset,
      broken[index]!.paragraphStart,
      paragraphStyles[index]!.paragraphIndent,
    );
    return Math.max(maximum, line.width + insets.left + insets.right);
  }, 0);
  const width =
    request.mode === "auto-width" ? naturalWidth : normalize(request.width!);
  const height =
    request.mode === "fixed"
      ? normalize(request.height!)
      : normalize(contentHeight);
  const verticalOffset =
    request.mode === "fixed" && contentHeight < height
      ? request.textAlignVertical === "center"
        ? (height - contentHeight) / 2
        : request.textAlignVertical === "bottom"
          ? height - contentHeight
          : 0
      : 0;

  const lines: TextRunLayoutLine[] = [];
  const fragments: TextRunLayoutFragment<LeaferTextRunStyle>[] = [];
  let lineY = verticalOffset;
  for (let lineIndex = 0; lineIndex < broken.length; lineIndex += 1) {
    const sourceLine = broken[lineIndex]!;
    const measuredLine = measuredLines[lineIndex]!;
    if (lineIndex > 0 && sourceLine.paragraphStart) {
      lineY += paragraphGap(
        paragraphStyles[lineIndex - 1]!,
        paragraphStyles[lineIndex]!,
      );
    }
    const insets = listLayout.lineInsets(
      sourceLine.paragraphStartOffset,
      sourceLine.paragraphStart,
      paragraphStyles[lineIndex]!.paragraphIndent,
    );
    const usableWidth = Math.max(0, width - insets.left - insets.right);
    const alignedX =
      insets.left +
      (request.textAlignHorizontal === "center"
        ? Math.max(0, (usableWidth - measuredLine.width) / 2)
        : request.textAlignHorizontal === "right"
          ? Math.max(0, usableWidth - measuredLine.width)
          : 0);
    lines.push({
      baseline: normalize(measuredLine.ascent),
      end: sourceLine.end,
      height: normalize(measuredLine.height),
      start: sourceLine.start,
      width: normalize(measuredLine.width),
      x: normalize(alignedX),
      y: normalize(lineY),
    });
    fragments.push(
      ...lineFragments(
        sourceLine.clusters,
        lineIndex,
        alignedX,
        lineY,
        measuredLine.ascent,
      ),
    );
    lineY += measuredLine.height;
  }

  const markers: TextRunLayoutMarker<LeaferTextRunStyle>[] =
    markerMeasurements.map((marker) => {
      const line = lines.find((candidate) => candidate.start === marker.start);
      if (!line) {
        throw new Error(
          `Missing first line for list paragraph ${marker.start}`,
        );
      }
      return {
        baseline: normalize(marker.baseline),
        direction: marker.direction,
        height: normalize(marker.height),
        paragraphStart: marker.start,
        style: marker.style,
        text: marker.text,
        width: normalize(marker.width),
        x: normalizeSigned(listLayout.markerX(marker.start, width)),
        y: normalize(line.y + line.baseline - marker.baseline),
      };
    });

  const minX =
    lines.length === 0 && markers.length === 0
      ? 0
      : Math.min(
          ...lines.map((line) => line.x),
          ...markers.map((marker) => marker.x),
        );
  const maxX = [...lines, ...markers].reduce(
    (maximum, item) => Math.max(maximum, item.x + item.width),
    minX,
  );
  return {
    contentBounds: {
      height: normalize(contentHeight),
      width: normalize(maxX - minX),
      x: normalizeSigned(minX),
      y: normalize(verticalOffset),
    },
    fragments,
    lines,
    markers,
    ok: true,
    provider: LEAFER_TEXT_RUN_LAYOUT_PROVIDER_ID,
    providerVersion: LEAFER_TEXT_RUN_LAYOUT_PROVIDER_VERSION,
    size: { height, width },
    warnings,
  };
}

function equalParagraphStyle(
  left: TextParagraphStyle,
  right: TextParagraphStyle,
): boolean {
  return (
    left.listOptions.type === right.listOptions.type &&
    left.indentation === right.indentation &&
    left.listSpacing === right.listSpacing &&
    left.paragraphIndent === right.paragraphIndent &&
    left.paragraphSpacing === right.paragraphSpacing
  );
}

function paragraphGap(
  previous: TextParagraphStyle,
  current: TextParagraphStyle,
): number {
  return previous.listOptions.type !== "none" &&
    current.listOptions.type !== "none"
    ? previous.listSpacing
    : previous.paragraphSpacing;
}

function materializedRuns(
  request: TextRunLayoutRequest<LeaferTextRunStyle>,
): TextStyleRun<LeaferTextRunStyle>[] {
  return canonicalizeTextStyleRuns(
    request.content,
    request.runs,
    request.baseStyle,
    equalLeaferTextRunStyle,
  );
}

function measureLine<Style extends TextRunLayoutStyle>(
  line: BrokenTextRunLine<Style>,
  fallback: MeasuredStyle,
): MeasuredStyle & { width: number } {
  if (line.clusters.length === 0) {
    return { ...fallback, width: 0 };
  }
  const ascent = line.clusters.reduce(
    (maximum, cluster) => Math.max(maximum, cluster.ascent),
    0,
  );
  const descent = line.clusters.reduce(
    (maximum, cluster) => Math.max(maximum, cluster.descent),
    0,
  );
  return {
    ascent,
    descent,
    height: ascent + descent,
    width: textRunLineWidth(line.clusters),
  };
}

function lineFragments<Style extends TextRunLayoutStyle>(
  clusters: readonly MeasuredTextRunCluster<Style>[],
  lineIndex: number,
  lineX: number,
  lineY: number,
  lineAscent: number,
): TextRunLayoutFragment<Style>[] {
  const fragments: TextRunLayoutFragment<Style>[] = [];
  let x = lineX;
  for (const cluster of clusters) {
    const previous = fragments.at(-1);
    if (
      previous &&
      previous.lineIndex === lineIndex &&
      previous.end === cluster.start &&
      previous.style === cluster.style &&
      !cluster.hardBreak &&
      !previous.text.endsWith("\n")
    ) {
      previous.end = cluster.end;
      previous.text += cluster.text;
      previous.width = normalize(previous.width + cluster.advance);
    } else {
      fragments.push({
        baseline: normalize(cluster.ascent),
        end: cluster.end,
        height: normalize(cluster.ascent + cluster.descent),
        lineIndex,
        start: cluster.start,
        style: cluster.style,
        text: cluster.text,
        width: normalize(cluster.advance),
        x: normalize(x),
        y: normalize(lineY + lineAscent - cluster.ascent),
      });
    }
    x += cluster.advance;
  }
  return fragments;
}

function measureNativeText(
  Text: LeaferRunTextConstructor,
  text: string,
  style: LeaferTextRunStyle,
): { baseline: number; lineHeight: number; width: number } {
  const instance = new Text({
    ...leaferTextRunData(style),
    text,
    textOverflow: "show",
    textWrap: "none",
  });
  try {
    const bounds = instance.boxBounds;
    const baseline = instance.__?.__baseLine;
    const lineHeight = instance.__?.__lineHeight;
    const width = instance.__?.__textDrawData?.rows?.[0]?.width;
    if (
      !finiteNonNegative(bounds.width) ||
      !finiteNonNegative(width) ||
      !finitePositive(lineHeight) ||
      !finiteNonNegative(baseline) ||
      baseline > lineHeight
    ) {
      throw new Error("Leafer did not expose stable text metrics");
    }
    return {
      baseline: normalize(baseline),
      lineHeight: normalize(lineHeight),
      width: normalize(width),
    };
  } finally {
    instance.destroy();
  }
}

function fontWarnings(
  runs: readonly TextStyleRun<LeaferTextRunStyle>[],
  baseStyle: LeaferTextRunStyle,
  fontAvailable: NonNullable<
    LeaferTextRunLayoutProviderOptions["fontAvailable"]
  >,
) {
  const warnings: Array<{
    code: "font-fallback";
    fallback: string;
    message: string;
  }> = [];
  const seen = new Set<string>();
  for (const style of [baseStyle, ...runs.map((run) => run.style)]) {
    const key = fontStyleKey(style);
    if (seen.has(key)) continue;
    seen.add(key);
    const availability = inspectLeaferFont(style, fontAvailable);
    if (availability.status !== "missing") continue;
    warnings.push({
      code: "font-fallback",
      fallback:
        "Projected native fragments measured with the browser font fallback",
      message: `Font ${style.fontFamily} (${style.fontStyleName ?? "unresolved"}) is not currently available; rich text was measured with the browser fallback`,
    });
    if (warnings.length === 8) break;
  }
  return warnings;
}

function leaferTextRunData(style: LeaferTextRunStyle): Record<string, unknown> {
  return {
    fill: style.fill,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    italic: style.fontSlant === "italic",
    letterSpacing: { type: "px", value: style.letterSpacing },
    lineHeight: { type: "px", value: style.lineHeight },
    textCase:
      style.textCase === "original"
        ? "none"
        : style.textCase === "uppercase"
          ? "upper"
          : style.textCase === "lowercase"
            ? "lower"
            : style.textCase === "small-caps"
              ? "small-caps"
              : "title",
    textDecoration:
      style.textDecoration === "underline"
        ? "under"
        : style.textDecoration === "strikethrough"
          ? "delete"
          : "none",
    textOverflow: "show",
    textWrap: "none",
  };
}

function validateLeaferTextRunRequest(
  request: TextRunLayoutRequest<LeaferTextRunStyle>,
): string | null {
  for (const style of [
    request.baseStyle,
    ...request.runs.map((run) => run.style),
  ]) {
    if (!validLeaferFill(style.fill)) {
      return "Leafer text run layout requires a bounded serializable fill";
    }
  }
  return null;
}

function validLeaferFill(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length > 0 && value.length <= 4_096;
  }
  if ((typeof value !== "object" || value === null) && !Array.isArray(value)) {
    return false;
  }
  if (Array.isArray(value) && value.length > 8) return false;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= 65_536;
  } catch {
    return false;
  }
}

function metricStyleKey(style: TextRunLayoutStyle): string {
  return JSON.stringify([
    style.fontFamily,
    style.fontStyleName,
    style.fontSize,
    style.fontWeight,
    style.fontSlant,
    style.letterSpacing,
    style.lineHeight,
    style.textCase,
  ]);
}

function fontStyleKey(style: TextRunLayoutStyle): string {
  return JSON.stringify([
    style.fontFamily,
    style.fontStyleName,
    style.fontWeight,
    style.fontSlant,
  ]);
}

function equalLeaferTextRunStyle(
  left: LeaferTextRunStyle,
  right: LeaferTextRunStyle,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function failure(
  code: TextRunLayoutFailureCode,
  message: string,
  retryable: boolean,
): TextRunLayoutResult<LeaferTextRunStyle> {
  return { code, message, ok: false, retryable };
}

function normalize(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
}

function normalizeSigned(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
