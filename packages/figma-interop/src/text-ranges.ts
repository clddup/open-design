import { textParagraphRanges } from "@opendesign/text-service";
import type {
  DesignNode,
  Paint as OpenDesignPaint,
  TextParagraphRun,
  TextParagraphStyle,
  TextRun,
  TextRunStyle,
} from "@opendesign/design-contracts";
import {
  figmaBlendMode,
  figmaTextCase,
  figmaTextDecoration,
  openDesignBlendMode,
  parseColor,
  rgbHex,
  toFigmaFontName,
  utf16Boundary,
} from "./appearance-projection.js";

export interface FigmaTextRangeSegment {
  end: number;
  fillStyleId?: string;
  fills: readonly Paint[];
  fontName: FontName;
  fontSize: number;
  fontWeight: number;
  letterSpacing: LetterSpacing;
  lineHeight: LineHeight;
  listOptions: TextListOptions;
  listSpacing: number;
  indentation: number;
  paragraphIndent: number;
  paragraphSpacing: number;
  start: number;
  textCase: TextCase;
  textDecoration: TextDecoration;
  textStyleId?: string;
}

export type FigmaTextRangeResult =
  | { ok: true; segments: readonly FigmaTextRangeSegment[] }
  | { ok: false; issues: readonly string[] };

export type OpenDesignTextRangeResult =
  | {
      ok: true;
      paragraphRuns: readonly TextParagraphRun[];
      runs: readonly TextRun[];
    }
  | { ok: false; issues: readonly string[] };

export function toFigmaTextRangeSegments(
  node: Extract<DesignNode, { kind: "text" }>,
): FigmaTextRangeResult {
  if (node.properties.content.length === 0) return { ok: true, segments: [] };
  const base = textNodeBaseStyle(node);
  const runs =
    node.properties.runs && node.properties.runs.length > 0
      ? node.properties.runs
      : [{ start: 0, end: node.properties.content.length, style: base }];
  const paragraphBase = textNodeBaseParagraphStyle(node);
  const paragraphRuns =
    node.properties.paragraphRuns && node.properties.paragraphRuns.length > 0
      ? node.properties.paragraphRuns
      : [
          {
            start: 0,
            end: node.properties.content.length,
            style: paragraphBase,
          },
        ];
  const explicitParagraphRanges = textParagraphRanges(node.properties.content);
  const boundaries = [
    ...new Set([
      0,
      node.properties.content.length,
      ...runs.flatMap((run) => [run.start, run.end]),
      ...paragraphRuns.flatMap((run) => [run.start, run.end]),
      ...explicitParagraphRanges.flatMap((range) => [range.start, range.end]),
    ]),
  ].sort((left, right) => left - right);
  const issues: string[] = [];
  const segments = boundaries
    .slice(0, -1)
    .flatMap<FigmaTextRangeSegment>((start, index) => {
      const end = boundaries[index + 1]!;
      const style = runs.find(
        (run) => run.start <= start && start < run.end,
      )?.style;
      const paragraphStyle = paragraphRuns.find(
        (run) => run.start <= start && start < run.end,
      )?.style;
      if (!style || !paragraphStyle) {
        issues.push(
          `Text range ${index} has incomplete character or paragraph coverage`,
        );
        return [];
      }
      const fontName = toFigmaFontName(style);
      if (!fontName) {
        issues.push(
          `Text range ${index} has an unresolved font face style name`,
        );
        return [];
      }
      const fills = toFigmaRangePaints(style.fills, index, issues);
      if (!fills) return [];
      return [
        {
          start,
          end,
          fontName,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: { unit: "PIXELS", value: style.letterSpacing },
          lineHeight: { unit: "PIXELS", value: style.lineHeight },
          listOptions: toFigmaListOptions(paragraphStyle.listOptions),
          listSpacing: paragraphStyle.listSpacing,
          indentation: paragraphStyle.indentation,
          paragraphIndent: paragraphStyle.paragraphIndent,
          paragraphSpacing: paragraphStyle.paragraphSpacing,
          textCase: figmaTextCase(style.textCase),
          textDecoration: figmaTextDecoration(style.textDecoration),
          fills,
          ...(style.textStyleId ? { textStyleId: style.textStyleId } : {}),
          ...(style.fillStyleId ? { fillStyleId: style.fillStyleId } : {}),
        },
      ];
    });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, segments };
}

