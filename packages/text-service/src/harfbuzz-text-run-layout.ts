import type * as HarfBuzz from "harfbuzzjs";
import {
  createHarfBuzzFontRegistry,
  harfBuzzStyleKey,
  type HarfBuzzFontFaceDescriptor,
  type RegisteredHarfBuzzFace,
} from "./harfbuzz-font-registry.js";
import { canonicalizeTextStyleRuns, type TextStyleRun } from "./text-ranges.js";
import {
  canonicalizeTextParagraphRuns,
  type TextParagraphStyle,
} from "./text-paragraphs.js";
import {
  createTextListLayout,
  type TextListLayout,
} from "./text-list-layout.js";
import { resolveTextListMarkers } from "./text-lists.js";
import {
  validateTextRunLayoutRequest,
  validateTextRunLayoutResult,
  type TextRunLayoutDecoration,
  type TextRunLayoutFragment,
  type TextRunLayoutGlyph,
  type TextRunLayoutLine,
  type TextRunLayoutMarker,
  type TextRunLayoutProvider,
  type TextRunLayoutRequest,
  type TextRunLayoutResult,
  type TextRunLayoutStyle,
} from "./text-run-layout.js";
import {
  layoutTextRunWithEndingTruncation,
  type RawTextRunLayoutResult,
} from "./text-run-truncation.js";
import {
  subtractTextDecorationInk,
  type TextDecorationGeometryProvider,
} from "./text-decoration-geometry.js";
/*
 * Keep HarfBuzz behind this async factory. Importing the ordinary text
 * service must not initialize WASM or block desktop startup.
 */

export const HARFBUZZ_TEXT_RUN_LAYOUT_PROVIDER_ID =
  "harfbuzz-wasm-text-runs" as const;
export const HARFBUZZ_TEXT_RUN_LAYOUT_PROVIDER_VERSION =
  "1.7.0+bidi-13+lists-v1+decoration-skip-ink+ending" as const;
export const HARFBUZZ_BIDI_UNICODE_VERSION = "13.0.0" as const;
const HARFBUZZ_COORDINATE_SCALE = 64;

type HarfBuzzModule = typeof HarfBuzz;

interface BidiEmbeddingLevels {
  levels: Uint8Array;
  paragraphs: readonly { end: number; level: number; start: number }[];
}

interface BidiApi {
  getEmbeddingLevels(text: string): BidiEmbeddingLevels;
  getReorderSegments(
    text: string,
    embeddingLevels: BidiEmbeddingLevels,
    start?: number,
    end?: number,
  ): readonly (readonly [number, number])[];
}

export type { HarfBuzzFontFaceDescriptor } from "./harfbuzz-font-registry.js";

export interface HarfBuzzTextRunLayoutRuntime<
  Style extends TextRunLayoutStyle = TextRunLayoutStyle,
> {
  listFonts(): readonly HarfBuzzFontFaceDescriptor[];
  provider: TextRunLayoutProvider<Style>;
  registerFont(
    fontId: string,
    bytes: Uint8Array,
  ): readonly HarfBuzzFontFaceDescriptor[];
  unregisterFont(fontId: string): void;
}

export interface CreateHarfBuzzTextRunLayoutRuntimeOptions {
  decorationGeometryProvider?:
    | PromiseLike<TextDecorationGeometryProvider>
    | TextDecorationGeometryProvider;
}

export async function createHarfBuzzTextRunLayoutRuntime<
  Style extends TextRunLayoutStyle = TextRunLayoutStyle,
