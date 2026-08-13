import { Type, type Static } from "@sinclair/typebox";

export const CONSTRAINTS_DESIGN_SCHEMA_VERSION = "1.12.0" as const;

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
