import type { AgentRequestErrorCode } from "@/shared/agent-request-contract";

export class AgentRunAdmissionError extends Error {
  constructor(
    readonly code: Exclude<AgentRequestErrorCode, "request_rejected">,
    message: string,
  ) {
    super(message);
    this.name = "AgentRunAdmissionError";
  }
}
