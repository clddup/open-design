import type {
  TextRunLayoutRequest,
  TextRunLayoutStyle,
} from "@opendesign/text-service";

export interface MeasuredTextRunCluster<Style extends TextRunLayoutStyle> {
  advance: number;
  ascent: number;
  breakAfter: boolean;
  descent: number;
  end: number;
  hardBreak: boolean;
  start: number;
  style: Style;
  text: string;
}

export interface BrokenTextRunLine<Style extends TextRunLayoutStyle> {
  clusters: MeasuredTextRunCluster<Style>[];
  paragraphStart: boolean;
  paragraphStartOffset: number;
  start: number;
  end: number;
}

export function breakTextRunLines<Style extends TextRunLayoutStyle>(
  clusters: readonly MeasuredTextRunCluster<Style>[],
  request: TextRunLayoutRequest<Style>,
  lineInsetsAt: (
    paragraphStart: number,
    firstLine: boolean,
  ) => { left: number; right: number },
): BrokenTextRunLine<Style>[] {
  const lines: BrokenTextRunLine<Style>[] = [];
  let current: MeasuredTextRunCluster<Style>[] = [];
  let paragraphStart = true;
  let paragraphStartOffset = 0;
  let nextStart = 0;

  const flush = (end: number, nextParagraphStart: boolean) => {
    collapseBoundaryWhitespace(current);
    lines.push({
      clusters: current,
      end,
      paragraphStart,
      paragraphStartOffset,
      start: nextStart,
    });
    current = [];
    nextStart = end;
    paragraphStart = nextParagraphStart;
    if (nextParagraphStart) paragraphStartOffset = end;
  };

  for (const cluster of clusters) {
    current.push({ ...cluster });
    if (cluster.hardBreak) {
      flush(cluster.end, true);
      continue;
    }
    if (request.textWrap === "none" || request.width === undefined) continue;

    const occupiedWidth = () => {
      const insets = lineInsetsAt(paragraphStartOffset, paragraphStart);
      return textRunLineWidth(current) + insets.left + insets.right;
    };
    while (current.length > 1 && occupiedWidth() > request.width) {
      const splitIndex =
        request.textWrap === "character"
          ? current.length - 1
          : wordSplitIndex(current);
      const carry = current.splice(Math.max(1, splitIndex));
      const end = carry[0]?.start ?? current.at(-1)!.end;
      flush(end, false);
      current = carry;
      nextStart = end;
      collapseLeadingWhitespace(current);
    }
  }
  if (current.length > 0) {
    flush(current.at(-1)!.end, paragraphStart);
  }
  return lines;
}

export function assignTextRunBreakOpportunities<
  Style extends TextRunLayoutStyle,
>(clusters: MeasuredTextRunCluster<Style>[]): void {
  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index]!;
    const next = clusters[index + 1];
    cluster.breakAfter = next
      ? canBreakBetween(cluster.text, next.text)
      : terminalSoftBreak(cluster.text);
  }
}

export function textRunLineWidth<Style extends TextRunLayoutStyle>(
  clusters: readonly MeasuredTextRunCluster<Style>[],
): number {
  return clusters.reduce((sum, cluster) => sum + cluster.advance, 0);
}

export function isTextRunHardBreak(value: string): boolean {
  return value === "\n" || value === "\r" || value === "\r\n";
}

export function isTextRunWhitespace(value: string): boolean {
  return !isTextRunHardBreak(value) && /^\s$/u.test(value);
}

export function nextTextRunGraphemeEnd(content: string, start: number): number {
  const first = readCodePoint(content, start);
  if (!first) return start;
  if (first.value === 0x0d && content.codePointAt(first.end) === 0x0a) {
    return first.end + 1;
  }
  let end = first.end;
  if (isRegionalIndicator(first.value)) {
    const second = readCodePoint(content, end);
    if (second && isRegionalIndicator(second.value)) end = second.end;
  }
  end = consumeGraphemeExtenders(content, end);
  while (content.codePointAt(end) === 0x200d) {
    const joined = readCodePoint(content, end + 1);
    if (!joined) break;
    end = consumeGraphemeExtenders(content, joined.end);
  }
  return end;
}

export function unsupportedTextRunLayoutReason<
  Style extends TextRunLayoutStyle,
>(request: TextRunLayoutRequest<Style>): string | null {
  if (
    request.baseStyle.textCase === "title-case" ||
    request.runs.some((run) => run.style.textCase === "title-case")
  ) {
    return "Leafer text run layout does not yet support range-local title case";
  }
  if (
    [...request.content].some((character) =>
      requiresContextualShaping(character),
    )
  ) {
    return "Leafer text run layout requires a contextual shaping provider for this script";
  }
  if (request.runs.length === 0) return null;
  const boundaries = request.runs.flatMap((run) => [run.start, run.end]);
  let boundaryIndex = 0;
  for (let start = 0; start < request.content.length;) {
    const end = nextTextRunGraphemeEnd(request.content, start);
    while (
      boundaries[boundaryIndex] !== undefined &&
      boundaries[boundaryIndex]! <= start
    ) {
      boundaryIndex += 1;
    }
    const boundary = boundaries[boundaryIndex];
    if (boundary !== undefined && boundary < end) {
      return `Text run boundary ${boundary} splits a grapheme cluster`;
    }
    start = end;
  }
  return null;
}

