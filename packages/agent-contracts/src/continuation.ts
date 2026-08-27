import { Type, type Static } from "@sinclair/typebox";
import { defineContract } from "@opendesign/contract-runtime";

const ContinuationRunIdSchema = Type.String({ minLength: 1, maxLength: 256 });

export const AgentContinuationReasonSchema = Type.Union([
  Type.Literal("incomplete"),
  Type.Literal("budget"),
  Type.Literal("retryable-error"),
  Type.Literal("non-retryable-error"),
]);

export const AgentRunContinuationSchema = Type.Object(
  {
    parentRunId: ContinuationRunIdSchema,
    rootRunId: ContinuationRunIdSchema,
    attempt: Type.Integer({ minimum: 1, maximum: 3 }),
    maxAttempts: Type.Literal(3),
    reason: AgentContinuationReasonSchema,
  },
  { additionalProperties: false },
);

export const AgentRunStartedEventSchema = Type.Object(
  {
    type: Type.Literal("run.started"),
    runId: ContinuationRunIdSchema,
    startedAt: Type.String({ minLength: 1, maxLength: 64 }),
    continuation: Type.Optional(AgentRunContinuationSchema),
  },
  { additionalProperties: false },
);

const AgentContinuationEventFields = {
  type: Type.Literal("run.continuation"),
  runId: ContinuationRunIdSchema,
  attempt: Type.Integer({ minimum: 1, maximum: 3 }),
  maxAttempts: Type.Literal(3),
  reason: AgentContinuationReasonSchema,
};

export const AgentRunContinuationEventSchema = Type.Union([
  Type.Object(
    {
      ...AgentContinuationEventFields,
      status: Type.Literal("scheduled"),
      nextRunId: ContinuationRunIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...AgentContinuationEventFields,
      status: Type.Literal("needs_attention"),
      nextRunId: Type.Optional(ContinuationRunIdSchema),
    },
    { additionalProperties: false },
  ),
]);

export const AgentContinuationSchemas = {
  reason: AgentContinuationReasonSchema,
  run: AgentRunContinuationSchema,
  startedEvent: AgentRunStartedEventSchema,
  continuationEvent: AgentRunContinuationEventSchema,
} as const;

export type AgentContinuationReason = Static<
  typeof AgentContinuationReasonSchema
>;
export type AgentRunContinuation = Static<typeof AgentRunContinuationSchema>;

export const AgentRunContinuationContract =
  defineContract<AgentRunContinuation>({
    schema: AgentRunContinuationSchema,
    code: "agent_run_continuation.schema_invalid",
    subject: "Agent run continuation",
    recovery: "Correct the reported Agent run continuation field.",
    clone: false,
  });
