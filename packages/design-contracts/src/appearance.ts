import { Type } from "@sinclair/typebox";
import { ImageFiltersSchema } from "./image-filters.js";
import { PointSchema } from "./primitives.js";
import { PaintBoundVariablesSchema } from "./variables.js";

export const BlendModeSchema = Type.Union([
  Type.Literal("pass-through"),
  Type.Literal("normal"),
  Type.Literal("multiply"),
  Type.Literal("screen"),
  Type.Literal("overlay"),
  Type.Literal("darken"),
  Type.Literal("lighten"),
  Type.Literal("color-dodge"),
  Type.Literal("color-burn"),
  Type.Literal("hard-light"),
  Type.Literal("soft-light"),
  Type.Literal("difference"),
  Type.Literal("exclusion"),
  Type.Literal("hue"),
  Type.Literal("saturation"),
  Type.Literal("color"),
  Type.Literal("luminosity"),
]);

const PaintBaseProperties = {
  opacity: Type.Number({ minimum: 0, maximum: 1 }),
  visible: Type.Optional(Type.Boolean()),
  blendMode: Type.Optional(BlendModeSchema),
};

export const SolidPaintSchema = Type.Object(
  {
    type: Type.Literal("solid"),
    color: Type.String({ minLength: 1 }),
    boundVariables: Type.Optional(PaintBoundVariablesSchema),
    ...PaintBaseProperties,
  },
  { additionalProperties: false },
);

export const GradientStopSchema = Type.Object(
  {
    offset: Type.Number({ minimum: 0, maximum: 1 }),
    color: Type.String({ minLength: 1 }),
    opacity: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

const GradientPaintProperties = {
  ...PaintBaseProperties,
  stops: Type.Array(GradientStopSchema, { minItems: 2 }),
  from: Type.Optional(PointSchema),
  to: Type.Optional(PointSchema),
  rotation: Type.Optional(Type.Number()),
  stretch: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
};

export const LinearGradientPaintSchema = Type.Object(
  { type: Type.Literal("linear-gradient"), ...GradientPaintProperties },
  { additionalProperties: false },
);
export const RadialGradientPaintSchema = Type.Object(
  { type: Type.Literal("radial-gradient"), ...GradientPaintProperties },
  { additionalProperties: false },
);
export const AngularGradientPaintSchema = Type.Object(
  { type: Type.Literal("angular-gradient"), ...GradientPaintProperties },
  { additionalProperties: false },
);
export const ImagePaintSchema = Type.Object(
  {
    type: Type.Literal("image"),
    assetId: Type.String({ minLength: 1 }),
    fit: Type.Union([
      Type.Literal("fill"),
      Type.Literal("contain"),
      Type.Literal("cover"),
      Type.Literal("tile"),
    ]),
    ...PaintBaseProperties,
    rotation: Type.Optional(Type.Number()),
    scale: Type.Optional(PointSchema),
    offset: Type.Optional(PointSchema),
    filters: Type.Optional(ImageFiltersSchema),
  },
  { additionalProperties: false },
);
export const PaintSchema = Type.Union([
  SolidPaintSchema,
  LinearGradientPaintSchema,
  RadialGradientPaintSchema,
  AngularGradientPaintSchema,
  ImagePaintSchema,
]);

const ShadowEffectProperties = {
  color: Type.String({ minLength: 1 }),
  opacity: Type.Number({ minimum: 0, maximum: 1 }),
  offset: PointSchema,
  blur: Type.Number({ minimum: 0 }),
  spread: Type.Number(),
  visible: Type.Optional(Type.Boolean()),
  blendMode: Type.Optional(BlendModeSchema),
};
export const DropShadowEffectSchema = Type.Object(
  { type: Type.Literal("drop-shadow"), ...ShadowEffectProperties },
  { additionalProperties: false },
);
export const InnerShadowEffectSchema = Type.Object(
  { type: Type.Literal("inner-shadow"), ...ShadowEffectProperties },
  { additionalProperties: false },
);

const GlowEffectProperties = {
  color: Type.String({ minLength: 1 }),
  opacity: Type.Number({ minimum: 0, maximum: 1 }),
  radius: Type.Number({ minimum: 0 }),
  spread: Type.Number(),
  visible: Type.Optional(Type.Boolean()),
  blendMode: Type.Optional(BlendModeSchema),
};
export const OuterGlowEffectSchema = Type.Object(
  { type: Type.Literal("outer-glow"), ...GlowEffectProperties },
  { additionalProperties: false },
);
export const InnerGlowEffectSchema = Type.Object(
  { type: Type.Literal("inner-glow"), ...GlowEffectProperties },
  { additionalProperties: false },
);

const BlurEffectProperties = {
  radius: Type.Number({ minimum: 0 }),
  visible: Type.Optional(Type.Boolean()),
};
export const LayerBlurEffectSchema = Type.Object(
  { type: Type.Literal("layer-blur"), ...BlurEffectProperties },
  { additionalProperties: false },
);
export const BackgroundBlurEffectSchema = Type.Object(
  { type: Type.Literal("background-blur"), ...BlurEffectProperties },
  { additionalProperties: false },
);
export const GrayscaleEffectSchema = Type.Object(
  {
    type: Type.Literal("grayscale"),
    amount: Type.Number({ minimum: 0, maximum: 1 }),
    visible: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const EffectSchema = Type.Union([
  DropShadowEffectSchema,
  InnerShadowEffectSchema,
  OuterGlowEffectSchema,
  InnerGlowEffectSchema,
  LayerBlurEffectSchema,
  BackgroundBlurEffectSchema,
  GrayscaleEffectSchema,
]);
