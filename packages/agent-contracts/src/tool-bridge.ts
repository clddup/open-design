import { Type, type Static, type TSchema } from "@sinclair/typebox";
import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { type AgentToolFailureIssue } from "./tool-failure.js";
import {
  TrustedToolFailureSchema,
  TrustedToolResultSchema,
  trustedToolFailureDomainIssues,
  trustedToolResultDomainIssues,
} from "./trusted-tool-result.js";
import {
  AgentIdSchema,
  DesignMutationTargetSchema,
  ProgressSchema,
  RevisionSchema,
  RunIdSchema,
  SelectionScopeSchema,
  SessionIdSchema,
  ToolCallIdSchema,
  selectionScopeDomainIssues,
} from "./wire-foundations.js";

export const ToolCallRequestSchema = Type.Object(
  {
    toolCallId: ToolCallIdSchema,
    toolName: AgentIdSchema,
    input: Type.Unknown(),
  },
  { additionalProperties: false },
);

export const TrustedToolContextSchema = Type.Object(
  {
    runId: RunIdSchema,
    sessionId: SessionIdSchema,
    documentId: AgentIdSchema,
    revision: RevisionSchema,
    scope: SelectionScopeSchema,
    mutationTarget: DesignMutationTargetSchema,
  },
  { additionalProperties: false },
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
    { type: Type.Literal("failed"), error: TrustedToolFailureSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("completed"), result: TrustedToolResultSchema },
    { additionalProperties: false },
  ),
]);

export const DesignToolBridgeRequestSchema = Type.Object(
  {
    type: Type.Literal("design-tool.request"),
    requestId: AgentIdSchema,
    call: ToolCallRequestSchema,
    context: TrustedToolContextSchema,
  },
  { additionalProperties: false },
);

export const DesignToolBridgeCancelSchema = Type.Object(
  { type: Type.Literal("design-tool.cancel"), requestId: AgentIdSchema },
  { additionalProperties: false },
);

export const DesignToolBridgeProgressSchema = Type.Object(
  {
    type: Type.Literal("design-tool.progress"),
    requestId: AgentIdSchema,
    message: Type.String({ minLength: 1, maxLength: 2_000 }),
    progress: ProgressSchema,
  },
  { additionalProperties: false },
);

export const DesignToolBridgeResponseSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("design-tool.response"),
      requestId: AgentIdSchema,
      ok: Type.Literal(true),
      result: TrustedToolResultSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("design-tool.response"),
      requestId: AgentIdSchema,
      ok: Type.Literal(false),
      error: TrustedToolFailureSchema,
    },
    { additionalProperties: false },
  ),
]);

const DesignToolBridgeRequestIdentitySchema = Type.Object(
  {
    type: Type.Literal("design-tool.request"),
    requestId: AgentIdSchema,
  },
  { additionalProperties: true },
);
const DesignToolBridgeResponseIdentitySchema = Type.Object(
  {
    type: Type.Literal("design-tool.response"),
    requestId: AgentIdSchema,
  },
  { additionalProperties: true },
);

export type ToolCallRequest = Static<typeof ToolCallRequestSchema>;
export type TrustedToolContext = Static<typeof TrustedToolContextSchema>;
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

export type ToolInputIssueProvider = (
  toolName: string,
  input: unknown,
) => readonly AgentToolFailureIssue[];

export const ToolCallRequestContract = defineContract<
  ToolCallRequest,
  ToolCallRequest,
  ToolInputIssueProvider
>(
  {
    schema: ToolCallRequestSchema,
    code: "tool_call_request.schema_invalid",
    subject: "tool call request",
    recovery: "Correct the reported tool call field before retrying.",
    refine: (value, inputIssues) => toolCallDomainIssues(value, inputIssues),
    clone: false,
  },
  () => missingInputIssueProvider,
);

