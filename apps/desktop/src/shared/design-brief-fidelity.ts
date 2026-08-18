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

export function isDesignBriefFidelity(
  value: unknown,
): value is DesignBriefFidelity {
  if (!isRecord(value)) return false;
  return (
    boundedTextArray(value.requiredContent, 1, 24) &&
    boundedTextArray(value.preservedSemantics, 0, 24) &&
    boundedTextArray(value.prohibitedAdditions, 1, 24) &&
    boundedTextArray(value.assumptions, 0, 12) &&
    exactKeys(value, [
      "requiredContent",
      "preservedSemantics",
      "prohibitedAdditions",
      "assumptions",
    ])
  );
}

function boundedTextArray(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.length <= 500,
    )
  );
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
