import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  defineContract,
  formatContractFailure,
  selectDiscriminatedUnionSchema,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { AgentContinuationSchemas } from "./continuation.js";
import {
  AssistantTimelineBlockSchema,
  RunStopReasonSchema,
  SessionTimelineItemSchema,
  ToolRiskSchema,
} from "./agent-timeline-schema.js";
import { sessionTimelineItemDomainIssues } from "./agent-timeline.js";
import { designWorkflowFailureDomainIssues } from "./workflow-failure-contract.js";
import { AgentRunFailureSchema, ToolFailureFields } from "./tool-failure.js";
import {
  AgentIdSchema as IdSchema,
  ApprovalDecisionSchema,
  ApprovalIdSchema,
  MessageIdSchema,
  ProgressSchema,
  RevisionSchema,
  RunIdSchema,
  SessionIdSchema,
  TimestampSchema,
  ToolCallIdSchema,
  TransactionIdSchema,
} from "./wire-foundations.js";

export const AgentEventSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("agent.ready"),
      protocolVersion: Type.String({ minLength: 1, maxLength: 64 }),
      runtimeVersion: Type.String({ minLength: 1, maxLength: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("agent.connected"),
      protocolVersion: Type.String({ minLength: 1, maxLength: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("agent.error"),
      code: IdSchema,
      message: Type.String({ minLength: 1, maxLength: 20_000 }),
      runId: Type.Optional(RunIdSchema),
      requestId: Type.Optional(IdSchema),
      failure: Type.Optional(AgentRunFailureSchema),
    },
    { additionalProperties: false },
  ),
  AgentContinuationSchemas.startedEvent,
  AgentContinuationSchemas.continuationEvent,
  Type.Object(
    {
      type: Type.Literal("model.retrying"),
      runId: RunIdSchema,
      retry: Type.Integer({ minimum: 1, maximum: 5 }),
      maxRetries: Type.Literal(5),
      delayMs: Type.Integer({ minimum: 1, maximum: 60_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("model.recovered"),
      runId: RunIdSchema,
      retriesUsed: Type.Integer({ minimum: 1, maximum: 5 }),
      maxRetries: Type.Literal(5),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("message.delta"),
      runId: RunIdSchema,
      messageId: MessageIdSchema,
      blockId: IdSchema,
      delta: Type.String({ maxLength: 200_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("message.completed"),
      runId: RunIdSchema,
      messageId: MessageIdSchema,
      blocks: Type.Array(AssistantTimelineBlockSchema, { maxItems: 1_024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("tool.requested"),
      runId: RunIdSchema,
      toolCallId: ToolCallIdSchema,
      toolName: IdSchema,
      input: Type.Unknown(),
      risk: ToolRiskSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("approval.requested"),
      runId: RunIdSchema,
      toolCallId: ToolCallIdSchema,
      approvalId: ApprovalIdSchema,
      title: Type.String({ minLength: 1, maxLength: 2_000 }),
      summary: Type.String({ maxLength: 20_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("approval.resolved"),
      runId: RunIdSchema,
      toolCallId: ToolCallIdSchema,
      approvalId: ApprovalIdSchema,
      decision: ApprovalDecisionSchema,
      resolvedAt: TimestampSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("tool.progress"),
      runId: RunIdSchema,
      toolCallId: ToolCallIdSchema,
      message: Type.String({ maxLength: 20_000 }),
      progress: ProgressSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("tool.completed"),
      runId: RunIdSchema,
      toolCallId: ToolCallIdSchema,
      result: Type.Unknown(),
      revision: Type.Optional(RevisionSchema),
      transactionId: Type.Optional(TransactionIdSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("tool.failed"),
      runId: RunIdSchema,
      toolCallId: ToolCallIdSchema,
      ...ToolFailureFields,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("run.completed"),
      runId: RunIdSchema,
      finishedAt: TimestampSchema,
      stopReason: RunStopReasonSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("session.history"),
      requestId: IdSchema,
      sessionId: SessionIdSchema,
      timeline: Type.Array(SessionTimelineItemSchema, { maxItems: 100_000 }),
    },
    { additionalProperties: false },
  ),
]);

const AgentEventRunIdentitySchema = Type.Object(
  { runId: RunIdSchema },
  { additionalProperties: true },
);
const AgentEventRequestIdentitySchema = Type.Object(
  { requestId: IdSchema },
  { additionalProperties: true },
);

export type AgentEvent = Static<typeof AgentEventSchema>;

export const AgentEventContract = defineContract<AgentEvent>({
  schema: AgentEventSchema,
  code: "agent_event.schema_invalid",
  subject: "Agent event",
  recovery: "Correct the reported Agent event field before retrying.",
  selectSchema: agentEventSchemaForInput,
  refine: agentEventDomainIssues,
  clone: false,
});

export function isAgentEvent(value: unknown): value is AgentEvent {
  return AgentEventContract.parse(value).ok;
}

export function agentEventValidationError(value: unknown): string | null {
  const result = AgentEventContract.parse(value);
  if (result.ok) return null;
  return formatContractFailure(
    `Agent event ${agentEventType(value)}`,
    result.issues,
  );
}

export function agentEventRunId(value: unknown): string | null {
  return Value.Check(AgentEventRunIdentitySchema, value) ? value.runId : null;
}

export function agentEventRequestId(value: unknown): string | null {
  return Value.Check(AgentEventRequestIdentitySchema, value)
    ? value.requestId
    : null;
}

function agentEventDomainIssues(value: AgentEvent): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value.type === "tool.failed") {
    issues.push(...designWorkflowFailureDomainIssues(value, ""));
  }
  if (value.type === "agent.error" && value.failure !== undefined) {
    if (value.failure.code !== value.code) {
      issues.push(
        agentEventIssue(
          "agent_event.failure_code_mismatch",
          "/failure/code",
          "Nested failure code must match the Agent error code",
        ),
      );
    }
    if (value.failure.message !== value.message) {
      issues.push(
        agentEventIssue(
          "agent_event.failure_message_mismatch",
          "/failure/message",
          "Nested failure message must match the Agent error message",
        ),
      );
    }
  }
  if (value.type === "session.history") {
    value.timeline.forEach((item, index) => {
      issues.push(
        ...sessionTimelineItemDomainIssues(
          item,
          `/timeline/${index}`,
          {
            primarySelection: "agent_event.history_primary_selection_invalid",
            failureState: "agent_event.history_failure_state_invalid",
          },
          "Correct the reported Agent event field before retrying.",
        ),
      );
    });
  }
  return issues;
}

function agentEventIssue(
  code: string,
  path: string,
  message: string,
): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery: "Correct the reported Agent event field before retrying.",
  };
}

function agentEventSchemaForInput(value: unknown): TSchema | undefined {
  return selectDiscriminatedUnionSchema(AgentEventSchema, value, "type");
}

function agentEventType(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
    ? value.type.slice(0, 256)
    : "unknown";
}
