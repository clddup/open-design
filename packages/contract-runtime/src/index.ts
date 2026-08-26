import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export type ValidationIssueScalar = string | number | boolean | null;
export type ValidationIssueValue =
  | ValidationIssueScalar
  | ValidationIssueScalar[]
  | Record<string, ValidationIssueScalar>;

export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
  expected?: ValidationIssueValue;
  actual?: ValidationIssueValue;
  recovery?: string;
};

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export type ContractSchemaPhase = {
  schema: TSchema;
  code: string;
  subject: string;
  maximum?: number;
  recovery?: string;
};

export type ContractDefinition<
  ModelValue,
  CanonicalValue = ModelValue,
  Context = undefined,
> = ContractSchemaPhase & {
  canonical?: ContractSchemaPhase;
  refineModel?: (
    value: ModelValue,
    context: Context,
  ) => readonly ValidationIssue[];
  bind?: (value: ModelValue, context: Context) => CanonicalValue;
  refine?: (
    value: CanonicalValue,
    context: Context,
  ) => readonly ValidationIssue[];
  clone?: boolean;
  selectSchema?: (input: unknown) => TSchema | undefined;
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

export type ContractValidationOptions = {
  /** Trusted composition only: an enclosing executable schema checked this exact value. */
  structureValidated?: boolean;
};

/**
 * Runs one executable structure contract, optional model refinement, trusted
 * host binding, optional canonical structure contract, and one domain
 * refinement in that order. Structure must not be reimplemented around this
 * entry point.
 */
export function validateContract<
  ModelValue,
  CanonicalValue = ModelValue,
  Context = undefined,
>(
  definition: ContractDefinition<ModelValue, CanonicalValue, Context>,
  input: unknown,
  context: Context,
  options: ContractValidationOptions = {},
): ValidationResult<CanonicalValue> {
  const selectedSchema = definition.selectSchema?.(input) ?? definition.schema;
  const structureIssues = options.structureValidated
    ? []
    : contractSchemaIssues(selectedSchema, input, definition);
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }

  const modelValue = input as ModelValue;
  const modelDomainIssues = definition.refineModel?.(modelValue, context) ?? [];
  if (modelDomainIssues.length > 0) {
    return { ok: false, issues: [...modelDomainIssues] };
  }
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
        value: definition.clone === false ? value : structuredClone(value),
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
    issues(input, context) {
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
    recovery?: string;
  },
): ValidationIssue[] {
  const raw = schemaValidationIssues(schema, input);
  const normalizedPaths = raw.map((issue) => issue.path || "/");
  const seenPaths = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const issue of raw) {
    const path = issue.path || "/";
    const descendantPrefix = path === "/" ? "/" : `${path}/`;
    if (
      normalizedPaths.some(
        (candidate) =>
          candidate !== path && candidate.startsWith(descendantPrefix),
      )
    ) {
      continue;
    }
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);
    issues.push({
      code: options.code,
      path,
      message: issue.message,
      recovery:
        options.recovery ??
        `Correct the reported ${options.subject} field and submit one revised call; do not repeat unchanged arguments.`,
    });
    if (issues.length >= (options.maximum ?? 64)) break;
  }
  return issues;
}

export function formatValidationFailure(
  subject: string,
  issues: readonly ValidationIssue[],
): string {
  return formatFailure(`Invalid ${subject} input.`, issues);
}

export function formatContractFailure(
  subject: string,
  issues: readonly ValidationIssue[],
): string {
  return formatFailure(`Invalid ${subject}.`, issues);
}

function formatFailure(
  prefix: string,
  issues: readonly ValidationIssue[],
): string {
  const details = issues
    .slice(0, 8)
    .map((issue) => {
      const expected =
        issue.expected === undefined
          ? ""
          : ` Expected ${boundedJson(issue.expected)}.`;
      const actual =
        issue.actual === undefined
          ? ""
          : ` Actual ${boundedJson(issue.actual)}.`;
      const recovery = issue.recovery ? ` ${issue.recovery}` : "";
      return `${issue.code} at ${issue.path || "/"}: ${issue.message}.${expected}${actual}${recovery}`;
    })
    .join(" ");
  return `${prefix} ${details}`.slice(0, 20_000);
}

export type SchemaValidationIssue = { path: string; message: string };

