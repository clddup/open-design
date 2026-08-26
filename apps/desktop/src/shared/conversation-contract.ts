import { Type, type Static } from "@sinclair/typebox";
import {
  DesignTargetSchema,
  StableIdSchema,
  isDesignTarget,
} from "@opendesign/workspace-contracts";
import { defineContract, type ValidationIssue } from "./contract-validation";

export {
  ConversationDescriptorContract,
  ConversationDescriptorListContract,
  ConversationIdentityRequestContract,
  CreateConversationRequestContract,
} from "@opendesign/workspace-contracts";
export type {
  ConversationIdentityRequest,
  CreateConversationRequest,
  DeleteConversationRequest,
} from "@opendesign/workspace-contracts";

export const ConversationOpenContextSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("target-available"),
      conversationId: StableIdSchema,
      source: Type.Union([
        Type.Literal("active-task"),
        Type.Literal("recent-task"),
        Type.Literal("filed-project"),
      ]),
      target: DesignTargetSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("target-unavailable"),
      conversationId: StableIdSchema,
      reason: Type.Union([
        Type.Literal("project-unavailable"),
        Type.Literal("design-file-unavailable"),
        Type.Literal("page-unavailable"),
        Type.Literal("no-target"),
      ]),
      target: Type.Optional(DesignTargetSchema),
    },
    { additionalProperties: false },
  ),
]);

export type ConversationOpenContext = Static<
  typeof ConversationOpenContextSchema
>;

export const ConversationOpenContextContract = defineContract<
  ConversationOpenContext,
  ConversationOpenContext,
  { conversationId?: string }
>(
  {
    schema: ConversationOpenContextSchema,
    code: "conversation.open_context_invalid",
    subject: "Conversation open context",
    refine: conversationOpenContextIssues,
  },
  () => ({}),
);

function conversationOpenContextIssues(
  value: ConversationOpenContext,
  context: { conversationId?: string },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (
    context.conversationId !== undefined &&
    value.conversationId !== context.conversationId
  ) {
    issues.push({
      code: "conversation.open_context_mismatch",
      path: "/conversationId",
      message: "Conversation open context does not match its request",
      expected: context.conversationId,
      actual: value.conversationId,
      recovery: "Return the context resolved for this exact Conversation.",
    });
  }
  if ("target" in value && value.target && !isDesignTarget(value.target)) {
    issues.push({
      code: "conversation.open_target_invalid",
      path: "/target/primaryNodeId",
      message: "Open target primary selection is not part of its selection",
      recovery: "Resolve a target from the current authoritative task state.",
    });
  }
  return issues;
}