export function fromFigmaTextRangeSegments(
  content: string,
  segments: readonly FigmaTextRangeSegment[],
): OpenDesignTextRangeResult {
  if (content.length === 0) {
    return segments.length === 0
      ? { ok: true, paragraphRuns: [], runs: [] }
      : { ok: false, issues: ["Empty text cannot contain Figma segments"] };
  }
  const issues: string[] = [];
  let expectedStart = 0;
  const runs = segments.flatMap<TextRun>((segment, index) => {
    if (
      segment.start !== expectedStart ||
      segment.end <= segment.start ||
      segment.end > content.length ||
      !utf16Boundary(content, segment.start) ||
      !utf16Boundary(content, segment.end)
    ) {
      issues.push(
        `Figma text segment ${index} is not a contiguous UTF-16 range`,
      );
      return [];
    }
    expectedStart = segment.end;
    if (
      segment.letterSpacing.unit !== "PIXELS" ||
      segment.lineHeight.unit !== "PIXELS"
    ) {
      issues.push(
        `Figma text segment ${index} requires pixel spacing and line height`,
      );
      return [];
    }
    if (
      (segment.listOptions.type !== "NONE" &&
        segment.listOptions.type !== "ORDERED" &&
        segment.listOptions.type !== "UNORDERED") ||
      !Number.isSafeInteger(segment.indentation) ||
      segment.indentation < 0 ||
      segment.indentation > 5 ||
      (segment.listOptions.type !== "NONE" && segment.indentation === 0) ||
      !Number.isFinite(segment.listSpacing) ||
      segment.listSpacing < 0 ||
      !Number.isFinite(segment.paragraphIndent) ||
      segment.paragraphIndent < 0 ||
      !Number.isFinite(segment.paragraphSpacing) ||
      segment.paragraphSpacing < 0
    ) {
      issues.push(
        `Figma text segment ${index} requires finite non-negative paragraph fields`,
      );
      return [];
    }
    const fills = fromFigmaRangePaints(segment.fills, index, issues);
    if (!fills) return [];
    return [
      {
        start: segment.start,
        end: segment.end,
        style: {
          fontFamily: segment.fontName.family,
          fontStyleName: segment.fontName.style,
          fontSize: segment.fontSize,
          fontWeight: segment.fontWeight,
          fontSlant: /italic|oblique/i.test(segment.fontName.style)
            ? "italic"
            : "normal",
          letterSpacing: segment.letterSpacing.value,
          lineHeight: segment.lineHeight.value,
          textCase: openDesignTextCase(segment.textCase),
          textDecoration: openDesignTextDecoration(segment.textDecoration),
          fills,
          ...(segment.textStyleId ? { textStyleId: segment.textStyleId } : {}),
          ...(segment.fillStyleId ? { fillStyleId: segment.fillStyleId } : {}),
        },
      },
    ];
  });
  if (expectedStart !== content.length) {
    issues.push("Figma text segments must cover the complete content");
  }
  const paragraphRuns = textParagraphRanges(content).flatMap<TextParagraphRun>(
    (paragraph, paragraphIndex) => {
      const overlapping = segments.filter(
        (segment) =>
          segment.end > paragraph.start && segment.start < paragraph.end,
      );
      const first = overlapping[0];
      if (!first) {
        issues.push(`Figma paragraph ${paragraphIndex} has no styled segment`);
        return [];
      }
      if (
        overlapping.some(
          (segment) =>
            segment.listOptions.type !== first.listOptions.type ||
            segment.indentation !== first.indentation ||
            segment.listSpacing !== first.listSpacing ||
            segment.paragraphIndent !== first.paragraphIndent ||
            segment.paragraphSpacing !== first.paragraphSpacing,
        )
      ) {
        issues.push(
          `Figma paragraph ${paragraphIndex} has inconsistent paragraph fields`,
        );
        return [];
      }
      return [
        {
          ...paragraph,
          style: {
            listOptions: fromFigmaListOptions(first.listOptions),
            indentation: first.indentation,
            listSpacing: first.listSpacing,
            paragraphIndent: first.paragraphIndent,
            paragraphSpacing: first.paragraphSpacing,
          },
        },
      ];
    },
  );
  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        paragraphRuns: mergeAdjacentRuns(paragraphRuns),
        runs: mergeAdjacentRuns(runs),
      };
}

