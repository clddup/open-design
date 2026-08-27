import { Type, type TSchema } from "@sinclair/typebox";

interface ResourceOperationSchemaDependencies {
  designAssetSchema: TSchema;
  imageAssetDerivationSchema: TSchema;
  componentDefinitionSchema: TSchema;
  libraryComponentSourceSchema: TSchema;
  libraryVariantSetSourceSchema: TSchema;
  libraryStyleSourceSchema: TSchema;
  libraryVariableCollectionSourceSchema: TSchema;
  libraryVariableSourceSchema: TSchema;
  designPageSchema: TSchema;
  designNodeSchema: TSchema;
  maxPageTransactionNodes: number;
}

export function createResourceOperationSchemas<
  const TDependencies extends ResourceOperationSchemaDependencies,
>(dependencies: TDependencies) {
  const designAssetSchema = dependency(dependencies, "designAssetSchema");
  const imageAssetDerivationSchema = dependency(
    dependencies,
    "imageAssetDerivationSchema",
  );
  const componentDefinitionSchema = dependency(
    dependencies,
    "componentDefinitionSchema",
  );
  const libraryComponentSourceSchema = dependency(
    dependencies,
    "libraryComponentSourceSchema",
  );
  const libraryVariantSetSourceSchema = dependency(
    dependencies,
    "libraryVariantSetSourceSchema",
  );
  const libraryStyleSourceSchema = dependency(
    dependencies,
    "libraryStyleSourceSchema",
  );
  const libraryVariableCollectionSourceSchema = dependency(
    dependencies,
    "libraryVariableCollectionSourceSchema",
  );
  const libraryVariableSourceSchema = dependency(
    dependencies,
    "libraryVariableSourceSchema",
  );
  const designPageSchema = dependency(dependencies, "designPageSchema");
  const designNodeSchema = dependency(dependencies, "designNodeSchema");
  const maxPageTransactionNodes = dependency(
    dependencies,
    "maxPageTransactionNodes",
  );
  const operationBaseProperties = {
    commandId: Type.String({ minLength: 1 }),
  };
  const PutAssetCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("put_asset"),
      asset: designAssetSchema,
    },
    { additionalProperties: false },
  );
  const DeleteAssetCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("delete_asset"),
      assetId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  );
  const PutImageAssetDerivationCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("put_image_asset_derivation"),
      derivation: imageAssetDerivationSchema,
    },
    { additionalProperties: false },
  );
  const DeleteImageAssetDerivationCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("delete_image_asset_derivation"),
      derivationId: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  );
  const PutComponentCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("put_component"),
      component: componentDefinitionSchema,
    },
    { additionalProperties: false },
  );
  const DeleteComponentCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("delete_component"),
      componentId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  );
  const PutLibraryComponentSourceCommandSchema = putSourceSchema(
    "put_library_component_source",
    libraryComponentSourceSchema,
  );
  const DeleteLibraryComponentSourceCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("delete_library_component_source"),
      componentId: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  );
  const PutLibraryVariantSetSourceCommandSchema = putSourceSchema(
    "put_library_variant_set_source",
    libraryVariantSetSourceSchema,
  );
  const DeleteLibraryVariantSetSourceCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("delete_library_variant_set_source"),
      variantSetId: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  );
  const PutLibraryStyleSourceCommandSchema = putSourceSchema(
    "put_library_style_source",
    libraryStyleSourceSchema,
  );
  const DeleteLibraryStyleSourceCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("delete_library_style_source"),
      styleId: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  );
  const PutLibraryVariableCollectionSourceCommandSchema = putSourceSchema(
    "put_library_variable_collection_source",
    libraryVariableCollectionSourceSchema,
  );
  const DeleteLibraryVariableCollectionSourceCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("delete_library_variable_collection_source"),
      collectionId: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  );
  const PutLibraryVariableSourceCommandSchema = putSourceSchema(
    "put_library_variable_source",
    libraryVariableSourceSchema,
  );
  const DeleteLibraryVariableSourceCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("delete_library_variable_source"),
      variableId: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  );
  const InsertPageCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("insert_page"),
      index: Type.Integer({ minimum: 0 }),
      page: designPageSchema,
      nodes: Type.Array(designNodeSchema, {
        maxItems: maxPageTransactionNodes,
      }),
    },
    { additionalProperties: false },
  );
  const UpdatePageCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("update_page"),
      pageId: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  );
  const MovePageCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("move_page"),
      pageId: Type.String({ minLength: 1 }),
      index: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  );
  const DeletePageCommandSchema = Type.Object(
    {
      ...operationBaseProperties,
      type: Type.Literal("delete_page"),
      pageId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  );

  return {
    PutAssetCommandSchema,
    DeleteAssetCommandSchema,
    PutImageAssetDerivationCommandSchema,
    DeleteImageAssetDerivationCommandSchema,
    PutComponentCommandSchema,
    DeleteComponentCommandSchema,
    PutLibraryComponentSourceCommandSchema,
    DeleteLibraryComponentSourceCommandSchema,
    PutLibraryVariantSetSourceCommandSchema,
    DeleteLibraryVariantSetSourceCommandSchema,
    PutLibraryStyleSourceCommandSchema,
    DeleteLibraryStyleSourceCommandSchema,
    PutLibraryVariableCollectionSourceCommandSchema,
    DeleteLibraryVariableCollectionSourceCommandSchema,
    PutLibraryVariableSourceCommandSchema,
    DeleteLibraryVariableSourceCommandSchema,
    InsertPageCommandSchema,
    UpdatePageCommandSchema,
    MovePageCommandSchema,
    DeletePageCommandSchema,
  };
}

function putSourceSchema<const TType extends string, TSource extends TSchema>(
  type: TType,
  sourceSchema: TSource,
) {
  return Type.Object(
    {
      commandId: Type.String({ minLength: 1 }),
      type: Type.Literal(type),
      source: sourceSchema,
    },
    { additionalProperties: false },
  );
}

function dependency<T extends object, TKey extends keyof T>(
  dependencies: T,
  key: TKey,
): T[TKey] {
  return dependencies[key];
}
