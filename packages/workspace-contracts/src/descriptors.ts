import { Type, type Static } from "@sinclair/typebox";
import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";

export const PROJECT_MANIFEST_VERSION = "1.0.0" as const;
export const MAX_PROJECT_DESIGN_FILES = 4_096;

export const StableIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
});

export const TimestampSchema = Type.String({
  minLength: 20,
  maxLength: 32,
  pattern:
    "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?Z$",
});

export const RelativePathSchema = Type.String({
  minLength: 1,
  maxLength: 1_024,
  pattern:
    "^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*//)(?!.*[\\u0000-\\u001F\\u007F])(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/]+(?:/[^/]+)*$",
});

export const WorkspaceNameSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});

export const ConversationTitleSchema = Type.String({
  minLength: 1,
  maxLength: 2_000,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});

export const ProjectLifecycleSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("archived"),
  Type.Literal("deleted"),
]);

export const DesignFileLifecycleSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("archived"),
  Type.Literal("deleted"),
]);

export const ConversationLifecycleSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("archived"),
  Type.Literal("deleted"),
]);

export const DesignFileDescriptorSchema = Type.Object(
  {
    designFileId: StableIdSchema,
    documentId: StableIdSchema,
    name: WorkspaceNameSchema,
    relativePath: RelativePathSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    lifecycle: DesignFileLifecycleSchema,
  },
  { additionalProperties: false },
);

export const ProjectManifestSchema = Type.Object(
  {
    manifestVersion: Type.Literal(PROJECT_MANIFEST_VERSION),
    projectId: StableIdSchema,
    name: WorkspaceNameSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    lifecycle: ProjectLifecycleSchema,
    designFiles: Type.Array(DesignFileDescriptorSchema, {
      maxItems: MAX_PROJECT_DESIGN_FILES,
    }),
  },
  { additionalProperties: false },
);

export const ProjectDescriptorSchema = ProjectManifestSchema;

export const ConversationDescriptorSchema = Type.Object(
  {
    conversationId: StableIdSchema,
    originProjectId: Type.Union([StableIdSchema, Type.Null()]),
    filedProjectId: Type.Union([StableIdSchema, Type.Null()]),
    title: ConversationTitleSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    lifecycle: ConversationLifecycleSchema,
  },
  { additionalProperties: false },
);

export const CreateConversationRequestSchema = Type.Object(
  {
    conversationId: StableIdSchema,
    filedProjectId: StableIdSchema,
    title: ConversationTitleSchema,
  },
  { additionalProperties: false },
);

export const ConversationIdentityRequestSchema = Type.Object(
  { conversationId: StableIdSchema },
  { additionalProperties: false },
);

export const ConversationDescriptorListSchema = Type.Array(
  ConversationDescriptorSchema,
  { maxItems: 100_000 },
);

export type StableId = Static<typeof StableIdSchema>;
export type ProjectLifecycle = Static<typeof ProjectLifecycleSchema>;
export type DesignFileLifecycle = Static<typeof DesignFileLifecycleSchema>;
export type ConversationLifecycle = Static<typeof ConversationLifecycleSchema>;
export type DesignFileDescriptor = Static<typeof DesignFileDescriptorSchema>;
export type ProjectManifest = Static<typeof ProjectManifestSchema>;
export type ProjectDescriptor = Static<typeof ProjectDescriptorSchema>;
export type ConversationDescriptor = Static<
  typeof ConversationDescriptorSchema
>;
export type CreateConversationRequest = Static<
  typeof CreateConversationRequestSchema
>;
export type ConversationIdentityRequest = Static<
  typeof ConversationIdentityRequestSchema
>;
export type DeleteConversationRequest = ConversationIdentityRequest;
export type ConversationDescriptorValidationContext =
  | { kind: "descriptor" }
  | { kind: "create-response"; request: CreateConversationRequest }
  | { kind: "delete-response"; conversationId: string };

export const StableIdContract = defineContract<string>({
  schema: StableIdSchema,
  code: "workspace.stable_id_invalid",
  subject: "Workspace stable ID",
  clone: false,
});

export const RelativePathContract = defineContract<string>({
  schema: RelativePathSchema,
  code: "workspace.relative_path_invalid",
  subject: "Workspace relative path",
  clone: false,
});

export const DesignFileDescriptorContract =
  defineContract<DesignFileDescriptor>({
    schema: DesignFileDescriptorSchema,
    code: "workspace.design_file_descriptor_invalid",
    subject: "Design File descriptor",
    refine: designFileDescriptorDomainIssues,
    clone: false,
  });

export const ProjectManifestContract = defineContract<ProjectManifest>({
  schema: ProjectManifestSchema,
  code: "workspace.project_manifest_invalid",
  subject: "Project manifest",
  refine: projectManifestDomainIssues,
  clone: false,
});

export const CreateConversationRequestContract =
  defineContract<CreateConversationRequest>({
    schema: CreateConversationRequestSchema,
    code: "conversation.create_request_invalid",
    subject: "Conversation create request",
    clone: false,
  });

export const ConversationIdentityRequestContract =
  defineContract<ConversationIdentityRequest>({
    schema: ConversationIdentityRequestSchema,
    code: "conversation.identity_request_invalid",
    subject: "Conversation identity request",
    clone: false,
  });

export const ConversationDescriptorContract = defineContract<
  ConversationDescriptor,
  ConversationDescriptor,
  ConversationDescriptorValidationContext
>(
  {
    schema: ConversationDescriptorSchema,
    code: "workspace.conversation_descriptor_invalid",
    subject: "Conversation descriptor",
    refine: conversationDescriptorIssues,
    clone: false,
  },
  () => ({ kind: "descriptor" }),
);

