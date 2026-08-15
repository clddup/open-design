export const TEXT_RANGE_SERVICE_CONTRACT_VERSION = 1 as const;
export const MAX_TEXT_STYLE_RUNS = 65_536;

/**
 * One fully resolved style segment in a JavaScript string.
 *
 * Offsets intentionally use UTF-16 code units and `[start, end)` semantics,
 * matching Figma's JavaScript range APIs. Boundaries may not split a valid
 * surrogate pair, so editing an emoji cannot persist a half character.
 */
export interface TextStyleRun<Style> {
  start: number;
  end: number;
  style: Style;
}

export interface TextContentEdit {
  start: number;
  end: number;
  insert: string;
  inheritStyle?: "before" | "after";
}

export interface TextContentEditResult<Style> {
  content: string;
  edit: TextContentEdit;
  insertedRange: { start: number; end: number };
  runs: TextStyleRun<Style>[];
}

export function validateTextStyleRuns<Style>(
  content: string,
  runs: readonly TextStyleRun<Style>[],
): string | null {
  const typedRuns = runs;
  if (typeof content !== "string") return "Text range content must be a string";
  if (!Array.isArray(runs) || typedRuns.length > MAX_TEXT_STYLE_RUNS) {
    return `Text range count exceeds ${MAX_TEXT_STYLE_RUNS}`;
  }
  if (content.length === 0) {
    return typedRuns.length === 0
      ? null
      : "Empty text cannot retain non-empty style ranges";
  }
  if (typedRuns.length === 0) return null;

  let expectedStart = 0;
  for (const run of typedRuns) {
    if (
      !Number.isSafeInteger(run.start) ||
      !Number.isSafeInteger(run.end) ||
      run.start !== expectedStart ||
      run.end <= run.start ||
      run.end > content.length
    ) {
      return "Text style ranges must be ordered, contiguous, non-empty, and cover the complete content";
    }
    if (
      !isUtf16CodePointBoundary(content, run.start) ||
      !isUtf16CodePointBoundary(content, run.end)
    ) {
      return "Text style range boundaries may not split a UTF-16 surrogate pair";
    }
    if (run.style === undefined) {
      return "Text style ranges require a resolved style";
    }
    expectedStart = run.end;
  }
  return expectedStart === content.length
    ? null
    : "Text style ranges must cover the complete content";
}

export function canonicalizeTextStyleRuns<Style>(
  content: string,
  runs: readonly TextStyleRun<Style>[],
  baseStyle: Style,
  equal: (left: Style, right: Style) => boolean = Object.is,
): TextStyleRun<Style>[] {
  const issue = validateTextStyleRuns(content, runs);
  if (issue) throw new TypeError(issue);
  if (content.length === 0) return [];
  const complete =
    runs.length === 0
      ? [{ start: 0, end: content.length, style: baseStyle }]
      : runs.map((run) => ({ ...run }));
  return mergeAdjacentTextStyleRuns(complete, equal);
}

export function applyTextContentEdit<Style>(
  content: string,
  runs: readonly TextStyleRun<Style>[],
  baseStyle: Style,
  edit: TextContentEdit,
  equal: (left: Style, right: Style) => boolean = Object.is,
): TextContentEditResult<Style> {
  const issue = validateTextStyleRuns(content, runs);
  if (issue) throw new TypeError(issue);
  validateTextEdit(content, edit);

  const complete = canonicalizeTextStyleRuns(content, runs, baseStyle, equal);
  const inheritedStyle = inheritedTextStyle(
    complete,
    baseStyle,
    edit.start,
    edit.end,
    edit.inheritStyle ?? "before",
    content.length,
  );
  const delta = edit.insert.length - (edit.end - edit.start);
  const next: TextStyleRun<Style>[] = [];

  for (const run of complete) {
    if (run.start < edit.start) {
      const end = Math.min(run.end, edit.start);
      if (end > run.start)
        next.push({ start: run.start, end, style: run.style });
    }
    if (run.end > edit.end) {
      const start = Math.max(run.start, edit.end);
      if (run.end > start) {
        next.push({
          start: start + delta,
          end: run.end + delta,
          style: run.style,
        });
      }
    }
  }

  if (edit.insert.length > 0) {
    next.push({
      start: edit.start,
      end: edit.start + edit.insert.length,
      style: inheritedStyle,
    });
  }
  next.sort((left, right) => left.start - right.start || left.end - right.end);

  const nextContent = `${content.slice(0, edit.start)}${edit.insert}${content.slice(edit.end)}`;
  const nextRuns =
    nextContent.length === 0 ? [] : mergeAdjacentTextStyleRuns(next, equal);
  const nextIssue = validateTextStyleRuns(nextContent, nextRuns);
  if (nextIssue) {
    throw new Error(
      `Text range remap produced an invalid result: ${nextIssue}`,
    );
  }
  return {
    content: nextContent,
    edit: { ...edit },
    insertedRange: {
      start: edit.start,
      end: edit.start + edit.insert.length,
    },
    runs: nextRuns,
  };
}

