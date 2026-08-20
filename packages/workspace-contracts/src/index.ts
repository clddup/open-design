import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const WORKSPACE_CONTRACT_VERSION = 2 as const;
export const PROJECT_MANIFEST_VERSION = "1.0.0" as const;
export const DESIGN_DELIVERY_LEDGER_VERSION = 3 as const;
export const MAX_PROJECT_DESIGN_FILES = 4_096;
export const MAX_DESIGN_TARGETS = 128;
export const MAX_SELECTED_NODE_IDS = 512;
export const MAX_ROOT_GRANTS = 128;
export const MAX_RESOURCE_REFERENCES = 1_024;

export const StableIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
});

// DesignDocument entity IDs predate the workspace contract and may contain
// provider-generated separators such as `|`. They remain opaque map keys, not
// paths or capability IDs, so task projections preserve them within a strict
// bounded/control-free envelope while all workspace-owned IDs stay StableId.
export const DesignEntityIdSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
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
    "^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*//)(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/]+(?:/[^/]+)*$",
});

const NameSchema = Type.String({ minLength: 1, maxLength: 256 });
const TitleSchema = Type.String({ minLength: 1, maxLength: 2_000 });

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

export const GlobalTaskLifecycleSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("waiting_approval"),
  Type.Literal("conflict"),
  Type.Literal("completed"),
  Type.Literal("cancelled"),
  Type.Literal("failed"),
  Type.Literal("interrupted"),
  Type.Literal("needs_attention"),
]);

export const DesignDeliveryStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("allocated"),
  Type.Literal("drafted"),
  Type.Literal("captured"),
  Type.Literal("reviewed"),
  Type.Literal("refined"),
  Type.Literal("verified"),
]);

