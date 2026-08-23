import {
  boundedText,
  boundedTextArray,
  exactKeys,
  isRecord,
} from "./design-agent-validation";

export const DESIGN_REFERENCE_DECISIONS = [
  "style-reference",
  "composition-reference",
  "brand-reference",
  "content-asset",
  "ignore",
] as const;

export type DesignReferenceDecision =
  (typeof DESIGN_REFERENCE_DECISIONS)[number];

export type DesignReferenceStrategy = {
  synthesis: string;
  references: Array<{
    attachmentId: string;
    decision: DesignReferenceDecision;
    application: string;
    preserve: string[];
    avoid: string[];
  }>;
};

export const MAX_ACTIVE_VISUAL_REFERENCES = 2;

const IMAGE_ATTACHMENT_ID_PATTERN = /^image_[a-f0-9]{64}$/;

export const DESIGN_REFERENCE_STRATEGY_SCHEMA = {
  type: "object",
  description:
    "Declare only current-Run images intentionally used as references or content; undeclared images are ignored and at most two style/composition/brand references may be active.",
  properties: {
    synthesis: { type: "string", minLength: 12, maxLength: 1_000 },
    references: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          attachmentId: {
            type: "string",
            pattern: "^image_[a-f0-9]{64}$",
          },
          decision: { enum: [...DESIGN_REFERENCE_DECISIONS] },
          application: { type: "string", minLength: 12, maxLength: 1_000 },
          preserve: {
            type: "array",
            maxItems: 6,
            uniqueItems: true,
            items: { type: "string", minLength: 4, maxLength: 256 },
          },
          avoid: {
            type: "array",
            maxItems: 6,
            uniqueItems: true,
            items: { type: "string", minLength: 4, maxLength: 256 },
          },
        },
        required: [
          "attachmentId",
          "decision",
          "application",
          "preserve",
          "avoid",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["synthesis", "references"],
  additionalProperties: false,
} as const;

export function isDesignReferenceStrategy(
  value: unknown,
): value is DesignReferenceStrategy {
  if (
    !isRecord(value) ||
    !boundedText(value.synthesis, 1_000) ||
    value.synthesis.trim().length < 12 ||
    !Array.isArray(value.references) ||
    value.references.length > 6 ||
    !exactKeys(value, ["synthesis", "references"])
  ) {
    return false;
  }
  const attachmentIds = new Set<string>();
  let activeVisualReferences = 0;
  for (const reference of value.references) {
    if (
      !isRecord(reference) ||
      typeof reference.attachmentId !== "string" ||
      !IMAGE_ATTACHMENT_ID_PATTERN.test(reference.attachmentId) ||
      !DESIGN_REFERENCE_DECISIONS.includes(
        reference.decision as DesignReferenceDecision,
      ) ||
      !boundedText(reference.application, 1_000) ||
      reference.application.trim().length < 12 ||
      !boundedTextArray(reference.preserve, 0, 6, 256) ||
      !reference.preserve.every((item) => item.trim().length >= 4) ||
      new Set(reference.preserve).size !== reference.preserve.length ||
      !boundedTextArray(reference.avoid, 0, 6, 256) ||
      !reference.avoid.every((item) => item.trim().length >= 4) ||
      new Set(reference.avoid).size !== reference.avoid.length ||
      !exactKeys(reference, [
        "attachmentId",
        "decision",
        "application",
        "preserve",
        "avoid",
      ]) ||
      attachmentIds.has(reference.attachmentId)
    ) {
      return false;
    }
    attachmentIds.add(reference.attachmentId);
    if (
      isActiveVisualReferenceDecision(
        reference.decision as DesignReferenceDecision,
      )
    ) {
      activeVisualReferences += 1;
    }
  }
  return activeVisualReferences <= MAX_ACTIVE_VISUAL_REFERENCES;
}

export function activeVisualReferenceIds(
  strategy: DesignReferenceStrategy | undefined,
): string[] {
  return (
    strategy?.references
      .filter((reference) =>
        isActiveVisualReferenceDecision(reference.decision),
      )
      .map((reference) => reference.attachmentId) ?? []
  );
}

export function isActiveVisualReferenceDecision(
  decision: DesignReferenceDecision,
): boolean {
  return (
    decision === "style-reference" ||
    decision === "composition-reference" ||
    decision === "brand-reference"
  );
}