>(
  options: CreateHarfBuzzTextRunLayoutRuntimeOptions = {},
): Promise<HarfBuzzTextRunLayoutRuntime<Style>> {
  const [hb, bidi, decorationGeometryProvider] = await Promise.all([
    import("harfbuzzjs"),
    loadBidi(),
    options.decorationGeometryProvider,
  ]);
  const registry = createHarfBuzzFontRegistry(hb);

  const provider: TextRunLayoutProvider<Style> = {
    id: HARFBUZZ_TEXT_RUN_LAYOUT_PROVIDER_ID,
    version: HARFBUZZ_TEXT_RUN_LAYOUT_PROVIDER_VERSION,
    layout(request) {
      const issue = validateTextRunLayoutRequest(request);
      if (issue) return failure("invalid-input", issue, false);
      if (request.baseStyle.textCase !== "original") {
        return failure(
          "unsupported",
          "HarfBuzz text run layout currently requires original text case",
          false,
        );
      }
      const runs = canonicalizeTextStyleRuns(
        request.content,
        request.runs,
        request.baseStyle,
        equalStyle,
      );
      const resolved = new Map<string, RegisteredHarfBuzzFace>();
      for (const run of runs) {
        if (run.style.textCase !== "original") {
          return failure(
            "unsupported",
            "HarfBuzz text run layout currently requires original text case",
            false,
          );
        }
        const key = harfBuzzStyleKey(run.style);
        const face = registry.resolve(run.style);
        if (!face) {
          return failure(
            "provider-unavailable",
            `Imported font face is unavailable: ${run.style.fontFamily} / ${run.style.fontStyleName ?? "Regular"} / ${run.style.fontWeight} / ${run.style.fontSlant}`,
            true,
          );
        }
        resolved.set(key, face);
      }
      try {
        const result = layoutTextRunWithEndingTruncation(
          request,
          (displayRequest) =>
            layoutWithHarfBuzz(
              hb,
              bidi,
              displayRequest,
              canonicalizeTextStyleRuns(
                displayRequest.content,
                displayRequest.runs,
                displayRequest.baseStyle,
                equalStyle,
              ),
              resolved,
              decorationGeometryProvider,
            ),
        );
        const resultIssue = validateTextRunLayoutResult(result, request);
        return resultIssue
          ? failure("measurement-failed", resultIssue, false)
          : result;
      } catch (error) {
        if (error instanceof UnsupportedShapingError) {
          return failure("unsupported", error.message, false);
        }
        return failure(
          "measurement-failed",
          error instanceof Error && error.message
            ? `HarfBuzz shaping failed: ${error.message}`
            : "HarfBuzz shaping failed",
          false,
        );
      }
    },
  };

  return {
    listFonts: () => registry.list(),
    provider,
    registerFont: (fontId, bytes) => registry.register(fontId, bytes),
    unregisterFont: (fontId) => registry.unregister(fontId),
  };
}

async function loadBidi(): Promise<BidiApi> {
  // bidi-js 1.0.3 has no published TypeScript declarations. Keep its dynamic
  // module value unknown until the narrow factory boundary is validated.
  // @ts-expect-error -- upstream package has no TypeScript declaration
  const value: unknown = await import("bidi-js");
  if (
    typeof value !== "object" ||
    value === null ||
    !("default" in value) ||
    typeof value.default !== "function"
  ) {
    throw new TypeError("bidi-js did not expose its expected factory");
  }
  return (value.default as () => BidiApi)();
}

interface ShapedGlyph {
  clusterEnd: number;
  clusterStart: number;
  glyphId: number;
  path: string;
  xAdvance: number;
  xOffset: number;
  yAdvance: number;
  yOffset: number;
}

class UnsupportedShapingError extends Error {}

interface ShapedCluster<Style extends TextRunLayoutStyle> {
  advance: number;
  ascent: number;
  breakAfter: boolean;
  descent: number;
  end: number;
  glyphs: ShapedGlyph[];
  hardBreak: boolean;
  level: number;
  start: number;
  style: Style;
  text: string;
}

interface BrokenLine<Style extends TextRunLayoutStyle> {
  clusters: ShapedCluster<Style>[];
  end: number;
  paragraphStart: boolean;
  paragraphStartOffset: number;
  start: number;
}