export const ConversationDescriptorListContract = defineContract<
  Static<typeof ConversationDescriptorListSchema>
>({
  schema: ConversationDescriptorListSchema,
  code: "workspace.conversation_descriptor_list_invalid",
  subject: "Conversation descriptor list",
  refine: conversationDescriptorListIssues,
  clone: false,
});

export function isStableId(value: unknown): value is StableId {
  return StableIdContract.parse(value).ok;
}

export function isNormalizedRelativePath(value: unknown): value is string {
  return RelativePathContract.parse(value).ok;
}

export function isDesignFileDescriptor(
  value: unknown,
): value is DesignFileDescriptor {
  return DesignFileDescriptorContract.parse(value).ok;
}

export function isProjectManifest(value: unknown): value is ProjectManifest {
  return ProjectManifestContract.parse(value).ok;
}

export function isProjectDescriptor(
  value: unknown,
): value is ProjectDescriptor {
  return ProjectManifestContract.parse(value).ok;
}

export function isConversationDescriptor(
  value: unknown,
): value is ConversationDescriptor {
  return ConversationDescriptorContract.parse(value).ok;
}

export function designFileDescriptorDomainIssues(
  value: DesignFileDescriptor,
): ValidationIssue[] {
  return value.relativePath.toLowerCase().endsWith(".opendesign")
    ? []
    : [
        issue(
          "workspace.design_file_extension_invalid",
          "/relativePath",
          "Design File paths must use the .opendesign extension",
          "Use a safe Project-relative .opendesign path.",
        ),
      ];
}

export function projectManifestDomainIssues(
  value: ProjectManifest,
): ValidationIssue[] {
  const issues = value.designFiles.flatMap((descriptor, index) =>
    prefixIssues(
      designFileDescriptorDomainIssues(descriptor),
      `/designFiles/${index}`,
    ),
  );
  appendDuplicateIssues(
    issues,
    value.designFiles,
    "designFileId",
    "workspace.design_file_id_duplicate",
  );
  appendDuplicateIssues(
    issues,
    value.designFiles,
    "documentId",
    "workspace.document_id_duplicate",
  );
  appendDuplicateIssues(
    issues,
    value.designFiles,
    "relativePath",
    "workspace.design_file_path_duplicate",
  );
  return issues;
}

function conversationDescriptorIssues(
  value: ConversationDescriptor,
  context: ConversationDescriptorValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    issues.push(
      issue(
        "conversation.timestamp_order_invalid",
        "/updatedAt",
        "Conversation updatedAt must not precede createdAt",
        "Use the Main-owned creation time or a later update time.",
      ),
    );
  }
  if (context.kind === "create-response") {
    const { request } = context;
    appendMismatch(
      issues,
      value.conversationId,
      request.conversationId,
      "/conversationId",
    );
    appendMismatch(
      issues,
      value.originProjectId,
      request.filedProjectId,
      "/originProjectId",
    );
    appendMismatch(
      issues,
      value.filedProjectId,
      request.filedProjectId,
      "/filedProjectId",
    );
    appendMismatch(issues, value.title, request.title, "/title");
    appendMismatch(issues, value.lifecycle, "active", "/lifecycle");
  } else if (context.kind === "delete-response") {
    appendMismatch(
      issues,
      value.conversationId,
      context.conversationId,
      "/conversationId",
    );
    appendMismatch(issues, value.lifecycle, "deleted", "/lifecycle");
  }
  return issues;
}

function conversationDescriptorListIssues(
  value: readonly ConversationDescriptor[],
): ValidationIssue[] {
  const issues = value.flatMap((descriptor, index) =>
    prefixIssues(
      conversationDescriptorIssues(descriptor, { kind: "descriptor" }),
      `/${index}`,
    ),
  );
  const firstIndexById = new Map<string, number>();
  value.forEach((descriptor, index) => {
    const duplicateOf = firstIndexById.get(descriptor.conversationId);
    if (duplicateOf === undefined) {
      firstIndexById.set(descriptor.conversationId, index);
      return;
    }
    issues.push(
      issue(
        "conversation.id_duplicate",
        `/${index}/conversationId`,
        `conversationId duplicates Conversation ${duplicateOf}`,
        "Return each Conversation exactly once.",
      ),
    );
  });
  return issues;
}

function appendMismatch(
  issues: ValidationIssue[],
  actual: string | null,
  expected: string,
  path: string,
): void {
  if (actual === expected) return;
  issues.push({
    code: "conversation.response_mismatch",
    path,
    message: "Conversation response does not match its request",
    expected,
    actual,
    recovery: "Return the Main-owned result for this exact request.",
  });
}

function appendDuplicateIssues<
  Key extends "designFileId" | "documentId" | "relativePath",
>(
  issues: ValidationIssue[],
  values: readonly DesignFileDescriptor[],
  key: Key,
  code: string,
): void {
  const firstIndexByValue = new Map<string, number>();
  values.forEach((value, index) => {
    const duplicateOf = firstIndexByValue.get(value[key]);
    if (duplicateOf === undefined) {
      firstIndexByValue.set(value[key], index);
      return;
    }
    issues.push(
      issue(
        code,
        `/designFiles/${index}/${key}`,
        `${key} duplicates Design File ${duplicateOf}`,
        "Use a value that is unique within this Project manifest.",
      ),
    );
  });
}

function prefixIssues(
  issues: readonly ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((item) => ({
    ...item,
    path: `${prefix}${item.path === "/" ? "" : item.path}`,
  }));
}

function issue(
  code: string,
  path: string,
  message: string,
  recovery: string,
): ValidationIssue {
  return { code, path, message, recovery };
}
