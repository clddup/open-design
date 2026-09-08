import { Type } from "@opendesign/design-contracts";

export const CLOSED = { additionalProperties: false } as const;
const ID_PATTERN = "^[^\\u0000-\\u001F\\u007F]+$";
export const LOCAL_ID_PATTERN = "^(?!odr_)[A-Za-z][A-Za-z0-9_-]{0,63}$";
const NON_WHITESPACE_PATTERN = "\\S";

export function idSchema(maxLength = 256) {
  return Type.String({
    minLength: 1,
    maxLength,
    pattern: ID_PATTERN,
  });
}

export function localIdSchema() {
  return Type.String({
    minLength: 1,
    maxLength: 64,
    pattern: LOCAL_ID_PATTERN,
    description:
      "Short call-local identity. Main binds it to a globally stable document ID; never include the Run prefix.",
  });
}

export function textSchema(maxLength: number) {
  return Type.String({
    minLength: 1,
    maxLength,
    pattern: NON_WHITESPACE_PATTERN,
  });
}

export const COORDINATE_SCHEMA = Type.Number({
  minimum: -1_000_000,
  maximum: 1_000_000,
});
export const DIMENSION_SCHEMA = Type.Number({
  exclusiveMinimum: 0,
  maximum: 100_000,
});
export const UNIT_SCHEMA = Type.Number({ minimum: 0, maximum: 1 });
