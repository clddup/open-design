import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { WORKSPACE_CONTRACT_VERSION } from "./constants.js";
import {
  RelativePathSchema,
  StableIdSchema,
  TimestampSchema,
  WorkspaceNameSchema,
} from "./descriptors.js";

export const MAX_DESIGN_TARGETS = 128;
export const MAX_SELECTED_NODE_IDS = 512;
export const MAX_ROOT_GRANTS = 128;
export const MAX_RESOURCE_REFERENCES = 1_024;

// DesignDocument entity IDs predate the workspace contract and may contain
// provider-generated separators such as `|`. They remain opaque map keys, not
// paths or capability IDs, while workspace-owned IDs stay StableId.
export const DesignEntityIdSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});

export const ResourcePermissionSchema = Type.Union([
  Type.Literal("read"),
  Type.Literal("write"),
  Type.Literal("create"),
  Type.Literal("delete"),
]);

export const RootGrantLifecycleSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("expired"),
  Type.Literal("revoked"),
]);

const ResourcePermissionsSchema = Type.Array(ResourcePermissionSchema, {
  minItems: 1,
  maxItems: 4,
  uniqueItems: true,
});

export const ProjectResourceLocatorSchema = Type.Object(
  {
    scheme: Type.Literal("project"),
    projectId: StableIdSchema,
    relativePath: RelativePathSchema,
  },
  { additionalProperties: false },
);

export const RootResourceLocatorSchema = Type.Object(
  {
    scheme: Type.Literal("root"),
    rootGrantId: StableIdSchema,
    relativePath: RelativePathSchema,
  },
  { additionalProperties: false },
);

export const DesignResourceLocatorSchema = Type.Object(
  {
    scheme: Type.Literal("design"),
    projectId: StableIdSchema,
    designFileId: StableIdSchema,
    documentId: StableIdSchema,
  },
  { additionalProperties: false },
);

export const AssetResourceLocatorSchema = Type.Object(
  {
    scheme: Type.Literal("asset"),
    projectId: StableIdSchema,
    assetId: StableIdSchema,
  },
  { additionalProperties: false },
);

export const ExternalResourceLocatorSchema = Type.Object(
  {
    scheme: Type.Literal("external"),
    providerId: StableIdSchema,
    externalResourceId: StableIdSchema,
  },
  { additionalProperties: false },
);

export const ExportResourceLocatorSchema = Type.Object(
  {
    scheme: Type.Literal("export"),
    projectId: StableIdSchema,
    exportId: StableIdSchema,
    relativePath: RelativePathSchema,
  },
  { additionalProperties: false },
);

export const SystemFontResourceLocatorSchema = Type.Object(
  {
    scheme: Type.Literal("system-font"),
    fontId: StableIdSchema,
  },
  { additionalProperties: false },
);

export const ResourceLocatorSchema = Type.Union([
  ProjectResourceLocatorSchema,
  RootResourceLocatorSchema,
  DesignResourceLocatorSchema,
  AssetResourceLocatorSchema,
  ExternalResourceLocatorSchema,
  ExportResourceLocatorSchema,
  SystemFontResourceLocatorSchema,
]);

export const RootGrantScopeSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("conversation"),
      conversationId: StableIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("project"),
      projectId: StableIdSchema,
    },
    { additionalProperties: false },
  ),
]);

export const RootGrantSchema = Type.Object(
  {
    version: Type.Literal(WORKSPACE_CONTRACT_VERSION),
    rootGrantId: StableIdSchema,
    rootId: StableIdSchema,
    name: WorkspaceNameSchema,
    scope: RootGrantScopeSchema,
    permissions: ResourcePermissionsSchema,
    discoverProjectConfig: Type.Literal(false, { default: false }),
    lifecycle: RootGrantLifecycleSchema,
    createdAt: TimestampSchema,
    expiresAt: Type.Optional(TimestampSchema),
    revokedAt: Type.Optional(TimestampSchema),
  },
  { additionalProperties: false },
);