function layoutWithHarfBuzz<Style extends TextRunLayoutStyle>(
  hb: HarfBuzzModule,
  bidi: BidiApi,
  request: TextRunLayoutRequest<Style>,
  runs: readonly TextStyleRun<Style>[],
  resolved: ReadonlyMap<string, RegisteredHarfBuzzFace>,
  decorationGeometryProvider: TextDecorationGeometryProvider | undefined,
): RawTextRunLayoutResult<Style> {
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
  const embedding = bidi.getEmbeddingLevels(request.content);
  const clusters: ShapedCluster<Style>[] = [];
  for (const shapingRun of metricDirectionalRuns(runs, embedding)) {
    const registered = resolved.get(harfBuzzStyleKey(shapingRun.style));
    if (!registered) throw new Error("Resolved font face disappeared");
    clusters.push(
      ...shapeRun(hb, request.content, shapingRun, registered, embedding),
    );
  }
  clusters.sort((left, right) => left.start - right.start);
  assignBreakOpportunities(clusters);
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
    const registered = resolved.get(harfBuzzStyleKey(style));
    if (!registered) throw new Error("Resolved marker font face disappeared");
    const shaped = shapeListMarker(
      hb,
      bidi,
      marker.text,
      style,
      registered,
      decorationGeometryProvider,
    );
    return {
      ...marker,
      ...shaped,
      direction:
        ((embedding.levels[marker.start] ??
          embedding.paragraphs.find(
            (paragraph) =>
              paragraph.start <= marker.start && marker.start < paragraph.end,
          )?.level ??
          0) &
          1) ===
        1
          ? ("rtl" as const)
          : ("ltr" as const),
      fontSize: style.fontSize,
      paragraphStart: marker.start,
      style,
    };
  });
  const listLayout = createTextListLayout(
    markerMeasurements,
    request.hangingList,
  );
  const broken = breakLines(clusters, request, paragraphStyleAt, listLayout);
  if (request.content.length === 0) {
    broken.push({
      clusters: [],
      end: 0,
      paragraphStart: true,
      paragraphStartOffset: 0,
      start: 0,
    });
  } else if (/\r\n$|[\r\n]$/.test(request.content)) {
    broken.push({
      clusters: [],
      end: request.content.length,
      paragraphStart: true,
      paragraphStartOffset: request.content.length,
      start: request.content.length,
    });
  }

  const fallbackMetrics = fontMetrics(request.baseStyle, resolved);
  const measured = broken.map((line) => measureLine(line, fallbackMetrics));
  const paragraphStyles = broken.map((line) =>
    paragraphStyleAt(line.paragraphStartOffset),
  );
  const contentHeight = measured.reduce(
    (sum, line, index) =>
      sum +
      line.height +
      (index > 0 && broken[index]!.paragraphStart
        ? paragraphGap(paragraphStyles[index - 1]!, paragraphStyles[index]!)
        : 0),
    0,
  );
  const naturalWidth = measured.reduce((maximum, line, index) => {
    const insets = listLayout.lineInsets(
      broken[index]!.paragraphStartOffset,
      broken[index]!.paragraphStart,
      paragraphStyles[index]!.paragraphIndent,
    );
    return Math.max(maximum, line.width + insets.left + insets.right);
  }, 0);
  const width =
    request.mode === "auto-width" ? normalize(naturalWidth) : request.width!;
  const height =
    request.mode === "fixed" ? request.height! : normalize(contentHeight);
  const verticalOffset =
    request.mode === "fixed" && contentHeight < height
      ? request.textAlignVertical === "center"
        ? (height - contentHeight) / 2
        : request.textAlignVertical === "bottom"
          ? height - contentHeight
          : 0
      : 0;

  const lines: TextRunLayoutLine[] = [];
  const fragments: TextRunLayoutFragment<Style>[] = [];
  let lineY = verticalOffset;
  for (let lineIndex = 0; lineIndex < broken.length; lineIndex += 1) {
    const sourceLine = broken[lineIndex]!;
    const metrics = measured[lineIndex]!;
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
    const lineX =
      insets.left +
      (request.textAlignHorizontal === "center"
        ? Math.max(0, (usableWidth - metrics.width) / 2)
        : request.textAlignHorizontal === "right"
          ? Math.max(0, usableWidth - metrics.width)
          : 0);
    lines.push({
      baseline: normalize(metrics.ascent),
      end: sourceLine.end,
      height: normalize(metrics.height),
      start: sourceLine.start,
      width: normalize(metrics.width),
      x: normalize(lineX),
      y: normalize(lineY),
    });
    fragments.push(
      ...positionLine(
        bidi,
        request.content,
        runs,
        sourceLine,
        embedding,
        lineIndex,
        lineX,
        lineY,
        metrics,
        resolved,
        decorationGeometryProvider,
      ),
    );
    lineY += metrics.height;
  }

  const markers: TextRunLayoutMarker<Style>[] = markerMeasurements.map(
    (marker) => {
      const line = lines.find((candidate) => candidate.start === marker.start);
      if (!line) {
        throw new Error(
          `Missing first line for list paragraph ${marker.start}`,
        );
      }
      return {
        baseline: normalize(marker.baseline),
        ...(marker.decorations.length === 0
          ? {}
          : { decorations: marker.decorations }),
        direction: marker.direction,
        glyphs: marker.glyphs,
        height: normalize(marker.height),
        paragraphStart: marker.start,
        style: marker.style,
        text: marker.text,
        width: normalize(marker.width),
        x: normalize(listLayout.markerX(marker.start, width)),
        y: normalize(line.y + line.baseline - marker.baseline),
      };
    },
  );

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
      x: normalize(minX),
      y: normalize(verticalOffset),
    },
    fragments,
    lines,
    markers,
    ok: true,
    provider: HARFBUZZ_TEXT_RUN_LAYOUT_PROVIDER_ID,
    providerVersion: HARFBUZZ_TEXT_RUN_LAYOUT_PROVIDER_VERSION,
    sourceClusterEnds: clusters.map((cluster) => cluster.end),
    size: { height: normalize(height), width: normalize(width) },
    warnings: [],
  };
}

