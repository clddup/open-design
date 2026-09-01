import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { JsonObjectSchema } from "./primitives.js";

export const SharedStyleTypeSchema = Type.Union([
  Type.Literal("PAINT"),
  Type.Literal("TEXT"),
  Type.Literal("EFFECT"),
  Type.Literal("GRID"),
]);

export const FontSlantSchema = Type.Union([
  Type.Literal("normal"),
  Type.Literal("italic"),
]);

export const FontFaceIdentityProperties = {
  fontFamily: Type.String({ minLength: 1, maxLength: 4_096 }),
  fontStyleName: Type.Union([
    Type.String({ minLength: 1, maxLength: 512 }),
    Type.Null(),
  ]),
  fontWeight: Type.Integer({ minimum: 1, maximum: 1_000 }),
  fontSlant: FontSlantSchema,
};

export const FontFaceIdentitySchema = Type.Object(FontFaceIdentityProperties, {
  additionalProperties: false,
});

export type FontSlant = Static<typeof FontSlantSchema>;
export type FontFaceIdentity = Static<typeof FontFaceIdentitySchema>;

export const TextStylePropertiesSchema = Type.Object(
  {
    ...FontFaceIdentityProperties,
    fontSize: Type.Number({ exclusiveMinimum: 0 }),
    lineHeight: Type.Number({ exclusiveMinimum: 0 }),
    letterSpacing: Type.Number(),
    paragraphIndent: Type.Number({ minimum: 0 }),
    paragraphSpacing: Type.Number({ minimum: 0 }),
    listSpacing: Type.Number({ minimum: 0 }),
    hangingList: Type.Boolean(),
    textCase: Type.Union([
      Type.Literal("original"),
      Type.Literal("uppercase"),
      Type.Literal("lowercase"),
      Type.Literal("title-case"),
      Type.Literal("small-caps"),
    ]),
    textDecoration: Type.Union([
      Type.Literal("none"),
      Type.Literal("underline"),
      Type.Literal("strikethrough"),
    ]),
  },
  { additionalProperties: false },
);

export const NodeStyleReferenceProperties = {
  fillStyleId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  strokeStyleId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  effectStyleId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  textStyleId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  gridStyleId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
};

const SharedStyleBaseProperties = {
  id: Type.String({ minLength: 1, maxLength: 256 }),
  key: Type.String({ minLength: 1, maxLength: 256 }),
  name: Type.String({ minLength: 1, maxLength: 512 }),
  description: Type.String({ maxLength: 2_000 }),
  hiddenFromPublishing: Type.Boolean(),
  extensions: JsonObjectSchema,
};

export function createSharedStyleSchemas<
  TPaintSchema extends TSchema,
  TEffectSchema extends TSchema,
  TLayoutGuideSchema extends TSchema,
