import { executableJsonSchema } from "@opendesign/design-contracts";
import {
  DESIGN_MODEL_BLEND_MODES,
  DESIGN_MODEL_EFFECT_SCHEMA,
  DESIGN_MODEL_NODE_PROPERTY_PATCH_SCHEMA,
} from "./design-agent-operation-schemas";

const COMPONENT_ACTIONS = [
  "create-component",
  "create-instance",
  "remove-component",
  "combine-as-variants",
  "add-component-to-variant-set",
  "duplicate-variant",
  "remove-variant",
  "dissolve-variant-set",
  "add-variant-property",
  "rename-variant-property",
  "reorder-variant-properties",
  "remove-variant-property",
  "rename-variant-value",
  "reorder-variant-values",
  "set-variant-properties",
  "add-property",
  "rename-property",
  "reorder-properties",
  "remove-property",
  "set-property",
  "reset-property",
  "create-slot-override",
  "clear-slot",
  "reset-slot",
  "set-slot-settings",
  "set-override",
  "reset-overrides",
  "detach-instance",
  "go-to-main",
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

const DISPLAY_NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^(?=.*\\S)[^\\u0000-\\u001F\\u007F-\\u009F]+$",
} as const;

const PROPERTY_NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 512,
} as const;

const NON_NEGATIVE_INDEX_SCHEMA = {
  type: "integer",
  minimum: 0,
} as const;

const COMPONENT_IDS_SCHEMA = {
  type: "array",
  minItems: 2,
  maxItems: 128,
  uniqueItems: true,
  items: ID_SCHEMA,
} as const;

const VARIANT_PROPERTIES_SCHEMA = {
  type: "object",
  minProperties: 1,
  maxProperties: 128,
  additionalProperties: {
    type: "string",
    minLength: 1,
    maxLength: 256,
  },
} as const;

const VARIANT_PROPERTY_MATRIX_SCHEMA = {
  type: "object",
  minProperties: 2,
  maxProperties: 128,
  additionalProperties: VARIANT_PROPERTIES_SCHEMA,
} as const;

const PROPERTY_ORDER_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 128,
  uniqueItems: true,
  items: ID_SCHEMA,
} as const;

const COMPONENT_PROPERTY_ORDER_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 4_096,
  uniqueItems: true,
  items: PROPERTY_NAME_SCHEMA,
} as const;

const VARIANT_VALUES_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 1_024,
  uniqueItems: true,
  items: {
    type: "string",
    minLength: 1,
    maxLength: 256,
  },
} as const;

const PREFERRED_VALUES_SCHEMA = {
  type: "array",
  maxItems: 256,
  items: {
    type: "object",
    properties: {
      type: { enum: ["COMPONENT", "COMPONENT_SET"] },
      key: ID_SCHEMA,
    },
    required: ["type", "key"],
    additionalProperties: false,
  },
} as const;

const SLOT_SETTINGS_SCHEMA = {
  type: "object",
  properties: {
    stretchChildOnInsert: { type: "boolean" },
    displayEmptyByDefault: { type: "boolean" },
    minChildren: {
      anyOf: [
        { type: "integer", minimum: 0, maximum: 4_096 },
        { type: "null" },
      ],
    },
    maxChildren: {
      anyOf: [
        { type: "integer", minimum: 0, maximum: 4_096 },
        { type: "null" },
      ],
    },
    allowPreferredValuesOnly: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const SOURCE_PATH_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  items: ID_SCHEMA,
} as const;

const OVERRIDE_PATCH_SCHEMA = {
  type: "object",
  minProperties: 1,
  properties: {
    name: { type: "string" },
    visible: { type: "boolean" },
    opacity: { type: "number", minimum: 0, maximum: 1 },
    blendMode: { enum: DESIGN_MODEL_BLEND_MODES },
    effects: { type: "array", items: DESIGN_MODEL_EFFECT_SCHEMA },
    maskMode: {
      enum: ["none", "alpha", "luminance", "clipping", "outline"],
    },
    properties: DESIGN_MODEL_NODE_PROPERTY_PATCH_SCHEMA,
  },
  additionalProperties: false,
} as const;

const BRANCH_COMMON_PROPERTIES = {
  label: { type: "string" },
  pageId: { type: "string" },
} as const;

function compactBranchProperty(
  name: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "value" && schema.type === "string") return schema;
  if (Array.isArray(schema.enum)) return { enum: schema.enum };
  if (Array.isArray(schema.anyOf)) return { anyOf: schema.anyOf };
  if (schema.type === "array") {
    const item = schema.items;
    const itemType =
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      (item as { type?: unknown }).type === "object"
        ? "object"
        : "string";
    return { type: "array", items: { type: itemType } };
  }
  return { type: schema.type };
}

