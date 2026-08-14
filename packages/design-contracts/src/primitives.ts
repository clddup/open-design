import { Type, type Static } from "@sinclair/typebox";

export const JsonValueSchema = Type.Recursive((Self) =>
  Type.Union([
    Type.String(),
    Type.Number(),
    Type.Boolean(),
    Type.Null(),
    Type.Array(Self),
    Type.Record(Type.String(), Self),
  ]),
);
export const JsonObjectSchema = Type.Record(Type.String(), JsonValueSchema);

export const TransformSchema = Type.Tuple([
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
]);
export const SizeSchema = Type.Object(
  {
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const PointSchema = Type.Object(
  { x: Type.Number(), y: Type.Number() },
  { additionalProperties: false },
);
export const NormalizedPointSchema = Type.Object(
  {
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

export type JsonValue = Static<typeof JsonValueSchema>;
export type JsonObject = Static<typeof JsonObjectSchema>;
export type Transform = Static<typeof TransformSchema>;
export type Size = Static<typeof SizeSchema>;
export type Point = Static<typeof PointSchema>;
export type NormalizedPoint = Static<typeof NormalizedPointSchema>;
