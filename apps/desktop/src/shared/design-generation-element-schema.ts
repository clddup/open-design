import {
  AngularGradientPaintSchema,
  BackgroundBlurEffectSchema,
  BlendModeSchema,
  DropShadowEffectSchema,
  InnerShadowEffectSchema,
  ImagePlacementSchema,
  LayerBlurEffectSchema,
  LayoutPositioningSchema,
  LayoutSizingSchema,
  LinearAutoLayoutSchema,
  LinearGradientPaintSchema,
  OuterGlowEffectSchema,
  RadialGradientPaintSchema,
  SolidPaintSchema,
  executableJsonSchema,
  Type,
  type Static,
} from "@opendesign/design-contracts";
import type { TObject, TUnion } from "@sinclair/typebox";
import {
  CLOSED,
  COORDINATE_SCHEMA,
  DIMENSION_SCHEMA,
  UNIT_SCHEMA,
  idSchema,
  localIdSchema,
  textSchema,
} from "./design-generation-schema-primitives";

const DESIGN_GENERATION_PAINT_SCHEMA = Type.Union([
  Type.Omit(SolidPaintSchema, ["boundVariables", "blendMode", "visible"]),
  Type.Omit(LinearGradientPaintSchema, ["blendMode", "visible"]),
  Type.Omit(RadialGradientPaintSchema, ["blendMode", "visible"]),
  Type.Omit(AngularGradientPaintSchema, ["blendMode", "visible"]),
]);

const DESIGN_GENERATION_EFFECT_SCHEMA = Type.Union([
  Type.Omit(DropShadowEffectSchema, ["blendMode", "visible"]),
  Type.Omit(InnerShadowEffectSchema, ["blendMode", "visible"]),
  Type.Omit(OuterGlowEffectSchema, ["blendMode", "visible"]),
  Type.Omit(LayerBlurEffectSchema, ["visible"]),
  Type.Omit(BackgroundBlurEffectSchema, ["visible"]),
]);

const SHAPE_APPEARANCE_PROPERTIES = {
  fills: Type.Array(DESIGN_GENERATION_PAINT_SCHEMA, { maxItems: 4 }),
  strokes: Type.Array(DESIGN_GENERATION_PAINT_SCHEMA, { maxItems: 4 }),
  strokeWidth: Type.Number({ minimum: 0, maximum: 10_000 }),
};

const ELEMENT_BASE_PROPERTIES = {
  id: idSchema(),
  name: idSchema(),
  parentId: idSchema(),
  x: COORDINATE_SCHEMA,
  y: COORDINATE_SCHEMA,
  width: DIMENSION_SCHEMA,
  height: DIMENSION_SCHEMA,
  opacity: Type.Optional(UNIT_SCHEMA),
  blendMode: Type.Optional(BlendModeSchema),
  effects: Type.Optional(
    Type.Array(DESIGN_GENERATION_EFFECT_SCHEMA, { maxItems: 4 }),
  ),
  layoutPositioning: Type.Optional(LayoutPositioningSchema),
  layoutSizing: Type.Optional(LayoutSizingSchema),
  ...SHAPE_APPEARANCE_PROPERTIES,
};

const MODEL_ELEMENT_BASE_PROPERTIES = {
  ...ELEMENT_BASE_PROPERTIES,
  id: localIdSchema(),
  parentId: Type.Optional({
    ...localIdSchema(),
    description:
      "Earlier call-local container ID. Omit for a top-level artboard child; Main binds the real artboard identity.",
  }),
  strokes: Type.Optional(SHAPE_APPEARANCE_PROPERTIES.strokes),
  strokeWidth: Type.Optional(SHAPE_APPEARANCE_PROPERTIES.strokeWidth),
};

