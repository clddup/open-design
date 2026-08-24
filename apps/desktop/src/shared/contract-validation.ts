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

export function contractDiscriminatedSchemaIssues(
  schema: TSchema,
  input: unknown,
  discriminant: string,
  options: {
    code: string;
    subject: string;
    maximum?: number;
  },
): ValidationIssue[] {
  if (isRecord(input)) {
    const branch = discriminatedBranch(
      schema,
      discriminant,
      input[discriminant],
    );
    if (branch) return contractSchemaIssues(schema, input, options);
  }

  const issues = contractSchemaIssues(schema, input, options);
  const path = `/${escapePointer(discriminant)}`;
  const discriminantIssues = issues.filter(
    (issue) => issue.path === path || issue.path.startsWith(`${path}/`),
  );
  return discriminantIssues.length > 0 ? discriminantIssues : issues;
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

function discriminatedBranch(
  schema: TSchema,
  discriminant: string,
  value: unknown,
): TSchema | null {
  const branches = (schema as { anyOf?: unknown }).anyOf;
  if (!Array.isArray(branches)) return null;
  for (const branch of branches) {
    if (!isRecord(branch)) continue;
    const properties = branch.properties;
    if (!isRecord(properties)) continue;
    const property = properties[discriminant];
    if (!isRecord(property) || property.const !== value) continue;
    return branch as TSchema;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
