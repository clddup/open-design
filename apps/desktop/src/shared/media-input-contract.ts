import { defineContract } from "./contract-validation";
import {
  agentAttachmentSelectionIssues,
  designImageEditRequestIssues,
  designImageEditResultIssues,
  designImageExpansionIssues,
  designImageSelectionIssues,
} from "./media-input-contract-domain";
import {
  AgentAttachmentImportSchema,
  AgentAttachmentPreviewRequestSchema,
  AgentAttachmentPreviewResultSchema,
  AgentAttachmentSelectionSchema,
  CancelDesignImageEditRequestSchema,
  DesignImageAreaSelectionSchema,
  DesignImageEditRequestSchema,
  DesignImageEditResultSchema,
  DesignImageExpansionSchema,
  DesignImageSelectionSchema,
  type AgentAttachmentImport,
  type AgentAttachmentPreviewRequest,
  type AgentAttachmentPreviewResult,
  type AgentAttachmentSelection,
  type CancelDesignImageEditRequest,
  type DesignImageAreaSelection,
  type DesignImageEditRequest,
  type DesignImageEditResult,
  type DesignImageExpansion,
  type DesignImageSelection,
} from "./media-input-contract-schemas";

export const AgentAttachmentSelectionContract =
  defineContract<AgentAttachmentSelection>({
    schema: AgentAttachmentSelectionSchema,
    code: "agent_attachment_selection.schema_invalid",
    subject: "Agent attachment selection",
    clone: false,
    refine: agentAttachmentSelectionIssues,
  });

export const AgentAttachmentImportContract =
  defineContract<AgentAttachmentImport>({
    schema: AgentAttachmentImportSchema,
    code: "agent_attachment_import.schema_invalid",
    subject: "Agent attachment import",
    clone: false,
  });

export const AgentAttachmentPreviewRequestContract =
  defineContract<AgentAttachmentPreviewRequest>({
    schema: AgentAttachmentPreviewRequestSchema,
    code: "agent_attachment_preview_request.schema_invalid",
    subject: "Agent attachment preview request",
    clone: false,
  });

export const AgentAttachmentPreviewResultContract =
  defineContract<AgentAttachmentPreviewResult>({
    schema: AgentAttachmentPreviewResultSchema,
    code: "agent_attachment_preview_result.schema_invalid",
    subject: "Agent attachment preview result",
    clone: false,
  });

export const DesignImageSelectionContract =
  defineContract<DesignImageSelection>({
    schema: DesignImageSelectionSchema,
    code: "design_image_selection.schema_invalid",
    subject: "Design Image selection",
    clone: false,
    refine: designImageSelectionIssues,
  });

export const DesignImageAreaSelectionContract =
  defineContract<DesignImageAreaSelection>({
    schema: DesignImageAreaSelectionSchema,
    code: "design_image_area_selection.schema_invalid",
    subject: "Design Image area selection",
    clone: false,
  });

export const DesignImageExpansionContract =
  defineContract<DesignImageExpansion>({
    schema: DesignImageExpansionSchema,
    code: "design_image_expansion.schema_invalid",
    subject: "Design Image expansion",
    clone: false,
    refine: designImageExpansionIssues,
  });

export const DesignImageEditRequestContract =
  defineContract<DesignImageEditRequest>({
    schema: DesignImageEditRequestSchema,
    code: "design_image_edit_request.schema_invalid",
    subject: "Design Image edit request",
    clone: false,
    refine: designImageEditRequestIssues,
  });

export const DesignImageEditResultContract =
  defineContract<DesignImageEditResult>({
    schema: DesignImageEditResultSchema,
    code: "design_image_edit_result.schema_invalid",
    subject: "Design Image edit result",
    clone: false,
    refine: designImageEditResultIssues,
  });

export const CancelDesignImageEditRequestContract =
  defineContract<CancelDesignImageEditRequest>({
    schema: CancelDesignImageEditRequestSchema,
    code: "cancel_design_image_edit_request.schema_invalid",
    subject: "Cancel Design Image edit request",
    clone: false,
  });

export function isAgentAttachmentSelection(
  value: unknown,
): value is AgentAttachmentSelection {
  return AgentAttachmentSelectionContract.parse(value).ok;
}

export function isAgentAttachmentImport(
  value: unknown,
): value is AgentAttachmentImport {
  return AgentAttachmentImportContract.parse(value).ok;
}

export function isAgentAttachmentPreviewRequest(
  value: unknown,
): value is AgentAttachmentPreviewRequest {
  return AgentAttachmentPreviewRequestContract.parse(value).ok;
}

export function isAgentAttachmentPreviewResult(
  value: unknown,
): value is AgentAttachmentPreviewResult {
  return AgentAttachmentPreviewResultContract.parse(value).ok;
}

export function isDesignImageSelection(
  value: unknown,
): value is DesignImageSelection {
  return DesignImageSelectionContract.parse(value).ok;
}

export function isDesignImageAreaSelection(
  value: unknown,
): value is DesignImageAreaSelection {
  return DesignImageAreaSelectionContract.parse(value).ok;
}

export function isDesignImageExpansion(
  value: unknown,
): value is DesignImageExpansion {
  return DesignImageExpansionContract.parse(value).ok;
}

export function isDesignImageEditRequest(
  value: unknown,
): value is DesignImageEditRequest {
  return DesignImageEditRequestContract.parse(value).ok;
}

export function isDesignImageEditResult(
  value: unknown,
): value is DesignImageEditResult {
  return DesignImageEditResultContract.parse(value).ok;
}

export function isCancelDesignImageEditRequest(
  value: unknown,
): value is CancelDesignImageEditRequest {
  return CancelDesignImageEditRequestContract.parse(value).ok;
}

export * from "./media-input-contract-schemas";
