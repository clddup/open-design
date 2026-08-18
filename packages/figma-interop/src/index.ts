import { resolveComponentInstance } from "@opendesign/component-service";
import { textParagraphRanges } from "@opendesign/text-service";
import type {
  ComponentDefinition,
  ComponentPropertyReferences as OpenDesignComponentPropertyReferences,
  DesignDocument,
  DesignNode,
  GridAutoLayout,
  GridTrack as OpenDesignGridTrack,
  Paint as OpenDesignPaint,
  SharedStyleDefinition,
  TextParagraphRun,
  TextParagraphStyle,
  TextRun,
  TextRunStyle,
  VariableAlias as OpenDesignVariableAlias,
  VariableCollectionDefinition,
  VariableDefinition,
  VariantSetDefinition,
} from "@opendesign/design-contracts";

export type FigmaSharedStyleMetadata = Pick<
  BaseStyle,
  "id" | "key" | "name" | "description" | "type"
>;

export type FigmaStyleReferenceField = Extract<
  InheritedStyleField,
  | "fillStyleId"
  | "strokeStyleId"
  | "textStyleId"
  | "effectStyleId"
  | "gridStyleId"
>;

export type FigmaSharedStylePayload =
  | { type: "PAINT"; paints: ReadonlyArray<Paint> }
  | {
      type: "TEXT";
      text: Pick<
        TextStyle,
        | "fontName"
        | "fontSize"
        | "letterSpacing"
        | "lineHeight"
        | "textDecoration"
        | "textCase"
        | "paragraphIndent"
        | "paragraphSpacing"
        | "listSpacing"
        | "hangingList"
      >;
    }
  | { type: "EFFECT"; effects: ReadonlyArray<Effect> }
  | { type: "GRID"; layoutGrids: ReadonlyArray<LayoutGrid> };

export type FigmaStylePayloadResult =
  | { ok: true; payload: FigmaSharedStylePayload }
  | { ok: false; issues: readonly string[] };

export type FigmaExportSettingsResult =
  | { ok: true; settings: readonly ExportSettings[] }
  | { ok: false; issues: readonly string[] };

export type FigmaGridAutoLayout = Pick<
  FrameNode,
  | "layoutMode"
  | "paddingTop"
  | "paddingRight"
  | "paddingBottom"
  | "paddingLeft"
  | "gridRowCount"
  | "gridColumnCount"
  | "gridRowGap"
  | "gridColumnGap"
  | "gridRowSizes"
  | "gridColumnSizes"
  | "gridItemsPositioning"
  | "gridAutoTracks"
  | "layoutSizingHorizontal"
  | "layoutSizingVertical"
>;

export type FigmaGridChild = Pick<
  RectangleNode,
  | "gridRowAnchorIndex"
  | "gridColumnAnchorIndex"
  | "gridRowSpan"
  | "gridColumnSpan"
  | "gridChildHorizontalAlign"
  | "gridChildVerticalAlign"
>;

export type FigmaGridTrackReorderEntry = GridTrackReorderEntry;

export type OpenDesignGridResult =
  { ok: true; grid: GridAutoLayout } | { ok: false; issues: readonly string[] };

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

export const FIGMA_PLUGIN_TYPINGS_VERSION = "1.133.0" as const;
export const FIGMA_PLUGIN_TYPINGS_COMMIT =
  "83bfe81d9616ab759702f657eb18ef153f83e8ae" as const;

export function toFigmaSharedStyleMetadata(
  style: SharedStyleDefinition,
): FigmaSharedStyleMetadata {
  return {
    id: style.id,
    key: style.key,
    name: style.name,
    description: style.description,
    type: style.styleType,
  };
}

export function toFigmaNodeStyleReferences(
  node: DesignNode,
): Partial<Record<FigmaStyleReferenceField, string>> {
  return Object.fromEntries(
    (
      [
        "fillStyleId",
        "strokeStyleId",
        "textStyleId",
        "effectStyleId",
        "gridStyleId",
      ] as const
    ).flatMap((field) => (node[field] ? [[field, node[field]]] : [])),
  );
}

