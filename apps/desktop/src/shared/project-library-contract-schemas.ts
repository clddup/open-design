import { LibraryReleaseSnapshotSchema } from "@opendesign/design-contracts";
import {
  StableIdSchema,
  TimestampSchema,
} from "@opendesign/workspace-contracts";
import { Type, type Static } from "@sinclair/typebox";

const LibraryStorageIdSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
});
const LibraryNameSchema = Type.String({ minLength: 1, maxLength: 256 });
const LibraryReleaseSummarySchema = Type.Object(
  {
    releaseId: LibraryStorageIdSchema,
    publishedAt: TimestampSchema,
  },
  { additionalProperties: false },
);
const EnabledLibraryIdsByDesignFileIdSchema = Type.Record(
  StableIdSchema,
  Type.Array(LibraryStorageIdSchema, {
    maxItems: 4_096,
    uniqueItems: true,
  }),
);
const ReleaseIdsByLibraryIdSchema = Type.Record(
  LibraryStorageIdSchema,
  LibraryStorageIdSchema,
);
const ReleaseDecisionsByDesignFileIdSchema = Type.Record(
  StableIdSchema,
  ReleaseIdsByLibraryIdSchema,
);

export const ProjectLibraryCatalogEntrySchema = Type.Object(
  {
    libraryId: LibraryStorageIdSchema,
    name: LibraryNameSchema,
    sourceProjectId: StableIdSchema,
    sourceDesignFileId: StableIdSchema,
    sourceDocumentId: StableIdSchema,
    latestReleaseId: LibraryStorageIdSchema,
    publishedAt: TimestampSchema,
    releases: Type.Array(LibraryReleaseSummarySchema, {
      minItems: 1,
      maxItems: 4_096,
    }),
  },
  { additionalProperties: false },
);

export const ProjectLibraryCatalogSchema = Type.Object(
  {
    version: Type.Literal(1),
    libraries: Type.Array(ProjectLibraryCatalogEntrySchema, {
      maxItems: 4_096,
    }),
    enabledLibraryIdsByDesignFileId: EnabledLibraryIdsByDesignFileIdSchema,
    acceptedReleaseIdsByDesignFileId: ReleaseDecisionsByDesignFileIdSchema,
    ignoredReleaseIdsByDesignFileId: ReleaseDecisionsByDesignFileIdSchema,
  },
  { additionalProperties: false },
);

export const PublishProjectLibraryRequestSchema = Type.Object(
  {
    projectId: StableIdSchema,
    designFileId: StableIdSchema,
    name: Type.Optional(LibraryNameSchema),
  },
  { additionalProperties: false },
);

export const PublishProjectLibraryResultSchema = Type.Object(
  {
    catalog: ProjectLibraryCatalogSchema,
    entry: ProjectLibraryCatalogEntrySchema,
    release: LibraryReleaseSnapshotSchema,
  },
  { additionalProperties: false },
);

export const ListProjectLibrariesRequestSchema = Type.Object(
  { projectId: StableIdSchema },
  { additionalProperties: false },
);

export const ReadProjectLibraryReleaseRequestSchema = Type.Object(
  {
    projectId: StableIdSchema,
    libraryId: LibraryStorageIdSchema,
    releaseId: Type.Optional(LibraryStorageIdSchema),
  },
  { additionalProperties: false },
);

export const SetProjectLibraryEnabledRequestSchema = Type.Object(
  {
    projectId: StableIdSchema,
    designFileId: StableIdSchema,
    libraryId: LibraryStorageIdSchema,
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const SetProjectLibraryUpdateIgnoredRequestSchema = Type.Object(
  {
    projectId: StableIdSchema,
    designFileId: StableIdSchema,
    libraryId: LibraryStorageIdSchema,
    releaseId: Type.Union([LibraryStorageIdSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const SetProjectLibraryUpdateAcceptedRequestSchema = Type.Object(
  {
    projectId: StableIdSchema,
    designFileId: StableIdSchema,
    libraryId: LibraryStorageIdSchema,
    releaseId: LibraryStorageIdSchema,
  },
  { additionalProperties: false },
);

export type ProjectLibraryCatalogEntry = Static<
  typeof ProjectLibraryCatalogEntrySchema
>;
export type ProjectLibraryCatalog = Static<typeof ProjectLibraryCatalogSchema>;
export type PublishProjectLibraryRequest = Static<
  typeof PublishProjectLibraryRequestSchema
>;
export type PublishProjectLibraryResult = Static<
  typeof PublishProjectLibraryResultSchema
>;
export type ListProjectLibrariesRequest = Static<
  typeof ListProjectLibrariesRequestSchema
>;
export type ReadProjectLibraryReleaseRequest = Static<
  typeof ReadProjectLibraryReleaseRequestSchema
>;
export type SetProjectLibraryEnabledRequest = Static<
  typeof SetProjectLibraryEnabledRequestSchema
>;
export type SetProjectLibraryUpdateIgnoredRequest = Static<
  typeof SetProjectLibraryUpdateIgnoredRequestSchema
>;
export type SetProjectLibraryUpdateAcceptedRequest = Static<
  typeof SetProjectLibraryUpdateAcceptedRequestSchema
>;
