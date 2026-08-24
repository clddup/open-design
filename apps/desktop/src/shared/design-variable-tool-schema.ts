import {
  executableJsonSchema,
  VariableBindingTargetSchema,
  VariableResolvedDataTypeSchema,
  VariableScopeSchema,
  VariableValueSchema,
} from "@opendesign/design-contracts";

const VARIABLE_ACTIONS = [
  "create-collection",
  "rename-collection",
  "delete-collection",
  "add-mode",
  "rename-mode",
  "remove-mode",
  "create-variable",
  "set-value",
  "update-variable",
  "delete-variable",
  "set-binding",
  "set-mode",
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

const COLLECTION_NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "\\S",
} as const;

const VARIABLE_NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 512,
  pattern: "\\S",
} as const;

const DESCRIPTION_SCHEMA = {
  type: "string",
  maxLength: 2_000,
} as const;

const VALUES_BY_MODE_SCHEMA = {
  type: "object",
  minProperties: 1,
  maxProperties: 128,
  propertyNames: ID_SCHEMA,
  additionalProperties: VariableValueSchema,
} as const;

const VALUES_BY_VARIABLE_ID_SCHEMA = {
  type: "object",
  maxProperties: 5_000,
  propertyNames: ID_SCHEMA,
  additionalProperties: VariableValueSchema,
} as const;

const SCOPES_SCHEMA = {
  type: "array",
  maxItems: 32,
  uniqueItems: true,
  items: VariableScopeSchema,
} as const;

const CODE_SYNTAX_SCHEMA = {
  type: "object",
  properties: {
    WEB: { type: "string", maxLength: 512 },
    ANDROID: { type: "string", maxLength: 512 },
    iOS: { type: "string", maxLength: 512 },
  },
  additionalProperties: false,
} as const;

const MODE_TARGET_SCHEMA = {
  type: "object",
  properties: {
    kind: { enum: ["page", "node"] },
    id: ID_SCHEMA,
  },
  required: ["kind", "id"],
  additionalProperties: false,
} as const;

const COMMON_PROPERTIES = {
  label: LABEL_SCHEMA,
  pageId: ID_SCHEMA,
} as const;

function compactBranchProperty(
  name: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "target") return schema;
  if (name === "value") {
    return {
      anyOf: [
        { type: "boolean" },
        { type: "string" },
        { type: "number" },
        { type: "object" },
      ],
    };
  }
  if (name === "resolvedType") return { type: "string" };
  if (Array.isArray(schema.enum)) return { enum: schema.enum };
  if (Array.isArray(schema.anyOf)) return { anyOf: schema.anyOf };
  if (schema.type === "array") {
    return { type: "array", items: { type: "string" } };
  }
  return { type: schema.type };
}

function actionBranch<
  const TAction extends (typeof VARIABLE_ACTIONS)[number],
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

