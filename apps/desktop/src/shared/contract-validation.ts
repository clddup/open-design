import type { AgentToolFailureIssue } from "@opendesign/agent-contracts";
import {
  schemaValidationIssues,
  type TSchema,
} from "@opendesign/design-contracts";

export type ValidationIssue = AgentToolFailureIssue & { code: string };
export type ValidationIssueValue = NonNullable<
  AgentToolFailureIssue["expected"]
>;

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export function contractSchemaIssues(
  schema: TSchema,
  input: unknown,
  options: {
    code: string;
    subject: string;
    maximum?: number;
  },
): ValidationIssue[] {
  const raw = schemaValidationIssues(schema, input);
  const hasSpecificPath = raw.some((issue) => issue.path.length > 0);
  const seenPaths = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const issue of raw) {
    const path = issue.path || "/";
    if (hasSpecificPath && path === "/") continue;
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);
    issues.push({
      code: options.code,
      path,
      message: issue.message,
      recovery: `Correct the reported ${options.subject} field and submit one revised call; do not repeat unchanged arguments.`,
    });
    if (issues.length >= (options.maximum ?? 64)) break;
  }
  return issues;
}

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
