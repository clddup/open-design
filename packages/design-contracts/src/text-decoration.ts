import { Type, type Static } from "@sinclair/typebox";
import { SolidPaintSchema } from "./appearance.js";

export const TextDecorationSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("underline"),
  Type.Literal("strikethrough"),
]);

export const TextDecorationStyleSchema = Type.Union([
  Type.Literal("solid"),
  Type.Literal("wavy"),
  Type.Literal("dotted"),
]);

export const TextDecorationMetricSchema = Type.Union([
  Type.Object({ unit: Type.Literal("auto") }, { additionalProperties: false }),
  Type.Object(
    {
      unit: Type.Union([Type.Literal("pixels"), Type.Literal("percent")]),
      value: Type.Number(),
    },
    { additionalProperties: false },
  ),
]);

export const TextDecorationColorSchema = Type.Union([
  Type.Object({ value: Type.Literal("auto") }, { additionalProperties: false }),
  Type.Object({ value: SolidPaintSchema }, { additionalProperties: false }),
]);

export const TextDecorationAdvancedProperties = {
  textDecorationStyle: Type.Union([TextDecorationStyleSchema, Type.Null()]),
  textDecorationOffset: Type.Union([TextDecorationMetricSchema, Type.Null()]),
  textDecorationThickness: Type.Union([
    TextDecorationMetricSchema,
    Type.Null(),
  ]),
  textDecorationColor: Type.Union([TextDecorationColorSchema, Type.Null()]),
  textDecorationSkipInk: Type.Union([Type.Boolean(), Type.Null()]),
};

export type TextDecoration = Static<typeof TextDecorationSchema>;
export type TextDecorationStyle = Static<typeof TextDecorationStyleSchema>;
export type TextDecorationMetric = Static<typeof TextDecorationMetricSchema>;
export type TextDecorationColor = Static<typeof TextDecorationColorSchema>;

export function defaultAdvancedTextDecoration(decoration: TextDecoration): {
  textDecorationStyle: TextDecorationStyle | null;
  textDecorationOffset: TextDecorationMetric | null;
  textDecorationThickness: TextDecorationMetric | null;
  textDecorationColor: TextDecorationColor | null;
  textDecorationSkipInk: boolean | null;
} {
  return decoration === "underline"
    ? {
        textDecorationStyle: "solid",
        textDecorationOffset: { unit: "auto" },
        textDecorationThickness: { unit: "auto" },
        textDecorationColor: { value: "auto" },
        textDecorationSkipInk: false,
      }
    : {
        textDecorationStyle: null,
        textDecorationOffset: null,
        textDecorationThickness: null,
        textDecorationColor: null,
        textDecorationSkipInk: null,
      };
}

export function migrateAdvancedTextDecoration(
  value: Record<string, unknown>,
  force = false,
): void {
  const decoration =
    value.textDecoration === "underline"
      ? "underline"
      : value.textDecoration === "strikethrough"
        ? "strikethrough"
        : "none";
  const defaults = defaultAdvancedTextDecoration(decoration);
  for (const [key, fallback] of Object.entries(defaults)) {
    if (force || !(key in value)) value[key] = fallback;
  }
}

export function advancedTextDecorationIssue(value: {
  textDecoration: TextDecoration;
  textDecorationStyle: TextDecorationStyle | null;
  textDecorationOffset: TextDecorationMetric | null;
  textDecorationThickness: TextDecorationMetric | null;
  textDecorationColor: TextDecorationColor | null;
  textDecorationSkipInk: boolean | null;
}): { field: keyof typeof value; message: string } | null {
  const advanced = [
    ["textDecorationStyle", value.textDecorationStyle],
    ["textDecorationOffset", value.textDecorationOffset],
    ["textDecorationThickness", value.textDecorationThickness],
    ["textDecorationColor", value.textDecorationColor],
    ["textDecorationSkipInk", value.textDecorationSkipInk],
  ] as const;
  if (value.textDecoration !== "underline") {
    const invalid = advanced.find(([, entry]) => entry !== null);
    return invalid
      ? {
          field: invalid[0],
          message: "Advanced text decoration fields require underline",
        }
      : null;
  }
  const missing = advanced.find(([, entry]) => entry === null);
  return missing
    ? {
        field: missing[0],
        message: "Underline requires complete advanced text decoration fields",
      }
    : null;
}