export const TrustedToolContextContract = defineContract<TrustedToolContext>({
  schema: TrustedToolContextSchema,
  code: "trusted_tool_context.schema_invalid",
  subject: "trusted tool context",
  recovery: "Regenerate context from the current Main-bound Run.",
  refine: trustedToolContextDomainIssues,
  clone: false,
});

export const ToolExecutionEventContract = defineContract<ToolExecutionEvent>({
  schema: ToolExecutionEventSchema,
  code: "tool_execution_event.schema_invalid",
  subject: "tool execution event",
  recovery: "Correct the reported tool execution event before retrying.",
  selectSchema: (value) =>
    unionVariant(ToolExecutionEventSchema, value, "type"),
  refine: toolExecutionEventDomainIssues,
  clone: false,
});

export const DesignToolBridgeRequestContract = defineContract<
  DesignToolBridgeRequest,
  DesignToolBridgeRequest,
  ToolInputIssueProvider
>(
  {
    schema: DesignToolBridgeRequestSchema,
    code: "design_tool_bridge_request.schema_invalid",
    subject: "design tool bridge request",
    recovery: "Correct the reported design tool request before retrying.",
    refine: designToolBridgeRequestDomainIssues,
    clone: false,
  },
  () => missingInputIssueProvider,
);

export const DesignToolBridgeCancelContract =
  defineContract<DesignToolBridgeCancel>({
    schema: DesignToolBridgeCancelSchema,
    code: "design_tool_bridge_cancel.schema_invalid",
    subject: "design tool bridge cancellation",
    clone: false,
  });

export const DesignToolBridgeProgressContract =
  defineContract<DesignToolBridgeProgress>({
    schema: DesignToolBridgeProgressSchema,
    code: "design_tool_bridge_progress.schema_invalid",
    subject: "design tool bridge progress",
    clone: false,
  });

export const DesignToolBridgeResponseContract =
  defineContract<DesignToolBridgeResponse>({
    schema: DesignToolBridgeResponseSchema,
    code: "design_tool_bridge_response.schema_invalid",
    subject: "design tool bridge response",
    selectSchema: (value) =>
      unionVariant(DesignToolBridgeResponseSchema, value, "ok"),
    refine: designToolBridgeResponseDomainIssues,
    clone: false,
  });

const DesignToolBridgeRequestIdentityContract = defineContract<{
  type: "design-tool.request";
  requestId: string;
}>({
  schema: DesignToolBridgeRequestIdentitySchema,
  code: "design_tool_bridge_request_identity.schema_invalid",
  subject: "design tool bridge request identity",
  clone: false,
});
const DesignToolBridgeResponseIdentityContract = defineContract<{
  type: "design-tool.response";
  requestId: string;
}>({
  schema: DesignToolBridgeResponseIdentitySchema,
  code: "design_tool_bridge_response_identity.schema_invalid",
  subject: "design tool bridge response identity",
  clone: false,
});

export function isToolCallRequest(
  value: unknown,
  inputIssues: ToolInputIssueProvider,
): value is ToolCallRequest {
  return ToolCallRequestContract.parse(value, inputIssues).ok;
}

export function isTrustedToolContext(
  value: unknown,
): value is TrustedToolContext {
  return TrustedToolContextContract.parse(value).ok;
}

export function isToolExecutionEvent(
  value: unknown,
): value is ToolExecutionEvent {
  return ToolExecutionEventContract.parse(value).ok;
}

export function isDesignToolBridgeRequest(
  value: unknown,
  inputIssues: ToolInputIssueProvider,
): value is DesignToolBridgeRequest {
  return DesignToolBridgeRequestContract.parse(value, inputIssues).ok;
}

export function isDesignToolBridgeCancel(
  value: unknown,
): value is DesignToolBridgeCancel {
  return DesignToolBridgeCancelContract.parse(value).ok;
}

export function isDesignToolBridgeProgress(
  value: unknown,
): value is DesignToolBridgeProgress {
  return DesignToolBridgeProgressContract.parse(value).ok;
}

