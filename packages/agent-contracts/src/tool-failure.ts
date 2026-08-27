import { Type, type Static } from "@sinclair/typebox";
import { defineContract } from "@opendesign/contract-runtime";
import { createDesignWorkflowFailureDetailsSchema } from "./workflow-failure-contract.js";
import { AgentIdSchema } from "./wire-foundations.js";

const FailureIssueScalarSchema = Type.Union([
  Type.String({ maxLength: 4_000 }),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);
const FailureIssueValueSchema = Type.Union([
  FailureIssueScalarSchema,
  Type.Array(FailureIssueScalarSchema, { maxItems: 64 }),
  Type.Record(
    Type.String({ minLength: 1, maxLength: 128 }),
    FailureIssueScalarSchema,
    { maxProperties: 64 },
  ),
]);

export const AgentToolFailureIssueSchema = Type.Object(
  {
    code: Type.Optional(AgentIdSchema),
    commandId: Type.Optional(AgentIdSchema),
    nodeId: Type.Optional(AgentIdSchema),
    path: Type.String({ maxLength: 4_000 }),
    message: Type.String({ minLength: 1, maxLength: 20_000 }),
    expected: Type.Optional(FailureIssueValueSchema),
    actual: Type.Optional(FailureIssueValueSchema),
    recovery: Type.Optional(Type.String({ minLength: 1, maxLength: 4_000 })),
  },
  { additionalProperties: false },
);

export const AgentToolFailureIssueContract = defineContract<
  Static<typeof AgentToolFailureIssueSchema>
>({
  schema: AgentToolFailureIssueSchema,
  code: "agent_tool_failure_issue.schema_invalid",
  subject: "Agent tool failure issue",
  recovery: "Correct the reported failure issue field before retrying.",
  clone: false,
});

const FailureAttemptFields = {
  attempt: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  maxAttempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  retrySuppressed: Type.Optional(Type.Boolean()),
};

export const DesignTransactionFailureDetailsSchema = Type.Object(
  {
    kind: Type.Literal("design-transaction"),
    fingerprint: AgentIdSchema,
    issues: Type.Array(AgentToolFailureIssueSchema, {
      minItems: 1,
      maxItems: 128,
    }),
    recovery: Type.Object(
      {
        action: Type.Literal("inspect-and-revise"),
        toolName: Type.Literal("opendesign_inspect_document"),
        required: Type.Literal(true),
      },
      { additionalProperties: false },
    ),
    ...FailureAttemptFields,
  },
  { additionalProperties: false },
);

export const AgentToolValidationFailureDetailsSchema = Type.Object(
  {
    kind: Type.Literal("tool-validation"),
    fingerprint: AgentIdSchema,
    issues: Type.Array(AgentToolFailureIssueSchema, {
      minItems: 1,
      maxItems: 128,
    }),
    recovery: Type.Object(
      {
        action: Type.Literal("correct-and-retry"),
        required: Type.Literal(false),
      },
      { additionalProperties: false },
    ),
    ...FailureAttemptFields,
  },
  { additionalProperties: false },
);

export const DesignWorkflowFailureDetailsSchema =
  createDesignWorkflowFailureDetailsSchema(
    AgentToolFailureIssueSchema,
    FailureAttemptFields,
  );

export const AgentToolFailureDetailsSchema = Type.Union([
  DesignTransactionFailureDetailsSchema,
  AgentToolValidationFailureDetailsSchema,
  DesignWorkflowFailureDetailsSchema,
]);

export const AgentToolFailureDetailsContract = defineContract<
  Static<typeof AgentToolFailureDetailsSchema>
>({
  schema: AgentToolFailureDetailsSchema,
  code: "agent_tool_failure_details.schema_invalid",
  subject: "Agent tool failure details",
  recovery: "Correct the reported Agent tool failure details field.",
  clone: false,
});

export const ToolFailureFields = {
  code: AgentIdSchema,
  message: Type.String({ minLength: 1, maxLength: 20_000 }),
  retryable: Type.Optional(Type.Boolean()),
  recoverable: Type.Optional(Type.Boolean()),
  details: Type.Optional(AgentToolFailureDetailsSchema),
};

export const AgentRunFailureSchema = Type.Object(
  {
    code: AgentIdSchema,
    message: Type.String({ minLength: 1, maxLength: 20_000 }),
    retryable: Type.Boolean(),
    provider: Type.Optional(AgentIdSchema),
    providerRequestId: Type.Optional(AgentIdSchema),
    modelRequestId: Type.Optional(AgentIdSchema),
    timeout: Type.Optional(
      Type.Object(
        {
          phase: Type.Union([
            Type.Literal("first-response"),
            Type.Literal("stream-idle"),
            Type.Literal("total"),
          ]),
          thresholdMs: Type.Integer({ minimum: 1, maximum: 86_400_000 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type AgentToolFailureIssue = Static<typeof AgentToolFailureIssueSchema>;
export type AgentToolFailureDetails = Static<
  typeof AgentToolFailureDetailsSchema
>;
export type AgentRunFailure = Static<typeof AgentRunFailureSchema>;

export const AgentRunFailureContract = defineContract<AgentRunFailure>({
  schema: AgentRunFailureSchema,
  code: "agent_run_failure.schema_invalid",
  subject: "Agent run failure",
  recovery: "Correct the reported Agent run failure field.",
  clone: false,
});

export function isAgentRunFailure(value: unknown): value is AgentRunFailure {
  return AgentRunFailureContract.parse(value).ok;
}

export function isAgentToolFailureDetails(
  value: unknown,
): value is AgentToolFailureDetails {
  return AgentToolFailureDetailsContract.parse(value).ok;
}
