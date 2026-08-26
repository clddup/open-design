import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export type RuntimeContractIssue = {
  code: string;
  path: string;
  message: string;
  recovery?: string;
};

export type RuntimeContractResult<T> =
  { ok: true; value: T } | { ok: false; issues: RuntimeContractIssue[] };

export type RuntimeContract<T> = {
  schema: TSchema;
  parse(input: unknown): RuntimeContractResult<T>;
  issues(input: unknown): RuntimeContractIssue[];
};

export function defineRuntimeContract<T>(definition: {
  schema: TSchema;
  code: string;
  subject: string;
  selectSchema?: (input: unknown) => TSchema | undefined;
  refine?: (value: T) => readonly RuntimeContractIssue[];
}): RuntimeContract<T> {
  const parse = (input: unknown): RuntimeContractResult<T> => {
    const schema = definition.selectSchema?.(input) ?? definition.schema;
    const issues = schemaIssues(schema, input, definition);
    if (issues.length > 0) return { ok: false, issues };
    const value = input as T;
    const domainIssues = definition.refine?.(value) ?? [];
    return domainIssues.length > 0
      ? { ok: false, issues: [...domainIssues] }
      : { ok: true, value };
  };
  return {
    schema: definition.schema,
    parse,
    issues(input) {
      const result = parse(input);
      return result.ok ? [] : result.issues;
    },
  };
}

export function formatRuntimeContractFailure(
  subject: string,
  issues: readonly RuntimeContractIssue[],
): string {
  const details = issues
    .slice(0, 8)
    .map((issue) => {
      const recovery = issue.recovery ? ` ${issue.recovery}` : "";
      return `${issue.code} at ${issue.path || "/"}: ${issue.message}.${recovery}`;
    })
    .join(" ");
  return `Invalid ${subject}. ${details}`.slice(0, 20_000);
}

function schemaIssues(
  schema: TSchema,
  input: unknown,
  definition: { code: string; subject: string },
): RuntimeContractIssue[] {
  const raw = [...Value.Errors(schema, input)];
  const paths = raw.map((error) => error.path || "/");
  const seen = new Set<string>();
  const issues: RuntimeContractIssue[] = [];
  for (const error of raw) {
    const path = error.path || "/";
    const descendant = path === "/" ? "/" : `${path}/`;
    if (
      paths.some(
        (candidate) => candidate !== path && candidate.startsWith(descendant),
      )
    ) {
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    issues.push({
      code: definition.code,
      path,
      message: error.message,
      recovery: `Correct the reported ${definition.subject} field before retrying.`,
    });
    if (issues.length >= 64) break;
  }
  return issues;
}
