import {
  designDocumentDomainIssues,
  type DesignDocument,
} from "@opendesign/design-contracts";
import {
  DesignFileDescriptorSchema,
  ProjectManifestSchema,
  designFileDescriptorDomainIssues,
  projectManifestDomainIssues,
  type DesignFileDescriptor,
  type ProjectManifest,
} from "@opendesign/workspace-contracts";
import {
  defineContract,
  type ValidationIssue,
  type ValidationIssueValue,
} from "./contract-validation";
import {
  CreateProjectDesignFileRequestSchema,
  ProjectDesignFileRequestSchema,
  ProjectDesignFileSchema,
  ProjectIdentityRequestSchema,
  ProjectManifestListSchema,
  RecentProjectListSchema,
  RecentProjectSchema,
  RenameProjectDesignFileRequestSchema,
  SaveProjectDesignFileRequestSchema,
  type CreateProjectDesignFileRequest,
  type CreateProjectRequest,
  type ProjectDesignFile,
  type ProjectDesignFileRequest,
  type ProjectIdentityRequest,
  type RecentProject,
  type RenameProjectDesignFileRequest,
  type SaveProjectDesignFileRequest,
} from "./project-file-contract-schemas";

export * from "./project-file-contract-schemas";

export type ProjectManifestResponseContext =
  { kind: "unbound" } | { kind: "project"; projectId: string };

export type ProjectDesignFileResponseContext =
  | { kind: "unbound" }
  | { kind: "create"; request: CreateProjectDesignFileRequest }
  | { kind: "read"; request: ProjectDesignFileRequest }
  | { kind: "save"; request: SaveProjectDesignFileRequest };

export type RenameProjectDesignFileResponseContext =
  | { kind: "unbound" }
  | { kind: "rename"; request: RenameProjectDesignFileRequest };

export const ProjectIdentityRequestContract =
  defineContract<ProjectIdentityRequest>({
    schema: ProjectIdentityRequestSchema,
    code: "project.identity_request_invalid",
    subject: "Project identity request",
    clone: false,
  });

export const RecentProjectContract = defineContract<RecentProject>({
  schema: RecentProjectSchema,
  code: "project.recent_entry_invalid",
  subject: "Recent Project entry",
  clone: false,
});

export const RecentProjectListContract = defineContract<RecentProject[]>({
  schema: RecentProjectListSchema,
  code: "project.recent_list_invalid",
  subject: "Recent Project list",
  refine: recentProjectListIssues,
  clone: false,
});

export const ProjectManifestResponseContract = defineContract<
  ProjectManifest,
  ProjectManifest,
  ProjectManifestResponseContext
>(
  {
    schema: ProjectManifestSchema,
    code: "project.manifest_response_invalid",
    subject: "Project manifest response",
    refine: projectManifestResponseIssues,
    clone: false,
  },
  () => ({ kind: "unbound" }),
);

export const ProjectManifestListContract = defineContract<ProjectManifest[]>({
  schema: ProjectManifestListSchema,
  code: "project.manifest_list_invalid",
  subject: "Project manifest list",
  refine: projectManifestListIssues,
  clone: false,
});

export const CreateProjectDesignFileRequestContract =
  defineContract<CreateProjectDesignFileRequest>({
    schema: CreateProjectDesignFileRequestSchema,
    code: "project.design_file_create_request_invalid",
    subject: "Design File create request",
    refine: createProjectDesignFileRequestIssues,
    clone: false,
  });

export const ProjectDesignFileRequestContract =
  defineContract<ProjectDesignFileRequest>({
    schema: ProjectDesignFileRequestSchema,
    code: "project.design_file_request_invalid",
    subject: "Design File request",
    clone: false,
  });

export const SaveProjectDesignFileRequestContract =
  defineContract<SaveProjectDesignFileRequest>({
    schema: SaveProjectDesignFileRequestSchema,
    code: "project.design_file_save_request_invalid",
    subject: "Design File save request",
    refine: (value) => designDocumentIssues(value.document, "/document"),
    clone: false,
  });