const VARIABLE_ACTION_BRANCHES = [
  actionBranch(
    "create-collection",
    {
      collectionId: ID_SCHEMA,
      key: ID_SCHEMA,
      name: COLLECTION_NAME_SCHEMA,
      defaultModeId: ID_SCHEMA,
      defaultModeName: COLLECTION_NAME_SCHEMA,
    },
    ["collectionId", "key", "name", "defaultModeId", "defaultModeName"],
  ),
  actionBranch(
    "rename-collection",
    { collectionId: ID_SCHEMA, name: COLLECTION_NAME_SCHEMA },
    ["collectionId", "name"],
  ),
  actionBranch("delete-collection", { collectionId: ID_SCHEMA }, [
    "collectionId",
  ]),
  actionBranch(
    "add-mode",
    {
      collectionId: ID_SCHEMA,
      modeId: ID_SCHEMA,
      name: COLLECTION_NAME_SCHEMA,
      valuesByVariableId: VALUES_BY_VARIABLE_ID_SCHEMA,
    },
    ["collectionId", "modeId", "name", "valuesByVariableId"],
  ),
  actionBranch(
    "rename-mode",
    {
      collectionId: ID_SCHEMA,
      modeId: ID_SCHEMA,
      name: COLLECTION_NAME_SCHEMA,
    },
    ["collectionId", "modeId", "name"],
  ),
  actionBranch(
    "remove-mode",
    {
      collectionId: ID_SCHEMA,
      modeId: ID_SCHEMA,
      replacementModeId: ID_SCHEMA,
    },
    ["collectionId", "modeId", "replacementModeId"],
  ),
  actionBranch(
    "create-variable",
    {
      variableId: ID_SCHEMA,
      key: ID_SCHEMA,
      collectionId: ID_SCHEMA,
      name: VARIABLE_NAME_SCHEMA,
      resolvedType: VariableResolvedDataTypeSchema,
      valuesByMode: VALUES_BY_MODE_SCHEMA,
      scopes: SCOPES_SCHEMA,
    },
    [
      "variableId",
      "key",
      "collectionId",
      "name",
      "resolvedType",
      "valuesByMode",
      "scopes",
    ],
  ),
  actionBranch(
    "set-value",
    { variableId: ID_SCHEMA, modeId: ID_SCHEMA, value: VariableValueSchema },
    ["variableId", "modeId", "value"],
  ),
  actionBranch(
    "update-variable",
    {
      variableId: ID_SCHEMA,
      name: VARIABLE_NAME_SCHEMA,
      description: DESCRIPTION_SCHEMA,
      scopes: SCOPES_SCHEMA,
      hiddenFromPublishing: { type: "boolean" },
      codeSyntax: CODE_SYNTAX_SCHEMA,
    },
    ["variableId"],
    { minProperties: 5 },
  ),
  actionBranch("delete-variable", { variableId: ID_SCHEMA }, ["variableId"]),
  actionBranch(
    "set-binding",
    {
      target: VariableBindingTargetSchema,
      variableId: { anyOf: [ID_SCHEMA, { type: "null" }] },
    },
    ["target", "variableId"],
  ),
  actionBranch(
    "set-mode",
    {
      target: MODE_TARGET_SCHEMA,
      collectionId: ID_SCHEMA,
      modeId: { anyOf: [ID_SCHEMA, { type: "null" }] },
    },
    ["target", "collectionId", "modeId"],
  ),
] as const;

export const DESIGN_VARIABLE_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Manage Figma-compatible Variable Collections, modes, typed values, same-type aliases, picker scopes, code syntax, node and Paint bindings, and Page or node mode overrides through the trusted Variable Service. Each action has one closed field shape. Use only stable IDs and current definitions returned by inspection. Scopes rank picker suggestions but do not authorize or invalidate explicit bindings. FLOAT opacity values use 0..1 and COLOR uses RGB or RGBA 0..1 channels. Timing and Easing can be authored but cannot bind until Motion is available.",
  properties: {
    action: { enum: VARIABLE_ACTIONS },
    label: LABEL_SCHEMA,
    pageId: ID_SCHEMA,
    collectionId: ID_SCHEMA,
    key: ID_SCHEMA,
    name: VARIABLE_NAME_SCHEMA,
    defaultModeId: ID_SCHEMA,
    defaultModeName: COLLECTION_NAME_SCHEMA,
    modeId: { anyOf: [ID_SCHEMA, { type: "null" }] },
    replacementModeId: ID_SCHEMA,
    variableId: { anyOf: [ID_SCHEMA, { type: "null" }] },
    resolvedType: VariableResolvedDataTypeSchema,
    value: VariableValueSchema,
    valuesByMode: VALUES_BY_MODE_SCHEMA,
    valuesByVariableId: VALUES_BY_VARIABLE_ID_SCHEMA,
    scopes: SCOPES_SCHEMA,
    description: DESCRIPTION_SCHEMA,
    hiddenFromPublishing: { type: "boolean" },
    codeSyntax: CODE_SYNTAX_SCHEMA,
    target: { type: "object" },
  },
  required: ["action", "label", "pageId"],
  anyOf: VARIABLE_ACTION_BRANCHES,
  additionalProperties: false,
});
