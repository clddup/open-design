import {
  TrustedToolFailureContract,
  type AgentToolFailureIssue,
} from "@opendesign/agent-contracts";
import {
  formatValidationFailure,
  type ValidationIssue,
} from "@/shared/contract-validation.js";

export function contractValidationError(
  subject: string,
  issues: readonly ValidationIssue[],
): Error {
  const projectedIssues = issues.slice(0, 128).map(projectIssue);
  const first = projectedIssues[0] ?? {
    code: "contract.invalid",
    path: "/",
    message: `${subject} is invalid`,
  };
  const failure = TrustedToolFailureContract.parse({
    code: "invalid_tool_input",
    message: formatValidationFailure(subject, issues),
    retryable: false,
    recoverable: true,
    details: {
      kind: "tool-validation",
      fingerprint:
        `contract:${subject}:${first.code ?? "invalid"}:${first.path}`.slice(
          0,
          256,
        ),
      issues: projectedIssues.length > 0 ? projectedIssues : [first],
      recovery: { action: "correct-and-retry", required: false },
    },
  });
  if (!failure.ok) {
    throw new TypeError("Host created an invalid contract failure");
  }
  return new Error(failure.value.message, { cause: failure.value });
}

function projectIssue(issue: ValidationIssue): AgentToolFailureIssue {
  return {
    code: issue.code,
    path: issue.path,
    message: issue.message,
    ...(issue.expected === undefined ? {} : { expected: issue.expected }),
    ...(issue.actual === undefined ? {} : { actual: issue.actual }),
    ...(issue.recovery ? { recovery: issue.recovery } : {}),
  };
}
