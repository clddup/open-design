import type { DesignVariableToolInput } from "./design-variable-tool-contract";
import { DESIGN_VARIABLE_TOOL_INPUT_SCHEMA } from "./design-variable-tool-schema";
import { defineContract, type ValidationIssue } from "./contract-validation";

export type { DesignVariableToolInput } from "./design-variable-tool-contract";

export const DesignVariableContract = defineContract<DesignVariableToolInput>({
  schema: DESIGN_VARIABLE_TOOL_INPUT_SCHEMA,
  code: "design_variable.schema_invalid",
  subject: "Variable",
  maximum: 32,
  refine: refineDesignVariable,
});

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
