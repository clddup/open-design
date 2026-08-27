import { Type, type TProperties, type TSchema } from "@sinclair/typebox";

interface ChangeSetSchemaDependencies<
  TDesignNode extends TSchema,
  TDesignPage extends TSchema,
  TComponentDefinition extends TSchema,
  TLibraryComponentSource extends TSchema,
  TLibraryVariantSetSource extends TSchema,
  TLibraryStyleSource extends TSchema,
  TLibraryVariableCollectionSource extends TSchema,
  TLibraryVariableSource extends TSchema,
  TVariantSetChange extends TSchema,
  TSharedStyleChange extends TSchema,
  TVariableChangeSetProperties extends TProperties,
> {
  designNodeSchema: TDesignNode;
  designPageSchema: TDesignPage;
  componentDefinitionSchema: TComponentDefinition;
  libraryComponentSourceSchema: TLibraryComponentSource;
  libraryVariantSetSourceSchema: TLibraryVariantSetSource;
  libraryStyleSourceSchema: TLibraryStyleSource;
  libraryVariableCollectionSourceSchema: TLibraryVariableCollectionSource;
  libraryVariableSourceSchema: TLibraryVariableSource;
  variantSetChangeSchema: TVariantSetChange;
  sharedStyleChangeSchema: TSharedStyleChange;
  variableChangeSetProperties: TVariableChangeSetProperties;
}

export function createChangeSetSchemas<
  TDesignNode extends TSchema,
  TDesignPage extends TSchema,
  TComponentDefinition extends TSchema,
  TLibraryComponentSource extends TSchema,
  TLibraryVariantSetSource extends TSchema,
  TLibraryStyleSource extends TSchema,
  TLibraryVariableCollectionSource extends TSchema,
  TLibraryVariableSource extends TSchema,
  TVariantSetChange extends TSchema,
  TSharedStyleChange extends TSchema,
  TVariableChangeSetProperties extends TProperties,
