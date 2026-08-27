import { Type } from "@sinclair/typebox";
import { defineContract, type ValidationIssue } from "./contract-validation";

export type AgentDesignIdAllocation = {
  version: 1;
  scope: "run";
  newNodeIdPrefix: string;
};

export const AgentDesignIdAllocationSchema = Type.Object(
  {
    version: Type.Literal(1),
    scope: Type.Literal("run"),
    newNodeIdPrefix: Type.String({
      minLength: 6,
      maxLength: 54,
      pattern: "^odr_[A-Za-z0-9_-]+_$",
    }),
  },
  { additionalProperties: false },
);

export const AgentDesignIdAllocationContract = defineContract<
  AgentDesignIdAllocation,
  AgentDesignIdAllocation,
  { runId: string }
>({
  schema: AgentDesignIdAllocationSchema,
  code: "agent_design_id_allocation.schema_invalid",
  subject: "Agent design ID allocation",
  clone: false,
  refine: (value, context) => allocationIdentityIssues(value, context.runId),
});

export function createAgentDesignIdAllocation(
  runId: string,
): AgentDesignIdAllocation {
  return {
    version: 1,
    scope: "run",
    newNodeIdPrefix: agentDesignNodeIdPrefix(runId),
  };
}

export function agentDesignNodeIdPrefix(runId: string): string {
  const stableRunId = runId.replaceAll(/[^A-Za-z0-9_-]/g, "_").slice(-48);
  if (stableRunId.length === 0) {
    throw new TypeError("Agent Run ID cannot produce a design ID namespace");
  }
  return `odr_${stableRunId}_`;
}

export function isAgentDesignIdAllocation(
  value: unknown,
  runId: string,
): value is AgentDesignIdAllocation {
  return AgentDesignIdAllocationContract.parse(value, { runId }).ok;
}

function allocationIdentityIssues(
  value: AgentDesignIdAllocation,
  runId: string,
): ValidationIssue[] {
  const expected = agentDesignNodeIdPrefix(runId);
  return value.newNodeIdPrefix === expected
    ? []
    : [
        {
          code: "agent_design_id_allocation.run_mismatch",
          path: "/newNodeIdPrefix",
          message: "newNodeIdPrefix must be derived from the current Run ID",
          expected,
          actual: value.newNodeIdPrefix,
          recovery:
            "Use the host-provided ID allocation for this Run; do not reuse a namespace from another Run.",
        },
      ];
}
