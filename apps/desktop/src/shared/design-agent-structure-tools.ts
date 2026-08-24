import {
  DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
  DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
} from "./design-agent-structure-tool-schema";
import type {
  DesignHierarchyToolInput,
  DesignVectorToolInput,
} from "./design-agent-structure-tool-types";
import {
  contractDiscriminatedSchemaIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./contract-validation";

export {
  DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
  DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
} from "./design-agent-structure-tool-schema";
export type {
  DesignHierarchyToolInput,
  DesignVectorToolInput,
} from "./design-agent-structure-tool-types";

function parseDesignHierarchy(
  input: unknown,
): ValidationResult<DesignHierarchyToolInput> {
  const issues = contractDiscriminatedSchemaIssues(
    DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
    input,
    "action",
    {
      code: "design_hierarchy.schema_invalid",
      subject: "Hierarchy",
      maximum: 32,
    },
  );
  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        value: structuredClone(input) as DesignHierarchyToolInput,
      };
}

function designHierarchyIssues(input: unknown): ValidationIssue[] {
  const result = parseDesignHierarchy(input);
  return result.ok ? [] : result.issues;
}

export const DesignHierarchyContract = {
  schema: DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
  parse: parseDesignHierarchy,
  issues: designHierarchyIssues,
} as const;

function parseDesignVector(
  input: unknown,
): ValidationResult<DesignVectorToolInput> {
  const structureIssues = contractDiscriminatedSchemaIssues(
    DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
    input,
    "action",
    {
      code: "design_vector.schema_invalid",
      subject: "Vector",
      maximum: 32,
    },
  );
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }

  const value = input as DesignVectorToolInput;
  const domainIssues = refineDesignVector(value);
  return domainIssues.length > 0
    ? { ok: false, issues: domainIssues }
    : { ok: true, value: structuredClone(value) };
}

function designVectorIssues(input: unknown): ValidationIssue[] {
  const result = parseDesignVector(input);
  return result.ok ? [] : result.issues;
}

export const DesignVectorContract = {
  schema: DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
  parse: parseDesignVector,
  issues: designVectorIssues,
} as const;

function refineDesignVector(input: DesignVectorToolInput): ValidationIssue[] {
  if (input.action !== "transform-layers-vertices") return [];
  const issues: ValidationIssue[] = [];
  const seenNodeIds = new Set<string>();
  let vertexCount = 0;
  input.targets.forEach((target, index) => {
    if (seenNodeIds.has(target.nodeId)) {
      issues.push({
        code: "design_vector.target_node_duplicated",
        path: `/targets/${index}/nodeId`,
        message: "Each Vector layer may appear in targets only once",
        actual: target.nodeId,
        recovery:
          "Merge vertex IDs for the same inspected layer into one target entry.",
      });
    }
    seenNodeIds.add(target.nodeId);
    vertexCount += target.vertexIds.length;
  });
  if (vertexCount > 16_384) {
    issues.push({
      code: "design_vector.vertex_budget_exceeded",
      path: "/targets",
      message: "Cross-layer Vector transforms accept at most 16384 vertices",
      expected: { maximum: 16_384 },
      actual: vertexCount,
      recovery:
        "Split the transform into smaller explicit layer sets without duplicating a layer target.",
    });
  }
  return issues;
}
