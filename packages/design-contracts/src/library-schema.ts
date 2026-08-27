import { Type, type TSchema } from "@sinclair/typebox";

interface LibrarySchemaDependencies {
  componentDefinitionSchema: TSchema;
  designNodeSchema: TSchema;
  designAssetSchema: TSchema;
  variantSetDefinitionSchema: TSchema;
  sharedStyleDefinitionSchema: TSchema;
  variableCollectionDefinitionSchema: TSchema;
  variableDefinitionSchema: TSchema;
}

export function createLibrarySchemas<
  const TDependencies extends LibrarySchemaDependencies,
>(dependencies: TDependencies) {
  const componentDefinitionSchema = dependency(
    dependencies,
    "componentDefinitionSchema",
  );
  const designNodeSchema = dependency(dependencies, "designNodeSchema");
  const designAssetSchema = dependency(dependencies, "designAssetSchema");
  const variantSetDefinitionSchema = dependency(
    dependencies,
    "variantSetDefinitionSchema",
  );
  const sharedStyleDefinitionSchema = dependency(
    dependencies,
    "sharedStyleDefinitionSchema",
  );
  const variableCollectionDefinitionSchema = dependency(
    dependencies,
    "variableCollectionDefinitionSchema",
  );
  const variableDefinitionSchema = dependency(
    dependencies,
    "variableDefinitionSchema",
  );
  const identityProperties = {
    libraryId: Type.String({ minLength: 1, maxLength: 256 }),
    releaseId: Type.String({ minLength: 1, maxLength: 256 }),
    sourceProjectId: Type.String({ minLength: 1, maxLength: 256 }),
    sourceDesignFileId: Type.String({ minLength: 1, maxLength: 256 }),
    sourceDocumentId: Type.String({ minLength: 1, maxLength: 256 }),
  };
  const LibraryReleaseIdentitySchema = Type.Object(identityProperties, {
    additionalProperties: false,
  });
  const LibraryComponentSourceSchema = Type.Object(
    {
      source: Type.Object(
        {
          ...identityProperties,
          sourceComponentId: Type.String({ minLength: 1, maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      component: componentDefinitionSchema,
      nodesById: Type.Record(Type.String(), designNodeSchema),
      assetsById: Type.Record(Type.String(), designAssetSchema),
      dependencyComponentIds: Type.Array(
        Type.String({ minLength: 1, maxLength: 256 }),
        { maxItems: 4_096, uniqueItems: true },
      ),
    },
    { additionalProperties: false },
  );
  const LibraryVariantSetSourceSchema = Type.Object(
    {
      source: Type.Object(
        {
          ...identityProperties,
          sourceVariantSetId: Type.String({ minLength: 1, maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      variantSet: variantSetDefinitionSchema,
    },
    { additionalProperties: false },
  );
  const LibraryStyleSourceSchema = Type.Object(
    {
      source: Type.Object(
        {
          ...identityProperties,
          sourceStyleId: Type.String({ minLength: 1, maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      style: sharedStyleDefinitionSchema,
    },
    { additionalProperties: false },
  );
  const LibraryVariableCollectionSourceSchema = Type.Object(
    {
      source: Type.Object(
        {
          ...identityProperties,
          sourceVariableCollectionId: Type.String({
            minLength: 1,
            maxLength: 256,
          }),
        },
        { additionalProperties: false },
      ),
      collection: variableCollectionDefinitionSchema,
    },
    { additionalProperties: false },
  );
  const LibraryVariableSourceSchema = Type.Object(
    {
      source: Type.Object(
        {
          ...identityProperties,
          sourceVariableId: Type.String({ minLength: 1, maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      variable: variableDefinitionSchema,
    },
    { additionalProperties: false },
  );
  const LibraryReleaseSnapshotSchema = Type.Object(
    {
      version: Type.Literal(3),
      ...identityProperties,
      name: Type.String({ minLength: 1, maxLength: 256 }),
      publishedAt: Type.String({ minLength: 1, maxLength: 64 }),
      componentsById: sourceRecord(LibraryComponentSourceSchema),
      variantSetsById: sourceRecord(LibraryVariantSetSourceSchema),
      stylesById: sourceRecord(LibraryStyleSourceSchema),
      variableCollectionsById: sourceRecord(
        LibraryVariableCollectionSourceSchema,
      ),
      variablesById: sourceRecord(LibraryVariableSourceSchema),
    },
    { additionalProperties: false },
  );
  return {
    LibraryReleaseIdentitySchema,
    LibraryComponentSourceSchema,
    LibraryVariantSetSourceSchema,
    LibraryStyleSourceSchema,
    LibraryVariableCollectionSourceSchema,
    LibraryVariableSourceSchema,
    LibraryReleaseSnapshotSchema,
  };
}

function sourceRecord<T extends TSchema>(schema: T) {
  return Type.Record(Type.String({ minLength: 1, maxLength: 256 }), schema);
}

function dependency<T extends object, TKey extends keyof T>(
  dependencies: T,
  key: TKey,
): T[TKey] {
  return dependencies[key];
}