export function toFigmaExportSettings(
  node: DesignNode,
): FigmaExportSettingsResult {
  const issues: string[] = [];
  const settings = node.exportSettings.flatMap<ExportSettings>(
    (setting, index) => {
      if (setting.format === "WEBP") {
        issues.push(
          `Export setting ${index} uses OpenDesign WEBP extension, which has no Figma Plugin API equivalent`,
        );
        return [];
      }
      const shared = {
        suffix: setting.suffix,
        contentsOnly: setting.contentsOnly,
        useAbsoluteBounds: setting.useAbsoluteBounds,
        colorProfile: setting.colorProfile,
      };
      if (setting.format === "PNG" || setting.format === "JPG") {
        return [
          {
            ...shared,
            format: setting.format,
            constraint: structuredClone(setting.constraint),
          },
        ];
      }
      if (setting.format === "SVG") {
        return [
          {
            ...shared,
            format: "SVG",
            svgOutlineText: setting.svgOutlineText,
            svgIdAttribute: setting.svgIdAttribute,
            svgSimplifyStroke: setting.svgSimplifyStroke,
          },
        ];
      }
      return [{ ...shared, format: "PDF" }];
    },
  );
  return issues.length > 0 ? { ok: false, issues } : { ok: true, settings };
}

export function toFigmaNodeType(node: DesignNode): SceneNode["type"] {
  if (node.kind === "slice") return "SLICE";
  if (node.kind === "frame" || node.kind === "slot") return "FRAME";
  if (node.kind === "group" || node.kind === "boolean") return "GROUP";
  if (node.kind === "rectangle") return "RECTANGLE";
  if (node.kind === "ellipse") return "ELLIPSE";
  if (node.kind === "line") return "LINE";
  if (node.kind === "polygon") return "POLYGON";
  if (node.kind === "star") return "STAR";
  if (node.kind === "text") return "TEXT";
  if (node.kind === "instance") return "INSTANCE";
  return "VECTOR";
}

export function toFigmaGridAutoLayout(
  grid: GridAutoLayout,
): FigmaGridAutoLayout {
  return {
    layoutMode: "GRID",
    paddingTop: grid.padding.top,
    paddingRight: grid.padding.right,
    paddingBottom: grid.padding.bottom,
    paddingLeft: grid.padding.left,
    gridRowCount: grid.rows.length,
    gridColumnCount: grid.columns.length,
    gridRowGap: grid.rowGap,
    gridColumnGap: grid.columnGap,
    gridRowSizes: grid.rows.map(toFigmaGridTrack),
    gridColumnSizes: grid.columns.map(toFigmaGridTrack),
    gridItemsPositioning:
      grid.itemsPositioning === "manual" ? "MANUAL" : "ROW_AUTO_FLOW",
    gridAutoTracks: grid.autoTracks === "rows" ? "ROWS" : "NONE",
    layoutSizingHorizontal: grid.sizing?.horizontal === "hug" ? "HUG" : "FIXED",
    layoutSizingVertical: grid.sizing?.vertical === "hug" ? "HUG" : "FIXED",
  };
}

export function fromFigmaGridAutoLayout(
  value: FigmaGridAutoLayout,
): OpenDesignGridResult {
  const issues: string[] = [];
  if (value.layoutMode !== "GRID") issues.push("Figma layoutMode is not GRID");
  const rows = value.gridRowSizes.map((track, index) =>
    fromFigmaGridTrack(track, `row ${index}`, issues),
  );
  const columns = value.gridColumnSizes.map((track, index) =>
    fromFigmaGridTrack(track, `column ${index}`, issues),
  );
  if (rows.length < 1 || rows.length !== value.gridRowCount)
    issues.push("Figma Grid row count and track definitions do not match");
  if (columns.length < 1 || columns.length !== value.gridColumnCount)
    issues.push("Figma Grid column count and track definitions do not match");
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    grid: {
      mode: "grid",
      padding: {
        top: value.paddingTop,
        right: value.paddingRight,
        bottom: value.paddingBottom,
        left: value.paddingLeft,
      },
      rowGap: value.gridRowGap,
      columnGap: value.gridColumnGap,
      rows: rows as OpenDesignGridTrack[],
      columns: columns as OpenDesignGridTrack[],
      itemsPositioning:
        value.gridItemsPositioning === "MANUAL" ? "manual" : "row-auto-flow",
      ...(value.gridAutoTracks === "ROWS" ? { autoTracks: "rows" } : {}),
      sizing: {
        horizontal: value.layoutSizingHorizontal === "HUG" ? "hug" : "fixed",
        vertical: value.layoutSizingVertical === "HUG" ? "hug" : "fixed",
      },
    },
  };
}