function writeActionBranch<
  const TAction extends (typeof COMPONENT_ACTIONS)[number],
  const TProperties extends Record<string, unknown>,
>(
  action: TAction,
  properties: TProperties,
  required: readonly (keyof TProperties & string)[],
) {
  return {
    type: "object" as const,
    properties: {
      action: { const: action },
      ...BRANCH_COMMON_PROPERTIES,
      ...Object.fromEntries(
        Object.entries(properties).map(([name, schema]) => [
          name,
          compactBranchProperty(name, schema as Record<string, unknown>),
        ]),
      ),
    },
    required: ["action", "label", "pageId", ...required],
    additionalProperties: false,
  };
}

const COMPONENT_ACTION_BRANCHES = [
  writeActionBranch(
    "create-component",
    {
      rootNodeId: ID_SCHEMA,
      componentId: ID_SCHEMA,
      name: DISPLAY_NAME_SCHEMA,
    },
    ["rootNodeId", "componentId", "name"],
  ),
  writeActionBranch(
    "create-instance",
    {
      componentId: ID_SCHEMA,
      instanceId: ID_SCHEMA,
      parentId: { anyOf: [ID_SCHEMA, { type: "null" }] },
      index: NON_NEGATIVE_INDEX_SCHEMA,
      x: { type: "number" },
      y: { type: "number" },
      name: DISPLAY_NAME_SCHEMA,
    },
    ["componentId", "instanceId", "parentId", "index", "x", "y"],
  ),
  writeActionBranch("remove-component", { componentId: ID_SCHEMA }, [
    "componentId",
  ]),
  writeActionBranch(
    "combine-as-variants",
    {
      componentIds: COMPONENT_IDS_SCHEMA,
      componentRootNodeIds: COMPONENT_IDS_SCHEMA,
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      name: DISPLAY_NAME_SCHEMA,
      variantPropertiesByComponentId: VARIANT_PROPERTY_MATRIX_SCHEMA,
    },
    [
      "componentIds",
      "componentRootNodeIds",
      "variantSetId",
      "rootNodeId",
      "name",
      "variantPropertiesByComponentId",
    ],
  ),
  writeActionBranch(
    "add-component-to-variant-set",
    {
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      componentId: ID_SCHEMA,
      componentRootNodeId: ID_SCHEMA,
      variantProperties: VARIANT_PROPERTIES_SCHEMA,
    },
    [
      "variantSetId",
      "rootNodeId",
      "componentId",
      "componentRootNodeId",
      "variantProperties",
    ],
  ),
  writeActionBranch(
    "duplicate-variant",
    {
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      sourceComponentId: ID_SCHEMA,
      sourceRootNodeId: ID_SCHEMA,
      componentId: ID_SCHEMA,
      componentRootNodeId: ID_SCHEMA,
      name: DISPLAY_NAME_SCHEMA,
      variantProperties: VARIANT_PROPERTIES_SCHEMA,
    },
    [
      "variantSetId",
      "rootNodeId",
      "sourceComponentId",
      "sourceRootNodeId",
      "componentId",
      "componentRootNodeId",
      "variantProperties",
    ],
  ),
  writeActionBranch(
    "remove-variant",
    {
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      componentId: ID_SCHEMA,
      componentRootNodeId: ID_SCHEMA,
    },
    ["variantSetId", "rootNodeId", "componentId", "componentRootNodeId"],
  ),
  writeActionBranch(
    "dissolve-variant-set",
    { variantSetId: ID_SCHEMA, rootNodeId: ID_SCHEMA },
    ["variantSetId", "rootNodeId"],
  ),
  writeActionBranch(
    "add-variant-property",
    {
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      propertyName: PROPERTY_NAME_SCHEMA,
      valuesByComponentId: VARIANT_PROPERTIES_SCHEMA,
      index: NON_NEGATIVE_INDEX_SCHEMA,
    },
    ["variantSetId", "rootNodeId", "propertyName", "valuesByComponentId"],
  ),
  writeActionBranch(
    "rename-variant-property",
    {
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      propertyName: PROPERTY_NAME_SCHEMA,
      name: DISPLAY_NAME_SCHEMA,
    },
    ["variantSetId", "rootNodeId", "propertyName", "name"],
  ),
  writeActionBranch(
    "reorder-variant-properties",
    {
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      propertyOrder: PROPERTY_ORDER_SCHEMA,
    },
    ["variantSetId", "rootNodeId", "propertyOrder"],
  ),
  writeActionBranch(
    "remove-variant-property",
    {
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      propertyName: PROPERTY_NAME_SCHEMA,
    },
    ["variantSetId", "rootNodeId", "propertyName"],
  ),
  writeActionBranch(
    "rename-variant-value",
    {
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      propertyName: PROPERTY_NAME_SCHEMA,
      value: { type: "string", minLength: 1, maxLength: 256 },
      name: DISPLAY_NAME_SCHEMA,
    },
    ["variantSetId", "rootNodeId", "propertyName", "value", "name"],
  ),
  writeActionBranch(
    "reorder-variant-values",
    {
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      propertyName: PROPERTY_NAME_SCHEMA,
      values: VARIANT_VALUES_SCHEMA,
    },
    ["variantSetId", "rootNodeId", "propertyName", "values"],
  ),
  writeActionBranch(
    "set-variant-properties",
    {
      variantSetId: ID_SCHEMA,
      rootNodeId: ID_SCHEMA,
      componentId: ID_SCHEMA,
      componentRootNodeId: ID_SCHEMA,
      variantProperties: VARIANT_PROPERTIES_SCHEMA,
    },
    [
      "variantSetId",
      "rootNodeId",
      "componentId",
      "componentRootNodeId",
      "variantProperties",
    ],
  ),
  writeActionBranch(
    "add-property",
    {
      componentId: ID_SCHEMA,
      propertyId: ID_SCHEMA,
      name: DISPLAY_NAME_SCHEMA,
      type: { enum: ["BOOLEAN", "TEXT", "INSTANCE_SWAP", "SLOT"] },
      sourceNodeId: ID_SCHEMA,
      preferredValues: PREFERRED_VALUES_SCHEMA,
    },
    ["componentId", "propertyId", "name", "type", "sourceNodeId"],
  ),
  writeActionBranch(
    "rename-property",
    {
      componentId: ID_SCHEMA,
      propertyName: PROPERTY_NAME_SCHEMA,
      name: DISPLAY_NAME_SCHEMA,
    },
    ["componentId", "propertyName", "name"],
  ),
  writeActionBranch(
    "reorder-properties",
    {
      componentId: ID_SCHEMA,
      componentRootNodeId: ID_SCHEMA,
      componentPropertyOrder: COMPONENT_PROPERTY_ORDER_SCHEMA,
    },
    ["componentId", "componentRootNodeId", "componentPropertyOrder"],
  ),
  writeActionBranch(
    "remove-property",
    { componentId: ID_SCHEMA, propertyName: PROPERTY_NAME_SCHEMA },
    ["componentId", "propertyName"],
  ),
  writeActionBranch(
    "set-property",
    {
      instanceId: ID_SCHEMA,
      propertyName: PROPERTY_NAME_SCHEMA,
      value: {
        anyOf: [{ type: "boolean" }, { type: "string", maxLength: 100_000 }],
      },
    },
    ["instanceId", "propertyName", "value"],
  ),
  writeActionBranch(
    "reset-property",
    { instanceId: ID_SCHEMA, propertyName: PROPERTY_NAME_SCHEMA },
    ["instanceId", "propertyName"],
  ),
  ...(["create-slot-override", "clear-slot", "reset-slot"] as const).map(
    (action) =>
      writeActionBranch(
        action,
        { instanceId: ID_SCHEMA, propertyName: PROPERTY_NAME_SCHEMA },
        ["instanceId", "propertyName"],
      ),
  ),
  writeActionBranch(
    "set-slot-settings",
    {
      componentId: ID_SCHEMA,
      propertyName: PROPERTY_NAME_SCHEMA,
      settings: SLOT_SETTINGS_SCHEMA,
      preferredValues: PREFERRED_VALUES_SCHEMA,
      description: { type: "string", maxLength: 2_000 },
    },
    ["componentId", "propertyName", "settings"],
  ),
  writeActionBranch(
    "set-override",
    {
      instanceId: ID_SCHEMA,
      sourcePath: SOURCE_PATH_SCHEMA,
      patch: OVERRIDE_PATCH_SCHEMA,
    },
    ["instanceId", "sourcePath", "patch"],
  ),
  writeActionBranch(
    "reset-overrides",
    { instanceId: ID_SCHEMA, sourcePath: SOURCE_PATH_SCHEMA },
    ["instanceId"],
  ),
  writeActionBranch("detach-instance", { instanceId: ID_SCHEMA }, [
    "instanceId",
  ]),
  {
    type: "object" as const,
    properties: {
      action: { const: "go-to-main" },
      pageId: ID_SCHEMA,
      instanceId: ID_SCHEMA,
    },
    required: ["action", "pageId", "instanceId"],
    additionalProperties: false,
  },
] as const;