export const RenameProjectDesignFileRequestContract =
  defineContract<RenameProjectDesignFileRequest>({
    schema: RenameProjectDesignFileRequestSchema,
    code: "project.design_file_rename_request_invalid",
    subject: "Design File rename request",
    refine: renameProjectDesignFileRequestIssues,
    clone: false,
  });

export const ProjectDesignFileContract = defineContract<
  ProjectDesignFile,
  ProjectDesignFile,
  ProjectDesignFileResponseContext
>(
  {
    schema: ProjectDesignFileSchema,
    code: "project.design_file_invalid",
    subject: "Project Design File",
    refine: projectDesignFileIssues,
    clone: false,
  },
  () => ({ kind: "unbound" }),
);

export const RenameProjectDesignFileResultContract = defineContract<
  DesignFileDescriptor,
  DesignFileDescriptor,
  RenameProjectDesignFileResponseContext
>(
  {
    schema: DesignFileDescriptorSchema,
    code: "project.design_file_rename_response_invalid",
    subject: "Design File rename response",
    refine: renameProjectDesignFileResponseIssues,
    clone: false,
  },
  () => ({ kind: "unbound" }),
);

export const CreateProjectRequestContract = ProjectIdentityRequestContract;
export const OpenRecentProjectRequestContract = ProjectIdentityRequestContract;

export function isCreateProjectRequest(
  value: unknown,
): value is CreateProjectRequest {
  return ProjectIdentityRequestContract.parse(value).ok;
}

export const isOpenRecentProjectRequest = isCreateProjectRequest;

export function isRecentProject(value: unknown): value is RecentProject {
  return RecentProjectContract.parse(value).ok;
}

export function isCreateProjectDesignFileRequest(
  value: unknown,
): value is CreateProjectDesignFileRequest {
  return CreateProjectDesignFileRequestContract.parse(value).ok;
}

export function isProjectDesignFileRequest(
  value: unknown,
): value is ProjectDesignFileRequest {
  return ProjectDesignFileRequestContract.parse(value).ok;
}

export function isSaveProjectDesignFileRequest(
  value: unknown,
): value is SaveProjectDesignFileRequest {
  return SaveProjectDesignFileRequestContract.parse(value).ok;
}

export function isRenameProjectDesignFileRequest(
  value: unknown,
): value is RenameProjectDesignFileRequest {
  return RenameProjectDesignFileRequestContract.parse(value).ok;
}

export function isProjectDesignFile(
  value: unknown,
): value is ProjectDesignFile {
  return ProjectDesignFileContract.parse(value).ok;
}

export function isDesignFileDescriptorResult(
  value: unknown,
): value is DesignFileDescriptor {
  return RenameProjectDesignFileResultContract.parse(value).ok;
}

export function isProjectManifestResult(
  value: unknown,
): value is ProjectManifest {
  return ProjectManifestResponseContract.parse(value).ok;
}

function createProjectDesignFileRequestIssues(
  value: CreateProjectDesignFileRequest,
): ValidationIssue[] {
  return [
    ...descriptorIssues(value.descriptor, "/descriptor"),
    ...designDocumentIssues(value.document, "/document"),
    ...documentIdentityIssues(value.descriptor, value.document),
  ];
}

function renameProjectDesignFileRequestIssues(
  value: RenameProjectDesignFileRequest,
): ValidationIssue[] {
  return value.name === value.name.trim()
    ? []
    : [
        mismatchIssue(
          "project.design_file_name_not_trimmed",
          "/name",
          value.name.trim(),
          value.name,
          "Remove leading and trailing whitespace from the Design File name.",
        ),
      ];
}

function projectDesignFileIssues(
  value: ProjectDesignFile,
  context: ProjectDesignFileResponseContext,
): ValidationIssue[] {
  const issues = [
    ...descriptorIssues(value.descriptor, "/descriptor"),
    ...designDocumentIssues(value.document, "/document"),
    ...documentIdentityIssues(value.descriptor, value.document),
  ];
  if (context.kind === "unbound") return issues;
  if (context.kind === "create") {
    appendMismatch(
      issues,
      "/descriptor/designFileId",
      context.request.descriptor.designFileId,
      value.descriptor.designFileId,
    );
    appendDocumentResponseIssues(
      issues,
      value.document,
      context.request.document,
    );
    return issues;
  }
  appendMismatch(
    issues,
    "/descriptor/designFileId",
    context.request.designFileId,
    value.descriptor.designFileId,
  );
  if (context.kind === "save") {
    appendDocumentResponseIssues(
      issues,
      value.document,
      context.request.document,
    );
  }
  return issues;
}

