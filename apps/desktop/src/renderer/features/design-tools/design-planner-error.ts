import type { TrustedToolFailure } from "@opendesign/agent-contracts";

export function designPlannerError(
  scope: string,
  plan: { code: string; message: string },
  path: string,
  action: string,
): Error {
  const code = `${scope}.${plan.code}`;
  const recovery =
    "Revise the indicated operation using the reported planner constraint. Inspect the current document if you need current node IDs, hierarchy, or geometry. No part of this transaction was committed.";
  const failure: TrustedToolFailure = {
    code,
    message: `${code}: ${plan.message}`,
    retryable: false,
    recoverable: true,
    details: {
      kind: "tool-validation",
      fingerprint: `planner:${scope}:${action}:${plan.code}`,
      issues: [{ code, path, message: plan.message, recovery }],
      recovery: { action: "correct-and-retry", required: false },
    },
  };
  return new Error(failure.message, { cause: failure });
}
