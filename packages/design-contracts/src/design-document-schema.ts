import { Type, type TProperties, type TSchema } from "@sinclair/typebox";

interface DesignDocumentSchemaDependencies {
  format: string;
  schemaVersion: string;
  designPageSchema: TSchema;
  designNodeSchema: TSchema;
  componentDefinitionSchema: TSchema;
  variantSetDefinitionSchema: TSchema;
  libraryComponentSourceSchema: TSchema;
  libraryVariantSetSourceSchema: TSchema;
  libraryStyleSourceSchema: TSchema;
  libraryVariableCollectionSourceSchema: TSchema;
  libraryVariableSourceSchema: TSchema;
  styleOrderByTypeSchema: TSchema;
  sharedStyleDefinitionSchema: TSchema;
  jsonValueSchema: TSchema;
  designAssetSchema: TSchema;
  imageAssetDerivationSchema: TSchema;
  jsonObjectSchema: TSchema;
  variableDocumentProperties: TProperties;
}

export function createDesignDocumentSchema<
  const TDependencies extends DesignDocumentSchemaDependencies,
>(dependencies: TDependencies) {
  const schema = <TKey extends keyof TDependencies>(key: TKey) =>
    dependencies[key];
  const variableDocumentProperties = schema("variableDocumentProperties");
  return Type.Object(
    {
      format: Type.Literal(schema("format")),
      schemaVersion: Type.Literal(schema("schemaVersion")),
      documentId: Type.String({ minLength: 1 }),
      revision: Type.Integer({ minimum: 0 }),
      pageOrder: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        uniqueItems: true,
      }),
      pagesById: Type.Record(Type.String(), schema("designPageSchema")),
      nodesById: Type.Record(Type.String(), schema("designNodeSchema")),
      componentsById: Type.Record(
        Type.String(),
        schema("componentDefinitionSchema"),
      ),
      variantSetsById: Type.Record(
        Type.String(),
        schema("variantSetDefinitionSchema"),
      ),
      libraryComponentsById: Type.Record(
        Type.String(),
        schema("libraryComponentSourceSchema"),
      ),
      libraryVariantSetsById: Type.Record(
        Type.String(),
        schema("libraryVariantSetSourceSchema"),
      ),
      libraryStylesById: Type.Record(
        Type.String(),
        schema("libraryStyleSourceSchema"),
      ),
      libraryVariableCollectionsById: Type.Record(
        Type.String(),
        schema("libraryVariableCollectionSourceSchema"),
      ),
      libraryVariablesById: Type.Record(
        Type.String(),
        schema("libraryVariableSourceSchema"),
      ),
      styleOrderByType: schema("styleOrderByTypeSchema"),
      stylesById: Type.Record(
        Type.String(),
        schema("sharedStyleDefinitionSchema"),
      ),
      interactionsById: Type.Record(Type.String(), schema("jsonValueSchema")),
      assetsById: Type.Record(Type.String(), schema("designAssetSchema")),
      imageAssetDerivationOrder: Type.Array(
        Type.String({ minLength: 1, maxLength: 256 }),
        { maxItems: 65_536, uniqueItems: true },
      ),
      imageAssetDerivationsById: Type.Record(
        Type.String(),
        schema("imageAssetDerivationSchema"),
      ),
      extensions: schema("jsonObjectSchema"),
      ...variableDocumentProperties,
    },
    { additionalProperties: false },
  );
}