export function isDesignToolBridgeResponse(
  value: unknown,
): value is DesignToolBridgeResponse {
  return DesignToolBridgeResponseContract.parse(value).ok;
}

export function designToolBridgeRequestId(value: unknown): string | null {
  const parsed = DesignToolBridgeRequestIdentityContract.parse(value);
  return parsed.ok ? parsed.value.requestId : null;
}

export function designToolBridgeResponseId(value: unknown): string | null {
  const parsed = DesignToolBridgeResponseIdentityContract.parse(value);
  return parsed.ok ? parsed.value.requestId : null;
}

function toolCallDomainIssues(
  value: ToolCallRequest,
  inputIssues: ToolInputIssueProvider,
): ValidationIssue[] {
  return inputIssues(value.toolName, value.input).map((issue) => ({
    code: issue.code ?? "tool_call_request.input_invalid",
    path: prefixedPath("/input", issue.path),
    message: issue.message,
    ...(issue.expected === undefined ? {} : { expected: issue.expected }),
    ...(issue.actual === undefined ? {} : { actual: issue.actual }),
    recovery:
      issue.recovery ??
      "Use the selected tool's reported contract issues to correct one revised call.",
  }));
}

export function trustedToolContextDomainIssues(
  value: TrustedToolContext,
): ValidationIssue[] {
  const issues = prefixIssues(
    selectionScopeDomainIssues(value.scope),
    "/scope",
  );
  if (
    value.mutationTarget.kind === "page" &&
    value.scope.pageId !== undefined &&
    value.scope.pageId !== value.mutationTarget.pageId
  ) {
    issues.push({
      code: "trusted_tool_context.page_scope_mismatch",
      path: "/scope/pageId",
      message: "Selection Page must match the Page mutation target",
      expected: value.mutationTarget.pageId,
      actual: value.scope.pageId,
      recovery: "Regenerate context from the exact Main-bound Page target.",
    });
  }
  return issues;
}

function designToolBridgeRequestDomainIssues(
  value: DesignToolBridgeRequest,
  inputIssues: ToolInputIssueProvider,
): ValidationIssue[] {
  return [
    ...prefixIssues(toolCallDomainIssues(value.call, inputIssues), "/call"),
    ...prefixIssues(trustedToolContextDomainIssues(value.context), "/context"),
  ];
}

function missingInputIssueProvider(): readonly ValidationIssue[] {
  return [
    {
      code: "tool_call_request.input_validator_required",
      path: "/",
      message: "Tool input validation requires the active trusted catalog",
      recovery: "Parse the request with the current tool input issue provider.",
    },
  ];
}

function toolExecutionEventDomainIssues(
  value: ToolExecutionEvent,
): ValidationIssue[] {
  if (value.type === "failed") {
    return prefixIssues(trustedToolFailureDomainIssues(value.error), "/error");
  }
  return value.type === "completed"
    ? prefixIssues(trustedToolResultDomainIssues(value.result), "/result")
    : [];
}

function designToolBridgeResponseDomainIssues(
  value: DesignToolBridgeResponse,
): ValidationIssue[] {
  return value.ok
    ? prefixIssues(trustedToolResultDomainIssues(value.result), "/result")
    : prefixIssues(trustedToolFailureDomainIssues(value.error), "/error");
}

function unionVariant(
  schema: { anyOf: TSchema[] },
  value: unknown,
  discriminant: string,
): TSchema | undefined {
  const selected = record(value)?.[discriminant];
  return schema.anyOf.find((variant) => {
    const properties = record(record(variant)?.properties);
    const literal = record(properties?.[discriminant]);
    return literal?.const === selected;
  });
}

function prefixIssues(
  issues: readonly ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: prefixedPath(prefix, issue.path),
  }));
}

function prefixedPath(prefix: string, path: string): string {
  return path === "/" ? prefix : `${prefix}${path}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