export const ResourceReferenceKindSchema = Type.Union([
  Type.Literal("snapshot"),
  Type.Literal("live"),
]);

export const ResourceObjectSchema = Type.Union([
  Type.Literal("file"),
  Type.Literal("directory"),
]);

export const ContentHashSchema = Type.String({
  minLength: 71,
  maxLength: 71,
  pattern: "^sha256:[a-f0-9]{64}$",
});

export const ResourceReferenceSchema = Type.Object(
  {
    referenceId: StableIdSchema,
    runId: StableIdSchema,
    kind: ResourceReferenceKindSchema,
    object: ResourceObjectSchema,
    locator: ResourceLocatorSchema,
    permissions: ResourcePermissionsSchema,
    expiresAt: Type.Optional(TimestampSchema),
    contentHash: Type.Optional(ContentHashSchema),
  },
  { additionalProperties: false },
);

export const DesignTargetSchema = Type.Object(
  {
    targetId: StableIdSchema,
    projectId: StableIdSchema,
    designFileId: StableIdSchema,
    documentId: StableIdSchema,
    pageId: DesignEntityIdSchema,
    frameId: Type.Optional(DesignEntityIdSchema),
    selectedNodeIds: Type.Array(DesignEntityIdSchema, {
      maxItems: MAX_SELECTED_NODE_IDS,
      uniqueItems: true,
    }),
    primaryNodeId: Type.Optional(DesignEntityIdSchema),
    baseRevision: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const RunTargetSetSchema = Type.Object(
  {
    targets: Type.Array(DesignTargetSchema, {
      minItems: 1,
      maxItems: MAX_DESIGN_TARGETS,
    }),
    primaryTarget: DesignTargetSchema,
  },
  { additionalProperties: false },
);

export const RunAccessSnapshotSchema = Type.Object(
  {
    version: Type.Literal(WORKSPACE_CONTRACT_VERSION),
    snapshotId: StableIdSchema,
    runId: StableIdSchema,
    conversationId: StableIdSchema,
    capturedAt: TimestampSchema,
    targetSet: RunTargetSetSchema,
    rootGrants: Type.Array(RootGrantSchema, { maxItems: MAX_ROOT_GRANTS }),
    resources: Type.Array(ResourceReferenceSchema, {
      maxItems: MAX_RESOURCE_REFERENCES,
    }),
  },
  { additionalProperties: false },
);

export type ResourcePermission = Static<typeof ResourcePermissionSchema>;
export type RootGrantLifecycle = Static<typeof RootGrantLifecycleSchema>;
export type ProjectResourceLocator = Static<
  typeof ProjectResourceLocatorSchema
>;
export type RootResourceLocator = Static<typeof RootResourceLocatorSchema>;
export type DesignResourceLocator = Static<typeof DesignResourceLocatorSchema>;
export type AssetResourceLocator = Static<typeof AssetResourceLocatorSchema>;
export type ExternalResourceLocator = Static<
  typeof ExternalResourceLocatorSchema
>;
export type ExportResourceLocator = Static<typeof ExportResourceLocatorSchema>;
export type SystemFontResourceLocator = Static<
  typeof SystemFontResourceLocatorSchema
>;
export type ResourceLocator = Static<typeof ResourceLocatorSchema>;
export type RootGrantScope = Static<typeof RootGrantScopeSchema>;
export type RootGrant = Static<typeof RootGrantSchema>;
export type ResourceReferenceKind = Static<typeof ResourceReferenceKindSchema>;
export type ResourceObject = Static<typeof ResourceObjectSchema>;
export type ResourceReference = Static<typeof ResourceReferenceSchema>;
export type DesignTarget = Static<typeof DesignTargetSchema>;
export type RunTargetSet = Static<typeof RunTargetSetSchema>;
export type RunAccessSnapshot = Static<typeof RunAccessSnapshotSchema>;

export const ResourceLocatorContract = defineContract<ResourceLocator>({
  schema: ResourceLocatorSchema,
  code: "workspace.resource_locator_invalid",
  subject: "Workspace resource locator",
  clone: false,
});

export const RootGrantContract = defineContract<RootGrant>({
  schema: RootGrantSchema,
  code: "workspace.root_grant_invalid",
  subject: "Workspace root grant",
  refine: rootGrantIssues,
  clone: false,
});

export const ResourceReferenceContract = defineContract<ResourceReference>({
  schema: ResourceReferenceSchema,
  code: "workspace.resource_reference_invalid",
  subject: "Workspace resource reference",
  clone: false,
});

export const DesignTargetContract = defineContract<DesignTarget>({
  schema: DesignTargetSchema,
  code: "workspace.design_target_invalid",
  subject: "Workspace design target",
  refine: designTargetIssues,
  clone: false,
});

export const RunTargetSetContract = defineContract<RunTargetSet>({
  schema: RunTargetSetSchema,
  code: "workspace.run_target_set_invalid",
  subject: "Run target set",
  refine: runTargetSetIssues,
  clone: false,
});

export const RunAccessSnapshotContract = defineContract<RunAccessSnapshot>({
  schema: RunAccessSnapshotSchema,
  code: "workspace.run_access_snapshot_invalid",
  subject: "Run access snapshot",
  refine: runAccessSnapshotIssues,
  clone: false,
});

export function isResourceLocator(value: unknown): value is ResourceLocator {
  return ResourceLocatorContract.parse(value).ok;
}

export function isRootGrant(value: unknown): value is RootGrant {
  return RootGrantContract.parse(value).ok;
}

export function isResourceReference(
  value: unknown,
): value is ResourceReference {
  return ResourceReferenceContract.parse(value).ok;
}

export function isDesignTarget(value: unknown): value is DesignTarget {
  return DesignTargetContract.parse(value).ok;
}

export function isRunTargetSet(value: unknown): value is RunTargetSet {
  return RunTargetSetContract.parse(value).ok;
}

export function isRunAccessSnapshot(
  value: unknown,
): value is RunAccessSnapshot {
  return RunAccessSnapshotContract.parse(value).ok;
}

function rootGrantIssues(value: RootGrant): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value.lifecycle === "active" && value.revokedAt !== undefined) {
    issues.push(
      issue(
        "workspace.active_grant_revoked",
        "/revokedAt",
        "An active root grant cannot have a revocation time",
      ),
    );
  } else if (value.lifecycle === "revoked" && value.revokedAt === undefined) {
    issues.push(
      issue(
        "workspace.revoked_grant_time_missing",
        "/revokedAt",
        "A revoked root grant requires a revocation time",
      ),
    );
  } else if (value.lifecycle === "expired") {
    if (value.expiresAt === undefined) {
      issues.push(
        issue(
          "workspace.expired_grant_time_missing",
          "/expiresAt",
          "An expired root grant requires an expiry time",
        ),
      );
    }
    if (value.revokedAt !== undefined) {
      issues.push(
        issue(
          "workspace.expired_grant_revoked",
          "/revokedAt",
          "An expired root grant cannot also be revoked",
        ),
      );
    }
  }
  return issues;
}

