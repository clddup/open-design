import { Type, type Static } from "@sinclair/typebox";
import { JsonObjectSchema } from "./primitives.js";

export const VariableResolvedDataTypeSchema = Type.Union([
  Type.Literal("BOOLEAN"),
  Type.Literal("COLOR"),
  Type.Literal("EASING"),
  Type.Literal("FLOAT"),
  Type.Literal("STRING"),
  Type.Literal("TIMING"),
]);

export const VariableAliasSchema = Type.Object(
  {
    type: Type.Literal("VARIABLE_ALIAS"),
    id: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

const VariableRgbValueSchema = Type.Object(
  {
    r: Type.Number({ minimum: 0, maximum: 1 }),
    g: Type.Number({ minimum: 0, maximum: 1 }),
    b: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

const VariableRgbaValueSchema = Type.Object(
  {
    r: Type.Number({ minimum: 0, maximum: 1 }),
    g: Type.Number({ minimum: 0, maximum: 1 }),
    b: Type.Number({ minimum: 0, maximum: 1 }),
    a: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

export const VariableColorValueSchema = Type.Union([
  VariableRgbValueSchema,
  VariableRgbaValueSchema,
]);

const SimpleEasingTypeSchema = Type.Union([
  Type.Literal("EASE_IN"),
  Type.Literal("EASE_OUT"),
  Type.Literal("EASE_IN_AND_OUT"),
  Type.Literal("LINEAR"),
  Type.Literal("EASE_IN_BACK"),
  Type.Literal("EASE_OUT_BACK"),
  Type.Literal("EASE_IN_AND_OUT_BACK"),
  Type.Literal("GENTLE"),
  Type.Literal("QUICK"),
  Type.Literal("BOUNCY"),
  Type.Literal("SLOW"),
  Type.Literal("HOLD"),
]);

export const VariableEasingValueSchema = Type.Union([
  Type.Object(
    { type: SimpleEasingTypeSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("CUSTOM_CUBIC_BEZIER"),
      easingFunctionCubicBezier: Type.Object(
        {
          x1: Type.Number(),
          y1: Type.Number(),
          x2: Type.Number(),
          y2: Type.Number(),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("CUSTOM_SPRING"),
      easingFunctionSpring: Type.Object(
        { bounce: Type.Number({ minimum: 0, maximum: 1 }) },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);

export const VariableValueSchema = Type.Union([
  Type.Boolean(),
  Type.String({ maxLength: 100_000 }),
  Type.Number(),
  VariableColorValueSchema,
  VariableEasingValueSchema,
  VariableAliasSchema,
]);

export const VariableScopeSchema = Type.Union([
  Type.Literal("ALL_SCOPES"),
  Type.Literal("TEXT_CONTENT"),
  Type.Literal("CORNER_RADIUS"),
  Type.Literal("WIDTH_HEIGHT"),
  Type.Literal("GAP"),
  Type.Literal("ALL_FILLS"),
  Type.Literal("FRAME_FILL"),
  Type.Literal("SHAPE_FILL"),
  Type.Literal("TEXT_FILL"),
  Type.Literal("STROKE_COLOR"),
  Type.Literal("STROKE_FLOAT"),
  Type.Literal("EFFECT_FLOAT"),
  Type.Literal("EFFECT_COLOR"),
  Type.Literal("OPACITY"),
  Type.Literal("FONT_FAMILY"),
  Type.Literal("FONT_STYLE"),
  Type.Literal("FONT_WEIGHT"),
  Type.Literal("FONT_SIZE"),
  Type.Literal("LINE_HEIGHT"),
  Type.Literal("LETTER_SPACING"),
  Type.Literal("PARAGRAPH_SPACING"),
  Type.Literal("PARAGRAPH_INDENT"),
]);

export const VariableModeSchema = Type.Object(
  {
    modeId: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const VariableCollectionDefinitionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    key: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    hiddenFromPublishing: Type.Boolean(),
    modes: Type.Array(VariableModeSchema, { minItems: 1, maxItems: 128 }),
    variableIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      maxItems: 5_000,
      uniqueItems: true,
    }),
    defaultModeId: Type.String({ minLength: 1, maxLength: 256 }),
    extensions: JsonObjectSchema,
  },
  { additionalProperties: false },
);

export const VariableDefinitionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    key: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 512 }),
    description: Type.String({ maxLength: 2_000 }),
    hiddenFromPublishing: Type.Boolean(),
    variableCollectionId: Type.String({ minLength: 1, maxLength: 256 }),
    resolvedType: VariableResolvedDataTypeSchema,
    valuesByMode: Type.Record(
      Type.String({ minLength: 1, maxLength: 256 }),
      VariableValueSchema,
      { minProperties: 1, maxProperties: 128 },
    ),
    scopes: Type.Array(VariableScopeSchema, {
      maxItems: 32,
      uniqueItems: true,
    }),
    codeSyntax: Type.Object(
      {
        WEB: Type.Optional(Type.String({ maxLength: 512 })),
        ANDROID: Type.Optional(Type.String({ maxLength: 512 })),
        iOS: Type.Optional(Type.String({ maxLength: 512 })),
      },
      { additionalProperties: false },
    ),
    extensions: JsonObjectSchema,
  },
  { additionalProperties: false },
);

export const VariableDocumentProperties = {
  variableCollectionOrder: Type.Array(Type.String({ minLength: 1 }), {
    uniqueItems: true,
  }),
  variableCollectionsById: Type.Record(
    Type.String(),
    VariableCollectionDefinitionSchema,
  ),
  variablesById: Type.Record(Type.String(), VariableDefinitionSchema),
};

export const ExplicitVariableModesSchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 256 }),
  Type.String({ minLength: 1, maxLength: 256 }),
  { maxProperties: 1_024 },
);

export const NodeBoundVariablesSchema = Type.Object(
  {
    visible: Type.Optional(VariableAliasSchema),
    opacity: Type.Optional(VariableAliasSchema),
    characters: Type.Optional(VariableAliasSchema),
  },
  { additionalProperties: false },
);

export const PaintBoundVariablesSchema = Type.Object(
  { color: Type.Optional(VariableAliasSchema) },
  { additionalProperties: false },
);

export const VariableBindingTargetSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("node"),
      nodeId: Type.String({ minLength: 1, maxLength: 256 }),
      field: Type.Union([
        Type.Literal("visible"),
        Type.Literal("opacity"),
        Type.Literal("characters"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("paint"),
      nodeId: Type.String({ minLength: 1, maxLength: 256 }),
      paintField: Type.Union([Type.Literal("fills"), Type.Literal("strokes")]),
      paintIndex: Type.Integer({ minimum: 0, maximum: 4_095 }),
      field: Type.Literal("color"),
    },
    { additionalProperties: false },
  ),
]);

const VariableOperationBaseProperties = {
  commandId: Type.String({ minLength: 1 }),
};

export const PutVariableCollectionCommandSchema = Type.Object(
  {
    ...VariableOperationBaseProperties,
    type: Type.Literal("put_variable_collection"),
    collection: VariableCollectionDefinitionSchema,
  },
  { additionalProperties: false },
);

export const DeleteVariableCollectionCommandSchema = Type.Object(
  {
    ...VariableOperationBaseProperties,
    type: Type.Literal("delete_variable_collection"),
    collectionId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const MoveVariableCollectionCommandSchema = Type.Object(
  {
    ...VariableOperationBaseProperties,
    type: Type.Literal("move_variable_collection"),
    collectionId: Type.String({ minLength: 1, maxLength: 256 }),
    index: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const PutVariableCommandSchema = Type.Object(
  {
    ...VariableOperationBaseProperties,
    type: Type.Literal("put_variable"),
    variable: VariableDefinitionSchema,
  },
  { additionalProperties: false },
);

export const DeleteVariableCommandSchema = Type.Object(
  {
    ...VariableOperationBaseProperties,
    type: Type.Literal("delete_variable"),
    variableId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const SetExplicitVariableModesCommandSchema = Type.Object(
  {
    ...VariableOperationBaseProperties,
    type: Type.Literal("set_explicit_variable_modes"),
    target: Type.Object(
      {
        kind: Type.Union([Type.Literal("page"), Type.Literal("node")]),
        id: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false },
    ),
    explicitVariableModes: ExplicitVariableModesSchema,
  },
  { additionalProperties: false },
);

export const SetVariableBindingCommandSchema = Type.Object(
  {
    ...VariableOperationBaseProperties,
    type: Type.Literal("set_variable_binding"),
    target: VariableBindingTargetSchema,
    variable: Type.Union([VariableAliasSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const VariableCollectionChangeSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal("added"),
      Type.Literal("updated"),
      Type.Literal("moved"),
      Type.Literal("removed"),
    ]),
    collectionId: Type.String({ minLength: 1 }),
    before: Type.Optional(VariableCollectionDefinitionSchema),
    after: Type.Optional(VariableCollectionDefinitionSchema),
    changedFields: Type.Array(Type.String(), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const VariableChangeSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal("added"),
      Type.Literal("updated"),
      Type.Literal("removed"),
    ]),
    variableId: Type.String({ minLength: 1 }),
    before: Type.Optional(VariableDefinitionSchema),
    after: Type.Optional(VariableDefinitionSchema),
    changedFields: Type.Array(Type.String(), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const VariableChangeSetProperties = {
  addedVariableCollectionIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedVariableCollectionIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedVariableCollectionIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  addedVariableIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedVariableIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedVariableIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  variableCollectionChanges: Type.Optional(
    Type.Array(VariableCollectionChangeSchema),
  ),
  variableChanges: Type.Optional(Type.Array(VariableChangeSchema)),
};

export type VariableResolvedDataType = Static<
  typeof VariableResolvedDataTypeSchema
>;
export type VariableAlias = Static<typeof VariableAliasSchema>;
export type VariableColorValue = Static<typeof VariableColorValueSchema>;
export type VariableEasingValue = Static<typeof VariableEasingValueSchema>;
export type VariableValue = Static<typeof VariableValueSchema>;
export type VariableScope = Static<typeof VariableScopeSchema>;
export type VariableMode = Static<typeof VariableModeSchema>;
export type VariableCollectionDefinition = Static<
  typeof VariableCollectionDefinitionSchema
>;
export type VariableDefinition = Static<typeof VariableDefinitionSchema>;
export type ExplicitVariableModes = Static<typeof ExplicitVariableModesSchema>;
export type NodeBoundVariables = Static<typeof NodeBoundVariablesSchema>;
export type PaintBoundVariables = Static<typeof PaintBoundVariablesSchema>;
export type VariableBindingTarget = Static<typeof VariableBindingTargetSchema>;
export type PutVariableCollectionCommand = Static<
  typeof PutVariableCollectionCommandSchema
>;
export type DeleteVariableCollectionCommand = Static<
  typeof DeleteVariableCollectionCommandSchema
>;
export type MoveVariableCollectionCommand = Static<
  typeof MoveVariableCollectionCommandSchema
>;
export type PutVariableCommand = Static<typeof PutVariableCommandSchema>;
export type DeleteVariableCommand = Static<typeof DeleteVariableCommandSchema>;
export type SetExplicitVariableModesCommand = Static<
  typeof SetExplicitVariableModesCommandSchema
>;
export type SetVariableBindingCommand = Static<
  typeof SetVariableBindingCommandSchema
>;
export type VariableCollectionChange = Static<
  typeof VariableCollectionChangeSchema
>;
export type VariableChange = Static<typeof VariableChangeSchema>;

export function migrateFigmaVariables(
  document: Record<string, unknown>,
): boolean {
  if (
    hasNonEmptyRecord(document.tokenCollectionsById) ||
    hasNonEmptyRecord(document.tokensById)
  ) {
    return false;
  }
  delete document.tokenCollectionsById;
  delete document.tokensById;
  document.variableCollectionOrder ??= [];
  document.variableCollectionsById ??= {};
  document.variablesById ??= {};
  return true;
}

function hasNonEmptyRecord(value: unknown): boolean {
  return (
    value !== undefined &&
    (!value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length > 0)
  );
}
