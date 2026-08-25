import {
  DESIGN_FONT_TOOL_INPUT_SCHEMA,
  DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
} from "./design-agent-typography-tool-schema";
import type {
  DesignFontToolInput,
  DesignTextRangeToolInput,
} from "./design-agent-typography-tool-types";
import {
  contractDiscriminatedSchemaIssues,
  contractSchemaIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./contract-validation";

export {
  DESIGN_FONT_TOOL_INPUT_SCHEMA,
  DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
} from "./design-agent-typography-tool-schema";
export type {
  DesignFontToolInput,
  DesignTextRangeToolInput,
} from "./design-agent-typography-tool-types";

function parseDesignFont(
  input: unknown,
): ValidationResult<DesignFontToolInput> {
  const issues = contractDiscriminatedSchemaIssues(
    DESIGN_FONT_TOOL_INPUT_SCHEMA,
    input,
    "action",
    {
      code: "design_font.schema_invalid",
      subject: "Font",
      maximum: 24,
    },
  );
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: structuredClone(input as DesignFontToolInput) };
}

export const DesignFontContract = {
  schema: DESIGN_FONT_TOOL_INPUT_SCHEMA,
  parse: parseDesignFont,
  issues: (input: unknown): ValidationIssue[] => {
    const result = parseDesignFont(input);
    return result.ok ? [] : result.issues;
  },
} as const;

function parseDesignTextRange(
  input: unknown,
): ValidationResult<DesignTextRangeToolInput> {
  const structureIssues = contractSchemaIssues(
    DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
    input,
    {
      code: "design_text_range.schema_invalid",
      subject: "Text Range",
      maximum: 24,
    },
  );
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }

  const value = structuredClone(input as DesignTextRangeToolInput);
  if (value.end <= value.start) {
    return {
      ok: false,
      issues: [
        {
          code: "design_text_range.range_empty",
          path: "/end",
          message: "end must be greater than start for a non-empty range",
          expected: { exclusiveMinimum: value.start },
          actual: value.end,
          recovery:
            "Inspect the current Text content and submit a non-empty UTF-16 [start,end) range without guessing offsets.",
        },
      ],
    };
  }
  return { ok: true, value };
}

export const DesignTextRangeContract = {
  schema: DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
  parse: parseDesignTextRange,
  issues: (input: unknown): ValidationIssue[] => {
    const result = parseDesignTextRange(input);
    return result.ok ? [] : result.issues;
  },
} as const;
