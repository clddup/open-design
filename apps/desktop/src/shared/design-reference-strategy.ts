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

export const DESIGN_REFERENCE_STRATEGY_SCHEMA = {
  type: "object",
  description:
    "Declare only images from this Conversation that are intentionally used as references or content; undeclared images are ignored and at most two style/composition/brand references may be active.",
  properties: {
    synthesis: {
      type: "string",
      minLength: 12,
      maxLength: 1_000,
      pattern: "\\S",
    },
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
          application: {
            type: "string",
            minLength: 12,
            maxLength: 1_000,
            pattern: "\\S",
          },
          preserve: {
            type: "array",
            maxItems: 6,
            uniqueItems: true,
            items: {
              type: "string",
              minLength: 4,
              maxLength: 256,
              pattern: "\\S",
            },
          },
          avoid: {
            type: "array",
            maxItems: 6,
            uniqueItems: true,
            items: {
              type: "string",
              minLength: 4,
              maxLength: 256,
              pattern: "\\S",
            },
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
