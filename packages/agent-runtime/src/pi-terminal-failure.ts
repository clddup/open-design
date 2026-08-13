import type { AgentRunFailure } from "@opendesign/agent-contracts";
import type { TrustedToolFailure } from "./index.js";

export function terminalRunFailure(
  modelFailure: AgentRunFailure | undefined,
  toolFailure: TrustedToolFailure | undefined,
): AgentRunFailure | undefined {
  if (toolFailure !== undefined) {
    return {
      code: toolFailure.code,
      message: toolFailure.message,
      retryable: toolFailure.retryable,
    };
  }
  if (modelFailure === undefined || modelFailure.code === "cancelled") {
    return undefined;
  }
  return structuredClone(modelFailure);
}