export const DesignDeliveryTargetSchema = Type.Object(
  {
    targetId: StableIdSchema,
    label: NameSchema,
    pageId: DesignEntityIdSchema,
    rootNodeId: DesignEntityIdSchema,
    reservedNodeIds: Type.Array(DesignEntityIdSchema, {
      minItems: 1,
      maxItems: 512,
      uniqueItems: true,
    }),
    status: DesignDeliveryStatusSchema,
    allocatedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    draftRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    captureRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    reviewRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    refinementRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    verifiedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const DesignDeliveryLedgerSchema = Type.Object(
  {
    version: Type.Literal(DESIGN_DELIVERY_LEDGER_VERSION),
    targets: Type.Array(DesignDeliveryTargetSchema, {
      minItems: 1,
      maxItems: 32,
    }),
    activeTargetId: Type.Union([StableIdSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

const ResourcePermissionsSchema = Type.Array(ResourcePermissionSchema, {
  minItems: 1,
  maxItems: 4,
  uniqueItems: true,
});

export const DesignFileDescriptorSchema = Type.Object(
  {
    designFileId: StableIdSchema,
    documentId: StableIdSchema,
    name: NameSchema,
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
    name: NameSchema,
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
    title: TitleSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    lifecycle: ConversationLifecycleSchema,
  },
  { additionalProperties: false },
);

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
    name: NameSchema,
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
    rootGrants: Type.Array(RootGrantSchema, {
      maxItems: MAX_ROOT_GRANTS,
    }),
    resources: Type.Array(ResourceReferenceSchema, {
      maxItems: MAX_RESOURCE_REFERENCES,
    }),
  },
  { additionalProperties: false },
);

export const GlobalTaskProjectionSchema = Type.Object(
  {
    version: Type.Literal(WORKSPACE_CONTRACT_VERSION),
    taskId: StableIdSchema,
    conversationId: StableIdSchema,
    runId: Type.Optional(StableIdSchema),
    title: TitleSchema,
    lifecycle: GlobalTaskLifecycleSchema,
    targetSet: RunTargetSetSchema,
    delivery: Type.Optional(DesignDeliveryLedgerSchema),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export type StableId = Static<typeof StableIdSchema>;
export type ProjectLifecycle = Static<typeof ProjectLifecycleSchema>;
export type DesignFileLifecycle = Static<typeof DesignFileLifecycleSchema>;
export type ConversationLifecycle = Static<typeof ConversationLifecycleSchema>;
export type ResourcePermission = Static<typeof ResourcePermissionSchema>;
export type RootGrantLifecycle = Static<typeof RootGrantLifecycleSchema>;
export type GlobalTaskLifecycle = Static<typeof GlobalTaskLifecycleSchema>;
export type DesignDeliveryStatus = Static<typeof DesignDeliveryStatusSchema>;
export type DesignDeliveryTarget = Static<typeof DesignDeliveryTargetSchema>;
export type DesignDeliveryLedger = Static<typeof DesignDeliveryLedgerSchema>;
export type DesignFileDescriptor = Static<typeof DesignFileDescriptorSchema>;
export type ProjectManifest = Static<typeof ProjectManifestSchema>;
export type ProjectDescriptor = Static<typeof ProjectDescriptorSchema>;
export type ConversationDescriptor = Static<
  typeof ConversationDescriptorSchema
>;
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
export type GlobalTaskProjection = Static<typeof GlobalTaskProjectionSchema>;

export function isStableId(value: unknown): value is StableId {
  return checkSchema(StableIdSchema, value);
}

export function isNormalizedRelativePath(value: unknown): value is string {
  if (!checkSchema(RelativePathSchema, value)) return false;
  const segments = value.split("/");
  return (
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    )
  );
}

export function isDesignFileDescriptor(
  value: unknown,
): value is DesignFileDescriptor {
  return (
    checkSchema(DesignFileDescriptorSchema, value) &&
    isNormalizedRelativePath(value.relativePath)
  );
}

export function isProjectManifest(value: unknown): value is ProjectManifest {
  if (!checkSchema(ProjectManifestSchema, value)) return false;
  if (!value.designFiles.every(isDesignFileDescriptor)) return false;

  return (
    hasUniqueValues(
      value.designFiles.map(({ designFileId }) => designFileId),
    ) &&
    hasUniqueValues(value.designFiles.map(({ documentId }) => documentId)) &&
    hasUniqueValues(value.designFiles.map(({ relativePath }) => relativePath))
  );
}

export function isProjectDescriptor(
  value: unknown,
): value is ProjectDescriptor {
  return isProjectManifest(value);
}

export function isConversationDescriptor(
  value: unknown,
): value is ConversationDescriptor {
  return checkSchema(ConversationDescriptorSchema, value);
}

export function isResourceLocator(value: unknown): value is ResourceLocator {
  if (!checkSchema(ResourceLocatorSchema, value)) return false;
  return (
    !("relativePath" in value) || isNormalizedRelativePath(value.relativePath)
  );
}

export function isRootGrant(value: unknown): value is RootGrant {
  if (!checkSchema(RootGrantSchema, value)) return false;

  if (value.lifecycle === "active") return value.revokedAt === undefined;
  if (value.lifecycle === "revoked") return value.revokedAt !== undefined;
  return value.expiresAt !== undefined && value.revokedAt === undefined;
}

export function isResourceReference(
  value: unknown,
): value is ResourceReference {
  return (
    checkSchema(ResourceReferenceSchema, value) &&
    isResourceLocator(value.locator)
  );
}

export function isDesignTarget(value: unknown): value is DesignTarget {
  if (!checkSchema(DesignTargetSchema, value)) return false;
  return (
    value.primaryNodeId === undefined ||
    value.selectedNodeIds.includes(value.primaryNodeId)
  );
}

export function isRunTargetSet(value: unknown): value is RunTargetSet {
  if (!checkSchema(RunTargetSetSchema, value)) return false;
  if (!value.targets.every(isDesignTarget)) return false;
  if (!isDesignTarget(value.primaryTarget)) return false;

  const targetIds = value.targets.map(({ targetId }) => targetId);
  const designFiles = value.targets.map(
    ({ projectId, designFileId }) => `${projectId}\0${designFileId}`,
  );
  const primary = value.targets.find(
    ({ targetId }) => targetId === value.primaryTarget.targetId,
  );

  return (
    hasUniqueValues(targetIds) &&
    hasUniqueValues(designFiles) &&
    primary !== undefined &&
    equalDesignTargets(primary, value.primaryTarget)
  );
}

export function isRunAccessSnapshot(
  value: unknown,
): value is RunAccessSnapshot {
  if (!checkSchema(RunAccessSnapshotSchema, value)) return false;
  if (!isRunTargetSet(value.targetSet)) return false;
  if (!value.rootGrants.every(isRootGrant)) return false;
  if (!value.resources.every(isResourceReference)) return false;
  if (
    !hasUniqueValues(value.rootGrants.map(({ rootGrantId }) => rootGrantId)) ||
    !hasUniqueValues(value.resources.map(({ referenceId }) => referenceId)) ||
    value.resources.some(({ runId }) => runId !== value.runId)
  ) {
    return false;
  }

  const rootGrantsById = new Map(
    value.rootGrants.map((grant) => [grant.rootGrantId, grant]),
  );
  return (
    value.rootGrants.every(
      ({ scope }) =>
        scope.type !== "conversation" ||
        scope.conversationId === value.conversationId,
    ) &&
    value.resources.every(({ locator, permissions }) => {
      if (locator.scheme !== "root") return true;
      const grant = rootGrantsById.get(locator.rootGrantId);
      return (
        grant !== undefined &&
        permissions.every((permission) =>
          grant.permissions.includes(permission),
        )
      );
    })
  );
}

export function isGlobalTaskProjection(
  value: unknown,
): value is GlobalTaskProjection {
  return (
    checkSchema(GlobalTaskProjectionSchema, value) &&
    isRunTargetSet(value.targetSet) &&
    (value.delivery === undefined || isDesignDeliveryLedger(value.delivery))
  );
}

export function isDesignDeliveryLedger(
  value: unknown,
): value is DesignDeliveryLedger {
  if (!checkSchema(DesignDeliveryLedgerSchema, value)) return false;
  if (
    new Set(value.targets.map((target) => target.targetId)).size !==
    value.targets.length
  ) {
    return false;
  }
  if (
    new Set(
      value.targets.map((target) => `${target.pageId}:${target.rootNodeId}`),
    ).size !== value.targets.length
  ) {
    return false;
  }
  const reservedNodeIds = value.targets.flatMap(
    (target) => target.reservedNodeIds,
  );
  if (
    value.targets.some(
      (target) => !target.reservedNodeIds.includes(target.rootNodeId),
    ) ||
    new Set(reservedNodeIds).size !== reservedNodeIds.length
  ) {
    return false;
  }
  if (
    value.activeTargetId !== null &&
    !value.targets.some((target) => target.targetId === value.activeTargetId)
  ) {
    return false;
  }
  if (
    value.activeTargetId === null &&
    value.targets.some((target) => target.status !== "verified")
  ) {
    return false;
  }
  if (
    value.activeTargetId !== null &&
    value.targets.find((target) => target.targetId === value.activeTargetId)
      ?.status === "verified"
  ) {
    return false;
  }
  return value.targets.every(hasValidDeliveryRevisions);
}

function hasValidDeliveryRevisions(target: DesignDeliveryTarget): boolean {
  const ordered = [
    target.allocatedRevision,
    target.draftRevision,
    target.captureRevision,
    target.reviewRevision,
    target.refinementRevision,
    target.verifiedRevision,
  ];
  const requiredCount =
    target.status === "pending"
      ? 0
      : target.status === "allocated"
        ? 1
        : target.status === "drafted"
          ? 2
          : target.status === "captured"
            ? 3
            : target.status === "reviewed"
              ? 4
              : target.status === "refined"
                ? 5
                : 6;
  if (
    ordered.slice(0, requiredCount).some((revision) => revision === undefined)
  ) {
    return false;
  }
  if (ordered.slice(requiredCount).some((revision) => revision !== undefined)) {
    return false;
  }
  const revisions = ordered.slice(0, requiredCount) as number[];
  return revisions.every(
    (revision, index) => index === 0 || revision >= (revisions[index - 1] ?? 0),
  );
}

/** Upgrade persisted v1/v2 delivery ledgers without inventing old Plan IDs. */
export function normalizeDesignDeliveryLedger(
  value: unknown,
): DesignDeliveryLedger | null {
  if (isDesignDeliveryLedger(value)) return structuredClone(value);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ((value as { version?: unknown }).version !== 1 &&
      (value as { version?: unknown }).version !== 2)
  ) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const rawTargets: unknown[] | undefined = Array.isArray(raw.targets)
    ? (raw.targets as unknown[])
    : undefined;
  const legacyVersion = raw.version;
  const targets = rawTargets
    ? rawTargets.map((target) => {
        if (
          typeof target !== "object" ||
          target === null ||
          Array.isArray(target)
        ) {
          return target;
        }
        const rawTarget = target as Record<string, unknown>;
        const withAllocation =
          legacyVersion === 1 && rawTarget.status !== "pending"
            ? { ...rawTarget, allocatedRevision: rawTarget.draftRevision }
            : { ...rawTarget };
        return {
          ...withAllocation,
          reservedNodeIds: [rawTarget.rootNodeId],
        };
      })
    : raw.targets;
  const candidate = {
    ...raw,
    version: DESIGN_DELIVERY_LEDGER_VERSION,
    targets,
  };
  return isDesignDeliveryLedger(candidate) ? structuredClone(candidate) : null;
}

/** Upgrade a persisted task projection after validating the complete result. */
export function normalizeGlobalTaskProjection(
  value: unknown,
): GlobalTaskProjection | null {
  if (isGlobalTaskProjection(value)) return structuredClone(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const delivery = normalizeDesignDeliveryLedger(raw.delivery);
  if (!delivery) return null;
  const candidate = { ...raw, delivery };
  return isGlobalTaskProjection(candidate) ? structuredClone(candidate) : null;
}

function equalDesignTargets(left: DesignTarget, right: DesignTarget): boolean {
  return (
    left.targetId === right.targetId &&
    left.projectId === right.projectId &&
    left.designFileId === right.designFileId &&
    left.documentId === right.documentId &&
    left.pageId === right.pageId &&
    left.frameId === right.frameId &&
    left.baseRevision === right.baseRevision &&
    left.primaryNodeId === right.primaryNodeId &&
    left.selectedNodeIds.length === right.selectedNodeIds.length &&
    left.selectedNodeIds.every(
      (nodeId, index) => nodeId === right.selectedNodeIds[index],
    )
  );
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function checkSchema<T extends TSchema>(
  schema: T,
  value: unknown,
): value is Static<T> {
  try {
    return Value.Check(schema, value);
  } catch {
    return false;
  }
}