>({
  designNodeSchema,
  designPageSchema,
  componentDefinitionSchema,
  libraryComponentSourceSchema,
  libraryVariantSetSourceSchema,
  libraryStyleSourceSchema,
  libraryVariableCollectionSourceSchema,
  libraryVariableSourceSchema,
  variantSetChangeSchema,
  sharedStyleChangeSchema,
  variableChangeSetProperties,
}: ChangeSetSchemaDependencies<
  TDesignNode,
  TDesignPage,
  TComponentDefinition,
  TLibraryComponentSource,
  TLibraryVariantSetSource,
  TLibraryStyleSource,
  TLibraryVariableCollectionSource,
  TLibraryVariableSource,
  TVariantSetChange,
  TSharedStyleChange,
  TVariableChangeSetProperties
>) {
  const NodeChangeSchema = Type.Object(
    {
      type: Type.Union([
        Type.Literal("added"),
        Type.Literal("updated"),
        Type.Literal("moved"),
        Type.Literal("removed"),
      ]),
      nodeId: Type.String({ minLength: 1 }),
      before: Type.Optional(designNodeSchema),
      after: Type.Optional(designNodeSchema),
      changedFields: Type.Array(Type.String(), { uniqueItems: true }),
    },
    { additionalProperties: false },
  );

  const PageChangeSchema = Type.Object(
    {
      type: Type.Union([
        Type.Literal("added"),
        Type.Literal("updated"),
        Type.Literal("moved"),
        Type.Literal("removed"),
      ]),
      pageId: Type.String({ minLength: 1 }),
      before: Type.Optional(designPageSchema),
      after: Type.Optional(designPageSchema),
      changedFields: Type.Array(Type.String(), { uniqueItems: true }),
    },
    { additionalProperties: false },
  );

  const ComponentChangeSchema = Type.Object(
    {
      type: Type.Union([
        Type.Literal("added"),
        Type.Literal("updated"),
        Type.Literal("removed"),
      ]),
      componentId: Type.String({ minLength: 1 }),
      before: Type.Optional(componentDefinitionSchema),
      after: Type.Optional(componentDefinitionSchema),
      changedFields: Type.Array(Type.String(), { uniqueItems: true }),
    },
    { additionalProperties: false },
  );

  const LibraryComponentSourceChangeSchema = Type.Object(
    {
      type: sourceChangeTypeSchema(),
      componentId: Type.String({ minLength: 1 }),
      before: Type.Optional(libraryComponentSourceSchema),
      after: Type.Optional(libraryComponentSourceSchema),
      changedFields: Type.Array(Type.String(), { uniqueItems: true }),
    },
    { additionalProperties: false },
  );
  const LibraryVariantSetSourceChangeSchema = Type.Object(
    {
      type: sourceChangeTypeSchema(),
      variantSetId: Type.String({ minLength: 1 }),
      before: Type.Optional(libraryVariantSetSourceSchema),
      after: Type.Optional(libraryVariantSetSourceSchema),
      changedFields: Type.Array(Type.String(), { uniqueItems: true }),
    },
    { additionalProperties: false },
  );
  const LibraryStyleSourceChangeSchema = Type.Object(
    {
      type: sourceChangeTypeSchema(),
      styleId: Type.String({ minLength: 1 }),
      before: Type.Optional(libraryStyleSourceSchema),
      after: Type.Optional(libraryStyleSourceSchema),
      changedFields: Type.Array(Type.String(), { uniqueItems: true }),
    },
    { additionalProperties: false },
  );
  const LibraryVariableCollectionSourceChangeSchema = Type.Object(
    {
      type: sourceChangeTypeSchema(),
      collectionId: Type.String({ minLength: 1 }),
      before: Type.Optional(libraryVariableCollectionSourceSchema),
      after: Type.Optional(libraryVariableCollectionSourceSchema),
      changedFields: Type.Array(Type.String(), { uniqueItems: true }),
    },
    { additionalProperties: false },
  );
  const LibraryVariableSourceChangeSchema = Type.Object(
    {
      type: sourceChangeTypeSchema(),
      variableId: Type.String({ minLength: 1 }),
      before: Type.Optional(libraryVariableSourceSchema),
      after: Type.Optional(libraryVariableSourceSchema),
      changedFields: Type.Array(Type.String(), { uniqueItems: true }),
    },
    { additionalProperties: false },
  );

  const coreProperties = {
    documentId: Type.String({ minLength: 1 }),
    fromRevision: Type.Integer({ minimum: 0 }),
    toRevision: Type.Integer({ minimum: 0 }),
    addedNodeIds: uniqueStringArray(),
    changedNodeIds: uniqueStringArray(),
    removedNodeIds: uniqueStringArray(),
    addedAssetIds: Type.Optional(uniqueStringArray()),
    changedAssetIds: Type.Optional(uniqueStringArray()),
    removedAssetIds: Type.Optional(uniqueStringArray()),
    addedImageAssetDerivationIds: Type.Optional(uniqueStringArray()),
    changedImageAssetDerivationIds: Type.Optional(uniqueStringArray()),
    removedImageAssetDerivationIds: Type.Optional(uniqueStringArray()),
    addedPageIds: Type.Optional(uniqueStringArray()),
    changedPageIds: Type.Optional(uniqueStringArray()),
    removedPageIds: Type.Optional(uniqueStringArray()),
    addedComponentIds: Type.Optional(uniqueStringArray()),
    changedComponentIds: Type.Optional(uniqueStringArray()),
    removedComponentIds: Type.Optional(uniqueStringArray()),
    addedLibraryComponentIds: Type.Optional(uniqueStringArray()),
    changedLibraryComponentIds: Type.Optional(uniqueStringArray()),
    removedLibraryComponentIds: Type.Optional(uniqueStringArray()),
    addedLibraryVariantSetIds: Type.Optional(uniqueStringArray()),
    changedLibraryVariantSetIds: Type.Optional(uniqueStringArray()),
    removedLibraryVariantSetIds: Type.Optional(uniqueStringArray()),
    addedVariantSetIds: Type.Optional(uniqueStringArray()),
    changedVariantSetIds: Type.Optional(uniqueStringArray()),
    removedVariantSetIds: Type.Optional(uniqueStringArray()),
  };

  const detailProperties = {
    pageChanges: Type.Optional(Type.Array(PageChangeSchema)),
    componentChanges: Type.Optional(Type.Array(ComponentChangeSchema)),
    libraryComponentChanges: Type.Optional(
      Type.Array(LibraryComponentSourceChangeSchema),
    ),
    libraryVariantSetChanges: Type.Optional(
      Type.Array(LibraryVariantSetSourceChangeSchema),
    ),
    addedLibraryStyleIds: Type.Optional(uniqueStringArray()),
    changedLibraryStyleIds: Type.Optional(uniqueStringArray()),
    removedLibraryStyleIds: Type.Optional(uniqueStringArray()),
    libraryStyleChanges: Type.Optional(
      Type.Array(LibraryStyleSourceChangeSchema),
    ),
    addedLibraryVariableCollectionIds: Type.Optional(uniqueStringArray()),
    changedLibraryVariableCollectionIds: Type.Optional(uniqueStringArray()),
    removedLibraryVariableCollectionIds: Type.Optional(uniqueStringArray()),
    libraryVariableCollectionChanges: Type.Optional(
      Type.Array(LibraryVariableCollectionSourceChangeSchema),
    ),
    addedLibraryVariableIds: Type.Optional(uniqueStringArray()),
    changedLibraryVariableIds: Type.Optional(uniqueStringArray()),
    removedLibraryVariableIds: Type.Optional(uniqueStringArray()),
    libraryVariableChanges: Type.Optional(
      Type.Array(LibraryVariableSourceChangeSchema),
    ),
    variantSetChanges: Type.Optional(Type.Array(variantSetChangeSchema)),
    addedStyleIds: Type.Optional(uniqueStringArray()),
    changedStyleIds: Type.Optional(uniqueStringArray()),
    removedStyleIds: Type.Optional(uniqueStringArray()),
    styleChanges: Type.Optional(Type.Array(sharedStyleChangeSchema)),
    changes: Type.Array(NodeChangeSchema),
  };

  const DesignChangeSetSchema = Type.Object(
    {
      ...coreProperties,
      ...detailProperties,
      ...variableChangeSetProperties,
    },
    { additionalProperties: false },
  );

  return {
    NodeChangeSchema,
    PageChangeSchema,
    ComponentChangeSchema,
    LibraryComponentSourceChangeSchema,
    LibraryVariantSetSourceChangeSchema,
    LibraryStyleSourceChangeSchema,
    LibraryVariableCollectionSourceChangeSchema,
    LibraryVariableSourceChangeSchema,
    DesignChangeSetSchema,
  };
}

function sourceChangeTypeSchema() {
  return Type.Union([
    Type.Literal("added"),
    Type.Literal("updated"),
    Type.Literal("removed"),
  ]);
}

function uniqueStringArray() {
  return Type.Array(Type.String(), { uniqueItems: true });
}
