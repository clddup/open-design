import { Type, type TSchema } from "@sinclair/typebox";

interface TransactionWireSchemaDependencies<
  TDesignOperation extends TSchema,
  TJsonObject extends TSchema,
  TJsonValue extends TSchema,
  TDesignChangeSet extends TSchema,
> {
  designOperationSchema: TDesignOperation;
  jsonObjectSchema: TJsonObject;
  jsonValueSchema: TJsonValue;
  designChangeSetSchema: TDesignChangeSet;
  maxTransactionCommands: number;
}

export function createTransactionWireSchemas<
  TDesignOperation extends TSchema,
  TJsonObject extends TSchema,
  TJsonValue extends TSchema,
  TDesignChangeSet extends TSchema,
>({
  designOperationSchema,
  jsonObjectSchema,
  jsonValueSchema,
  designChangeSetSchema,
  maxTransactionCommands,
}: TransactionWireSchemaDependencies<
  TDesignOperation,
  TJsonObject,
  TJsonValue,
  TDesignChangeSet
>) {
  const DesignActorSchema = Type.Object(
    {
      type: Type.Union([
        Type.Literal("user"),
        Type.Literal("agent"),
        Type.Literal("system"),
        Type.Literal("plugin"),
      ]),
      id: Type.String({ minLength: 1 }),
      displayName: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  );

  const DesignTransactionSchema = Type.Object(
    {
      transactionId: Type.String({ minLength: 1 }),
      documentId: Type.String({ minLength: 1 }),
      baseRevision: Type.Integer({ minimum: 0 }),
      actor: DesignActorSchema,
      label: Type.Optional(Type.String()),
      summary: Type.Optional(Type.String()),
      commands: Type.Array(designOperationSchema, {
        minItems: 1,
        maxItems: maxTransactionCommands,
      }),
      extensions: Type.Optional(jsonObjectSchema),
    },
    { additionalProperties: false },
  );

  const DesignErrorCodeSchema = Type.Union([
    Type.Literal("unsupported"),
    Type.Literal("conflict"),
    Type.Literal("invalid"),
    Type.Literal("permission-denied"),
    Type.Literal("cancelled"),
    Type.Literal("not-found"),
    Type.Literal("duplicate"),
    Type.Literal("engine-failure"),
  ]);
  const DesignIssueSchema = Type.Object(
    {
      code: Type.String({ minLength: 1, maxLength: 256 }),
      path: Type.String({ maxLength: 4_000 }),
      message: Type.String({ minLength: 1, maxLength: 20_000 }),
      commandId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      nodeId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      expected: Type.Optional(jsonValueSchema),
      actual: Type.Optional(jsonValueSchema),
      recovery: Type.Optional(Type.String({ minLength: 1, maxLength: 4_000 })),
      details: Type.Optional(jsonValueSchema),
    },
    { additionalProperties: false },
  );
  const DesignErrorSchema = Type.Object(
    {
      code: DesignErrorCodeSchema,
      message: Type.String({ minLength: 1 }),
      retryable: Type.Boolean(),
      issues: Type.Array(DesignIssueSchema, { minItems: 1, maxItems: 128 }),
      context: Type.Optional(jsonValueSchema),
    },
    { additionalProperties: false },
  );
  const RevisionSchema = Type.Object(
    {
      revision: Type.Integer({ minimum: 0 }),
      createdAt: Type.String({ minLength: 1 }),
      label: Type.Optional(Type.String()),
      transactionId: Type.Optional(Type.String({ minLength: 1 })),
      actor: Type.Optional(DesignActorSchema),
    },
    { additionalProperties: false },
  );
  const FidelityWarningSchema = Type.Object(
    {
      nodeId: Type.Optional(Type.String({ minLength: 1 })),
      feature: Type.String({ minLength: 1 }),
      fallback: Type.String(),
      message: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  );
  const TransactionModeSchema = Type.Union([
    Type.Literal("preview"),
    Type.Literal("apply"),
    Type.Literal("undo"),
    Type.Literal("redo"),
  ]);
  const DesignTransactionSuccessSchema = Type.Object(
    {
      ok: Type.Literal(true),
      mode: TransactionModeSchema,
      transactionId: Type.String({ minLength: 1 }),
      documentId: Type.String({ minLength: 1 }),
      baseRevision: Type.Integer({ minimum: 0 }),
      revision: RevisionSchema,
      changes: designChangeSetSchema,
      warnings: Type.Array(FidelityWarningSchema),
    },
    { additionalProperties: false },
  );
  const DesignTransactionFailureSchema = Type.Object(
    {
      ok: Type.Literal(false),
      mode: TransactionModeSchema,
      transactionId: Type.String({ minLength: 1 }),
      documentId: Type.String({ minLength: 1 }),
      baseRevision: Type.Integer({ minimum: 0 }),
      revision: RevisionSchema,
      error: DesignErrorSchema,
    },
    { additionalProperties: false },
  );
  const DesignTransactionResultSchema = Type.Union([
    DesignTransactionSuccessSchema,
    DesignTransactionFailureSchema,
  ]);
  const HistoryEntrySchema = Type.Object(
    {
      transactionId: Type.String({ minLength: 1 }),
      label: Type.String(),
      actor: DesignActorSchema,
      revision: RevisionSchema,
      changes: designChangeSetSchema,
    },
    { additionalProperties: false },
  );

  return {
    DesignActorSchema,
    DesignTransactionSchema,
    DesignErrorCodeSchema,
    DesignIssueSchema,
    DesignErrorSchema,
    RevisionSchema,
    FidelityWarningSchema,
    TransactionModeSchema,
    DesignTransactionSuccessSchema,
    DesignTransactionFailureSchema,
    DesignTransactionResultSchema,
    HistoryEntrySchema,
  };
}
