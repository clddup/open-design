import {
  DesignDocumentSchema,
  type DesignDocument,
} from "@opendesign/design-contracts";
import {
  DesignFileDescriptorSchema,
  ProjectManifestSchema,
  StableIdSchema,
  TimestampSchema,
  WorkspaceNameSchema,
  type DesignFileDescriptor,
} from "@opendesign/workspace-contracts";
import { Type, type Static } from "@sinclair/typebox";

export const ProjectIdentityRequestSchema = Type.Object(
  { projectId: StableIdSchema },
  { additionalProperties: false },
);

export const RecentProjectSchema = Type.Object(
  {
    projectId: StableIdSchema,
    name: WorkspaceNameSchema,
    lastOpenedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const RecentProjectListSchema = Type.Array(RecentProjectSchema, {
  maxItems: 100_000,
});

export const ProjectManifestListSchema = Type.Array(ProjectManifestSchema, {
  maxItems: 100_000,
});

export const CreateProjectDesignFileRequestSchema = Type.Object(
  {
    projectId: StableIdSchema,
    descriptor: DesignFileDescriptorSchema,
    document: DesignDocumentSchema,
  },
  { additionalProperties: false },
);

export const ProjectDesignFileRequestSchema = Type.Object(
  {
    projectId: StableIdSchema,
    designFileId: StableIdSchema,
  },
  { additionalProperties: false },
);

export const SaveProjectDesignFileRequestSchema = Type.Object(
  {
    projectId: StableIdSchema,
    designFileId: StableIdSchema,
    document: DesignDocumentSchema,
  },
  { additionalProperties: false },
);

export const RenameProjectDesignFileRequestSchema = Type.Object(
  {
    projectId: StableIdSchema,
    designFileId: StableIdSchema,
    name: WorkspaceNameSchema,
  },
  { additionalProperties: false },
);

export const ProjectDesignFileSchema = Type.Object(
  {
    descriptor: DesignFileDescriptorSchema,
    document: DesignDocumentSchema,
  },
  { additionalProperties: false },
);

export type ProjectIdentityRequest = Static<
  typeof ProjectIdentityRequestSchema
>;
export type CreateProjectRequest = ProjectIdentityRequest;
export type OpenRecentProjectRequest = ProjectIdentityRequest;
export type RecentProject = Static<typeof RecentProjectSchema>;
export type CreateProjectDesignFileRequest = {
  projectId: string;
  descriptor: DesignFileDescriptor;
  document: DesignDocument;
};
export type ProjectDesignFileRequest = Static<
  typeof ProjectDesignFileRequestSchema
>;
export type SaveProjectDesignFileRequest = {
  projectId: string;
  designFileId: string;
  document: DesignDocument;
};
export type RenameProjectDesignFileRequest = Static<
  typeof RenameProjectDesignFileRequestSchema
>;
export type ProjectDesignFile = {
  descriptor: DesignFileDescriptor;
  document: DesignDocument;
};
