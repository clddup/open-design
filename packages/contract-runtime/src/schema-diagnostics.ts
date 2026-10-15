import type { TSchema } from "@sinclair/typebox";
import { ValueErrorType } from "@sinclair/typebox/errors";
import type { ValidationIssueScalar, ValidationIssueValue } from "./index.js";

type SchemaError = {
  type: ValueErrorType;
  schema: TSchema;
  value: unknown;
};

const DIAGNOSTIC_KEYS = [
  "type",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
] as const;

export function schemaErrorDiagnostics(error: SchemaError): {
  expected?: ValidationIssueValue;
  actual: ValidationIssueValue;
  recovery?: string;
} {
  if (
    error.type === ValueErrorType.ObjectAdditionalProperties ||
    error.type === ValueErrorType.IntersectUnevaluatedProperties
  ) {
    return {
      expected: "absent",
      actual: summarizeValue(error.value),
      recovery:
        "Remove the reported field and submit one revised call; do not repeat unchanged arguments.",
    };
  }
  const expected = schemaExpectation(error.schema);
  return {
    ...(expected === undefined ? {} : { expected }),
    actual: summarizeValue(error.value),
  };
}

function schemaExpectation(schema: TSchema): ValidationIssueValue | undefined {
  const declared: unknown = schema.const;
  if (isScalar(declared)) return boundedScalar(declared);
  const variants: unknown = schema.anyOf;
  const enumeration: unknown = schema.enum;
  const values = Array.isArray(enumeration)
    ? enumeration
    : Array.isArray(variants)
      ? variants.map((variant: unknown) =>
          typeof variant === "object" && variant !== null && "const" in variant
            ? variant.const
            : undefined,
        )
      : [];
  if (values.length > 0 && values.every(isScalar)) {
    return values.slice(0, 16).map(boundedScalar);
  }
  const constraints: Record<string, ValidationIssueScalar> = {};
  for (const key of DIAGNOSTIC_KEYS) {
    const value: unknown = schema[key];
    if (isScalar(value)) constraints[key] = boundedScalar(value);
  }
  return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function summarizeValue(value: unknown): ValidationIssueValue {
  if (isScalar(value)) return boundedScalar(value);
  if (Array.isArray(value)) return { type: "array", length: value.length };
  return { type: value === undefined ? "missing" : typeof value };
}

function isScalar(value: unknown): value is ValidationIssueScalar {
  return (
    value === null || ["string", "number", "boolean"].includes(typeof value)
  );
}

function boundedScalar(value: ValidationIssueScalar): ValidationIssueScalar {
  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  }
  return typeof value === "number" && !Number.isFinite(value)
    ? String(value)
    : value;
}
