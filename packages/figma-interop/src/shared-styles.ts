import type {
  DesignNode,
  SharedStyleDefinition,
} from "@opendesign/design-contracts";
import {
  figmaBlendMode,
  figmaTextCase,
  figmaTextDecoration,
  parseColor,
  toFigmaFontName,
} from "./appearance-projection.js";

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