function appendDocumentResponseIssues(
  issues: ValidationIssue[],
  actual: DesignDocument,
  expected: DesignDocument,
): void {
  appendMismatch(
    issues,
    "/document/documentId",
    expected.documentId,
    actual.documentId,
  );
  appendMismatch(
    issues,
    "/document/revision",
    expected.revision,
    actual.revision,
  );
}

function renameProjectDesignFileResponseIssues(
  value: DesignFileDescriptor,
  context: RenameProjectDesignFileResponseContext,
): ValidationIssue[] {
  const issues = descriptorIssues(value, "");
  if (context.kind === "unbound") return issues;
  appendMismatch(
    issues,
    "/designFileId",
    context.request.designFileId,
    value.designFileId,
  );
  appendMismatch(issues, "/name", context.request.name, value.name);
  return issues;
}

function projectManifestResponseIssues(
  value: ProjectManifest,
  context: ProjectManifestResponseContext,
): ValidationIssue[] {
  const issues = projectManifestDomainIssues(value);
  if (context.kind === "project") {
    appendMismatch(issues, "/projectId", context.projectId, value.projectId);
  }
  return issues;
}

function projectManifestListIssues(
  value: readonly ProjectManifest[],
): ValidationIssue[] {
  const issues = value.flatMap((manifest, index) =>
    prefixIssues(projectManifestDomainIssues(manifest), `/${index}`),
  );
  appendDuplicateIdIssues(issues, value, "projectId");
  return issues;
}

function recentProjectListIssues(
  value: readonly RecentProject[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  appendDuplicateIdIssues(issues, value, "projectId");
  return issues;
}

function descriptorIssues(
  value: DesignFileDescriptor,
  prefix: string,
): ValidationIssue[] {
  return prefixIssues(designFileDescriptorDomainIssues(value), prefix);
}

function designDocumentIssues(
  value: DesignDocument,
  prefix: string,
): ValidationIssue[] {
  return prefixIssues(designDocumentDomainIssues(value), prefix);
}

function documentIdentityIssues(
  descriptor: DesignFileDescriptor,
  document: DesignDocument,
): ValidationIssue[] {
  if (descriptor.documentId === document.documentId) return [];
  return [
    mismatchIssue(
      "project.design_file_document_mismatch",
      "/document/documentId",
      descriptor.documentId,
      document.documentId,
      "Return the document owned by this exact Design File descriptor.",
    ),
  ];
}

function appendMismatch(
  issues: ValidationIssue[],
  path: string,
  expected: ValidationIssueValue,
  actual: ValidationIssueValue,
): void {
  if (expected === actual) return;
  issues.push(
    mismatchIssue(
      "project.response_mismatch",
      path,
      expected,
      actual,
      "Return the Main-owned result for this exact Project request.",
    ),
  );
}

function mismatchIssue(
  code: string,
  path: string,
  expected: ValidationIssueValue,
  actual: ValidationIssueValue,
  recovery: string,
): ValidationIssue {
  return {
    code,
    path,
    message: "Project value does not match its request",
    expected,
    actual,
    recovery,
  };
}

function appendDuplicateIdIssues<
  Value extends Record<Key, string>,
  Key extends string,
>(issues: ValidationIssue[], values: readonly Value[], key: Key): void {
  const firstIndexById = new Map<string, number>();
  values.forEach((value, index) => {
    const duplicateOf = firstIndexById.get(value[key]);
    if (duplicateOf === undefined) {
      firstIndexById.set(value[key], index);
      return;
    }
    issues.push({
      code: "project.list_id_duplicate",
      path: `/${index}/${key}`,
      message: `${key} duplicates item ${duplicateOf}`,
      expected: { unique: true },
      actual: value[key],
      recovery: "Return each Project exactly once.",
    });
  });
}

function prefixIssues(
  issues: readonly ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: `${prefix}${issue.path === "/" ? "" : issue.path}`,
  }));
}
