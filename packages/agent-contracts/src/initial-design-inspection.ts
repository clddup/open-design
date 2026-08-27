import { Type, type Static } from "@sinclair/typebox";
import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import {
  DesignDeliveryLedgerSchema,
  designDeliveryLedgerDomainIssues,
} from "@opendesign/workspace-contracts";
import {
  DesignDeliveryStageSchema,
  designDeliveryStageIssues,
} from "./design-delivery-stage.js";

export const MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS = 60_000;

const InspectionIdSchema = Type.String({ minLength: 1, maxLength: 512 });
const InitialInspectedPageSchema = Type.Intersect([
  Type.Record(Type.String(), Type.Unknown()),
  Type.Object(
    {
      id: InspectionIdSchema,
      rootNodeIds: Type.Array(InspectionIdSchema, {
        maxItems: 100_000,
        uniqueItems: true,
      }),
    },
    { additionalProperties: true },
  ),
]);
const InitialInspectedNodeSchema = Type.Intersect([
  Type.Record(Type.String(), Type.Unknown()),
  Type.Object(
    {
      id: InspectionIdSchema,
      kind: Type.String({ minLength: 1, maxLength: 64 }),
      childIds: Type.Array(InspectionIdSchema, {
        maxItems: 100_000,
        uniqueItems: true,
      }),
    },
    { additionalProperties: true },
  ),
]);
const InitialInspectedDocumentSchema = Type.Object(
  {
    documentId: InspectionIdSchema,
    revision: Type.Integer({ minimum: 0 }),
    pagesById: Type.Record(InspectionIdSchema, InitialInspectedPageSchema, {
      maxProperties: 10_000,
    }),
    nodesById: Type.Record(InspectionIdSchema, InitialInspectedNodeSchema, {
      maxProperties: 100_000,
    }),
  },
  { additionalProperties: true },
);

export const AgentInitialDesignInspectionContentSchema = Type.Object(
  {
    inspection: Type.Intersect([
      Type.Record(Type.String(), Type.Unknown(), { minProperties: 1 }),
      Type.Object(
        { document: Type.Optional(InitialInspectedDocumentSchema) },
        { additionalProperties: true },
      ),
    ]),
    unfinishedDelivery: Type.Optional(DesignDeliveryLedgerSchema),
    deliveryStage: Type.Optional(DesignDeliveryStageSchema),
  },
  { additionalProperties: false },
);

export const AgentInitialDesignInspectionSchema = Type.Object(
  {
    version: Type.Literal(1),
    observedRevision: Type.Integer({ minimum: 0 }),
    content: AgentInitialDesignInspectionContentSchema,
  },
  { additionalProperties: false },
);

export type AgentInitialDesignInspectionContent = Static<
  typeof AgentInitialDesignInspectionContentSchema
>;
export type AgentInitialDesignInspection = Static<
  typeof AgentInitialDesignInspectionSchema
>;

export const AgentInitialDesignInspectionContract =
  defineContract<AgentInitialDesignInspection>({
    schema: AgentInitialDesignInspectionSchema,
    code: "agent_initial_inspection.schema_invalid",
    subject: "Agent initial design inspection",
    maximum: 64,
    clone: false,
    refine: agentInitialDesignInspectionDomainIssues,
  });

export function agentInitialDesignInspectionDomainIssues(
  value: AgentInitialDesignInspection,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const length = serializedLength(value.content);
  if (length < 2 || length > MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS) {
    issues.push({
      code: "agent_initial_inspection.content_size_invalid",
      path: "/content",
      message: "Initial design inspection content exceeds its model budget",
      expected: `2..${MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS}`,
      actual: Number.isFinite(length) ? length : "not JSON serializable",
      recovery:
        "Regenerate the bounded model projection from the trusted inspection.",
    });
  }
  const document = value.content.inspection.document;
  if (document && document.revision !== value.observedRevision) {
    issues.push({
      code: "agent_initial_inspection.revision_mismatch",
      path: "/content/inspection/document/revision",
      message:
        "Inspected document revision must match the initial observed revision",
      expected: value.observedRevision,
      actual: document.revision,
      recovery: "Regenerate initial inspection from the exact bound revision.",
    });
  }
  if (value.content.unfinishedDelivery) {
    issues.push(
      ...prefixIssues(
        designDeliveryLedgerDomainIssues(value.content.unfinishedDelivery),
        "/content/unfinishedDelivery",
      ),
    );
  }
  if (value.content.deliveryStage) {
    issues.push(
      ...prefixIssues(
        designDeliveryStageIssues(value.content.deliveryStage),
        "/content/deliveryStage",
      ),
    );
  }
  return issues;
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function prefixIssues(
  issues: readonly ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path === "/" ? prefix : `${prefix}${issue.path}`,
  }));
}
