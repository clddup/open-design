import { executableJsonSchema } from "@opendesign/design-contracts";
import {
  DESIGN_APPLY_TOOL_INPUT_SCHEMA,
  DESIGN_MODEL_NODE_PROPERTY_KEYS_BY_KIND,
} from "./design-agent-operation-schemas";

const FOCUSED_NODE_KINDS = [
  "frame",
  "group",
  "rectangle",
  "ellipse",
  "path",
  "text",
] as const;
const FOCUSED_NODE_KIND_SET = new Set<string>(FOCUSED_NODE_KINDS);
const FOCUSED_NODE_PROPERTY_KEYS = new Set(
  FOCUSED_NODE_KINDS.flatMap((kind) => [
    ...DESIGN_MODEL_NODE_PROPERTY_KEYS_BY_KIND[kind],
  ]).filter((key) => key !== "network"),
);

type JsonRecord = Record<string, unknown>;

export const DESIGN_FOCUSED_VISUAL_APPLY_TOOL_INPUT_SCHEMA =
  executableJsonSchema(projectFocusedApplySchema());

function projectFocusedApplySchema(): JsonRecord {
  const schema = structuredClone(DESIGN_APPLY_TOOL_INPUT_SCHEMA);
  const properties = record(schema.properties, "Apply properties");
  const commands = record(properties.commands, "Apply commands");
  const operations = record(commands.items, "Apply operations");
  operations.anyOf = array(operations.anyOf, "Apply operation branches")
    .filter((branch) => operationType(branch) !== "replace_subtree")
    .map(projectOperationBranch);
  return schema;
}

function projectOperationBranch(value: unknown): JsonRecord {
  const branch = record(value, "Apply operation branch");
  const properties = record(branch.properties, "Operation properties");
  const type = record(properties.type, "Operation type").const;
  if (type === "insert_element") {
    properties.node = projectNodeSchema(properties.node);
  } else if (type === "update_properties") {
    properties.properties = projectNodeProperties(properties.properties);
  }
  return branch;
}

function operationType(value: unknown): unknown {
  const branch = record(value, "Apply operation branch");
  const properties = record(branch.properties, "Operation properties");
  return record(properties.type, "Operation type").const;
}

function projectNodeSchema(value: unknown): JsonRecord {
  const node = record(value, "Design node");
  const properties = record(node.properties, "Design node properties");
  const kind = record(properties.kind, "Design node kind");
  kind.enum = array(kind.enum, "Design node kinds").filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && FOCUSED_NODE_KIND_SET.has(candidate),
  );
  properties.properties = projectNodeProperties(properties.properties);
  node.anyOf = array(node.anyOf, "Design node branches")
    .filter((branch) => FOCUSED_NODE_KIND_SET.has(nodeBranchKind(branch)))
    .map(projectNodeBranch);
  return node;
}

function projectNodeBranch(value: unknown): JsonRecord {
  const branch = record(value, "Design node branch");
  if (nodeBranchKind(branch) !== "path") return branch;
  const properties = record(branch.properties, "Node branch properties");
  const appearance = record(properties.properties, "Path properties");
  appearance.anyOf = array(appearance.anyOf, "Path property branches").filter(
    (candidate) =>
      array(
        record(candidate, "Path property branch").required,
        "required",
      ).includes("path"),
  );
  return branch;
}

function projectNodeProperties(value: unknown): JsonRecord {
  const properties = record(value, "Node appearance schema");
  const fields = record(properties.properties, "Node appearance fields");
  for (const key of Object.keys(fields)) {
    if (!FOCUSED_NODE_PROPERTY_KEYS.has(key))
      Reflect.deleteProperty(fields, key);
  }
  properties.description =
    "Focused properties for Frame, Group, Rectangle, Ellipse, editable SVG Path, and Text.";
  return properties;
}

function nodeBranchKind(value: unknown): string {
  const branch = record(value, "Design node branch");
  const properties = record(branch.properties, "Node branch properties");
  const kind = record(properties.kind, "Node branch kind").const;
  return typeof kind === "string" ? kind : "";
}

function record(value: unknown, subject: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${subject} schema is not an object`);
  }
  return value as JsonRecord;
}

function array(value: unknown, subject: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${subject} schema is not an array`);
  }
  return value;
}
