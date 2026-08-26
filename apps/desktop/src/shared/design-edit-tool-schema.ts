import { executableJsonSchema } from "@opendesign/design-contracts";
import { INTERNAL_DESIGN_APPLY_TOOL_INPUT_SCHEMA } from "./design-apply-input";
import { DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA } from "./design-bootstrap-apply-schema";
import { DESIGN_ARRANGE_TOOL_INPUT_SCHEMA } from "./design-arrange-tool-schema";
import { DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA } from "./design-agent-structure-tool-schema";
import { DESIGN_APPLY_TOOL_INPUT_SCHEMA } from "./design-agent-operation-schemas";

const LABEL_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "\\S",
} as const;

function editBranch(kind: "node" | "hierarchy" | "arrange", input: unknown) {
  return {
    type: "object" as const,
    properties: {
      kind: { const: kind },
      input,
    },
    required: ["kind", "input"],
    additionalProperties: false,
  };
}

function editDesignSchema(
  nodeInput: unknown,
  options: { nodeOnly?: boolean } = {},
) {
  return executableJsonSchema({
    type: "object",
    description:
      "Apply one ordered, atomic design edit through a single Provider tool. A node edit contains the canonical OpenDesign node transaction shape; hierarchy and arrange edits reuse their authoritative typed contracts. Edits execute in array order against one projected document and commit as one revision and one undo step. Use at most one node edit and place all of its direct commands together.",
    properties: {
      label: LABEL_SCHEMA,
      edits: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: {
          anyOf: options.nodeOnly
            ? [editBranch("node", nodeInput)]
            : [
                editBranch("node", nodeInput),
                editBranch("hierarchy", DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA),
                editBranch("arrange", DESIGN_ARRANGE_TOOL_INPUT_SCHEMA),
              ],
        },
      },
    },
    required: ["label", "edits"],
    additionalProperties: false,
  });
}

export const DESIGN_BOOTSTRAP_EDIT_TOOL_INPUT_SCHEMA = editDesignSchema(
  DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA,
  { nodeOnly: true },
);

export const DESIGN_EDIT_TOOL_INPUT_SCHEMA = editDesignSchema(
  DESIGN_APPLY_TOOL_INPUT_SCHEMA,
);

export const INTERNAL_DESIGN_EDIT_TOOL_INPUT_SCHEMA = editDesignSchema(
  INTERNAL_DESIGN_APPLY_TOOL_INPUT_SCHEMA,
);
