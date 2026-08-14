import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AgentContinuationSchemas } from "./continuation.js";
export type { AgentRunContinuation } from "./continuation.js";

export const AGENT_PROTOCOL_VERSION = "3.10.0" as const;
export const MAX_SELECTED_NODE_IDS = 512;
export const MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS = 60_000;
export const MAX_AGENT_ATTACHMENTS = 6;
export const MAX_AGENT_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_AGENT_IMAGE_ATTACHMENTS = MAX_AGENT_ATTACHMENTS;
export const MAX_AGENT_IMAGE_BYTES = MAX_AGENT_ATTACHMENT_BYTES;

const IdSchema = Type.String({ minLength: 1, maxLength: 256 });
const TimestampSchema = Type.String({ minLength: 1, maxLength: 64 });
const RevisionSchema = Type.Integer({ minimum: 0 });
const SequenceSchema = Type.Integer({ minimum: 1 });
const ProgressSchema = Type.Number({ minimum: 0, maximum: 1 });
const EmptyObjectSchema = Type.Object({}, { additionalProperties: false });

export const AgentToolFailureIssueSchema = Type.Object(
  {
    commandId: Type.Optional(IdSchema),
    nodeId: Type.Optional(IdSchema),
    path: Type.String({ maxLength: 4_000 }),
    message: Type.String({ minLength: 1, maxLength: 20_000 }),
  },
  { additionalProperties: false },
);

