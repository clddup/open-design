import { defineContract } from "./contract-validation";
import {
  projectLibraryCatalogEntryIssues,
  projectLibraryCatalogIssues,
  projectLibraryIssue,
  publishProjectLibraryResultIssues,
} from "./project-library-contract-domain";
import {
  ListProjectLibrariesRequestSchema,
  ProjectLibraryCatalogEntrySchema,
  ProjectLibraryCatalogSchema,
  PublishProjectLibraryRequestSchema,
  PublishProjectLibraryResultSchema,
  ReadProjectLibraryReleaseRequestSchema,
  SetProjectLibraryEnabledRequestSchema,
  SetProjectLibraryUpdateAcceptedRequestSchema,
  SetProjectLibraryUpdateIgnoredRequestSchema,
  type ListProjectLibrariesRequest,
  type ProjectLibraryCatalog,
  type ProjectLibraryCatalogEntry,
  type PublishProjectLibraryRequest,
  type PublishProjectLibraryResult,
  type ReadProjectLibraryReleaseRequest,
  type SetProjectLibraryEnabledRequest,
  type SetProjectLibraryUpdateAcceptedRequest,
  type SetProjectLibraryUpdateIgnoredRequest,
} from "./project-library-contract-schemas";

export const ProjectLibraryCatalogEntryContract =
  defineContract<ProjectLibraryCatalogEntry>({
    schema: ProjectLibraryCatalogEntrySchema,
    code: "project_library_catalog_entry.schema_invalid",
    subject: "Project Library catalog entry",
    clone: false,
    refine: projectLibraryCatalogEntryIssues,
  });

export const ProjectLibraryCatalogContract =
  defineContract<ProjectLibraryCatalog>({
    schema: ProjectLibraryCatalogSchema,
    code: "project_library_catalog.schema_invalid",
    subject: "Project Library catalog",
    clone: false,
    refine: projectLibraryCatalogIssues,
  });

export const PublishProjectLibraryRequestContract =
  defineContract<PublishProjectLibraryRequest>({
    schema: PublishProjectLibraryRequestSchema,
    code: "publish_project_library_request.schema_invalid",
    subject: "Publish Project Library request",
    clone: false,
    refine: (value) =>
      value.name === undefined || value.name.trim().length > 0
        ? []
        : [
            projectLibraryIssue(
              "publish_project_library_request.name_empty",
              "/name",
              "Library name must contain visible text",
            ),
          ],
  });

export const PublishProjectLibraryResultContract =
  defineContract<PublishProjectLibraryResult>({
    schema: PublishProjectLibraryResultSchema,
    code: "publish_project_library_result.schema_invalid",
    subject: "Publish Project Library result",
    clone: false,
    refine: publishProjectLibraryResultIssues,
  });

export const ListProjectLibrariesRequestContract =
  defineContract<ListProjectLibrariesRequest>({
    schema: ListProjectLibrariesRequestSchema,
    code: "list_project_libraries_request.schema_invalid",
    subject: "List Project Libraries request",
    clone: false,
  });

export const ReadProjectLibraryReleaseRequestContract =
  defineContract<ReadProjectLibraryReleaseRequest>({
    schema: ReadProjectLibraryReleaseRequestSchema,
    code: "read_project_library_release_request.schema_invalid",
    subject: "Read Project Library release request",
    clone: false,
  });

export const SetProjectLibraryEnabledRequestContract =
  defineContract<SetProjectLibraryEnabledRequest>({
    schema: SetProjectLibraryEnabledRequestSchema,
    code: "set_project_library_enabled_request.schema_invalid",
    subject: "Set Project Library enabled request",
    clone: false,
  });

export const SetProjectLibraryUpdateIgnoredRequestContract =
  defineContract<SetProjectLibraryUpdateIgnoredRequest>({
    schema: SetProjectLibraryUpdateIgnoredRequestSchema,
    code: "set_project_library_update_ignored_request.schema_invalid",
    subject: "Set Project Library ignored release request",
    clone: false,
  });

export const SetProjectLibraryUpdateAcceptedRequestContract =
  defineContract<SetProjectLibraryUpdateAcceptedRequest>({
    schema: SetProjectLibraryUpdateAcceptedRequestSchema,
    code: "set_project_library_update_accepted_request.schema_invalid",
    subject: "Set Project Library accepted release request",
    clone: false,
  });

export function isProjectLibraryCatalog(
  value: unknown,
): value is ProjectLibraryCatalog {
  return ProjectLibraryCatalogContract.parse(value).ok;
}

export function isProjectLibraryCatalogEntry(
  value: unknown,
): value is ProjectLibraryCatalogEntry {
  return ProjectLibraryCatalogEntryContract.parse(value).ok;
}

export function isPublishProjectLibraryRequest(
  value: unknown,
): value is PublishProjectLibraryRequest {
  return PublishProjectLibraryRequestContract.parse(value).ok;
}

export function isPublishProjectLibraryResult(
  value: unknown,
): value is PublishProjectLibraryResult {
  return PublishProjectLibraryResultContract.parse(value).ok;
}

export function isListProjectLibrariesRequest(
  value: unknown,
): value is ListProjectLibrariesRequest {
  return ListProjectLibrariesRequestContract.parse(value).ok;
}

export function isReadProjectLibraryReleaseRequest(
  value: unknown,
): value is ReadProjectLibraryReleaseRequest {
  return ReadProjectLibraryReleaseRequestContract.parse(value).ok;
}

export function isSetProjectLibraryEnabledRequest(
  value: unknown,
): value is SetProjectLibraryEnabledRequest {
  return SetProjectLibraryEnabledRequestContract.parse(value).ok;
}

export function isSetProjectLibraryUpdateIgnoredRequest(
  value: unknown,
): value is SetProjectLibraryUpdateIgnoredRequest {
  return SetProjectLibraryUpdateIgnoredRequestContract.parse(value).ok;
}

export function isSetProjectLibraryUpdateAcceptedRequest(
  value: unknown,
): value is SetProjectLibraryUpdateAcceptedRequest {
  return SetProjectLibraryUpdateAcceptedRequestContract.parse(value).ok;
}

export * from "./project-library-contract-schemas";