export function toFigmaGridChild(node: DesignNode): FigmaGridChild | null {
  const placement = node.gridPlacement;
  if (!placement) return null;
  return {
    gridRowAnchorIndex: placement.row,
    gridColumnAnchorIndex: placement.column,
    gridRowSpan: placement.rowSpan,
    gridColumnSpan: placement.columnSpan,
    gridChildHorizontalAlign: figmaGridAlignment(placement.horizontalAlign),
    gridChildVerticalAlign: figmaGridAlignment(placement.verticalAlign),
  };
}

function toFigmaGridTrack(track: OpenDesignGridTrack): GridTrackSize {
  if (track.type === "hug") return { type: "HUG" };
  return {
    type: track.type === "fixed" ? "FIXED" : "FLEX",
    value: track.value,
  };
}

function fromFigmaGridTrack(
  track: GridTrackSize,
  label: string,
  issues: string[],
): OpenDesignGridTrack | null {
  if (track.type === "HUG") return { type: "hug" };
  if (track.type === "FLEX" && track.value === undefined)
    return { type: "fill", value: 1 };
  if (
    typeof track.value !== "number" ||
    !Number.isFinite(track.value) ||
    track.value < 0 ||
    (track.type === "FLEX" && track.value <= 0)
  ) {
    issues.push(`Figma Grid ${label} has an invalid track value`);
    return null;
  }
  return track.type === "FIXED"
    ? { type: "fixed", value: track.value }
    : { type: "fill", value: track.value };
}

function figmaGridAlignment(
  alignment: "start" | "center" | "end" | "auto",
): FigmaGridChild["gridChildHorizontalAlign"] {
  if (alignment === "start") return "MIN";
  if (alignment === "center") return "CENTER";
  if (alignment === "end") return "MAX";
  return "AUTO";
}

