import { Type, type TProperties, type TSchema } from "@sinclair/typebox";

interface NodeOperationSchemaDependencies {
  designNodeSchema: TSchema;
  transformSchema: TSchema;
  sizeSchema: TSchema;
  layoutConstraintsSchema: TSchema;
  layoutPositioningSchema: TSchema;
  layoutSizingSchema: TSchema;
  layoutLimitsSchema: TSchema;
  gridChildPlacementSchema: TSchema;
  componentPropertyReferencesSchema: TSchema;
  blendModeSchema: TSchema;
  effectSchema: TSchema;
  maskModeSchema: TSchema;
  exportSettingsSchema: TSchema;
  jsonObjectSchema: TSchema;
  fontFaceIdentityProperties: TProperties;
  paintSchema: TSchema;
  textRunsSchema: TSchema;
}

export function createNodeOperationSchemas<
  const TDependencies extends NodeOperationSchemaDependencies,
>(dependencies: TDependencies) {
  const designNodeSchema = dependency(dependencies, "designNodeSchema");
  const transformSchema = dependency(dependencies, "transformSchema");
  const sizeSchema = dependency(dependencies, "sizeSchema");
  const layoutConstraintsSchema = dependency(
    dependencies,
    "layoutConstraintsSchema",
  );
  const layoutPositioningSchema = dependency(
    dependencies,
    "layoutPositioningSchema",
  );
  const layoutSizingSchema = dependency(dependencies, "layoutSizingSchema");
  const layoutLimitsSchema = dependency(dependencies, "layoutLimitsSchema");
  const gridChildPlacementSchema = dependency(
    dependencies,
    "gridChildPlacementSchema",
  );
  const componentPropertyReferencesSchema = dependency(
    dependencies,
    "componentPropertyReferencesSchema",
  );
  const blendModeSchema = dependency(dependencies, "blendModeSchema");
  const effectSchema = dependency(dependencies, "effectSchema");
  const maskModeSchema = dependency(dependencies, "maskModeSchema");
  const exportSettingsSchema = dependency(dependencies, "exportSettingsSchema");
  const jsonObjectSchema = dependency(dependencies, "jsonObjectSchema");
  const fontFaceIdentityProperties = dependency(
    dependencies,
    "fontFaceIdentityProperties",
  );
  const paintSchema = dependency(dependencies, "paintSchema");
  const textRunsSchema = dependency(dependencies, "textRunsSchema");
  const operationBaseProperties = {
    commandId: Type.String({ minLength: 1 }),
  };
  const InsertElementCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("insert_element"),
      pageId: Type.String({ minLength: 1 }),
      parentId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      index: Type.Integer({ minimum: 0 }),
      node: designNodeSchema,
    },
    { additionalProperties: false },
  );
  const UpdatePropertiesCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("update_properties"),
      nodeId: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String()),
      visible: Type.Optional(Type.Boolean()),
      locked: Type.Optional(Type.Boolean()),
      transform: Type.Optional(transformSchema),
      size: Type.Optional(sizeSchema),
      opacity: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      constraints: optionalNullable(layoutConstraintsSchema),
      layoutPositioning: optionalNullable(layoutPositioningSchema),
      layoutSizing: optionalNullable(layoutSizingSchema),
      layoutLimits: optionalNullable(layoutLimitsSchema),
      gridPlacement: optionalNullable(gridChildPlacementSchema),
      componentPropertyReferences: optionalNullable(
        componentPropertyReferencesSchema,
      ),
      blendMode: Type.Optional(blendModeSchema),
      effects: Type.Optional(Type.Array(effectSchema)),
      maskMode: Type.Optional(maskModeSchema),
      exportSettings: Type.Optional(exportSettingsSchema),
      properties: Type.Optional(jsonObjectSchema),
      extensions: Type.Optional(jsonObjectSchema),
    },
    { additionalProperties: false, minProperties: 4 },
  );
  const MoveElementCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("move_element"),
      nodeId: Type.String({ minLength: 1 }),
      pageId: Type.String({ minLength: 1 }),
      parentId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      index: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  );
  const DeleteElementCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("delete_element"),
      nodeId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  );
  const ReplaceSubtreeCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("replace_subtree"),
      rootNodeId: Type.String({ minLength: 1 }),
      nodes: Type.Array(designNodeSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
  );
  const TextFontDescriptorSchema = Type.Object(fontFaceIdentityProperties, {
    additionalProperties: false,
  });
  const ReflowTextCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("reflow_text"),
      nodeIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
        minItems: 1,
        maxItems: 1_000,
        uniqueItems: true,
      }),
      expectedFont: TextFontDescriptorSchema,
      replacementFont: Type.Optional(TextFontDescriptorSchema),
    },
    { additionalProperties: false },
  );
  const UpdateTextRangeStyleCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("update_text_range_style"),
      nodeId: Type.String({ minLength: 1, maxLength: 256 }),
      start: Type.Integer({ minimum: 0 }),
      end: Type.Integer({ minimum: 1 }),
      style: Type.Object(
        {
          fontFamily: Type.Optional(
            Type.String({ minLength: 1, maxLength: 4_096 }),
          ),
          fontStyleName: Type.Optional(
            Type.Union([
              Type.String({ minLength: 1, maxLength: 512 }),
              Type.Null(),
            ]),
          ),
          fontSize: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
          fontWeight: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 1_000 }),
          ),
          fontSlant: Type.Optional(
            Type.Union([Type.Literal("normal"), Type.Literal("italic")]),
          ),
          letterSpacing: Type.Optional(Type.Number()),
          lineHeight: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
          textCase: Type.Optional(textCaseSchema()),
          textDecoration: Type.Optional(textDecorationSchema()),
          paragraphIndent: Type.Optional(Type.Number({ minimum: 0 })),
          paragraphSpacing: Type.Optional(Type.Number({ minimum: 0 })),
          listOptions: Type.Optional(listOptionsSchema()),
          indentation: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
          listSpacing: Type.Optional(Type.Number({ minimum: 0 })),
          fills: Type.Optional(Type.Array(paintSchema, { maxItems: 64 })),
          textStyleId: optionalNullableString(),
          fillStyleId: optionalNullableString(),
        },
        { additionalProperties: false, minProperties: 1 },
      ),
    },
    { additionalProperties: false },
  );
  const CommitTextEditParagraphPatchSchema = Type.Object(
    {
      start: Type.Integer({ minimum: 0 }),
      end: Type.Integer({ minimum: 1 }),
      style: Type.Object(
        {
          paragraphIndent: Type.Optional(Type.Number({ minimum: 0 })),
          paragraphSpacing: Type.Optional(Type.Number({ minimum: 0 })),
          listOptions: Type.Optional(listOptionsSchema()),
          indentation: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
          listSpacing: Type.Optional(Type.Number({ minimum: 0 })),
        },
        { additionalProperties: false, minProperties: 1 },
      ),
    },
    { additionalProperties: false },
  );
  const CommitTextEditCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("commit_text_edit"),
      nodeId: Type.String({ minLength: 1, maxLength: 256 }),
      content: Type.String(),
      paragraphPatches: Type.Array(CommitTextEditParagraphPatchSchema, {
        maxItems: 16_384,
      }),
      runs: textRunsSchema,
    },
    { additionalProperties: false },
  );
  const NodeDesignOperationSchema = Type.Union([
    InsertElementCommandSchema,
    UpdatePropertiesCommandSchema,
    MoveElementCommandSchema,
    DeleteElementCommandSchema,
    ReplaceSubtreeCommandSchema,
    ReflowTextCommandSchema,
    UpdateTextRangeStyleCommandSchema,
    CommitTextEditCommandSchema,
  ]);

  return {
    InsertElementCommandSchema,
    UpdatePropertiesCommandSchema,
    MoveElementCommandSchema,
    DeleteElementCommandSchema,
    ReplaceSubtreeCommandSchema,
    TextFontDescriptorSchema,
    ReflowTextCommandSchema,
    UpdateTextRangeStyleCommandSchema,
    CommitTextEditParagraphPatchSchema,
    CommitTextEditCommandSchema,
    NodeDesignOperationSchema,
  };
}

function optionalNullable<T extends TSchema>(schema: T) {
  return Type.Optional(Type.Union([schema, Type.Null()]));
}

function optionalNullableString() {
  return Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 512 }), Type.Null()]),
  );
}

function listOptionsSchema() {
  return Type.Object(
    {
      type: Type.Union([
        Type.Literal("none"),
        Type.Literal("ordered"),
        Type.Literal("unordered"),
      ]),
    },
    { additionalProperties: false },
  );
}

function textCaseSchema() {
  return Type.Union([
    Type.Literal("original"),
    Type.Literal("uppercase"),
    Type.Literal("lowercase"),
    Type.Literal("title-case"),
    Type.Literal("small-caps"),
  ]);
}

function textDecorationSchema() {
  return Type.Union([
    Type.Literal("none"),
    Type.Literal("underline"),
    Type.Literal("strikethrough"),
  ]);
}

function dependency<T extends object, TKey extends keyof T>(
  dependencies: T,
  key: TKey,
): T[TKey] {
  return dependencies[key];
}