function designTargetIssues(value: DesignTarget): ValidationIssue[] {
  return value.primaryNodeId === undefined ||
    value.selectedNodeIds.includes(value.primaryNodeId)
    ? []
    : [
        issue(
          "workspace.primary_selection_invalid",
          "/primaryNodeId",
          "Primary node must belong to selectedNodeIds",
        ),
      ];
}

function runTargetSetIssues(value: RunTargetSet): ValidationIssue[] {
  const issues = value.targets.flatMap((target, index) =>
    prefixIssues(designTargetIssues(target), `/targets/${index}`),
  );
  issues.push(
    ...prefixIssues(designTargetIssues(value.primaryTarget), "/primaryTarget"),
  );
  appendDuplicateIssues(
    issues,
    value.targets.map((target) => target.targetId),
    "/targets",
    "targetId",
    "workspace.target_id_duplicate",
  );
  appendDuplicateIssues(
    issues,
    value.targets.map(
      (target) => `${target.projectId}\0${target.designFileId}`,
    ),
    "/targets",
    "designFileId",
    "workspace.target_design_file_duplicate",
  );
  const primary = value.targets.find(
    (target) => target.targetId === value.primaryTarget.targetId,
  );
  if (!primary) {
    issues.push(
      issue(
        "workspace.primary_target_missing",
        "/primaryTarget/targetId",
        "Primary target must belong to targets",
      ),
    );
  } else if (!Value.Equal(primary, value.primaryTarget)) {
    issues.push(
      issue(
        "workspace.primary_target_mismatch",
        "/primaryTarget",
        "Primary target must equal its canonical target entry",
      ),
    );
  }
  return issues;
}