>(input: {
  paintSchema: TPaintSchema;
  effectSchema: TEffectSchema;
  layoutGuideSchema: TLayoutGuideSchema;
}) {
  const PaintStyleDefinitionSchema = Type.Object(
    {
      ...SharedStyleBaseProperties,
      styleType: Type.Literal("PAINT"),
      paints: Type.Array(input.paintSchema, { maxItems: 4_096 }),
    },
    { additionalProperties: false },
  );
  const TextStyleDefinitionSchema = Type.Object(
    {
      ...SharedStyleBaseProperties,
      styleType: Type.Literal("TEXT"),
      textStyle: TextStylePropertiesSchema,
    },
    { additionalProperties: false },
  );
  const EffectStyleDefinitionSchema = Type.Object(
    {
      ...SharedStyleBaseProperties,
      styleType: Type.Literal("EFFECT"),
      effects: Type.Array(input.effectSchema, { maxItems: 4_096 }),
    },
    { additionalProperties: false },
  );
  const GridStyleDefinitionSchema = Type.Object(
    {
      ...SharedStyleBaseProperties,
      styleType: Type.Literal("GRID"),
      layoutGuides: Type.Array(input.layoutGuideSchema, { maxItems: 8 }),
    },
    { additionalProperties: false },
  );
  const SharedStyleDefinitionSchema = Type.Union([
    PaintStyleDefinitionSchema,
    TextStyleDefinitionSchema,
    EffectStyleDefinitionSchema,
    GridStyleDefinitionSchema,
  ]);
  const styleId = Type.String({ minLength: 1, maxLength: 256 });
  const styleOrder = Type.Array(styleId, {
    maxItems: 10_000,
    uniqueItems: true,
  });
  const StyleOrderByTypeSchema = Type.Object(
    {
      PAINT: styleOrder,
      TEXT: styleOrder,
      EFFECT: styleOrder,
      GRID: styleOrder,
    },
    { additionalProperties: false },
  );
  const StyleReferenceFieldSchema = Type.Union([
    Type.Literal("fillStyleId"),
    Type.Literal("strokeStyleId"),
    Type.Literal("effectStyleId"),
    Type.Literal("textStyleId"),
    Type.Literal("gridStyleId"),
  ]);
  const NodeStyleReferenceTargetSchema = Type.Object(
    {
      nodeId: styleId,
      field: StyleReferenceFieldSchema,
    },
    { additionalProperties: false },
  );
  const VectorRegionStyleReferenceTargetSchema = Type.Object(
    {
      nodeId: styleId,
      regionId: styleId,
      field: Type.Literal("fillStyleId"),
    },
    { additionalProperties: false },
  );
  const StyleReferenceTargetSchema = Type.Union([
    NodeStyleReferenceTargetSchema,
    VectorRegionStyleReferenceTargetSchema,
  ]);
  const operationBase = { commandId: Type.String({ minLength: 1 }) };
  const PutStyleCommandSchema = Type.Object(
    {
      ...operationBase,
      type: Type.Literal("put_style"),
      style: SharedStyleDefinitionSchema,
    },
    { additionalProperties: false },
  );
  const DeleteStyleCommandSchema = Type.Object(
    {
      ...operationBase,
      type: Type.Literal("delete_style"),
      styleId,
    },
    { additionalProperties: false },
  );
  const MoveStyleCommandSchema = Type.Object(
    {
      ...operationBase,
      type: Type.Literal("move_style"),
      styleId,
      styleType: SharedStyleTypeSchema,
      index: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  );
  const SetStyleReferenceCommandSchema = Type.Object(
    {
      ...operationBase,
      type: Type.Literal("set_style_reference"),
      target: StyleReferenceTargetSchema,
      styleId: Type.Union([styleId, Type.Null()]),
    },
    { additionalProperties: false },
  );
  type SharedStyleChangeValue = {
    type: "added" | "updated" | "moved" | "removed";
    styleId: string;
    before?: Static<typeof SharedStyleDefinitionSchema>;
    after?: Static<typeof SharedStyleDefinitionSchema>;
    changedFields: string[];
  };
  const SharedStyleChangeSchema: TSchema & {
    static: SharedStyleChangeValue;
  } = Type.Object(
    {
      type: Type.Union([
        Type.Literal("added"),
        Type.Literal("updated"),
        Type.Literal("moved"),
        Type.Literal("removed"),
      ]),
      styleId,
      before: Type.Optional(SharedStyleDefinitionSchema),
      after: Type.Optional(SharedStyleDefinitionSchema),
      changedFields: Type.Array(Type.String(), { uniqueItems: true }),
    },
    { additionalProperties: false },
  );
  return {
    PaintStyleDefinitionSchema,
    TextStyleDefinitionSchema,
    EffectStyleDefinitionSchema,
    GridStyleDefinitionSchema,
    SharedStyleDefinitionSchema,
    StyleOrderByTypeSchema,
    StyleReferenceFieldSchema,
    StyleReferenceTargetSchema,
    PutStyleCommandSchema,
    DeleteStyleCommandSchema,
    MoveStyleCommandSchema,
    SetStyleReferenceCommandSchema,
    SharedStyleChangeSchema,
  } as const;
}

export function migrateSharedStyles(document: Record<string, unknown>): void {
  document.styleOrderByType ??= {
    PAINT: [],
    TEXT: [],
    EFFECT: [],
    GRID: [],
  };
  document.stylesById ??= {};
  const stylesById = document.stylesById;
  if (
    !stylesById ||
    typeof stylesById !== "object" ||
    Array.isArray(stylesById)
  ) {
    return;
  }
  for (const value of Object.values(stylesById)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const style = value as Record<string, unknown>;
    if (style.styleType !== "TEXT") continue;
    const textStyle = style.textStyle;
    if (!textStyle || typeof textStyle !== "object" || Array.isArray(textStyle))
      continue;
    const properties = textStyle as Record<string, unknown>;
    properties.fontStyleName ??= null;
    properties.fontSlant ??= "normal";
    properties.paragraphIndent ??= 0;
    properties.paragraphSpacing ??= 0;
    properties.listSpacing ??= 0;
    properties.hangingList ??= false;
    properties.textCase ??= "original";
    properties.textDecoration ??= "none";
  }
}
