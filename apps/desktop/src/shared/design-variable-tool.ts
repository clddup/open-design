import type { DesignVariableToolInput } from "./design-variable-tool-contract";
import { DESIGN_VARIABLE_TOOL_INPUT_SCHEMA } from "./design-variable-tool-schema";
import {
  contractDiscriminatedSchemaIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./contract-validation";

export type { DesignVariableToolInput } from "./design-variable-tool-contract";

function parseDesignVariable(
  input: unknown,
): ValidationResult<DesignVariableToolInput> {
  const structureIssues = contractDiscriminatedSchemaIssues(
    DESIGN_VARIABLE_TOOL_INPUT_SCHEMA,
    input,
    "action",
    {
      code: "design_variable.schema_invalid",
      subject: "Variable",
      maximum: 32,
    },
  );
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }

  const value = input as DesignVariableToolInput;
  const domainIssues = refineDesignVariable(value);
  return domainIssues.length > 0
    ? { ok: false, issues: domainIssues }
    : { ok: true, value: structuredClone(value) };
}

function designVariableIssues(input: unknown): ValidationIssue[] {
  const result = parseDesignVariable(input);
  return result.ok ? [] : result.issues;
}

export const DesignVariableContract = {
  schema: DESIGN_VARIABLE_TOOL_INPUT_SCHEMA,
  parse: parseDesignVariable,
  issues: designVariableIssues,
} as const;

function refineDesignVariable(
  input: DesignVariableToolInput,
): ValidationIssue[] {
  const keyIssue =
    input.action === "create-variable"
      ? invalidRecordKey(input.valuesByMode, "/valuesByMode")
      : input.action === "add-mode"
        ? invalidRecordKey(input.valuesByVariableId, "/valuesByVariableId")
        : null;
  if (keyIssue) return [keyIssue];
  if (
    input.action === "remove-mode" &&
    input.modeId === input.replacementModeId
  ) {
    return [
      {
        code: "design_variable.replacement_mode_not_distinct",
        path: "/replacementModeId",
        message: "replacementModeId must identify a different mode",
        expected: "A current mode ID other than modeId",
        actual: input.replacementModeId,
        recovery:
          "Inspect the collection and choose another existing mode as the replacement.",
      },
    ];
  }
  return [];
}

function invalidRecordKey(
  values: Readonly<Record<string, unknown>>,
  path: string,
): ValidationIssue | null {
  const key = Object.keys(values).find(
    (candidate) => candidate.length === 0 || candidate.length > 256,
  );
  if (key === undefined) return null;
  return {
    code: "design_variable.record_key_invalid",
    path: `${path}/${escapePointer(key)}`,
    message: "Variable map keys must contain 1 to 256 characters",
    expected: { minLength: 1, maxLength: 256 },
    actual: key,
    recovery: "Use the current inspected Mode or Variable ID as the map key.",
  };
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
