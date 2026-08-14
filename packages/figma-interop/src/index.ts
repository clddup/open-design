import { resolveComponentInstance } from "@opendesign/component-service";
import type {
  ComponentDefinition,
  ComponentPropertyReferences as OpenDesignComponentPropertyReferences,
  DesignDocument,
  DesignNode,
  SharedStyleDefinition,
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
    return {
      ok: true,
      payload: {
        type: "TEXT",
        text: {
          fontName: {
            family: value.fontFamily,
            style: fontWeightName(value.fontWeight),
          },
          fontSize: value.fontSize,
          lineHeight: { unit: "PIXELS", value: value.lineHeight },
          letterSpacing: { unit: "PIXELS", value: value.letterSpacing },
          textDecoration: figmaTextDecoration(value.textDecoration),
          textCase: figmaTextCase(value.textCase),
          paragraphIndent: value.paragraphIndent,
          paragraphSpacing: value.paragraphSpacing,
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

function fontWeightName(weight: number): string {
  if (weight <= 100) return "Thin";
  if (weight <= 200) return "Extra Light";
  if (weight <= 300) return "Light";
  if (weight <= 400) return "Regular";
  if (weight <= 500) return "Medium";
  if (weight <= 600) return "Semi Bold";
  if (weight <= 700) return "Bold";
  if (weight <= 800) return "Extra Bold";
  return "Black";
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
