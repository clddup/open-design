export type DesignBriefFidelity = {
  requiredContent: string[];
  preservedSemantics: string[];
  prohibitedAdditions: string[];
  assumptions: string[];
};

const FIDELITY_ITEM_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 500,
  pattern: "\\S",
} as const;

export const DESIGN_BRIEF_FIDELITY_SCHEMA = {
  type: "object",
  description:
    "Executable fidelity contract derived from the latest user request and inspected product. Visual restyling preserves existing product semantics by default and must not invent unrequested capabilities.",
  properties: {
    requiredContent: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: FIDELITY_ITEM_SCHEMA,
    },
    preservedSemantics: {
      type: "array",
      maxItems: 24,
      items: FIDELITY_ITEM_SCHEMA,
    },
    prohibitedAdditions: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: FIDELITY_ITEM_SCHEMA,
    },
    assumptions: {
      type: "array",
      maxItems: 12,
      items: FIDELITY_ITEM_SCHEMA,
    },
  },
  required: [
    "requiredContent",
    "preservedSemantics",
    "prohibitedAdditions",
    "assumptions",
  ],
  additionalProperties: false,
} as const;
