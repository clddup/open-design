import { Type, type Static } from "@sinclair/typebox";

export const CONSTRAINTS_DESIGN_SCHEMA_VERSION = "1.12.0" as const;
export const AUTO_LAYOUT_DESIGN_SCHEMA_VERSION = "1.13.0" as const;

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
};

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
