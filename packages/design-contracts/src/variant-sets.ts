import { Type, type Static } from "@sinclair/typebox";
import { JsonObjectSchema } from "./primitives.js";

export const VariantPropertyDefinitionSchema = Type.Object(
  {
    type: Type.Literal("VARIANT"),
    defaultValue: Type.String({ minLength: 1, maxLength: 256 }),
    variantOptions: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      minItems: 1,
      maxItems: 1_024,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export const VariantPropertyDefinitionsSchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 256 }),
  VariantPropertyDefinitionSchema,
  { minProperties: 1, maxProperties: 128 },
);

export const VariantPropertiesSchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 256 }),
  Type.String({ minLength: 1, maxLength: 256 }),
  { maxProperties: 128 },
);

export const VariantSetDefinitionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    rootNodeId: Type.String({ minLength: 1, maxLength: 256 }),
    defaultComponentId: Type.String({ minLength: 1, maxLength: 256 }),
    componentPropertyDefinitions: VariantPropertyDefinitionsSchema,
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    extensions: JsonObjectSchema,
  },
  { additionalProperties: false },
);

export const PutVariantSetCommandSchema = Type.Object(
  {
    commandId: Type.String({ minLength: 1 }),
    type: Type.Literal("put_variant_set"),
    variantSet: VariantSetDefinitionSchema,
  },
  { additionalProperties: false },
);

export const DeleteVariantSetCommandSchema = Type.Object(
  {
    commandId: Type.String({ minLength: 1 }),
    type: Type.Literal("delete_variant_set"),
    variantSetId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const VariantSetChangeSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal("added"),
      Type.Literal("updated"),
      Type.Literal("removed"),
    ]),
    variantSetId: Type.String({ minLength: 1 }),
    before: Type.Optional(VariantSetDefinitionSchema),
    after: Type.Optional(VariantSetDefinitionSchema),
    changedFields: Type.Array(Type.String(), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

export type VariantPropertyDefinition = Static<
  typeof VariantPropertyDefinitionSchema
>;
export type VariantPropertyDefinitions = Static<
  typeof VariantPropertyDefinitionsSchema
>;
export type VariantProperties = Static<typeof VariantPropertiesSchema>;
export type VariantSetDefinition = Static<typeof VariantSetDefinitionSchema>;
export type PutVariantSetCommand = Static<typeof PutVariantSetCommandSchema>;
export type DeleteVariantSetCommand = Static<
  typeof DeleteVariantSetCommandSchema
>;
export type VariantSetChange = Static<typeof VariantSetChangeSchema>;

export function migrateVariantSets(document: Record<string, unknown>): void {
  const components = document.componentsById;
  if (
    !components ||
    typeof components !== "object" ||
    Array.isArray(components)
  ) {
    return;
  }
  for (const value of Object.values(components)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    (value as Record<string, unknown>).variantProperties ??= {};
  }
}
