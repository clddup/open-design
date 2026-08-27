import { Type, type TSchema } from "@sinclair/typebox";

interface ComponentSchemaDependencies {
  blendModeSchema: TSchema;
  effectSchema: TSchema;
  maskModeSchema: TSchema;
  jsonObjectSchema: TSchema;
  componentPropertyAssignmentsSchema: TSchema;
  componentPropertyDefinitionsSchema: TSchema;
  variantPropertiesSchema: TSchema;
}

export function createComponentSchemas<
  const TDependencies extends ComponentSchemaDependencies,
>(dependencies: TDependencies) {
  const blendModeSchema = dependency(dependencies, "blendModeSchema");
  const effectSchema = dependency(dependencies, "effectSchema");
  const maskModeSchema = dependency(dependencies, "maskModeSchema");
  const jsonObjectSchema = dependency(dependencies, "jsonObjectSchema");
  const componentPropertyAssignmentsSchema = dependency(
    dependencies,
    "componentPropertyAssignmentsSchema",
  );
  const componentPropertyDefinitionsSchema = dependency(
    dependencies,
    "componentPropertyDefinitionsSchema",
  );
  const variantPropertiesSchema = dependency(
    dependencies,
    "variantPropertiesSchema",
  );
  const ComponentOverridePatchSchema = Type.Object(
    {
      name: Type.Optional(Type.String()),
      visible: Type.Optional(Type.Boolean()),
      locked: Type.Optional(Type.Boolean()),
      opacity: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      blendMode: Type.Optional(blendModeSchema),
      effects: Type.Optional(Type.Array(effectSchema)),
      maskMode: Type.Optional(maskModeSchema),
      properties: Type.Optional(jsonObjectSchema),
    },
    { additionalProperties: false },
  );
  const ComponentOverrideSchema = Type.Object(
    {
      sourcePath: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: 64,
      }),
      patch: ComponentOverridePatchSchema,
    },
    { additionalProperties: false },
  );
  const InstancePropertiesSchema = Type.Object(
    {
      componentId: Type.String({ minLength: 1 }),
      componentProperties: componentPropertyAssignmentsSchema,
      overrides: Type.Array(ComponentOverrideSchema, { maxItems: 4_096 }),
    },
    { additionalProperties: false },
  );
  const ComponentDefinitionSchema = Type.Object(
    {
      id: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1, maxLength: 256 }),
      rootNodeId: Type.String({ minLength: 1 }),
      description: Type.Optional(Type.String({ maxLength: 2_000 })),
      componentPropertyOrder: Type.Array(
        Type.String({ minLength: 1, maxLength: 512 }),
        { maxItems: 4_096, uniqueItems: true },
      ),
      componentPropertyDefinitions: componentPropertyDefinitionsSchema,
      variantSetId: Type.Optional(
        Type.String({ minLength: 1, maxLength: 256 }),
      ),
      variantProperties: variantPropertiesSchema,
      extensions: jsonObjectSchema,
    },
    { additionalProperties: false },
  );
  return {
    ComponentOverridePatchSchema,
    ComponentOverrideSchema,
    InstancePropertiesSchema,
    ComponentDefinitionSchema,
  };
}

function dependency<T extends object, TKey extends keyof T>(
  dependencies: T,
  key: TKey,
): T[TKey] {
  return dependencies[key];
}
