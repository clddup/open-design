import {
  applyTextRangeStyle,
  isUtf16CodePointBoundary,
  remapTextStyleRunsAfterContentChange,
  validateTextStyleRuns,
  type TextStyleRun,
} from "./text-ranges.js";

export const TEXT_PARAGRAPH_SERVICE_CONTRACT_VERSION = 2 as const;
export const MAX_TEXT_PARAGRAPH_RUNS = 16_384;

export interface TextParagraphStyle {
  listOptions: TextListOptions;
  indentation: number;
  listSpacing: number;
  paragraphIndent: number;
  paragraphSpacing: number;
}

export interface TextListOptions {
  type: "none" | "ordered" | "unordered";
}

export type TextParagraphRun<Style extends TextParagraphStyle> =
  TextStyleRun<Style>;

export function textParagraphRanges(
  content: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code !== 0x0a && code !== 0x0d) continue;
    const end =
      code === 0x0d && content.charCodeAt(index + 1) === 0x0a
        ? index + 2
        : index + 1;
    ranges.push({ start, end });
    start = end;
    index = end - 1;
  }
  if (start < content.length) ranges.push({ start, end: content.length });
  return ranges;
}

export function validateTextParagraphRuns<Style extends TextParagraphStyle>(
  content: string,
  runs: readonly TextParagraphRun<Style>[],
): string | null {
  if (!Array.isArray(runs) || runs.length > MAX_TEXT_PARAGRAPH_RUNS) {
    return `Text paragraph range count exceeds ${MAX_TEXT_PARAGRAPH_RUNS}`;
  }
  const rangeIssue = validateTextStyleRuns(content, runs);
  if (rangeIssue) return rangeIssue.replaceAll("Text style", "Text paragraph");
  if (runs.length === 0) return null;
  const starts = new Set(
    textParagraphRanges(content).map((range) => range.start),
  );
  const ends = new Set(textParagraphRanges(content).map((range) => range.end));
  for (const run of runs) {
    if (!starts.has(run.start) || !ends.has(run.end)) {
      return "Text paragraph ranges must start and end on paragraph boundaries";
    }
    if (!validParagraphStyle(run.style)) {
      return "Text paragraph style requires valid list, indentation, and finite non-negative spacing fields";
    }
  }
  return null;
}

export function canonicalizeTextParagraphRuns<Style extends TextParagraphStyle>(
  content: string,
  runs: readonly TextParagraphRun<Style>[],
  baseStyle: Style,
  equal: (left: Style, right: Style) => boolean = Object.is,
): TextParagraphRun<Style>[] {
  const issue = validateTextParagraphRuns(content, runs);
  if (issue) throw new TypeError(issue);
  if (!validParagraphStyle(baseStyle)) {
    throw new TypeError(
      "Text paragraph base style requires finite non-negative indent and spacing",
    );
  }
  if (content.length === 0) return [];
  if (runs.length > 0) return mergeAdjacent(runs, equal);
  return textParagraphRanges(content)
    .map((range) => ({
      ...range,
      style: structuredClone(baseStyle),
    }))
    .reduce<TextParagraphRun<Style>[]>((result, run) => {
      const previous = result.at(-1);
      if (previous && equal(previous.style, run.style)) previous.end = run.end;
      else result.push(run);
      return result;
    }, []);
}

export function applyTextParagraphRangeStyle<Style extends TextParagraphStyle>(
  content: string,
  runs: readonly TextParagraphRun<Style>[],
  baseStyle: Style,
  range: { start: number; end: number },
  update: (style: Style) => Style,
  equal: (left: Style, right: Style) => boolean = Object.is,
): TextParagraphRun<Style>[] {
  const issue = validateTextParagraphRuns(content, runs);
  if (issue) throw new TypeError(issue);
  if (
    range.end <= range.start ||
    range.start < 0 ||
    range.end > content.length ||
    !isUtf16CodePointBoundary(content, range.start) ||
    !isUtf16CodePointBoundary(content, range.end)
  ) {
    throw new RangeError(
      "Text paragraph update must use a non-empty bounded UTF-16 [start, end) range",
    );
  }
  const touched = textParagraphRanges(content).filter(
    (paragraph) => paragraph.end > range.start && paragraph.start < range.end,
  );
  const first = touched[0];
  const last = touched.at(-1);
  if (!first || !last) {
    throw new RangeError("Text paragraph update did not touch a paragraph");
  }
  const next = applyTextRangeStyle(
    content,
    canonicalizeTextParagraphRuns(content, runs, baseStyle, equal),
    baseStyle,
    { start: first.start, end: last.end },
    update,
    equal,
  );
  const nextIssue = validateTextParagraphRuns(content, next);
  if (nextIssue) {
    throw new TypeError(
      `Text paragraph update produced an invalid result: ${nextIssue}`,
    );
  }
  return next;
}

export function remapTextParagraphRunsAfterContentChange<
  Style extends TextParagraphStyle,
>(
  previousContent: string,
  nextContent: string,
  runs: readonly TextParagraphRun<Style>[],
  baseStyle: Style,
  inheritStyle: "before" | "after" = "before",
  equal: (left: Style, right: Style) => boolean = Object.is,
): TextParagraphRun<Style>[] {
  const issue = validateTextParagraphRuns(previousContent, runs);
  if (issue) throw new TypeError(issue);
  if (nextContent.length === 0) return [];
  const remapped = remapTextStyleRunsAfterContentChange(
    previousContent,
    nextContent,
    canonicalizeTextParagraphRuns(previousContent, runs, baseStyle, equal),
    baseStyle,
    inheritStyle,
    equal,
  ).runs;
  const normalized = textParagraphRanges(nextContent).map((paragraph) => {
    const style = remapped.find(
      (run) => run.start <= paragraph.start && paragraph.start < run.end,
    )?.style;
    if (!style) throw new Error("Text paragraph remap lost a paragraph style");
    return { ...paragraph, style: structuredClone(style) };
  });
  return mergeAdjacent(normalized, equal);
}

function validParagraphStyle(value: TextParagraphStyle): boolean {
  return (
    (value.listOptions.type === "none" ||
      value.listOptions.type === "ordered" ||
      value.listOptions.type === "unordered") &&
    Number.isSafeInteger(value.indentation) &&
    value.indentation >= 0 &&
    value.indentation <= 5 &&
    (value.listOptions.type === "none" || value.indentation > 0) &&
    Number.isFinite(value.listSpacing) &&
    value.listSpacing >= 0 &&
    Number.isFinite(value.paragraphIndent) &&
    value.paragraphIndent >= 0 &&
    Number.isFinite(value.paragraphSpacing) &&
    value.paragraphSpacing >= 0
  );
}

function mergeAdjacent<Style>(
  runs: readonly TextStyleRun<Style>[],
  equal: (left: Style, right: Style) => boolean,
): TextStyleRun<Style>[] {
  const result: TextStyleRun<Style>[] = [];
  for (const run of runs) {
    const previous = result.at(-1);
    if (
      previous &&
      previous.end === run.start &&
      equal(previous.style, run.style)
    ) {
      previous.end = run.end;
    } else {
      result.push(structuredClone(run));
    }
  }
  return result;
}
