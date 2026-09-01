import {
  canonicalizeTextParagraphRuns,
  textParagraphRanges,
  type TextParagraphStyle,
} from "./text-paragraphs.js";
import {
  canonicalizeTextStyleRuns,
  isUtf16CodePointBoundary,
  type TextStyleRun,
} from "./text-ranges.js";
import type {
  TextRunLayoutRequest,
  TextRunLayoutResult,
  TextRunLayoutStyle,
} from "./text-run-layout.js";

type SuccessfulLayout<Style extends TextRunLayoutStyle> = Extract<
  TextRunLayoutResult<Style>,
  { ok: true }
>;

export type RawTextRunLayoutResult<Style extends TextRunLayoutStyle> =
  | (Omit<
      SuccessfulLayout<Style>,
      "displayContent" | "fullContentBounds" | "sourceContentEnd" | "truncated"
    > & { sourceClusterEnds: readonly number[] })
  | Extract<TextRunLayoutResult<Style>, { ok: false }>;

type RawLayout<Style extends TextRunLayoutStyle> = (
  request: TextRunLayoutRequest<Style>,
) => RawTextRunLayoutResult<Style>;

const ELLIPSIS = "...";
const TOLERANCE = 0.000_001;

export function layoutTextRunWithEndingTruncation<
  Style extends TextRunLayoutStyle,
