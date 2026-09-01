import {
  TextDecorationColorSchema,
  TextDecorationMetricSchema,
  TextDecorationSchema,
  TextDecorationStyleSchema,
  executableJsonSchema,
} from "@opendesign/design-contracts";

function nullable(schema: Record<string, unknown>) {
  return { anyOf: [schema, { type: "null" }] } as const;
}

export const DESIGN_MODEL_TEXT_DECORATION_PROPERTIES = {
  textDecoration: executableJsonSchema(TextDecorationSchema),
  textDecorationStyle: nullable(
    executableJsonSchema(TextDecorationStyleSchema),
  ),
  textDecorationOffset: nullable(
    executableJsonSchema(TextDecorationMetricSchema),
  ),
  textDecorationThickness: nullable(
    executableJsonSchema(TextDecorationMetricSchema),
  ),
  textDecorationColor: nullable(
    executableJsonSchema(TextDecorationColorSchema),
  ),
  textDecorationSkipInk: {
    anyOf: [{ type: "boolean" }, { type: "null" }],
  },
} as const;

export const DESIGN_MODEL_TEXT_DECORATION_KEYS = Object.keys(
  DESIGN_MODEL_TEXT_DECORATION_PROPERTIES,
) as (keyof typeof DESIGN_MODEL_TEXT_DECORATION_PROPERTIES)[];
