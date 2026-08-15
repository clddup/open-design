import {
  canonicalizeTextParagraphRuns,
  textParagraphRanges,
  type TextParagraphRun,
  type TextParagraphStyle,
} from "./text-paragraphs.js";

export const TEXT_LIST_SERVICE_CONTRACT_VERSION = 1 as const;
export const MAX_TEXT_LIST_INDENTATION = 5 as const;

export interface TextListMarker {
  blockIndex: number;
  end: number;
  indentation: number;
  ordinal: number | null;
  start: number;
  text: string;
  type: "ordered" | "unordered";
}

export function resolveTextListMarkers(
  content: string,
  runs: readonly TextParagraphRun<TextParagraphStyle>[],
  baseStyle: TextParagraphStyle,
): TextListMarker[] {
  const paragraphs = textParagraphRanges(content);
  if (paragraphs.length === 0) return [];
  const canonical = canonicalizeTextParagraphRuns(
    content,
    runs,
    baseStyle,
    equalParagraphStyle,
  );
  const counters = Array<number>(MAX_TEXT_LIST_INDENTATION).fill(0);
  const types = Array<"ordered" | "unordered" | null>(
    MAX_TEXT_LIST_INDENTATION,
  ).fill(null);
  const markers: TextListMarker[] = [];
  let blockIndex = -1;
  let insideList = false;

  for (const paragraph of paragraphs) {
    const style = paragraphStyleAt(canonical, paragraph.start);
    const type = style.listOptions.type;
    if (type === "none") {
      counters.fill(0);
      types.fill(null);
      insideList = false;
      continue;
    }
    if (!insideList) {
      blockIndex += 1;
      counters.fill(0);
      types.fill(null);
    }
    insideList = true;
    const indentation = style.indentation;
    const level = indentation - 1;
    for (let deeper = level + 1; deeper < counters.length; deeper += 1) {
      counters[deeper] = 0;
      types[deeper] = null;
    }
    let ordinal: number | null = null;
    if (type === "ordered") {
      if (types[level] !== "ordered") counters[level] = 0;
      counters[level] = (counters[level] ?? 0) + 1;
      types[level] = "ordered";
      ordinal = counters[level]!;
    } else {
      counters[level] = 0;
      types[level] = "unordered";
    }
    markers.push({
      blockIndex,
      end: paragraph.end,
      indentation,
      ordinal,
      start: paragraph.start,
      text: textListMarker(type, indentation, ordinal ?? 1),
      type,
    });
  }
  return markers;
}

export function textListMarker(
  type: "ordered" | "unordered",
  indentation: number,
  ordinal: number,
): string {
  if (type === "unordered") return "•";
  const cycle = (Math.max(1, indentation) - 1) % 3;
  if (cycle === 1) return `${alphabeticCounter(ordinal)}.`;
  if (cycle === 2) return `${romanCounter(ordinal)}.`;
  return `${ordinal}.`;
}

function paragraphStyleAt(
  runs: readonly TextParagraphRun<TextParagraphStyle>[],
  offset: number,
): TextParagraphStyle {
  const style = runs.find(
    (run) => run.start <= offset && offset < run.end,
  )?.style;
  if (!style)
    throw new Error(`Missing paragraph style at UTF-16 offset ${offset}`);
  return style;
}

function alphabeticCounter(value: number): string {
  let remaining = Math.max(1, Math.floor(value));
  let result = "";
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode(0x61 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function romanCounter(value: number): string {
  let remaining = Math.max(1, Math.floor(value));
  const parts: string[] = [];
  const numerals = [
    [1_000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ] as const;
  for (const [amount, symbol] of numerals) {
    while (remaining >= amount) {
      parts.push(symbol);
      remaining -= amount;
    }
  }
  return parts.join("");
}

function equalParagraphStyle(
  left: TextParagraphStyle,
  right: TextParagraphStyle,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
