import type { AgentRunFailure } from "@opendesign/agent-contracts";
import type { TrustedToolFailure } from "./index.js";

export function terminalRunFailure(
  modelFailure: AgentRunFailure | undefined,
  toolFailure: TrustedToolFailure | undefined,
): AgentRunFailure | undefined {
  // User cancellation is the authoritative Run terminal. A tool that was
  // aborted as part of the same Stop request must not turn cancellation into
  // an error or make Main schedule a recovery continuation.
  if (modelFailure?.code === "cancelled") return undefined;
  if (toolFailure !== undefined) {
    return {
      code: toolFailure.code,
      message: toolFailure.message,
      retryable: toolFailure.retryable,
    };
  }
  if (modelFailure === undefined) {
    return undefined;
  }
  return structuredClone(modelFailure);
}
