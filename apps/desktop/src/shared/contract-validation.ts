import type { AgentToolFailureIssue } from "@opendesign/agent-contracts";

export type ValidationIssue = AgentToolFailureIssue & { code: string };
export type ValidationIssueValue = NonNullable<
  AgentToolFailureIssue["expected"]
>;

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export function formatValidationFailure(
  subject: string,
  issues: readonly ValidationIssue[],
): string {
  const details = issues
    .slice(0, 8)
    .map((issue) => {
      const path = issue.path || "/";
      const expected =
        issue.expected === undefined
          ? ""
          : ` Expected ${boundedJson(issue.expected)}.`;
      const actual =
        issue.actual === undefined
          ? ""
          : ` Actual ${boundedJson(issue.actual)}.`;
      const recovery = issue.recovery ? ` ${issue.recovery}` : "";
      return `${issue.code} at ${path}: ${issue.message}.${expected}${actual}${recovery}`;
    })
    .join(" ");
  return `Invalid ${subject} input. ${details}`.slice(0, 20_000);
}

function boundedJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return (encoded ?? String(value)).slice(0, 1_000);
  } catch {
    return "[unserializable]";
  }
}
