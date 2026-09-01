import {
  DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
  DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
} from "./design-agent-structure-tool-schema";
import type {
  DesignHierarchyToolInput,
  DesignVectorToolInput,
} from "./design-agent-structure-tool-types";
import { defineContract, type ValidationIssue } from "./contract-validation";

export {
  DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
  DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
} from "./design-agent-structure-tool-schema";
export type {
  DesignHierarchyToolInput,
  DesignVectorToolInput,
} from "./design-agent-structure-tool-types";

export const DesignHierarchyContract = defineContract<DesignHierarchyToolInput>(
  {
    schema: DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
    code: "design_hierarchy.schema_invalid",
    subject: "Hierarchy",
    maximum: 32,
  },
);

export const DesignVectorContract = defineContract<DesignVectorToolInput>({
  schema: DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
  code: "design_vector.schema_invalid",
  subject: "Vector",
  maximum: 32,
  refine: refineDesignVector,
});

function refineDesignVector(input: DesignVectorToolInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (input.action === "set-vertex-stroke-appearance") {
    if (input.strokeCap === undefined && input.strokeJoin === undefined) {
      issues.push({
        code: "design_vector.vertex_stroke_patch_empty",
        path: "",
        message: "Vertex stroke appearance requires strokeCap or strokeJoin",
        recovery:
          "Set at least one override, or use null to clear an inspected vertex override.",
      });
    }
    return issues;
  }
  if (input.action !== "transform-layers-vertices") return issues;
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
