import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  defineContract,
  formatContractFailure,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { AgentContinuationSchemas } from "./continuation.js";
import {
  createDesignWorkflowFailureDetailsSchema,
  designWorkflowFailureDomainIssues,
} from "./workflow-failure-contract.js";
export {
  DESIGN_WORKFLOW_FAILURE_CODES,
  DESIGN_WORKFLOW_FAILURE_DEFINITIONS,
  DesignWorkflowFailureCodeSchema,
  designWorkflowFailureDefinition,
  type DesignWorkflowFailureCode,
  type DesignWorkflowFailurePhase,
} from "./workflow-failure-contract.js";
export type { AgentRunContinuation } from "./continuation.js";
export { AgentRunContinuationContract } from "./continuation.js";
export { formatContractFailure as formatRuntimeContractFailure } from "@opendesign/contract-runtime";
export type {
  Contract as RuntimeContract,
  ValidationIssue as RuntimeContractIssue,
  ValidationResult as RuntimeContractResult,
} from "@opendesign/contract-runtime";

export const AGENT_PROTOCOL_VERSION = "3.12.0" as const;
export const MAX_SELECTED_NODE_IDS = 512;
export const MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS = 60_000;
export const MAX_AGENT_ATTACHMENTS = 6;
export const MAX_AGENT_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_AGENT_IMAGE_ATTACHMENTS = MAX_AGENT_ATTACHMENTS;
export const MAX_AGENT_IMAGE_BYTES = MAX_AGENT_ATTACHMENT_BYTES;
export const MAX_ASSISTANT_TEXT_BLOCK_CHARACTERS = 500_000;
export const MAX_REASONING_SUMMARY_CHARACTERS = 20_000;

const IdSchema = Type.String({ minLength: 1, maxLength: 256 });
const TimestampSchema = Type.String({ minLength: 1, maxLength: 64 });
const RevisionSchema = Type.Integer({ minimum: 0 });
const SequenceSchema = Type.Integer({ minimum: 1 });
const ProgressSchema = Type.Number({ minimum: 0, maximum: 1 });
const EmptyObjectSchema = Type.Object({}, { additionalProperties: false });
const DeliveryScopeReviewSchema = Type.Union([
  Type.Literal("direct"),
  Type.Literal("required"),
]);
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
    code: Type.Optional(IdSchema),
    commandId: Type.Optional(IdSchema),
    nodeId: Type.Optional(IdSchema),
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
    ...FailureAttemptFields,
  },
  { additionalProperties: false },
);

