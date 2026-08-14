import { Type, type Static } from "@sinclair/typebox";

export const ComponentPropertyTypeSchema = Type.Union([
  Type.Literal("BOOLEAN"),
  Type.Literal("TEXT"),
  Type.Literal("INSTANCE_SWAP"),
  Type.Literal("SLOT"),
]);

export const SlotSettingsSchema = Type.Object(
  {
    stretchChildOnInsert: Type.Optional(Type.Boolean()),
    displayEmptyByDefault: Type.Optional(Type.Boolean()),
    minChildren: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 4_096 }), Type.Null()]),
    ),
    maxChildren: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 4_096 }), Type.Null()]),
    ),
    allowPreferredValuesOnly: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const InstanceSwapPreferredValueSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal("COMPONENT"),
      Type.Literal("COMPONENT_SET"),
    ]),
    key: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const ComponentPropertyDefinitionSchema = Type.Union([
  Type.Object(
    { type: Type.Literal("BOOLEAN"), defaultValue: Type.Boolean() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("TEXT"),
      defaultValue: Type.String({ maxLength: 100_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("INSTANCE_SWAP"),
      defaultValue: Type.String({ minLength: 1, maxLength: 256 }),
      preferredValues: Type.Optional(
        Type.Array(InstanceSwapPreferredValueSchema, { maxItems: 1_024 }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("SLOT"),
      defaultValue: Type.String({ minLength: 1, maxLength: 256 }),
      preferredValues: Type.Optional(
        Type.Array(InstanceSwapPreferredValueSchema, { maxItems: 1_024 }),
      ),
      description: Type.Optional(Type.String({ maxLength: 2_000 })),
      slotSettings: Type.Optional(SlotSettingsSchema),
    },
    { additionalProperties: false },
  ),
]);

export const ComponentPropertyDefinitionsSchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 512 }),
  ComponentPropertyDefinitionSchema,
  { maxProperties: 4_096 },
);

export const ComponentPropertyAssignmentSchema = Type.Union([
  Type.String({ maxLength: 100_000 }),
  Type.Boolean(),
]);

export const ComponentPropertyAssignmentsSchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 512 }),
  ComponentPropertyAssignmentSchema,
  { maxProperties: 4_096 },
);

export const ComponentPropertyReferencesSchema = Type.Object(
  {
    visible: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    characters: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    mainComponent: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false, minProperties: 1 },
);

export type ComponentPropertyType = Static<typeof ComponentPropertyTypeSchema>;
export type SlotSettings = Static<typeof SlotSettingsSchema>;
export type InstanceSwapPreferredValue = Static<
  typeof InstanceSwapPreferredValueSchema
>;
export type ComponentPropertyDefinition = Static<
  typeof ComponentPropertyDefinitionSchema
>;
export type ComponentPropertyDefinitions = Static<
  typeof ComponentPropertyDefinitionsSchema
>;
export type ComponentPropertyAssignment = Static<
  typeof ComponentPropertyAssignmentSchema
>;
export type ComponentPropertyAssignments = Static<
  typeof ComponentPropertyAssignmentsSchema
>;
export type ComponentPropertyReferences = Static<
  typeof ComponentPropertyReferencesSchema
>;

export function migrateFigmaComponentProperties(
  document: Record<string, unknown>,
): void {
  const components = document.componentsById;
  if (
    components &&
    typeof components === "object" &&
    !Array.isArray(components)
  ) {
    for (const value of Object.values(components)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      (value as Record<string, unknown>).componentPropertyDefinitions ??= {};
    }
  }
  const nodes = document.nodesById;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return;
  for (const value of Object.values(nodes)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (node.kind !== "instance") continue;
    const properties = node.properties;
    if (
      !properties ||
      typeof properties !== "object" ||
      Array.isArray(properties)
    ) {
      continue;
    }
    (properties as Record<string, unknown>).componentProperties ??= {};
  }
}
