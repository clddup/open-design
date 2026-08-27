import { Type, type Static } from "@sinclair/typebox";
import { AgentContinuationSchemas } from "./continuation.js";
import {
  AgentAttachmentsSchema,
  ModelSelectionSchema,
  ResolvedModelIdentitySchema,
} from "./agent-request.js";
import { AgentRunFailureSchema, ToolFailureFields } from "./tool-failure.js";
import {
  AgentIdSchema as IdSchema,
  ApprovalDecisionSchema,
  ApprovalIdSchema,
  DesignMutationTargetSchema,
  MessageIdSchema,
  ProgressSchema,
  RevisionSchema,
  RunIdSchema,
  SelectionScopeSchema,
  SequenceSchema,
  SessionIdSchema,
  TimestampSchema,
  ToolCallIdSchema,
  TransactionIdSchema,
} from "./wire-foundations.js";

export const MAX_ASSISTANT_TEXT_BLOCK_CHARACTERS = 500_000;
export const MAX_REASONING_SUMMARY_CHARACTERS = 20_000;

const EmptyObjectSchema = Type.Object({}, { additionalProperties: false });

export const ToolRiskSchema = Type.Union([
  Type.Literal("read"),
  Type.Literal("design_write"),
  Type.Literal("external"),
  Type.Literal("destructive"),
]);

export const RunStopReasonSchema = Type.Union([
  Type.Literal("complete"),
  Type.Literal("cancelled"),
  Type.Literal("error"),
  Type.Literal("budget"),
]);

export const ReasoningSummarySchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("streaming"),
      Type.Literal("completed"),
      Type.Literal("omitted"),
    ]),
    summary: Type.Optional(Type.String({ maxLength: 20_000 })),
  },
  { additionalProperties: false },
);

