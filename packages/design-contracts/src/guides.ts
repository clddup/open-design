import { Type, type Static } from "@sinclair/typebox";

export const GuideSchema = Type.Object(
  {
    axis: Type.Union([Type.Literal("X"), Type.Literal("Y")]),
    offset: Type.Number(),
  },
  { additionalProperties: false },
);

export const GuideCollectionSchema = Type.Array(GuideSchema, {
  maxItems: 4_096,
});

export type Guide = Static<typeof GuideSchema>;
