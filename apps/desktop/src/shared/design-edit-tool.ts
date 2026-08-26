import type { AgentToolFailureIssue } from "@opendesign/agent-contracts";
import {
  DesignApplyContract,
  type DesignApplyToolInput,
  type InternalDesignApplyToolInput,
} from "./design-apply-input";
import {
  DesignArrangeContract,
  type DesignArrangeToolInput,
} from "./design-arrange-tool";
import {
  DesignHierarchyContract,
  type DesignHierarchyToolInput,
} from "./design-agent-structure-tools";
import {
  contractSchemaIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./contract-validation";
import {
  DESIGN_EDIT_TOOL_INPUT_SCHEMA,
  INTERNAL_DESIGN_EDIT_TOOL_INPUT_SCHEMA,
} from "./design-edit-tool-schema";

export type DesignEditToolEdit =
  | { kind: "node"; input: DesignApplyToolInput }
  | { kind: "hierarchy"; input: DesignHierarchyToolInput }
  | { kind: "arrange"; input: DesignArrangeToolInput };

export type InternalDesignEditToolEdit =
  | { kind: "node"; input: InternalDesignApplyToolInput }
  | { kind: "hierarchy"; input: DesignHierarchyToolInput }
  | { kind: "arrange"; input: DesignArrangeToolInput };

export type DesignEditToolInput = {
  label: string;
  edits: DesignEditToolEdit[];
};

export type InternalDesignEditToolInput = {
  label: string;
  edits: InternalDesignEditToolEdit[];
};

export type DesignEditContractContext = {
  canonical?: boolean;
  internal?: boolean;
};

function parseDesignEdit(
  input: unknown,
  context: DesignEditContractContext = {},
): ValidationResult<InternalDesignEditToolInput> {
  const canonical = context.canonical === true || context.internal === true;
  const schema = canonical
    ? INTERNAL_DESIGN_EDIT_TOOL_INPUT_SCHEMA
    : DESIGN_EDIT_TOOL_INPUT_SCHEMA;
  const structureIssues = contractSchemaIssues(schema, input, {
    code: "design_edit.schema_invalid",
    subject: "Edit Design",
    maximum: 64,
  });
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }

  const value = input as DesignEditToolInput | InternalDesignEditToolInput;
  const issues: ValidationIssue[] = [];
  const edits: InternalDesignEditToolEdit[] = [];
  let nodeEditCount = 0;
  value.edits.forEach((edit, index) => {
    const path = `/edits/${index}/input`;
    if (edit.kind === "node") {
      nodeEditCount += 1;
      const parsed = DesignApplyContract.parse(edit.input, {
        ...(canonical
          ? { canonical: true, internal: context.internal === true }
          : { modelSchemaValidated: true }),
      });
      if (!parsed.ok) {
        issues.push(...prefixIssues(parsed.issues, path));
        return;
      }
      edits.push({ kind: edit.kind, input: parsed.value });
      return;
    }
    if (edit.kind === "hierarchy") {
      const parsed = DesignHierarchyContract.parse(edit.input);
      if (!parsed.ok) {
        issues.push(...prefixIssues(parsed.issues, path));
        return;
      }
      edits.push({ kind: edit.kind, input: parsed.value });
      return;
    }
    const parsed = DesignArrangeContract.parse(edit.input);
    if (!parsed.ok) {
      issues.push(...prefixIssues(parsed.issues, path));
      return;
    }
    edits.push({ kind: edit.kind, input: parsed.value });
  });

  if (nodeEditCount > 1) {
    issues.push({
      code: "design_edit.node_edit_duplicated",
      path: "/edits",
      message: "One atomic edit accepts at most one node transaction",
      expected: { maximum: 1 },
      actual: nodeEditCount,
      recovery:
        "Merge direct node commands into one node edit; keep hierarchy and arrange edits as separate ordered entries.",
    });
  }
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: structuredClone({ label: value.label, edits }) };
}

function prefixIssues(
  issues: readonly (ValidationIssue | AgentToolFailureIssue)[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    code: issue.code ?? "design_edit.input_invalid",
    path: `${prefix}${issue.path && issue.path !== "/" ? issue.path : ""}`,
  }));
}

export const EditDesignContract = {
  schema: DESIGN_EDIT_TOOL_INPUT_SCHEMA,
  internalSchema: INTERNAL_DESIGN_EDIT_TOOL_INPUT_SCHEMA,
  parse: parseDesignEdit,
  issues: (
    input: unknown,
    context: DesignEditContractContext = {},
  ): ValidationIssue[] => {
    const result = parseDesignEdit(input, context);
    return result.ok ? [] : result.issues;
  },
} as const;

export {
  DESIGN_BOOTSTRAP_EDIT_TOOL_INPUT_SCHEMA,
  DESIGN_EDIT_TOOL_INPUT_SCHEMA,
  INTERNAL_DESIGN_EDIT_TOOL_INPUT_SCHEMA,
} from "./design-edit-tool-schema";
