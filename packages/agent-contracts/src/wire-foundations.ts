import { Type, type Static } from "@sinclair/typebox";
import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";

export const MAX_SELECTED_NODE_IDS = 512;

export const AgentIdSchema = Type.String({ minLength: 1, maxLength: 256 });
export const TimestampSchema = Type.String({ minLength: 1, maxLength: 64 });
export const RevisionSchema = Type.Integer({ minimum: 0 });
export const SequenceSchema = Type.Integer({ minimum: 1 });
export const ProgressSchema = Type.Number({ minimum: 0, maximum: 1 });
export const RunIdSchema = Type.String({ minLength: 1, maxLength: 256 });
export const ToolCallIdSchema = Type.String({ minLength: 1, maxLength: 256 });
export const SessionIdSchema = AgentIdSchema;
export const MessageIdSchema = AgentIdSchema;
export const ApprovalIdSchema = AgentIdSchema;
export const TransactionIdSchema = AgentIdSchema;
export const ApprovalDecisionSchema = Type.Union([
  Type.Literal("allow_once"),
  Type.Literal("allow_session"),
  Type.Literal("deny"),
]);

const SelectedNodeIdsSchema = Type.Array(AgentIdSchema, {
  maxItems: MAX_SELECTED_NODE_IDS,
  uniqueItems: true,
});

export const SelectionScopeSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("selection"),
      selectedNodeIds: Type.Array(AgentIdSchema, {
        minItems: 1,
        maxItems: MAX_SELECTED_NODE_IDS,
        uniqueItems: true,
      }),
      primaryNodeId: Type.Optional(AgentIdSchema),
      pageId: Type.Optional(AgentIdSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("page"),
      selectedNodeIds: SelectedNodeIdsSchema,
      primaryNodeId: Type.Optional(AgentIdSchema),
      pageId: AgentIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("document"),
      selectedNodeIds: SelectedNodeIdsSchema,
      primaryNodeId: Type.Optional(AgentIdSchema),
      pageId: Type.Optional(AgentIdSchema),
    },
    { additionalProperties: false },
  ),
]);

export const DesignMutationTargetSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("page"), pageId: AgentIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("document") },
    { additionalProperties: false },
  ),
]);

export type SelectionScope = Static<typeof SelectionScopeSchema>;
export type DesignMutationTarget = Static<typeof DesignMutationTargetSchema>;
export type ApprovalDecision = Static<typeof ApprovalDecisionSchema>;

export const SelectionScopeContract = defineContract<SelectionScope>({
  schema: SelectionScopeSchema,
  code: "selection_scope.schema_invalid",
  subject: "Selection scope",
  recovery: "Correct the reported selection scope field.",
  refine: selectionScopeDomainIssues,
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

export function isSelectionScope(value: unknown): value is SelectionScope {
  return SelectionScopeContract.parse(value).ok;
}

export function isDesignMutationTarget(
  value: unknown,
): value is DesignMutationTarget {
  return DesignMutationTargetContract.parse(value).ok;
}

export function selectionScopeDomainIssues(
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
