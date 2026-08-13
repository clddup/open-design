import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export function checkSchema(schema: TSchema, value: unknown): boolean {
  try {
    return Value.Check(schema, value);
  } catch {
    return false;
  }
}
