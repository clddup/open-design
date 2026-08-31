import type { DesignComponentToolInput } from "./design-component-tool-contract";
import {
  DESIGN_COMPONENT_AUTHORING_TOOL_INPUT_SCHEMA,
  DESIGN_COMPONENT_TOOL_INPUT_SCHEMA,
} from "./design-component-tool-schema";
import type { DesignStyleToolInput } from "./design-style-tool-contract";
import { DESIGN_STYLE_TOOL_INPUT_SCHEMA } from "./design-style-tool-schema";
import type { DesignVariableToolInput } from "./design-variable-tool-contract";
import { DESIGN_VARIABLE_TOOL_INPUT_SCHEMA } from "./design-variable-tool-schema";
import { refineDesignComponent } from "./design-component-tool";
import { refineDesignVariable } from "./design-variable-tool";
import { executableJsonSchema } from "@opendesign/design-contracts";
import {
  defineContract,
  selectDiscriminatedUnionSchema,
  type ValidationIssue,
} from "./contract-validation";

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

const DESIGN_SYSTEM_COMPONENT_AUTHORING_BRANCH = executableJsonSchema({
  type: "object",
  properties: {
    kind: { const: "component" },
    input: DESIGN_COMPONENT_AUTHORING_TOOL_INPUT_SCHEMA,
  },
  required: ["kind", "input"],
  additionalProperties: false,
});

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

/**
 * Provider projection for a new-design continuation. It is intentionally
 * derived from the authoritative component branch above; Variable, Style,
 * variant-management and instance-edit operations remain available in the
 * complete general surface without burdening the first design run.
 */
export const DESIGN_SYSTEM_NEW_DESIGN_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Create a justified reusable Component Main or a linked Component Instance for the current design. Use stable inspected IDs and keep one semantic component operation per call.",
  properties: {
    kind: { const: "component" },
    input: DESIGN_COMPONENT_AUTHORING_TOOL_INPUT_SCHEMA,
  },
  required: ["kind", "input"],
  anyOf: [DESIGN_SYSTEM_COMPONENT_AUTHORING_BRANCH],
  additionalProperties: false,
});

export const DesignSystemContract = defineContract<DesignSystemToolInput>({
  schema: DESIGN_SYSTEM_TOOL_INPUT_SCHEMA,
  code: "design_system.schema_invalid",
  subject: "Design system",
  maximum: 64,
  refine: refineDesignSystem,
  selectSchema: (input) =>
    selectDiscriminatedUnionSchema(
      DESIGN_SYSTEM_TOOL_INPUT_SCHEMA,
      input,
      "kind",
    ),
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
