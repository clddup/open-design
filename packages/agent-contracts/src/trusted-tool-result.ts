import { Type, type Static } from "@sinclair/typebox";
import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { AgentToolFailureDetailsSchema } from "./tool-failure.js";
import { designWorkflowFailureDomainIssues } from "./workflow-failure-contract.js";
import {
  AgentIdSchema,
  RevisionSchema,
  TransactionIdSchema,
} from "./wire-foundations.js";

export const TrustedToolFailureSchema = Type.Object(
  {
    code: AgentIdSchema,
    message: Type.String({ minLength: 1, maxLength: 20_000 }),
    retryable: Type.Boolean(),
    recoverable: Type.Boolean(),
    runTerminal: Type.Optional(Type.Literal(true)),
    details: Type.Optional(AgentToolFailureDetailsSchema),
  },
  { additionalProperties: false },
);

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

export type TrustedToolFailure = Static<typeof TrustedToolFailureSchema>;
export type TrustedToolResult = Static<typeof TrustedToolResultSchema>;

export const TrustedToolFailureContract = defineContract<TrustedToolFailure>({
  schema: TrustedToolFailureSchema,
  code: "trusted_tool_failure.schema_invalid",
  subject: "Trusted tool failure",
  recovery: "Correct the reported trusted tool failure field.",
  refine: (value) => designWorkflowFailureDomainIssues(value, ""),
  clone: false,
});

export const TrustedToolResultContract = defineContract<TrustedToolResult>({
  schema: TrustedToolResultSchema,
  code: "trusted_tool_result.schema_invalid",
  subject: "Trusted tool result",
  recovery:
    "Reject the malformed tool result and preserve the last trusted revision.",
  refine: trustedToolResultDomainIssues,
  clone: false,
});

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

export function trustedToolFailureDomainIssues(
  value: TrustedToolFailure,
): ValidationIssue[] {
  return designWorkflowFailureDomainIssues(value, "");
}

export function trustedToolResultDomainIssues(
  value: TrustedToolResult,
): ValidationIssue[] {
  const contentIssue = trustedToolContentIssue(value.content);
  const issues = contentIssue ? [contentIssue] : [];
  return value.designRevision
    ? [...issues, ...trustedToolRevisionIssues(value)]
    : issues;
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
  value: TrustedToolResult,
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

function jsonSizeWithin(value: unknown, maximum: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && serialized.length <= maximum;
  } catch {
    return false;
  }
}
