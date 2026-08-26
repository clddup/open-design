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

export type ContractSchemaPhase = {
  schema: TSchema;
  code: string;
  subject: string;
  maximum?: number;
};

export type ContractDefinition<
  ModelValue,
  CanonicalValue = ModelValue,
  Context = undefined,
> = ContractSchemaPhase & {
  canonical?: ContractSchemaPhase;
  bind?: (value: ModelValue, context: Context) => CanonicalValue;
  refine?: (
    value: CanonicalValue,
    context: Context,
  ) => readonly ValidationIssue[];
  clone?: boolean;
};

export type Contract<CanonicalValue, Context = undefined> = {
  schema: TSchema;
  canonicalSchema?: TSchema;
  parse: (
    input: unknown,
    context?: Context,
  ) => ValidationResult<CanonicalValue>;
  issues: (input: unknown, context?: Context) => ValidationIssue[];
};

/**
 * Runs one model-facing structure contract, optional trusted host binding, one
 * canonical structure contract, and one domain refinement in that order.
 * Provider disclosure must use `definition.schema`; no parallel shape guard is
 * permitted around this entry point.
 */
export function validateContract<
  ModelValue,
  CanonicalValue = ModelValue,
  Context = undefined,
>(
  definition: ContractDefinition<ModelValue, CanonicalValue, Context>,
  input: unknown,
  context: Context,
): ValidationResult<CanonicalValue> {
  const structureIssues = contractSchemaIssues(
    definition.schema,
    input,
    definition,
  );
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }

  const clone = definition.clone !== false;
  const modelValue = input as ModelValue;
  const value = definition.bind
    ? definition.bind(modelValue, context)
    : (modelValue as unknown as CanonicalValue);

  if (definition.canonical) {
    const canonicalIssues = contractSchemaIssues(
      definition.canonical.schema,
      value,
      definition.canonical,
    );
    if (canonicalIssues.length > 0) {
      return { ok: false, issues: canonicalIssues };
    }
  }

  const domainIssues = definition.refine?.(value, context) ?? [];
  return domainIssues.length > 0
    ? { ok: false, issues: [...domainIssues] }
    : {
        ok: true,
        value: clone ? structuredClone(value) : value,
      };
}

export function defineContract<
  ModelValue,
  CanonicalValue = ModelValue,
  Context = undefined,
>(
  definition: ContractDefinition<ModelValue, CanonicalValue, Context>,
  defaultContext?: () => Context,
): Contract<CanonicalValue, Context> {
  const contextFor = (context: Context | undefined): Context => {
    if (context !== undefined) return context;
    return defaultContext ? defaultContext() : (undefined as Context);
  };
  const parse = (
    input: unknown,
    context?: Context,
  ): ValidationResult<CanonicalValue> =>
    validateContract(definition, input, contextFor(context));
  return {
    schema: definition.schema,
    ...(definition.canonical === undefined
      ? {}
      : { canonicalSchema: definition.canonical.schema }),
    parse,
    issues: (input: unknown, context?: Context): ValidationIssue[] => {
      const result = parse(input, context);
      return result.ok ? [] : result.issues;
    },
  };
}

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