const COMPONENT_TOOL_PROPERTIES = {
  action: { enum: COMPONENT_ACTIONS },
  label: LABEL_SCHEMA,
  pageId: ID_SCHEMA,
  componentId: ID_SCHEMA,
  componentIds: COMPONENT_IDS_SCHEMA,
  componentRootNodeId: ID_SCHEMA,
  componentRootNodeIds: COMPONENT_IDS_SCHEMA,
  sourceComponentId: ID_SCHEMA,
  sourceRootNodeId: ID_SCHEMA,
  variantSetId: ID_SCHEMA,
  rootNodeId: ID_SCHEMA,
  instanceId: ID_SCHEMA,
  parentId: { anyOf: [ID_SCHEMA, { type: "null" }] },
  index: NON_NEGATIVE_INDEX_SCHEMA,
  x: { type: "number" },
  y: { type: "number" },
  name: DISPLAY_NAME_SCHEMA,
  variantPropertiesByComponentId: VARIANT_PROPERTY_MATRIX_SCHEMA,
  variantProperties: VARIANT_PROPERTIES_SCHEMA,
  valuesByComponentId: VARIANT_PROPERTIES_SCHEMA,
  propertyOrder: PROPERTY_ORDER_SCHEMA,
  componentPropertyOrder: COMPONENT_PROPERTY_ORDER_SCHEMA,
  values: VARIANT_VALUES_SCHEMA,
  propertyId: ID_SCHEMA,
  propertyName: PROPERTY_NAME_SCHEMA,
  type: { enum: ["BOOLEAN", "TEXT", "INSTANCE_SWAP", "SLOT"] },
  sourceNodeId: ID_SCHEMA,
  preferredValues: PREFERRED_VALUES_SCHEMA,
  settings: SLOT_SETTINGS_SCHEMA,
  description: { type: "string", maxLength: 2_000 },
  value: {
    anyOf: [{ type: "boolean" }, { type: "string", maxLength: 100_000 }],
  },
  sourcePath: SOURCE_PATH_SCHEMA,
  patch: OVERRIDE_PATCH_SCHEMA,
} as const;

