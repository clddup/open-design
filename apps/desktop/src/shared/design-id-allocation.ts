export type AgentDesignIdAllocation = {
  version: 1;
  scope: "run";
  newNodeIdPrefix: string;
};

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
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    value.scope === "run" &&
    value.newNodeIdPrefix === agentDesignNodeIdPrefix(runId) &&
    Object.keys(value).length === 3
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