function textNodeBaseStyle(
  node: Extract<DesignNode, { kind: "text" }>,
): TextRunStyle {
  return {
    fontFamily: node.properties.fontFamily,
    fontStyleName: node.properties.fontStyleName,
    fontSize: node.properties.fontSize,
    fontWeight: node.properties.fontWeight,
    fontSlant: node.properties.fontSlant,
    letterSpacing: node.properties.letterSpacing,
    lineHeight: node.properties.lineHeight,
    textCase: node.properties.textCase,
    textDecoration: node.properties.textDecoration,
    fills: node.properties.fills,
    ...(node.textStyleId ? { textStyleId: node.textStyleId } : {}),
    ...(node.fillStyleId ? { fillStyleId: node.fillStyleId } : {}),
  };
}

function textNodeBaseParagraphStyle(
  node: Extract<DesignNode, { kind: "text" }>,
): TextParagraphStyle {
  return {
    listOptions: { type: "none" },
    indentation: 0,
    listSpacing: node.properties.listSpacing,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
  };
}

function toFigmaListOptions(
  value: TextParagraphStyle["listOptions"],
): TextListOptions {
  return {
    type:
      value.type === "ordered"
        ? "ORDERED"
        : value.type === "unordered"
          ? "UNORDERED"
          : "NONE",
  };
}

function fromFigmaListOptions(
  value: TextListOptions,
): TextParagraphStyle["listOptions"] {
  return {
    type:
      value.type === "ORDERED"
        ? "ordered"
        : value.type === "UNORDERED"
          ? "unordered"
          : "none",
  };
}

function mergeAdjacentRuns<
  Run extends { start: number; end: number; style: unknown },
>(runs: readonly Run[]): Run[] {
  const result: Run[] = [];
  for (const run of runs) {
    const previous = result.at(-1);
    if (
      previous &&
      previous.end === run.start &&
      JSON.stringify(previous.style) === JSON.stringify(run.style)
    ) {
      previous.end = run.end;
    } else {
      result.push(structuredClone(run));
    }
  }
  return result;
}

function toFigmaRangePaints(
  paints: readonly OpenDesignPaint[],
  rangeIndex: number,
  issues: string[],
): Paint[] | null {
  const result: Paint[] = [];
  for (const paint of paints) {
    if (paint.type !== "solid") {
      issues.push(
        `Text range ${rangeIndex} paint ${paint.type} requires a dedicated Figma adapter`,
      );
      return null;
    }
    const color = parseColor(paint.color);
    if (!color) {
      issues.push(`Text range ${rangeIndex} has an unsupported solid color`);
      return null;
    }
    result.push({
      type: "SOLID",
      color: { r: color.r, g: color.g, b: color.b },
      opacity: paint.opacity * color.a,
      visible: paint.visible ?? true,
      blendMode: figmaBlendMode(paint.blendMode),
    });
  }
  return result;
}

function fromFigmaRangePaints(
  paints: readonly Paint[],
  rangeIndex: number,
  issues: string[],
): OpenDesignPaint[] | null {
  const result: OpenDesignPaint[] = [];
  for (const paint of paints) {
    if (paint.type !== "SOLID") {
      issues.push(
        `Figma text segment ${rangeIndex} paint ${paint.type} is not supported`,
      );
      return null;
    }
    const blendMode = openDesignBlendMode(paint.blendMode);
    result.push({
      type: "solid",
      color: rgbHex(paint.color),
      opacity: paint.opacity ?? 1,
      ...(paint.visible === false ? { visible: false } : {}),
      ...(blendMode === "normal" ? {} : { blendMode }),
    });
  }
  return result;
}

function openDesignTextCase(value: TextCase): TextRunStyle["textCase"] {
  if (value === "UPPER") return "uppercase";
  if (value === "LOWER") return "lowercase";
  if (value === "TITLE") return "title-case";
  if (value === "SMALL_CAPS" || value === "SMALL_CAPS_FORCED") {
    return "small-caps";
  }
  return "original";
}

function openDesignTextDecoration(
  value: TextDecoration,
): TextRunStyle["textDecoration"] {
  if (value === "UNDERLINE") return "underline";
  if (value === "STRIKETHROUGH") return "strikethrough";
  return "none";
}