function elementKinds<TBase extends typeof ELEMENT_BASE_PROPERTIES>(
  baseProperties: TBase,
) {
  const GROUP_ELEMENT_SCHEMA = Type.Object(
    {
      ...baseProperties,
      kind: Type.Literal("group"),
    },
    CLOSED,
  );

  const FRAME_ELEMENT_SCHEMA = Type.Object(
    {
      ...baseProperties,
      kind: Type.Literal("frame"),
      cornerRadius: Type.Optional(
        Type.Number({ minimum: 0, maximum: 100_000 }),
      ),
      clipsContent: Type.Optional(Type.Boolean()),
      autoLayout: Type.Optional(LinearAutoLayoutSchema),
    },
    CLOSED,
  );

  const RECTANGLE_ELEMENT_SCHEMA = Type.Object(
    {
      ...baseProperties,
      kind: Type.Literal("rectangle"),
      cornerRadius: Type.Optional(
        Type.Number({ minimum: 0, maximum: 100_000 }),
      ),
    },
    CLOSED,
  );

  const ELLIPSE_ELEMENT_SCHEMA = Type.Object(
    {
      ...baseProperties,
      kind: Type.Literal("ellipse"),
    },
    CLOSED,
  );

  const PATH_ELEMENT_SCHEMA = Type.Object(
    {
      ...baseProperties,
      kind: Type.Literal("path"),
      path: Type.String({
        minLength: 1,
        maxLength: 20_000,
        description:
          "Editable SVG path commands in node-local coordinates. width and height do not rescale these coordinates; keep the authored path inside the declared local bounds or provide the matching transform.",
      }),
    },
    CLOSED,
  );

  const TEXT_ELEMENT_SCHEMA = Type.Object(
    {
      ...baseProperties,
      kind: Type.Literal("text"),
      text: Type.Object(
        {
          content: Type.String({ minLength: 1, maxLength: 100_000 }),
          fontFamily: idSchema(4_096),
          fontStyleName: textSchema(512),
          fontWeight: Type.Integer({ minimum: 1, maximum: 1_000 }),
          fontSlant: Type.Union([
            Type.Literal("normal"),
            Type.Literal("italic"),
          ]),
          fontSize: DIMENSION_SCHEMA,
          lineHeight: DIMENSION_SCHEMA,
          letterSpacing: Type.Optional(Type.Number()),
          textResize: Type.Union([
            Type.Literal("auto-width"),
            Type.Literal("auto-height"),
            Type.Literal("fixed"),
          ]),
          align: Type.Optional(
            Type.Union([
              Type.Literal("left"),
              Type.Literal("center"),
              Type.Literal("right"),
              Type.Literal("justify"),
            ]),
          ),
        },
        CLOSED,
      ),
    },
    CLOSED,
  );

  const IMAGE_ELEMENT_SCHEMA = Type.Object(
    {
      ...baseProperties,
      kind: Type.Literal("image"),
      assetId: idSchema(),
      placement: Type.Optional(ImagePlacementSchema),
      altText: Type.Optional(Type.String({ maxLength: 2_000 })),
      cornerRadius: Type.Optional(
        Type.Number({ minimum: 0, maximum: 100_000 }),
      ),
    },
    CLOSED,
  );

  return Type.Union([
    GROUP_ELEMENT_SCHEMA,
    FRAME_ELEMENT_SCHEMA,
    RECTANGLE_ELEMENT_SCHEMA,
    ELLIPSE_ELEMENT_SCHEMA,
    PATH_ELEMENT_SCHEMA,
    TEXT_ELEMENT_SCHEMA,
    IMAGE_ELEMENT_SCHEMA,
  ]);
}

function executableElementSchema<TBranches extends TObject[]>(
  schema: TUnion<TBranches>,
): TUnion<TBranches> {
  const firstRequired = schema.anyOf[0]?.required ?? [];
  const required = firstRequired.filter((key) =>
    schema.anyOf.every((branch) => branch.required?.includes(key)),
  );
  const properties = Object.assign(
    {},
    ...schema.anyOf.map((branch) => branch.properties),
  ) as Record<string, unknown>;
  return executableJsonSchema({
    type: "object",
    description:
      "One editable document node. Author parents before children and omit parentId for an artboard child. Frames and Groups are containers; appearance and kind-specific properties follow their declared branch.",
    properties: {
      ...properties,
      kind: Type.Union(schema.anyOf.map((branch) => branch.properties.kind)),
    },
    required,
    additionalProperties: false,
    anyOf: schema.anyOf.map((branch) => ({
      type: "object",
      properties: {
        ...Object.fromEntries(
          Object.keys(branch.properties).map((key) => [key, {}]),
        ),
        kind: branch.properties.kind,
      },
      required: branch.required,
      additionalProperties: false,
    })),
  }) as unknown as TUnion<TBranches>;
}

export const DESIGN_GENERATION_ELEMENT_SCHEMA = executableElementSchema(
  elementKinds(MODEL_ELEMENT_BASE_PROPERTIES),
);
export const DESIGN_GENERATION_CANONICAL_ELEMENT_SCHEMA =
  executableElementSchema(elementKinds(ELEMENT_BASE_PROPERTIES));
export type DesignGenerationElementInput = Static<
  typeof DESIGN_GENERATION_CANONICAL_ELEMENT_SCHEMA
>;