export function toFigmaSharedStylePayload(
  style: SharedStyleDefinition,
): FigmaStylePayloadResult {
  if (style.styleType === "PAINT") {
    const issues: string[] = [];
    const paints = style.paints.flatMap((paint, index) => {
      if (paint.type !== "solid") {
        issues.push(
          `Paint ${index} type ${String(paint.type)} requires a dedicated asset or gradient adapter`,
        );
        return [];
      }
      const color = parseColor(paint.color);
      if (!color) {
        issues.push(
          `Paint ${index} color ${paint.color} is not a supported hex color`,
        );
        return [];
      }
      return [
        {
          type: "SOLID",
          color: { r: color.r, g: color.g, b: color.b },
          opacity: paint.opacity * color.a,
          visible: paint.visible ?? true,
          blendMode: figmaBlendMode(paint.blendMode),
        } satisfies SolidPaint,
      ];
    });
    return issues.length > 0
      ? { ok: false, issues }
      : { ok: true, payload: { type: "PAINT", paints } };
  }
  if (style.styleType === "TEXT") {
    const value = style.textStyle;
    const fontName = toFigmaFontName(value);
    if (!fontName) {
      return {
        ok: false,
        issues: [
          `Text Style ${style.id} has an unresolved font face style name; choose an exact face before Figma export`,
        ],
      };
    }
    return {
      ok: true,
      payload: {
        type: "TEXT",
        text: {
          fontName,
          fontSize: value.fontSize,
          lineHeight: { unit: "PIXELS", value: value.lineHeight },
          letterSpacing: { unit: "PIXELS", value: value.letterSpacing },
          textDecoration: figmaTextDecoration(value.textDecoration),
          textCase: figmaTextCase(value.textCase),
          paragraphIndent: value.paragraphIndent,
          paragraphSpacing: value.paragraphSpacing,
          listSpacing: value.listSpacing,
          hangingList: value.hangingList,
        },
      },
    };
  }
  if (style.styleType === "EFFECT") {
    const issues: string[] = [];
    const effects: Effect[] = [];
    style.effects.forEach((effect, index) => {
      if (effect.type === "layer-blur" || effect.type === "background-blur") {
        effects.push({
          type: effect.type === "layer-blur" ? "LAYER_BLUR" : "BACKGROUND_BLUR",
          blurType: "NORMAL",
          radius: effect.radius,
          visible: effect.visible ?? true,
        } satisfies BlurEffect);
        return;
      }
      if (effect.type === "drop-shadow" || effect.type === "inner-shadow") {
        const color = parseColor(effect.color);
        if (!color) {
          issues.push(
            `Effect ${index} color ${effect.color} is not a supported hex color`,
          );
          return;
        }
        effects.push({
          type: effect.type === "drop-shadow" ? "DROP_SHADOW" : "INNER_SHADOW",
          color: {
            r: color.r,
            g: color.g,
            b: color.b,
            a: color.a * effect.opacity,
          },
          offset: effect.offset,
          radius: effect.blur,
          spread: effect.spread,
          visible: effect.visible ?? true,
          blendMode: figmaBlendMode(effect.blendMode),
        } satisfies DropShadowEffect | InnerShadowEffect);
        return;
      }
      issues.push(
        `Effect ${index} type ${String(effect.type)} has no Figma Plugin API equivalent`,
      );
    });
    return issues.length > 0
      ? { ok: false, issues }
      : { ok: true, payload: { type: "EFFECT", effects } };
  }
  const layoutGrids: LayoutGrid[] = style.layoutGuides.map((guide) => {
    const color = parseColor(guide.color) ?? { r: 0, g: 0, b: 0, a: 1 };
    const shared = {
      visible: true,
      color: { ...color, a: color.a * guide.opacity },
    };
    if (guide.type === "grid") {
      return { pattern: "GRID", sectionSize: guide.size, ...shared };
    }
    return {
      pattern: guide.type === "columns" ? "COLUMNS" : "ROWS",
      alignment:
        guide.alignment === "start"
          ? "MIN"
          : guide.alignment === "end"
            ? "MAX"
            : guide.alignment.toUpperCase(),
      count: guide.count,
      gutterSize: guide.gutter,
      ...(guide.alignment === "stretch"
        ? { offset: guide.margin }
        : guide.alignment === "center"
          ? { sectionSize: guide.sectionSize }
          : { sectionSize: guide.sectionSize, offset: guide.offset }),
      ...shared,
    } as LayoutGrid;
  });
  return { ok: true, payload: { type: "GRID", layoutGrids } };
}

export function toFigmaFontName(value: {
  fontFamily: string;
  fontStyleName: string | null;
}): FontName | null {
  if (value.fontStyleName === null) return null;
  return {
    family: value.fontFamily,
    style: value.fontStyleName,
  };
}

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

function figmaTextDecoration(
  value: Extract<
    SharedStyleDefinition,
    { styleType: "TEXT" }
  >["textStyle"]["textDecoration"],
): TextDecoration {
  if (value === "underline") return "UNDERLINE";
  if (value === "strikethrough") return "STRIKETHROUGH";
  return "NONE";
}