function metricDirectionalRuns<Style extends TextRunLayoutStyle>(
  runs: readonly TextStyleRun<Style>[],
  embedding: BidiEmbeddingLevels,
): TextStyleRun<Style>[] {
  const result: TextStyleRun<Style>[] = [];
  for (const run of runs) {
    let start = run.start;
    while (start < run.end) {
      const level = embedding.levels[start] ?? 0;
      let end = start + 1;
      while (end < run.end && (embedding.levels[end] ?? level) === level) {
        end += 1;
      }
      const previous = result.at(-1);
      if (
        previous &&
        previous.end === start &&
        (embedding.levels[previous.start] ?? 0) === level &&
        sameMetrics(previous.style, run.style)
      ) {
        previous.end = end;
      } else {
        result.push({ end, start, style: run.style });
      }
      start = end;
    }
  }
  return result;
}

function shapeRun<Style extends TextRunLayoutStyle>(
  hb: HarfBuzzModule,
  content: string,
  run: TextStyleRun<Style>,
  registered: RegisteredHarfBuzzFace,
  embedding: BidiEmbeddingLevels,
): ShapedCluster<Style>[] {
  const font = new hb.Font(registered.face);
  font.setScale(
    Math.round(run.style.fontSize * HARFBUZZ_COORDINATE_SCALE),
    Math.round(run.style.fontSize * HARFBUZZ_COORDINATE_SCALE),
  );
  const extents = font.hExtents();
  const ascent = Math.max(0, extents.ascender / HARFBUZZ_COORDINATE_SCALE);
  const descent = Math.max(0, -extents.descender / HARFBUZZ_COORDINATE_SCALE);
  const leading = Math.max(0, run.style.lineHeight - ascent - descent);
  const effectiveAscent = ascent + leading / 2;
  const effectiveDescent = descent + leading / 2;
  const buffer = new hb.Buffer();
  buffer.addText(content, run.start, run.end - run.start);
  buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_CHARACTERS);
  buffer.setDirection(
    ((embedding.levels[run.start] ?? 0) & 1) === 1
      ? hb.Direction.RTL
      : hb.Direction.LTR,
  );
  buffer.guessSegmentProperties();
  hb.shape(font, buffer);
  const infos = buffer.getGlyphInfos();
  const positions = buffer.getGlyphPositions();
  if (infos.length !== positions.length) {
    throw new Error("HarfBuzz returned mismatched glyph arrays");
  }
  const clusterStarts = [...new Set(infos.map((info) => info.cluster))].sort(
    (left, right) => left - right,
  );
  if (clusterStarts.length === 0 && run.start !== run.end) {
    throw new Error("HarfBuzz returned no clusters for non-empty text");
  }
  const clusterEndByStart = new Map<number, number>();
  clusterStarts.forEach((start, index) => {
    clusterEndByStart.set(start, clusterStarts[index + 1] ?? run.end);
  });
  const clustersByStart = new Map<number, ShapedCluster<Style>>();
  infos.forEach((info, index) => {
    const position = positions[index]!;
    const clusterEnd = clusterEndByStart.get(info.cluster);
    if (
      clusterEnd === undefined ||
      info.cluster < run.start ||
      clusterEnd > run.end ||
      clusterEnd <= info.cluster
    ) {
      throw new Error("HarfBuzz returned an invalid UTF-16 cluster");
    }
    const glyph: ShapedGlyph = {
      clusterEnd,
      clusterStart: info.cluster,
      glyphId: info.codepoint,
      path: glyphJsonToPath(font.glyphToJson(info.codepoint)),
      xAdvance: position.xAdvance / HARFBUZZ_COORDINATE_SCALE,
      xOffset: position.xOffset / HARFBUZZ_COORDINATE_SCALE,
      yAdvance: position.yAdvance / HARFBUZZ_COORDINATE_SCALE,
      yOffset: position.yOffset / HARFBUZZ_COORDINATE_SCALE,
    };
    const current = clustersByStart.get(info.cluster);
    if (current) current.glyphs.push(glyph);
    else {
      const text = content.slice(info.cluster, clusterEnd);
      clustersByStart.set(info.cluster, {
        advance: 0,
        ascent: effectiveAscent,
        breakAfter: false,
        descent: effectiveDescent,
        end: clusterEnd,
        glyphs: [glyph],
        hardBreak: text === "\n" || text === "\r" || text === "\r\n",
        level: embedding.levels[info.cluster] ?? 0,
        start: info.cluster,
        style: run.style,
        text,
      });
    }
  });
  for (const cluster of clustersByStart.values()) {
    cluster.advance = cluster.hardBreak
      ? 0
      : Math.abs(
          cluster.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0),
        ) + run.style.letterSpacing;
  }
  return [...clustersByStart.values()].sort(
    (left, right) => left.start - right.start,
  );
}

