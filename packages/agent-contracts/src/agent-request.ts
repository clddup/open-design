import { Type, type Static, type TSchema } from "@sinclair/typebox";
import {
  defineContract,
  selectDiscriminatedUnionSchema,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import {
  ModelSelectionSchema,
  ResolvedModelIdentitySchema,
  type ModelSelection,
  type ResolvedModelIdentity,
} from "@opendesign/model-gateway/provider-config";
import { AgentContinuationSchemas } from "./continuation.js";
import {
  AgentInitialDesignInspectionSchema,
  agentInitialDesignInspectionDomainIssues,
} from "./initial-design-inspection.js";
import {
  AgentIdSchema,
  ApprovalDecisionSchema,
  ApprovalIdSchema,
  DesignMutationTargetSchema,
  RevisionSchema,
  RunIdSchema,
  SelectionScopeSchema,
  SessionIdSchema,
  ToolCallIdSchema,
  selectionScopeDomainIssues,
} from "./wire-foundations.js";

export {
  ModelSelectionSchema,
  ResolvedModelIdentitySchema,
} from "@opendesign/model-gateway/provider-config";

export const MAX_AGENT_ATTACHMENTS = 6;
export const MAX_AGENT_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_AGENT_IMAGE_ATTACHMENTS = MAX_AGENT_ATTACHMENTS;
export const MAX_AGENT_IMAGE_BYTES = MAX_AGENT_ATTACHMENT_BYTES;

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

export const AgentAttachmentsSchema = Type.Array(AgentAttachmentSchema, {
  maxItems: MAX_AGENT_ATTACHMENTS,
});

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

export const DeliveryScopeReviewSchema = Type.Union([
  Type.Literal("direct"),
  Type.Literal("required"),
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
      documentId: AgentIdSchema,
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
    { type: Type.Literal("run.cancel"), runId: RunIdSchema },
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
      requestId: AgentIdSchema,
      sessionId: SessionIdSchema,
    },
    { additionalProperties: false },
  ),
]);

export type AgentAttachment = Static<typeof AgentAttachmentSchema>;
export type AgentImageAttachment = Static<typeof AgentImageAttachmentSchema>;
export type AgentDocumentAttachment = Static<
  typeof AgentDocumentAttachmentSchema
>;
export type AgentSvgAttachment = Static<typeof AgentSvgAttachmentSchema>;
export type AgentModelSelection = ModelSelection;
export type AgentModelContext = Static<typeof AgentModelContextSchema>;
export type DesignGenerationMode = Static<typeof DesignGenerationModeSchema>;
export type DeliveryScopeReview = Static<typeof DeliveryScopeReviewSchema>;
export type AgentRequest = Static<typeof AgentRequestSchema>;

export const ModelSelectionContract = defineContract<AgentModelSelection>({
  schema: ModelSelectionSchema,
  code: "model_selection.schema_invalid",
  subject: "Model selection",
  recovery: "Correct the reported model selection field.",
  clone: false,
});

export const ResolvedModelIdentityContract =
  defineContract<ResolvedModelIdentity>({
    schema: ResolvedModelIdentitySchema,
    code: "resolved_model_identity.schema_invalid",
    subject: "Resolved model identity",
    recovery: "Correct the reported resolved model identity field.",
    clone: false,
  });

export const AgentAttachmentContract = defineContract<AgentAttachment>({
  schema: AgentAttachmentSchema,
  code: "agent_attachment.schema_invalid",
  subject: "Agent attachment",
  recovery: "Correct the reported Agent attachment field.",
  selectSchema: attachmentSchemaForInput,
  clone: false,
});

export const AgentRequestContract = defineContract<AgentRequest>({
  schema: AgentRequestSchema,
  code: "agent_request.schema_invalid",
  subject: "Agent request",
  recovery: "Correct the reported Agent request field before retrying.",
  selectSchema: agentRequestSchemaForInput,
  refine: agentRequestDomainIssues,
  clone: false,
});

export function isAgentAttachment(value: unknown): value is AgentAttachment {
  return AgentAttachmentContract.parse(value).ok;
}

export function isAgentRequest(value: unknown): value is AgentRequest {
  return AgentRequestContract.parse(value).ok;
}

function agentRequestDomainIssues(value: AgentRequest): ValidationIssue[] {
  if (value.type !== "run.start") return [];
  const issues = prefixIssues(
    selectionScopeDomainIssues(value.scope),
    "/scope",
  );
  if (value.initialDesignInspection) {
    issues.push(
      ...prefixIssues(
        agentInitialDesignInspectionDomainIssues(value.initialDesignInspection),
        "/initialDesignInspection",
      ),
    );
    if (value.initialDesignInspection.observedRevision !== value.revision) {
      issues.push({
        code: "agent_request.initial_inspection_revision_mismatch",
        path: "/initialDesignInspection/observedRevision",
        message:
          "Initial inspection revision must match the Run start revision",
        expected: value.revision,
        actual: value.initialDesignInspection.observedRevision,
        recovery: "Regenerate initial inspection for the bound Run revision.",
      });
    }
  }
  if (
    value.mutationTarget.kind === "page" &&
    value.scope.pageId !== undefined &&
    value.scope.pageId !== value.mutationTarget.pageId
  ) {
    issues.push({
      code: "agent_request.page_scope_mismatch",
      path: "/scope/pageId",
      message: "Selection Page must match the Page mutation target",
      expected: value.mutationTarget.pageId,
      actual: value.scope.pageId,
      recovery: "Bind selection and mutation target to the same Page.",
    });
  }
  return issues;
}

function agentRequestSchemaForInput(input: unknown): TSchema {
  return (
    selectDiscriminatedUnionSchema(AgentRequestSchema, input, "type") ??
    AgentRequestSchema
  );
}

function attachmentSchemaForInput(input: unknown): TSchema {
  const attachmentId = record(input)?.attachmentId;
  if (typeof attachmentId !== "string") return AgentAttachmentSchema;
  if (attachmentId.startsWith("image_")) return AgentImageAttachmentSchema;
  if (attachmentId.startsWith("file_")) return AgentDocumentAttachmentSchema;
  if (attachmentId.startsWith("svg_")) return AgentSvgAttachmentSchema;
  return AgentAttachmentSchema;
}

function prefixIssues(
  issues: readonly ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path === "/" ? prefix : `${prefix}${issue.path}`,
  }));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