function runAccessSnapshotIssues(value: RunAccessSnapshot): ValidationIssue[] {
  const issues = prefixIssues(
    runTargetSetIssues(value.targetSet),
    "/targetSet",
  );
  value.rootGrants.forEach((grant, index) => {
    issues.push(
      ...prefixIssues(rootGrantIssues(grant), `/rootGrants/${index}`),
    );
  });
  appendDuplicateIssues(
    issues,
    value.rootGrants.map((grant) => grant.rootGrantId),
    "/rootGrants",
    "rootGrantId",
    "workspace.root_grant_id_duplicate",
  );
  appendDuplicateIssues(
    issues,
    value.resources.map((resource) => resource.referenceId),
    "/resources",
    "referenceId",
    "workspace.reference_id_duplicate",
  );
  const rootGrantsById = new Map(
    value.rootGrants.map((grant) => [grant.rootGrantId, grant]),
  );
  value.rootGrants.forEach((grant, index) => {
    if (
      grant.scope.type === "conversation" &&
      grant.scope.conversationId !== value.conversationId
    ) {
      issues.push(
        issue(
          "workspace.grant_conversation_mismatch",
          `/rootGrants/${index}/scope/conversationId`,
          "Conversation-scoped grant must match the snapshot Conversation",
        ),
      );
    }
  });
  value.resources.forEach((resource, resourceIndex) => {
    if (resource.runId !== value.runId) {
      issues.push(
        issue(
          "workspace.reference_run_mismatch",
          `/resources/${resourceIndex}/runId`,
          "Resource reference must match the snapshot Run",
        ),
      );
    }
    if (resource.locator.scheme !== "root") return;
    const grant = rootGrantsById.get(resource.locator.rootGrantId);
    if (!grant) {
      issues.push(
        issue(
          "workspace.reference_grant_missing",
          `/resources/${resourceIndex}/locator/rootGrantId`,
          "Root locator must reference a grant in this snapshot",
        ),
      );
      return;
    }
    resource.permissions.forEach((permission, permissionIndex) => {
      if (grant.permissions.includes(permission)) return;
      issues.push(
        issue(
          "workspace.reference_permission_exceeds_grant",
          `/resources/${resourceIndex}/permissions/${permissionIndex}`,
          "Resource permission must be included by its root grant",
        ),
      );
    });
  });
  return issues;
}

function appendDuplicateIssues(
  issues: ValidationIssue[],
  values: readonly string[],
  collectionPath: string,
  field: string,
  code: string,
): void {
  const firstIndexByValue = new Map<string, number>();
  values.forEach((value, index) => {
    if (!firstIndexByValue.has(value)) {
      firstIndexByValue.set(value, index);
      return;
    }
    issues.push(
      issue(
        code,
        `${collectionPath}/${index}/${field}`,
        `${field} must be unique within this collection`,
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

function issue(code: string, path: string, message: string): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery: "Use only the current Main-authorized Run access state.",
  };
}