export const AssistantTimelineBlockSchema = Type.Union([
  Type.Object(
    {
      blockId: IdSchema,
      type: Type.Literal("text"),
      text: Type.String({ maxLength: MAX_ASSISTANT_TEXT_BLOCK_CHARACTERS }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      blockId: IdSchema,
      type: Type.Literal("reasoning_summary"),
      status: ReasoningSummarySchema.properties.status,
      summary: Type.Optional(
        Type.String({ maxLength: MAX_REASONING_SUMMARY_CHARACTERS }),
      ),
    },
    { additionalProperties: false },
  ),
]);

const TimelineItemBase = {
  itemId: IdSchema,
  sessionId: SessionIdSchema,
  runId: Type.Optional(RunIdSchema),
  sequence: SequenceSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};

export const UserMessageTimelineItemSchema = Type.Object(
  {
    ...TimelineItemBase,
    type: Type.Literal("user.message"),
    messageId: MessageIdSchema,
    content: Type.String({ minLength: 1, maxLength: 200_000 }),
    attachments: Type.Optional(AgentAttachmentsSchema),
    documentId: IdSchema,
    revision: RevisionSchema,
    scope: SelectionScopeSchema,
    mutationTarget: Type.Optional(DesignMutationTargetSchema),
  },
  { additionalProperties: false },
);

export const AssistantMessageTimelineItemSchema = Type.Object(
  {
    ...TimelineItemBase,
    type: Type.Literal("assistant.message"),
    messageId: MessageIdSchema,
    blocks: Type.Array(AssistantTimelineBlockSchema, { maxItems: 1_024 }),
  },
  { additionalProperties: false },
);

export const ToolTimelineItemSchema = Type.Object(
  {
    ...TimelineItemBase,
    type: Type.Literal("tool"),
    toolCallId: ToolCallIdSchema,
    toolName: IdSchema,
    input: Type.Unknown(),
    risk: ToolRiskSchema,
    status: Type.Union([
      Type.Literal("requested"),
      Type.Literal("running"),
      Type.Literal("completed"),
      Type.Literal("failed"),
    ]),
    progress: Type.Optional(ProgressSchema),
    progressMessage: Type.Optional(Type.String({ maxLength: 20_000 })),
    result: Type.Optional(Type.Unknown()),
    error: Type.Optional(
      Type.Object(
        {
          ...ToolFailureFields,
        },
        { additionalProperties: false },
      ),
    ),
    revision: Type.Optional(RevisionSchema),
    transactionId: Type.Optional(TransactionIdSchema),
  },
  { additionalProperties: false },
);

export const ApprovalTimelineItemSchema = Type.Object(
  {
    ...TimelineItemBase,
    type: Type.Literal("approval"),
    approvalId: ApprovalIdSchema,
    toolCallId: ToolCallIdSchema,
    title: Type.String({ minLength: 1, maxLength: 2_000 }),
    summary: Type.String({ maxLength: 20_000 }),
    status: Type.Union([Type.Literal("requested"), Type.Literal("resolved")]),
    decision: Type.Optional(ApprovalDecisionSchema),
    resolvedAt: Type.Optional(TimestampSchema),
  },
  { additionalProperties: false },
);

export const DesignRevisionTimelineItemSchema = Type.Object(
  {
    ...TimelineItemBase,
    type: Type.Literal("design.revision"),
    documentId: IdSchema,
    previousRevision: RevisionSchema,
    revision: RevisionSchema,
    transactionId: TransactionIdSchema,
    toolCallId: Type.Optional(ToolCallIdSchema),
  },
  { additionalProperties: false },
);

export const RunTimelineItemSchema = Type.Object(
  {
    ...TimelineItemBase,
    type: Type.Literal("run"),
    runId: RunIdSchema,
    status: Type.Union([
      Type.Literal("started"),
      Type.Literal("completed"),
      Type.Literal("cancelled"),
      Type.Literal("error"),
      Type.Literal("budget"),
    ]),
    startedAt: TimestampSchema,
    finishedAt: Type.Optional(TimestampSchema),
    stopReason: Type.Optional(RunStopReasonSchema),
    modelSelection: Type.Optional(ModelSelectionSchema),
    failure: Type.Optional(AgentRunFailureSchema),
    continuation: Type.Optional(AgentContinuationSchemas.run),
  },
  { additionalProperties: false },
);

export const SessionTimelineItemSchema = Type.Union([
  UserMessageTimelineItemSchema,
  AssistantMessageTimelineItemSchema,
  ToolTimelineItemSchema,
  ApprovalTimelineItemSchema,
  DesignRevisionTimelineItemSchema,
  RunTimelineItemSchema,
]);

const DurableEventBase = {
  eventId: IdSchema,
  sessionId: SessionIdSchema,
  runId: Type.Optional(RunIdSchema),
  sequence: SequenceSchema,
  createdAt: TimestampSchema,
};

export const DurableTimelineEventSchema = Type.Union([
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("session.created"),
      payload: EmptyObjectSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("run.state"),
      runId: RunIdSchema,
      payload: Type.Object(
        {
          status: Type.Union([
            Type.Literal("started"),
            Type.Literal("completed"),
            Type.Literal("cancelled"),
            Type.Literal("error"),
            Type.Literal("budget"),
          ]),
          startedAt: TimestampSchema,
          finishedAt: Type.Optional(TimestampSchema),
          stopReason: Type.Optional(RunStopReasonSchema),
          modelSelection: Type.Optional(ModelSelectionSchema),
          failure: Type.Optional(AgentRunFailureSchema),
          continuation: Type.Optional(AgentContinuationSchemas.run),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("message.user"),
      runId: RunIdSchema,
      payload: Type.Object(
        {
          messageId: MessageIdSchema,
          content: Type.String({ minLength: 1, maxLength: 200_000 }),
          attachments: Type.Optional(AgentAttachmentsSchema),
          documentId: IdSchema,
          revision: RevisionSchema,
          scope: SelectionScopeSchema,
          mutationTarget: Type.Optional(DesignMutationTargetSchema),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("message.assistant"),
      runId: RunIdSchema,
      payload: Type.Object(
        {
          messageId: MessageIdSchema,
          blocks: Type.Array(AssistantTimelineBlockSchema, {
            maxItems: 1_024,
          }),
          source: Type.Optional(ResolvedModelIdentitySchema),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("tool.requested"),
      runId: RunIdSchema,
      payload: Type.Object(
        {
          toolCallId: ToolCallIdSchema,
          toolName: IdSchema,
          input: Type.Unknown(),
          risk: ToolRiskSchema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("tool.progress"),
      runId: RunIdSchema,
      payload: Type.Object(
        {
          toolCallId: ToolCallIdSchema,
          message: Type.String({ maxLength: 20_000 }),
          progress: ProgressSchema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("tool.completed"),
      runId: RunIdSchema,
      payload: Type.Object(
        {
          toolCallId: ToolCallIdSchema,
          result: Type.Unknown(),
          revision: Type.Optional(RevisionSchema),
          transactionId: Type.Optional(TransactionIdSchema),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("tool.failed"),
      runId: RunIdSchema,
      payload: Type.Object(
        {
          toolCallId: ToolCallIdSchema,
          ...ToolFailureFields,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("approval.requested"),
      runId: RunIdSchema,
      payload: Type.Object(
        {
          approvalId: ApprovalIdSchema,
          toolCallId: ToolCallIdSchema,
          title: Type.String({ minLength: 1, maxLength: 2_000 }),
          summary: Type.String({ maxLength: 20_000 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("approval.resolved"),
      runId: RunIdSchema,
      payload: Type.Object(
        {
          approvalId: ApprovalIdSchema,
          toolCallId: ToolCallIdSchema,
          decision: ApprovalDecisionSchema,
          resolvedAt: TimestampSchema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("design.revision"),
      runId: RunIdSchema,
      payload: Type.Object(
        {
          documentId: IdSchema,
          previousRevision: RevisionSchema,
          revision: RevisionSchema,
          transactionId: TransactionIdSchema,
          toolCallId: Type.Optional(ToolCallIdSchema),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...DurableEventBase,
      type: Type.Literal("context.compacted"),
      payload: Type.Object(
        {
          fromSequence: SequenceSchema,
          toSequence: SequenceSchema,
          summary: Type.Optional(Type.String({ maxLength: 200_000 })),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);

export type ToolRisk = Static<typeof ToolRiskSchema>;
export type RunStopReason = Static<typeof RunStopReasonSchema>;
export type ReasoningSummary = Static<typeof ReasoningSummarySchema>;
export type AssistantTimelineBlock = Static<
  typeof AssistantTimelineBlockSchema
>;
export type SessionTimelineItem = Static<typeof SessionTimelineItemSchema>;
export type DurableTimelineEvent = Static<typeof DurableTimelineEventSchema>;
