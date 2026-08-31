import { Type, type Static } from "@opendesign/design-contracts";
import { defineContract, type ValidationIssue } from "./contract-validation";

const CLOSED = { additionalProperties: false } as const;
const STABLE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]*$";
const TEXT_PATTERN = "\\S";

const text = (minimum: number, maximum: number) =>
  Type.String({
    minLength: minimum,
    maxLength: maximum,
    pattern: TEXT_PATTERN,
  });

const deliverableSchema = Type.Union([
  Type.Literal("ui"),
  Type.Literal("poster"),
  Type.Literal("logo"),
  Type.Literal("brand-asset"),
  Type.Literal("illustration"),
  Type.Literal("presentation-visual"),
  Type.Literal("other"),
]);

export const DESIGN_DELIVERY_SCOPE_TOOL_INPUT_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    deliverable: deliverableSchema,
    objective: text(1, 1_000),
    targets: Type.Array(
      Type.Object(
        {
          targetId: Type.String({
            minLength: 1,
            maxLength: 128,
            pattern: STABLE_ID_PATTERN,
          }),
          label: text(1, 128),
          objective: text(8, 500),
          artboard: Type.Object(
            {
              width: Type.Number({ minimum: 16, maximum: 100_000 }),
              height: Type.Number({ minimum: 16, maximum: 100_000 }),
            },
            {
              ...CLOSED,
              description:
                "The real editable artboard size to allocate immediately after the user confirms this delivery scope.",
            },
          ),
          requiredContent: Type.Array(text(2, 240), {
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
          }),
        },
        CLOSED,
      ),
      { minItems: 1, maxItems: 24 },
    ),
    exclusions: Type.Array(text(2, 240), {
      maxItems: 12,
      uniqueItems: true,
    }),
    assumptions: Type.Array(text(2, 240), {
      maxItems: 12,
      uniqueItems: true,
    }),
  },
  {
    ...CLOSED,
    description:
      "User-visible delivery scope for a broad brief. Each target is one independently verifiable artboard deliverable, not a document Page, section, layer, or decorative variant. Delivery scope never grants or requests Page lifecycle changes.",
  },
);

export type DesignDeliveryScope = Static<
  typeof DESIGN_DELIVERY_SCOPE_TOOL_INPUT_SCHEMA
>;

export const DeliveryScopeContract = defineContract<DesignDeliveryScope>({
  schema: DESIGN_DELIVERY_SCOPE_TOOL_INPUT_SCHEMA,
  code: "delivery_scope.schema_invalid",
  subject: "Delivery Scope",
  maximum: 32,
  refine: refineDeliveryScope,
});

export function deliveryScopeApprovalPrompt(
  input: unknown,
  request: Readonly<{ prompt: string }>,
): { title: string; summary: string } {
  const parsed = DeliveryScopeContract.parse(input);
  if (!parsed.ok) {
    return {
      title: "Review delivery plan",
      summary: "Review the proposed delivery scope before design begins.",
    };
  }
  const scope = parsed.value;
  const chinese = /[\u3400-\u9fff]/u.test(request.prompt);
  const targets = scope.targets
    .map(
      (target, index) =>
        `${index + 1}. ${target.label} · ${target.artboard.width}×${target.artboard.height} — ${target.objective}`,
    )
    .join("\n");
  const boundary =
    scope.exclusions.length === 0
      ? ""
      : `\n\n${chinese ? "本次不包含" : "Not included"}: ${scope.exclusions.join(
          chinese ? "；" : "; ",
        )}`;
  const organization = chinese
    ? `将在当前 Page 创建 ${scope.targets.length} 个画板。`
    : `${scope.targets.length} artboard${scope.targets.length === 1 ? "" : "s"} will be created on the current Page.`;
  return {
    title: chinese
      ? `确认交付计划（${scope.targets.length} 项）`
      : `Confirm delivery plan (${scope.targets.length})`,
    summary: `${organization}\n\n${targets}${boundary}`.slice(0, 20_000),
  };
}

function refineDeliveryScope(scope: DesignDeliveryScope): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const targetIds = new Set<string>();
  const labels = new Set<string>();
  for (const [index, target] of scope.targets.entries()) {
    if (targetIds.has(target.targetId)) {
      issues.push({
        code: "delivery_scope.target_id_duplicate",
        path: `/targets/${index}/targetId`,
        message: `Target ID ${target.targetId} is duplicated`,
        recovery:
          "Give every independently verifiable deliverable one stable target ID.",
      });
    }
    targetIds.add(target.targetId);
    const normalizedLabel = target.label.trim().toLocaleLowerCase();
    if (labels.has(normalizedLabel)) {
      issues.push({
        code: "delivery_scope.target_label_duplicate",
        path: `/targets/${index}/label`,
        message: `Target label ${target.label} is duplicated`,
        recovery:
          "Use distinct user-facing labels so the plan can be reviewed unambiguously.",
      });
    }
    labels.add(normalizedLabel);
  }
  return issues;
}