function shapeListMarker<Style extends TextRunLayoutStyle>(
  hb: HarfBuzzModule,
  bidi: BidiApi,
  text: string,
  style: Style,
  registered: RegisteredHarfBuzzFace,
  decorationGeometryProvider: TextDecorationGeometryProvider | undefined,
): {
  baseline: number;
  decorations: readonly TextRunLayoutDecoration[];
  glyphs: readonly TextRunLayoutGlyph[];
  height: number;
  width: number;
} {
  const embedding = bidi.getEmbeddingLevels(text);
  const run: TextStyleRun<Style> = { start: 0, end: text.length, style };
  const clusters = shapeRun(hb, text, run, registered, embedding);
  const fallback = fontMetrics(
    style,
    new Map([[harfBuzzStyleKey(style), registered]]),
  );
  const line: BrokenLine<Style> = {
    clusters,
    end: text.length,
    paragraphStart: true,
    paragraphStartOffset: 0,
    start: 0,
  };
  const metrics = measureLine(line, fallback);
  const glyphs = positionLine(
    bidi,
    text,
    [run],
    line,
    embedding,
    0,
    0,
    0,
    metrics,
    new Map([[harfBuzzStyleKey(style), registered]]),
    decorationGeometryProvider,
  );
  return {
    baseline: metrics.ascent,
    decorations: glyphs.flatMap((fragment) => fragment.decorations ?? []),
    glyphs: glyphs.flatMap((fragment) => fragment.glyphs ?? []),
    height: metrics.height,
    width: metrics.width,
  };
}

function glyphJsonToPath(
  commands: readonly { type: string; values: readonly number[] }[],
): string {
  return commands
    .map(
      (command) =>
        `${command.type}${command.values
          .map((value) => normalize(value / HARFBUZZ_COORDINATE_SCALE))
          .join(" ")}`,
    )
    .join("");
}

function assignBreakOpportunities<Style extends TextRunLayoutStyle>(
  clusters: ShapedCluster<Style>[],
): void {
  for (const cluster of clusters) {
    cluster.breakAfter =
      cluster.hardBreak ||
      /^\s+$/u.test(cluster.text) ||
      /[-‐‑‒–—/]$/u.test(cluster.text) ||
      /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff]$/u.test(cluster.text);
  }
}