const COMPONENT_AUTHORING_TOOL_PROPERTIES = {
  action: { enum: COMPONENT_ACTIONS.slice(0, 2) },
  label: LABEL_SCHEMA,
  pageId: ID_SCHEMA,
  componentId: ID_SCHEMA,
  rootNodeId: ID_SCHEMA,
  instanceId: ID_SCHEMA,
  parentId: { anyOf: [ID_SCHEMA, { type: "null" }] },
  index: NON_NEGATIVE_INDEX_SCHEMA,
  x: { type: "number" },
  y: { type: "number" },
  name: DISPLAY_NAME_SCHEMA,
} as const;

function componentToolSchema(
  description: string,
  branches: readonly Record<string, unknown>[],
  properties: Record<string, unknown> = COMPONENT_TOOL_PROPERTIES,
) {
  return executableJsonSchema({
    type: "object",
    description,
    properties,
    required: ["action", "pageId"],
    anyOf: branches,
    additionalProperties: false,
  });
}

export const DESIGN_COMPONENT_TOOL_INPUT_SCHEMA = componentToolSchema(
  "Create and place linked Components, manage Component Sets and Variants, author typed Boolean/Text/Instance-swap/Slot properties, edit instance properties and overrides, detach an Instance, or locate its Main. Every action has one closed field shape. Component, set, root, property, source-path, and Page IDs must come from current inspection; IDs for newly created definitions and layers must come from the active allocation namespace.",
  COMPONENT_ACTION_BRANCHES,
);

export const DESIGN_COMPONENT_AUTHORING_TOOL_INPUT_SCHEMA = componentToolSchema(
  "Create a Component Main or place a linked Component Instance for the current design. Use stable inspected IDs and the active allocation namespace.",
  COMPONENT_ACTION_BRANCHES.slice(0, 2),
  COMPONENT_AUTHORING_TOOL_PROPERTIES,
);
