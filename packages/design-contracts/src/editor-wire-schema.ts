import { Type, type TSchema } from "@sinclair/typebox";

interface EditorWireSchemaDependencies<TSchemaVersion extends string> {
  historyEntrySchema: TSchema;
  designTransactionSuccessSchema: TSchema;
  designErrorSchema: TSchema;
  schemaVersion: TSchemaVersion;
  nodeKindSchema: TSchema;
  jsonObjectSchema: TSchema;
  fidelityWarningSchema: TSchema;
}

export function createEditorWireSchemas<const TSchemaVersion extends string>({
  historyEntrySchema,
  designTransactionSuccessSchema,
  designErrorSchema,
  schemaVersion,
  nodeKindSchema,
  jsonObjectSchema,
  fidelityWarningSchema,
}: EditorWireSchemaDependencies<TSchemaVersion>) {
  const HistoryStateSchema = Type.Object(
    {
      canUndo: Type.Boolean(),
      canRedo: Type.Boolean(),
      undo: Type.Array(historyEntrySchema),
      redo: Type.Array(historyEntrySchema),
    },
    { additionalProperties: false },
  );

  const ComponentSelectionTargetSchema = Type.Object(
    {
      instanceId: Type.String({ minLength: 1, maxLength: 256 }),
      sourcePath: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
        minItems: 1,
        maxItems: 64,
      }),
    },
    { additionalProperties: false },
  );

  const SelectionStateSchema = Type.Object(
    {
      nodeIds: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
      anchorNodeId: Type.Optional(Type.String({ minLength: 1 })),
      componentTarget: Type.Optional(ComponentSelectionTargetSchema),
    },
    { additionalProperties: false },
  );

  const ViewportStateSchema = Type.Object(
    {
      panX: Type.Number(),
      panY: Type.Number(),
      zoom: Type.Number({ exclusiveMinimum: 0 }),
      width: Type.Number({ minimum: 0 }),
      height: Type.Number({ minimum: 0 }),
    },
    { additionalProperties: false },
  );

  const EditorStateSchema = Type.Object(
    {
      documentId: Type.String({ minLength: 1 }),
      revision: Type.Integer({ minimum: 0 }),
      selection: SelectionStateSchema,
      tool: Type.String({ minLength: 1 }),
      viewport: ViewportStateSchema,
      dirty: Type.Boolean(),
      checkpointRevision: Type.Integer({ minimum: 0 }),
      history: HistoryStateSchema,
    },
    { additionalProperties: false },
  );

  const eventBaseProperties = {
    eventId: Type.String({ minLength: 1 }),
    sequence: Type.Integer({ minimum: 1 }),
    occurredAt: Type.String({ minLength: 1 }),
    documentId: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 0 }),
  };

  const EditorEventSchema = Type.Union([
    Type.Object(
      {
        ...eventBaseProperties,
        type: Type.Literal("document.changed"),
        result: designTransactionSuccessSchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...eventBaseProperties,
        type: Type.Literal("selection.changed"),
        selection: SelectionStateSchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...eventBaseProperties,
        type: Type.Literal("tool.changed"),
        tool: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...eventBaseProperties,
        type: Type.Literal("viewport.changed"),
        viewport: ViewportStateSchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...eventBaseProperties,
        type: Type.Literal("history.changed"),
        history: HistoryStateSchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...eventBaseProperties,
        type: Type.Literal("dirty.changed"),
        dirty: Type.Boolean(),
        checkpointRevision: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...eventBaseProperties,
        type: Type.Literal("checkpoint.created"),
        checkpointRevision: Type.Integer({ minimum: 0 }),
        label: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...eventBaseProperties,
        type: Type.Literal("runtime.error"),
        error: designErrorSchema,
      },
      { additionalProperties: false },
    ),
  ]);

  const DesignCapabilitiesSchema = Type.Object(
    {
      schemaVersion: Type.Literal(schemaVersion),
      nodeKinds: Type.Array(nodeKindSchema, { uniqueItems: true }),
      operations: Type.Array(
        Type.Union([
          Type.Literal("insert_element"),
          Type.Literal("update_properties"),
          Type.Literal("move_element"),
          Type.Literal("delete_element"),
          Type.Literal("replace_subtree"),
          Type.Literal("reflow_text"),
          Type.Literal("update_text_range_style"),
          Type.Literal("put_asset"),
          Type.Literal("delete_asset"),
          Type.Literal("put_image_asset_derivation"),
          Type.Literal("delete_image_asset_derivation"),
        ]),
        { uniqueItems: true },
      ),
      limits: Type.Object(
        {
          maxCommandsPerTransaction: Type.Integer({ minimum: 1 }),
          maxDocumentNodes: Type.Optional(Type.Integer({ minimum: 1 })),
        },
        { additionalProperties: false },
      ),
      features: Type.Object(
        {
          preview: Type.Boolean(),
          atomicTransactions: Type.Boolean(),
          undoRedo: Type.Boolean(),
          hitTesting: Type.Boolean(),
          displayList: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      importFormats: Type.Array(Type.String()),
      exportFormats: Type.Array(Type.String()),
      extensions: jsonObjectSchema,
    },
    { additionalProperties: false },
  );

  const ExportArtifactSchema = Type.Object(
    {
      artifactId: Type.String({ minLength: 1 }),
      mimeType: Type.String({ minLength: 1 }),
      path: Type.String({ minLength: 1 }),
      fidelity: Type.Object(
        {
          status: Type.Union([
            Type.Literal("exact"),
            Type.Literal("degraded"),
            Type.Literal("unsupported"),
          ]),
          warnings: Type.Array(fidelityWarningSchema),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  );

  return {
    HistoryStateSchema,
    ComponentSelectionTargetSchema,
    SelectionStateSchema,
    ViewportStateSchema,
    EditorStateSchema,
    EditorEventSchema,
    DesignCapabilitiesSchema,
    ExportArtifactSchema,
  };
}