function breakLines<Style extends TextRunLayoutStyle>(
  clusters: readonly ShapedCluster<Style>[],
  request: TextRunLayoutRequest<Style>,
  paragraphStyleAt: (offset: number) => TextParagraphStyle,
  listLayout: TextListLayout,
): BrokenLine<Style>[] {
  const lines: BrokenLine<Style>[] = [];
  let index = 0;
  let paragraphStart = true;
  let paragraphStartOffset = 0;
  while (index < clusters.length) {
    const startIndex = index;
    const lineStart = clusters[index]!.start;
    const paragraphStyle = paragraphStyleAt(paragraphStartOffset);
    const insets = listLayout.lineInsets(
      paragraphStartOffset,
      paragraphStart,
      paragraphStyle.paragraphIndent,
    );
    const limit =
      request.mode === "auto-width"
        ? Number.POSITIVE_INFINITY
        : Math.max(0, request.width! - insets.left - insets.right);
    let width = 0;
    let lastWordBreak = -1;
    while (index < clusters.length) {
      const cluster = clusters[index]!;
      if (cluster.hardBreak) {
        index += 1;
        break;
      }
      const nextWidth = width + cluster.advance;
      if (
        request.mode !== "auto-width" &&
        index > startIndex &&
        nextWidth > limit
      ) {
        if (request.textWrap === "word" && lastWordBreak >= startIndex) {
          index = lastWordBreak + 1;
        }
        break;
      }
      width = nextWidth;
      if (cluster.breakAfter) lastWordBreak = index;
      index += 1;
    }
    if (index === startIndex) index += 1;
    const lineClusters = clusters.slice(startIndex, index);
    const last = lineClusters.at(-1)!;
    lines.push({
      clusters: lineClusters,
      end: last.end,
      paragraphStart,
      paragraphStartOffset,
      start: lineStart,
    });
    paragraphStart = last.hardBreak;
    if (paragraphStart) paragraphStartOffset = last.end;
  }
  return lines;
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

function measureLine<Style extends TextRunLayoutStyle>(
  line: BrokenLine<Style>,
  fallback: { ascent: number; descent: number },
): { ascent: number; descent: number; height: number; width: number } {
  const visible = line.clusters.filter((cluster) => !cluster.hardBreak);
  const ascent = visible.reduce(
    (maximum, cluster) => Math.max(maximum, cluster.ascent),
    fallback.ascent,
  );
  const descent = visible.reduce(
    (maximum, cluster) => Math.max(maximum, cluster.descent),
    fallback.descent,
  );
  return {
    ascent,
    descent,
    height: ascent + descent,
    width: visible.reduce((sum, cluster) => sum + cluster.advance, 0),
  };
}

function positionLine<Style extends TextRunLayoutStyle>(
  bidi: BidiApi,
  content: string,
  runs: readonly TextStyleRun<Style>[],
  line: BrokenLine<Style>,
  embedding: BidiEmbeddingLevels,
  lineIndex: number,
  lineX: number,
  lineY: number,
  metrics: { ascent: number; height: number; width: number },
  resolved: ReadonlyMap<string, RegisteredHarfBuzzFace>,
  decorationGeometryProvider: TextDecorationGeometryProvider | undefined,
): TextRunLayoutFragment<Style>[] {
  const visual = [...line.clusters];
  if (line.start < line.end) {
    for (const [start, end] of bidi.getReorderSegments(
      content,
      embedding,
      line.start,
      line.end - 1,
    )) {
      const first = visual.findIndex((cluster) => cluster.end > start);
      let last = visual.length - 1;
      while (last >= 0 && visual[last]!.start > end) last -= 1;
      if (first >= 0 && last >= first) {
        visual.splice(
          first,
          last - first + 1,
          ...visual.slice(first, last + 1).reverse(),
        );
      }
    }
  }
  const positionedByStart = new Map<
    number,
    { cluster: ShapedCluster<Style>; glyphs: TextRunLayoutGlyph[]; x: number }
  >();
  let cursor = lineX;
  for (const cluster of visual) {
    let pen = 0;
    const glyphs = cluster.glyphs.map((glyph): TextRunLayoutGlyph => {
      const result = {
        clusterEnd: glyph.clusterEnd,
        clusterStart: glyph.clusterStart,
        glyphId: glyph.glyphId,
        path: glyph.path,
        x: normalize(cursor + pen + glyph.xOffset),
        xAdvance: normalize(glyph.xAdvance),
        y: normalize(glyph.yOffset),
        yAdvance: normalize(glyph.yAdvance),
      };
      pen += glyph.xAdvance;
      return result;
    });
    positionedByStart.set(cluster.start, { cluster, glyphs, x: cursor });
    cursor += cluster.advance;
  }

  const fragments: TextRunLayoutFragment<Style>[] = [];
  let start = line.start;
  while (start < line.end) {
    const run = runs.find(
      (candidate) => start >= candidate.start && start < candidate.end,
    );
    if (!run) throw new Error(`Missing style at UTF-16 offset ${start}`);
    const cluster = line.clusters.find(
      (candidate) => candidate.start === start,
    );
    if (!cluster)
      throw new Error(`Missing shaped cluster at UTF-16 offset ${start}`);
    if (cluster.end > run.end) {
      throw new UnsupportedShapingError(
        `Style boundary at UTF-16 offset ${run.end} splits shaped cluster ${cluster.start}-${cluster.end}`,
      );
    }
    let end = cluster.end;
    while (end < Math.min(run.end, line.end)) {
      const next = line.clusters.find((candidate) => candidate.start === end);
      if (!next) break;
      if (next.end > run.end) {
        throw new UnsupportedShapingError(
          `Style boundary at UTF-16 offset ${run.end} splits shaped cluster ${next.start}-${next.end}`,
        );
      }
      end = next.end;
    }
    const positioned = line.clusters
      .filter((candidate) => candidate.start >= start && candidate.end <= end)
      .map((candidate) => positionedByStart.get(candidate.start)!)
      .filter(Boolean);
    const absoluteGlyphs = positioned.flatMap((candidate) => candidate.glyphs);
    const fragmentX = positioned.reduce(
      (minimum, candidate) => Math.min(minimum, candidate.x),
      Number.POSITIVE_INFINITY,
    );
    const fragmentRight = positioned.reduce(
      (maximum, candidate) =>
        Math.max(maximum, candidate.x + candidate.cluster.advance),
      fragmentX,
    );
    const width = normalize(fragmentRight - fragmentX);
    const fragmentGlyphs = absoluteGlyphs.map((glyph) => ({
      ...glyph,
      x: normalize(glyph.x - fragmentX),
    }));
    const decorations = decorationOutlines(
      run.style,
      width,
      fragmentGlyphs,
      resolved,
      decorationGeometryProvider,
    );
    fragments.push({
      baseline: normalize(metrics.ascent),
      ...(decorations.length === 0 ? {} : { decorations }),
      end,
      glyphs: fragmentGlyphs,
      height: normalize(metrics.height),
      lineIndex,
      start,
      style: run.style,
      text: content.slice(start, end),
      width,
      x: normalize(fragmentX),
      y: normalize(lineY),
    });
    start = end;
  }
  return fragments;
}

function decorationOutlines(
  style: TextRunLayoutStyle,
  width: number,
  glyphs: readonly TextRunLayoutGlyph[],
  resolved: ReadonlyMap<string, RegisteredHarfBuzzFace>,
  decorationGeometryProvider: TextDecorationGeometryProvider | undefined,
): TextRunLayoutDecoration[] {
  if (style.textDecoration === "none" || width === 0) return [];
  const face = resolved.get(harfBuzzStyleKey(style));
  if (!face?.decorationMetrics) {
    throw new UnsupportedShapingError(
      `Imported font face has no exact ${style.textDecoration} metrics`,
    );
  }
  if (
    style.textDecoration === "underline" &&
    style.textDecorationSkipInk &&
    !decorationGeometryProvider
  ) {
    throw new UnsupportedShapingError(
      "Exact underline skip-ink clipping is unavailable for this provider",
    );
  }
  const scale = style.fontSize / face.descriptor.unitsPerEm;
  const position =
    style.textDecoration === "underline"
      ? face.decorationMetrics.underlinePosition
      : face.decorationMetrics.strikethroughPosition;
  const thickness =
    style.textDecoration === "underline"
      ? face.decorationMetrics.underlineThickness
      : face.decorationMetrics.strikethroughThickness;
  const center = resolveDecorationOffset(style, position * scale);
  const height = resolveDecorationThickness(style, thickness * scale);
  const path = decorationPath(
    style.textDecorationStyle ?? "solid",
    width,
    center,
    height,
  );
  const clipped =
    style.textDecoration === "underline" && style.textDecorationSkipInk
      ? subtractTextDecorationInk(path, glyphs, decorationGeometryProvider!)
      : { empty: false, ok: true as const, path };
  if (!clipped.ok) throw new UnsupportedShapingError(clipped.message);
  if (clipped.empty) return [];
  return [
    {
      color:
        style.textDecorationColor?.value === "auto" ||
        style.textDecorationColor === null
          ? "auto"
          : structuredClone(style.textDecorationColor.value),
      kind: style.textDecoration,
      path: clipped.path,
      style: style.textDecorationStyle ?? "solid",
    },
  ];
}

function resolveDecorationOffset(
  style: TextRunLayoutStyle,
  autoPosition: number,
): number {
  const metric = style.textDecorationOffset;
  if (!metric || metric.unit === "auto") return normalize(autoPosition);
  const distance =
    metric.unit === "pixels"
      ? metric.value
      : (metric.value / 100) * style.fontSize;
  return normalize(-distance);
}

function resolveDecorationThickness(
  style: TextRunLayoutStyle,
  autoThickness: number,
): number {
  const metric = style.textDecorationThickness;
  if (!metric || metric.unit === "auto") return normalize(autoThickness);
  return normalize(
    metric.unit === "pixels"
      ? metric.value
      : (metric.value / 100) * style.fontSize,
  );
}

function decorationPath(
  style: "dotted" | "solid" | "wavy",
  width: number,
  center: number,
  thickness: number,
): string {
  if (style === "dotted") return dottedDecorationPath(width, center, thickness);
  if (style === "wavy") return wavyDecorationPath(width, center, thickness);
  const top = normalize(center + thickness / 2);
  const bottom = normalize(center - thickness / 2);
  return `M0 ${bottom}L${width} ${bottom}L${width} ${top}L0 ${top}Z`;
}

function dottedDecorationPath(
  width: number,
  center: number,
  thickness: number,
): string {
  const radius = thickness / 2;
  const idealStep = Math.max(thickness * 2, 1);
  const count = Math.max(1, Math.min(4_096, Math.ceil(width / idealStep)));
  const step = width / count;
  const kappa = radius * 0.5522847498;
  return Array.from({ length: count }, (_, index) => {
    const x = normalize(Math.min(width - radius, index * step + step / 2));
    const left = normalize(x - radius);
    const right = normalize(x + radius);
    const top = normalize(center + radius);
    const bottom = normalize(center - radius);
    return `M${left} ${center}C${left} ${normalize(center + kappa)} ${normalize(x - kappa)} ${top} ${x} ${top}C${normalize(x + kappa)} ${top} ${right} ${normalize(center + kappa)} ${right} ${center}C${right} ${normalize(center - kappa)} ${normalize(x + kappa)} ${bottom} ${x} ${bottom}C${normalize(x - kappa)} ${bottom} ${left} ${normalize(center - kappa)} ${left} ${center}Z`;
  }).join("");
}

function wavyDecorationPath(
  width: number,
  center: number,
  thickness: number,
): string {
  const idealStep = Math.max(thickness * 2, 2);
  const segments = Math.max(2, Math.min(4_096, Math.ceil(width / idealStep)));
  const step = width / segments;
  const amplitude = Math.max(thickness, 1);
  const upper: string[] = [];
  const lower: string[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const x = normalize(index * step);
    const wave = Math.sin((index * Math.PI) / 2) * amplitude;
    upper.push(`${x} ${normalize(center + wave + thickness / 2)}`);
    lower.unshift(`${x} ${normalize(center + wave - thickness / 2)}`);
  }
  return `M${upper.join("L")}L${lower.join("L")}Z`;
}

function fontMetrics<Style extends TextRunLayoutStyle>(
  style: Style,
  resolved: ReadonlyMap<string, RegisteredHarfBuzzFace>,
): { ascent: number; descent: number } {
  const face = resolved.get(harfBuzzStyleKey(style));
  if (!face)
    return { ascent: style.lineHeight * 0.8, descent: style.lineHeight * 0.2 };
  const ratio = style.lineHeight / style.fontSize;
  return {
    ascent: style.fontSize * 0.8 * ratio,
    descent: style.fontSize * 0.2 * ratio,
  };
}

function sameMetrics(
  left: TextRunLayoutStyle,
  right: TextRunLayoutStyle,
): boolean {
  return (
    harfBuzzStyleKey(left) === harfBuzzStyleKey(right) &&
    left.fontSize === right.fontSize &&
    left.letterSpacing === right.letterSpacing &&
    left.lineHeight === right.lineHeight &&
    left.textCase === right.textCase &&
    left.textDecoration === right.textDecoration &&
    left.textDecorationStyle === right.textDecorationStyle &&
    JSON.stringify(left.textDecorationOffset) ===
      JSON.stringify(right.textDecorationOffset) &&
    JSON.stringify(left.textDecorationThickness) ===
      JSON.stringify(right.textDecorationThickness) &&
    JSON.stringify(left.textDecorationColor) ===
      JSON.stringify(right.textDecorationColor) &&
    left.textDecorationSkipInk === right.textDecorationSkipInk
  );
}

function equalStyle(
  left: TextRunLayoutStyle,
  right: TextRunLayoutStyle,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalize(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("Shaping produced non-finite geometry");
  return Math.round(value * 1_000_000) / 1_000_000;
}

function failure(
  code:
    | "invalid-input"
    | "measurement-failed"
    | "provider-unavailable"
    | "unsupported",
  message: string,
  retryable: boolean,
): TextRunLayoutResult<never> {
  return { code, message, ok: false, retryable };
}