export function remapTextStyleRunsAfterContentChange<Style>(
  previousContent: string,
  nextContent: string,
  runs: readonly TextStyleRun<Style>[],
  baseStyle: Style,
  inheritStyle: "before" | "after" = "before",
  equal: (left: Style, right: Style) => boolean = Object.is,
): TextContentEditResult<Style> {
  const edit = diffTextContent(previousContent, nextContent);
  return applyTextContentEdit(
    previousContent,
    runs,
    baseStyle,
    { ...edit, inheritStyle },
    equal,
  );
}

export function diffTextContent(
  previousContent: string,
  nextContent: string,
): TextContentEdit {
  let start = 0;
  const prefixLimit = Math.min(previousContent.length, nextContent.length);
  while (
    start < prefixLimit &&
    previousContent.charCodeAt(start) === nextContent.charCodeAt(start)
  ) {
    start += 1;
  }
  while (
    start > 0 &&
    (!isUtf16CodePointBoundary(previousContent, start) ||
      !isUtf16CodePointBoundary(nextContent, start))
  ) {
    start -= 1;
  }

  let suffixLength = 0;
  while (
    previousContent.length - suffixLength > start &&
    nextContent.length - suffixLength > start &&
    previousContent.charCodeAt(previousContent.length - suffixLength - 1) ===
      nextContent.charCodeAt(nextContent.length - suffixLength - 1)
  ) {
    suffixLength += 1;
  }
  while (
    suffixLength > 0 &&
    (!isUtf16CodePointBoundary(
      previousContent,
      previousContent.length - suffixLength,
    ) ||
      !isUtf16CodePointBoundary(nextContent, nextContent.length - suffixLength))
  ) {
    suffixLength -= 1;
  }

  const end = previousContent.length - suffixLength;
  return {
    start,
    end,
    insert: nextContent.slice(start, nextContent.length - suffixLength),
  };
}

export function isUtf16CodePointBoundary(
  content: string,
  index: number,
): boolean {
  if (!Number.isSafeInteger(index) || index < 0 || index > content.length) {
    return false;
  }
  if (index === 0 || index === content.length) return true;
  return !(
    isHighSurrogate(content.charCodeAt(index - 1)) &&
    isLowSurrogate(content.charCodeAt(index))
  );
}

function validateTextEdit(content: string, edit: TextContentEdit): void {
  if (
    !Number.isSafeInteger(edit.start) ||
    !Number.isSafeInteger(edit.end) ||
    edit.start < 0 ||
    edit.end < edit.start ||
    edit.end > content.length ||
    !isUtf16CodePointBoundary(content, edit.start) ||
    !isUtf16CodePointBoundary(content, edit.end)
  ) {
    throw new RangeError(
      "Text edit must use bounded UTF-16 code-point boundaries and [start, end) semantics",
    );
  }
  if (typeof edit.insert !== "string") {
    throw new TypeError("Text edit insertion must be a string");
  }
  if (
    edit.inheritStyle !== undefined &&
    edit.inheritStyle !== "before" &&
    edit.inheritStyle !== "after"
  ) {
    throw new TypeError("Text edit style inheritance must be before or after");
  }
}

function inheritedTextStyle<Style>(
  runs: readonly TextStyleRun<Style>[],
  baseStyle: Style,
  start: number,
  end: number,
  policy: "before" | "after",
  contentLength: number,
): Style {
  const replaced = start < end ? styleAt(runs, start) : undefined;
  const before = start > 0 ? styleAt(runs, start - 1) : undefined;
  const after = end < contentLength ? styleAt(runs, end) : undefined;
  return (
    replaced ??
    (policy === "after"
      ? (after ?? before ?? baseStyle)
      : (before ?? after ?? baseStyle))
  );
}

function styleAt<Style>(
  runs: readonly TextStyleRun<Style>[],
  index: number,
): Style | undefined {
  return runs.find((run) => run.start <= index && index < run.end)?.style;
}

function mergeAdjacentTextStyleRuns<Style>(
  runs: readonly TextStyleRun<Style>[],
  equal: (left: Style, right: Style) => boolean,
): TextStyleRun<Style>[] {
  const merged: TextStyleRun<Style>[] = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.end === run.start &&
      equal(previous.style, run.style)
    ) {
      previous.end = run.end;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}
