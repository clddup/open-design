import {
  executableJsonSchema,
  schemaValidationIssues,
} from "@opendesign/design-contracts";
import {
  DesignApplyContract,
  type DesignApplyToolInput,
} from "./design-apply-input";
import { DESIGN_APPLY_TOOL_INPUT_SCHEMA } from "./design-agent-operation-schemas";
import type { ValidationIssue, ValidationResult } from "./contract-validation";

export type DesignCheckpointToolInput =
  | {
      version: 1;
      action: "apply-and-capture";
      apply: DesignApplyToolInput;
    }
  | {
      version: 1;
      action: "refine-and-capture";
      refinement: DesignApplyToolInput;
    };

export const DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "A host-conditional design checkpoint. apply-and-capture commits one material transaction and captures only its successful revision; fast mode returns deterministic verification while thorough mode may return independent critic findings. refine-and-capture consumes those thorough-mode findings, commits one refinement, then captures only the successful refined revision.",
  properties: {
    version: { const: 1 },
    action: { enum: ["apply-and-capture", "refine-and-capture"] },
    apply: { type: "object" },
    refinement: { type: "object" },
  },
  required: ["version", "action"],
  additionalProperties: false,
  anyOf: [
    {
      type: "object",
      properties: {
        version: { const: 1 },
        action: { const: "apply-and-capture" },
        apply: DESIGN_APPLY_TOOL_INPUT_SCHEMA,
      },
      required: ["version", "action", "apply"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        version: { const: 1 },
        action: { const: "refine-and-capture" },
        refinement: DESIGN_APPLY_TOOL_INPUT_SCHEMA,
      },
      required: ["version", "action", "refinement"],
      additionalProperties: false,
    },
  ],
});

function parseDesignCheckpoint(
  input: unknown,
): ValidationResult<DesignCheckpointToolInput> {
  const structureIssues = checkpointSchemaIssues(input);
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }

  const value = input as DesignCheckpointToolInput;
  if (value.action === "apply-and-capture") {
    const parsed = DesignApplyContract.parse(value.apply, {
      modelSchemaValidated: true,
    });
    return parsed.ok
      ? {
          ok: true,
          value: {
            version: 1,
            action: "apply-and-capture",
            apply: parsed.value,
          },
        }
      : { ok: false, issues: prefixIssues(parsed.issues, "/apply") };
  }

  const parsed = DesignApplyContract.parse(value.refinement, {
    modelSchemaValidated: true,
  });
  return parsed.ok
    ? {
        ok: true,
        value: {
          version: 1,
          action: "refine-and-capture",
          refinement: parsed.value,
        },
      }
    : { ok: false, issues: prefixIssues(parsed.issues, "/refinement") };
}

export const DesignCheckpointContract = {
  schema: DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA,
  parse: parseDesignCheckpoint,
  issues: (input: unknown): ValidationIssue[] => {
    const result = parseDesignCheckpoint(input);
    return result.ok ? [] : result.issues;
  },
} as const;

function checkpointSchemaIssues(input: unknown): ValidationIssue[] {
  return schemaValidationIssues(DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA, input)
    .slice(0, 64)
    .map((issue) => ({
      code: "design_checkpoint.schema_invalid",
      path: issue.path || "/",
      message: issue.message,
      recovery:
        "Correct the reported Checkpoint field and submit one revised call; do not repeat unchanged arguments.",
    }));
}

function prefixIssues(
  issues: readonly ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path:
      issue.path === "/"
        ? prefix
        : `${prefix}${issue.path.startsWith("/") ? issue.path : `/${issue.path}`}`,
  }));
}