export const AgentToolValidationFailureDetailsSchema = Type.Object(
  {
    kind: Type.Literal("tool-validation"),
    fingerprint: IdSchema,
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

export const DesignGenerationModeSchema = Type.Union([
  Type.Literal("fast"),
  Type.Literal("thorough"),
]);

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

export const ToolCallRequestSchema = Type.Object(
  {
    toolCallId: ToolCallIdSchema,
    toolName: IdSchema,
    input: Type.Unknown(),
  },
  { additionalProperties: false },
);

export const TrustedToolContextSchema = Type.Object(
  {
    runId: RunIdSchema,
    sessionId: SessionIdSchema,
    documentId: IdSchema,
    revision: RevisionSchema,
    scope: SelectionScopeSchema,
    mutationTarget: DesignMutationTargetSchema,
  },
  { additionalProperties: false },
);

export const TrustedToolFailureSchema = Type.Object(
  {
    code: IdSchema,
    message: Type.String({ minLength: 1, maxLength: 20_000 }),
    retryable: Type.Boolean(),
    recoverable: Type.Boolean(),
    runTerminal: Type.Optional(Type.Literal(true)),
    details: Type.Optional(AgentToolFailureDetailsSchema),
  },
  { additionalProperties: false },
);

export const TrustedToolFailureContract = defineContract<
  Static<typeof TrustedToolFailureSchema>
>({
  schema: TrustedToolFailureSchema,
  code: "trusted_tool_failure.schema_invalid",
  subject: "Trusted tool failure",
  recovery: "Correct the reported trusted tool failure field.",
  refine: (value) => designWorkflowFailureDomainIssues(value, ""),
  clone: false,
});

export const TrustedToolResultSchema = Type.Object(
  {
    content: Type.Unknown(),
    observedRevision: Type.Optional(RevisionSchema),
    designRevision: Type.Optional(
      Type.Object(
        {
          previousRevision: RevisionSchema,
          rebasedFromRevision: Type.Optional(RevisionSchema),
          revision: RevisionSchema,
          transactionId: TransactionIdSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

type TrustedToolResultValue = Static<typeof TrustedToolResultSchema>;

export const TrustedToolResultContract = defineContract<TrustedToolResultValue>(
  {
    schema: TrustedToolResultSchema,
    code: "trusted_tool_result.schema_invalid",
    subject: "Trusted tool result",
    recovery:
      "Reject the malformed tool result and preserve the last trusted revision.",
    refine: trustedToolResultDomainIssues,
    clone: false,
  },
);

export const ToolExecutionEventSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("progress"),
      message: Type.String({ minLength: 1, maxLength: 2_000 }),
      progress: ProgressSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("failed"),
      error: TrustedToolFailureSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("completed"),
      result: TrustedToolResultSchema,
    },
    { additionalProperties: false },
  ),
]);

export const DesignToolBridgeRequestSchema = Type.Object(
  {
    type: Type.Literal("design-tool.request"),
    requestId: IdSchema,
    call: ToolCallRequestSchema,
    context: TrustedToolContextSchema,
  },
  { additionalProperties: false },
);

export const DesignToolBridgeCancelSchema = Type.Object(
  {
    type: Type.Literal("design-tool.cancel"),
    requestId: IdSchema,
  },
  { additionalProperties: false },
);

export const DesignToolBridgeProgressSchema = Type.Object(
  {
    type: Type.Literal("design-tool.progress"),
    requestId: IdSchema,
    message: Type.String({ minLength: 1, maxLength: 2_000 }),
    progress: ProgressSchema,
  },
  { additionalProperties: false },
);

export const DesignToolBridgeResponseSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("design-tool.response"),
      requestId: IdSchema,
      ok: Type.Literal(true),
      result: TrustedToolResultSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("design-tool.response"),
      requestId: IdSchema,
      ok: Type.Literal(false),
      error: TrustedToolFailureSchema,
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
      generationMode: Type.Optional(DesignGenerationModeSchema),
      deliveryScopeReview: Type.Optional(DeliveryScopeReviewSchema),
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

const AgentEventRunIdentitySchema = Type.Object(
  { runId: RunIdSchema },
  { additionalProperties: true },
);
const AgentEventRequestIdentitySchema = Type.Object(
  { requestId: IdSchema },
  { additionalProperties: true },
);

export type SelectionScope = Static<typeof SelectionScopeSchema>;
export type DesignMutationTarget = Static<typeof DesignMutationTargetSchema>;
export type ToolCallRequest = Static<typeof ToolCallRequestSchema>;
export type TrustedToolContext = Static<typeof TrustedToolContextSchema>;
export type TrustedToolFailure = Static<typeof TrustedToolFailureSchema>;
export type TrustedToolResult = Static<typeof TrustedToolResultSchema>;
export type ToolExecutionEvent = Static<typeof ToolExecutionEventSchema>;
export type DesignToolBridgeRequest = Static<
  typeof DesignToolBridgeRequestSchema
>;
export type DesignToolBridgeCancel = Static<
  typeof DesignToolBridgeCancelSchema
>;
export type DesignToolBridgeProgress = Static<
  typeof DesignToolBridgeProgressSchema
>;
export type DesignToolBridgeResponse = Static<
  typeof DesignToolBridgeResponseSchema
>;
export type ApprovalDecision = Static<typeof ApprovalDecisionSchema>;
export type ToolRisk = Static<typeof ToolRiskSchema>;
export type RunStopReason = Static<typeof RunStopReasonSchema>;
export type ReasoningSummary = Static<typeof ReasoningSummarySchema>;
export type AssistantTimelineBlock = Static<
  typeof AssistantTimelineBlockSchema
>;
export type SessionTimelineItem = Static<typeof SessionTimelineItemSchema>;
export type AgentAttachment = Static<typeof AgentAttachmentSchema>;
export type DesignGenerationMode = Static<typeof DesignGenerationModeSchema>;
export type DeliveryScopeReview = Static<typeof DeliveryScopeReviewSchema>;
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

export const ModelSelectionContract = defineContract<AgentModelSelection>({
  schema: ModelSelectionSchema,
  code: "model_selection.schema_invalid",
  subject: "Model selection",
  recovery: "Correct the reported model selection field.",
  clone: false,
});

export const AgentRunFailureContract = defineContract<AgentRunFailure>({
  schema: AgentRunFailureSchema,
  code: "agent_run_failure.schema_invalid",
  subject: "Agent run failure",
  recovery: "Correct the reported Agent run failure field.",
  clone: false,
});

export const AgentAttachmentContract = defineContract<AgentAttachment>({
  schema: AgentAttachmentSchema,
  code: "agent_attachment.schema_invalid",
  subject: "Agent attachment",
  recovery: "Correct the reported Agent attachment field.",
  clone: false,
});

export const SelectionScopeContract = defineContract<SelectionScope>({
  schema: SelectionScopeSchema,
  code: "selection_scope.schema_invalid",
  subject: "Selection scope",
  recovery: "Correct the reported selection scope field.",
  refine: (value) => selectionScopeDomainIssues(value),
  clone: false,
});

export const DesignMutationTargetContract =
  defineContract<DesignMutationTarget>({
    schema: DesignMutationTargetSchema,
    code: "design_mutation_target.schema_invalid",
    subject: "Design mutation target",
    recovery: "Correct the reported design mutation target field.",
    clone: false,
  });

export const DurableTimelineEventContract =
  defineContract<DurableTimelineEvent>({
    schema: DurableTimelineEventSchema,
    code: "durable_timeline_event.schema_invalid",
    subject: "Durable timeline event",
    recovery: "Correct the reported durable timeline event field.",
    refine: durableTimelineEventDomainIssues,
    clone: false,
  });

export const SessionTimelineItemContract = defineContract<SessionTimelineItem>({
  schema: SessionTimelineItemSchema,
  code: "session_timeline_item.schema_invalid",
  subject: "Session timeline item",
  recovery: "Correct the reported session timeline item field.",
  refine: (value) => sessionTimelineItemDomainIssues(value),
  clone: false,
});

export const AgentEventContract = defineContract<AgentEvent>({
  schema: AgentEventSchema,
  code: "agent_event.schema_invalid",
  subject: "Agent event",
  recovery: "Correct the reported Agent event field before retrying.",
  selectSchema: agentEventSchemaForInput,
  refine: agentEventDomainIssues,
  clone: false,
});

export function isAgentRunFailure(value: unknown): value is AgentRunFailure {
  return AgentRunFailureContract.parse(value).ok;
}

export function isAgentAttachment(value: unknown): value is AgentAttachment {
  return AgentAttachmentContract.parse(value).ok;
}

export function isSelectionScope(value: unknown): value is SelectionScope {
  return SelectionScopeContract.parse(value).ok;
}

export function isDesignMutationTarget(
  value: unknown,
): value is DesignMutationTarget {
  return DesignMutationTargetContract.parse(value).ok;
}

export function isToolCallRequest(
  value: unknown,
  validateInput: (toolName: string, input: unknown) => boolean,
): value is ToolCallRequest {
  return (
    Value.Check(ToolCallRequestSchema, value) &&
    validateInput(value.toolName, value.input)
  );
}

export function isTrustedToolContext(
  value: unknown,
): value is TrustedToolContext {
  return (
    Value.Check(TrustedToolContextSchema, value) &&
    isSelectionScope(value.scope) &&
    isDesignMutationTarget(value.mutationTarget)
  );
}

export function isTrustedToolFailure(
  value: unknown,
): value is TrustedToolFailure {
  return TrustedToolFailureContract.parse(value).ok;
}

export function isTrustedToolResult(
  value: unknown,
): value is TrustedToolResult {
  return TrustedToolResultContract.parse(value).ok;
}

export function isToolExecutionEvent(
  value: unknown,
): value is ToolExecutionEvent {
  if (!Value.Check(ToolExecutionEventSchema, value)) return false;
  if (value.type === "failed") return isTrustedToolFailure(value.error);
  if (value.type === "completed") return isTrustedToolResult(value.result);
  return true;
}

export function isDesignToolBridgeRequest(
  value: unknown,
  validateInput: (toolName: string, input: unknown) => boolean,
): value is DesignToolBridgeRequest {
  return (
    Value.Check(DesignToolBridgeRequestSchema, value) &&
    isToolCallRequest(value.call, validateInput) &&
    isTrustedToolContext(value.context)
  );
}

export function designToolBridgeRequestId(value: unknown): string | null {
  return record(value) &&
    value.type === "design-tool.request" &&
    Value.Check(IdSchema, value.requestId)
    ? value.requestId
    : null;
}

export function isDesignToolBridgeCancel(
  value: unknown,
): value is DesignToolBridgeCancel {
  return Value.Check(DesignToolBridgeCancelSchema, value);
}

export function isDesignToolBridgeProgress(
  value: unknown,
): value is DesignToolBridgeProgress {
  return Value.Check(DesignToolBridgeProgressSchema, value);
}

export function isDesignToolBridgeResponse(
  value: unknown,
): value is DesignToolBridgeResponse {
  if (!Value.Check(DesignToolBridgeResponseSchema, value)) return false;
  return value.ok
    ? isTrustedToolResult(value.result)
    : isTrustedToolFailure(value.error);
}

export function designToolBridgeResponseId(value: unknown): string | null {
  return record(value) &&
    value.type === "design-tool.response" &&
    Value.Check(IdSchema, value.requestId)
    ? value.requestId
    : null;
}

export function isAgentToolFailureDetails(
  value: unknown,
): value is AgentToolFailureDetails {
  return AgentToolFailureDetailsContract.parse(value).ok;
}

export function isDurableTimelineEvent(
  value: unknown,
): value is DurableTimelineEvent {
  return DurableTimelineEventContract.parse(value).ok;
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
  return AgentEventContract.parse(value).ok;
}

export function isSessionTimelineItem(
  value: unknown,
): value is SessionTimelineItem {
  return SessionTimelineItemContract.parse(value).ok;
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

function selectionScopeDomainIssues(
  value: SelectionScope,
  path = "",
  code = "selection_scope.primary_node_not_selected",
  recovery = "Choose primaryNodeId from selectedNodeIds or omit it.",
): ValidationIssue[] {
  if (
    value.primaryNodeId === undefined ||
    value.selectedNodeIds.includes(value.primaryNodeId)
  ) {
    return [];
  }
  return [
    {
      code,
      path: `${path}/primaryNodeId`,
      message: "Primary node must belong to the selected node snapshot",
      expected: { memberOfSelectedNodeIds: true },
      actual: value.primaryNodeId,
      recovery,
    },
  ];
}

function runFailureStateDomainIssues(
  value: {
    status: string;
    stopReason?: string;
    failure?: AgentRunFailure;
  },
  path: string,
  code: string,
  recovery: string,
): ValidationIssue[] {
  if (
    value.failure === undefined ||
    (value.status === "error" && value.stopReason === "error")
  ) {
    return [];
  }
  return [
    {
      code,
      path: `${path}/failure`,
      message: "Run failure details require error status and error stop reason",
      expected: { status: "error", stopReason: "error" },
      actual: { status: value.status, stopReason: value.stopReason ?? null },
      recovery,
    },
  ];
}

function durableTimelineEventDomainIssues(
  value: DurableTimelineEvent,
): ValidationIssue[] {
  if (value.type === "message.user") {
    return selectionScopeDomainIssues(
      value.payload.scope,
      "/payload/scope",
      "durable_timeline_event.primary_selection_invalid",
      "Persist a primary node that belongs to the selected node snapshot.",
    );
  }
  if (value.type === "run.state") {
    return runFailureStateDomainIssues(
      value.payload,
      "/payload",
      "durable_timeline_event.failure_state_invalid",
      "Persist failure details only with error status and error stop reason.",
    );
  }
  if (
    value.type === "context.compacted" &&
    value.payload.toSequence < value.payload.fromSequence
  ) {
    return [
      {
        code: "durable_timeline_event.compacted_range_invalid",
        path: "/payload/toSequence",
        message: "toSequence must be greater than or equal to fromSequence",
        expected: { minimum: value.payload.fromSequence },
        actual: value.payload.toSequence,
        recovery: "Persist a non-descending compacted sequence range.",
      },
    ];
  }
  return [];
}

function sessionTimelineItemDomainIssues(
  value: SessionTimelineItem,
  path = "",
  codes = {
    primarySelection: "session_timeline_item.primary_selection_invalid",
    failureState: "session_timeline_item.failure_state_invalid",
  },
  recovery = "Correct the reported session timeline item field.",
): ValidationIssue[] {
  if (value.type === "user.message") {
    return selectionScopeDomainIssues(
      value.scope,
      `${path}/scope`,
      codes.primarySelection,
      recovery,
    );
  }
  if (value.type === "run") {
    return runFailureStateDomainIssues(
      value,
      path,
      codes.failureState,
      recovery,
    );
  }
  if (value.type === "tool" && value.error !== undefined) {
    return designWorkflowFailureDomainIssues(value.error, `${path}/error`);
  }
  return [];
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
  return agentEventVariant(agentEventType(value));
}

function agentEventType(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
    ? value.type.slice(0, 256)
    : "unknown";
}

function trustedToolResultDomainIssues(
  value: TrustedToolResultValue,
): ValidationIssue[] {
  const contentIssue = trustedToolContentIssue(value.content);
  const issues = contentIssue ? [contentIssue] : [];
  const revision = value.designRevision;
  if (!revision) return issues;
  return [...issues, ...trustedToolRevisionIssues(value)];
}

function trustedToolContentIssue(content: unknown): ValidationIssue | null {
  if (jsonSizeWithin(content, 4_000_000)) return null;
  return {
    code: "trusted_tool_result.content_invalid",
    path: "/content",
    message:
      "Tool result content must be serializable and at most 4,000,000 characters",
    expected: { maximumCharacters: 4_000_000 },
    recovery:
      "Return bounded structured content or an opaque resource handle instead of inline payload bytes.",
  };
}

function trustedToolRevisionIssues(
  value: TrustedToolResultValue,
): ValidationIssue[] {
  const revision = value.designRevision;
  if (!revision) return [];
  const issues: ValidationIssue[] = [];
  if (revision.revision <= revision.previousRevision) {
    issues.push({
      code: "trusted_tool_result.revision_not_advanced",
      path: "/designRevision/revision",
      message: "A design write must advance the document revision",
      expected: { greaterThan: revision.previousRevision },
      actual: revision.revision,
      recovery:
        "Return the committed EditorRuntime revision, not the request base revision.",
    });
  }
  if (
    revision.rebasedFromRevision !== undefined &&
    revision.rebasedFromRevision >= revision.previousRevision
  ) {
    issues.push({
      code: "trusted_tool_result.rebase_order_invalid",
      path: "/designRevision/rebasedFromRevision",
      message: "rebasedFromRevision must precede previousRevision",
      expected: { lessThan: revision.previousRevision },
      actual: revision.rebasedFromRevision,
      recovery:
        "Report the original inspected revision only when the host safely rebased onto a newer base revision.",
    });
  }
  if (
    value.observedRevision !== undefined &&
    value.observedRevision !== revision.revision
  ) {
    issues.push({
      code: "trusted_tool_result.observed_revision_mismatch",
      path: "/observedRevision",
      message: "observedRevision must equal designRevision.revision",
      expected: revision.revision,
      actual: value.observedRevision,
      recovery:
        "Return one exact committed revision for both observed and design revision evidence.",
    });
  }
  return issues;
}

function agentEventVariant(type: string): TSchema | undefined {
  const variants = (AgentEventSchema as { anyOf?: TSchema[] }).anyOf ?? [];
  return variants.find((variant) => {
    const properties = (variant as { properties?: Record<string, unknown> })
      .properties;
    const discriminator = properties?.type;
    return (
      typeof discriminator === "object" &&
      discriminator !== null &&
      "const" in discriminator &&
      discriminator.const === type
    );
  });
}

function jsonSizeWithin(value: unknown, maximum: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && serialized.length <= maximum;
  } catch {
    return false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
