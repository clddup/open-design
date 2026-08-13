import { Type, type Static } from "@sinclair/typebox";

export const CONSTRAINTS_DESIGN_SCHEMA_VERSION = "1.12.0" as const;
export const AUTO_LAYOUT_DESIGN_SCHEMA_VERSION = "1.15.0" as const;

export const LayoutConstraintsSchema = Type.Object(
  {
    horizontal: Type.Union([
      Type.Literal("left"),
      Type.Literal("right"),
      Type.Literal("left-right"),
      Type.Literal("center"),
      Type.Literal("scale"),
    ]),
    vertical: Type.Union([
      Type.Literal("top"),
      Type.Literal("bottom"),
      Type.Literal("top-bottom"),
      Type.Literal("center"),
      Type.Literal("scale"),
    ]),
  },
  { additionalProperties: false },
);

export type LayoutConstraints = Static<typeof LayoutConstraintsSchema>;

const ChildLayoutAxisSizingSchema = Type.Union([
  Type.Literal("fixed"),
  Type.Literal("fill"),
]);

export const LayoutSizingSchema = Type.Object(
  {
    horizontal: ChildLayoutAxisSizingSchema,
    vertical: ChildLayoutAxisSizingSchema,
  },
  { additionalProperties: false },
);

export type LayoutSizing = Static<typeof LayoutSizingSchema>;
export const DEFAULT_LAYOUT_SIZING: LayoutSizing = Object.freeze({
  horizontal: "fixed",
  vertical: "fixed",
});

const AutoLayoutFrameAxisSizingSchema = Type.Union([
  Type.Literal("fixed"),
  Type.Literal("hug"),
]);

export const AutoLayoutFrameSizingSchema = Type.Object(
  {
    horizontal: AutoLayoutFrameAxisSizingSchema,
    vertical: AutoLayoutFrameAxisSizingSchema,
  },
  { additionalProperties: false },
);

export type AutoLayoutFrameSizing = Static<typeof AutoLayoutFrameSizingSchema>;
export const DEFAULT_AUTO_LAYOUT_FRAME_SIZING: AutoLayoutFrameSizing =
  Object.freeze({ horizontal: "fixed", vertical: "fixed" });

export const AutoLayoutPaddingSchema = Type.Object(
  {
    top: Type.Number({ minimum: 0, maximum: 1_000_000 }),
    right: Type.Number({ minimum: 0, maximum: 1_000_000 }),
    bottom: Type.Number({ minimum: 0, maximum: 1_000_000 }),
    left: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  },
  { additionalProperties: false },
);

const AutoLayoutAlignmentSchema = Type.Union([
  Type.Literal("start"),
  Type.Literal("center"),
  Type.Literal("end"),
]);

const AutoLayoutFlowProperties = {
  padding: AutoLayoutPaddingSchema,
  gap: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  primaryAlignment: AutoLayoutAlignmentSchema,
  counterAlignment: AutoLayoutAlignmentSchema,
  sizing: Type.Optional(AutoLayoutFrameSizingSchema),
};

export const AutoLayoutWrapSchema = Type.Object(
  {
    mode: Type.Literal("wrap"),
    counterGap: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  },
  { additionalProperties: false },
);

export type AutoLayoutWrap = Static<typeof AutoLayoutWrapSchema>;

export const AutoLayoutSchema = Type.Union([
  Type.Object(
    {
      mode: Type.Literal("none"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("horizontal"),
      ...AutoLayoutFlowProperties,
      wrap: Type.Optional(AutoLayoutWrapSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("vertical"),
      ...AutoLayoutFlowProperties,
    },
    { additionalProperties: false },
  ),
]);

export type AutoLayout = Static<typeof AutoLayoutSchema>;
export type AutoLayoutFlow = Exclude<AutoLayout, { mode: "none" }>;
