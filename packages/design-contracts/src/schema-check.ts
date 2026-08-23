import { Kind, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

type JsonSchema = Record<string, unknown>;

/**
 * Adds TypeBox's non-JSON runtime metadata to one authoritative JSON Schema.
 * JSON.stringify() remains byte-for-byte equivalent to the supplied schema, so
 * Provider disclosure and Runtime validation cannot drift into separate trees.
 */
export function executableJsonSchema<const T extends JsonSchema>(
  schema: T,
): T & TSchema {
  return decorateSchema(schema) as T & TSchema;
}

export function checkSchema(schema: TSchema, value: unknown): boolean {
  try {
    return Value.Check(schema, value);
  } catch {
    return false;
  }
}

function decorateSchema(schema: JsonSchema): TSchema {
  rejectUnsupportedKeywords(schema);
  const clone = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [
      key,
      cloneSchemaKeyword(key, value),
    ]),
  ) as JsonSchema & TSchema;
  const kind = schemaKind(schema);
  Object.defineProperty(clone, Kind, { value: kind, enumerable: false });
  if (kind === "Object" && !isRecord(schema.properties)) {
    Object.defineProperty(clone, "properties", {
      value: {},
      enumerable: false,
    });
  }
  if (Array.isArray(schema.enum)) {
    Object.defineProperty(clone, "anyOf", {
      value: schema.enum.map((value) => decorateSchema({ const: value })),
      enumerable: false,
    });
  }
  return clone;
}

function cloneSchemaKeyword(key: string, value: unknown): unknown {
  if (key === "properties" && isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, property]) => {
        if (!isRecord(property)) {
          throw new TypeError(`JSON Schema property ${name} is not a schema`);
        }
        return [name, decorateSchema(property)];
      }),
    );
  }
  if (key === "items" || key === "additionalProperties") {
    return isRecord(value) ? decorateSchema(value) : value;
  }
  if (key === "anyOf") {
    if (!Array.isArray(value) || !value.every(isRecord)) {
      throw new TypeError("JSON Schema anyOf must contain schemas");
    }
    return value.map(decorateSchema);
  }
  return cloneJsonValue(value);
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, cloneJsonValue(nested)]),
  );
}

function schemaKind(schema: JsonSchema): string {
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.enum)) return "Union";
  if (Object.hasOwn(schema, "const")) return "Literal";
  switch (schema.type) {
    case "object":
      return "Object";
    case "array":
      return "Array";
    case "string":
      return "String";
    case "number":
      return "Number";
    case "integer":
      return "Integer";
    case "boolean":
      return "Boolean";
    case "null":
      return "Null";
    default:
      throw new TypeError("JSON Schema node has no executable type");
  }
}

function rejectUnsupportedKeywords(schema: JsonSchema): void {
  const unsupported = ["$ref", "allOf", "oneOf", "not", "if", "then", "else"];
  const found = unsupported.find((key) => Object.hasOwn(schema, key));
  if (found) {
    throw new TypeError(`Unsupported executable JSON Schema keyword: ${found}`);
  }
}

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