>(
  request: TextRunLayoutRequest<Style>,
  layoutRaw: RawLayout<Style>,
): TextRunLayoutResult<Style> {
  const full = layoutRaw(
    textRunDisplayRequest(request, request.content.length),
  );
  if (!full.ok) return full;
  if (request.textTruncation === "disabled" || fits(request, full)) {
    return complete(full, request.content, request.content.length, false);
  }
  const lineLimit = visibleLineLimit(request, full);
  if (lineLimit < 1) return unsupportedEndingTruncation();
  const cappedEnd =
    full.lines.length > lineLimit
      ? (full.lines[lineLimit - 1]?.end ?? 0)
      : request.content.length;
  const candidates = normalizedSourceEnds(
    request.content,
    full.sourceClusterEnds,
    cappedEnd,
  );
  let lower = 0;
  let upper = candidates.length - 1;
  let best:
    | { end: number; result: RawTextRunLayoutResult<Style> & { ok: true } }
    | undefined;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const end = candidates[middle]!;
    const candidate = layoutRaw(textRunDisplayRequest(request, end, true));
    if (!candidate.ok) return candidate;
    if (fits(request, candidate)) {
      best = { end, result: candidate };
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return best
    ? complete(
        best.result,
        request.content.slice(0, best.end) + ELLIPSIS,
        best.end,
        true,
        full.contentBounds,
      )
    : unsupportedEndingTruncation();
}

export function textRunDisplayRequest<Style extends TextRunLayoutStyle>(
  request: TextRunLayoutRequest<Style>,
  sourceContentEnd: number,
  truncated = false,
): TextRunLayoutRequest<Style> {
  if (!truncated) {
    return { ...request, maxLines: null, textTruncation: "disabled" };
  }
  const displayContent = request.content.slice(0, sourceContentEnd) + ELLIPSIS;
  return {
    ...request,
    content: displayContent,
    maxLines: null,
    paragraphRuns: displayParagraphRuns(
      request,
      sourceContentEnd,
      displayContent,
    ),
    runs: displayStyleRuns(request, sourceContentEnd, displayContent.length),
    textTruncation: "disabled",
  };
}

export function validateTextRunDisplayIdentity<
  Style extends TextRunLayoutStyle,
>(
  value: SuccessfulLayout<Style>,
  request: TextRunLayoutRequest<Style>,
): string | null {
  if (
    typeof value.displayContent !== "string" ||
    value.displayContent.length > request.content.length + ELLIPSIS.length ||
    typeof value.truncated !== "boolean" ||
    !Number.isSafeInteger(value.sourceContentEnd) ||
    value.sourceContentEnd < 0 ||
    value.sourceContentEnd > request.content.length ||
    !isUtf16CodePointBoundary(request.content, value.sourceContentEnd)
  ) {
    return "Text run layout provider returned invalid display identity";
  }
  if (!value.truncated) {
    return value.sourceContentEnd === request.content.length &&
      value.displayContent === request.content
      ? null
      : "Untruncated text run layout must preserve the complete source content";
  }
  if (
    request.textTruncation !== "ending" ||
    value.sourceContentEnd >= request.content.length ||
    value.displayContent !==
      request.content.slice(0, value.sourceContentEnd) + ELLIPSIS
  ) {
    return "Ending text run layout returned an invalid display prefix";
  }
  return null;
}

function complete<Style extends TextRunLayoutStyle>(
  result: RawTextRunLayoutResult<Style> & { ok: true },
  displayContent: string,
  sourceContentEnd: number,
  truncated: boolean,
  fullContentBounds = result.contentBounds,
): SuccessfulLayout<Style> {
  const publicResult = { ...result };
  Reflect.deleteProperty(publicResult, "sourceClusterEnds");
  return {
    ...publicResult,
    displayContent,
    fullContentBounds,
    sourceContentEnd,
    truncated,
  };
}

function visibleLineLimit<Style extends TextRunLayoutStyle>(
  request: TextRunLayoutRequest<Style>,
  result: RawTextRunLayoutResult<Style> & { ok: true },
): number {
  const configured = request.maxLines ?? Number.POSITIVE_INFINITY;
  if (request.mode !== "fixed") return configured;
  const fitting = result.lines.findIndex(
    (line) => line.y + line.height > request.height! + TOLERANCE,
  );
  return Math.min(configured, fitting === -1 ? result.lines.length : fitting);
}

function fits<Style extends TextRunLayoutStyle>(
  request: TextRunLayoutRequest<Style>,
  result: RawTextRunLayoutResult<Style> & { ok: true },
): boolean {
  if (request.maxLines !== null && result.lines.length > request.maxLines) {
    return false;
  }
  if (request.mode !== "fixed") return true;
  return result.lines.every(
    (line) =>
      line.x >= -TOLERANCE &&
      line.x + line.width <= request.width! + TOLERANCE &&
      line.y >= -TOLERANCE &&
      line.y + line.height <= request.height! + TOLERANCE,
  );
}

function normalizedSourceEnds(
  content: string,
  clusterEnds: readonly number[],
  cappedEnd: number,
): number[] {
  const ends = new Set<number>([0]);
  for (const end of clusterEnds) {
    if (end <= 0 || end > cappedEnd) continue;
    ends.add(content.slice(0, end).trimEnd().length);
  }
  return [...ends].sort((left, right) => left - right);
}

function displayStyleRuns<Style extends TextRunLayoutStyle>(
  request: TextRunLayoutRequest<Style>,
  sourceEnd: number,
  displayLength: number,
): TextStyleRun<Style>[] {
  const source = canonicalizeTextStyleRuns(
    request.content,
    request.runs,
    request.baseStyle,
  );
  const result = source
    .filter((run) => run.start < sourceEnd)
    .map((run) => ({ ...run, end: Math.min(run.end, sourceEnd) }));
  const style = styleAt(source, request.baseStyle, sourceEnd);
  result.push({ start: sourceEnd, end: displayLength, style });
  return result;
}

function displayParagraphRuns<Style extends TextRunLayoutStyle>(
  request: TextRunLayoutRequest<Style>,
  sourceEnd: number,
  displayContent: string,
): TextStyleRun<TextParagraphStyle>[] {
  const base = baseParagraphStyle(request);
  const source = canonicalizeTextParagraphRuns(
    request.content,
    request.paragraphRuns ?? [],
    base,
  );
  return textParagraphRanges(displayContent).map((range) => ({
    ...range,
    style: styleAt(source, base, Math.min(range.start, sourceEnd)),
  }));
}

function styleAt<Style>(
  runs: readonly TextStyleRun<Style>[],
  fallback: Style,
  end: number,
): Style {
  const offset = Math.max(0, end - 1);
  return (
    runs.find((run) => run.start <= offset && offset < run.end)?.style ??
    fallback
  );
}

function baseParagraphStyle<Style extends TextRunLayoutStyle>(
  request: TextRunLayoutRequest<Style>,
): TextParagraphStyle {
  return {
    listOptions: { type: "none" },
    indentation: 0,
    listSpacing: request.listSpacing,
    paragraphIndent: request.paragraphIndent,
    paragraphSpacing: request.paragraphSpacing,
  };
}

function unsupportedEndingTruncation(): TextRunLayoutResult<never> {
  return {
    code: "unsupported",
    message: "Text box cannot fit an exact ending-truncation projection",
    ok: false,
    retryable: false,
  };
}
