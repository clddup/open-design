import type { DesignStyleToolInput } from "./design-style-tool-contract";
import { DESIGN_STYLE_TOOL_INPUT_SCHEMA } from "./design-style-tool-schema";
import {
  contractDiscriminatedSchemaIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./contract-validation";

export type { DesignStyleToolInput } from "./design-style-tool-contract";

function parseDesignStyle(
  input: unknown,
): ValidationResult<DesignStyleToolInput> {
  const issues = contractDiscriminatedSchemaIssues(
    DESIGN_STYLE_TOOL_INPUT_SCHEMA,
    input,
    "action",
    {
      code: "design_style.schema_invalid",
      subject: "Style",
      maximum: 24,
    },
  );
  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        value: structuredClone(input) as DesignStyleToolInput,
      };
}

function designStyleIssues(input: unknown): ValidationIssue[] {
  const result = parseDesignStyle(input);
  return result.ok ? [] : result.issues;
}

export const DesignStyleContract = {
  schema: DESIGN_STYLE_TOOL_INPUT_SCHEMA,
  parse: parseDesignStyle,
  issues: designStyleIssues,
} as const;
