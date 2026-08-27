import type { DesignComponentToolInput } from "./design-component-tool-contract";
import { DESIGN_COMPONENT_TOOL_INPUT_SCHEMA } from "./design-component-tool-schema";
import type { DesignStyleToolInput } from "./design-style-tool-contract";
import { DESIGN_STYLE_TOOL_INPUT_SCHEMA } from "./design-style-tool-schema";
import type { DesignVariableToolInput } from "./design-variable-tool-contract";
import { DESIGN_VARIABLE_TOOL_INPUT_SCHEMA } from "./design-variable-tool-schema";
import { refineDesignComponent } from "./design-component-tool";
import { refineDesignVariable } from "./design-variable-tool";
import { executableJsonSchema } from "@opendesign/design-contracts";
import { defineContract, type ValidationIssue } from "./contract-validation";

export type DesignSystemToolInput =
  | { kind: "component"; input: DesignComponentToolInput }
  | { kind: "variable"; input: DesignVariableToolInput }
  | { kind: "style"; input: DesignStyleToolInput };

const DESIGN_SYSTEM_INPUT_BRANCHES = [
  executableJsonSchema({
    type: "object" as const,
    properties: {
      kind: { const: "component" },
      input: DESIGN_COMPONENT_TOOL_INPUT_SCHEMA,
    },
    required: ["kind", "input"],
    additionalProperties: false,
  }),
  executableJsonSchema({
    type: "object" as const,
    properties: {
      kind: { const: "variable" },
      input: DESIGN_VARIABLE_TOOL_INPUT_SCHEMA,
    },
    required: ["kind", "input"],
    additionalProperties: false,
  }),
  executableJsonSchema({
    type: "object" as const,
    properties: {
      kind: { const: "style" },
      input: DESIGN_STYLE_TOOL_INPUT_SCHEMA,
    },
    required: ["kind", "input"],
    additionalProperties: false,
  }),
] as const;

export const DESIGN_SYSTEM_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Manage reusable Components, Variables, and Styles through one design-system boundary. Select exactly one kind and provide that kind's existing typed input. The host routes the operation to its dedicated service and preserves one revision and one undo step.",
  properties: {
    kind: { enum: ["component", "variable", "style"] },
    input: { type: "object" },
  },
  required: ["kind", "input"],
  anyOf: DESIGN_SYSTEM_INPUT_BRANCHES,
  additionalProperties: false,
});

export const DesignSystemContract = defineContract<DesignSystemToolInput>({
  schema: DESIGN_SYSTEM_TOOL_INPUT_SCHEMA,
  code: "design_system.schema_invalid",
  subject: "Design system",
  maximum: 64,
  refine: refineDesignSystem,
  selectSchema: selectDesignSystemSchema,
});

function refineDesignSystem(input: DesignSystemToolInput): ValidationIssue[] {
  const issues =
    input.kind === "component"
      ? refineDesignComponent(input.input)
      : input.kind === "variable"
        ? refineDesignVariable(input.input)
        : [];
  return issues.map((issue) => ({
    ...issue,
    path: issue.path === "/" ? "/input" : `/input${issue.path}`,
  }));
}

function selectDesignSystemSchema(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  const kind = (input as { kind?: unknown }).kind;
  if (kind === "component") return DESIGN_SYSTEM_INPUT_BRANCHES[0];
  if (kind === "variable") return DESIGN_SYSTEM_INPUT_BRANCHES[1];
  if (kind === "style") return DESIGN_SYSTEM_INPUT_BRANCHES[2];
  return undefined;
}
