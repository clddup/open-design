export interface MeasuredTextListMarker {
  blockIndex: number;
  direction: "ltr" | "rtl";
  fontSize: number;
  indentation: number;
  paragraphStart: number;
  width: number;
}

export interface TextListLineInsets {
  left: number;
  right: number;
}

export interface TextListLayout {
  lineInsets(
    paragraphStart: number,
    firstLine: boolean,
    paragraphIndent: number,
  ): TextListLineInsets;
  markerX(paragraphStart: number, width: number): number;
}

interface LevelMetrics {
  columnWidth: number;
  gap: number;
}

interface BlockMetrics {
  indentStep: number;
  levels: Map<number, LevelMetrics>;
}

export function createTextListLayout(
  markers: readonly MeasuredTextListMarker[],
  hangingList: boolean,
): TextListLayout {
  const markerByStart = new Map(
    markers.map((marker) => [marker.paragraphStart, marker]),
  );
  const blocks = new Map<number, BlockMetrics>();
  for (const marker of markers) {
    const block: BlockMetrics = blocks.get(marker.blockIndex) ?? {
      indentStep: 0,
      levels: new Map<number, LevelMetrics>(),
    };
    const gap = Math.max(4, marker.fontSize * 0.5);
    const level: LevelMetrics = block.levels.get(marker.indentation) ?? {
      columnWidth: 0,
      gap: 0,
    };
    level.columnWidth = Math.max(level.columnWidth, marker.width);
    level.gap = Math.max(level.gap, gap);
    block.levels.set(marker.indentation, level);
    block.indentStep = Math.max(
      block.indentStep,
      marker.fontSize * 2,
      level.columnWidth + level.gap + marker.fontSize * 0.5,
    );
    blocks.set(marker.blockIndex, block);
  }

  const geometry = (paragraphStart: number) => {
    const marker = markerByStart.get(paragraphStart);
    if (!marker) return null;
    const block = blocks.get(marker.blockIndex);
    const level = block?.levels.get(marker.indentation);
    if (!block || !level) {
      throw new Error(`Missing list block geometry at ${paragraphStart}`);
    }
    return {
      marker,
      level,
      levelOffset: (marker.indentation - 1) * block.indentStep,
    };
  };

  return {
    lineInsets(paragraphStart, firstLine, paragraphIndent) {
      const value = geometry(paragraphStart);
      if (!value) {
        return firstLine
          ? { left: paragraphIndent, right: 0 }
          : { left: 0, right: 0 };
      }
      const bodyInset =
        value.levelOffset +
        (hangingList ? 0 : value.level.columnWidth + value.level.gap) +
        (firstLine ? paragraphIndent : 0);
      return value.marker.direction === "rtl"
        ? { left: 0, right: bodyInset }
        : { left: bodyInset, right: 0 };
    },
    markerX(paragraphStart, width) {
      const value = geometry(paragraphStart);
      if (!value) throw new Error(`Paragraph ${paragraphStart} is not a list`);
      if (value.marker.direction === "rtl") {
        return hangingList
          ? width + value.levelOffset + value.level.gap
          : width - value.levelOffset - value.marker.width;
      }
      return hangingList
        ? value.levelOffset - value.level.gap - value.marker.width
        : value.levelOffset + value.level.columnWidth - value.marker.width;
    },
  };
}

export function textParagraphDirection(
  content: string,
  start: number,
  end: number,
): "ltr" | "rtl" {
  for (const character of content.slice(start, end)) {
    const codePoint = character.codePointAt(0)!;
    if (
      (codePoint >= 0x0590 && codePoint <= 0x08ff) ||
      (codePoint >= 0xfb1d && codePoint <= 0xfdff) ||
      (codePoint >= 0xfe70 && codePoint <= 0xfeff)
    ) {
      return "rtl";
    }
    if (
      (codePoint >= 0x0041 && codePoint <= 0x005a) ||
      (codePoint >= 0x0061 && codePoint <= 0x007a) ||
      (codePoint >= 0x00c0 && codePoint <= 0x02af) ||
      (codePoint >= 0x2e80 && codePoint <= 0x9fff)
    ) {
      return "ltr";
    }
  }
  return "ltr";
}