function wordSplitIndex<Style extends TextRunLayoutStyle>(
  clusters: readonly MeasuredTextRunCluster<Style>[],
): number {
  if (isTextRunWhitespace(clusters.at(-1)?.text ?? "")) {
    return clusters.length;
  }
  for (let index = clusters.length - 2; index >= 0; index -= 1) {
    if (clusters[index]!.breakAfter) return index + 1;
  }
  return clusters.length - 1;
}

function collapseBoundaryWhitespace<Style extends TextRunLayoutStyle>(
  clusters: MeasuredTextRunCluster<Style>[],
): void {
  for (let index = clusters.length - 1; index >= 0; index -= 1) {
    const cluster = clusters[index]!;
    if (cluster.hardBreak) continue;
    if (!isTextRunWhitespace(cluster.text)) break;
    cluster.advance = 0;
  }
}

function collapseLeadingWhitespace<Style extends TextRunLayoutStyle>(
  clusters: MeasuredTextRunCluster<Style>[],
): void {
  for (const cluster of clusters) {
    if (!isTextRunWhitespace(cluster.text)) break;
    cluster.advance = 0;
  }
}

function terminalSoftBreak(text: string): boolean {
  if (isTextRunWhitespace(text) || breakPunctuation(text)) return true;
  const codePoint = text.codePointAt(0);
  return codePoint !== undefined && isCjkBreakCharacter(codePoint);
}

function canBreakBetween(previous: string, next: string): boolean {
  if (isTextRunWhitespace(previous) || breakPunctuation(previous)) return true;
  const previousClass = lineBreakClass(previous);
  const nextClass = lineBreakClass(next);
  if (nextClass === "after" || previousClass === "before") return false;
  if (previousClass === "single") return true;
  if (nextClass === "single") {
    return (
      previousClass === "letter" ||
      previousClass === "after" ||
      previousClass === "symbol"
    );
  }
  return (
    nextClass === "before" &&
    (previousClass === "after" || previousClass === "symbol")
  );
}

type LineBreakClass = "after" | "before" | "letter" | "single" | "symbol";

function lineBreakClass(text: string): LineBreakClass {
  if (OPENING_PUNCTUATION.has(text)) return "before";
  if (CLOSING_PUNCTUATION.has(text)) return "after";
  if (SYMBOL_PUNCTUATION.has(text)) return "symbol";
  const codePoint = text.codePointAt(0);
  return codePoint !== undefined && isCjkBreakCharacter(codePoint)
    ? "single"
    : "letter";
}

function breakPunctuation(text: string): boolean {
  return BREAK_PUNCTUATION.has(text);
}

function isCjkBreakCharacter(value: number): boolean {
  return (
    (value >= 0x2e80 && value <= 0x9fff) ||
    (value >= 0xac00 && value <= 0xd7af) ||
    (value >= 0xf900 && value <= 0xfaff) ||
    (value >= 0x3040 && value <= 0x30ff)
  );
}

function consumeGraphemeExtenders(content: string, start: number): number {
  let end = start;
  for (;;) {
    const next = readCodePoint(content, end);
    if (!next || !isGraphemeExtender(next.value)) return end;
    end = next.end;
  }
}

function readCodePoint(
  content: string,
  start: number,
): { end: number; value: number } | null {
  const value = content.codePointAt(start);
  if (value === undefined) return null;
  return { end: start + (value > 0xffff ? 2 : 1), value };
}

function isGraphemeExtender(value: number): boolean {
  return (
    /\p{Mark}/u.test(String.fromCodePoint(value)) ||
    (value >= 0xfe00 && value <= 0xfe0f) ||
    (value >= 0xe0100 && value <= 0xe01ef) ||
    (value >= 0x1f3fb && value <= 0x1f3ff) ||
    (value >= 0xe0020 && value <= 0xe007f)
  );
}

function isRegionalIndicator(value: number): boolean {
  return value >= 0x1f1e6 && value <= 0x1f1ff;
}

function requiresContextualShaping(character: string): boolean {
  const value = character.codePointAt(0);
  if (value === undefined) return false;
  return (
    (value >= 0x0590 && value <= 0x08ff) ||
    (value >= 0x0900 && value <= 0x109f) ||
    (value >= 0x1780 && value <= 0x18af)
  );
}

const BREAK_PUNCTUATION = new Set([
  "-",
  "‐",
  "—",
  "／",
  "～",
  "｜",
  "┆",
  "·",
  "/",
]);
const OPENING_PUNCTUATION = new Set([
  ..."{[(<'\"《（「〈『〖【〔｛┌＜‘“＝¥￥＄€£￡¢￠",
]);
const CLOSING_PUNCTUATION = new Set([
  ...">)]}%!?,.:;'\"》）」〉』〗】〕｝┐＞’”！？，、。：；‰",
]);
const SYMBOL_PUNCTUATION = new Set([..."_#~&*+\\=|≮≯≈≠＝…"]);