export const AgentToolFailureDetailsSchema = Type.Object(
  {
    kind: Type.Literal("design-transaction"),
    fingerprint: IdSchema,
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
    attempt: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    maxAttempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    retrySuppressed: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const ToolFailureFields = {
  code: IdSchema,
  message: Type.String({ minLength: 1, maxLength: 20_000 }),
  retryable: Type.Optional(Type.Boolean()),
  recoverable: Type.Optional(Type.Boolean()),
  details: Type.Optional(AgentToolFailureDetailsSchema),
};

export const AgentRunFailureSchema = Type.Object(
  {
    code: IdSchema,
    message: Type.String({ minLength: 1, maxLength: 20_000 }),
    retryable: Type.Boolean(),
    provider: Type.Optional(IdSchema),
    providerRequestId: Type.Optional(IdSchema),
    modelRequestId: Type.Optional(IdSchema),
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

export const AgentImageAttachmentSchema = Type.Object(
  {
    attachmentId: Type.String({ pattern: "^image_[a-f0-9]{64}$" }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.Union([
      Type.Literal("image/png"),
      Type.Literal("image/jpeg"),
      Type.Literal("image/webp"),
      Type.Literal("image/gif"),
    ]),
    byteSize: Type.Integer({
      minimum: 1,
      maximum: MAX_AGENT_ATTACHMENT_BYTES,
    }),
  },
  { additionalProperties: false },
);

export const AgentDocumentAttachmentSchema = Type.Object(
  {
    attachmentId: Type.String({ pattern: "^file_[a-f0-9]{64}$" }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.Union([
      Type.Literal("application/pdf"),
      Type.Literal(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      Type.Literal("text/plain"),
      Type.Literal("text/markdown"),
      Type.Literal("text/csv"),
      Type.Literal("text/html"),
      Type.Literal("application/json"),
      Type.Literal("application/yaml"),
    ]),
    byteSize: Type.Integer({
      minimum: 1,
      maximum: MAX_AGENT_ATTACHMENT_BYTES,
    }),
  },
  { additionalProperties: false },
);

export const AgentSvgAttachmentSchema = Type.Object(
  {
    attachmentId: Type.String({ pattern: "^svg_[a-f0-9]{64}$" }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.Literal("image/svg+xml"),
    byteSize: Type.Integer({
      minimum: 1,
      maximum: MAX_AGENT_ATTACHMENT_BYTES,
    }),
  },
  { additionalProperties: false },
);

export const AgentAttachmentSchema = Type.Union([
  AgentImageAttachmentSchema,
  AgentDocumentAttachmentSchema,
  AgentSvgAttachmentSchema,
]);

const AgentAttachmentsSchema = Type.Array(AgentAttachmentSchema, {
  maxItems: MAX_AGENT_ATTACHMENTS,
});

export const ModelSelectionSchema = Type.Object(
  {
    providerId: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$",
    }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    reasoningEffort: Type.Optional(
      Type.Union([
        Type.Literal("off"),
        Type.Literal("minimal"),
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("xhigh"),
        Type.Literal("max"),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const AgentModelContextSchema = Type.Object(
  {
    contextWindow: Type.Integer({ minimum: 1_024, maximum: 10_000_000 }),
    maxOutputTokens: Type.Integer({ minimum: 1, maximum: 2_000_000 }),
  },
  { additionalProperties: false },
);

export const AgentInitialDesignInspectionSchema = Type.Object(
  {
    version: Type.Literal(1),
    observedRevision: RevisionSchema,
    content: Type.String({
      minLength: 2,
      maxLength: MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS,
    }),
  },
  { additionalProperties: false },
);

export const ResolvedModelIdentitySchema = Type.Object(
  {
    ...ModelSelectionSchema.properties,
    apiFormat: Type.Union([
      Type.Literal("openai-responses"),
      Type.Literal("openai-chat-completions"),
      Type.Literal("anthropic-messages"),
    ]),
    responseId: Type.Optional(IdSchema),
  },
  { additionalProperties: false },
);

export const RunIdSchema = Type.String({
  minLength: 1,
  maxLength: 256,
});
export const ToolCallIdSchema = Type.String({
  minLength: 1,
  maxLength: 256,
});
export const SessionIdSchema = IdSchema;
export const MessageIdSchema = IdSchema;
export const ApprovalIdSchema = IdSchema;
export const TransactionIdSchema = IdSchema;

const SelectedNodeIdsSchema = Type.Array(IdSchema, {
  maxItems: MAX_SELECTED_NODE_IDS,
  uniqueItems: true,
});

export const SelectionScopeSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("selection"),
      selectedNodeIds: Type.Array(IdSchema, {
        minItems: 1,
        maxItems: MAX_SELECTED_NODE_IDS,
        uniqueItems: true,
      }),
      primaryNodeId: Type.Optional(IdSchema),
      pageId: Type.Optional(IdSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("page"),
      selectedNodeIds: SelectedNodeIdsSchema,
      primaryNodeId: Type.Optional(IdSchema),
      pageId: IdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("document"),
      selectedNodeIds: SelectedNodeIdsSchema,
      primaryNodeId: Type.Optional(IdSchema),
      pageId: Type.Optional(IdSchema),
    },
    { additionalProperties: false },
  ),
]);

export const DesignMutationTargetSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("page"),
      pageId: IdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("document"),
    },
    { additionalProperties: false },
  ),
]);

export const ApprovalDecisionSchema = Type.Union([
  Type.Literal("allow_once"),
  Type.Literal("allow_session"),
  Type.Literal("deny"),
]);

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
      text: Type.String({ maxLength: 500_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      blockId: IdSchema,
      type: Type.Literal("reasoning_summary"),
      status: ReasoningSummarySchema.properties.status,
      summary: Type.Optional(Type.String({ maxLength: 20_000 })),
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

export const AgentRequestSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("handshake"),
      protocolVersion: Type.String({ minLength: 1, maxLength: 64 }),
      clientVersion: Type.String({ minLength: 1, maxLength: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("run.start"),
      runId: RunIdSchema,
      sessionId: SessionIdSchema,
      prompt: Type.String({ minLength: 1, maxLength: 200_000 }),
      attachments: Type.Optional(AgentAttachmentsSchema),
      documentId: IdSchema,
      revision: RevisionSchema,
      scope: SelectionScopeSchema,
      mutationTarget: DesignMutationTargetSchema,
      modelSelection: ModelSelectionSchema,
      modelContext: Type.Optional(AgentModelContextSchema),
      initialDesignInspection: Type.Optional(
        AgentInitialDesignInspectionSchema,
      ),
      continuation: Type.Optional(AgentContinuationSchemas.run),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("run.cancel"),
      runId: RunIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("approval.resolve"),
      runId: RunIdSchema,
      toolCallId: ToolCallIdSchema,
      approvalId: ApprovalIdSchema,
      decision: ApprovalDecisionSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("session.history"),
      requestId: IdSchema,
      sessionId: SessionIdSchema,
    },
    { additionalProperties: false },
  ),
]);

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

export type SelectionScope = Static<typeof SelectionScopeSchema>;
export type DesignMutationTarget = Static<typeof DesignMutationTargetSchema>;
export type ApprovalDecision = Static<typeof ApprovalDecisionSchema>;
export type ToolRisk = Static<typeof ToolRiskSchema>;
export type RunStopReason = Static<typeof RunStopReasonSchema>;
export type ReasoningSummary = Static<typeof ReasoningSummarySchema>;
export type AssistantTimelineBlock = Static<
  typeof AssistantTimelineBlockSchema
>;
export type SessionTimelineItem = Static<typeof SessionTimelineItemSchema>;
export type AgentAttachment = Static<typeof AgentAttachmentSchema>;
export type AgentImageAttachment = Static<typeof AgentImageAttachmentSchema>;
export type AgentDocumentAttachment = Static<
  typeof AgentDocumentAttachmentSchema
>;
export type AgentSvgAttachment = Static<typeof AgentSvgAttachmentSchema>;
export type DurableTimelineEvent = Static<typeof DurableTimelineEventSchema>;
export type AgentRequest = Static<typeof AgentRequestSchema>;
export type AgentEvent = Static<typeof AgentEventSchema>;
export type AgentModelSelection = Static<typeof ModelSelectionSchema>;
export type AgentModelContext = Static<typeof AgentModelContextSchema>;
export type AgentInitialDesignInspection = Static<
  typeof AgentInitialDesignInspectionSchema
>;
export type AgentToolFailureIssue = Static<typeof AgentToolFailureIssueSchema>;
export type AgentToolFailureDetails = Static<
  typeof AgentToolFailureDetailsSchema
>;
export type AgentRunFailure = Static<typeof AgentRunFailureSchema>;

export function isAgentRunFailure(value: unknown): value is AgentRunFailure {
  return Value.Check(AgentRunFailureSchema, value);
}

export function isAgentAttachment(value: unknown): value is AgentAttachment {
  return Value.Check(AgentAttachmentSchema, value);
}

export function isSelectionScope(value: unknown): value is SelectionScope {
  if (!Value.Check(SelectionScopeSchema, value)) return false;
  return (
    value.primaryNodeId === undefined ||
    value.selectedNodeIds.includes(value.primaryNodeId)
  );
}

export function isDesignMutationTarget(
  value: unknown,
): value is DesignMutationTarget {
  return Value.Check(DesignMutationTargetSchema, value);
}

export function isAgentToolFailureDetails(
  value: unknown,
): value is AgentToolFailureDetails {
  return Value.Check(AgentToolFailureDetailsSchema, value);
}

export function isDurableTimelineEvent(
  value: unknown,
): value is DurableTimelineEvent {
  return (
    Value.Check(DurableTimelineEventSchema, value) &&
    (value.type !== "message.user" || isSelectionScope(value.payload.scope)) &&
    (value.type !== "run.state" ||
      value.payload.failure === undefined ||
      (value.payload.status === "error" &&
        value.payload.stopReason === "error"))
  );
}

export function isAgentRequest(value: unknown): value is AgentRequest {
  return (
    Value.Check(AgentRequestSchema, value) &&
    (value.type !== "run.start" ||
      ((value.initialDesignInspection === undefined ||
        value.initialDesignInspection.observedRevision === value.revision) &&
        isSelectionScope(value.scope) &&
        isDesignMutationTarget(value.mutationTarget) &&
        (value.mutationTarget.kind !== "page" ||
          value.scope.pageId === undefined ||
          value.scope.pageId === value.mutationTarget.pageId)))
  );
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  return (
    Value.Check(AgentEventSchema, value) &&
    (value.type !== "agent.error" ||
      value.failure === undefined ||
      (value.failure.code === value.code &&
        value.failure.message === value.message)) &&
    (value.type !== "session.history" ||
      value.timeline.every(
        (item) =>
          (item.type !== "user.message" || isSelectionScope(item.scope)) &&
          (item.type !== "run" ||
            item.failure === undefined ||
            (item.status === "error" && item.stopReason === "error")),
      ))
  );
}

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: T;
}

export interface JsonRpcSuccess<T = unknown> {
  jsonrpc: "2.0";
  id: string;
  result: T;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: "2.0";
  method: string;
  params: T;
}