function figmaTextCase(
  value: Extract<
    SharedStyleDefinition,
    { styleType: "TEXT" }
  >["textStyle"]["textCase"],
): TextCase {
  if (value === "uppercase") return "UPPER";
  if (value === "lowercase") return "LOWER";
  if (value === "title-case") return "TITLE";
  if (value === "small-caps") return "SMALL_CAPS";
  return "ORIGINAL";
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

function openDesignBlendMode(value: BlendMode | undefined) {
  if (!value || value === "NORMAL") return "normal" as const;
  return value.toLowerCase().replaceAll("_", "-") as Exclude<
    NonNullable<OpenDesignPaint["blendMode"]>,
    "pass-through"
  >;
}

function rgbHex(color: RGB): string {
  return `#${[color.r, color.g, color.b]
    .map((value) =>
      Math.round(Math.min(1, Math.max(0, value)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function utf16Boundary(content: string, index: number): boolean {
  if (index === 0 || index === content.length) return true;
  const before = content.charCodeAt(index - 1);
  const after = content.charCodeAt(index);
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}

function parseColor(
  value: string,
): { r: number; g: number; b: number; a: number } | null {
  const compact = value
    .trim()
    .match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (!compact) return null;
  const expanded =
    compact.length <= 4
      ? [...compact].map((character) => character.repeat(2)).join("")
      : compact;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16) / 255,
    g: Number.parseInt(expanded.slice(2, 4), 16) / 255,
    b: Number.parseInt(expanded.slice(4, 6), 16) / 255,
    a:
      expanded.length === 8
        ? Number.parseInt(expanded.slice(6, 8), 16) / 255
        : 1,
  };
}

function figmaBlendMode(value: string | undefined): BlendMode {
  if (!value || value === "pass-through") return "NORMAL";
  return value.replaceAll("-", "_").toUpperCase() as BlendMode;
}

export function toFigmaComponentPropertyDefinitions(
  component: ComponentDefinition,
): ComponentPropertyDefinitions {
  return structuredClone(component.componentPropertyDefinitions);
}

export function toFigmaVariantSetPropertyDefinitions(
  variantSet: VariantSetDefinition,
): ComponentPropertyDefinitions {
  return structuredClone(variantSet.componentPropertyDefinitions);
}

export function toFigmaVariantProperties(
  component: ComponentDefinition,
): NonNullable<ComponentNode["variantProperties"]> | null {
  return component.variantSetId
    ? structuredClone(component.variantProperties)
    : null;
}

export function toFigmaComponentProperties(
  document: DesignDocument,
  instanceId: string,
): ComponentProperties {
  const resolution = resolveComponentInstance(document, instanceId);
  if (!resolution.ok) {
    throw new Error(
      resolution.issues[0]?.message ??
        `Instance ${instanceId} cannot be converted to Figma properties`,
    );
  }
  const result: ComponentProperties = {};
  for (const [propertyName, property] of Object.entries(
    resolution.componentProperties,
  )) {
    result[propertyName] = {
      type: property.type,
      value: property.value,
      ...(property.preferredValues
        ? {
            preferredValues: property.preferredValues.map((preferred) => ({
              ...preferred,
            })),
          }
        : {}),
    };
  }
  return result;
}

export function toFigmaComponentPropertyReferences(
  node: DesignNode,
): NonNullable<SceneNode["componentPropertyReferences"]> | null {
  return node.componentPropertyReferences
    ? structuredClone(
        node.componentPropertyReferences satisfies OpenDesignComponentPropertyReferences,
      )
    : null;
}

export function toFigmaVariableCollection(
  collection: VariableCollectionDefinition,
): Pick<
  VariableCollection,
  | "id"
  | "key"
  | "name"
  | "hiddenFromPublishing"
  | "modes"
  | "variableIds"
  | "defaultModeId"
> {
  return {
    id: collection.id,
    key: collection.key,
    name: collection.name,
    hiddenFromPublishing: collection.hiddenFromPublishing,
    modes: structuredClone(collection.modes),
    variableIds: [...collection.variableIds],
    defaultModeId: collection.defaultModeId,
  };
}

export function toFigmaVariable(
  variable: VariableDefinition,
): Pick<
  Variable,
  | "id"
  | "key"
  | "name"
  | "description"
  | "hiddenFromPublishing"
  | "variableCollectionId"
  | "resolvedType"
  | "valuesByMode"
  | "scopes"
  | "codeSyntax"
> {
  return {
    id: variable.id,
    key: variable.key,
    name: variable.name,
    description: variable.description,
    hiddenFromPublishing: variable.hiddenFromPublishing,
    variableCollectionId: variable.variableCollectionId,
    resolvedType: variable.resolvedType,
    valuesByMode: structuredClone(variable.valuesByMode),
    scopes: [...variable.scopes],
    codeSyntax: structuredClone(variable.codeSyntax),
  };
}

export function toFigmaExplicitVariableModes(
  owner: Pick<DesignNode, "explicitVariableModes">,
): SceneNode["explicitVariableModes"] {
  return structuredClone(owner.explicitVariableModes ?? {});
}

export function toFigmaNodeBoundVariables(
  node: DesignNode,
): Partial<
  Record<"visible" | "opacity" | "characters", OpenDesignVariableAlias>
> {
  return structuredClone(node.boundVariables ?? {});
}