export function schemaValidationIssues(
  schema: TSchema,
  value: unknown,
): SchemaValidationIssue[] {
  try {
    return [...Value.Errors(schema, value)].flatMap((error) =>
      actionableSchemaErrors(error).map((actionable) => ({
        path: actionable.path,
        message: actionable.message,
      })),
    );
  } catch (error) {
    return [
      {
        path: "",
        message:
          error instanceof RangeError
            ? "Value contains an unsupported cyclic structure"
            : error instanceof Error
              ? `Schema validation failed: ${error.message}`
              : "Schema validation failed",
      },
    ];
  }
}

type NestedSchemaError = {
  path: string;
  message: string;
  schema: TSchema;
  value: unknown;
  errors: Iterable<Iterable<NestedSchemaError>>;
};

function actionableSchemaErrors(error: NestedSchemaError): NestedSchemaError[] {
  const branches = [...error.errors].map((branch) =>
    [...branch].flatMap(actionableSchemaErrors),
  );
  if (branches.length === 0) return [error];

  const variants = Array.isArray((error.schema as { anyOf?: unknown }).anyOf)
    ? ((error.schema as unknown as { anyOf: TSchema[] }).anyOf ?? [])
    : [];
  const discriminatedBranch = variants.findIndex((variant) =>
    schemaDiscriminatorMatches(variant, error),
  );
  if (discriminatedBranch >= 0) {
    return branches[discriminatedBranch] ?? [error];
  }

  if (
    typeof error.value === "object" &&
    error.value !== null &&
    !Array.isArray(error.value)
  ) {
    const unknownDiscriminant = unknownSchemaDiscriminant(
      variants,
      error.value as Record<string, unknown>,
    );
    if (unknownDiscriminant) {
      const path = `${error.path}/${escapeSchemaPointer(unknownDiscriminant)}`;
      const discriminatorIssues = branches
        .flat()
        .filter((issue) => issue.path === path);
      if (discriminatorIssues.length > 0)
        return discriminatorIssues.slice(0, 1);
    }
    return (
      branches
        .filter((branch) => branch.length > 0)
        .sort(compareSchemaErrorBranches)[0] ?? [error]
    );
  }
  return [error];
}

function unknownSchemaDiscriminant(
  variants: readonly TSchema[],
  value: Record<string, unknown>,
): string | null {
  if (variants.length < 2) return null;
  const firstProperties = (
    variants[0] as { properties?: Record<string, unknown> } | undefined
  )?.properties;
  if (!firstProperties) return null;
  for (const key of Object.keys(firstProperties)) {
    if (!Object.hasOwn(value, key)) continue;
    const expected = variants.map((variant) => {
      const properties = (variant as { properties?: Record<string, unknown> })
        .properties;
      return (properties?.[key] as { const?: unknown } | undefined)?.const;
    });
    if (expected.some((candidate) => candidate === undefined)) continue;
    if (!expected.includes(value[key])) return key;
  }
  return null;
}

function schemaDiscriminatorMatches(
  schema: TSchema,
  error: NestedSchemaError,
): boolean {
  const value = error.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const variants = (schema as { anyOf?: unknown }).anyOf;
  if (Array.isArray(variants)) {
    return variants.some(
      (variant) =>
        typeof variant === "object" &&
        variant !== null &&
        schemaDiscriminatorMatches(variant as TSchema, error),
    );
  }
  const properties = (schema as { properties?: Record<string, unknown> })
    .properties;
  if (!properties) return false;
  return Object.entries(properties).some(([key, property]) => {
    const expected = (property as { const?: unknown } | undefined)?.const;
    return (
      expected !== undefined &&
      Object.hasOwn(value, key) &&
      (value as Record<string, unknown>)[key] === expected
    );
  });
}

function compareSchemaErrorBranches(
  left: readonly NestedSchemaError[],
  right: readonly NestedSchemaError[],
): number {
  if (left.length !== right.length) return left.length - right.length;
  const leftDepth = left.reduce((sum, issue) => sum + issue.path.length, 0);
  const rightDepth = right.reduce((sum, issue) => sum + issue.path.length, 0);
  return rightDepth - leftDepth;
}

function escapeSchemaPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function boundedJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return (encoded ?? String(value)).slice(0, 1_000);
  } catch {
    return "[unserializable]";
  }
}
