import { Type, type Static } from "@sinclair/typebox";
import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import {
  DesignEntityIdSchema,
  RunTargetSetSchema,
  runTargetSetDomainIssues,
} from "./access.js";
import { WORKSPACE_CONTRACT_VERSION } from "./constants.js";
import {
  ConversationTitleSchema,
  StableIdSchema,
  TimestampSchema,
  WorkspaceNameSchema,
} from "./descriptors.js";

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

export const DesignDeliveryLedgerContract =
  defineContract<DesignDeliveryLedger>({
    schema: DesignDeliveryLedgerSchema,
    code: "workspace.delivery_ledger_invalid",
    subject: "Design delivery ledger",
    refine: designDeliveryLedgerDomainIssues,
    clone: false,
  });

export const GlobalTaskProjectionContract =
  defineContract<GlobalTaskProjection>({
    schema: GlobalTaskProjectionSchema,
    code: "workspace.global_task_projection_invalid",
    subject: "Global Task projection",
    refine: globalTaskProjectionDomainIssues,
    clone: false,
  });

export function isDesignDeliveryLedger(
  value: unknown,
): value is DesignDeliveryLedger {
  return DesignDeliveryLedgerContract.parse(value).ok;
}

export function isGlobalTaskProjection(
  value: unknown,
): value is GlobalTaskProjection {
  return GlobalTaskProjectionContract.parse(value).ok;
}

export function designDeliveryLedgerDomainIssues(
  value: DesignDeliveryLedger,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  appendDuplicateTargetIssues(issues, value.targets);
  appendReservationIssues(issues, value.targets);

  const activeTarget =
    value.activeTargetId === null
      ? undefined
      : value.targets.find(
          (target) => target.targetId === value.activeTargetId,
        );
  if (value.activeTargetId !== null && !activeTarget) {
    issues.push(
      issue(
        "workspace.delivery_active_target_missing",
        "/activeTargetId",
        "activeTargetId must reference a delivery target",
      ),
    );
  }
  if (
    value.activeTargetId === null &&
    value.targets.some((target) => target.status !== "verified")
  ) {
    issues.push(
      issue(
        "workspace.delivery_active_target_required",
        "/activeTargetId",
        "A non-verified delivery requires an active target",
      ),
    );
  }
  if (activeTarget?.status === "verified") {
    issues.push(
      issue(
        "workspace.delivery_verified_target_active",
        "/activeTargetId",
        "A verified delivery target cannot remain active",
      ),
    );
  }
  value.targets.forEach((target, index) => {
    issues.push(...revisionIssues(target, index));
  });
  return issues;
}

function globalTaskProjectionDomainIssues(
  value: GlobalTaskProjection,
): ValidationIssue[] {
  const issues = prefixIssues(
    runTargetSetDomainIssues(value.targetSet),
    "/targetSet",
  );
  if (value.delivery) {
    issues.push(
      ...prefixIssues(
        designDeliveryLedgerDomainIssues(value.delivery),
        "/delivery",
      ),
    );
  }
  return issues;
}

function appendDuplicateTargetIssues(
  issues: ValidationIssue[],
  targets: readonly DesignDeliveryTarget[],
): void {
  appendDuplicateIssues(
    issues,
    targets.map((target) => target.targetId),
    "targetId",
    "workspace.delivery_target_id_duplicate",
  );
  appendDuplicateIssues(
    issues,
    targets.map((target) => JSON.stringify([target.pageId, target.rootNodeId])),
    "rootNodeId",
    "workspace.delivery_artboard_duplicate",
  );
}

function appendReservationIssues(
  issues: ValidationIssue[],
  targets: readonly DesignDeliveryTarget[],
): void {
  const ownerByNodeId = new Map<string, number>();
  targets.forEach((target, targetIndex) => {
    if (!target.reservedNodeIds.includes(target.rootNodeId)) {
      issues.push(
        issue(
          "workspace.delivery_root_not_reserved",
          `/targets/${targetIndex}/reservedNodeIds`,
          "Delivery rootNodeId must belong to reservedNodeIds",
        ),
      );
    }
    target.reservedNodeIds.forEach((nodeId, nodeIndex) => {
      const owner = ownerByNodeId.get(nodeId);
      if (owner === undefined) {
        ownerByNodeId.set(nodeId, targetIndex);
        return;
      }
      issues.push(
        issue(
          "workspace.delivery_reserved_node_duplicate",
          `/targets/${targetIndex}/reservedNodeIds/${nodeIndex}`,
          `Reserved node is already owned by delivery target ${owner}`,
        ),
      );
    });
  });
}

const REVISION_FIELDS = [
  "allocatedRevision",
  "draftRevision",
  "captureRevision",
  "reviewRevision",
  "refinementRevision",
  "verifiedRevision",
] as const;

function revisionIssues(
  target: DesignDeliveryTarget,
  targetIndex: number,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const prefix = `/targets/${targetIndex}`;
  if (target.status === "verified") {
    const required = [
      "allocatedRevision",
      "draftRevision",
      "captureRevision",
      "reviewRevision",
      "verifiedRevision",
    ] as const;
    required.forEach((field) => {
      if (target[field] !== undefined) return;
      issues.push(missingRevisionIssue(prefix, field, target.status));
    });
    appendMonotonicRevisionIssues(issues, target, prefix, [
      "allocatedRevision",
      "draftRevision",
      "captureRevision",
      "reviewRevision",
      ...(target.refinementRevision === undefined
        ? []
        : (["refinementRevision"] as const)),
      "verifiedRevision",
    ]);
    return issues;
  }

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
  REVISION_FIELDS.forEach((field, fieldIndex) => {
    const revision = target[field];
    if (fieldIndex < requiredCount && revision === undefined) {
      issues.push(missingRevisionIssue(prefix, field, target.status));
    } else if (fieldIndex >= requiredCount && revision !== undefined) {
      issues.push(
        issue(
          "workspace.delivery_revision_not_allowed",
          `${prefix}/${field}`,
          `${field} is not allowed while delivery status is ${target.status}`,
        ),
      );
    }
  });
  appendMonotonicRevisionIssues(
    issues,
    target,
    prefix,
    REVISION_FIELDS.slice(0, requiredCount),
  );
  return issues;
}

function missingRevisionIssue(
  prefix: string,
  field: (typeof REVISION_FIELDS)[number],
  status: DesignDeliveryStatus,
): ValidationIssue {
  return issue(
    "workspace.delivery_revision_missing",
    `${prefix}/${field}`,
    `${field} is required while delivery status is ${status}`,
  );
}

function appendMonotonicRevisionIssues(
  issues: ValidationIssue[],
  target: DesignDeliveryTarget,
  prefix: string,
  fields: readonly (typeof REVISION_FIELDS)[number][],
): void {
  let previous: number | undefined;
  fields.forEach((field) => {
    const revision = target[field];
    if (revision === undefined) return;
    if (previous !== undefined && revision < previous) {
      issues.push(
        issue(
          "workspace.delivery_revision_regressed",
          `${prefix}/${field}`,
          `${field} must not precede the prior delivery revision`,
        ),
      );
    }
    previous = revision;
  });
}

function appendDuplicateIssues(
  issues: ValidationIssue[],
  values: readonly string[],
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
        `/targets/${index}/${field}`,
        `${field} must be unique within this delivery ledger`,
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
    recovery: "Use the current authoritative task and delivery state.",
  };
}
