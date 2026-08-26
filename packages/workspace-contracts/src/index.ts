import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ConversationTitleSchema,
  StableIdSchema,
  TimestampSchema,
  WorkspaceNameSchema,
} from "./descriptors.js";
export * from "./descriptors.js";
import {
  DesignEntityIdSchema,
  RunTargetSetSchema,
  isRunTargetSet,
} from "./access.js";
import { WORKSPACE_CONTRACT_VERSION } from "./constants.js";
export * from "./access.js";
export * from "./constants.js";

export const DESIGN_DELIVERY_LEDGER_VERSION = 3 as const;

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
    label: WorkspaceNameSchema,
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

export const GlobalTaskProjectionSchema = Type.Object(
  {
    version: Type.Literal(WORKSPACE_CONTRACT_VERSION),
    taskId: StableIdSchema,
    conversationId: StableIdSchema,
    runId: Type.Optional(StableIdSchema),
    title: ConversationTitleSchema,
    lifecycle: GlobalTaskLifecycleSchema,
    targetSet: RunTargetSetSchema,
    delivery: Type.Optional(DesignDeliveryLedgerSchema),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export type GlobalTaskLifecycle = Static<typeof GlobalTaskLifecycleSchema>;
export type DesignDeliveryStatus = Static<typeof DesignDeliveryStatusSchema>;
export type DesignDeliveryTarget = Static<typeof DesignDeliveryTargetSchema>;
export type DesignDeliveryLedger = Static<typeof DesignDeliveryLedgerSchema>;
export type GlobalTaskProjection = Static<typeof GlobalTaskProjectionSchema>;

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
  if (target.status === "verified") {
    const required = [
      target.allocatedRevision,
      target.draftRevision,
      target.captureRevision,
      target.reviewRevision,
      target.verifiedRevision,
    ];
    if (required.some((revision) => revision === undefined)) return false;
    const revisions = [
      target.allocatedRevision,
      target.draftRevision,
      target.captureRevision,
      target.reviewRevision,
      ...(target.refinementRevision === undefined
        ? []
        : [target.refinementRevision]),
      target.verifiedRevision,
    ] as number[];
    return revisions.every(
      (revision, index) =>
        index === 0 || revision >= (revisions[index - 1] ?? 0),
    );
  }
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
              : 5;
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
