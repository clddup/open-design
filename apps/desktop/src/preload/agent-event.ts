import {
  AgentEventContract,
  agentEventRequestId,
  agentEventRunId,
  formatRuntimeContractFailure,
  type AgentEvent,
} from "@opendesign/agent-contracts";

export function projectAgentEvent(event: unknown): AgentEvent {
  const result = AgentEventContract.parse(event);
  if (result.ok) return result.value;

  const runId = agentEventRunId(event);
  const requestId = agentEventRequestId(event);
  return {
    type: "agent.error",
    code: "invalid_main_event",
    message: `Main returned an invalid Agent event: ${formatRuntimeContractFailure(
      "Agent event",
      result.issues,
    )}`,
    ...(runId ? { runId } : {}),
    ...(requestId ? { requestId } : {}),
  };
}
