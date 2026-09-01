import {
  executableJsonSchema,
  StyleReferenceFieldSchema,
} from "@opendesign/design-contracts";

const STYLE_ACTIONS = [
  "create-from-node",
  "update-from-node",
  "update-metadata",
  "move",
  "delete",
  "set-reference",
] as const;

const ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
} as const;

const LABEL_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "\\S",
} as const;

const NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 512,
  pattern: "\\S",
} as const;

const DESCRIPTION_SCHEMA = {
  type: "string",
  maxLength: 2_000,
} as const;

const STYLE_FIELD_SCHEMA = StyleReferenceFieldSchema;

const COMMON_PROPERTIES = {
  label: LABEL_SCHEMA,
  pageId: ID_SCHEMA,
} as const;

function compactBranchProperty(
  name: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "field") return { type: "string" };
  if (Array.isArray(schema.enum)) return { enum: schema.enum };
  if (Array.isArray(schema.anyOf)) return { anyOf: schema.anyOf };
  return { type: schema.type };
}

function actionBranch<
  const TAction extends (typeof STYLE_ACTIONS)[number],
  const TProperties extends Record<string, unknown>,
>(
  action: TAction,
  properties: TProperties,
  required: readonly (keyof TProperties & string)[],
  options?: { minProperties?: number },
) {
  return {
    type: "object" as const,
    properties: {
      action: { const: action },
      ...COMMON_PROPERTIES,
      ...Object.fromEntries(
        Object.entries(properties).map(([name, schema]) => [
          name,
          compactBranchProperty(name, schema as Record<string, unknown>),
        ]),
      ),
    },
    required: ["action", "label", "pageId", ...required],
    ...(options?.minProperties === undefined
      ? {}
      : { minProperties: options.minProperties }),
    additionalProperties: false,
  };
}

const STYLE_ACTION_BRANCHES = [
  actionBranch(
    "create-from-node",
    {
      nodeId: ID_SCHEMA,
      field: STYLE_FIELD_SCHEMA,
      styleId: ID_SCHEMA,
      key: ID_SCHEMA,
      name: NAME_SCHEMA,
      description: DESCRIPTION_SCHEMA,
    },
    ["nodeId", "field", "styleId", "key", "name"],
  ),
  actionBranch(
    "update-from-node",
    {
      nodeId: ID_SCHEMA,
      field: STYLE_FIELD_SCHEMA,
      styleId: ID_SCHEMA,
    },
    ["nodeId", "field", "styleId"],
  ),
  actionBranch(
    "update-metadata",
    {
      styleId: ID_SCHEMA,
      name: NAME_SCHEMA,
      description: DESCRIPTION_SCHEMA,
      hiddenFromPublishing: { type: "boolean" },
    },
    ["styleId"],
    { minProperties: 5 },
  ),
  actionBranch(
    "move",
    {
      styleId: ID_SCHEMA,
      index: { type: "integer", minimum: 0, maximum: 9_999 },
    },
    ["styleId", "index"],
  ),
  actionBranch("delete", { styleId: ID_SCHEMA }, ["styleId"]),
  actionBranch(
    "set-reference",
    {
      nodeId: ID_SCHEMA,
      field: STYLE_FIELD_SCHEMA,
      styleId: { anyOf: [ID_SCHEMA, { type: "null" }] },
    },
    ["nodeId", "field", "styleId"],
  ),
] as const;

export const DESIGN_STYLE_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Manage Figma-compatible local Paint, Text, Effect, and Grid styles through the trusted Style Service. Each action has one closed field shape. Create or update payloads from a current inspected node property so the host owns exact schema conversion. Use only stable Style, Page, and node IDs returned by inspection. Applying, detaching, deleting, metadata changes, and ordering are previewed and committed as one undoable revision. Detach and delete preserve the currently resolved appearance.",
  properties: {
    action: { enum: STYLE_ACTIONS },
    label: LABEL_SCHEMA,
    pageId: ID_SCHEMA,
    nodeId: ID_SCHEMA,
    field: STYLE_FIELD_SCHEMA,
    styleId: { anyOf: [ID_SCHEMA, { type: "null" }] },
    key: ID_SCHEMA,
    name: NAME_SCHEMA,
    description: DESCRIPTION_SCHEMA,
    hiddenFromPublishing: { type: "boolean" },
    index: { type: "integer", minimum: 0, maximum: 9_999 },
  },
  required: ["action", "label", "pageId"],
  anyOf: STYLE_ACTION_BRANCHES,
  additionalProperties: false,
});
