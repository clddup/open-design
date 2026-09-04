import type { AgentEvent } from "@opendesign/agent-contracts";

export function terminalAgentRunId(event: AgentEvent): string | undefined {
  return event.type === "run.completed" ? event.runId : undefined;
}
